# Store Zustand — scheduler-client

## Vue d'ensemble

```
store/
  useSchedulerStore.ts      ← données persistées (localStorage "edt-scheduler")
  usePlanningStore.ts       ← état de session (non persisté, reset à chaque semaine)
  types.ts                  ← types partagés entre les deux stores
  slices/
    constraintsSlice.ts     ← contraintes + resourceWeeks + saveNotice
    weekSavesSlice.ts       ← sauvegardes de préparation par semaine (persisté)
    blockedZonesSlice.ts    ← zones bloquées (drag)
    taskGroupsSlice.ts      ← groupes de tâches + manualEnforcedMap
```

---

### `useSchedulerStore` — persisté (`localStorage "edt-scheduler"`)

Composé de `ConstraintsSlice`, `WeekSavesSlice` et d'un slice inline `SchedulerDataSlice`.

**Persistés :**
- `allCourses: CourseTaskData[]` — tous les cours parsés du CSV (toutes semaines)
- `resources: ResourceGroupData[]` — ressources dérivées du CSV via `extractResourcesFromCsv`
- `coursesFileName: string | null` — nom du fichier CSV importé
- `schedulerConfig: SchedulerConfig` — configuration passée au moteur
- `yearColorConfig: YearColorConfig` — couleurs d'affichage par promotion
- `schoolYearConfig: SchoolYearConfig | null` — config année scolaire + vacances/jours fériés
- `tightThreshold / criticalThreshold: number` — seuils d'analyse des contraintes (défaut 0.5 / 1.0)
- `constraints: ConstraintsRecord` — contraintes de disponibilité (via `constraintsSlice`)
- `resourceWeeks: Record<string, number[]>` — semaines actives par ressource (via `constraintsSlice`)
- `weekSaves: WeekSavesMap` — sauvegardes de préparation par `[schoolYear][weekNumber]` (via `weekSavesSlice`)

**Non persistés (reconstruits via `subscribe` côté client) :**
- `availabilityManager: AvailabilityManager | null` — reconstruit à chaque changement de `constraints`
- `clientSchedulerData: ClientSchedulerData | null` — reconstruit quand `allCourses` ou `resources` change ; expose `getTasksForWeek(week)` → `Task[]`

---

### `usePlanningStore` — session (non persisté)

Composé de `BlockedZonesSlice`, `TaskGroupsSlice` et d'un slice inline.

**Sélection / navigation :**
- `selectedWeek: number | null`, `setSelectedWeek` — charge la sauvegarde si elle existe, réinitialise sinon
- `searchQuery: string`, `setSearchQuery` — filtre de la liste des cours

**Résultat de planification :**
- `scheduleResult: ScheduleResult | null` — résultat brut de l'API, une solution unique (immuable).
  N'est plus lu pour l'affichage, seulement pour reconstruire `placements` (↺ Réinitialiser) et
  les diagnostics des non-placés.
- `resetCurrentSolution()` — remet la solution à son état initial moteur

**Placements (modèle unifié) :**
- `placements: Placement[]` — emploi du temps courant de la semaine, toutes origines confondues
  (`auto` posé par le moteur, `pre-enforced` imposé avant planification, `post-enforced` retouche
  manuelle). Remplace `activeSolution`/`taskOverrides`/`placedNeutralizedTasks`/`enforcedViolations`.
- `addPlacement` / `updatePlacement` / `removePlacement` — CRUD ; `updatePlacement` fait basculer
  un placement `auto` en `post-enforced` dès que le patch touche `startTime`/`duration`/`resources`.
  Sur un `pre-enforced`, il réaligne `enforcedMap`/`manualEnforcedMap` sur la nouvelle position
  (les maps sont la projection des impositions affichées — `_saveCurrentWeekSnapshot` les
  re-dérive de `placements`) ; `unplaceTask` en retire l'entrée pour la même raison.
- Conversions pures dans `lib/calendar/placements.ts` (`placementsFromSolution`,
  `placementsFromEnforcedMap`, `enforcedMapFromPlacements`, `toTaskSolutionJSON`).
- `nextPlacementId(taskId, placements)` (même module) — identité d'un placement déposé à la main :
  `taskId` si la tâche n'est posée nulle part, sinon le premier fragment `${taskId}-piece-${i}`
  libre (`piecePlacementId`, format partagé avec `distributeAutonomy`). Indispensable au dépôt
  manuel d'un résidu d'Autonomie : `addPlacement` déduplique sur `placementId`, un id réutilisé
  effacerait le morceau précédent.

**Contraintes de session :**
- `enforcedMap: Record<string, EnforcedData>` — map augmentée (manuelle + propagation de groupe).
  N'est plus lue pour le rendu calendrier (voir `placements`, origin `pre-enforced`) ; sert encore
  au payload moteur (`runSchedule`) et au badge "imposé" de `SidebarPreparation` en préparation.
- `manualEnforcedMap` (via `taskGroupsSlice`) — enforcements manuels bruts (sans propagation)
- `syncEnforcedAfterCourseEdit(courseId)` — réaligne l'imposition d'un cours sur son modèle après
  édition de celui-ci depuis la sidebar de préparation (`SidebarPreparation`). Manuelle : réappelle
  `handleEnforceChange` avec le combo ré-résolu (`resolveEntriesAgainstPrevious`, préserve le choix
  déjà imposé s'il reste admissible). Dérivée d'un groupe : réappelle `handleEnforceChange` à map
  manuelle inchangée — `augmentEnforcedMap` la recalcule depuis le modèle qui vient d'être patché.
  Non imposé : no-op (pas de `set()`, l'auto-save compare les références).

**Non-placés (modèle unifié) :**
- `unplaced: Unplaced[]` — tâches de la semaine qui ne sont pas (ou pas entièrement) posées,
  taguées par origine (`user-pre` exclue avant planification, `engine` neutralisée par le moteur,
  `user-post` retirée du calendrier après coup). Remplace `preNeutralizedKeys` (session — la
  version persistée reste dans `weekSaves`)/`syntheticNeutralizedTasks`/`activeNeutralizedTasks`/
  `manuallyNeutralizedTasks`/`autonomyDistributions`.
- `togglePreNeutralized(taskId)` — bascule l'exclusion `user-pre` d'un cours (mode préparation).
- `addPreNeutralized(taskIds)` — ajoute en une passe des exclusions `user-pre` (copie de
  préparation `CopyWeekPrepModal`) ; un seul `set()`, **promeut** en `user-pre` une tâche déjà non
  placée pour une autre raison (`engine`/`user-post` sont effacés par `handleEnforceChange`, s'y
  fier perdrait la neutralisation) sans jamais dupliquer, `return {}` si rien ne change pour ne pas
  déclencher d'auto-save à vide.
- `unplaceTask(placementId, origin)` — retire un placement et signale la tâche non placée ; dédup
  sur `taskId` (n'ajoute pas de seconde entrée si une existe déjà pour cette tâche).
- Dérivations pures dans `lib/calendar/unplaced.ts` (`unplacedFromEngine`,
  `unplacedFromPreNeutralized`, `remainingDuration`, `selectPiocheEntries`) : l'affichage dans la
  pioche suit un invariant unique, `reste = durée(cours) − Σ durée(placements de cette tâche)`.

**Zones bloquées** (via `blockedZonesSlice`) :
- `blockedZones: BlockedZone[]` — plages indisponibles (vacances auto + manuelles)
- `handleBlockedZoneAdd / Remove / Move`

**Groupes de tâches** (via `taskGroupsSlice`) :
- `taskGroups: TaskGroupConfig[]` — groupes CM→TD→TP ou séquentiels pour la semaine courante
- CRUD : `addTaskGroup`, `removeTaskGroup`, `addCourseToGroup`, `removeCourseFromGroup`, `setGroupType`, `reorderCourseInGroup`

**Job asynchrone :**
- `currentJobId: string | null` — job API en cours de polling
- `currentJobStatus: JobStatusResponse | null` — dernier statut connu
- `pendingJobResult` — résultat prêt mais non encore appliqué (semaine différente possible)
- `runSchedule()` — soumet le job, démarre le polling toutes les 5s
- `cancelCurrentJob()` — annule le job en cours
- `applyPendingResult()` — applique `pendingJobResult` à la vue courante

**Retour à la préparation :**
- `returnToPreparation(promotedPlacementIds)` — retour à l'étape préparation (remplace
  `resetScheduleResult`). Promeut les placements `post-enforced` désignés (retouches) en
  impositions manuelles (`manualEnforcedMap`) avant de reconstruire `placements` depuis la map
  augmentée ; liste vide = ancien comportement de `resetScheduleResult`. Un seul `set` — ne pas
  enchaîner `handleEnforceChange()` puis un reset séparé, ce qui redéclencherait deux fois
  l'auto-save. Voir `lib/calendar/promotion.ts` (`selectPromotionCandidates`,
  `enforcedDataFromPlacement`) pour la sélection des candidats promouvables côté UI.

**UI :**
- `isLoading / status` — feedback UI
- `draggingExternal` — ressources du cours en cours de drag depuis la sidebar
- `groupDrawerOpen / toggleGroupDrawer` — panneau GroupDrawer

**Auto-save :** toute modification de `taskGroups`, `blockedZones`, `manualEnforcedMap` ou des
`user-pre` de `unplaced` déclenche automatiquement `saveWeek()` dans `useSchedulerStore` (les
`engine`/`user-post` ne sont pas persistés). Restauré au `setSelectedWeek`.

---

## Règle fondamentale : ce qui va dans le store vs. dans useState local

| Dans le **store** | Dans **useState** local |
|---|---|
| Données métier partagées entre composants | État purement UI d'un seul composant |
| État qui survit à la navigation de page | État éphémère (ouverture d'un modal, valeur d'input) |
| Données lues par une action d'un autre store | Tout ce qui ne sort pas du composant |

```ts
// store → partagé / survit à la navigation de page
constraints, resourceWeeks, scheduleResult, enforcedMap, taskGroups
selectedId, activeTab (menu Contraintes → useConstraintsUiStore, session non persistée)

// useState local → UI éphémère d'un seul composant
search, showAddModal, importError
```

> `useConstraintsUiStore` (non persisté, comme `usePlanningStore`) porte la ressource
> sélectionnée et l'onglet de type du menu Contraintes. Extrait du `useState` local pour
> qu'un aller-retour Planification ⇄ Contraintes retombe sur la dernière ressource éditée.

---

## Utiliser les stores dans un composant

```ts
// ✅ Selector ciblé — re-render uniquement si la valeur change
const constraints = useSchedulerStore((s) => s.constraints);
const scheduleResult = usePlanningStore((s) => s.scheduleResult);

// ✅ Lecture sans subscription (dans une action)
const { allCourses, resources } = useSchedulerStore.getState();

// ❌ À éviter — re-render à chaque modification du store entier
const store = useSchedulerStore();
```

---

## Ajouter un nouveau slice dans `useSchedulerStore`

Les slices persistés doivent être listés dans `partialize`.

**1. Créer `store/slices/monSlice.ts`**

```ts
import type { StateCreator } from 'zustand';

export interface MonSlice {
  maValeur: string;
  setMaValeur: (v: string) => void;
}

export const createMonSlice: StateCreator<MonSlice> = (set) => ({
  maValeur: '',
  setMaValeur: (v) => set({ maValeur: v }),
});
```

**2. Étendre `SchedulerStore` dans `useSchedulerStore.ts`**

```ts
export type SchedulerStore = ConstraintsSlice & WeekSavesSlice & SchedulerDataSlice & MonSlice;
// Dans create() :
  ...createMonSlice(...a),
// Dans partialize() — si persisté :
  monChamp: state.monChamp,
```
