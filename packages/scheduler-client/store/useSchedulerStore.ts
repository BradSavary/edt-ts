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
  /** Taux de remplissage (demande/dispo) pour le niveau 'tight' dans analyzeConstraints (défaut : 0.5) */
  tightThreshold: number;
  /** Taux de remplissage pour le niveau 'critical' dans analyzeConstraints (défaut : 1.0) */
  criticalThreshold: number;
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
  setTightThreshold: (threshold: number) => void;
  setCriticalThreshold: (threshold: number) => void;
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
      tightThreshold: 0.5,
      criticalThreshold: 1.0,
      availabilityManager: null, // Reconstruit par subscribe ci-dessous
      clientSchedulerData: null, // Reconstruit par subscribe ci-dessous
      setCourses: (allCourses, fileName) => set({ allCourses, ...(fileName !== undefined ? { coursesFileName: fileName } : {}) }),
      setResources: (resources) => set({ resources }),
      addCourse: (course) => set((state) => ({ allCourses: [...state.allCourses, course] })),
      removeCourse: (index) => set((state) => ({ allCourses: state.allCourses.filter((_, i) => i !== index) })),
      setSchedulerConfig: (schedulerConfig) => set({ schedulerConfig }),
      setYearColorConfig: (yearColorConfig) => set({ yearColorConfig }),
      setSchoolYearConfig: (schoolYearConfig) => set({ schoolYearConfig }),
      setTightThreshold: (tightThreshold) => set({ tightThreshold }),
      setCriticalThreshold: (criticalThreshold) => set({ criticalThreshold }),
    }),
    {
      name: 'edt-scheduler',
      partialize: (state) => ({
        constraints: state.constraints,
        resourceWeeks: state.resourceWeeks,
        allCourses: state.allCourses,
        resources: state.resources,
        coursesFileName: state.coursesFileName,
        schedulerConfig: state.schedulerConfig,
        yearColorConfig: state.yearColorConfig,
        schoolYearConfig: state.schoolYearConfig,
        tightThreshold: state.tightThreshold,
        criticalThreshold: state.criticalThreshold,
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

/**
 * Normalise constraints avant de passer à AvailabilityManager :
 * - Default doit être TimeSlot[] (AvailabilityManager ne supporte pas ResourceConstraints pour Default)
 * - Les ressources null (héritant de Default) reçoivent le ResourceConstraints complet de Default
 *   pour que les overrides hebdomadaires de Default soient appliqués correctement pendant le drag.
 */
function normalizeConstraintsForAM(constraints: ConstraintsSlice['constraints']): ConstraintsData {
  const result = { ...constraints } as ConstraintsData;
  const d = result.Default;

  if (d === undefined || Array.isArray(d)) {
    // Default est déjà TimeSlot[] ou absent — pas de changement
    return result;
  }

  // Default est un ResourceConstraints — extraire la base pour la clé Default
  const defaultRC = d as import('@edt-ts/scheduler-common').ResourceConstraints;
  result.Default = (defaultRC.default ?? []) as import('@edt-ts/scheduler-common').TimeSlot[];

  // Propager le ResourceConstraints complet aux ressources qui héritent de Default (valeur null)
  // Ainsi, AvailabilityManager applique les overrides hebdomadaires de Default pour ces ressources
  for (const [resourceId, v] of Object.entries(result)) {
    if (resourceId === 'Default') continue;
    if (v === null) {
      result[resourceId] = defaultRC;
    }
  }

  return result;
}

if (typeof window !== 'undefined') {
  // Reconstruit l'AvailabilityManager à chaque changement de constraints.
  // Toujours créé (même avec constraints vides) pour que computeConstraintUnavailableZones
  // fonctionne dès le premier drag — les ressources sans contrainte définie seront ignorées.
  // Reconstruit le ClientSchedulerData à chaque changement de allCourses ou resources.
  useSchedulerStore.subscribe((state, prevState) => {
    const updates: Record<string, unknown> = {};
    if (state.constraints !== prevState.constraints) {
      updates.availabilityManager = new AvailabilityManager(normalizeConstraintsForAM(state.constraints));
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
    availabilityManager: new AvailabilityManager(normalizeConstraintsForAM(initialState.constraints)),
    clientSchedulerData: buildClientSchedulerData(initialState),
  });
}
