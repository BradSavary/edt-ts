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
    neutralizedSlice.ts     ← pré-neutralisations + pioche de tâches
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

Composé de `NeutralizedSlice`, `BlockedZonesSlice`, `TaskGroupsSlice` et d'un slice inline.

**Sélection / navigation :**
- `selectedWeek: number | null`, `setSelectedWeek` — charge la sauvegarde si elle existe, réinitialise sinon
- `searchQuery: string`, `setSearchQuery` — filtre de la liste des cours

**Résultat de planification :**
- `scheduleResult: ScheduleResult | null` — résultat brut de l'API, une solution unique (immuable)
- `activeSolution: TaskSolutionJSON[]` — tâches placées de la solution active
- `activeNeutralizedTasks: NeutralizedTaskInfoJSON[]` — tâches non placées + synthétiques
- `resetCurrentSolution()` — remet la solution à son état initial moteur

**Overrides manuels :**
- `taskOverrides: Record<string, PlacedTaskOverride>` — déplacements manuels de tâches planifiées
- `placedNeutralizedTasks: PlacedNeutralizedTask[]` — tâches neutralisées replacées sur le calendrier

**Contraintes de session :**
- `enforcedMap: Record<string, EnforcedData>` — placements imposés (auto-propagé depuis groupes)
- `manualEnforcedMap` (via `taskGroupsSlice`) — enforcements manuels bruts (sans propagation)
- `enforcedViolations: Record<string, 'red' | 'orange' | 'none'>` — violations détectées au drag

**Neutralisation :**
- `preNeutralizedKeys: string[]` — cours exclus avant planification (via `neutralizedSlice`)
- `manuallyNeutralizedTasks` — tâches planifiées glissées dans la pioche
- `syntheticNeutralizedTasks` — entrées synthétiques pour les pré-neutralisées (injectées dans `activeNeutralizedTasks`)

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

**UI :**
- `isLoading / status` — feedback UI
- `draggingExternal` — ressources du cours en cours de drag depuis la sidebar
- `groupDrawerOpen / toggleGroupDrawer` — panneau GroupDrawer

**Auto-save :** toute modification de `taskGroups`, `blockedZones`, `preNeutralizedKeys` ou `manualEnforcedMap` déclenche automatiquement `saveWeek()` dans `useSchedulerStore`. Restauré au `setSelectedWeek`.

---

## Règle fondamentale : ce qui va dans le store vs. dans useState local

| Dans le **store** | Dans **useState** local |
|---|---|
| Données métier partagées entre composants | État purement UI d'un seul composant |
| État qui survit à la navigation de page | État éphémère (ouverture d'un modal, valeur d'input) |
| Données lues par une action d'un autre store | Tout ce qui ne sort pas du composant |

```ts
// store → partagé
constraints, resourceWeeks, scheduleResult, enforcedMap, taskGroups

// useState local → UI uniquement
activeTab, selectedId, showAddModal, importError
```

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
