import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StateCreator } from 'zustand';
import { createConstraintsSlice, type ConstraintsSlice } from './slices/constraintsSlice';
import type { CourseTaskData, ResourceGroupData } from '@edt-ts/scheduler-common';

// ── Slice : données brutes du planificateur ────────────────────────────────
// allCourses et resources sont persistés (localStorage "scheduler-store").
// theme / colorScheme sont des emplacements reservés pour une prochaine itération.

interface SchedulerDataSlice {
  allCourses: CourseTaskData[];
  resources: ResourceGroupData[];
  theme: string;
  colorScheme: string;
  setCourses: (courses: CourseTaskData[]) => void;
  setResources: (resources: ResourceGroupData[]) => void;
  setTheme: (theme: string) => void;
  setColorScheme: (scheme: string) => void;
}

// ── Store combiné ──────────────────────────────────────────────────────────
// Correspond conceptuellement à SchedulerData côté serveur (common).
// Future : ajouter usePlanningStore (session, non persisté) pour les données de travail.

export type SchedulerStore = ConstraintsSlice & SchedulerDataSlice;

export const useSchedulerStore = create<SchedulerStore>()(
  persist(
    (set, get, api) => ({
      ...(createConstraintsSlice as StateCreator<SchedulerStore, [], [], ConstraintsSlice>)(set, get, api),

      // Scheduler data slice
      allCourses: [], // cours importés (ou localStorage si déjà persisté)
      resources: [], // ressources importées (ou localStorage si déjà persisté)
      theme: 'light',
      colorScheme: 'default',
      setCourses: (allCourses) => set({ allCourses }),
      setResources: (resources) => set({ resources }),
      setTheme: (theme) => set({ theme }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
    }),
    {
      name: 'edt-scheduler',
      // Persisté : données brutes rechargées entre sessions
      partialize: (state) => ({
        constraints: state.constraints,  // contraintes depuis createConstraintsSlice
        resourceWeeks: state.resourceWeeks,   // semaines des ressources (alimenté par useScheduleState)
        allCourses: state.allCourses,   // cours importés
        resources: state.resources,     // ressources importées
        theme: state.theme,
        colorScheme: state.colorScheme,
      }),
    },
  ),
);
