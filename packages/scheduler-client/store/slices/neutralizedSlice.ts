import type { NeutralizedTaskInfoJSON } from '@edt-ts/scheduler-common';
import type { StateCreator } from 'zustand';
import type { ManuallyNeutralizedTask } from '@/store/types';

export interface NeutralizedSlice {
  /** Clés (indices dans parsedCourses) des tâches pré-neutralisées avant planification. */
  preNeutralizedKeys: string[];
  togglePreNeutralized: (courseKey: string) => void;
  /** Tâches planifiées déposées dans la zone de neutralisation ("pioche"). */
  manuallyNeutralizedTasks: ManuallyNeutralizedTask[];
  addManuallyNeutralizedTask: (task: ManuallyNeutralizedTask) => void;
  removeManuallyNeutralizedTask: (taskId: string) => void;
  /** Entrées synthétiques pour les tâches pré-neutralisées (communes à toutes les solutions). */
  syntheticNeutralizedTasks: NeutralizedTaskInfoJSON[];
}

export const createNeutralizedSlice: StateCreator<NeutralizedSlice> = (set) => ({
  preNeutralizedKeys: [],
  togglePreNeutralized: (courseKey) => {
    set((state) => ({
      preNeutralizedKeys: state.preNeutralizedKeys.includes(courseKey)
        ? state.preNeutralizedKeys.filter((k) => k !== courseKey)
        : [...state.preNeutralizedKeys, courseKey],
    }));
  },
  manuallyNeutralizedTasks: [],
  addManuallyNeutralizedTask: (task) => {
    set((state) => ({
      manuallyNeutralizedTasks: [
        ...state.manuallyNeutralizedTasks.filter((t) => t.taskId !== task.taskId),
        task,
      ],
    }));
  },
  removeManuallyNeutralizedTask: (taskId) => {
    set((state) => ({
      manuallyNeutralizedTasks: state.manuallyNeutralizedTasks.filter((t) => t.taskId !== taskId),
    }));
  },
  syntheticNeutralizedTasks: [],
});
