# scheduler-client

Application web de visualisation et de test du planificateur EDT-TS.  
Construite avec **Next.js 16 (App Router)**, TypeScript strict, Tailwind CSS v4 et FullCalendar v6.

---

> **Date de mise à jour :** Avril 2026

---

## Rôle dans le monorepo

```
scheduler-client  ──(HTTP POST /api/schedule)──►  scheduler-api  ──►  scheduler-cpsat
scheduler-client  ──(types partagés)           ──►  scheduler-common
```

Le client **ne connaît ni `scheduler-cpsat` ni `scheduler-api`** directement.  
Toute communication avec le moteur passe par des appels HTTP, proxifiés par Next.js vers l'API Express sur le port 3000.

---

## Stack technique

| Élément | Version | Rôle |
|---|---|---|
| Next.js (App Router) | 16.2 | Framework React SSR/SPA |
| React | 19 | UI |
| TypeScript | strict | Typage statique |
| Tailwind CSS | v4 | Styles utilitaires |
| shadcn/ui | new-york | Composants UI (Radix) |
| FullCalendar | 6.1 | Grille calendrier interactive |
| Zustand | 5 | State management |
| Vitest + Testing Library | — | Tests unitaires |
| Playwright | — | Tests E2E |

---

## Architecture & structure

```
packages/scheduler-client/
│
├── app/                              # Next.js App Router
│   ├── layout.tsx                    # Layout racine (HTML, body, NavBar)
│   ├── globals.css                   # Variables CSS OKLCH shadcn + Tailwind
│   ├── NavBar.tsx                    # Barre de navigation (Config / Planification / Contraintes)
│   ├── (config)/
│   │   └── page.tsx                  # Page "/" — import CSV cours
│   ├── planning/
│   │   └── page.tsx                  # Page "/planning" — calendrier + sidebar
│   ├── constraints/
│   │   └── page.tsx                  # Page "/constraints" — gestion des contraintes
│   └── api/
│       └── schedule/
│           ├── route.ts              # Proxy POST /api/schedule → API Express (5 min)
│           └── elimination/
│               └── route.ts         # Proxy POST /api/schedule/elimination (10 min)
│
├── components/
│   ├── planning/                     # Composants de la page Planning
│   │   ├── ScheduleCalendar.tsx      # Calendrier FullCalendar principal
│   │   ├── SidebarLeft.tsx           # Sidebar gauche (modes préparation / analyse)
│   │   ├── CourseCard.tsx            # Carte draggable d'un cours
│   │   ├── CourseGroupList.tsx       # Liste groupée de cours (par code ou enseignant)
│   │   ├── SchedulerConfigDialog.tsx # Dialog configuration du planificateur
│   │   └── modals/
│   │       ├── EnforceModal.tsx      # Modal de confirmation de placement imposé
│   │       └── TaskEditModal.tsx     # Modal d'édition des ressources d'une tâche
│   ├── constraints/                  # Composants de la page Contraintes
│   │   ├── ConstraintsManager.tsx    # Gestionnaire complet des contraintes
│   │   ├── ResourceConstraintEditor.tsx  # Éditeur de contraintes par ressource
│   │   ├── TimeRangePicker.tsx       # Sélecteur plage horaire (AM/PM)
│   │   └── AddResourceModal.tsx      # Modal ajout d'une ressource
│   └── ui/                           # Composants shadcn/ui (générés)
│
├── lib/                              # Utilitaires framework-agnostic
│   ├── utils.ts                      # cn() (clsx + tailwind-merge)
│   ├── calendarUtils.ts              # Helpers FullCalendar + détection conflits
│   ├── blockedZones.ts               # Logique zones bloquées + indisponibilités ressources
│   ├── parseCsvCourses.ts            # Parsing CSV → CourseTaskData[] + ressources
│   ├── scheduleApi.ts                # Client API (submitJobAsync, pollJob, buildScheduleStatus)
│   ├── icalExport.ts                 # Export iCal RFC 5545 (.ics)
│   ├── constraintsUtils.ts           # Utilitaires UI contraintes (DayMap, normalisation)
│   ├── clientSchedulerData.ts        # Sous-classe ClientSchedulerData extends SchedulerData
│   └── utils.ts                      # cn() (clsx + tailwind-merge)
│
├── hooks/
│   ├── useCalendarCore.ts            # Logique calendrier (drag, drop, conflits, modals)
│   ├── useNeutralizedDraggable.ts    # Draggable FullCalendar pour tâches neutralisées
│   └── useSidebarCourseDrag.ts       # Draggable + gestion conflits pour la sidebar
│
├── store/
│   ├── useSchedulerStore.ts          # Store persisté (allCourses, resources, constraints, config)
│   ├── usePlanningStore.ts           # Store session (semaine, solutions, enforced, overrides)
│   └── slices/
│       └── constraintsSlice.ts       # Slice contraintes (avec persist)
│
├── data/                             # Fichiers de données d'exemple
│   ├── cours.csv                     # CSV de cours (semestre, code, enseignant, groupes, salles…)
│   └── contraintes.json              # Disponibilités exemple
│
├── __tests__/                        # Tests unitaires Vitest
│   ├── calendarUtils.test.ts
│   ├── CourseCard.test.tsx
│   ├── EnforceModal.test.tsx
│   ├── page.test.tsx
│   └── parseCsvCourses.test.ts
│
├── e2e/
│   └── schedule.spec.ts              # Tests E2E Playwright
│
├── next.config.ts                    # Proxy rewrites /api/* → localhost:3000
├── vitest.config.ts
└── playwright.config.ts
```

---

## Navigation (3 pages)

L'application est organisée en trois pages distinctes accessibles depuis la barre de navigation (`NavBar`) :

| Route | Rôle |
|---|---|
| `/` | **Config** — import du fichier CSV des cours |
| `/planning` | **Planification** — calendrier interactif, lancement du planificateur |
| `/constraints` | **Contraintes** — édition des disponibilités des ressources |

---

## Fonctionnalités

### 1. Chargement des données (page Config `/`)

L'utilisateur importe un **unique fichier CSV**. La fonction `parseCsvFull(csvText)` extrait en une passe :
- Tous les cours de toutes les semaines → `allCourses: CourseTaskData[]`
- Les ressources uniques (enseignants, groupes, salles) → `resources: ResourceGroupData[]`
- Les semaines actives par ressource → `resourceWeeks: Record<string, number[]>`

Ces données sont persistées dans `useSchedulerStore` (localStorage `edt-scheduler`).

> **Plus de `resources.json` séparé** — les ressources sont extraites automatiquement depuis le CSV.

### 2. Planification (page Planning `/planning`)

La sidebar gauche présente deux modes selon l'état :

**Mode Préparation** (pas de résultat en cours) :
- Sélection du numéro de semaine ISO (1–53)
- Bouton **Planifier** → `POST /api/schedule/elimination` (mode élimination par défaut)
- Bouton engrenage `⚙` → `SchedulerConfigDialog` (configuration avancée)
- Liste glissable des cours de la semaine (par code ou par enseignant)

**Mode Analyse des solutions** (après planification) :
- Bouton "← Retour à la préparation" (avec confirmation si résultat non vide)
- Barre de recherche multi-critères (code, nom, enseignant, salle, groupe)
- Panel des tâches neutralisées (drag vers le calendrier)
- Bouton export iCal (`.ics`)

### 3. Configuration du planificateur (`SchedulerConfigDialog`)

Accessible via le bouton engrenage dans la sidebar. Permet de configurer :
- `timeoutSeconds` — limite de temps en secondes
- Les cinq préférences douces CP-SAT (`compactTeacherHalfDays`, `minimizeTeacherDays`,
  `balanceTeacherDailyLoad`, `crossNoonGap`, `minimizeTeacherRoomChanges`)
- **Pause déjeuner** : désactivée / fixe (`from`/`to`) / flottante (onglet présent mais désactivé,
  non supportée par le moteur)

La config est persistée dans `useSchedulerStore.schedulerConfig`.

### 4. Imposition manuelle de cours

Depuis la sidebar (mode Préparation), l'utilisateur **glisse-dépose** une carte vers un créneau du calendrier.

- **Sans alternatives** : placement direct
- **Avec alternatives** (enseignants ou salles multiples) : `EnforceModal` s'ouvre pour sélectionner les ressources

Les cours imposés sont transmis dans le payload → le moteur les respecte.

### 5. Tâches neutralisées

Les tâches non placées par le moteur (`neutralizedTasks`) apparaissent dans la sidebar (mode Analyse). Elles sont glissables vers le calendrier. Une pastille "Placé" apparaît une fois positionnées.

### 6. Zones bloquées

L'utilisateur sélectionne un bloc horaire sur le calendrier → zone marquée comme vide. Ces zones sont soustraites aux disponibilités avant planification via `applyBlockedZonesToConstraints`. Clic sur une zone vide → suppression.

### 7. Conflits en temps réel

Pendant le drag d'un événement :
- **Rouge** : enseignant ou groupe en double
- **Orange** : salle en double

S'applique aux drags internes, depuis la sidebar gauche (cours) et depuis le panel neutralisé.

### 8. Mise en évidence des indisponibilités au drag

Pendant le drag d'un cours, les créneaux indisponibles pour ses ressources (via `AvailabilityManager` + contraintes Zustand) s'affichent en fond ambre. Calculé par `computeConstraintUnavailableZones`.

### 9. Édition des ressources d'une tâche

Clic sur un événement → popup de détail → bouton "✏️ Modifier les ressources" → `TaskEditModal`.

### 10. Recherche dans le calendrier

En mode Analyse, la barre de recherche filtre les événements affichés sur le calendrier en temps réel (code, nom, enseignant, salle, groupe).

### 11. Export iCal

Bouton "Télécharger .ics" dans la sidebar (mode Analyse). Génère un fichier `.ics` RFC 5545 depuis `lib/icalExport.ts` avec les tâches de la solution active.

### 12. Gestion des contraintes (page Contraintes `/constraints`)

Interface dédiée à l'édition des disponibilités par ressource, persistées dans `useSchedulerStore.constraints` (Zustand persist). Fonctionnalités :
- Ajout/suppression de ressources
- Édition des plages horaires par jour via `TimeRangePicker`
- Contraintes modifiables par semaine via overrides
- Import/export JSON

---

## Composants détaillés

### `ScheduleCalendar` (`components/planning/`)

Composant-coquille FullCalendar qui délègue toute la logique à `useCalendarCore`. Affiche :
- Vue `timeGridWeek`, lun–ven, 7h–21h
- Événements placés, imposés, neutralisés posés, zones bloquées, background events d'indisponibilité

**Props :**

| Prop | Type | Description |
|---|---|---|
| `solutions` | `TaskSolutionJSON[]` | Tâches planifiées (filtrées par la recherche dans `page.tsx`) |
| `parsedCourses` | `CourseTaskData[]` | Cours de la semaine (pour les impositions) |

### `SidebarLeft` (`components/planning/`)

Sidebar gauche avec deux modes (préparation / analyse des solutions). Intègre :
- Formulaire semaine + bouton Planifier + `SchedulerConfigDialog`
- Liste draggable des cours (`CourseGroupList` + `useSidebarCourseDrag`)
- Panel des tâches neutralisées (`useNeutralizedDraggable`)
- Recherche, export iCal, retour à la préparation (avec confirmation)

### `SchedulerConfigDialog` (`components/planning/`)

Dialog de configuration du planificateur via formulaire multi-onglets (General / Pause déjeuner).

### `CourseGroupList` / `CourseCard` (`components/planning/`)

Liste groupée des cours (par code ou par enseignant) avec accordéons. `CourseCard` porte les attributs `data-*` utilisés par le Draggable FullCalendar.

### `EnforceModal` / `TaskEditModal` (`components/planning/modals/`)

- `EnforceModal` : sélection des ressources lors du drop d'un cours avec alternatives
- `TaskEditModal` : édition des enseignants/groupes/salles d'une tâche déjà placée

### Composants contraintes (`components/constraints/`)

- `ConstraintsManager` : point d'entrée de la page `/constraints`
- `ResourceConstraintEditor` : éditeur de contraintes par ressource (weekday × créneaux)
- `TimeRangePicker` : sélecteur AM/PM de plages horaires
- `AddResourceModal` : modal d'ajout d'une ressource dans les contraintes

---

## Utilitaires (`lib/`)

### `parseCsvCourses.ts`

| Fonction | Rôle |
|---|---|
| `parseCsvCourses(csv, week)` | Parse une semaine → `CourseTaskData[]` |
| `parseCsvCoursesAll(csv)` | Parse toutes les semaines → `CourseTaskData[]` |
| `extractResourcesFromCsv(csv)` | Extrait les ressources uniques → `ResourceGroupData[]` |
| `parseCsvFull(csv)` | Passe unique → `{ courses, resources, resourceWeeks }` (entrée principale) |

### `calendarUtils.ts`

| Fonction | Rôle |
|---|---|
| `getMondayOfISOWeek(week)` | Lundi de la semaine ISO (gestion année universitaire S≥35) |
| `startTimeToDate(monday, minutes)` | `startTime` (min) → `Date` absolue |
| `computeStaticConflicts(events)` | Chevauchements statiques entre événements |
| `computeDragHighlights(events, drag)` | Conflits avec le cours en cours de drag |

### `blockedZones.ts`

| Fonction | Rôle |
|---|---|
| `applyBlockedZonesToConstraints(...)` | Soustrait les zones bloquées des disponibilités |
| `computeConstraintUnavailableZones(ids, constraints, week, monday)` | Plages indisponibles pour un ensemble de ressources (fond ambre au drag) |

### `scheduleApi.ts`

`submitJobAsync(params, clientId)` : prend les données des stores, construit le payload `RawScheduleData`, applique impositions et zones bloquées, soumet le job de planification asynchrone. `pollJob`/`cancelJob` gèrent le suivi. `buildScheduleStatus(result: ScheduleResult)` construit le message de statut UI à partir de la solution unique retournée.

### `icalExport.ts`

| Fonction | Rôle |
|---|---|
| `generateIcalContent(tasks, week)` | Génère le contenu `.ics` RFC 5545 (VCALENDAR + VEVENTs) |
| `downloadIcalSolution(tasks, week)` | Déclenche le téléchargement dans le navigateur |

### `constraintsUtils.ts`

Utilitaires UI pour l'éditeur de contraintes : `DayMap`, `DayName`, `DaySlot`, `DAYS`, `detectResourceType`, `normalizeWeekKey`, `exportAsJSON`.

### `clientSchedulerData.ts`

Sous-classe de `SchedulerData` (common). Charge tous les cours sans appliquer de contraintes hebdomadaires. Expose `getTasksForWeek(week): Task[]` pour la validation côté client.

---

## Hooks

### `useCalendarCore`

Hook principal extrait de `ScheduleCalendar`. Gère toute la logique complexe du calendrier :
- Construction des événements FullCalendar depuis `activeSolution` + `taskOverrides` + `placedNeutralizedTasks`
- Handlers de drag-and-drop (interne, depuis sidebar gauche, depuis panel neutralisé)
- Gestion des modals (`EnforceModal`, `TaskEditModal`, popup de détail)
- Coloration des conflits et background events d'indisponibilité
- Zones bloquées (sélection et suppression)

### `useSidebarCourseDrag`

Initialise le Draggable FullCalendar sur la liste des cours de la sidebar. Gère les conflits potentiels avant le drop.

### `useNeutralizedDraggable`

Initialise le Draggable FullCalendar sur les tâches neutralisées. Synchronise `draggingExternal` dans `usePlanningStore` pour la mise en évidence des indisponibilités au drag.

---

## Stores Zustand

### `useSchedulerStore` — persisté (`localStorage "edt-scheduler"`)

| Champ | Type | Description |
|---|---|---|
| `allCourses` | `CourseTaskData[]` | Tous les cours parsés (toutes semaines) |
| `resources` | `ResourceGroupData[]` | Ressources extraites du CSV |
| `coursesFileName` | `string \| null` | Nom du fichier CSV importé |
| `constraints` | `ConstraintsRecord` | Contraintes de disponibilité |
| `resourceWeeks` | `Record<string, number[]>` | Semaines actives par ressource |
| `schedulerConfig` | `SchedulerConfig` | Config planificateur (persistée) |
| `availabilityManager` | `AvailabilityManager \| null` | Non persisté — reconstruit quand `constraints` change |
| `clientSchedulerData` | `ClientSchedulerData \| null` | Non persisté — reconstruit quand `allCourses` ou `resources` change |

### `usePlanningStore` — session (non persisté)

| Champ | Type | Description |
|---|---|---|
| `selectedWeek` | `number \| null` | Semaine ISO courante |
| `scheduleResult` | `ScheduleResult \| null` | Résultat de la dernière planification (une solution unique) |
| `activeSolution` | `TaskSolutionJSON[]` | Tâches de la solution active |
| `activeNeutralizedTasks` | `NeutralizedTaskInfoJSON[]` | Tâches non placées |
| `taskOverrides` | `Record<string, PlacedTaskOverride>` | Overrides de position/ressources (drag manuel) |
| `placedNeutralizedTasks` | `PlacedNeutralizedTask[]` | Tâches neutralisées posées manuellement |
| `enforcedMap` | `Record<string, EnforcedData>` | Placements imposés |
| `blockedZones` | `BlockedZone[]` | Zones bloquées |
| `searchQuery` | `string` | Filtre de recherche calendrier |
| `draggingExternal` | `{ teachers, groups, rooms } \| null` | Ressources du cours en cours de drag externe |
| `isLoading` | `boolean` | Feedback UI |
| `status` | `ScheduleStatus \| null` | Bannière de statut |

**Actions clés :**
- `runSchedule(mode)` — déclenche l'appel API
- `resetScheduleResult()` — réinitialise uniquement le résultat (sans changer la semaine)
- `reset()` — réinitialise tout (changement de semaine)

---

## Routes API (Next.js Route Handlers)

| Route | Timeout | Description |
|---|---|---|
| `POST /api/schedule` | 5 min | Planification standard |
| `POST /api/schedule/elimination` | 10 min | Planification avec élimination itérative |

Ces route handlers proxifient vers `http://localhost:3000` (configurable via `SCHEDULER_API_URL`). Ils contournent la limitation de timeout du proxy `rewrites` Next.js.

---

## Flux de données

```
CSV (cours.csv)   →  parseCsvFull()      →  useSchedulerStore.allCourses + resources + resourceWeeks
                                                        ↓
Contraintes UI    →  constraintsSlice    →  useSchedulerStore.constraints
                                                        ↓
                                              AvailabilityManager (auto-reconstruit)
                                              ClientSchedulerData  (auto-reconstruit)
                                                        ↓
usePlanningStore.runSchedule('elimination')
  →  submitJobAsync()
  →  POST /api/schedule/elimination
  →  scheduleResult → activeSolution → ScheduleCalendar
```

---

## Tests

### Unitaires (Vitest)

```bash
npm run test --workspace=packages/scheduler-client
# ou en watch
npm run test:watch --workspace=packages/scheduler-client
```

Couvre :
- `calendarUtils.ts` : `getMondayOfISOWeek`, `startTimeToDate`, `formatTime`, `formatDate`
- `parseCsvCourses.ts` : parsing CSV, extraction par semaine, salles alternatives
- `CourseCard` : rendu, attributs `data-*`
- `EnforceModal` : sélection enseignant/salle, confirmation/annulation
- `page.tsx` : rendu initial, chargement de fichier

### E2E (Playwright)

```bash
npm run test:e2e --workspace=packages/scheduler-client
```

- `e2e/schedule.spec.ts` : flux complet (chargement CSV, planification, vérification calendrier)
- Appels API interceptés via `page.route('/api/schedule', ...)`

---

## Configuration

### Tailwind CSS v4

Variables OKLCH shadcn dans `app/globals.css` (`--background`, `--foreground`, `--primary`, etc.). Tokens mappés via `@theme inline`. Mode sombre activé via `.dark` sur `<html>`.

### shadcn/ui (style `new-york`)

Composants dans `components/ui/`. Pour en ajouter un :

```bash
# Depuis packages/scheduler-client/
# Renommer temporairement pnpm-lock.yaml et pnpm-workspace.yaml avant (conflit npm/pnpm)
npx shadcn@latest add <composant>
```

### Alias d'import

| Alias | Résolution |
|---|---|
| `@/` | Racine du package (`packages/scheduler-client/`) |
| `@edt-ts/scheduler-common` | `packages/scheduler-common/src/index.ts` |

### Variable d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `SCHEDULER_API_URL` | `http://localhost:3000` | URL de l'API Express (route handlers) |

---

## Commandes

```bash
# Développement (port 5173, proxy → API port 3000)
npm run client:dev

# Build production
npm run client:build

# Typecheck
npm run typecheck --workspace=packages/scheduler-client

# Lint
npm run lint --workspace=packages/scheduler-client

# Tests unitaires
npm run test --workspace=packages/scheduler-client

# Tests E2E
npm run test:e2e --workspace=packages/scheduler-client
```

> L'API Express doit tourner sur le port 3000 : `npm run api:dev`
