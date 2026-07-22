# Plan — Limite quotidienne par ressource ET par semaine

**Auteur du plan :** Opus (conception) — **Exécutant :** Sonnet
**Branche :** `feature/weekly-max-daily` (jamais `master`)
**Date :** 2026-07-22

---

## 1. Objectif

Aujourd'hui `maxDailyMinutes` est un scalaire par ressource : la même limite quotidienne
s'applique à toutes les semaines. Objectif : pouvoir définir une limite quotidienne
**spécifique à une semaine**, en complément des disponibilités hebdomadaires déjà
surchargeables.

Il s'agit bien d'une limite **quotidienne** (plafond par jour) valable pour une semaine
donnée — **pas** d'un volume hebdomadaire. Question posée et tranchée par Frédéric le
2026-07-22 : le moteur ne sait faire que le quotidien (`_dailyBookedMinutes`,
[scheduler.ts:55](../packages/scheduler-core/src/scheduler.ts#L55)) et c'est bien ce qui est
demandé. **Aucun `maxWeeklyMinutes` dans ce chantier.**

## 2. Décisions déjà tranchées (ne pas rouvrir)

| Sujet | Décision | Raison |
|---|---|---|
| Où stocker | `ResourceDataWithStatus.weeklyMaxDailyMinutes?: Record<string, number>` côté **client** | Additif pur, aucun type existant cassé, aucune migration de projets persistés ; suit le précédent `unused` ([csvMerge.ts:113](../packages/scheduler-client/lib/csvMerge.ts#L113)) |
| Pas dans `ResourceConstraints` | Refusé | Casserait l'index signature `[weekKey: string]: TimeSlot[]` consommée par `AvailabilityManager` (serveur), `normalizeToRC`, `getWeekKeys`, `applyBlockedZonesToConstraints`, l'import/export JSON utilisateur et la migration legacy — pour une notion (capacité) dont l'`AvailabilityManager` n'a que faire |
| Pas dans `scheduler-common` | Refusé | Le moteur ne doit pas recevoir un champ qu'il ignore ; la résolution se fait côté client |
| Moteur | **Zéro ligne modifiée** dans `scheduler-core` | Le moteur est mono-semaine : `resources[].maxDailyMinutes` est déjà un scalaire résolu au moment du payload. `rootLowerBound` reste correct automatiquement |
| Couplage à la checkbox semaine | ~~Découplé~~ → **Couplé** (arbitrage Frédéric après essai, 2026-07-22) | Motif initial du découplage : coupler force à figer les horaires pour poser une limite, et décocher efface la limite. Rejeté à l'usage : pouvoir modifier la limite d'une semaine affichée comme inactive est ambigu — c'est bien une modification des données de cette semaine. Le coût du couplage est nul en pratique puisque cocher initialise les horaires à ceux du défaut. Conséquence assumée : **décocher une semaine efface aussi sa limite** |
| Bandeau « Max. quotidien » | **Supprimé**, rapatrié dans la colonne, ligne « Défaut » | Une seule notion, un seul endroit |
| Unité de saisie | Reste en **heures** (step 0.5), unité dans l'en-tête | Ne pas changer une saisie non demandée |
| Fiche « Défaut » établissement | Colonne **masquée** (`isDefault`) | Aucun mécanisme d'héritage de `maxDailyMinutes` depuis `Default` côté moteur ; en créer un est un autre chantier |
| Export JSON contraintes | Ne contiendra toujours pas les limites | Déjà vrai aujourd'hui — dette notée, hors périmètre |

## 3. Modèle de données

```ts
// packages/scheduler-client/lib/csvMerge.ts
export interface ResourceDataWithStatus extends ResourceData {
  unused?: boolean;
  /**
   * Limites quotidiennes spécifiques à une semaine, en minutes, clés « S36 » (même
   * convention que ResourceConstraints). Absent pour une semaine ⇒ `maxDailyMinutes`
   * (le défaut de la ressource) s'applique. Champ purement client : résolu en un
   * scalaire par `_buildPayload` avant l'envoi au moteur, qui ne le voit jamais.
   */
  weeklyMaxDailyMinutes?: Record<string, number>;
}
```

**Règle de résolution, unique et partagée** — à écrire une seule fois et à réutiliser par
les deux consommateurs :

```ts
// packages/scheduler-client/lib/maxDailyResolution.ts (nouveau fichier)
export function resolveMaxDailyMinutes(
  r: ResourceDataWithStatus,
  weekNumber: number,
): number | undefined {
  return r.weeklyMaxDailyMinutes?.[`S${weekNumber}`] ?? r.maxDailyMinutes;
}
```

`?? ` et non `||` : une limite hebdo de valeur `0` n'est pas produite par l'UI (elle
efface l'override), mais la sémantique « présent ⇒ gagne » doit rester exacte.

## 4. Les deux consommateurs — aucun ne doit être oublié

Il existe **exactement deux** chemins qui lisent `maxDailyMinutes`. S'ils divergent,
l'analyse de charge affichée à l'utilisateur contredit silencieusement ce que le moteur
applique.

1. **Payload moteur** — [scheduleApi.ts:42-82](../packages/scheduler-client/lib/api/scheduleApi.ts#L42-L82)
2. **Analyse de charge** — `maxDailyMinutesById` dans
   [resourceLoadAnalysis.ts:99](../packages/scheduler-client/lib/resourceLoadAnalysis.ts#L99),
   utilisée par `buildPreparationLoadRows` et `buildAnalysisLoadRows` (classement 🔴/🟠/🟢)

`autonomyDistribution.ts` ignore volontairement les limites quotidiennes
([commentaire ligne 70](../packages/scheduler-client/lib/calendar/autonomyDistribution.ts#L70))
— **rien à y faire.**

---

## 5. Étapes d'implémentation

### P1 — Modèle + résolution

- Ajouter `weeklyMaxDailyMinutes?` à `ResourceDataWithStatus`
  ([csvMerge.ts:113](../packages/scheduler-client/lib/csvMerge.ts#L113)) avec le
  commentaire du §3.
- Créer `lib/maxDailyResolution.ts` avec `resolveMaxDailyMinutes` (§3).
- **Vérifier sans le modifier** que `diffCsvResources` conserve bien l'objet ancien pour
  une ressource appariée (donc le nouveau champ survit à une fusion CSV par construction).
  Si le comportement diffère de ce que dit le commentaire
  [csvMerge.ts:128](../packages/scheduler-client/lib/csvMerge.ts#L128), **rapporter le fait,
  ne pas corriger** — c'est hors périmètre.

### P2 — Store

Dans [useProjectStore.ts:207-214](../packages/scheduler-client/store/useProjectStore.ts#L207-L214),
à côté de `setResourceMaxDailyMinutes`, ajouter :

```ts
setResourceWeeklyMaxDailyMinutes: (id: string, weekKey: string, minutes: number | undefined) => void;
```

Sémantique : `minutes === undefined` ⇒ **supprimer la clé** `weekKey` (retour à
l'héritage), et si l'objet devient vide, supprimer `weeklyMaxDailyMinutes` entièrement
(pas d'objet vide qui traîne dans le localStorage — cf. la contrainte de taille du stockage
par semaine, `docs/PlanSplitWeekStorage.md`).

Ne rien changer à `partialize` : `resources` est déjà persisté.

### P3 — Payload moteur

Dans `_buildPayload` ([scheduleApi.ts:42](../packages/scheduler-client/lib/api/scheduleApi.ts#L42)) :

- Élargir `RunScheduleParamsFromData.resources` et le paramètre de `_buildPayload` en
  `ResourceGroupDataWithStatus[]`. La chaîne amont conserve déjà le type
  (`filterResourcesForCourses` est générique `<T extends ResourceGroupData>`), donc
  `usePlanningStore` n'a rien à changer.
- Remapper les ressources : `maxDailyMinutes` ← `resolveMaxDailyMinutes(r, weekNum)`, et
  **retirer `weeklyMaxDailyMinutes`** de l'objet envoyé. Ne pas toucher aux autres champs
  (`unused` continue de partir dans le payload comme aujourd'hui — comportement existant,
  ne pas le « nettoyer » au passage).
- Si la valeur résolue est `undefined`, la clé `maxDailyMinutes` doit être **absente**, pas
  présente à `undefined` (le moteur teste `!== undefined`, mais `JSON.stringify` élide déjà
  — écrire quand même la version explicite pour que les tests `toEqual` restent lisibles).

C'est exactement le même geste que la résolution de `Default` déjà présente lignes 57-65 —
la placer juste à côté, dans le même esprit.

### P4 — Analyse de charge

Dans [resourceLoadAnalysis.ts](../packages/scheduler-client/lib/resourceLoadAnalysis.ts) :

- `maxDailyMinutesById(resources)` → `maxDailyMinutesById(resources, weekNumber)`, qui
  appelle `resolveMaxDailyMinutes` par ressource.
- Les deux appelants (`buildPreparationLoadRows` ligne ~174, `buildAnalysisLoadRows` ligne
  ~214) ont **déjà** `weekNumber` en scope : il n'y a qu'à le passer.
- Élargir le paramètre `resources` de ces fonctions en `ResourceGroupDataWithStatus[]`.

### P5 — UI : colonne « Max quot. (h) »

Dans [ResourceConstraintEditor.tsx](../packages/scheduler-client/components/constraints/ResourceConstraintEditor.tsx) :

**5.1 — Supprimer** le bandeau lignes 416-451 ainsi que l'état `localHours` (273-279).

**5.2 — Nouveau composant `MaxDailyCell`** (même fichier, à côté de `DayCell`) :
- Saisie en heures, `step 0.5`, `placeholder="illimité"`, commit `onBlur` (même logique de
  parsing que le bandeau supprimé : `<= 0` ou `NaN` ⇒ `undefined`, sinon
  `Math.round(n * 60)`).
- Rendu **hérité** (aucune valeur propre à cette semaine) : la valeur du défaut affichée en
  italique grisée, exactement le motif `inherited` de `DayCell` lignes 65-89. Rendu
  **propre** : valeur normale + un `×` pour revenir à l'héritage.
- Semaine **non cochée** : cellule en lecture seule, affichant la limite réellement en vigueur
  (§2, couplage). Semaine **cochée** : cellule éditable ; vide ⇒ la ligne hérite encore, la
  valeur du défaut est en placeholder italique.
- Un champ vide **pré-rempli au focus** avec la valeur héritée, pour que les flèches haut/bas
  (clavier comme spinner souris) repartent du défaut et non de zéro. Ressortir sans avoir
  changé la valeur n'écrit **aucun** override : la semaine reste en héritage vivant.

**5.3 — Colonne dans le `<thead>`** (après la colonne « Semaine », lignes 467-469) :
- En-tête `Max quot. (h)`.
- **Sticky comme la colonne Semaine** : `sticky left-20` (la colonne Semaine est `w-20
  sticky left-0`). Sans ça, la colonne disparaît au scroll horizontal — 6 colonnes jours à
  `min-w-35` — et on éditerait une limite sans voir de quelle semaine il s'agit.

**5.4 — Ligne « Défaut »** (lignes 482-487) : sa cellule pilote `maxDailyMinutes` (le
défaut de la ressource), via le `setResourceMaxDailyMinutes` existant.

**5.5 — Lignes semaine** (lignes 490-508) : cellule pilotant
`weeklyMaxDailyMinutes[wk]` via le nouveau setter, avec la valeur du défaut comme valeur
héritée affichée.

**5.6 — `allDisplayWeekKeys`** (lignes 294-297) : ajouter les clés de
`weeklyMaxDailyMinutes` à l'union. **Point facile à rater :** sans ça, une semaine qui n'a
qu'une limite (pas d'override de dispo, pas de semaine CSV) n'apparaît pas dans le tableau
et sa limite devient invisible et non éditable, tout en restant active.

**5.7 — `colSpan`** de la ligne « + Ajouter une semaine personnalisée » (ligne 512) :
`DAYS.length + 1` → `DAYS.length + 2`.

**5.8 — Garde `isDefault`** : pas de colonne du tout sur la fiche « Défaut » de
l'établissement. Conserver aussi la garde existante de
[ConstraintsManager.tsx:381-385](../packages/scheduler-client/components/constraints/ConstraintsManager.tsx#L381-L385)
(ressource absente de `storeResources` ⇒ pas de colonne : une contrainte orpheline n'a pas
de `ResourceData` où écrire).

**5.9 — Props** : remplacer `maxDailyMinutes` / `onMaxDailyMinutesChange` par le couple
défaut + hebdo. `ConstraintsManager` fournit les deux depuis `storeResources` (il calcule
déjà `selectedMaxDailyMinutes` lignes 73-80 — étendre ce `useMemo` pour renvoyer aussi
`weeklyMaxDailyMinutes`).

---

## 6. ⛔ CHECKPOINT — feu vert avant les tests

**Arrêt obligatoire à la fin de P5.** Ne pas écrire les tests du §7 avant retour.
Rapporter :

- le diff (fichiers touchés, lignes ajoutées/supprimées) ;
- le résultat brut de `npm run typecheck` ;
- toute divergence constatée entre ce plan et le code réel (le plan a été écrit sur le code
  au 2026-07-22, commit `0d96d7b`) ;
- une capture ou une description factuelle du tableau rendu avec une limite défaut + une
  limite hebdo sur une semaine non cochée.

Frédéric ou le relecteur donne le feu vert avant P7.

---

## 7. Tests (après feu vert)

Validation dimensionnée sur ce que le changement peut affecter : **aucune ligne de
`scheduler-core` ne bouge, donc aucun benchmark moteur, aucune mesure de temps de
résolution.** Les tests portent uniquement sur la résolution et ses deux consommateurs.

1. **`resolveMaxDailyMinutes`** — trois cas : override présent pour la semaine / absent
   ⇒ défaut / ni l'un ni l'autre ⇒ `undefined`.
2. **`_buildPayload`** (`__tests__/scheduleApi.test.ts`) — une ressource avec défaut 240 et
   `{ S40: 120 }` : payload semaine 40 ⇒ `maxDailyMinutes: 120` ; semaine 39 ⇒ `240` ; et
   `weeklyMaxDailyMinutes` **absent** du payload dans les deux cas.
3. **`resourceLoadAnalysis`** (`__tests__/resourceLoadAnalysis.test.ts`) — étendre le test
   existant ligne 51 (« maxDailyMinutes plafonne la capacité quotidienne ») avec une limite
   hebdo : la capacité plafonnée doit suivre la semaine demandée.
4. **`csvMerge`** (`__tests__/csvMerge.test.ts:165,183`) — les `toEqual` exacts vont casser
   dès que l'objet porte le nouveau champ : les étendre et vérifier au passage que
   `weeklyMaxDailyMinutes` survit à une fusion.

Puis : `npm run typecheck` sur tout le workspace, et les suites de tests des packages
touchés.

**Validation réelle avant de considérer le chantier fini :** rejouer une semaine du **vrai
projet de Frédéric** (ré-exporté, pas un snapshot ancien) avec une limite hebdo posée, et
comparer le résultat à la même semaine sans limite hebdo. Un test sur payloads isolés ne
suffit pas — précédent documenté (heuristique validée sur 2-3 payloads puis catastrophique
sur le projet réel).

---

## 8. Règles de rapport (exécutant)

- Le STATUT rapporte des **faits bruts** : commandes lancées, sorties, ce qui passe et ce
  qui casse. **Jamais** « vérifié », « validé », « corrigé ».
- Les conclusions et l'attribution des effets sont écrites au retour par le relecteur
  (Opus, Fable ou Frédéric).
- Si un test échoue, le dire avec la sortie, ne pas le contourner.
- Tout écart au plan est signalé, pas absorbé silencieusement.

---

## 9. Correctif post-livraison (relecture Opus, 2026-07-22)

Vérification demandée par Frédéric — « la limite transmise au moteur est bien celle du Défaut
si la semaine n'est pas cochée, celle de la semaine si elle l'est » — conduite sur la chaîne
complète UI → store → payload (`__tests__/maxDailyEndToEnd.test.tsx`, ajouté à cette
occasion : aucune suite ne couvrait ce bout-en-bout). Règle **confirmée**. Deux défauts
trouvés en marge et corrigés :

**9.1 — Limites orphelines sur trois chemins.** Le couplage limite ⟷ case à cocher (§2) crée
l'invariant « clé hebdo présente ⟺ semaine cochée ». Il n'était maintenu que par les handlers
de l'éditeur ; trois chemins décochent sans passer par la case et laissaient une limite
active, invisible et non modifiable (mesuré : 120 min toujours envoyées au moteur dans les
trois cas) :
supprimer toutes les contraintes de la ressource · `deleteConstraint` · `importConstraints`.

Correctif : `pruneOrphanWeeklyMaxDaily` (lib/maxDailyResolution.ts), appliquée par
`setConstraints()` dans `constraintsSlice` — donc à **chaque** écriture de `constraints`,
quel que soit le chemin, présent ou futur. Stable par référence (`resources` inchangé si rien
n'est orphelin) : sans quoi chaque frappe dans l'éditeur réécrirait le localStorage et
reconstruirait `clientSchedulerData`. La purge symétrique qui avait été placée dans
`handleWeekDelete` est retirée : une seule source de vérité.

**9.2 — Régression : limite par défaut inaccessible sans contraintes.** Déplacer le bandeau
dans le tableau (§2) l'a rendu inatteignable pour une ressource sans contraintes propres —
`value === null` n'affiche aucun tableau, donc aucune colonne. Or « disponibilités par défaut
mais plafonné à N h/jour » est un réglage courant, et il était possible avant ce chantier
(le bandeau s'affichait indépendamment du tableau). Mesuré : 0 champ éditable, une limite
déjà posée restant active et invisible. Correctif : la branche « Aucune contrainte définie »
réexpose la limite par défaut seule. La décision §2 « bandeau supprimé » reste vraie partout
où le tableau existe.

**9.3 — Harness de test réaligné.** `ResourceConstraintEditorMaxDaily.test.tsx` simulait le
store avec un `useState` sans réconciliation : après 9.1 il aurait validé un montage
n'existant nulle part. Il applique désormais `pruneOrphanWeeklyMaxDaily`, comme le store.

État : 419 tests passent, `npm run typecheck` propre sur les 4 packages. La validation sur le
projet réel (§7) reste à faire par Frédéric.
