# Plan d'implémentation — modèle unifié de placements (étape 1/3 : les placements)

**Branche :** `refactor/unified-placements` — **à créer depuis master, ne pas travailler sur master.**
**Rôle :** conception validée (Opus/Frédéric) → exécution Sonnet.
**Statut :** IMPLÉMENTATION §4 + VALIDATION AUTOMATISÉE §6.1/§6.2 FAITES. §6.3 (passe manuelle sur projet réel) NON FAITE — nécessite le projet réel de Frédéric, hors de portée de cet exécutant. Feu vert donné par Frédéric pour poursuivre après le checkpoint §5. Non committé, sur branche `refactor/unified-placements`.

## STATUT (exécution Sonnet, 2026-07-21)

### Diff vs plan
- §4.1–§4.6 implémentés fichier par fichier comme listé en §7, plus 3 fichiers non listés au §7
  mais mécaniquement nécessaires (retrait des champs du store propagé) : `components/planning/calendar/ScheduleCalendar.tsx`
  (prop `solutions`→`placements`, `pendingEdit.isEnforced`→`origin==='pre-enforced'`, badge 📌),
  `lib/calendar/types.ts` (`CalendarEventExtProps`/`PendingEditData` : `isEnforced`/`isNeutralizedPlaced`/
  `courseKey` → `origin`/`taskId`), `store/README.md` (déjà dans la liste §7, fait).
- `store/slices/autonomyDistributionSlice.ts` : commentaire mis à jour (placedNeutralizedTasks → placements), aucun changement fonctionnel.

### `npm run typecheck --workspace=packages/scheduler-client`
Propre sur tout le code de production. Seul fichier en erreur : `__tests__/autonomyDistributionStore.test.ts`
(18 erreurs, toutes `activeSolution`/`placedNeutralizedTasks` inexistants) — attendu, réécriture
de ce test explicitement reportée après le checkpoint (§5 : "avant d'écrire le moindre test").

### `grep -rn "computeEffectiveSolution|taskOverrides|enforcedViolations|isNeutralizedPlaced|PlacedTaskOverride" packages/scheduler-client --exclude-dir={node_modules,.next,out}`
Zéro dans le code de production. Restes hors production, non touchés :
- `README.md` (racine du package, hors liste §7) : 2 mentions dans la doc d'archi, pas mises à jour.
- `store/README.md` : mis à jour (voir diff), zéro occurrence restante.
- `__tests__/autonomyDistributionStore.test.ts` : 1 occurrence (`taskOverrides: {}` dans un `setState` de test) — fichier reporté au post-checkpoint.

### Les 3 arbitrages nommés au §5, tranchés
1. **§4.2 — marquage des impositions propagées** : booléen `derived?: true` sur `Placement`
   (préférence du plan), ajouté au modèle §3 (non prévu explicitement dans le §3 original — extension mineure).
   `enforcedMapFromPlacements(placements, { excludeDerived? })` — sans l'option (défaut), inclut
   tout `pre-enforced` (manuel + dérivé) : utilisé par `runSchedule` pour le payload moteur, qui
   doit recevoir la même imposition augmentée qu'avant ce chantier (les enfants de groupe imposés
   par propagation doivent rester imposés côté moteur). Avec `excludeDerived: true` : utilisé par
   `_saveCurrentWeekSnapshot` pour reconstruire `manualEnforcedMap` (§1.2, jamais les propagés sur disque).
   **Point à trancher par le relecteur** : le texte du plan dit juste "le construire par
   enforcedMapFromPlacements(placements)" pour `runSchedule`, sans mentionner l'option — j'ai
   ajouté le paramètre car une lecture littérale (exclusion par défaut) aurait fait disparaître
   la propagation de groupe du payload moteur, ce qui m'a semblé être une régression fonctionnelle
   non voulue plutôt qu'un choix délibéré. À confirmer.
2. **§4.4 — conversion des morceaux d'Autonomie** : confirmé "tordu" comme le plan l'anticipait.
   Résolu en `placementId = \`${taskId}-piece-${i}\`` (synthétique) / `taskId = taskId du cours
   Autonomie réel` (résolvable via `courseById`) — un cas de fragmentation `placementId ≠ taskId`
   dès l'étape 1, alors que §3 règle 3 dit que l'étape 1 "ne produit que des placements où ils
   coïncident". Nécessaire : la fonctionnalité de répartition Autonomie existe déjà et produit
   plusieurs placements pour un même cours ; ce n'est pas une fragmentation introduite par ce
   chantier. `cancelAutonomyDistribution` filtre par `placementId` (via `pieceIds`), plus par un
   champ `sourceAutonomyId` (supprimé, n'existe plus sur `Placement`).
3. **§4.6 — signature de `filterSolutionsByQuery`** : ni l'un ni l'autre des deux choix proposés.
   `Placement.resources` a la forme `{teachers,groups,rooms}`, incompatible avec la contrainte
   générique de `filterSolutionsByQuery` (`resources: {id,type}[]`) — l'adapter aurait cassé son
   usage existant sur `TaskSolutionJSON[]`. Utilisé `matchesSearchQuery` (déjà générique sur
   `string[]`) directement au point d'appel dans `page.tsx` et `SidebarAnalysis.tsx`.
   `filterSolutionsByQuery` reste inchangé, désormais sans appelant dans le code de production
   (encore utilisée par `__tests__/calendarUtils.test.ts`).

### Arbitrages non nommés au §5, découverts pendant l'implémentation
4. **`confirmEnforce`/`removeEnforced`/drag/edit sur un placement `pre-enforced`** : le texte du
   plan dit "deviennent `updatePlacement`/`removePlacement`". Implémenté en gardant l'appel à
   `handleEnforceChange` (comme avant ce chantier) plutôt qu'en appelant les CRUD génériques du
   store, pour préserver le recalcul de propagation de groupe (`computeGroupEnforcements`), que
   `updatePlacement`/`removePlacement` ne font pas. `updatePlacement`/`addPlacement`/`removePlacement`
   ne sont donc utilisés en pratique que pour `auto`/`post-enforced` (+ un touch-up ciblé de
   `constraintViolation` après un drag d'un placement `pre-enforced`, seul champ qui ne repasse
   pas par `handleEnforceChange`).
5. **Badge "placé manuellement"** : la distinction fine de l'ancien code (`isAtOrigin`/diff avec
   la position d'origine) disparaît. Nouvelle règle unique : `post-enforced` affiche toujours le
   badge (même si repositionné exactement à sa position d'origine, ou si seules les ressources ont
   changé sans déplacement) ; `pre-enforced` ne l'affiche que sur violation. Conséquence directe de
   "une origine, pas de diff contre l'original" — à valider visuellement (§6.3).
6. **Titre des événements `auto`** : désormais construit sur le modèle `enforced` (enseignants
   joints par `, `) au lieu de `•` — léger changement de format visuel pour les tâches moteur.
7. **Tâches pré-neutralisées (`pre-neutral-<id>`) replacées sur le calendrier** :
   `handleReceiveNeutralizedTask` résout maintenant le vrai `course.id` en retirant le préfixe
   `pre-neutral-` (préfixe posé par notre propre code dans `runSchedule`, un seul point de
   construction — pas une dérivation positionnelle sur donnée externe). Nécessaire car
   `Placement.taskId` doit être résolvable via `courseById` (règle 1) ; l'ancien `PlacedNeutralizedTask`
   recopiait code/name/type directement et n'avait pas ce problème. Effet de bord probable :
   une tâche pré-neutralisée avec alternatives déclenchera maintenant le modal de sélection
   (ne le faisait pas avant, retombait toujours sur les ressources par défaut).
8. **Export iCal (`SidebarAnalysis`)** : passe maintenant par `placements` convertis
   (reflète les retouches manuelles). L'ancien code exportait `activeSolution` brut (les
   positions d'origine du moteur, jamais les `taskOverrides`) — écart pré-existant, probablement
   non intentionnel, corrigé de fait par l'unification plutôt que délibérément.
9. **`enforcedMap` (store field)** conservé tel quel (pas absorbé) : toujours lu par
   `components/planning/sidebar/SidebarPreparation.tsx` (badge "imposé" en mode préparation,
   hors périmètre §4.6) et par `runSchedule`. Le §3.1 du plan ne listait que sa restitution
   *rendue en événements* comme absorbée par `placements` — lecture confirmée compatible.

### Confirmation §5 — conteneurs étape 2 inchangés
`manuallyNeutralizedTasks`, `activeNeutralizedTasks`, `preNeutralizedKeys`, `autonomyDistributions`
(le conteneur lui-même — son contenu `pieceIds` référence maintenant des `placementId`) : signatures
et sémantique inchangées, non touchés au-delà des adaptations mécaniques ci-dessus.

## §6 — Validation (post feu-vert Frédéric, 2026-07-21)

### §6.1 Non-régression automatisée
- `npm run test --workspace=packages/scheduler-client` : **317 passés / 317** (302 avant ce
  chantier + 15 nouveaux dans `__tests__/placements.test.ts`). Aucun échec, aucun test retiré.
  - `__tests__/autonomyDistributionStore.test.ts` réécrit intégralement sur le nouveau modèle :
    `seedPlanning`/`placedTask` construisent des `Placement` (`origin`, `resources.{teachers,groups,rooms}`)
    au lieu de `activeSolution`/`taskOverrides`/`placedNeutralizedTasks` ; toutes les assertions
    portent désormais sur `placements`/`placementId`/`taskId` au lieu de `sourceAutonomyId`.
    6 tests, comportement testé inchangé (mêmes créneaux, mêmes invariants de durée/reste).
- `npm run typecheck` (racine, 4 workspaces) : propre.
- `npm run typecheck --workspace=packages/scheduler-client` : propre (0 erreur, y compris sur les
  tests — l'écart avec le §5 où seul `autonomyDistributionStore.test.ts` était en erreur est résorbé).
- `npm run lint --workspace=packages/scheduler-client` : **27 problèmes (7 erreurs, 20 warnings)**,
  contre 29 attendus. Écart de -2 : deux imports devenus inutiles par le refactor et nettoyés
  (`manuallyNeutralizedTasks` non lu dans `useCalendarCore.ts`, `ManuallyNeutralizedTask` non lu
  dans `usePlanningStore.ts`) — pas de nouveau warning introduit par le chantier.
- `npm run build --workspace=packages/scheduler-client` : succès (Next.js 16.2.0, 8 routes statiques,
  aucune erreur TypeScript pendant le build).

### §6.2 Tests ciblés `lib/calendar/placements.ts` (nouveau, `__tests__/placements.test.ts`, 15 tests)
1. `placementsFromSolution` : éclatement `resources` → `{teachers,groups,rooms}`, `placementId === taskId`, `origin: 'auto'`, cas vide.
2. `placementsFromEnforcedMap` → `enforcedMapFromPlacements` : identité aller-retour sur map non propagée (sans et avec `manualMap` identique).
3. Marquage `derived: true` des entrées propagées (absentes de `manualMap`).
4. `enforcedMapFromPlacements` : ignore `auto`/`post-enforced` dans tous les cas ; sans option inclut les `pre-enforced` propagés (payload moteur) ; `excludeDerived: true` les exclut (snapshot persisté).
5. `toTaskSolutionJSON` : durée du placement si présente, sinon celle du cours, et cas cours introuvable (ne jette pas, champs vides).
6. Règle de bascule d'origine sur le store (`updatePlacement`) : `auto`+patch position→`post-enforced` ; `pre-enforced`+même patch→reste `pre-enforced` ; patch `constraintViolation` seul→origine inchangée ; `post-enforced`+patch resources→reste `post-enforced`.

### §6.3 Passe manuelle sur projet réel — NON FAITE
Hors de portée de cet exécutant : nécessite le projet réel de Frédéric (RE-EXPORT préalable exigé
par le plan) et une session UI interactive sur ses données. Les 9 points du §6.3 (impositions
drag-and-drop, changement de semaine, planification, retouches, neutralisation/replacement,
Autonomie, réinitialisation, retour préparation, export iCal/Statistiques comparé à master) restent
à dérouler par Frédéric ou en session guidée. C'est le point de vigilance principal avant merge :
plusieurs arbitrages ci-dessus (badge manuellement-placé, titre des événements auto, tâches
pré-neutralisées avec alternatives, propagation de groupe dans le payload moteur) sont des
changements de comportement réels, pas seulement de représentation interne, et n'ont été vérifiés
que par construction/relecture, pas par observation.

### Non fait
- Root `README.md` (hors liste §7) non mis à jour.
- §6.3 (voir ci-dessus).

## Relecture (Opus, 2026-07-21) — §6.3 déroulée par Frédéric

Points 1, 3, 5 conformes. Deux anomalies remontées, de natures différentes.

### Point 2 — imposition ignorée pour un membre de groupe : PRÉEXISTANT, hors périmètre
Un cours imposé **et** membre d'un groupe de tâches est replacé ailleurs par le moteur, tout en
gardant le pin « imposé » côté client. Cause : `scheduler-core/src/taskGroupUnit.ts` —
`get isEnforced(): false` codé en dur, `bookEnforced()`/`getEnforcedResult()` lèvent (« Les groupes
ne sont jamais enforced (option C) »). Le membre imposé est enveloppé dans un `TaskGroupUnit`
jamais pré-booké. Aggravant : `Loader.validateEnforcedCourses` ne détecte pas la combinaison,
l'imposition est ignorée en silence. Frédéric l'avait déjà constaté avant ce chantier et juge le
comportement justifié (imposer un groupe n'apporte rien face à imposer chaque tâche) ; piste
retenue pour plus tard : **dissoudre automatiquement un groupe dont une tâche est imposée**.
Ne bloque pas ce chantier.

### Point 4 — placements multiples de la même tâche : RÉGRESSION de ce chantier, corrigée
Le préfixe `pre-neutral-` n'était retiré que d'un côté. `runSchedule` fabrique les entrées
synthétiques avec `taskId: pre-neutral-${course.id}` ; l'arbitrage n°7 fait que le placement créé
au dépôt porte le `course.id` réel. Trois comparaisons échouaient donc silencieusement :

1. `SidebarAnalysis.tsx` — filtre `unplacedNeutralized` : la carte restait dans la pioche après
   dépôt et pouvait être re-déposée indéfiniment (symptôme rapporté).
2. `SidebarAnalysis.tsx` — `hasItems` du draggable, même comparaison.
3. `useCalendarCore.ts` — retour d'un placement vers la pioche (`activeNeutralizedTasks.some(...)`),
   **non signalé par la passe manuelle** : en sens inverse, une pré-neutralisée retirée du
   calendrier était re-signalée dans la pioche alors qu'elle y réapparaissait déjà d'elle-même,
   soit deux cartes pour la même tâche.

N'affectait que les **pré-neutralisées** : les tâches neutralisées par le moteur portent le même id
des deux côtés, d'où le passage au travers de la relecture de diff.

Correctif : `PRE_NEUTRAL_PREFIX`, `realTaskId` et une fonction pure `selectUnplacedNeutralized`
déplacés/ajoutés dans `lib/taskCardUtils.ts` (le helper vivait en local dans `useCalendarCore.ts`),
utilisés aux trois sites. Nouveau test `__tests__/unplacedNeutralized.test.ts` (7 cas) couvrant
explicitement le cas préfixé, pour que la classe de défaut redevienne détectable.
Après correctif : **324/324 tests** (317 + 7), typecheck propre, lint inchangé (27 problèmes).
Ces trois sites disparaîtront à l'étape 2 avec la convention de préfixe.

### Session
Reprise après feu vert de Frédéric ("C'est bon tu peux poursuivre"). §4 (implémentation) et §6.1/§6.2
(validation automatisée) faits dans cette reprise. Rien n'a été committé (travail dans l'arbre de
travail sur `refactor/unified-placements`).
**Prérequis livrés :** `refactor/single-solution` (0abeb7f), `refactor/stable-task-ids` (5c6e91a).
Ce plan **dépend** des identifiants stables : un placement référence une tâche par `course.id`.

## 1. Objectif

Unifier préparation et solution en **une seule liste de placements**. Un placement, c'est
« une tâche + un créneau + un combo de ressources exact », quelle que soit son origine.

Le modèle est déjà présent dans le code, éclaté par accident — trois structures identiques modulo
le nommage :

```
EnforcedData          { startTime, teacher[],  groups[], rooms[] }                      persisté
PlacedTaskOverride    { startTime, teachers[], groups[], rooms[], duration?, violation? } session
PlacedNeutralizedTask { startTime, teachers[], groups[], rooms[], duration,  violation?, + code/name/type }
```

Et la même imposition est **rendue par deux chemins selon le mode** :
`useCalendarCore.ts` l.618 et l.705 font `activeSolution.length === 0 ? enforcedEventsState : []`.
Sans solution, l'imposition est un événement dérivé de `enforcedMap` ; avec solution, c'est une
tâche de `activeSolution`. Deux formes d'événement, deux chemins d'édition
(`confirmEnforce`/`removeEnforced` d'un côté, `setTaskOverride` de l'autre), départagés par un test
de mode. C'est ce que ce chantier supprime.

Gain principal : `computeEffectiveSolution` — les 40 lignes qui aplatissent quatre calques et
alimentent calendrier, export iCal, statistiques et calcul d'occupation Autonomie — **devient la
liste elle-même**. Plus de dérivation.

### 1.1 Découpage en trois chantiers

Trop gros pour une seule branche. Découpage par concern, chaque étape laissant l'application
fonctionnelle et mergeable seule :

| Étape | Périmètre | Conteneurs absorbés |
|---|---|---|
| **1 (ce plan)** | Les **placements** | `activeSolution`, `taskOverrides`, `placedNeutralizedTasks`, `enforcedMap` rendu en événements, `enforcedViolations` |
| 2 (plan séparé) | Les **non-placés** (3 origines) | `manuallyNeutralizedTasks`, `activeNeutralizedTasks`, `preNeutralizedKeys`, `autonomyDistributions` |
| 3 (plan séparé) | **Promotion** post-enforced → pre-enforced sur demande (liste à cocher) | — |

Puis la **persistance** des placements dans le Projet, qui devient quasi triviale une fois le
modèle unifié : un tableau à sauver et à relire.

### 1.2 Décision de périmètre : le format persisté ne bouge pas

`weekSaves[w].manualEnforcedMap` et `preNeutralizedKeys` **restent tels quels sur le disque**.
Le store convertit à la lecture (`setSelectedWeek`) et à l'écriture (`_saveCurrentWeekSnapshot`).

Raison : changer le format persisté impose une migration de `PreparedWeekSnapshot` et un bump de
`ProjectFileV1`, ce qui doublerait la surface à valider d'un chantier déjà large. La conversion est
**transitoire et assumée** — le chantier « persistance » la supprimera en faisant de `placements`
le format de disque. C'est le seul endroit où l'on accepte sciemment de garder deux formes.

## 2. Non-objectifs (ne pas toucher à ce stade)

- **NE PAS** traiter les non-placés : `manuallyNeutralizedTasks`, `activeNeutralizedTasks`,
  `syntheticNeutralizedTasks`, `preNeutralizedKeys`, `autonomyDistributions` restent **tels quels**
  et continuent de fonctionner. `computeEffectiveSolution` lisait `manuallyNeutralizedTasks` pour
  filtrer : ce filtre reste, il lira le même conteneur.
- **NE PAS** implémenter la promotion post-enforced → pre-enforced (étape 3). Au re-run, le
  comportement actuel est conservé : la nouvelle solution écrase les placements `auto` et
  `post-enforced`, les `pre-enforced` survivent (ils viennent de la préparation).
- **NE PAS** changer le format persisté (§1.2), ni `ProjectFileV1`, ni `PreparedWeekSnapshot`.
- **NE PAS** modifier `scheduler-core`, `scheduler-common`, `scheduler-api`.
- **NE PAS** changer la politique d'invalidation : modifier un placement `pre-enforced` continue
  d'invalider la solution ; déplacer un `auto`/`post-enforced` ne l'invalide pas.

## 3. Le modèle cible

Dans `store/types.ts` :

```ts
/** Origine d'un placement — d'où vient la décision de poser cette tâche là. */
export type PlacementOrigin =
  | 'pre-enforced'   // posé à la main AVANT toute planification auto ; transmis au moteur
  | 'auto'           // posé par le moteur
  | 'post-enforced'; // retouche manuelle d'un placement auto

export interface Placement {
  /**
   * Identité du placement. Égale à `taskId` dans le cas courant (un placement par tâche) ;
   * distincte pour les fragments d'une même tâche (Autonomie répartie, étape 2).
   */
  placementId: string;
  /** Tâche placée — c'est `CourseTaskDataWithId.id` (cf. docs/PlanStableTaskIds.md). */
  taskId: string;
  /** Minutes depuis lundi minuit. */
  startTime: number;
  /** Durée effective si elle diffère de celle du cours (retouche manuelle, fragment). */
  duration?: number;
  /** Combo exact appliqué, sans alternatives. */
  resources: { teachers: string[]; groups: string[]; rooms: string[] };
  origin: PlacementOrigin;
  /** Violation détectée au moment du placement. */
  constraintViolation?: 'red' | 'orange' | 'none';
}
```

Trois règles qui découlent du modèle, à respecter partout :

1. **Un placement référence une tâche, il ne la recopie pas.** `code`, `name`, `type`, `level`, et
   la durée par défaut se résolvent via `courseById.get(placement.taskId)`. C'est ce que fait déjà
   `enforcedEventsState` (`useCalendarCore.ts` l.83-110) — prendre ce bloc comme modèle.
2. **Une seule représentation des ressources** : `{ teachers, groups, rooms }`. La conversion vers
   `{ id, type }[]` n'existe plus qu'aux frontières (payload API, export iCal, statistiques).
3. **`placementId` ≠ `taskId` est le cas général**, même si l'étape 1 ne produit que des placements
   où ils coïncident. Ne jamais indexer les placements par `taskId` dans une Map — l'étape 2
   introduira les fragments.

### 3.1 Ce que devient chaque conteneur actuel

| Aujourd'hui | Demain |
|---|---|
| `enforcedMap` (rendu en événements) | placements `origin: 'pre-enforced'` |
| `activeSolution` (tâches du moteur) | placements `origin: 'auto'` |
| `taskOverrides` | **disparaît** — déplacer un `auto` le mute sur place et bascule son `origin` en `post-enforced` |
| `placedNeutralizedTasks` | placements `origin: 'post-enforced'` |
| `enforcedViolations` | **disparaît** — `constraintViolation` vit sur le placement |
| `scheduleResult` | **reste** : instantané moteur immuable, source de « ↺ Réinitialiser » et des diagnostics |

`scheduleResult` n'est plus lu pour l'affichage, seulement pour reconstruire `placements` (reset)
et pour les diagnostics des non-placés (étape 2).

## 4. Changements de code

Tout est dans `packages/scheduler-client`.

### 4.1 `store/types.ts` — le modèle

Ajouter `PlacementOrigin` et `Placement` (§3). Supprimer `PlacedTaskOverride`. **Conserver**
`PlacedNeutralizedTask`, `ManuallyNeutralizedTask` et `AutonomyDistribution` : l'étape 2 les
traitera, et `PlacedNeutralizedTask` reste temporairement le type d'entrée des handlers de drop
avant conversion en `Placement`.

### 4.2 `lib/calendar/placements.ts` — nouveau module de conversion

Fonctions pures, testables sans React ni store :

- `placementsFromSolution(tasks: TaskSolutionJSON[]): Placement[]` — chaque tâche moteur devient un
  placement `auto`. `placementId = taskId`. Les `resources: {id,type}[]` du moteur sont éclatées en
  `{teachers, groups, rooms}`.
- `placementsFromEnforcedMap(map: Record<string, EnforcedData>): Placement[]` — chaque entrée
  devient un placement `pre-enforced`. **Prend la map augmentée** (manuelle + propagation de
  groupe), pas `manualEnforcedMap` : c'est ce que le calendrier affiche aujourd'hui.
- `enforcedMapFromPlacements(placements: Placement[]): Record<string, EnforcedData>` — inverse,
  restreint aux `pre-enforced`, clé = `taskId`. Sert à alimenter la sauvegarde de semaine (§1.2) et
  le payload moteur.
- `toTaskSolutionJSON(placement, course, week): TaskSolutionJSON` — conversion de frontière pour
  l'export iCal et les statistiques, qui consomment `TaskSolutionJSON[]`.

⚠️ `enforcedMapFromPlacements` doit produire **`manualEnforcedMap`**, donc exclure les impositions
issues de la propagation de groupe. Deux options, à trancher et à signaler au checkpoint :
marquer les placements propagés d'un booléen `derived?: true` non persisté, ou recalculer la
propagation à la sauvegarde pour soustraire. **Préférence : le booléen** — recalculer suppose que
`computeGroupEnforcements` est parfaitement inversible, ce qui n'est pas garanti si les groupes ont
changé entre-temps.

### 4.3 `lib/calendar/effectiveSolution.ts` — suppression

`computeEffectiveSolution` disparaît : la liste des placements **est** l'emploi du temps. Ses trois
appelants (`app/planning/page.tsx`, `store/usePlanningStore.ts` dans `distributeAutonomy`,
et le calcul d'occupation) lisent désormais `placements` directement.

Le filtre sur `manuallyNeutralizedTasks` qu'elle appliquait **doit être préservé** : une tâche
glissée dans la pioche ne doit pas rester sur le calendrier. À l'étape 1, retirer le placement de
la liste au moment où la tâche part dans la pioche (`addManuallyNeutralizedTask`) plutôt que de
filtrer à la lecture — c'est plus simple et c'est déjà la sémantique voulue.

Supprimer aussi `__tests__/` la couvrant s'il en existe, et reporter la couverture sur le nouveau
module (§5.2).

### 4.4 `store/usePlanningStore.ts` — la liste unique

**Interface :** remplacer `activeSolution`, `taskOverrides`, `placedNeutralizedTasks`,
`enforcedViolations` par :

```ts
  /** Emploi du temps courant de la semaine — toutes origines confondues. */
  placements: Placement[];
  /** Déplace/édite un placement. Un `auto` déplacé bascule en `post-enforced`. */
  updatePlacement: (placementId: string, patch: Partial<Omit<Placement, 'placementId' | 'taskId'>>) => void;
  addPlacement: (placement: Placement) => void;
  removePlacement: (placementId: string) => void;
```

`updatePlacement` porte la règle de bascule d'origine : si le placement visé a `origin: 'auto'` et
que le patch touche `startTime`, `duration` ou `resources`, l'origine devient `post-enforced`.
Un `pre-enforced` reste `pre-enforced`. Écrire cette règle **dans le store**, jamais chez les
appelants.

**`applyPendingResult`** : `placements: placementsFromSolution(best.tasks)`. Les tâches imposées
étant renvoyées placées par le moteur, elles arrivent avec `origin: 'auto'` — les **repasser en
`pre-enforced`** pour tout `taskId` présent dans la map d'impositions courante, sinon l'origine se
perd à chaque planification.

**`setSelectedWeek`** : à la restauration d'un snapshot, `placements =
placementsFromEnforcedMap(restoredEnforcedMap)` (la map augmentée, déjà calculée dans cette
fonction). Branche sans snapshot : `placements: []`.

**`handleEnforceChange`** : continue de recevoir la map manuelle et de recalculer la propagation ;
recalcule ensuite les placements `pre-enforced` **en préservant** les `auto`/`post-enforced` s'il y
en a — non, plus simple et conforme au comportement actuel : cette action invalide déjà la solution
(`scheduleResult: null`), donc elle **remplace** toute la liste par les seuls `pre-enforced`.

**`resetCurrentSolution`** : `placements = placementsFromSolution(scheduleResult.solution.tasks)`
avec le même repassage en `pre-enforced` que `applyPendingResult`. C'est exactement le comportement
attendu du bouton « ↺ Réinitialiser ».

**`runSchedule`** : le payload continue de recevoir `enforcedMap` — le construire par
`enforcedMapFromPlacements(placements)` plutôt que de lire `enforcedMap` du store. Conserver
`keptEnforced` (restriction aux cours non pré-neutralisés) pour `filterResourcesForCourses` : c'est
un correctif récent, ne pas le perdre.

**`_saveCurrentWeekSnapshot`** : `manualEnforcedMap: enforcedMapFromPlacements(placements)`
(§4.2, sans les propagés). Le `subscribe` d'auto-save doit désormais déclencher aussi sur un
changement de `placements` — **mais seulement si les `pre-enforced` ont changé**, sinon chaque
déplacement d'une tâche auto réécrirait tout le projet en localStorage. Comparer les
`pre-enforced` avant/après, pas la liste entière.

**`distributeAutonomy`** : remplace son appel à `computeEffectiveSolution` par une lecture directe
de `placements` pour construire l'`occupancy`. Le reste (`computeAutonomyDistribution`, création
des morceaux) est inchangé à l'étape 1 — les morceaux restent des `PlacedNeutralizedTask` ajoutés
via `addPlacement` converti. Signaler au checkpoint si la conversion s'avère tordue : c'est
l'indice que ce point appartient à l'étape 2.

### 4.5 `hooks/useCalendarCore.ts` — un seul rendu, un seul éditeur

C'est le fichier le plus lourd (750 lignes) et le cœur du chantier.

- **`enforcedEventsState`** : n'est plus une source séparée. La construction d'événement qu'il
  contient (résolution du cours, titre, couleurs, durée) devient la fonction **unique** de
  construction d'événement pour **tous** les placements, quelle que soit l'origine.
- **Supprimer les tests de mode** `activeSolution.length === 0 ? enforcedEventsState : []`
  (l.618 et l.705). Une seule liste rendue, toujours.
- **`extendedProps`** : remplacer les booléens `isEnforced` / `isNeutralizedPlaced` par
  `origin: PlacementOrigin` + `placementId`. Tous les handlers qui branchaient dessus (l.200, 397,
  407, 437, 474, 476, 486, 506) branchent désormais sur `origin`. `isBlockedZone` reste inchangé :
  une zone bloquée n'est pas un placement.
- **`confirmEnforce` / `removeEnforced`** : deviennent `updatePlacement` / `removePlacement` sur un
  placement `pre-enforced`. La mise à jour de `manualEnforcedMap` passe par le store (§4.4).
- **`handleEventDrop`** : un seul chemin. Calculer la violation, appeler `updatePlacement` — la
  bascule d'origine est faite par le store.
- **`handleReceiveNeutralizedTask`** : `addPlacement({ …, origin: 'post-enforced' })`.
  La résolution du cours reste `courseById.get(taskId)` (acquis du chantier précédent).
- **`pendingEdit`** : le branchement à trois voies (`isEnforced` / `isNeutralizedPlaced` / sinon
  override) devient un unique `updatePlacement`.

### 4.6 Consommateurs

- **`app/planning/page.tsx`** : `effectiveSolution` disparaît. `filteredSolutions` filtre
  `placements`. `StatisticsDialog` reçoit les placements convertis en `TaskSolutionJSON[]` via
  `toTaskSolutionJSON` (ne pas changer sa signature à ce stade).
- **`components/planning/sidebar/SidebarAnalysis.tsx`** : `filteredPlacedNeutralized` disparaît —
  l'export iCal prend les placements convertis. Le reste du fichier (pioche, diagnostics) est du
  ressort de l'étape 2 : **ne pas y toucher**.
- **`lib/calendar/calendarUtils.ts`** : `filterSolutionsByQuery` est générique sur
  `{code, name, type, resources}`. Les placements n'ont ni `code` ni `name` (résolus depuis le
  cours) : lui passer les placements **enrichis** au point d'appel, ou ajouter une variante qui
  prend `(placements, courseById)`. Trancher et signaler au checkpoint.

### 4.7 Ordre de travail

1. §4.1 + §4.2 + tests du module de conversion (§5.2) — pur, sans dépendance.
2. §4.4 (store), en gardant l'application cassée le moins longtemps possible.
3. §4.5 (calendrier), puis §4.6 (consommateurs).
4. `npm run typecheck --workspace=packages/scheduler-client` en continu : le retrait des champs du
   store fait remonter mécaniquement chaque site à traiter.

## 5. CHECKPOINT feu-vert (obligatoire — s'arrêter ici)

Faire valider par Frédéric **avant** d'écrire le moindre test :

- diff complet ;
- `npm run typecheck --workspace=packages/scheduler-client` (attendu : propre) ;
- `grep -rn "computeEffectiveSolution\|taskOverrides\|enforcedViolations\|isNeutralizedPlaced\|PlacedTaskOverride" packages/scheduler-client --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out`
  (attendu : zéro) ;
- les trois arbitrages laissés ouverts : marquage des impositions propagées (§4.2), conversion des
  morceaux d'Autonomie (§4.4), signature de `filterSolutionsByQuery` (§4.6) ;
- confirmation que `manuallyNeutralizedTasks`, `activeNeutralizedTasks`, `preNeutralizedKeys` et
  `autonomyDistributions` sont **inchangés** (périmètre étape 2).

## 6. Validation (dimensionnée à ce que le changement peut affecter)

Le changement ne touche ni le moteur ni le format persisté : il réécrit la représentation en
session de l'emploi du temps et son rendu. La validation porte donc sur l'**équivalence
fonctionnelle de l'UI de planification**.

### 6.1 Non-régression automatisée
- `npm run test --workspace=packages/scheduler-client` (302 attendus avant). Les tests de
  `computeEffectiveSolution` et `autonomyDistributionStore` **vont devoir changer** : ils portent
  sur des conteneurs supprimés. Les réécrire sur le nouveau modèle, à comportement constant —
  ne pas affaiblir une assertion pour la faire passer. Rapporter les compteurs avant/après et la
  liste des tests réécrits.
- `npm run typecheck` racine et `npm run lint --workspace=packages/scheduler-client`
  (29 problèmes préexistants attendus).
- `npm run build --workspace=packages/scheduler-client`.

### 6.2 Tests ciblés à écrire (nouveaux, sur `lib/calendar/placements.ts`)
Module pur, donc entièrement testable :
1. `placementsFromSolution` : éclatement correct de `resources: {id,type}[]` en
   `{teachers, groups, rooms}`, `placementId === taskId`, `origin: 'auto'`.
2. `placementsFromEnforcedMap` → `enforcedMapFromPlacements` : aller-retour **identité** sur une map
   d'impositions non propagées.
3. `enforcedMapFromPlacements` ignore `auto` et `post-enforced`, et ignore les propagés (§4.2).
4. `toTaskSolutionJSON` : `duration` du placement si présente, sinon celle du cours.
5. Règle de bascule d'origine (sur le store) : `auto` + patch de `startTime` → `post-enforced` ;
   `pre-enforced` + même patch → reste `pre-enforced` ; patch qui ne touche que
   `constraintViolation` → origine inchangée.

### 6.3 Passe manuelle sur projet réel (obligatoire)
**RE-EXPORTER d'abord le projet réel.** Sur une semaine chargée, avec des impositions et au moins
un groupe de tâches :
1. **En préparation, sans solution** : imposer un cours par glisser-déposer → il apparaît sur le
   calendrier ; le déplacer ; le supprimer. Vérifier la propagation aux membres du groupe.
2. Changer de semaine et revenir : les impositions sont restaurées à l'identique (c'est le
   aller-retour de conversion §1.2 qui est testé ici — le point le plus à risque).
3. **Planifier.** Les impositions restent à leur place et restent identifiées comme telles
   (elles ne doivent pas devenir de simples tâches auto).
4. Déplacer une tâche auto → elle devient une retouche ; la déplacer à nouveau ; l'éditer
   (ressources, durée).
5. Neutraliser une tâche placée (pioche) puis la replacer sur le calendrier.
6. Répartir une Autonomie, puis annuler la répartition.
7. « ↺ Réinitialiser » : retour à l'état moteur, **impositions comprises et toujours marquées
   comme impositions**.
8. « ← Retour à la préparation » puis re-planifier : les impositions survivent, les retouches non
   (comportement actuel, cf. §2).
9. Export iCal et dialogue Statistiques : contenu identique à celui d'avant le chantier — le
   comparer réellement, sur la même semaine, avec un export fait depuis `master`.

Rapporter chaque point comme observé, y compris ce qui diffère de l'attendu.

## 7. Fichiers touchés (récapitulatif)

| Fichier | Nature |
|---|---|
| `store/types.ts` | §4.1 modèle, suppression de `PlacedTaskOverride` |
| `lib/calendar/placements.ts` | §4.2 **nouveau** — conversions pures |
| `lib/calendar/effectiveSolution.ts` | §4.3 **supprimé** |
| `store/usePlanningStore.ts` | §4.4 liste unique, règle de bascule, auto-save |
| `hooks/useCalendarCore.ts` | §4.5 rendu et édition uniques |
| `app/planning/page.tsx` | §4.6 |
| `components/planning/sidebar/SidebarAnalysis.tsx` | §4.6 export iCal uniquement |
| `lib/calendar/calendarUtils.ts` | §4.6 selon l'arbitrage retenu |
| `store/README.md` | mise à jour de la section « Résultat de planification » |
| tests vitest | §6.1 réécritures + §6.2 nouveaux |

## 8. Ce que l'exécution rapporte

Écrire un **STATUT** en tête de ce document à la fin : faits bruts uniquement — diff conforme ou
non au plan et où il s'en écarte, compteurs de tests avant/après, liste des tests réécrits et
pourquoi, sorties de grep, arbitrages retenus sur les trois points ouverts, observations de la
passe manuelle point par point. **Ne pas** écrire « vérifié », « validé », « corrigé » ni attribuer
un gain : les conclusions sont écrites au retour par le relecteur (Opus, Fable ou Frédéric).
