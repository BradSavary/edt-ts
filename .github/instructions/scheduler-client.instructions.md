---
applyTo: "packages/scheduler-client/**"
---

# Copilot Instructions — scheduler-client

Le package `scheduler-client` est l'application web de planification. C'est un projet **Next.js (App Router)** avec TypeScript strict, Tailwind CSS v4, shadcn/ui, et un proxy vers l'API Express.

## Objectif du package

- Fournir une interface utilisateur pour soumettre des données de planification (resources, cours, contraintes) et visualiser les résultats
- Consommer uniquement `@edt-ts/scheduler-common` pour les types partagés (jamais `scheduler-core` ni `scheduler-api` directement)
- Servir d'application de démonstration et de test de l'API

## Architecture & structure

```
packages/scheduler-client/
  app/                          # Next.js App Router
    layout.tsx                  # Layout racine
    page.tsx                    # Page principale (planning)
    globals.css                 # Styles globaux (Tailwind + shadcn CSS vars OKLCH)
    constraints/
      page.tsx                  # Page gestion des contraintes
    api/
      schedule/
        route.ts                # Route handler POST /api/schedule (proxy → Express, 5min timeout)
        elimination/
          route.ts              # Route handler POST /api/schedule/elimination
  components/                   # Composants métier
    CourseCard.tsx              # Carte draggable d'un cours (sidebar gauche)
    CourseGroupList.tsx         # Liste groupée de cours (par code ou enseignant)
    ScheduleCalendar.tsx        # Calendrier FullCalendar principal
    modals/
      EnforceModal.tsx          # Modal de confirmation de placement imposé
      TaskEditModal.tsx         # Modal d'édition des ressources d'une tâche placée
    schedule/
      SidebarLeft.tsx           # Sidebar gauche (cours à placer + filtres)
      NeutralizedPanel.tsx      # Panel des cours neutralisés (drag externe)
    constraints/
      ConstraintsManager.tsx    # Gestionnaire complet des contraintes
      ResourceConstraintEditor.tsx  # Éditeur de contraintes par ressource
      TimeRangePicker.tsx       # Sélecteur plage horaire (AM/PM)
      AddResourceModal.tsx      # Modal ajout d'une ressource dans les contraintes
    ui/                         # Composants shadcn/ui (générés automatiquement)
  lib/                          # Utilitaires (framework-agnostic)
    utils.ts                    # Fonction cn() (clsx + tailwind-merge)
    calendarUtils.ts            # Helpers FullCalendar + détection conflits ressources
    blockedZones.ts             # Logique zones bloquées (soustraction de créneaux)
    parseCsvCourses.ts          # Parsing CSV des cours → CourseTaskData[]
    scheduleApi.ts              # Client API (runScheduleRequestFromData → POST /api/schedule)
    constraintsUtils.ts         # Utilitaires UI contraintes (DayMap, normalisation, export JSON)
    clientSchedulerData.ts      # Sous-classe ClientSchedulerData extends SchedulerData (toutes semaines, sans contraintes hebdomadaires)
  hooks/
    useNeutralizedDraggable.ts  # FullCalendar Draggable pour les tâches neutralisées
    useSidebarCourseDrag.ts     # FullCalendar Draggable + conflits pour la sidebar cours
  store/
    useSchedulerStore.ts        # Store persisté (allCourses, resources, constraints, availabilityManager, clientSchedulerData)
    usePlanningStore.ts         # Store session (semaine, résultat, solution active, enforced, blockedZones)
    slices/
      constraintsSlice.ts       # Slice Zustand pour les contraintes (avec persist)
  __tests__/                    # Tests unitaires (Vitest + Testing Library)
  e2e/                          # Tests E2E (Playwright)
  public/                       # Assets statiques
```

## Architecture des stores Zustand

L'état global est **séparé en deux stores** :

### `useSchedulerStore` — données persistées (localStorage `edt-scheduler`)
- `allCourses: CourseTaskData[]` — tous les cours parsés du CSV (toutes semaines)
- `resources: ResourceGroupData[]` — ressources chargées depuis resources.json
- `constraints: ConstraintsRecord` — contraintes de disponibilité (Zustand persist)
- `resourceWeeks: Record<string, number[]>` — semaines actives par ressource (du CSV)

**Champs non persistés** (reconstruits côté client uniquement via `subscribe` + initialisation immédiate) :
- `availabilityManager: AvailabilityManager | null` — reconstruit quand `constraints` change ; utilisé par `computeConstraintUnavailableZones` pour les zones de drag
- `clientSchedulerData: ClientSchedulerData | null` — instance `lib/clientSchedulerData.ts`, reconstruit quand `allCourses` ou `resources` change ; expose `getTasksForWeek(week) → Task[]` (objets riches avec `Resource` instances et dépendances CM→TD→TP) ; pertinent pour validation côté client et planification future hors réseau

### `usePlanningStore` — état de session (non persisté)
- `selectedWeek`, `setSelectedWeek` — semaine ISO courante
- `scheduleResult`, `activeSolution`, `activeNeutralizedTasks` — résultat et vue courante
- `enforcedMap` — placements imposés (courseKey → EnforcedData)
- `blockedZones` — zones bloquées (plages indisponibles créées manuellement)
- `taskOverrides` — overrides de position/ressources pour les tâches déplacées manuellement
- `placedNeutralizedTasks` — tâches neutralisées replacées sur le calendrier via drag
- `isLoading`, `status` — feedback UI
- `runSchedule(mode)` — déclenche l'appel API via `runScheduleRequestFromData`

**Ne jamais ajouter de logique métier** directement dans les stores. Les stores orchestrent ; la logique reste dans `lib/`.

## Flux de données principal

```
CSV (coursesCsvFile)  →  parseCsvCoursesAll()  →  useSchedulerStore.allCourses
JSON (resourcesFile)  →  JSON.parse()           →  useSchedulerStore.resources
Contraintes UI        →  constraintsSlice        →  useSchedulerStore.constraints
                                                        ↓
                                              AvailabilityManager (auto-reconstruit si constraints change)
                                              ClientSchedulerData  (auto-reconstruit si allCourses/resources change)
                                                └→ getTasksForWeek(week) → Task[] (validation client, futur hors-réseau)
                                                        ↓
usePlanningStore.runSchedule()  →  runScheduleRequestFromData()  →  POST /api/schedule
                                                        ↓
                                               scheduleResult → activeSolution → ScheduleCalendar
```

## Utilisation de `@edt-ts/scheduler-common` côté client

- `CourseTaskData`, `ResourceGroupData`, `ConstraintsData`, `TimeSlot`, `ResourceConstraints` : types de données, imports directs
- `TaskSolutionJSON`, `ScheduleSolutionJSON` : types des réponses API
- `SchedulerData` : classe de base étendue par `ClientSchedulerData` (local, `lib/clientSchedulerData.ts`)
- `Task` : type de retour de `ClientSchedulerData.getTasksForWeek()` ; utile pour accéder aux `Resource` instances et dépendances
- `AvailabilityManager` : utilisé dans `useSchedulerStore` pour calculer les zones d'indisponibilité côté client
- `EnforcedData` : type pour les placements imposés

## `lib/clientSchedulerData.ts`

Sous-classe de `SchedulerData` pour le client. Permet de charger **l'ensemble des cours** (toutes semaines) sans appliquer de contraintes hebdomadaires sur les ressources.

- `initAllTasks(courses: CourseTaskData[])` — charge toutes les tâches sans `applyConstraintsForWeek` ; **requiert `initResources()` au préalable**
- `getTasksForWeek(week: number): Task[]` — filtre les tâches par semaine ISO

L'instance est maintenue dans `useSchedulerStore.clientSchedulerData`, reconstruit automatiquement quand `allCourses` ou `resources` change. Les consommateurs la lisent via :
```ts
const csd = useSchedulerStore(s => s.clientSchedulerData);
const tasks = csd?.getTasksForWeek(47) ?? [];
```

> Note : retourne `Task[]` (objets riches), pas `CourseTaskData[]`. À ne pas confondre avec `allCourses.filter(c => c.week === w)` qui retourne des données brutes.

## `lib/constraintsUtils.ts`

Utilitaires **UI** pour la gestion des contraintes. N'est **pas** responsable du stockage (géré par Zustand persist).

Types UI spécifiques au client :
- `ResourceTypeUI` (`'teacher' | 'room' | 'group' | 'other'`) — distinct de `ResourceType` de `common` (ajoute `'other'`)
- `DayMap`, `DayName`, `DaySlot`, `DAYS` — format par-jour pour l'éditeur de contraintes

## `lib/scheduleApi.ts`

Une seule fonction publique : **`runScheduleRequestFromData(params)`**.  
Elle prend les données déjà en mémoire (depuis les stores), construit le payload et appelle `POST /api/schedule` ou `/api/schedule/elimination`.

> Ne pas recréer une variante File-based (ex-`runScheduleRequest`) — les fichiers sont lus dans `page.tsx` et stockés dans le store avant l'appel.

## Route handlers (`app/api/`)

Les routes handler Next.js sont de simples **proxies HTTP** vers l'API Express (port 3000).  
Elles existent car le proxy `rewrites` de Next.js applique un timeout court incompatible avec les longues computations.  
Timeout : 5 minutes (`AbortSignal.timeout(300_000)`).

## shadcn/ui

- Style : `new-york` (utilise `radix-ui` meta-package)
- Import des composants ui : `import { Button } from '@/components/ui/button'`
- Utilitaire CSS : `import { cn } from '@/lib/utils'` (clsx + tailwind-merge)
- Ajouter un composant : `npx shadcn@latest add <composant>` depuis `packages/scheduler-client/`
  - ⚠️ Renommer temporairement `pnpm-lock.yaml` et `pnpm-workspace.yaml` avant d'exécuter la commande (conflit npm/pnpm)
- Composants disponibles : `button`, `card`, `select`, `tabs`, `dialog`, `badge`, `input`, `label`, `separator`, `scroll-area`, `alert`
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
  - `@/components/...` pour les composants métier
  - `@/components/ui/...` pour les composants shadcn
  - `@/lib/...` pour les utilitaires
  - `@/store/...` pour les stores Zustand
  - `@/hooks/...` pour les hooks

## Conventions de code

- `'use client'` requis sur tous les composants qui utilisent des hooks React (`useState`, `useEffect`, etc.)
- TypeScript strict : pas de `any` implicite, typer toutes les réponses API avec les interfaces de `@edt-ts/scheduler-common`
- CSS uniquement via classes Tailwind — pas de styles inline sauf cas exceptionnel
- Composants fonctionnels React uniquement (pas de classes)
- Préférer les composants shadcn aux éléments HTML bruts pour les formulaires et les modales

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
