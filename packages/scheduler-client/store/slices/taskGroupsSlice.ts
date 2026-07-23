import type { EnforcedData } from '@edt-ts/scheduler-common';
import type { StateCreator } from 'zustand';
import type { TaskGroupConfig, GroupType } from '@/lib/taskGroupUtils';

export interface TaskGroupsSlice {
  /** Groupes de tâches définis pour la session courante (non persistés). */
  taskGroups: TaskGroupConfig[];
  /** Map des enforcements manuels (sans auto-propagation de groupes). */
  manualEnforcedMap: Record<string, EnforcedData>;

  addTaskGroup: (type: GroupType, courseKey?: string) => string;
  removeTaskGroup: (groupId: string) => void;
  addCourseToGroup: (groupId: string, courseKey: string) => void;
  removeCourseFromGroup: (groupId: string, courseKey: string) => void;
  setGroupType: (groupId: string, type: GroupType) => void;
  reorderCourseInGroup: (groupId: string, fromIndex: number, toIndex: number) => void;
}

export const createTaskGroupsSlice: StateCreator<TaskGroupsSlice> = (set, get) => ({
  taskGroups: [],
  manualEnforcedMap: {},

  addTaskGroup: (type, courseKey) => {
    const id = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({
      taskGroups: [
        { id, type, courseKeys: courseKey ? [courseKey] : [] },
        ...state.taskGroups,
      ],
    }));
    return id;
  },

  removeTaskGroup: (groupId) => {
    set((state) => ({ taskGroups: state.taskGroups.filter((g) => g.id !== groupId) }));
  },

  addCourseToGroup: (groupId, courseKey) => {
    set((state) => {
      const alreadyInGroup = state.taskGroups.some((g) => g.courseKeys.includes(courseKey));
      if (alreadyInGroup) return {};
      return {
        taskGroups: state.taskGroups.map((g) =>
          g.id === groupId && !g.courseKeys.includes(courseKey)
            ? { ...g, courseKeys: [...g.courseKeys, courseKey] }
            : g,
        ),
      };
    });
  },

  removeCourseFromGroup: (groupId, courseKey) => {
    set((state) => ({
      taskGroups: state.taskGroups
        .map((g) =>
          g.id === groupId ? { ...g, courseKeys: g.courseKeys.filter((k) => k !== courseKey) } : g,
        )
        .filter((g) => g.courseKeys.length > 0),
    }));
  },

  setGroupType: (groupId, type) => {
    set((state) => ({
      taskGroups: state.taskGroups.map((g) => (g.id === groupId ? { ...g, type } : g)),
    }));
  },

  reorderCourseInGroup: (groupId, fromIndex, toIndex) => {
    set((state) => ({
      taskGroups: state.taskGroups.map((g) => {
        if (g.id !== groupId) return g;
        const keys = [...g.courseKeys];
        const [moved] = keys.splice(fromIndex, 1);
        keys.splice(toIndex, 0, moved);
        return { ...g, courseKeys: keys };
      }),
    }));
  },
});
