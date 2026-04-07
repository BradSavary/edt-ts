import { create } from 'zustand';
import type { EnforcedData, TaskSolutionJSON, ConstraintsData } from '@edt-ts/scheduler-common';
import type { BlockedZone } from '@/lib/blockedZones';
import { runScheduleRequestFromData, buildScheduleStatus, type ScheduleResult, type ScheduleStatus } from '@/lib/scheduleApi';
import { useSchedulerStore } from '@/store/useSchedulerStore';

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
  activeNeutralizedTasks: TaskSolutionJSON[];

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

  // ── Actions ──────────────────────────────────────────────────────────────

  // Planification
  runSchedule: (mode: 'standard' | 'elimination') => Promise<void>;

  // Cours forcés
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
}

// ── Store ──────────────────────────────────────────────────────────────────

export const usePlanningStore = create<PlanningStore>()((set, get) => ({
  selectedWeek: null,
  setSelectedWeek: (week) => {
    set({
      selectedWeek: week,
      scheduleResult: null,
      selectedSolutionIndex: 0,
      activeSolution: [],
      activeNeutralizedTasks: [],
      taskOverrides: {},
      placedNeutralizedTasks: [],
      blockedZones: [],
      status: null,
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

  runSchedule: async (mode) => {
    const { selectedWeek, enforcedMap, blockedZones } = get();
    if (selectedWeek === null) {
      set({ status: { message: '❌ Semaine non sélectionnée.', kind: 'err' } });
      return;
    }
    const { allCourses, resources, constraints } = useSchedulerStore.getState();
    if (!resources.length) {
      set({ status: { message: '❌ Ressources non chargées. Importez le fichier resources.json.', kind: 'err' } });
      return;
    }
    const coursesForWeek = allCourses.filter((c) => c.week === selectedWeek);
    if (coursesForWeek.length === 0) {
      set({ status: { message: `❌ Aucun cours pour la semaine ${selectedWeek}. Importez le fichier CSV.`, kind: 'err' } });
      return;
    }
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

  handleEnforceChange: (map) => {
    set({
      enforcedMap: map,
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

  reset: () => set({
    selectedWeek: null,
    scheduleResult: null,
    selectedSolutionIndex: 0,
    activeSolution: [],
    activeNeutralizedTasks: [],
    taskOverrides: {},
    placedNeutralizedTasks: [],
    enforcedMap: {},
    blockedZones: [],
    isLoading: false,
    status: null,
  }),
}));
