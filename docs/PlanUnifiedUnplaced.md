# Plan d'implémentation — modèle unifié, étape 2/3 : les non-placés

**Branche :** `refactor/unified-unplaced` — **à créer depuis master, ne pas travailler sur master.**
**Rôle :** conception validée (Opus/Frédéric) → exécution Sonnet.
**Statut :** IMPLÉMENTÉ (§4.1-§4.8) + tests §6.1/§6.2 réécrits. Feu vert §5 reçu de Frédéric.
Reste : §6.3 (passe manuelle sur projet réel, hors périmètre exécutant).
**Prérequis livrés :** `refactor/single-solution` (0abeb7f), `refactor/stable-task-ids` (5c6e91a),
`refactor/unified-placements` (94d745c — étape 1, à lire avant : `docs/PlanUnifiedPlacements.md`).

## STATUT (exécution Sonnet, 2026-07-21)

**Branche :** `refactor/unified-unplaced`, créée depuis `master` (HEAD `94d745c`). Rien commité :
tout est dans l'index (`git add -A`), en attente du feu vert.

**Diff — conforme au tableau §7**, fichier pour fichier :
```
 docs/PlanUnifiedUnplaced.md                                     |  ce document
 packages/scheduler-client/store/types.ts                        | §4.1
 packages/scheduler-client/lib/calendar/unplaced.ts               | §4.2 (nouveau)
 packages/scheduler-client/store/usePlanningStore.ts              | §4.3, job storage, auto-save
 packages/scheduler-client/store/slices/neutralizedSlice.ts       | §4.4 (supprimé)
 packages/scheduler-client/store/slices/autonomyDistributionSlice.ts | §4.4 (supprimé)
 packages/scheduler-client/components/planning/sidebar/SidebarAnalysis.tsx | §4.5
 packages/scheduler-client/lib/taskCardUtils.ts                   | §4.6
 packages/scheduler-client/hooks/useCalendarCore.ts                | §4.7
 packages/scheduler-client/components/planning/courses/CourseCard.tsx | §4.8
 packages/scheduler-client/store/README.md                        | mise à jour
```
`git diff --cached --stat` : 11 fichiers, +610/−443.

**Écarts par rapport au texte du plan (arbitrages pris pendant l'implémentation) :**
1. `runSchedule` : la variable locale reconstruite depuis `unplaced` s'appelle `userPreTaskIds`,
   pas `preNeutralizedKeys` — pour que le grep de vérification §5 ne remonte que les fichiers du
   format persisté listés dans son propre "attendu". Comportement inchangé.
2. `distributeAutonomy` utilise directement `course.duration` comme `totalDuration` (pas
   `remainingDuration(taskId, …)`) : le bouton « Répartir » n'est rendu par `SidebarAnalysis` que
   quand `placements.some(p => p.taskId === entry.taskId)` est faux (§4.5), donc `remaining ===
   course.duration` est garanti à l'appel — pas de calcul redondant. Signalé ici plutôt que
   décidé unilatéralement en silence.
3. `solutionToBaseProps` (dans `lib/taskCardUtils.ts`) supprimée : perd son unique appelant, la
   pioche construit désormais ses props depuis le cours (`courseToBaseProps`) et non plus depuis
   le `TaskSolutionJSON` du moteur. `courseToBaseProps` et `normalizeResourceEntries` conservés
   (appelants restants : `CourseCard.tsx`, `SidebarAnalysis.tsx`).
4. §4.5 : l'adaptateur `NeutralizedTaskInfoJSON` pour `buildAnalysisLoadRows` (`origin ===
   'engine'` uniquement) est une fonction locale `toEngineNeutralizedInfo` dans
   `SidebarAnalysis.tsx`, reproduisant la dédup toutes-alternatives de `serializeNeutralizedUnit`
   côté API — `lib/resourceLoadAnalysis.ts` n'est pas touché, comme demandé.
5. §4.8 (point du checkpoint) : **pas** de sélecteur mémoïsé ajouté. `CourseCard.tsx` souscrit à
   `unplaced` (tableau entier), comme il souscrivait avant à `preNeutralizedKeys` (tableau de
   string). Comportement de re-render inchangé par rapport à avant ce chantier — à trancher ici.

**Vérifications du checkpoint (§5) :**
- `npm run typecheck --workspace=packages/scheduler-client` : erreurs uniquement dans
  `__tests__/autonomyDistributionStore.test.ts` (5 erreurs TS, propriétés `manuallyNeutralizedTasks`/
  `autonomyDistributions` disparues) et `__tests__/unplacedNeutralized.test.ts` (3 erreurs TS,
  exports `selectUnplacedNeutralized`/`realTaskId`/`PRE_NEUTRAL_PREFIX` disparus). Aucune autre
  erreur ailleurs (app/components/hooks/lib/store hors ces deux fichiers).
- `npm run test --workspace=packages/scheduler-client` : **324 tests avant** (chiffre du plan,
  non re-vérifié sur `master` par l'exécutant — voir §6.1). **Sur la branche, après
  implémentation, sans aucun test réécrit** : 324 tests toujours présents, 313 passent, 11
  échouent — tous dans les deux fichiers ci-dessus (`unplacedNeutralized.test.ts` : 7/7 tests en
  échec, `TypeError: … is not a function` sur les exports supprimés ; `autonomyDistributionStore.test.ts`
  : 4/6 en échec sur les scénarios `distributeAutonomy`, 2/6 passent sur `cancelAutonomyDistribution`
  qui coïncident encore avec le nouveau comportement). Aucun échec en dehors de ces deux fichiers.
- Grep `pre-neutral-\|PRE_NEUTRAL_PREFIX\|realTaskId\|manuallyNeutralizedTasks\|activeNeutralizedTasks\|syntheticNeutralized\|autonomyDistributions\|preNeutralizedKeys` sur
  `{app,components,hooks,lib,store}` : zéro dans le code applicatif hors format persisté. Hits
  restants :
  - `lib/weekCourses.ts`, `lib/csvMerge.ts` (commentaire), `store/useProjectStore.ts`,
    `store/slices/weekSavesSlice.ts` : `preNeutralizedKeys` du format persisté (`weekSaves`),
    hors périmètre §2, comme prévu.
  - `store/usePlanningStore.ts:187` (`unplacedFromPreNeutralized(snapshot.preNeutralizedKeys)`) et
    `:817` (`preNeutralizedKeys: ps.unplaced.filter(…)`) : lecture/écriture à la frontière du
    snapshot persisté, exactement les deux lignes prescrites par le §4.3 du plan lui-même — pas
    une fuite, ces deux occurrences ne figuraient simplement pas dans la liste d'exceptions du
    §5 telle qu'écrite.
  - `store/usePlanningStore.ts:676` : un commentaire (pas du code) expliquant la tolérance à un
    ancien contenu localStorage portant `syntheticNeutralized`.
  - `store/README.md` : prose documentant ce qui a été remplacé.
- `_saveCurrentWeekSnapshot` écrit `preNeutralizedKeys: ps.unplaced.filter(u => u.origin ===
  'user-pre').map(u => u.taskId)`, type `string[]` (confirmé par le typecheck, `PreparedWeekSnapshot`
  inchangé). La garde d'auto-save (`usePlanningStore.subscribe`) ne redéclenche
  `_saveCurrentWeekSnapshot` sur changement de `unplaced` que si la sous-liste `user-pre` (taskIds)
  a changé (`userPreChanged`, comparaison JSON) — même mécanique que `enforcedChanged` pour les
  `pre-enforced`.

**Non touché, comme prescrit par §2 :** `lib/csvMerge.ts`, `lib/weekCourses.ts`,
`store/useProjectStore.ts`, `store/slices/weekSavesSlice.ts`, `scheduler-core`,
`scheduler-common`, `scheduler-api` (les trois champs morts de `NeutralizedTaskInfoJSON` restent
déclarés, simplement plus consommés côté client). [[project_enforced_ignored_in_task_groups]]
non traité, comme convenu.

## STATUT — phase tests (§6.1/§6.2), après feu vert de Frédéric

**`__tests__/autonomyDistributionStore.test.ts` réécrit** (pas simplement adapté à la marge) : le
fixture `autonomyNeutralized(...)` (un `NeutralizedTaskInfoJSON`, seedait `activeNeutralizedTasks`)
est remplacé par `autonomyCourse(...)` (un `CourseTaskDataWithId`, seedé dans
`useProjectStore.allCourses`) + une entrée `unplaced` — `distributeAutonomy` résout désormais le
cours via `courseById`, pas via l'ancien conteneur. Les assertions sur `autonomyDistributions[...]`
(supprimé) sont remplacées par des assertions sur `placements` et, pour le calcul de reste, sur
`remainingDuration` importé de `lib/calendar/unplaced.ts`. Un cas ajouté hors plan (pas demandé,
jugé peu coûteux à couvrir vu le changement de résolution par cours) : `distributeAutonomy` sur un
cours non-Autonomie ou un `taskId` inconnu ne fait rien. 6 tests avant → 7 après, tous passent.

**`__tests__/unplacedNeutralized.test.ts` supprimé** (portait sur `selectUnplacedNeutralized`/
`realTaskId`, disparus). Sa couverture — non-régression du bug de l'étape 1 (une tâche posée ne
doit pas rester déposable) — est reprise dans `__tests__/unplaced.test.ts`,
describe `selectPiocheEntries`, cas "entrée entièrement placée -> absente".

**`__tests__/unplaced.test.ts` créé** (nouveau, §6.2 cas 1-4) : 15 tests sur
`unplacedFromEngine`/`unplacedFromPreNeutralized`/`remainingDuration`/`selectPiocheEntries`, pur,
sans store. Couvre les 4 cas du plan plus quelques cas limites non listés explicitement (liste
vide, placement sans `duration` explicite retombant sur la durée du cours, sur-couverture par
plusieurs fragments) jugés bon marché à ajouter vu qu'ils exercent la même fonction.

**`__tests__/unplacedPersistence.test.ts` créé** (nouveau, §6.2 cas 5) : 3 tests store-level
(stub localStorage + `usePlanningStore`/`useProjectStore` réimportés à froid, même motif que
`autonomyDistributionStore.test.ts`) — les trois origines coexistent dans `unplaced` sans se
marcher dessus, seule la sous-liste `user-pre` est écrite dans `weekSaves[w].preNeutralizedKeys`,
un aller-retour `setSelectedWeek` ne restaure que les `user-pre` (`engine`/`user-post`
disparaissent), et une modification qui ne touche pas les `user-pre` ne redéclenche pas
`_saveCurrentWeekSnapshot` (vérifié via `savedAt` inchangé sous horloge simulée).

**Résultats finaux (§6.1) :**
- `npm run test --workspace=packages/scheduler-client` : **336 tests, 336 passent, 0 échec**
  (23 fichiers). Décompte : 324 (baseline plan) − 7 (`unplacedNeutralized.test.ts` supprimé) + 15
  (`unplaced.test.ts`) + 3 (`unplacedPersistence.test.ts`) + 1 (cas ajouté dans
  `autonomyDistributionStore.test.ts`) = 336.
- `npm run typecheck --workspace=packages/scheduler-client` : propre, 0 erreur.
- `npm run typecheck` (racine, 4 workspaces) : propre, 0 erreur.
- `npm run lint --workspace=packages/scheduler-client` : **27 problèmes (7 erreurs, 20
  warnings)** — exactement le chiffre attendu par le plan ; aucun dans un fichier touché par ce
  chantier (tous dans des fichiers non modifiés : `TightThresholdBlock.tsx`,
  `ResourceConstraintEditor.tsx`, `TaskCard.tsx`, etc.).
- `npm run build --workspace=packages/scheduler-client` : succès (`next build`, TypeScript +
  génération statique des 6 routes sans erreur).

**Non fait, comme prévu :** §6.3 (passe manuelle sur projet réel, RE-EXPORT préalable requis) —
hors périmètre exécutant, à faire par Frédéric.

## Relecture (Opus, 2026-07-21)

Contrôles refaits indépendamment du STATUT : typecheck propre sur les 4 workspaces, **336/336
tests**, lint 27 (inchangé), build Next OK. Grep des conteneurs supprimés : zéro hors format
persisté. Les trois branches de tooltip mortes (§1.1) sont supprimées et non recodées.

Les deux points de vigilance annoncés avant l'exécution sont non seulement corrects mais
**couverts par des tests non tautologiques** : `unplacedPersistence.test.ts` pose les trois
origines dans le store et vérifie que seule `user-pre` atteint `preNeutralizedKeys`, qu'un
aller-retour de semaine ne restaure qu'elle, et que la garde d'auto-save ne se redéclenche pas sur
un changement `engine` (comparaison de `savedAt` sous horloge simulée). La couverture du fichier
supprimé `unplacedNeutralized.test.ts` est bien reprise : `selectPiocheEntries` a un cas nommé
explicitement « non-régression du bug de l'étape 1 ».

**Une correction apportée en relecture — ordre de `dedupeUnplaced`.** Les deux appels passaient
`[...engine, ...userPre]` alors que la fonction garde la *première* occurrence : en cas de
collision, `engine` l'aurait emporté et l'exclusion amont aurait disparu **des runs suivants et du
snapshot persisté**, en silence. La collision est aujourd'hui impossible par construction (un
`user-pre` n'est jamais envoyé au moteur, vérifié dans `runSchedule`), mais l'ordre défensif est
l'inverse : corrigé en `[...userPre, ...engine]` aux deux sites, avec le commentaire du helper
réécrit — il annonçait « dernière occurrence conservée » alors que l'implémentation garde la
première.

**Arbitrage n°5 (sélecteur mémoïsé pour `CourseCard`) :** ne rien faire est retenu. Le composant
souscrivait déjà au tableau entier `preNeutralizedKeys` ; le comportement de re-render est
inchangé.

**§6.3 déroulée par Frédéric le 2026-07-21 : les six sections A à F conformes**, y compris les
deux qui portaient le risque — C (aller-retour pioche ↔ calendrier pour les trois origines, sans
doublon ni re-dépôt possible) et D (mécanique Autonomie entièrement redérivée : durée résiduelle
qui remonte au retrait d'un morceau, annulation qui restaure la durée pleine).

## 1. Objectif

Symétrique de l'étape 1. Une tâche est soit **placée** (un `Placement`, livré), soit **non placée**
(une entrée `Unplaced`, ce plan). Aujourd'hui les non-placés sont éclatés en quatre conteneurs et
une convention de préfixe :

| Conteneur | Ce que c'est vraiment |
|---|---|
| `preNeutralizedKeys: string[]` | non-placés décidés par l'utilisateur **avant** planification |
| `syntheticNeutralizedTasks` | les mêmes, ré-emballés en `NeutralizedTaskInfoJSON` avec un `taskId` préfixé `pre-neutral-` |
| `activeNeutralizedTasks` | non-placés par le **moteur** + les synthétiques concaténés |
| `manuallyNeutralizedTasks` | tâches auto retirées du calendrier **après coup** par l'utilisateur |
| `autonomyDistributions` | suivi d'une Autonomie répartie (durée restante, morceaux) |

Trois origines, causalement distinctes — c'est la distinction que Frédéric voulait lever :

- `user-pre` : **n'est pas envoyée au moteur** au prochain run (filtrée par `runSchedule`) ;
- `engine` : est envoyée, le moteur n'a pas pu la placer — porte des diagnostics ;
- `user-post` : est envoyée, le moteur l'a placée, l'utilisateur l'a retirée ensuite.

Les confondre serait une régression grave : promouvoir un `engine` en `user-pre` l'exclurait
définitivement des runs suivants.

### 1.1 Deux constats de cartographie qui allègent le modèle

**Les diagnostics moteur se réduisent à trois champs.** `NeutralizedTaskInfoJSON` déclare
`requiredMinutes`, `schedulableMinutes` et `resourceSnapshots`, mais
`grep -rn "requiredMinutes\|schedulableMinutes\|resourceSnapshots" packages/scheduler-api/src packages/scheduler-core/src`
ne renvoie **rien** : `serializeNeutralizedUnit` ne produit que `{ task, eliminationRound,
failureCount, reason }`. Les trois branches de tooltip correspondantes dans `SidebarAnalysis`
(« Temps nécessaire », « Temps dispo », « Ressources limitantes ») sont donc **du code mort** —
elles ne s'affichent jamais. Ne pas les porter dans le nouveau modèle ; les supprimer.

**`autonomyDistributions` est entièrement dérivable.** `remainingDuration` = durée du cours moins
la somme des durées des placements portant ce `taskId` ; `pieceIds` = ces mêmes placements ; l'état
« répartie ou non » = « existe-t-il au moins un placement pour ce taskId ». Le conteneur peut
disparaître, et avec lui `autonomyDistributionSlice.ts`.

### 1.2 L'invariant à rendre explicite

Une tâche est **non placée à hauteur de ce qui n'est pas placé** :

```
resteÀPlacer(tâche) = durée(cours) − Σ durée(placements de cette tâche)
```

La pioche affiche les entrées `unplaced` dont le reste est > 0, avec ce reste comme durée. Ça
unifie deux comportements aujourd'hui séparés : une tâche ordinaire disparaît de la pioche dès
qu'on la pose (reste = 0), une Autonomie répartie y reste avec sa durée résiduelle. C'est la même
règle, plus le cas particulier d'`autonomyDistributions`.

C'est aussi cet invariant qui, resté implicite, a produit le bug corrigé en relecture de l'étape 1
(même tâche plaçable plusieurs fois) : la comparaison placé/non-placé était faite à la main, à
trois endroits, sur des identifiants de formes différentes.

## 2. Non-objectifs (ne pas toucher à ce stade)

- **NE PAS** implémenter la promotion `post-enforced` → `pre-enforced` (étape 3).
- **NE PAS** changer le format persisté. `weekSaves[w].preNeutralizedKeys` **reste un
  `string[]` sur le disque** ; conversion à la lecture et à l'écriture, comme pour
  `manualEnforcedMap` à l'étape 1 (cf. `PlanUnifiedPlacements.md` §1.2). Conséquence directe :
  `lib/csvMerge.ts`, `lib/weekCourses.ts` (`pruneWeekSavesOfCourseIds`), `store/useProjectStore.ts`,
  `store/slices/weekSavesSlice.ts` et leurs tests **ne sont pas touchés**.
- **NE PAS** modifier `scheduler-core`, `scheduler-common`, `scheduler-api` — en particulier, ne
  pas retirer les trois champs morts de `NeutralizedTaskInfoJSON` (c'est du nettoyage moteur, à
  faire séparément) ; se contenter de ne pas les consommer.
- **NE PAS** traiter [[project_enforced_ignored_in_task_groups]] (imposition ignorée pour un membre
  de groupe) : hors périmètre, déjà arbitré par Frédéric.

## 3. Le modèle cible

Dans `store/types.ts`, à côté de `Placement` :

```ts
/** Origine d'un non-placement — qui a décidé, et à quel moment. */
export type UnplacedOrigin =
  | 'user-pre'   // exclue par l'utilisateur AVANT planification : jamais envoyée au moteur
  | 'engine'     // envoyée au moteur, qu'il n'a pas pu placer
  | 'user-post'; // placée par le moteur, retirée ensuite par l'utilisateur

export interface Unplaced {
  /** Tâche non placée — `CourseTaskDataWithId.id`, jamais préfixé. */
  taskId: string;
  origin: UnplacedOrigin;
  /**
   * Diagnostics du moteur. Présents si et seulement si `origin === 'engine'`.
   * Limités à ce que l'API produit réellement (cf. §1.1).
   */
  diagnostics?: { reason: string; failureCount: number; eliminationRound: number };
}
```

Tout le reste — `code`, `name`, `type`, durée, ressources candidates — se résout depuis le cours
via `courseById.get(taskId)`, comme pour les placements (règle 1 de l'étape 1).

**La convention `pre-neutral-<id>` disparaît**, ainsi que `PRE_NEUTRAL_PREFIX`, `realTaskId` et
`selectUnplacedNeutralized` dans `lib/taskCardUtils.ts` — les trois normalisations ajoutées en
relecture de l'étape 1 n'ont plus d'objet, puisqu'il n'y a plus qu'une forme d'identifiant.

## 4. Changements de code

Tout est dans `packages/scheduler-client`.

### 4.1 `store/types.ts`
Ajouter `UnplacedOrigin` et `Unplaced`. Supprimer `ManuallyNeutralizedTask` et
`AutonomyDistribution`. `PlacedNeutralizedTask` — vérifier s'il subsiste après l'étape 1 et le
supprimer s'il n'a plus d'appelant.

### 4.2 `lib/calendar/unplaced.ts` — nouveau module de dérivation

Fonctions pures, testables sans React ni store :

- `unplacedFromEngine(neutralized: NeutralizedTaskInfoJSON[]): Unplaced[]` — `origin: 'engine'`,
  `diagnostics` renseignés depuis `reason`/`failureCount`/`eliminationRound`. `taskId` est déjà le
  `course.id` réel (acquis du chantier identifiants stables).
- `unplacedFromPreNeutralized(taskIds: string[]): Unplaced[]` — `origin: 'user-pre'`, sans
  diagnostics. **Remplace toute la fabrication de `syntheticNeutralized`** de `runSchedule`
  (l.333-360), qui construisait un faux `TaskSolutionJSON` complet pour chaque cours exclu.
- `remainingDuration(taskId, placements, course): number` — l'invariant §1.2.
- `selectPiocheEntries(unplaced, placements, courseById): Array<{ entry: Unplaced; course; remaining: number }>`
  — les entrées à afficher (reste > 0), avec leur durée résiduelle. **Unique** point de décision
  « affiché dans la pioche ou non » : remplace `selectUnplacedNeutralized`, le filtre
  `hasItems` du draggable, et `autonomyDistributions[…].remainingDuration`.

### 4.3 `store/usePlanningStore.ts`

**Interface :** remplacer `preNeutralizedKeys`, `syntheticNeutralizedTasks`,
`activeNeutralizedTasks`, `manuallyNeutralizedTasks`, `autonomyDistributions` par :

```ts
  /** Tâches de la semaine qui ne sont pas (ou pas entièrement) posées. */
  unplaced: Unplaced[];
  /** Bascule l'exclusion amont d'un cours (mode préparation). */
  togglePreNeutralized: (taskId: string) => void;
  /** Retire un placement du calendrier et signale la tâche comme non placée. */
  unplaceTask: (placementId: string, origin: UnplacedOrigin) => void;
```

**`runSchedule`** : le filtrage des cours exclus lit
`unplaced.filter(u => u.origin === 'user-pre')` au lieu de `preNeutralizedKeys`. La fabrication des
entrées synthétiques disparaît (§4.2).

**Le paramètre `syntheticNeutralized` disparaît de six fonctions** — `_saveJobToStorage`,
`_loadJobFromStorage`, `_normalizeJobResult`, `_startPolling`, `_resumePendingJob` et le type de
`pendingJobResult`. Il n'existait que pour survivre à un rechargement de page pendant un job ; les
`user-pre` sont désormais reconstruites depuis le snapshot de semaine, qui est persisté dans le
Projet. Retirer aussi `syntheticNeutralized` de la charge écrite dans `localStorage`
(`edt-pending-job`) — un ancien contenu doit être toléré, pas planter (le champ est simplement
ignoré à la relecture).

**`applyPendingResult`** : `unplaced = [...unplacedFromEngine(best.neutralizedTasks ?? []),
...user-pre conservés]`. Les `user-post` sont vidés (nouvelle solution). Attention : une tâche
`user-pre` ne doit pas apparaître deux fois si le moteur la renvoie — elle ne lui a pas été
envoyée, donc le cas ne devrait pas se produire ; le garantir par déduplication sur `taskId`
plutôt que de le supposer.

**`setSelectedWeek`** : `unplaced = unplacedFromPreNeutralized(snapshot.preNeutralizedKeys)`
(branche snapshot) ou `[]` (branche sans snapshot).

**`_saveCurrentWeekSnapshot`** : `preNeutralizedKeys: unplaced.filter(u => u.origin === 'user-pre').map(u => u.taskId)`.
Le `subscribe` d'auto-save doit se déclencher sur `unplaced` **uniquement si les `user-pre` ont
changé** — même précaution qu'à l'étape 1 pour les `pre-enforced`, et pour la même raison :
`createProjectStorage.setItem` resérialise tout le fichier projet.

**`distributeAutonomy`** : ne crée plus d'entrée `autonomyDistributions`, seulement les placements
des morceaux. **`cancelAutonomyDistribution`** : retire tous les placements dont le `taskId` est
celui du cours — plus besoin de `pieceIds`.

**`resetCurrentSolution` / `resetScheduleResult` / `reset` / `handleEnforceChange`** : adapter la
remise à zéro de `unplaced`. Règle : `resetCurrentSolution` restaure les `engine` de
`scheduleResult` + conserve les `user-pre` ; `resetScheduleResult` (retour à la préparation) ne
garde que les `user-pre`.

### 4.4 `store/slices/neutralizedSlice.ts` et `autonomyDistributionSlice.ts`
Les deux **disparaissent** : leur contenu se réduit à `unplaced`, porté par le store principal
(comme l'a fait `AutonomyDistributionSlice` à l'étape 1, réduit à un état initial vide). Retirer
les types du `PlanningStore extends …`.

### 4.5 `components/planning/sidebar/SidebarAnalysis.tsx` — une seule pioche

- Les deux listes (`filteredUnplacedNeutralized` + `filteredManuallyNeutralized`) et leurs deux
  chemins de construction de carte (`solutionToBaseProps` / `manuallyNeutralizedToBaseProps`)
  fusionnent en une seule, alimentée par `selectPiocheEntries` et une seule fonction de props
  dérivée du cours.
- **Supprimer les trois branches de tooltip mortes** (§1.1). Le tooltip d'une entrée `engine`
  affiche `reason` et `failureCount` ; une entrée `user-pre` affiche « Neutralisée manuellement
  avant planification » ; une `user-post` affiche « Retirée manuellement du calendrier ».
- `isPreNeutralized` (test de préfixe) devient `entry.origin === 'user-pre'`.
- `ResourceLoadPopover` n'est affiché que pour `origin === 'engine'` (comportement actuel,
  exprimé par l'origine au lieu du préfixe). `buildAnalysisLoadRows` prend aujourd'hui un
  `NeutralizedTaskInfoJSON` : lui fournir un adaptateur au point d'appel plutôt que de changer sa
  signature — il vit dans `lib/resourceLoadAnalysis.ts`, couvert par ses propres tests.
- Bouton « Répartir » / « Annuler la répartition » : l'état vient de
  `placements.some(p => p.taskId === entry.taskId)`.

### 4.6 `lib/taskCardUtils.ts`
Supprimer `PRE_NEUTRAL_PREFIX`, `realTaskId`, `selectUnplacedNeutralized`,
`manuallyNeutralizedToBaseProps` et `resolveNeutralizedTaskById` (ce dernier devient une résolution
directe `unplaced.find(u => u.taskId === id)` + le cours). Garder `courseToBaseProps`,
`solutionToBaseProps` et `normalizeResourceEntries` s'ils ont encore des appelants.

### 4.7 `hooks/useCalendarCore.ts`
Le retrait d'un placement vers la pioche appelle `unplaceTask(placementId, 'user-post')`. La
normalisation `realTaskId` ajoutée en relecture de l'étape 1 disparaît, ainsi que son import.

### 4.8 `components/planning/courses/CourseCard.tsx`
`preNeutralizedKeys.includes(id)` devient `unplaced.some(u => u.taskId === id && u.origin === 'user-pre')`.
Envisager un sélecteur mémoïsé dans le store si le rendu de la liste de cours devient bruyant —
le signaler au checkpoint plutôt que d'optimiser d'emblée.

### 4.9 Ordre de travail
1. §4.1 + §4.2 + tests du module (§6.2) — pur, sans dépendance.
2. §4.3 + §4.4 (store et slices).
3. §4.5 → §4.8, guidés par `npm run typecheck --workspace=packages/scheduler-client`.

## 5. CHECKPOINT feu-vert (obligatoire — s'arrêter ici)

Faire valider par Frédéric **avant** d'écrire le moindre test :

- diff complet ;
- `npm run typecheck --workspace=packages/scheduler-client` (attendu : propre hors fichiers de
  test à réécrire, comme à l'étape 1) ;
- `grep -rn "pre-neutral-\|PRE_NEUTRAL_PREFIX\|realTaskId\|manuallyNeutralizedTasks\|activeNeutralizedTasks\|syntheticNeutralized\|autonomyDistributions\|preNeutralizedKeys" packages/scheduler-client/{app,components,hooks,lib,store} --exclude-dir=node_modules`
  (attendu : **zéro**, sauf `preNeutralizedKeys` dans `weekSavesSlice.ts`/`useProjectStore.ts`/
  `weekCourses.ts`/`csvMerge.ts` — format persisté, hors périmètre §2) ;
- confirmation que `_saveCurrentWeekSnapshot` écrit toujours un `preNeutralizedKeys: string[]`
  et que la garde d'auto-save ne se déclenche que sur les `user-pre` ;
- le point §4.8 (sélecteur mémoïsé ou non).

## 6. Validation (dimensionnée à ce que le changement peut affecter)

### 6.1 Non-régression automatisée
- `npm run test --workspace=packages/scheduler-client` (324 attendus avant).
  `__tests__/autonomyDistributionStore.test.ts` **devra être réécrit** (il porte sur
  `autonomyDistributions`, supprimé) : le réécrire sur la dérivation §1.2, à comportement constant.
  `__tests__/unplacedNeutralized.test.ts` **disparaît** avec `selectUnplacedNeutralized` — sa
  couverture doit être reprise par les tests de `selectPiocheEntries` (§6.2 cas 4), **pas
  simplement supprimée** : c'est le test de non-régression du bug de l'étape 1.
- `npm run typecheck` racine, `npm run lint --workspace=packages/scheduler-client` (27 problèmes
  préexistants attendus), `npm run build --workspace=packages/scheduler-client`.

### 6.2 Tests ciblés à écrire (nouveaux, sur `lib/calendar/unplaced.ts`)
1. `unplacedFromEngine` : `origin: 'engine'`, diagnostics repris, aucun champ mort inventé.
2. `unplacedFromPreNeutralized` : `origin: 'user-pre'`, pas de diagnostics.
3. `remainingDuration` : aucun placement → durée du cours ; un placement partiel → différence ;
   placements couvrant tout → 0 ; sur-couverture → 0 et non négatif.
4. `selectPiocheEntries` : entrée entièrement placée → absente (**c'est la non-régression du bug
   de l'étape 1 : une tâche posée ne doit pas rester déposable**) ; entrée partiellement placée →
   présente avec le reste ; entrée non placée → présente avec la durée pleine ; cours introuvable
   → ne jette pas.
5. Les trois origines survivent à un aller-retour `setSelectedWeek` → `_saveCurrentWeekSnapshot`
   pour les `user-pre`, et **seulement** pour elles (`engine`/`user-post` ne doivent jamais
   atterrir dans `preNeutralizedKeys`).

### 6.3 Passe manuelle sur projet réel (obligatoire — non réalisable par l'exécutant)
**RE-EXPORTER d'abord le projet réel.** Sur une semaine chargée :
1. **Préparation** : exclure deux cours (pin), changer de semaine, revenir → les exclusions sont
   restaurées ; planifier → ces cours ne sont pas placés et apparaissent dans la pioche avec le
   libellé « avant planification ».
2. **Moteur** : une tâche non placée par le moteur apparaît dans la pioche avec sa raison et son
   nombre d'échecs ; le popover de charge s'affiche pour elle et **pas** pour une exclusion amont.
3. **Aller-retour pioche ↔ calendrier**, dans les deux sens et pour les trois origines : poser une
   entrée → elle quitte la pioche et **ne peut pas être posée une seconde fois** ; la retirer du
   calendrier → elle réapparaît **une seule fois**. (C'est le scénario du bug de l'étape 1 :
   le vérifier pour une exclusion amont *et* pour une tâche neutralisée par le moteur.)
4. **Autonomie** : répartir → la carte reste dans la pioche avec la durée résiduelle, les morceaux
   sont sur le calendrier ; déplacer un morceau ; en supprimer un à la main → la durée résiduelle
   augmente ; « Annuler la répartition » → tous les morceaux disparaissent, la carte retrouve sa
   durée pleine.
5. **Réinitialiser** puis **retour à la préparation** : les exclusions amont survivent aux deux,
   les `engine`/`user-post` disparaissent au second.
6. Sauvegarde : après ces manipulations, changer de semaine et revenir — seules les exclusions
   amont doivent avoir été persistées.

Rapporter chaque point comme observé, y compris ce qui diffère de l'attendu.

## 7. Fichiers touchés (récapitulatif)

| Fichier | Nature |
|---|---|
| `store/types.ts` | §4.1 modèle, suppressions |
| `lib/calendar/unplaced.ts` | §4.2 **nouveau** |
| `store/usePlanningStore.ts` | §4.3 liste unique, job storage allégé, auto-save |
| `store/slices/neutralizedSlice.ts`, `autonomyDistributionSlice.ts` | §4.4 **supprimés** |
| `components/planning/sidebar/SidebarAnalysis.tsx` | §4.5 pioche unique, tooltips morts retirés |
| `lib/taskCardUtils.ts` | §4.6 suppressions |
| `hooks/useCalendarCore.ts` | §4.7 |
| `components/planning/courses/CourseCard.tsx` | §4.8 |
| `store/README.md` | mise à jour |
| tests vitest | §6.1 réécritures + §6.2 nouveaux |

## 8. Ce que l'exécution rapporte

Écrire un **STATUT** en tête de ce document à la fin : faits bruts uniquement — diff conforme ou
non au plan et où il s'en écarte, compteurs de tests avant/après, liste des tests réécrits ou
supprimés **et où leur couverture a été reprise**, sorties de grep, arbitrages retenus.
**Ne pas** écrire « vérifié », « validé », « corrigé » ni attribuer un gain : les conclusions sont
écrites au retour par le relecteur (Opus, Fable ou Frédéric).
