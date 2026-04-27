---
applyTo: "packages/scheduler-client/**"
---

# Copilot Instructions — scheduler-client

Le package `scheduler-client` est l'application web de planification. C'est un projet **Next.js (App Router)** avec TypeScript strict, Tailwind CSS v4, shadcn/ui, et un proxy vers l'API Express.

## Versions des frameworks et bibliothèques

| Bibliothèque | Version |
|---|---|
| Next.js | 16.2.0 |
| React | 19.2.4 |
| TypeScript | ^5 |
| Tailwind CSS | ^4 |
| shadcn/ui | style `new-york` (via `radix-ui` ^1.4.3) |
| FullCalendar | ^6.1.20 |
| Zustand | ^5.0.12 |
| Vitest | ^3.0.0 |
| Playwright | ^1.50.0 |
| ESLint | ^9 (flat config) |
| lucide-react | ^1.7.0 |
| clsx + tailwind-merge | ^2.1.1 / ^3.5.0 |

## Objectif du package

- Fournir une interface utilisateur pour soumettre des données de planification (resources, cours, contraintes) et visualiser les résultats
- Consommer uniquement `@edt-ts/scheduler-common` pour les types partagés (jamais `scheduler-core` ni `scheduler-api` directement)
- Servir d'application de démonstration et de test de l'API

## Architecture & structure

```
packages/scheduler-client/
  app/                              # Next.js App Router
    layout.tsx                      # Layout racine (HTML, body, NavBar)
    globals.css                     # Styles globaux (Tailwind + shadcn CSS vars OKLCH)
    NavBar.tsx                      # Barre de navigation (3 onglets)
    (config)/
      page.tsx                      # Page "/" — import CSV cours (page de config)
    planning/
      page.tsx                      # Page "/planning" — calendrier interactif
    constraints/
      page.tsx                      # Page "/constraints" — gestion des contraintes
    api/
      schedule/
        route.ts                    # Route handler POST /api/schedule (proxy → Express, 5min)
        v2/
          route.ts                  # Route handler POST /api/schedule/v2 (proxy → Express, 10min)
  components/
    config/
      SchoolYearBlock.tsx           # Bloc UI sélecteur vacances scolaires (année + zone A/B/C)
    planning/                       # Composants de la page Planning
      calendar/
        ScheduleCalendar.tsx        # Calendrier FullCalendar (coquille, logique dans useCalendarCore)
      sidebar/
        SidebarLeft.tsx             # Switch préparation / analyse
        SidebarPreparation.tsx      # Mode préparation (cours, config, semaine)
        SidebarAnalysis.tsx         # Mode analyse (solutions, export iCal)
      courses/
        CourseCard.tsx              # Carte draggable d'un cours
        CourseGroupList.tsx         # Liste groupée de cours (par code ou enseignant)
        GroupDrawer.tsx             # Drawer de détail d'un groupe de cours
      modals/
        ResourceSlots.tsx           # Éditeur de créneaux de ressources (partagé)
        EnforceModal.tsx            # Modal de confirmation de placement imposé
        TaskEditModal.tsx           # Modal d'édition des ressources d'une tâche placée
        CourseCreateModal.tsx       # Modal de création/duplication d'un cours
      SchedulerConfigDialog.tsx     # Dialog configuration avancée du planificateur
    constraints/                    # Composants de la page Contraintes
      ConstraintsManager.tsx        # Gestionnaire complet des contraintes
      ResourceConstraintEditor.tsx  # Éditeur de contraintes par ressource
      TimeRangePicker.tsx           # Sélecteur plage horaire (AM/PM)
      AddResourceModal.tsx          # Modal ajout d'une ressource dans les contraintes
    ui/                             # Composants shadcn/ui (générés automatiquement)
  lib/                              # Utilitaires (framework-agnostic)
    calendar/
      calendarUtils.ts              # Helpers FullCalendar + détection conflits ressources
      blockedZones.ts               # Logique zones bloquées (soustraction de créneaux)
      yearColors.ts                 # Palette de couleurs par année BUT
    api/
      scheduleApi.ts                # Client API (runScheduleRequestFromData → POST /api/schedule)
      clientSchedulerData.ts        # Sous-classe ClientSchedulerData extends SchedulerData
    utils.ts                        # Fonction cn() (clsx + tailwind-merge)
    parseCsvCourses.ts              # Parsing CSV des cours → CourseTaskData[] + ressources
    icalExport.ts                   # Export iCal RFC 5545 (generateIcalContent, downloadIcalSolution)
    constraintsUtils.ts             # Utilitaires UI contraintes (DayMap, normalisation, export JSON)
    schoolHolidays.ts               # Vacances scolaires & jours fériés (HolidayPeriod, SchoolYearConfig)
    taskGroupUtils.ts               # Groupes de tâches (GroupType, buildTaskGroupData, computeGroupEnforcements)
  hooks/
    useCalendarCore.ts              # Toute la logique calendrier (drag, drop, conflits, modals)
    useNeutralizedDraggable.ts      # FullCalendar Draggable pour les tâches neutralisées
    useSidebarCourseDrag.ts         # FullCalendar Draggable + conflits pour la sidebar cours
  store/
    useSchedulerStore.ts            # Store persisté (allCourses, resources, constraints, config)
    usePlanningStore.ts             # Store session (semaine, résultat, solution active, overrides)
    slices/
      constraintsSlice.ts           # Slice Zustand pour les contraintes (avec persist)
  __tests__/                        # Tests unitaires (Vitest + Testing Library)
  e2e/                              # Tests E2E (Playwright)
  public/                           # Assets statiques
```

## Navigation (3 pages)

L'application est organisée en trois pages accessibles via `NavBar` :

| Route | Page | Rôle |
|---|---|---|
| `/` | Config | Import du fichier CSV des cours |
| `/planning` | Planification | Calendrier interactif + lancement planificateur |
| `/constraints` | Contraintes | Édition des disponibilités des ressources |

## Architecture des stores Zustand

L'état global est **séparé en deux stores** :

### `useSchedulerStore` — données persistées (localStorage `edt-scheduler`)
- `allCourses: CourseTaskData[]` — tous les cours parsés du CSV (toutes semaines)
- `resources: ResourceGroupData[]` — ressources extraites automatiquement du CSV
- `coursesFileName: string | null` — nom du fichier CSV importé
- `constraints: ConstraintsRecord` — contraintes de disponibilité (Zustand persist)
- `resourceWeeks: Record<string, number[]>` — semaines actives par ressource (du CSV)
- `schedulerConfig: SchedulerConfig` — configuration avancée du planificateur (persistée)

**Champs non persistés** (reconstruits côté client uniquement via `subscribe` + initialisation immédiate) :
- `availabilityManager: AvailabilityManager | null` — reconstruit quand `constraints` change ; utilisé par `computeConstraintUnavailableZones` pour les zones de drag
- `clientSchedulerData: ClientSchedulerData | null` — reconstruit quand `allCourses` ou `resources` change ; expose `getTasksForWeek(week) → Task[]`

### `usePlanningStore` — état de session (non persisté)
- `selectedWeek`, `setSelectedWeek` — semaine ISO courante (reset complet à chaque changement)
- `scheduleResult`, `activeSolution`, `activeNeutralizedTasks` — résultat et vue courante
- `selectedSolutionIndex`, `setSelectedSolutionIndex` — solution affichée
- `enforcedMap` — placements imposés (courseKey → EnforcedData)
- `blockedZones` — zones bloquées (plages indisponibles créées manuellement)
- `taskOverrides` — overrides de position/ressources pour les tâches déplacées manuellement
- `placedNeutralizedTasks` — tâches neutralisées replacées sur le calendrier via drag
- `searchQuery`, `setSearchQuery` — filtre de recherche dans le calendrier
- `draggingExternal` — ressources du cours en drag externe (sidebar → calendrier)
- `isLoading`, `status` — feedback UI
- `runSchedule(mode)` — déclenche l'appel API via `runScheduleRequestFromData`
- `resetScheduleResult()` — réinitialise uniquement le résultat (sans changer la semaine)
- `reset()` — réinitialise tout

**Ne jamais ajouter de logique métier** directement dans les stores. Les stores orchestrent ; la logique reste dans `lib/`.

## Flux de données principal

```
CSV (cours.csv)   →  parseCsvFull()      →  useSchedulerStore.allCourses + resources + resourceWeeks
Contraintes UI    →  constraintsSlice    →  useSchedulerStore.constraints
                                                      ↓
                                            AvailabilityManager (auto-reconstruit si constraints change)
                                            ClientSchedulerData  (auto-reconstruit si allCourses/resources change)
                                                      ↓
usePlanningStore.runSchedule('elimination')
  →  runScheduleRequestFromData()  →  POST /api/schedule/elimination
  →  scheduleResult → activeSolution → ScheduleCalendar
```

> **Pas de `resources.json` séparé** : les ressources sont extraites du CSV via `parseCsvFull()`.

## `lib/parseCsvCourses.ts`

Fonctions exportées :
- `parseCsvCourses(csv, week)` — parse une semaine → `CourseTaskData[]`
- `extractResourceWeeks(csv)` — extrait les semaines actives par ressource → `Record<string, number[]>`
- **`parseCsvFull(csv)`** — passe unique → `{ courses, resources, resourceWeeks }` (entrée principale)

## `lib/icalExport.ts`

Export iCal RFC 5545 :
- `generateIcalContent(tasks, week)` — génère le contenu `.ics` (VCALENDAR + VEVENTs)
- `downloadIcalSolution(tasks, week)` — déclenche le téléchargement dans le navigateur

## `lib/clientSchedulerData.ts`

Sous-classe de `SchedulerData` pour le client. Permet de charger **l'ensemble des cours** (toutes semaines) sans appliquer de contraintes hebdomadaires sur les ressources.

- `initAllTasks(courses: CourseTaskData[])` — charge toutes les tâches sans `applyConstraintsForWeek` ; **requiert `initResources()` au préalable**
- `getTasksForWeek(week: number): Task[]` — filtre les tâches par semaine ISO

L'instance est maintenue dans `useSchedulerStore.clientSchedulerData`, reconstruit automatiquement quand `allCourses` ou `resources` change.

> Note : retourne `Task[]` (objets riches), pas `CourseTaskData[]`. À ne pas confondre avec `allCourses.filter(c => c.week === w)` qui retourne des données brutes.

## `lib/constraintsUtils.ts`

Utilitaires **UI** pour la gestion des contraintes. N'est **pas** responsable du stockage (géré par Zustand persist).

Types UI spécifiques au client :
- `ResourceTypeUI` (`'teacher' | 'room' | 'group' | 'other'`) — distinct de `ResourceType` de `common` (ajoute `'other'`)
- `DayMap`, `DayName`, `DaySlot`, `DAYS` — format par-jour pour l'éditeur de contraintes

## `lib/api/scheduleApi.ts`

Une seule fonction publique : **`runScheduleRequestFromData(params)`**.  
Elle prend les données déjà en mémoire (depuis les stores), construit le payload et appelle `POST /api/schedule` (standard, 5min) ou `POST /api/schedule/v2` (mode élimination, 10min).

## `hooks/useCalendarCore.ts`

Hook principal extrait de `ScheduleCalendar`. Contient toute la logique complexe :
- Construction des événements FullCalendar (depuis `activeSolution` + `taskOverrides` + `placedNeutralizedTasks`)
- Handlers drag-and-drop (interne, sidebar gauche, panel neutralisé)
- Gestion des modals (`EnforceModal`, `TaskEditModal`, `CourseCreateModal`, popup de détail)
- Coloration des conflits et background events d'indisponibilité
- Zones bloquées (sélection, suppression) — `source` différencie manual/vacation/public-holiday

> `ScheduleCalendar` (`components/planning/calendar/`) est une coquille : il instancie `useCalendarCore` et passe les résultats à FullCalendar.

## `components/planning/SchedulerConfigDialog.tsx`

Dialog de configuration avancée du planificateur. Paramètres :
- `maxSolutions`, `timeoutSeconds`, `maxIterations`, `maxEliminations`
- `resourceSelection` : `'deterministic' | 'random'`
- **Pause déjeuner** : désactivée / fixe (`LunchBreakFixed`) / flottante (`LunchBreakFloating`)

La configuration est persistée dans `useSchedulerStore.schedulerConfig`.

## `components/planning/sidebar/SidebarLeft.tsx`

Wrapper léger qui commute entre `SidebarPreparation` et `SidebarAnalysis` selon la présence d'un résultat.

**`SidebarPreparation`** (pas de résultat) :
- Input semaine + bouton "Planifier" (`runSchedule('elimination')`) + `SchedulerConfigDialog`
- Liste draggable des cours (`CourseGroupList` + `useSidebarCourseDrag`)

**`SidebarAnalysis`** (résultat disponible) :
- Bouton "← Retour à la préparation" (avec dialog de confirmation)
- Barre de recherche (filtre calendrier via `searchQuery`)
- Panel des tâches neutralisées (draggables via `useNeutralizedDraggable`)
- Bouton export iCal

## Route handlers (`app/api/`)

Les routes handler Next.js sont de simples **proxies HTTP** vers l'API Express (port 3000, configurable via `SCHEDULER_API_URL`).  
Elles existent car le proxy `rewrites` de Next.js applique un timeout court incompatible avec les longues computations.

| Route Next.js | Route Express | Timeout |
|---|---|---|
| `POST /api/schedule` | `/api/schedule` | 5 minutes |
| `POST /api/schedule/v2` | `/api/schedule/v2` | 10 minutes |

> Ne pas confondre la route Next.js (`app/api/schedule/v2/route.ts`) avec la route Express — ce sont deux couches distinctes.

## Utilisation de `@edt-ts/scheduler-common` côté client

- `CourseTaskData`, `ResourceGroupData`, `ConstraintsData`, `TimeSlot`, `ResourceConstraints` : types de données, imports directs
- `TaskSolutionJSON`, `NeutralizedTaskInfoJSON` : types des réponses API
- `SchedulerConfig`, `LunchBreakFixed`, `LunchBreakFloating`, `DEFAULT_SCHEDULER_CONFIG` : configuration du planificateur
- `SchedulerData` : classe de base étendue par `ClientSchedulerData` (local, `lib/clientSchedulerData.ts`)
- `Task` : type de retour de `ClientSchedulerData.getTasksForWeek()` ; utile pour accéder aux `Resource` instances et dépendances
- `AvailabilityManager` : utilisé dans `useSchedulerStore` pour calculer les zones d'indisponibilité côté client
- `EnforcedData` : type pour les placements imposés

## shadcn/ui

- Style : `new-york` (utilise `radix-ui` meta-package)
- Import des composants ui : `import { Button } from '@/components/ui/button'`
- Utilitaire CSS : `import { cn } from '@/lib/utils'` (clsx + tailwind-merge)
- Ajouter un composant : `npx shadcn@latest add <composant>` depuis `packages/scheduler-client/`
  - ⚠️ Renommer temporairement `pnpm-lock.yaml` et `pnpm-workspace.yaml` avant d'exécuter la commande (conflit npm/pnpm)
- Composants disponibles : `button`, `card`, `select`, `tabs`, `dialog`, `badge`, `input`, `label`, `separator`, `scroll-area`, `alert`, `tooltip`
- Pattern modal shadcn : `<Dialog open={true} onOpenChange={(open) => !open && onClose()}>`

## Tailwind CSS v4 & thème

- Fichier `globals.css` contient les variables CSS OKLCH shadcn (`--background`, `--foreground`, `--primary`, etc.)
- `@import "tw-animate-css"` remplace `tailwindcss-animate`
- `@custom-variant dark (&:is(.dark *))` pour le support du mode sombre
- `@theme inline` mappe les variables CSS vers les tokens Tailwind
- Mode sombre activé via la classe `.dark` sur `<html>`

## Règles d'import

- Importer uniquement depuis `@edt-ts/scheduler-common` pour les types partagés
- Ne jamais importer depuis `@edt-ts/scheduler-core` ou `@edt-ts/scheduler-api`
- Utiliser le proxy Next.js route handlers (`app/api/`) pour toutes les requêtes vers l'API Express
- Utiliser l'alias `@/` pour tous les imports internes (résout vers la racine du package)
  - `@/components/planning/calendar/...` pour le calendrier FullCalendar
  - `@/components/planning/sidebar/...` pour les sidebars
  - `@/components/planning/courses/...` pour les composants de cours
  - `@/components/planning/modals/...` pour les modals
  - `@/components/constraints/...` pour les composants de la page Contraintes
  - `@/components/ui/...` pour les composants shadcn
  - `@/lib/calendar/...` pour les utilitaires calendrier (calendarUtils, blockedZones, yearColors)
  - `@/lib/api/...` pour les utilitaires API (scheduleApi, clientSchedulerData)
  - `@/lib/...` pour les autres utilitaires (parseCsvCourses, icalExport, etc.)
  - `@/store/...` pour les stores Zustand
  - `@/hooks/...` pour les hooks

## Conventions de code

- `'use client'` requis sur tous les composants qui utilisent des hooks React (`useState`, `useEffect`, etc.)
- TypeScript strict : pas de `any` implicite, typer toutes les réponses API avec les interfaces de `@edt-ts/scheduler-common`
- CSS uniquement via classes Tailwind — pas de styles inline sauf cas exceptionnel
- Composants fonctionnels React uniquement (pas de classes)
- Préférer les composants shadcn aux éléments HTML bruts pour les formulaires et les modales
- Ne pas mettre de logique métier dans les stores — elle va dans `lib/`
- `SidebarLeft` lit directement depuis `usePlanningStore` et `useSchedulerStore` (pas de props sauf `parsedCourses` et le groupBy UI local)
- `ScheduleCalendar` reçoit uniquement `solutions` et `parsedCourses` en props ; tout le reste vient des stores via `useCalendarCore`

## Tests unitaires (Vitest)

- Framework : **Vitest** + **@testing-library/react** + **jsdom**
- Config : `vitest.config.ts` (environment `jsdom`, setup `vitest.setup.ts`)
- Alias configurés dans `vitest.config.ts` :
  - `@edt-ts/scheduler-common` → `../scheduler-common/src/index.ts`
  - `@` → `.` (racine du package, pour `@/components/...`, `@/lib/...`)
- Dossier : `__tests__/`
- Convention de nommage : `<nom>.test.tsx` pour les composants, `<nom>.test.ts` pour les utilitaires
- Les tests doivent importer les matchers via le setup (`@testing-library/jest-dom`)

### Bonnes pratiques tests unitaires

- Tester le rendu des composants avec `render()` + assertions `screen.getBy*`
- Simuler les interactions avec `userEvent` (préférer à `fireEvent`)
- Mocker `fetch` avec `vi.fn()` pour les tests impliquant des appels réseau
- Ne pas tester les internals Next.js (routing, Image, etc.) — se concentrer sur le comportement utilisateur

## Tests E2E (Playwright)

- Framework : **Playwright** (`@playwright/test`)
- Config : `playwright.config.ts` (browser : Chromium, baseURL : `http://localhost:5173`)
- Dossier : `e2e/`
- Convention nommage : `<nom>.spec.ts`
- Le `webServer` Playwright démarre automatiquement `next build && next start` en mode CI

### Bonnes pratiques tests E2E

- Toujours mocker les appels API avec `page.route('/api/schedule', ...)` pour isoler le frontend
- Utiliser `page.getByRole()` et `page.getByLabel()` plutôt que les sélecteurs CSS fragiles
- Mettre les fixtures JSON (resources, courses) dans `e2e/fixtures/` quand les tests s'enrichissent

## Workflows package

- Dev : `npm run client:dev` (port 5173, proxy → API port 3000)
- Build : `npm run client:build`
- Typecheck : `npm run typecheck --workspace=packages/scheduler-client`
- Lint : `npm run lint --workspace=packages/scheduler-client`
- Tests unitaires : `npm run test --workspace=packages/scheduler-client`
- Tests unitaires watch : `npm run test:watch --workspace=packages/scheduler-client`
- Tests E2E : `npm run test:e2e --workspace=packages/scheduler-client`

## Fonctionnalité : Vacances scolaires & jours fériés

Implémentée dans `scheduler-client` uniquement. Ne concerne pas `scheduler-common` ni `scheduler-core`.

### Architecture

- **`lib/schoolHolidays.ts`** : types (`HolidayPeriod`, `SchoolYearConfig`), fonction `fetchSchoolHolidayConfig` (appel vers `/api/holidays`), `computeHolidayZonesForWeek` (calcul des `BlockedZone[]` pour une semaine ISO), `getAvailableSchoolYears`.
- **`app/api/holidays/route.ts`** : route Next.js GET `/api/holidays?year=YYYY-YYYY&zone=A|B|C`. Proxifie vers :
  - `data.education.gouv.fr` (vacances scolaires, filtré par zone et année scolaire)
  - `calendrier.api.gouv.fr` (jours fériés, métropole uniquement, pour les deux années civiles de l'année scolaire)
- **`store/useSchedulerStore.ts`** : champ `schoolYearConfig: SchoolYearConfig | null` persisté en localStorage.
- **`store/usePlanningStore.ts`** : `setSelectedWeek` pré-peuple `blockedZones` avec `computeHolidayZonesForWeek` si une config est chargée.
- **`lib/calendar/blockedZones.ts`** : `BlockedZone` étendu avec `label?: string` et `source?: 'manual' | 'vacation' | 'public-holiday'`.
- **`components/config/SchoolYearBlock.tsx`** : bloc UI sur `/config` (sélecteur d'année + zone A/B/C + bouton charger).
- **`hooks/useCalendarCore.ts`** : `blockEvts` utilise `source` pour différencier les couleurs (bleu = vacances, violet = férié, rouge = manuel). Transmet `blockedZoneSource` et `blockedZoneLabel` via `extendedProps`.
- **`components/planning/calendar/ScheduleCalendar.tsx`** : `renderEventContent` affiche 🏖️/🎌/🚫 et le libellé selon la source.

### Comportement

- Les zones vacances/fériés sont générées automatiquement à chaque `setSelectedWeek` depuis les données en store.
- Elles sont visuelles et non bloquantes (supprimables par clic comme les zones manuelles).
- Elles disparaissent si l'utilisateur les supprime, et réapparaissent au prochain changement de semaine.
- Jours fériés : métropole uniquement. Zones scolaires : A, B, C (France).
