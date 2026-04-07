```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                           MONOREPO edt-ts                                        ║
╚══════════════════════════════════════════════════════════════════════════════════╝

┌─────────────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│  scheduler-client   │     │   scheduler-api      │     │   scheduler-core     │
│  (Next.js, browser) │────▶│   (Express REST)     │────▶│   (moteur TS/Node)   │
└─────────────────────┘     └─────────────────────┘     └──────────────────────┘
          │                           │                             │
          └───────────────────────────┴─────────────────────────── ┘
                                      │
                          ┌───────────▼──────────┐
                          │  scheduler-common     │
                          │  (types partagés)     │
                          │  ─────────────────    │
                          │  RawScheduleData      │
                          │  CourseTaskData       │
                          │  ConstraintsData      │
                          │  TaskSolutionJSON     │
                          │  ScheduleSolutionJSON │
                          │  SchedulerData (cls)  │
                          └──────────────────────┘


╔══════════════════════════════════════════════════════════════════════════════════╗
║                      scheduler-client — Architecture interne                     ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  ROUTES (App Router)
  ───────────────────
  /              ── (config)/page.tsx       ── Import CSV, ressources, thème, couleurs
  /constraints   ── constraints/page.tsx    ── Gestion des contraintes horaires
  /planning      ── planning/page.tsx       ── Préparation, planification, export


  STORES ZUSTAND
  ──────────────

  ┌─────────────────────────────────────────────────────────────────┐
  │  useSchedulerStore                          [persist localStorage]
  │  ─────────────────                                               │
  │  allCourses: CourseTaskData[]    ← parseCsvCourses()            │
  │  resources:  ResourceGroupData[] ← import JSON                  │
  │  constraints: ConstraintsData    ← ConstraintsManager           │
  │  theme, colorScheme                                              │
  │                                                                  │
  │  schedulerData: SchedulerData | null  (dérivé, non persisté)    │
  │   └─ reconstruit depuis allCourses+resources+constraints        │
  └─────────────────────────────────────────────────────────────────┘
                          ▲                   ▲
                          │ lit               │ lit
              ┌───────────┴──┐        ┌───────┴──────────┐
              │ (config)/    │        │ /constraints      │
              │  page.tsx    │        │  ConstraintsMgr   │
              └──────────────┘        └──────────────────┘

  ┌─────────────────────────────────────────────────────────────────┐
  │  usePlanningStore                           [session, non persisté]
  │  ────────────────                                                │
  │  selectedWeek: number | null                                     │
  │  enforcedMap: Record<string, EnforcedData>                      │
  │  blockedZones: BlockedZone[]                                     │
  │                                                                  │
  │  scheduleResult: ScheduleResult | null   ← API (immuable)       │
  │  selectedSolutionIndex: number                                   │
  │                                                                  │
  │  activeSolution: TaskSolutionJSON[]      ← copie mutable        │
  │  activeNeutralizedTasks: TaskSolutionJSON[]                      │
  └─────────────────────────────────────────────────────────────────┘
                          ▲
                          │ lit + écrit
              ┌───────────┴──────────────────────────────┐
              │  /planning/page.tsx                       │
              │  ├── SidebarLeft                          │
              │  │    └── CourseGroupList > CourseCard    │
              │  ├── ScheduleCalendar (FullCalendar)      │
              │  │    ├── EnforceModal                    │
              │  │    └── TaskEditModal                   │
              │  └── NeutralizedPanel                     │
              └──────────────────────────────────────────┘


  FLUX DE DONNÉES
  ───────────────

  [Fichier CSV] ──parseCsvCourses()──▶ allCourses ──┐
  [JSON resources] ───────────────────▶ resources ──┼──▶ SchedulerData (instance)
  [ConstraintsManager] ───────────────▶ constraints ┘

  [runSchedule()] ──────────────────────────────────────────────────────────────▶
      payload = { week, resources, courses.filter(week), constraints+blockedZones }
                                   POST /api/schedule (proxy Next.js → Express :3000)
                                                                                  │
  scheduleResult ◀─────────────────────────────────── ScheduleSolutionJSON[] ◀──┘
       │
       │ selectSolution(i)
       ▼
  activeSolution: TaskSolutionJSON[]  ←── mutations UI (drag, TaskEditModal)
       │
       │ export
       ▼
  iCal  (getMondayOfISOWeek + startTime + duration → VEVENT)


  PERSISTANCE
  ───────────

  localStorage
    ├── scheduler-store  →  allCourses, resources, constraints, theme, colorScheme
    └── (constraints)    →  déjà géré, migré dans scheduler-store

  Session (mémoire uniquement)
    └── planning-store   →  scheduleResult, activeSolution, enforcedMap, blockedZones
```
