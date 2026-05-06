import { create } from 'zustand';
import type { EnforcedData, TaskSolutionJSON, NeutralizedTaskInfoJSON, ConstraintsData } from '@edt-ts/scheduler-common';
import type { BlockedZone } from '@/lib/calendar/blockedZones';
import { runScheduleRequestFromData, buildScheduleStatus, type ScheduleResult, type ScheduleStatus } from '@/lib/api/scheduleApi';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import { type TaskGroupConfig, type GroupType, buildTaskGroupData, getCourseGroupInfo, computeGroupEnforcements } from '@/lib/taskGroupUtils';
import { computeHolidayZonesForWeek } from '@/lib/schoolHolidays';
import { createNeutralizedSlice, type NeutralizedSlice } from '@/store/slices/neutralizedSlice';
import { createBlockedZonesSlice, type BlockedZonesSlice } from '@/store/slices/blockedZonesSlice';
import { createTaskGroupsSlice, type TaskGroupsSlice } from '@/store/slices/taskGroupsSlice';

export type { TaskGroupConfig };
export type { PlacedTaskOverride, ManuallyNeutralizedTask, PlacedNeutralizedTask, SolutionState } from './types';
import type { PlacedTaskOverride, ManuallyNeutralizedTask, PlacedNeutralizedTask, SolutionState } from './types';

export type Status = ScheduleStatus;

// ── Interface ──────────────────────────────────────────────────────────────
// Contient les données "de travail" de la session : non persistées.

export interface PlanningStore extends NeutralizedSlice, BlockedZonesSlice, TaskGroupsSlice {
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
  /** État mutable sauvegardé par solution (overrides, pioche, placements). */
  solutionStates: Record<number, SolutionState>;
  /** Remet la solution courante à son état initial du moteur. */
  resetCurrentSolution: () => void;

  // Filtrage
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Contraintes de session
  enforcedMap: Record<string, EnforcedData>;
  /** Violations de contrainte pour les tâches imposées déplacées manuellement. */
  enforcedViolations: Record<string, 'red' | 'orange' | 'none'>;
  setEnforcedViolation: (courseKey: string, violation: 'red' | 'orange' | 'none') => void;

  // Statut UI
  isLoading: boolean;
  status: Status | null;

  /** Ressources du cours en cours de drag depuis une source externe (sidebar ou panel neutralisé). */
  draggingExternal: { teachers: string[]; groups: string[]; rooms: string[]; courseKey?: string } | null;
  setDraggingExternal: (r: { teachers: string[]; groups: string[]; rooms: string[]; courseKey?: string } | null) => void;

  /** Visibilité du panneau GroupDrawer (préférence de layout, non persisté). */
  groupDrawerOpen: boolean;
  toggleGroupDrawer: () => void;

  // ── Actions ──────────────────────────────────────────────────────────────

  // Planification
  runSchedule: () => Promise<void>;

  // Cours forcés (reçoit la map MANUELLE — la propagation de groupes est calculée automatiquement)
  handleEnforceChange: (map: Record<string, EnforcedData>) => void;

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

export const usePlanningStore = create<PlanningStore>()((...a) => {
  const [set, get] = a;
  return {
  ...createNeutralizedSlice(...a),
  ...createBlockedZonesSlice(...a),
  ...createTaskGroupsSlice(...a),

  selectedWeek: null,
  setSelectedWeek: (week) => {
    // Pré-charger les zones bloquées de vacances/jours fériés pour la semaine
    const { schoolYearConfig } = useSchedulerStore.getState();
    const initialBlockedZones: BlockedZone[] =
      week !== null && schoolYearConfig
        ? computeHolidayZonesForWeek(schoolYearConfig, week)
        : [];

    set({
      selectedWeek: week,
      searchQuery: '',
      scheduleResult: null,
      selectedSolutionIndex: 0,
      activeSolution: [],
      activeNeutralizedTasks: [],
      taskOverrides: {},
      placedNeutralizedTasks: [],
      preNeutralizedKeys: [],
      manuallyNeutralizedTasks: [],
      solutionStates: {},
      syntheticNeutralizedTasks: [],
      blockedZones: initialBlockedZones,
      status: null,
      taskGroups: [],
      manualEnforcedMap: {},
      enforcedMap: {},
      enforcedViolations: {},
    });
  },

  scheduleResult: null,
  selectedSolutionIndex: 0,
  setSelectedSolutionIndex: (index) => {
    const { scheduleResult, selectedSolutionIndex, taskOverrides, placedNeutralizedTasks, manuallyNeutralizedTasks, solutionStates, syntheticNeutralizedTasks } = get();
    if (!scheduleResult) return;
    // Sauvegarder l'état courant avant de changer de solution
    const newSolutionStates: Record<number, SolutionState> = {
      ...solutionStates,
      [selectedSolutionIndex]: { taskOverrides, placedNeutralizedTasks, manuallyNeutralizedTasks },
    };
    // Restaurer l'état sauvegardé pour la nouvelle solution (ou état initial)
    const saved = newSolutionStates[index];
    const solution = scheduleResult.solutions[index];
    set({
      selectedSolutionIndex: index,
      solutionStates: newSolutionStates,
      activeSolution: solution?.tasks ?? [],
      activeNeutralizedTasks: [...(solution?.neutralizedTasks ?? []), ...syntheticNeutralizedTasks],
      taskOverrides: saved?.taskOverrides ?? {},
      placedNeutralizedTasks: saved?.placedNeutralizedTasks ?? [],
      manuallyNeutralizedTasks: saved?.manuallyNeutralizedTasks ?? [],
    });
  },

  activeSolution: [],
  activeNeutralizedTasks: [],
  taskOverrides: {},
  placedNeutralizedTasks: [],
  solutionStates: {},
  resetCurrentSolution: () => {
    const { scheduleResult, selectedSolutionIndex, solutionStates, syntheticNeutralizedTasks } = get();
    if (!scheduleResult) return;
    const solution = scheduleResult.solutions[selectedSolutionIndex];
    const newStates = { ...solutionStates };
    delete newStates[selectedSolutionIndex];
    set({
      solutionStates: newStates,
      taskOverrides: {},
      placedNeutralizedTasks: [],
      manuallyNeutralizedTasks: [],
      activeNeutralizedTasks: [...(solution?.neutralizedTasks ?? []), ...syntheticNeutralizedTasks],
    });
  },

  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  enforcedMap: {},
  enforcedViolations: {},
  setEnforcedViolation: (courseKey, violation) => set((state) => ({
    enforcedViolations: { ...state.enforcedViolations, [courseKey]: violation },
  })),

  isLoading: false,
  status: null,
  draggingExternal: null,
  setDraggingExternal: (r) => set({ draggingExternal: r }),

  groupDrawerOpen: false,
  toggleGroupDrawer: () => set((s) => ({ groupDrawerOpen: !s.groupDrawerOpen })),

  runSchedule: async () => {
    const { selectedWeek, enforcedMap, blockedZones, taskGroups, preNeutralizedKeys } = get();
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

    // Filtrage des tâches pré-neutralisées
    const preNeutSet = new Set(preNeutralizedKeys);
    const filteredCourses: typeof coursesForWeek = [];
    const oldToNew = new Map<number, number>();
    const preNeutEntries: { oldKey: string; course: typeof coursesForWeek[0] }[] = [];

    coursesForWeek.forEach((course, oldIdx) => {
      const key = String(oldIdx);
      if (preNeutSet.has(key)) {
        preNeutEntries.push({ oldKey: key, course });
      } else {
        oldToNew.set(oldIdx, filteredCourses.length);
        filteredCourses.push(course);
      }
    });

    // Remapping de enforcedMap et taskGroups vers les nouveaux indices
    const remappedEnforced: Record<string, EnforcedData> = {};
    for (const [oldKey, data] of Object.entries(enforcedMap)) {
      const newIdx = oldToNew.get(parseInt(oldKey, 10));
      if (newIdx !== undefined) remappedEnforced[String(newIdx)] = data;
    }
    const remappedTaskGroups: TaskGroupConfig[] = taskGroups.map((g) => ({
      ...g,
      courseKeys: g.courseKeys
        .map((k) => {
          const newIdx = oldToNew.get(parseInt(k, 10));
          return newIdx !== undefined ? String(newIdx) : null;
        })
        .filter((k): k is string => k !== null),
    }));

    const { coursesWithGroups, declarations } = buildTaskGroupData(filteredCourses, remappedTaskGroups);
    set({ isLoading: true, status: { message: 'Planification en cours…', kind: 'inf' } });
    try {
      const result = await runScheduleRequestFromData({
        week: selectedWeek,
        courses: coursesWithGroups,
        resources,
        constraintsData: constraints as ConstraintsData | null,
        enforcedMap: remappedEnforced,
        blockedZones,
        schedulerConfig,
        groups: declarations.length > 0 ? declarations : undefined,
      });
      const best = result.solutions[0];

      // Entrées synthétiques pour les tâches pré-neutralisées
      const syntheticNeutralized: NeutralizedTaskInfoJSON[] = preNeutEntries.map(({ oldKey, course }) => ({
        task: {
          taskId: `pre-neutral-${oldKey}`,
          code: course.code,
          name: course.name,
          type: course.type,
          week: selectedWeek,
          duration: course.duration,
          startTime: 0,
          resources: [
            ...course.teacher.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e])).filter((id): id is string => Boolean(id)).map((id) => ({ id, type: 'teacher' })),
            ...course.groups.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e])).filter((id): id is string => Boolean(id)).map((id) => ({ id, type: 'group' })),
            ...course.rooms.flat().filter((id): id is string => Boolean(id)).map((id) => ({ id, type: 'room' })),
          ],
        },
        eliminationRound: 0,
        failureCount: 0,
        requiredMinutes: course.duration,
        schedulableMinutes: 0,
        resourceSnapshots: [],
        reason: 'Neutralisée manuellement avant planification',
      }));

      set({
        scheduleResult: result,
        selectedSolutionIndex: 0,
        activeSolution: best.tasks,
        activeNeutralizedTasks: [...(best.neutralizedTasks ?? []), ...syntheticNeutralized],
        syntheticNeutralizedTasks: syntheticNeutralized,
        solutionStates: {},
        taskOverrides: {},
        placedNeutralizedTasks: [],
        manuallyNeutralizedTasks: [],
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
      enforcedViolations: {},
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
      // Retirer de la pioche si la tâche y était
      manuallyNeutralizedTasks: state.manuallyNeutralizedTasks.filter((t) => t.taskId !== task.taskId),
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
    preNeutralizedKeys: [],
    manuallyNeutralizedTasks: [],
    solutionStates: {},
    syntheticNeutralizedTasks: [],
    enforcedViolations: {},
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
    preNeutralizedKeys: [],
    manuallyNeutralizedTasks: [],
    solutionStates: {},
    syntheticNeutralizedTasks: [],
    enforcedMap: {},
    enforcedViolations: {},
    manualEnforcedMap: {},
    blockedZones: [],
    isLoading: false,
    status: null,
    taskGroups: [],
  }),
  };
});
