# Store Zustand — scheduler-client

## Vue d'ensemble

L'état global est **séparé en deux stores** :

```
store/
  useSchedulerStore.ts      ← données persistées (localStorage "edt-scheduler")
  usePlanningStore.ts       ← état de session (non persisté, reset à chaque semaine)
  slices/
    constraintsSlice.ts     ← slice contraintes + resourceWeeks (composé dans useSchedulerStore)
```

### `useSchedulerStore` — persisté (`localStorage "edt-scheduler"`)
- `allCourses: CourseTaskData[]` — tous les cours parsés du CSV (toutes semaines)
- `resources: ResourceGroupData[]` — ressources dérivées du CSV via `extractResourcesFromCsv`
- `constraints: ConstraintsRecord` — contraintes de disponibilité (Zustand persist)
- `resourceWeeks: Record<string, number[]>` — semaines actives par ressource

### `usePlanningStore` — session (non persisté)
- `selectedWeek`, `setSelectedWeek` — semaine ISO courante
- `scheduleResult`, `activeSolution`, `activeNeutralizedTasks` — résultat et vue courante
- `enforcedMap` — placements imposés (courseKey → EnforcedData)
- `blockedZones` — zones bloquées (plages indisponibles créées manuellement)
- `taskOverrides` — overrides de position/ressources pour les tâches déplacées manuellement
- `placedNeutralizedTasks` — tâches neutralisées replacées sur le calendrier via drag
- `isLoading`, `status` — feedback UI
- `runSchedule(mode)` — déclenche l'appel API via `runScheduleRequestFromData`

---

## Règle fondamentale : ce qui va dans le store vs. dans useState local

| Dans le **store** | Dans **useState** local |
|---|---|
| Données métier partagées entre composants | État purement UI d'un seul composant |
| État qui survit à la navigation de page | État éphémère (ouverture d'un modal, valeur d'input de recherche) |
| Données lues par une action d'un autre store | Tout ce qui ne sort pas du composant |

**Exemples concrets :**

```ts
// store → partagé
constraints, resourceWeeks, scheduleResult, enforcedMap

// useState local → UI uniquement
search, activeTab, selectedId, showAddModal, importError
```

---

## Utiliser les stores dans un composant

### Lire une valeur (subscription → re-render si la valeur change)

```ts
// ✅ Selector ciblé
const constraints = useSchedulerStore((s) => s.constraints);
const scheduleResult = usePlanningStore((s) => s.scheduleResult);

// ❌ À éviter — re-render à chaque modification du store entier
const store = useSchedulerStore();
```

### Lire sans subscription (dans une action, pas de re-render)

```ts
// Dans runSchedule de usePlanningStore — lire useSchedulerStore sans subscription
const { allCourses, resources, constraints } = useSchedulerStore.getState();
```

## Ajouter un nouveau slice dans `useSchedulerStore`

Les slices composés dans `useSchedulerStore` doivent être persistés dans `partialize`.

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
export type SchedulerStore = ConstraintsSlice & SchedulerDataSlice & MonSlice;
// Dans create() :
  ...createMonSlice(...a),
// Dans partialize() — si persisté :
  monChamp: state.monChamp,
```
