import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StateCreator } from 'zustand';
import { createConstraintsSlice, type ConstraintsSlice } from './slices/constraintsSlice';
import type { CourseTaskData, ResourceGroupData } from '@edt-ts/scheduler-common';

// ── Slice : données brutes du planificateur ────────────────────────────────
// allCourses, resources, constraints sont persistés (localStorage "edt-scheduler").

interface SchedulerDataSlice {
  allCourses: CourseTaskData[];
  resources: ResourceGroupData[];
  coursesFileName: string | null;
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
