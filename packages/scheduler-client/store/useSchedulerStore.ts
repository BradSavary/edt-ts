import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StateCreator } from 'zustand';
import { createConstraintsSlice, type ConstraintsSlice } from './slices/constraintsSlice';
import type { CourseTaskData, ResourceGroupData, ConstraintsData, SchedulerConfig } from '@edt-ts/scheduler-common';
import { AvailabilityManager, DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';
import { ClientSchedulerData } from '../lib/api/clientSchedulerData';
import { type YearColorConfig, DEFAULT_YEAR_COLORS } from '../lib/calendar/yearColors';
import type { SchoolYearConfig } from '../lib/schoolHolidays';

// ── Slice : données brutes du planificateur ────────────────────────────────
// allCourses, resources, constraints sont persistés (localStorage "edt-scheduler").
// availabilityManager est NON persisté : reconstruit automatiquement via subscribe
// dès que constraints change, côté client uniquement.

interface SchedulerDataSlice {
  allCourses: CourseTaskData[];
  resources: ResourceGroupData[];
  coursesFileName: string | null;
  schedulerConfig: SchedulerConfig;
  yearColorConfig: YearColorConfig;
  /** Configuration année scolaire + vacances/jours fériés (persistée) */
  schoolYearConfig: SchoolYearConfig | null;
  /** Instance reconstruite depuis constraints — non persistée, jamais null si constraints non vide */
  availabilityManager: AvailabilityManager | null;
  /** Instance ClientSchedulerData — non persistée, reconstruite quand allCourses ou resources change */
  clientSchedulerData: ClientSchedulerData | null;
  setCourses: (courses: CourseTaskData[], fileName?: string) => void;
  setResources: (resources: ResourceGroupData[]) => void;
  addCourse: (course: CourseTaskData) => void;
  removeCourse: (index: number) => void;
  setSchedulerConfig: (config: SchedulerConfig) => void;
  setYearColorConfig: (config: YearColorConfig) => void;
  setSchoolYearConfig: (config: SchoolYearConfig | null) => void;
}

// ── Store combiné ──────────────────────────────────────────────────────────
// Correspond conceptuellement à SchedulerData côté serveur (common).
// usePlanningStore (session, non persisté) contient les données de travail.

export type SchedulerStore = ConstraintsSlice & SchedulerDataSlice;

export const useSchedulerStore = create<SchedulerStore>()(
  persist(
    (set, get, api) => ({
      ...(createConstraintsSlice as StateCreator<SchedulerStore, [], [], ConstraintsSlice>)(set, get, api),

      // Scheduler data slice
      allCourses: [],
      resources: [],
      coursesFileName: null,
      schedulerConfig: DEFAULT_SCHEDULER_CONFIG,
      yearColorConfig: DEFAULT_YEAR_COLORS,
      schoolYearConfig: null,
      availabilityManager: null, // Reconstruit par subscribe ci-dessous
      clientSchedulerData: null, // Reconstruit par subscribe ci-dessous
      setCourses: (allCourses, fileName) => set({ allCourses, ...(fileName !== undefined ? { coursesFileName: fileName } : {}) }),
      setResources: (resources) => set({ resources }),
      addCourse: (course) => set((state) => ({ allCourses: [...state.allCourses, course] })),
      removeCourse: (index) => set((state) => ({ allCourses: state.allCourses.filter((_, i) => i !== index) })),
      setSchedulerConfig: (schedulerConfig) => set({ schedulerConfig }),
      setYearColorConfig: (yearColorConfig) => set({ yearColorConfig }),
      setSchoolYearConfig: (schoolYearConfig) => set({ schoolYearConfig }),
    }),
    {
      name: 'edt-scheduler',
      partialize: (state) => ({
        constraints: state.constraints,
        allCourses: state.allCourses,
        resources: state.resources,
        coursesFileName: state.coursesFileName,
        schedulerConfig: state.schedulerConfig,
        yearColorConfig: state.yearColorConfig,
        schoolYearConfig: state.schoolYearConfig,
      }),
    },
  ),
);

// ── Rebuild availabilityManager côté client uniquement ────────────────────
// Exécuté seulement dans le browser : le serveur Next.js (SSR) n'a pas window.
// Le middleware persist hydrate depuis localStorage puis déclenche setState,
// ce qui provoque le subscribe et construit le premier AvailabilityManager.
// Ensuite, chaque modification de constraints via constraintsSlice le reconstruit.

function buildClientSchedulerData(state: SchedulerStore): ClientSchedulerData | null {
  if (state.allCourses.length === 0 || state.resources.length === 0) return null;
  const data = new ClientSchedulerData();
  data.initResources(state.resources);
  data.initAllTasks(state.allCourses);
  return data;
}

if (typeof window !== 'undefined') {
  // Reconstruit l'AvailabilityManager à chaque changement de constraints.
  // Toujours créé (même avec constraints vides) pour que computeConstraintUnavailableZones
  // fonctionne dès le premier drag — les ressources sans contrainte définie seront ignorées.
  // Reconstruit le ClientSchedulerData à chaque changement de allCourses ou resources.
  useSchedulerStore.subscribe((state, prevState) => {
    const updates: Record<string, unknown> = {};
    if (state.constraints !== prevState.constraints) {
      updates.availabilityManager = new AvailabilityManager(state.constraints as ConstraintsData);
    }
    if (state.allCourses !== prevState.allCourses || state.resources !== prevState.resources) {
      updates.clientSchedulerData = buildClientSchedulerData(state);
    }
    if (Object.keys(updates).length > 0) {
      useSchedulerStore.setState(updates as Partial<SchedulerStore>);
    }
  });

  // Initialisation immédiate : gère le cas où persist a déjà hydraté le store
  // avant que le subscribe soit installé (navigation SPA, hot-reload).
  const initialState = useSchedulerStore.getState();
  useSchedulerStore.setState({
    availabilityManager: new AvailabilityManager(initialState.constraints as ConstraintsData),
    clientSchedulerData: buildClientSchedulerData(initialState),
  });
}
