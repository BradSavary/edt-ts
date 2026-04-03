# Store Zustand — scheduler-client

## Vue d'ensemble

Un **store unique** (`useAppStore`) organisé en **slices thématiques**, correspondant conceptuellement à `SchedulerData` côté serveur (qui compose `ResourcesManager`, `TasksManager`, `AvailabilityManager`).

```
store/
  index.ts                  ← useAppStore : le store unique (create)
  slices/
    constraintsSlice.ts     ← données contraintes + resourceWeeks  ✅ implémenté
    scheduleSlice.ts        ← résultats API + solutions             🔜 à venir
    inputSlice.ts           ← fichiers + semaine + parsedCourses    🔜 à venir
    interactionSlice.ts     ← enforcedMap + zones bloquées          🔜 à venir
```

---

## Règle fondamentale : ce qui va dans le store vs. dans useState local

| Dans le **store** | Dans **useState** local |
|---|---|
| Données métier partagées entre composants | État purement UI d'un seul composant |
| État qui survit à la navigation de page | État éphémère (ouverture d'un modal, valeur d'input de recherche) |
| Données lues par une action d'un autre slice | Tout ce qui ne sort pas du composant |

**Exemples concrets :**

```ts
// store → partagé
constraints, resourceWeeks, scheduleResult, enforcedMap

// useState local → UI uniquement
search, activeTab, selectedId, showAddModal, importError
```

---

## Ajouter un nouveau slice

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

**2. Étendre `AppStore` dans `store/index.ts`**

```ts
import { createMonSlice, type MonSlice } from './slices/monSlice.js';

export type AppStore = ConstraintsSlice & MonSlice;
// Ajouter & MonSlice ici ↑

export const useAppStore = create<AppStore>()((...a) => ({
  ...createConstraintsSlice(...a),
  ...createMonSlice(...a),   // ← ajouter ici
}));
```
---

## Utiliser le store dans un composant

### Lire une valeur (subscription → re-render si la valeur change)

```ts
// ✅ Selector ciblé — re-render uniquement si constraints change
const constraints = useAppStore((s) => s.constraints);

// ✅ Plusieurs selectors dans un composant
const saveNotice    = useAppStore((s) => s.saveNotice);
const setConstraint = useAppStore((s) => s.setConstraint);

// ❌ À éviter — re-render à chaque modification du store entier
const store = useAppStore();
```

### Lire sans subscription (dépendance fonctionnelle, pas de re-render)

Quand une action a besoin de données d'un autre slice sans que le composant doive re-render :

```ts
// Dans une action async, un handler, un slice qui lit un autre slice :
const { constraints } = useAppStore.getState();
const { week }        = useAppStore.getState();
// Pas de subscription → jamais de re-render déclenché
```

Cas concret : le bouton "Planifier" doit envoyer les contraintes à l'API, mais le composant
de planification ne doit pas re-render quand une contrainte change. On utilise `getState()`
dans l'action `runSchedule`, pas un selector.

---

## Interaction entre slices

Les slices peuvent lire d'autres slices via `get()` (dans `StateCreator`) ou `getState()` :

```ts
// Dans scheduleSlice — lire les contraintes sans en être abonné
export const createScheduleSlice: StateCreator<AppStore, [], [], ScheduleSlice> = (set, get) => ({
  runSchedule: async () => {
    const { constraints } = get();           // ← lit le slice contraintes
    const { week, parsedCourses } = get();   // ← lira inputSlice plus tard
    // ...appel API
  },
});
```

> Quand un slice accède à d'autres slices, utiliser `StateCreator<AppStore, [], [], MonSlice>`
> (avec `AppStore` comme premier paramètre) plutôt que `StateCreator<MonSlice>`.

---

## Relation avec SchedulerData

```
SchedulerData (serveur, scheduler-common)     useAppStore (client, scheduler-client)
┌──────────────────────────────────┐          ┌──────────────────────────────────────┐
│  ResourcesManager                │          │  inputSlice (resourcesData)          │
│  TasksManager                    │    ≈     │  inputSlice (parsedCourses)          │
│  AvailabilityManager             │          │  constraintsSlice (constraints)      │
│  Logique de planification        │          │  scheduleSlice (scheduleResult)      │
└──────────────────────────────────┘          └──────────────────────────────────────┘
         │                                                   │
         └──────── API POST /schedule ────────────────── résultat stocké dans scheduleSlice
```

`SchedulerData` contient la logique métier côté serveur. `useAppStore` contient l'état UI
côté client : fichiers uploadés, résultats reçus, sélections de l'utilisateur, contraintes éditées.
