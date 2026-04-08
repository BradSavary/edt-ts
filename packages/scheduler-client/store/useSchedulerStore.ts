import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StateCreator } from 'zustand';
import { createConstraintsSlice, type ConstraintsSlice } from './slices/constraintsSlice';
import type { CourseTaskData, ResourceGroupData, ConstraintsData } from '@edt-ts/scheduler-common';
import { AvailabilityManager } from '@edt-ts/scheduler-common';

// ── Slice : données brutes du planificateur ────────────────────────────────
// allCourses, resources, constraints sont persistés (localStorage "edt-scheduler").
// availabilityManager est NON persisté : reconstruit automatiquement via subscribe
// dès que constraints change, côté client uniquement.

interface SchedulerDataSlice {
  allCourses: CourseTaskData[];
  resources: ResourceGroupData[];
  coursesFileName: string | null;
  /** Instance reconstruite depuis constraints — non persistée, jamais null si constraints non vide */
  availabilityManager: AvailabilityManager | null;
  setCourses: (courses: CourseTaskData[], fileName?: string) => void;
  setResources: (resources: ResourceGroupData[]) => void;
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
      availabilityManager: null, // Reconstruit par subscribe ci-dessous
      setCourses: (allCourses, fileName) => set({ allCourses, ...(fileName !== undefined ? { coursesFileName: fileName } : {}) }),
      setResources: (resources) => set({ resources }),
    }),
    {
      name: 'edt-scheduler',
      // Non persisté : saveNotice, constraintsInitialized
      partialize: (state) => ({
        constraints: state.constraints,
        resourceWeeks: state.resourceWeeks,
        allCourses: state.allCourses,
        resources: state.resources,
        coursesFileName: state.coursesFileName,
      }),
    },
  ),
);

// ── Rebuild availabilityManager côté client uniquement ────────────────────
// Exécuté seulement dans le browser : le serveur Next.js (SSR) n'a pas window.
// Le middleware persist hydrate depuis localStorage puis déclenche setState,
// ce qui provoque le subscribe et construit le premier AvailabilityManager.
// Ensuite, chaque modification de constraints via constraintsSlice le reconstruit.

if (typeof window !== 'undefined') {
  // Reconstruit l'AvailabilityManager à chaque changement de constraints.
  // Toujours créé (même avec constraints vides) pour que computeConstraintUnavailableZones
  // fonctionne dès le premier drag — les ressources sans contrainte définie seront ignorées.
  useSchedulerStore.subscribe((state, prevState) => {
    if (state.constraints !== prevState.constraints) {
      useSchedulerStore.setState({
        availabilityManager: new AvailabilityManager(state.constraints as ConstraintsData),
      });
    }
  });

  // Initialisation immédiate : gère le cas où persist a déjà hydraté le store
  // avant que le subscribe soit installé (navigation SPA, hot-reload).
  const initialConstraints = useSchedulerStore.getState().constraints;
  useSchedulerStore.setState({
    availabilityManager: new AvailabilityManager(initialConstraints as ConstraintsData),
  });
}
