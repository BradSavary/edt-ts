import { create } from 'zustand';
import type { EnforcedData, TaskSolutionJSON, NeutralizedTaskInfoJSON, ConstraintsData, GroupType } from '@edt-ts/scheduler-common';
import type { BlockedZone } from '@/lib/blockedZones';
import { runScheduleRequestFromData, buildScheduleStatus, type ScheduleResult, type ScheduleStatus } from '@/lib/scheduleApi';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { type TaskGroupConfig, buildTaskGroupDeclarations, getCourseGroupInfo, computeGroupEnforcements } from '@/lib/taskGroupUtils';

export type { TaskGroupConfig };

export type Status = ScheduleStatus;

/**
 * Override de position et/ou de ressources pour une tâche placée manuellement
 * via drag-and-drop ou édition dans le calendrier.
 */
export interface PlacedTaskOverride {
  startTime: number;
  teachers: string[];
  groups: string[];
  rooms: string[];
}

/**
 * Tâche neutralisée placée manuellement sur le calendrier.
 * Contient les données complètes nécessaires à l'affichage.
 */
export interface PlacedNeutralizedTask {
  taskId: string;
  code: string;
  name: string;
  type: string;
  startTime: number; // minutes depuis lundi minuit
  duration: number;
  teachers: string[];
  groups: string[];
  rooms: string[];
}

// ── Interface ──────────────────────────────────────────────────────────────
// Contient les données "de travail" de la session : non persistées.

export interface PlanningStore {
  // Sélection de la semaine
  selectedWeek: number | null;
  setSelectedWeek: (week: number | null) => void;

  // Résultat de planification (immuable, vient de l'API)
  scheduleResult: ScheduleResult | null;
  selectedSolutionIndex: number;
  setSelectedSolutionIndex: (index: number) => void;

  // Vues dérivées du résultat (mutables via l'UI — drag, édition)
  activeSolution: TaskSolutionJSON[];
  activeNeutralizedTasks: NeutralizedTaskInfoJSON[];

  /** Overrides de position/ressources pour les tâches de activeSolution modifiées manuellement. */
  taskOverrides: Record<string, PlacedTaskOverride>;
  /** Tâches neutralisées placées manuellement sur le calendrier. */
  placedNeutralizedTasks: PlacedNeutralizedTask[];

  // Filtrage
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Contraintes de session
  enforcedMap: Record<string, EnforcedData>;
  blockedZones: BlockedZone[];

  // Statut UI
  isLoading: boolean;
  status: Status | null;

  /** Ressources du cours en cours de drag depuis une source externe (sidebar ou panel neutralisé). */
  draggingExternal: { teachers: string[]; groups: string[]; rooms: string[]; courseKey?: string } | null;
  setDraggingExternal: (r: { teachers: string[]; groups: string[]; rooms: string[]; courseKey?: string } | null) => void;

  // ── Groupes de tâches ──────────────────────────────────────────────────
  /** Map des enforcements manuels (sans auto-propagation de groupes). */
  manualEnforcedMap: Record<string, EnforcedData>;
  /** Groupes de tâches définis pour la session courante (non persistés). */
  taskGroups: TaskGroupConfig[];
  addTaskGroup: (type: GroupType, courseKey?: string) => string;
  removeTaskGroup: (groupId: string) => void;
  addCourseToGroup: (groupId: string, courseKey: string) => void;
  removeCourseFromGroup: (groupId: string, courseKey: string) => void;
  setGroupType: (groupId: string, type: GroupType) => void;
  reorderCourseInGroup: (groupId: string, fromIndex: number, toIndex: number) => void;

  // ── Actions ──────────────────────────────────────────────────────────────

  // Planification
  runSchedule: (mode: 'standard' | 'elimination') => Promise<void>;

  // Cours forcés (reçoit la map MANUELLE — la propagation de groupes est calculée automatiquement)
  handleEnforceChange: (map: Record<string, EnforcedData>) => void;

  // Zones bloquées
  handleBlockedZoneAdd: (start: Date, end: Date) => void;
  handleBlockedZoneRemove: (id: string) => void;
  handleBlockedZoneMove: (id: string, start: Date, end: Date) => void;

  // Overrides de tâches planifiées
  setTaskOverride: (taskId: string, override: PlacedTaskOverride) => void;
  moveTaskOverride: (taskId: string, startTime: number) => void;

  // Tâches neutralisées placées manuellement
  addPlacedNeutralizedTask: (task: PlacedNeutralizedTask) => void;
  updatePlacedNeutralizedTask: (taskId: string, patch: Partial<Omit<PlacedNeutralizedTask, 'taskId'>>) => void;
  removePlacedNeutralizedTask: (taskId: string) => void;

  // Reset (ex: changement de semaine ou de fichiers)
  reset: () => void;

  // Reset uniquement le résultat (retour à l'étape préparation sans perdre la semaine/config)
  resetScheduleResult: () => void;
}

// ── Type export pour les hooks ──────────────────────────────────────────────
export type DraggingResources = NonNullable<PlanningStore['draggingExternal']>;

// ── Store ──────────────────────────────────────────────────────────────────

export const usePlanningStore = create<PlanningStore>()((set, get) => ({
  selectedWeek: null,
  setSelectedWeek: (week) => {
    set({
      selectedWeek: week,
      searchQuery: '',
      scheduleResult: null,
      selectedSolutionIndex: 0,
      activeSolution: [],
      activeNeutralizedTasks: [],
      taskOverrides: {},
      placedNeutralizedTasks: [],
      blockedZones: [],
      status: null,
      taskGroups: [],
      manualEnforcedMap: {},
      enforcedMap: {},
    });
  },

  scheduleResult: null,
  selectedSolutionIndex: 0,
  setSelectedSolutionIndex: (index) => {
    const { scheduleResult } = get();
    if (!scheduleResult) return;
    const solution = scheduleResult.solutions[index];
    set({
      selectedSolutionIndex: index,
      activeSolution: solution?.tasks ?? [],
      activeNeutralizedTasks: solution?.neutralizedTasks ?? [],
      taskOverrides: {},
      placedNeutralizedTasks: [],
    });
  },

  activeSolution: [],
  activeNeutralizedTasks: [],
  taskOverrides: {},
  placedNeutralizedTasks: [],

  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  enforcedMap: {},
  blockedZones: [],

  isLoading: false,
  status: null,
  draggingExternal: null,
  setDraggingExternal: (r) => set({ draggingExternal: r }),

  manualEnforcedMap: {},
  taskGroups: [],

  addTaskGroup: (type, courseKey) => {
    const id = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({
      taskGroups: [
        ...state.taskGroups,
        { id, type, courseKeys: courseKey ? [courseKey] : [] },
      ],
    }));
    return id;
  },

  removeTaskGroup: (groupId) => {
    set((state) => ({ taskGroups: state.taskGroups.filter((g) => g.id !== groupId) }));
  },

  addCourseToGroup: (groupId, courseKey) => {
    set((state) => {
      // Une tâche ne peut appartenir qu'à un seul groupe
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

  runSchedule: async (mode) => {
    const { selectedWeek, enforcedMap, blockedZones, taskGroups } = get();
    if (selectedWeek === null) {
      set({ status: { message: '❌ Semaine non sélectionnée.', kind: 'err' } });
      return;
    }
    const { allCourses, resources, constraints, schedulerConfig } = useSchedulerStore.getState();
    if (!resources.length) {
      set({ status: { message: '❌ Ressources non chargées.', kind: 'err' } });
      return;
    }
    const coursesForWeek = allCourses.filter((c) => c.week === selectedWeek);
    if (coursesForWeek.length === 0) {
      set({ status: { message: `❌ Aucun cours pour la semaine ${selectedWeek}. Importez le fichier CSV.`, kind: 'err' } });
      return;
    }
    const groups = buildTaskGroupDeclarations(coursesForWeek, taskGroups);
    set({ isLoading: true, status: { message: 'Planification en cours…', kind: 'inf' } });
    try {
      const result = await runScheduleRequestFromData({
        week: selectedWeek,
        courses: coursesForWeek,
        resources,
        constraintsData: constraints as ConstraintsData | null,
        enforcedMap,
        blockedZones,
        mode,
        schedulerConfig,
        groups: groups.length > 0 ? groups : undefined,
      });
      const best = result.solutions[0];
      set({
        scheduleResult: result,
        selectedSolutionIndex: 0,
        activeSolution: best.tasks,
        activeNeutralizedTasks: best.neutralizedTasks ?? [],
        taskOverrides: {},
        placedNeutralizedTasks: [],
        isLoading: false,
        status: buildScheduleStatus(result),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ isLoading: false, status: { message: `❌ ${message}`, kind: 'err' } });
    }
  },

  handleEnforceChange: (manualMap) => {
    const { taskGroups } = get();
    const { allCourses } = useSchedulerStore.getState();
    const week = get().selectedWeek;
    const courses = week !== null ? allCourses.filter((c) => c.week === week) : [];

    let augmented = { ...manualMap };
    if (taskGroups.length > 0 && courses.length > 0) {
      for (const [key, data] of Object.entries(manualMap)) {
        const info = getCourseGroupInfo(taskGroups, key);
        if (!info) continue;
        const group = taskGroups.find((g) => g.id === info.groupId);
        if (!group) continue;
        const propagated = computeGroupEnforcements(key, data, group, courses);
        // Ne pas écraser un enforcement manuel existant
        for (const [pKey, pData] of Object.entries(propagated)) {
          if (!(pKey in manualMap)) augmented[pKey] = pData;
        }
      }
    }

    set({
      manualEnforcedMap: manualMap,
      enforcedMap: augmented,
      scheduleResult: null,
      selectedSolutionIndex: 0,
      activeSolution: [],
      activeNeutralizedTasks: [],
      taskOverrides: {},
      placedNeutralizedTasks: [],
    });
  },

  handleBlockedZoneAdd: (start, end) => {
    set((state) => ({
      blockedZones: [
        ...state.blockedZones,
        { id: `bz-${Date.now()}-${Math.random().toString(36).slice(2)}`, start, end },
      ],
      scheduleResult: null,
    }));
  },

  handleBlockedZoneRemove: (id) => {
    set((state) => ({
      blockedZones: state.blockedZones.filter((z) => z.id !== id),
    }));
  },

  handleBlockedZoneMove: (id, start, end) => {
    set((state) => ({
      blockedZones: state.blockedZones.map((z) => (z.id === id ? { ...z, start, end } : z)),
      scheduleResult: null,
    }));
  },

  setTaskOverride: (taskId, override) => {
    set((state) => ({
      taskOverrides: { ...state.taskOverrides, [taskId]: override },
    }));
  },

  moveTaskOverride: (taskId, startTime) => {
    set((state) => {
      const existing = state.taskOverrides[taskId];
      if (!existing) return {};
      return { taskOverrides: { ...state.taskOverrides, [taskId]: { ...existing, startTime } } };
    });
  },

  addPlacedNeutralizedTask: (task) => {
    set((state) => ({
      placedNeutralizedTasks: [
        ...state.placedNeutralizedTasks.filter((t) => t.taskId !== task.taskId),
        task,
      ],
    }));
  },

  updatePlacedNeutralizedTask: (taskId, patch) => {
    set((state) => ({
      placedNeutralizedTasks: state.placedNeutralizedTasks.map((t) =>
        t.taskId === taskId ? { ...t, ...patch } : t,
      ),
    }));
  },

  removePlacedNeutralizedTask: (taskId) => {
    set((state) => ({
      placedNeutralizedTasks: state.placedNeutralizedTasks.filter((t) => t.taskId !== taskId),
    }));
  },

  resetScheduleResult: () => set({
    scheduleResult: null,
    selectedSolutionIndex: 0,
    activeSolution: [],
    activeNeutralizedTasks: [],
    taskOverrides: {},
    placedNeutralizedTasks: [],
    status: null,
  }),

  reset: () => set({
    selectedWeek: null,
    scheduleResult: null,
    selectedSolutionIndex: 0,
    activeSolution: [],
    activeNeutralizedTasks: [],
    taskOverrides: {},
    placedNeutralizedTasks: [],
    enforcedMap: {},
    manualEnforcedMap: {},
    blockedZones: [],
    isLoading: false,
    status: null,
    taskGroups: [],
  }),
}));
