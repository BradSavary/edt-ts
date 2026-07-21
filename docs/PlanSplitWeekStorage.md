# Plan d'implémentation — stockage localStorage découpé par semaine

## STATUT

**§4 (implémentation) : Sonnet, 2026-07-21.** Arrêt au CHECKPOINT §5 conformément au plan — aucun
test, aucune mesure, aucun STATUT rédigé à ce stade.

**§5 (checkpoint) et §6 (validation) : Opus, 2026-07-21.**

### §5 — checkpoint, item par item
- `npm run typecheck --workspaces` : propre sur les 4 packages.
- **`JSON.stringify` jamais appelé sur une donnée inchangée** : conforme. La décision précède la
  sérialisation — `_lastWrittenWeeks.get(key) === snapshot` pour les semaines,
  `projectEntryFieldsChanged` (comparaison de référence champ par champ) pour l'entrée projet.
- **Entrée projet non réécrite quand seule une semaine change** : conforme, condition
  `listChanged || projectEntryFieldsChanged(...)`.
- **Ordre des migrations** : conforme — `useProjectStore.ts` l.23-24, `migrateLegacyProjectStorage()`
  puis `migrateProjectStorageToSplitKeys()`, avant toute lecture par le storage engine.
- **Balayage §4.4** : `clearAllWeekKeys()` appelé aux trois transitions de `projectLifecycle.ts`,
  avec un commentaire indiquant que c'est une ceinture-bretelles.

Deux ajouts non demandés par le plan, tous deux justes : la migration écrit les semaines **avant**
l'entrée projet (piège signalé au §4.3), et `getItem` **amorce les caches** sur l'état hydraté —
sans quoi la première écriture de chaque session aurait tout réécrit et le gain aurait été perdu
pour celle-là.

### §6.1 — non-régression
348/348 avant (master, étape 3 comprise), 359/359 après. Typecheck propre, lint 27 (7 erreurs,
20 avertissements — inchangé, tous dans des fichiers hors périmètre), build Next OK.

**Fait notable :** `__tests__/projectFile.test.ts` ne teste que les fonctions pures et n'exerce
**jamais** `createProjectStorage`. Les 348 tests préexistants n'apportaient donc aucun signal sur ce
chantier — la couverture du moteur de stockage réécrit était nulle avant §6.2.

### §6.2 — tests ciblés
`__tests__/projectStorage.test.ts`, 11 cas couvrant les 10 du plan (le cas 4 est dédoublé en
« modifier un champ projet » et « réécrire un état inchangé n'écrit rien »). L'écriture sélective
est vérifiée par journalisation des appels à `localStorage.setItem`, pas par comparaison de
contenus.

**Contrôle de mutation** (les tests mordent-ils réellement) :
- forcer la réécriture systématique de l'entrée projet → cas 3 et 4bis échouent ;
- supprimer le court-circuit de comparaison des semaines → cas 3 et 4 échouent.

### §6.3 — mesure du gain (chiffres bruts)
Protocole adapté : plutôt que l'instrumentation console prescrite par le plan, la mesure est faite
sur le **vrai moteur** avec un `localStorage` instrumenté, alimenté par l'export réel
`packages/scheduler-core/data/Planification MMI_2026-07-16_10-13.json` (9 semaines). Scénario :
amorçage puis **une** modification de semaine. Script temporaire, supprimé après usage.

```
ancien moteur (master)   : 612 271 octets, 1 écriture (tout le projet)
nouveau moteur (branche) :   2 373 octets, 1 écriture (edt-project:week:39)
```

Semaine 39 = la plus lourde des 9. À titre de comparaison, une semaine quasi vide (S3) écrit
181 octets.

### §6.4 — passe manuelle (Frédéric, 2026-07-21)
Points 1, 2, 3, 4 et 6 conformes — dont le point 4, l'export comparé à un export `master` : contenu
identique. C'est la vérification en conditions réelles de l'invariant du §1.3.

**Point 5 — une clé `edt-project:week:35` apparaît dès la création d'un projet** (et à la
réouverture d'un projet existant). 35 = `DEFAULT_WEEK`.

Diagnostic : **pas une régression de ce chantier**, vérifié par A/B — le même scénario exécuté sur
`master` sans aucune modification de ce chantier produit `weekSaves = ['35']` à l'identique. Le
découpage n'a fait que rendre visible, sous forme de clé, ce qui était enfoui dans le monolithe.
Confirmation indépendante : l'export du 2026-07-16 (antérieur à tous ces chantiers) contient déjà
une **semaine 3 vide** (198 octets, aucun contenu).

Cause : `createNewProject`/`loadProjectFromFile` enchaînent `reset()` — qui remet déjà
`selectedWeek` à `DEFAULT_WEEK` — puis `setSelectedWeek(DEFAULT_WEEK)`. La semaine ne change donc
pas entre les deux, le garde-fou `state.selectedWeek !== prev.selectedWeek` du subscribe d'auto-save
ne s'applique pas, et les nouvelles références de `taskGroups`/`blockedZones` déclenchent une
sauvegarde.

Corrigé **dans un commit séparé** (préexistant, indépendant du découpage) : `_saveCurrentWeekSnapshot`
ne crée plus de snapshot vide pour une semaine qui n'en a pas déjà un ; un snapshot existant reste
mis à jour même vide, pour ne pas figer une préparation que l'utilisateur efface. Couvert par
`__tests__/emptySnapshot.test.ts` (4 cas, dont ce dernier).

---

**Branche :** `refactor/split-week-storage` — **à créer depuis master, ne pas travailler sur master.**
**Rôle :** conception validée (Opus/Frédéric) → exécution Sonnet.
**Statut :** §4 à §6.3 faits. Reste §6.4 (passe manuelle).
**Contexte :** plomberie préalable à la persistance des placements. Aucun changement d'UI, aucun
changement de comportement attendu — uniquement le coût d'écriture.

## 1. Objectif

`createProjectStorage().setItem` **resérialise et réécrit l'intégralité du projet** — tous les
cours, toutes les ressources, les contraintes, les 52 semaines — à chaque sauvegarde. Aujourd'hui
c'est supportable parce que l'auto-save ne se déclenche que sur des événements rares (groupes de
tâches, zones bloquées, impositions, exclusions amont) et parce que les placements ne sont pas
persistés.

Dès que les placements le seront, **chaque déplacement de tuile deviendra une réécriture complète**
de 1 à 3 Mo. C'est le risque identifié dès la première analyse du chantier, et c'est ce plan qui le
ferme.

Solution : une clé localStorage par semaine, plus une clé projet qui ne contient plus les semaines.
Une modification de semaine n'écrit plus que ~quelques dizaines de Ko.

### 1.1 Ce que ça ne résout pas

Le quota localStorage est **par origine** (~5 Mo), pas par clé. Le découpage ne réduit pas le
volume total — l'estimation de ~1,3 Mo/an pour les placements persistés reste entière. Si le quota
devient contraignant un jour, la réponse est IndexedDB (transactionnel, sans quota pratique,
`zustand/persist` accepte un storage asynchrone), au prix d'une hydratation asynchrone qui touche
`useHydrated` et `RouteGuard`. **Hors périmètre ici** : le multi-clés est un bien meilleur rapport
effort/gain et ne ferme pas cette porte.

### 1.2 L'export n'est pas concerné

Vérifié : `ProjectIdentityBlock.tsx` et `LaunchScreen.tsx` appellent
`stateToProjectFile(useProjectStore.getState())` — ils assemblent le fichier depuis **l'état en
mémoire**, qui contient toujours le projet complet. L'import (`projectLifecycle.ts` →
`parseProjectFile`) lit un fichier, pas le localStorage.

Le format d'export `ProjectFileV1` **ne change donc pas d'un octet**, et aucun mécanisme de
substitution (gabarits, tags `{{S38}}`) n'est nécessaire : il n'y a rien à recomposer, le format
exporté est déjà produit indépendamment du stockage.

### 1.3 L'invariant qu'on accepte de perdre

Le fichier `projectFile.ts` dit aujourd'hui : « à la fois le format persisté et le format
exporté […] pour garantir que "sauvegardé" et "exportable" ne divergent jamais ». Ce découpage
**rompt cette identité littérale**.

L'invariant devient : *le stockage se réassemble exactement en un `ProjectFileV1`*. Il n'est plus
garanti par construction, il doit l'être par un test d'aller-retour (§6.2). C'est le seul vrai
coût de ce chantier, et il faut l'assumer explicitement dans le commentaire d'en-tête du fichier.

## 2. Non-objectifs

- **NE PAS** persister les placements ni les non-placés — chantier suivant. Ici, `weekSaves`
  contient exactement les mêmes `PreparedWeekSnapshot` qu'aujourd'hui.
- **NE PAS** modifier le format d'export/import `ProjectFileV1`, ni `PreparedWeekSnapshot`.
- **NE PAS** toucher au store en dehors du moteur de stockage : `weekSaves` reste un
  `Record<string, PreparedWeekSnapshot>` en mémoire, aucun consommateur ne change.
- **NE PAS** migrer vers IndexedDB (§1.1).
- **NE PAS** modifier `scheduler-core`, `scheduler-common`, `scheduler-api`.

## 3. Le format de stockage cible

| Clé | Contenu |
|---|---|
| `edt-project` | tout `ProjectFileV1` **sauf** `weekSaves`, plus `weeks: number[]` |
| `edt-project:week:<n>` | un `PreparedWeekSnapshot`, sérialisé seul |

`weeks` est la **source de vérité unique** de « quelles semaines existent ». Une clé
`edt-project:week:*` dont le numéro n'y figure pas est un orphelin : ignorée à la lecture, balayée
aux points de §4.4.

Ajouter un `storageVersion: 2` dans l'entrée projet pour distinguer sans ambiguïté le format
découpé de l'ancien monolithe (§4.3). Ne pas réutiliser `formatVersion`, qui appartient au format
d'export et ne doit pas bouger.

## 4. Changements de code

Tout est dans `packages/scheduler-client/lib/project/`.

### 4.1 `projectFile.ts` — le moteur de stockage

**`getItem`** : lire `edt-project` ; si absent → `null`. Reconstituer `weekSaves` en lisant
`edt-project:week:<n>` pour chaque `n` de `weeks`. Une clé manquante ou illisible est **ignorée**
(semaine perdue) plutôt que de faire échouer tout le chargement — le comportement actuel sur JSON
corrompu est déjà « logguer et repartir de zéro », mais perdre une semaine vaut mieux que perdre le
projet. Logguer chaque semaine ignorée.

**`setItem`** : c'est le cœur du chantier.

1. **Ne rien sérialiser avant d'avoir constaté un changement.** Garder un cache module-level :

```ts
let _lastWrittenWeeks = new Map<string, PreparedWeekSnapshot>(); // référence écrite par semaine
let _lastWrittenProjectFields: PersistedProjectFields | null = null; // pour comparaison par référence
```

   L'état zustand est immuable : **une comparaison de référence suffit** et évite de resérialiser
   pour comparer. C'est le point d'implémentation clé — comparer des chaînes JSON annulerait tout
   le gain, puisque `JSON.stringify` sur 1–3 Mo est précisément le coût qu'on supprime.

2. **Semaines** : pour chaque clé de `state.weekSaves`, écrire seulement si la référence diffère de
   `_lastWrittenWeeks`. Pour chaque semaine présente dans le cache mais absente de l'état :
   `removeItem` de sa clé.

3. **Entrée projet** : n'écrire que si au moins un des champs hors `weekSaves` a changé
   (comparaison par référence pour objets/tableaux, par valeur pour les scalaires) **ou** si la
   liste des semaines a changé. Sans cette condition, chaque édition de semaine réécrirait aussi
   l'entrée projet et le chantier n'apporterait rien.

4. `projectName` nul (aucun projet) → supprimer l'entrée projet **et toutes** les clés de semaine,
   puis vider les caches.

5. Mettre à jour les caches **après** écriture réussie seulement (cf. §4.2).

**`removeItem`** : supprimer l'entrée projet et balayer toutes les clés `edt-project:week:*`.

**Exports** : ajouter un helper `weekStorageKey(week: number): string` et une fonction de balayage
`clearAllWeekKeys()`, tous deux exportés pour §4.4 et les tests.

### 4.2 Robustesse d'écriture

`localStorage.setItem` peut lever (quota, mode privé). Aujourd'hui `setItem` ne capture rien et
l'exception remonte dans `zustand/persist`.

Minimum exigé ici : **si l'écriture d'une semaine échoue, ne pas mettre à jour son entrée de
cache**, pour que la prochaine sauvegarde retente au lieu de considérer la semaine à jour. Sans ça,
une écriture ratée est perdue définitivement et silencieusement. Logguer l'échec.

Ne pas construire de mécanisme de reprise plus élaboré, ni de remontée UI : hors périmètre, à
traiter le jour où le quota devient réellement contraignant.

### 4.3 `legacyMigration.ts` — migration one-shot du monolithe

Ajouter `migrateProjectStorageToSplitKeys()`, sur le modèle de `migrateLegacyProjectStorage` :
best-effort, jamais bloquant, dans un `try/catch` global.

- Ne rien faire si `edt-project` est absent, ou si son `storageVersion` vaut déjà 2.
- Sinon : lire le monolithe, écrire une clé par semaine de `weekSaves`, réécrire l'entrée projet
  sans `weekSaves`, avec `weeks` et `storageVersion: 2`.
- **Écrire les semaines AVANT de réécrire l'entrée projet** : si l'opération est interrompue au
  milieu, on préfère des orphelins (inoffensifs, ignorés) à une entrée projet qui référence des
  semaines inexistantes.

⚠️ **Ordre d'exécution** : `useProjectStore.ts` appelle `migrateLegacyProjectStorage()` au chargement
du module, **avant** que le storage engine ne lise. La nouvelle migration doit s'exécuter
**juste après** celle-ci et avant toute lecture — la chaîne est `edt-scheduler` → `edt-project`
monolithe → clés découpées. Se tromper d'ordre casse la migration des utilisateurs venant du plus
ancien format.

### 4.4 Balayage aux transitions de projet

`lib/project/projectLifecycle.ts` : `createProject` et `closeProject` doivent balayer les clés de
semaine (`clearAllWeekKeys()`), sinon les semaines de l'ancien projet survivent en orphelines et
s'accumulent. Vérifier le chemin d'import de projet également : il remplace l'état complet, donc
même exigence.

Note : `setItem` avec `projectName` nul balaie déjà (§4.1.4), donc le balayage explicite est une
ceinture-bretelles pour les chemins qui ne passeraient pas par une écriture. Le vérifier plutôt que
le supposer, et le dire au checkpoint.

### 4.5 Ordre de travail
1. §4.1 + §4.2, avec les tests d'aller-retour (§6.2) — le moteur seul est testable en isolation.
2. §4.3 migration + son test.
3. §4.4 balayage.

## 5. CHECKPOINT feu-vert (obligatoire — s'arrêter ici)

Faire valider par Frédéric **avant** d'écrire le moindre test :

- diff complet ;
- `npm run typecheck --workspace=packages/scheduler-client` (attendu : propre) ;
- confirmation explicite que **`JSON.stringify` n'est jamais appelé sur une donnée inchangée** —
  montrer le chemin de décision de `setItem` ;
- confirmation que l'entrée projet n'est **pas** réécrite quand seule une semaine change ;
- l'ordre des deux migrations dans `useProjectStore.ts` (§4.3) ;
- le résultat de la vérification §4.4 (les chemins de transition de projet balaient-ils déjà ?).

## 6. Validation

Ce chantier ne doit **rien** changer au comportement observable. La validation vise donc
l'équivalence, plus une mesure du gain.

### 6.1 Non-régression automatisée
- `npm run test --workspace=packages/scheduler-client` (348 attendus avant). `projectFile.test.ts`
  et `useProjectStore.test.ts` couvrent déjà le stockage : ils **doivent passer sans être
  affaiblis**. S'ils échouent, c'est un signal, pas un test à ajuster — le rapporter.
- `npm run typecheck` racine, `npm run lint` (27 problèmes préexistants attendus),
  `npm run build --workspace=packages/scheduler-client`.

### 6.2 Tests ciblés à écrire
1. **Aller-retour d'identité** : un état complet → `setItem` → `getItem` → état identique à
   l'original (semaines comprises). C'est le test qui remplace l'invariant perdu du §1.3.
2. **Le format assemblé est bien un `ProjectFileV1`** : après `getItem`,
   `stateToProjectFile(état)` produit un objet que `isProjectFileV1` accepte.
3. **Écriture sélective** : modifier une seule semaine → seule sa clé est réécrite ; l'entrée
   projet et les autres semaines ne le sont pas. À vérifier en instrumentant `localStorage.setItem`
   (espion vitest), pas en comparant des contenus.
4. **Écriture sélective inverse** : modifier un champ projet (ex. `yearColorConfig`) → l'entrée
   projet est réécrite, aucune clé de semaine ne l'est.
5. **Suppression** : retirer une semaine de `weekSaves` → sa clé est supprimée et disparaît de
   `weeks`.
6. **Orphelin** : une clé `edt-project:week:99` absente de `weeks` est ignorée à la lecture et ne
   réapparaît pas dans l'état.
7. **Semaine illisible** : JSON corrompu sur une clé de semaine → cette semaine est perdue, le
   reste du projet charge normalement.
8. **Migration** : un `edt-project` monolithe (sans `storageVersion`) → après migration, une clé
   par semaine, entrée projet sans `weekSaves`, état chargé identique à l'état d'origine.
9. **Migration idempotente** : rejouée sur un stockage déjà en version 2 → aucun changement.
10. **Projet fermé** : `projectName` nul → entrée projet et toutes les clés de semaine supprimées.

### 6.3 Mesure du gain (obligatoire — c'est la raison d'être du chantier)
Protocole, sur le projet réel **ré-exporté** :

1. Dans la console du navigateur, instrumenter l'écriture :
   ```js
   const orig = localStorage.setItem.bind(localStorage);
   let total = 0;
   localStorage.setItem = (k, v) => { total += v.length; console.log(k, v.length); return orig(k, v); };
   ```
2. Faire **une** modification de préparation sur une semaine chargée (ajouter une zone bloquée,
   par exemple), et relever le nombre d'octets écrits.
3. Refaire la mesure sur `master` et sur la branche.

Rapporter les deux chiffres bruts. **Ne pas conclure** sur le facteur de gain : le relecteur le
fera.

### 6.4 Passe manuelle (courte)
1. Charger le projet réel → tout est là, toutes les semaines.
2. Modifier une semaine, changer de semaine, revenir → la modification est là.
3. Recharger la page → idem.
4. Exporter le projet en JSON et le comparer à un export fait depuis `master` avant le chantier :
   **contenu identique** (hors `exportedAt`).
5. Fermer le projet puis en créer un nouveau → aucune clé `edt-project:week:*` ne subsiste
   (le vérifier dans l'inspecteur).
6. Importer un fichier projet exporté avant le chantier → chargement normal.

## 7. Fichiers touchés (récapitulatif)

| Fichier | Nature |
|---|---|
| `lib/project/projectFile.ts` | §4.1 + §4.2 — le gros du chantier |
| `lib/project/legacyMigration.ts` | §4.3 migration one-shot |
| `store/useProjectStore.ts` | §4.3 ordre d'appel des migrations |
| `lib/project/projectLifecycle.ts` | §4.4 balayage si nécessaire |
| tests vitest | §6.1 existants + §6.2 nouveaux |

## 8. Ce que l'exécution rapporte

Écrire un **STATUT** en tête de ce document : faits bruts uniquement — diff conforme ou non au plan
et où il s'en écarte, compteurs de tests avant/après, les **deux chiffres bruts** de la mesure
§6.3, observations de §6.4 point par point. **Ne pas** écrire « vérifié », « validé », « corrigé »
ni conclure sur le gain : les conclusions sont écrites au retour par le relecteur.
