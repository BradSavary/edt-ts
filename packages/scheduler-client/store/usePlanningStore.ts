import { create } from 'zustand';
import type { EnforcedData, TaskSolutionJSON, NeutralizedTaskInfoJSON, ConstraintsData, JobStatusResponse } from '@edt-ts/scheduler-common';
import type { BlockedZone } from '@/lib/calendar/blockedZones';
import { runScheduleRequestFromData, submitJobAsync, pollJob, cancelJob, buildScheduleStatus, JobConflictError, type ScheduleResult, type ScheduleStatus } from '@/lib/api/scheduleApi';
import { getClientId } from '@/lib/api/clientId';
import { useProjectStore } from '@/store/useProjectStore';
import { useAppConfigStore } from '@/store/useAppConfigStore';
import { type TaskGroupConfig, type GroupType, buildTaskGroupData, getCourseGroupInfo, computeGroupEnforcements } from '@/lib/taskGroupUtils';
import { computeHolidayZonesForWeek, resolveCalendarYear } from '@/lib/schoolHolidays';
import { getCoursesForWeek, getManualCoursesForWeek } from '@/lib/weekCourses';
import { filterResourcesForCourses } from '@/lib/filterResourcesForCourses';
import { createNeutralizedSlice, type NeutralizedSlice } from '@/store/slices/neutralizedSlice';
import { createBlockedZonesSlice, type BlockedZonesSlice } from '@/store/slices/blockedZonesSlice';
import { createTaskGroupsSlice, type TaskGroupsSlice } from '@/store/slices/taskGroupsSlice';
import { createAutonomyDistributionSlice, type AutonomyDistributionSlice } from '@/store/slices/autonomyDistributionSlice';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import { getMondayOfISOWeek, dateToStartTime } from '@/lib/calendar/calendarUtils';
import { computeEffectiveSolution } from '@/lib/calendar/effectiveSolution';
import { computeAutonomyDistribution, type OccupancyEntry } from '@/lib/calendar/autonomyDistribution';
import { resolveNeutralizedTaskById } from '@/lib/taskCardUtils';

export type { TaskGroupConfig };
export type { PlacedTaskOverride, ManuallyNeutralizedTask, PlacedNeutralizedTask, SolutionState, AutonomyPiece, AutonomyDistribution } from './types';
import type { PlacedTaskOverride, ManuallyNeutralizedTask, PlacedNeutralizedTask, SolutionState, AutonomyDistribution } from './types';
export type { PreparedWeekSnapshot } from './slices/weekSavesSlice';

export type Status = ScheduleStatus;

/**
 * Semaine ISO à laquelle démarre une année universitaire (ex: rentrée début septembre).
 * Un Projet chevauche 2 années civiles (S35-52 puis S1-34) — 1 n'a donc pas de sens comme
 * point de départ par défaut.
 */
export const DEFAULT_WEEK = 35;

// ── Interface ──────────────────────────────────────────────────────────────
// Contient les données "de travail" de la session : non persistées.

export interface PlanningStore extends NeutralizedSlice, BlockedZonesSlice, TaskGroupsSlice, AutonomyDistributionSlice {
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

  // Planification asynchrone
  currentJobId: string | null;
  currentJobStatus: JobStatusResponse | null;
  pendingJobResult: { week: number; result: ScheduleResult; syntheticNeutralized: NeutralizedTaskInfoJSON[] } | null;
  runSchedule: () => Promise<void>;
  cancelCurrentJob: () => Promise<void>;
  /** Applique le résultat en attente pour la semaine donnée et vide pendingJobResult. */
  applyPendingResult: () => void;

  // Cours forcés (reçoit la map MANUELLE — la propagation de groupes est calculée automatiquement)
  handleEnforceChange: (map: Record<string, EnforcedData>) => void;

  // Overrides de tâches planifiées
  setTaskOverride: (taskId: string, override: PlacedTaskOverride) => void;
  moveTaskOverride: (taskId: string, startTime: number) => void;

  // Tâches neutralisées placées manuellement
  addPlacedNeutralizedTask: (task: PlacedNeutralizedTask) => void;
  updatePlacedNeutralizedTask: (taskId: string, patch: Partial<Omit<PlacedNeutralizedTask, 'taskId'>>) => void;
  removePlacedNeutralizedTask: (taskId: string) => void;

  /** Calcule et applique la répartition automatique d'un cours Autonomie neutralisé (taskId). */
  distributeAutonomy: (taskId: string) => void;

  // Reset (ex: changement de semaine ou de fichiers)
  reset: () => void;

  // Reset uniquement le résultat (retour à l'étape préparation sans perdre la semaine/config)
  resetScheduleResult: () => void;
}

// ── Type export pour les hooks ──────────────────────────────────────────────
export type DraggingResources = NonNullable<PlanningStore['draggingExternal']>;

// ── Etat interne du polling (hors store React) ──────────────────────────────
let _pollingInterval: ReturnType<typeof setInterval> | null = null;

// ── Store ──────────────────────────────────────────────────────────────────

export const usePlanningStore = create<PlanningStore>()((...a) => {
  const [set, get] = a;
  return {
  ...createNeutralizedSlice(...a),
  ...createBlockedZonesSlice(...a),
  ...createTaskGroupsSlice(...a),
  ...createAutonomyDistributionSlice(...a),

  selectedWeek: DEFAULT_WEEK,
  setSelectedWeek: (week) => {
    // Pré-charger les zones bloquées de vacances/jours fériés pour la semaine
    const projectState = useProjectStore.getState();
    const { schoolYearConfig } = projectState;
    const initialBlockedZones: BlockedZone[] =
      week !== null && schoolYearConfig
        ? computeHolidayZonesForWeek(schoolYearConfig, week)
        : [];

    // Chercher une sauvegarde pour cette semaine
    const snapshot =
      week !== null
        ? projectState.loadWeekSave(week)
        : null;

    if (snapshot) {
      // Recompute enforcedMap depuis manualEnforcedMap + groupes (même logique que handleEnforceChange)
      // Cours CSV toujours lus en direct depuis allCourses (jamais figés dans le snapshot) + cours
      // manuels du snapshot — snapshot.weekNumber plutôt que le paramètre `week` pour que TS
      // n'ait pas besoin d'une assertion non-null ici.
      const restoredCourses = getCoursesForWeek(projectState.allCourses, projectState.weekSaves, snapshot.weekNumber);
      const restoredEnforcedMap: Record<string, EnforcedData> = { ...snapshot.manualEnforcedMap };
      if (snapshot.taskGroups.length > 0 && restoredCourses.length > 0) {
        for (const [key, data] of Object.entries(snapshot.manualEnforcedMap)) {
          const info = getCourseGroupInfo(snapshot.taskGroups, key);
          if (!info) continue;
          const group = snapshot.taskGroups.find((g) => g.id === info.groupId);
          if (!group) continue;
          const propagated = computeGroupEnforcements(key, data, group, restoredCourses);
          for (const [pKey, pData] of Object.entries(propagated)) {
            if (!(pKey in snapshot.manualEnforcedMap)) restoredEnforcedMap[pKey] = pData;
          }
        }
      }

      // Désérialiser les zones bloquées manuelles (ISO string → Date)
      const restoredManualZones: BlockedZone[] = snapshot.manualBlockedZones.map((z) => ({
        id: z.id,
        start: new Date(z.start),
        end: new Date(z.end),
        label: z.label,
        source: z.source,
      }));

      set({
        selectedWeek: week,
        searchQuery: '',
        scheduleResult: null,
        selectedSolutionIndex: 0,
        activeSolution: [],
        activeNeutralizedTasks: [],
        taskOverrides: {},
        placedNeutralizedTasks: [],
        manuallyNeutralizedTasks: [],
        solutionStates: {},
        autonomyDistributions: {},
        syntheticNeutralizedTasks: [],
        status: null,
        taskGroups: snapshot.taskGroups,
        manualEnforcedMap: snapshot.manualEnforcedMap,
        enforcedMap: restoredEnforcedMap,
        enforcedViolations: {},
        preNeutralizedKeys: snapshot.preNeutralizedKeys,
        blockedZones: [...initialBlockedZones, ...restoredManualZones],
      });
      // Plus besoin de toucher allCourses : les cours CSV y restent en permanence,
      // les cours manuels se lisent directement depuis weekSaves (getCoursesForWeek).
    } else {
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
        autonomyDistributions: {},
        syntheticNeutralizedTasks: [],
        blockedZones: initialBlockedZones,
        status: null,
        taskGroups: [],
        manualEnforcedMap: {},
        enforcedMap: {},
        enforcedViolations: {},
      });
    }
  },

  scheduleResult: null,
  selectedSolutionIndex: 0,
  setSelectedSolutionIndex: (index) => {
    const { scheduleResult, selectedSolutionIndex, taskOverrides, placedNeutralizedTasks, manuallyNeutralizedTasks, autonomyDistributions, solutionStates, syntheticNeutralizedTasks } = get();
    if (!scheduleResult) return;
    // Sauvegarder l'état courant avant de changer de solution
    const newSolutionStates: Record<number, SolutionState> = {
      ...solutionStates,
      [selectedSolutionIndex]: { taskOverrides, placedNeutralizedTasks, manuallyNeutralizedTasks, autonomyDistributions },
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
      autonomyDistributions: saved?.autonomyDistributions ?? {},
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
      autonomyDistributions: {},
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
  currentJobId: null,
  currentJobStatus: null,
  pendingJobResult: null,
  draggingExternal: null,
  setDraggingExternal: (r) => set({ draggingExternal: r }),

  groupDrawerOpen: false,
  toggleGroupDrawer: () => set((s) => ({ groupDrawerOpen: !s.groupDrawerOpen })),

  runSchedule: async () => {
    // Nettoyage préventif : couper le polling et annuler tout job en cours (repris ou en attente).
    // Cela évite que "session expirée" n'apparaisse lors du premier poll après une reprise zombie.
    if (_pollingInterval !== null) { clearInterval(_pollingInterval); _pollingInterval = null; }
    const prevJobId = get().currentJobId ?? _loadJobFromStorage()?.jobId;
    if (prevJobId) {
      await cancelJob(prevJobId).catch(() => {});
      _clearJobFromStorage();
      set({ currentJobId: null, currentJobStatus: null });
    }

    const { selectedWeek, enforcedMap, blockedZones, taskGroups, preNeutralizedKeys, pendingJobResult } = get();
    if (selectedWeek === null) {
      set({ status: { message: '❌ Semaine non sélectionnée.', kind: 'err' } });
      return;
    }
    if (pendingJobResult !== null) {
      set({ status: { message: '⏳ Récupérez le résultat en attente avant de lancer une nouvelle planification.', kind: 'inf' } });
      return;
    }
    const { allCourses, weekSaves, resources, constraints } = useProjectStore.getState();
    const { schedulerConfig } = useAppConfigStore.getState();
    if (!resources.length) {
      set({ status: { message: '❌ Ressources non chargées.', kind: 'err' } });
      return;
    }
    const coursesForWeek = getCoursesForWeek(allCourses, weekSaves, selectedWeek);
    if (coursesForWeek.length === 0) {
      set({ status: { message: `❌ Aucun cours pour la semaine ${selectedWeek}. Importez le fichier CSV.`, kind: 'err' } });
      return;
    }

    // Filtrage des tâches pré-neutralisées
    const preNeutSet = new Set(preNeutralizedKeys);
    const filteredCourses: CourseTaskDataWithId[] = [];
    const idToNewIdx = new Map<string, number>();
    const preNeutCourses: CourseTaskDataWithId[] = [];

    for (const course of coursesForWeek) {
      if (preNeutSet.has(course.id)) {
        preNeutCourses.push(course);
      } else {
        idToNewIdx.set(course.id, filteredCourses.length);
        filteredCourses.push(course);
      }
    }

    // Remapping de enforcedMap et taskGroups vers les nouveaux indices
    const remappedEnforced: Record<string, EnforcedData> = {};
    for (const [courseId, data] of Object.entries(enforcedMap)) {
      const newIdx = idToNewIdx.get(courseId);
      if (newIdx !== undefined) remappedEnforced[String(newIdx)] = data;
    }
    const remappedTaskGroups: TaskGroupConfig[] = taskGroups.map((g) => ({
      ...g,
      courseKeys: g.courseKeys.filter((k) => idToNewIdx.has(k)),
    }));

    const { coursesWithGroups, declarations } = buildTaskGroupData(filteredCourses, remappedTaskGroups);

    // Pré-calculer les entrées synthétiques pour les tâches pré-neutralisées
    const syntheticNeutralized = preNeutCourses.map((course) => {
      return {
        task: {
          taskId: `pre-neutral-${course.id}`,
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
      };
    });

    // Ne transmet au moteur que les ressources réellement référencées par les cours
    // de cette semaine (+ celles imposées) — évite les avertissements "non trouvée
    // dans les contraintes" pour des ressources sans rapport (ex. un enseignant qui
    // n'intervient que d'autres semaines) et allège le payload.
    const filteredResources = filterResourcesForCourses(resources, coursesWithGroups, remappedEnforced);

    const clientId = getClientId();
    const submitParams = {
      week: selectedWeek,
      courses: coursesWithGroups,
      resources: filteredResources,
      constraintsData: constraints as ConstraintsData | null,
      enforcedMap: remappedEnforced,
      blockedZones,
      schedulerConfig,
      groups: declarations.length > 0 ? declarations : undefined,
    };

    set({ isLoading: true, status: { message: 'Soumission de la planification…', kind: 'inf' }, currentJobId: null, currentJobStatus: null });

    try {
      const { jobId } = await submitJobAsync(submitParams, clientId);

      set({ currentJobId: jobId, status: { message: 'Planification en cours…', kind: 'inf' } });
      _saveJobToStorage(jobId, syntheticNeutralized);
      _startPolling(jobId, syntheticNeutralized);

    } catch (err: unknown) {
      if (err instanceof JobConflictError && err.existingJobId) {
        const existingId = err.existingJobId;
        try {
          const jobStatus = await pollJob(existingId);
          if (jobStatus.status === 'error' || jobStatus.status === 'cancelled') {
            await cancelJob(existingId);
            // Job précédent échoué/annulé : on réessaie automatiquement
            try {
              const { jobId: newJobId } = await submitJobAsync(submitParams, clientId);
              set({ currentJobId: newJobId, status: { message: 'Planification en cours…', kind: 'inf' } });
              _saveJobToStorage(newJobId, syntheticNeutralized);
              _startPolling(newJobId, syntheticNeutralized);
            } catch (retryErr: unknown) {
              const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              set({ isLoading: false, status: { message: `❌ ${msg}`, kind: 'err' }, currentJobId: null, currentJobStatus: null });
            }
          } else if (jobStatus.status === 'pending' || jobStatus.status === 'running') {
            // Job actif : l'annuler (l'utilisateur soumet de nouvelles données) puis relancer
            await cancelJob(existingId);
            try {
              const { jobId: newJobId } = await submitJobAsync(submitParams, clientId);
              set({ currentJobId: newJobId, status: { message: 'Planification en cours…', kind: 'inf' } });
              _saveJobToStorage(newJobId, syntheticNeutralized);
              _startPolling(newJobId, syntheticNeutralized);
            } catch (retryErr: unknown) {
              const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              set({ isLoading: false, status: { message: `❌ ${msg}`, kind: 'err' }, currentJobId: null, currentJobStatus: null });
            }
          } else if (jobStatus.status === 'done') {
            _clearJobFromStorage();
            set({
              isLoading: false,
              currentJobId: null,
              currentJobStatus: null,
              pendingJobResult: _normalizeJobResult(jobStatus, syntheticNeutralized),
              status: { message: `✅ Planification semaine ${jobStatus.week} terminée`, kind: 'ok' },
            });
            void cancelJob(existingId);
          }
        } catch {
          set({ isLoading: false, status: { message: '❌ Impossible de résoudre le conflit de job.', kind: 'err' }, currentJobId: null, currentJobStatus: null });
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        set({ isLoading: false, status: { message: `❌ ${message}`, kind: 'err' }, currentJobId: null, currentJobStatus: null });
      }
    }
  },

  applyPendingResult: () => {
    const { pendingJobResult } = get();
    if (!pendingJobResult) return;
    const { result, syntheticNeutralized, week } = pendingJobResult;
    const best = result.solutions[0];
    
     // Si le moteur n'a placé aucune tâche, on reste en mode préparation
    if (!best || best.tasks.length === 0) {
      const neutralized = [...(best?.neutralizedTasks ?? []), ...syntheticNeutralized];
      const neutralizedMsg = neutralized.length ? ` — ${neutralized.length} cours neutralisé(s)` : '';
      set({
        selectedWeek: week,
        isLoading: false,
        status: { message: `❌ Aucune solution trouvée${neutralizedMsg}`, kind: 'err' },
        currentJobId: null,
        currentJobStatus: null,
        pendingJobResult: null,
      });
      return;
    }

    set({
      selectedWeek: week,
      scheduleResult: result,
      selectedSolutionIndex: 0,
      activeSolution: best.tasks,
      activeNeutralizedTasks: [...(best.neutralizedTasks ?? []), ...syntheticNeutralized],
      syntheticNeutralizedTasks: syntheticNeutralized,
      solutionStates: {},
      taskOverrides: {},
      placedNeutralizedTasks: [],
      manuallyNeutralizedTasks: [],
      autonomyDistributions: {},
      isLoading: false,
      status: buildScheduleStatus(result),
      currentJobId: null,
      currentJobStatus: null,
      pendingJobResult: null,
    });
  },

  cancelCurrentJob: async () => {
    const { currentJobId } = get();
    if (!currentJobId) return;
    if (_pollingInterval !== null) {
      clearInterval(_pollingInterval);
      _pollingInterval = null;
    }
    await cancelJob(currentJobId);
    _clearJobFromStorage();
    set({
      isLoading: false,
      currentJobId: null,
      currentJobStatus: null,
      status: { message: 'Planification annulée.', kind: 'inf' },
    });
  },

  handleEnforceChange: (manualMap) => {
    const { taskGroups } = get();
    const { allCourses, weekSaves } = useProjectStore.getState();
    const week = get().selectedWeek;
    const courses = week !== null ? getCoursesForWeek(allCourses, weekSaves, week) : [];

    const augmented = { ...manualMap };
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
      autonomyDistributions: {},
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

  distributeAutonomy: (taskId) => {
    const {
      activeSolution, taskOverrides, manuallyNeutralizedTasks, placedNeutralizedTasks,
      activeNeutralizedTasks, autonomyDistributions, selectedWeek, blockedZones,
    } = get();
    if (selectedWeek === null) return;

    const info = resolveNeutralizedTaskById(taskId, activeNeutralizedTasks, manuallyNeutralizedTasks);
    if (!info || info.type !== 'Autonomie') return;

    const { availabilityManager, schoolYearConfig } = useProjectStore.getState();
    if (!availabilityManager) return;

    const monday = getMondayOfISOWeek(selectedWeek, resolveCalendarYear(schoolYearConfig, selectedWeek));

    // Ce qui occupe déjà le calendrier affiché : solution effective (moteur + overrides +
    // neutralisées replacées manuellement) + morceaux déjà distribués pour D'AUTRES cours
    // Autonomie susceptibles de partager un groupe.
    const effective = computeEffectiveSolution({
      activeSolution, taskOverrides, manuallyNeutralizedTasks, placedNeutralizedTasks, week: selectedWeek,
    });
    const occupancy: OccupancyEntry[] = [
      ...effective.map((t) => ({
        startTime: t.startTime,
        duration: t.duration,
        groups: t.resources.filter((r) => r.type === 'group').map((r) => r.id),
      })),
      ...Object.values(autonomyDistributions)
        .filter((d) => d.originalTaskId !== taskId)
        .flatMap((d) => d.pieces.map((p) => ({ startTime: p.startTime, duration: p.duration, groups: d.groups }))),
    ];

    const blockedZonesMinutes = blockedZones
      .map((z) => ({ start: dateToStartTime(monday, z.start), end: dateToStartTime(monday, z.end) }))
      .filter((z) => z.end > z.start);

    const result = computeAutonomyDistribution({
      groupIds: info.groups,
      week: selectedWeek,
      availabilityManager,
      blockedZonesMinutes,
      occupancy,
      totalDuration: info.duration,
    });

    const distribution: AutonomyDistribution = {
      originalTaskId: taskId,
      code: info.code,
      name: info.name,
      type: info.type,
      teachers: info.teachers,
      groups: info.groups,
      rooms: info.rooms,
      totalDuration: info.duration,
      pieces: result.pieces.map((p, i) => ({ id: `${taskId}-piece-${i}`, startTime: p.startTime, duration: p.duration })),
      remainingDuration: result.remainingDuration,
    };

    set({ autonomyDistributions: { ...autonomyDistributions, [taskId]: distribution } });
  },

  resetScheduleResult: () => {
    if (_pollingInterval !== null) { clearInterval(_pollingInterval); _pollingInterval = null; }
    set({
      scheduleResult: null,
      selectedSolutionIndex: 0,
      activeSolution: [],
      activeNeutralizedTasks: [],
      taskOverrides: {},
      placedNeutralizedTasks: [],
      manuallyNeutralizedTasks: [],
      solutionStates: {},
      autonomyDistributions: {},
      syntheticNeutralizedTasks: [],
      enforcedViolations: {},
      currentJobId: null,
      currentJobStatus: null,
      pendingJobResult: null,
      status: null,
    });
  },

  reset: () => {
    if (_pollingInterval !== null) { clearInterval(_pollingInterval); _pollingInterval = null; }
    set({
      selectedWeek: DEFAULT_WEEK,
      scheduleResult: null,
      selectedSolutionIndex: 0,
      activeSolution: [],
      activeNeutralizedTasks: [],
      taskOverrides: {},
      placedNeutralizedTasks: [],
      preNeutralizedKeys: [],
      manuallyNeutralizedTasks: [],
      solutionStates: {},
      autonomyDistributions: {},
      syntheticNeutralizedTasks: [],
      enforcedMap: {},
      enforcedViolations: {},
      manualEnforcedMap: {},
      blockedZones: [],
      isLoading: false,
      status: null,
      taskGroups: [],
      currentJobId: null,
      currentJobStatus: null,
      pendingJobResult: null,
    });
  },
  };
});

// ── Persistence du job en cours (survit à un rechargement de page) ────────

const JOB_PERSISTENCE_KEY = 'edt-pending-job';

const JOB_TTL_MS = 24 * 60 * 60 * 1000; // 8 heures

function _saveJobToStorage(jobId: string, syntheticNeutralized: NeutralizedTaskInfoJSON[]) {
  try { localStorage.setItem(JOB_PERSISTENCE_KEY, JSON.stringify({ jobId, syntheticNeutralized, savedAt: Date.now() })); } catch {}
}

function _clearJobFromStorage() {
  try { localStorage.removeItem(JOB_PERSISTENCE_KEY); } catch {}
}

function _loadJobFromStorage(): { jobId: string; syntheticNeutralized: NeutralizedTaskInfoJSON[] } | null {
  try {
    const raw = localStorage.getItem(JOB_PERSISTENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { jobId: string; syntheticNeutralized: NeutralizedTaskInfoJSON[]; savedAt?: number };
    if (parsed.savedAt && Date.now() - parsed.savedAt > JOB_TTL_MS) {
      _clearJobFromStorage();
      return null;
    }
    return { jobId: parsed.jobId, syntheticNeutralized: parsed.syntheticNeutralized };
  } catch { return null; }
}

function _normalizeJobResult(
  jobStatus: JobStatusResponse,
  syntheticNeutralized: NeutralizedTaskInfoJSON[],
): { week: number; result: ScheduleResult; syntheticNeutralized: NeutralizedTaskInfoJSON[] } {
  const result: ScheduleResult = {
    solutions: jobStatus.result!.map((s) => ({
      isComplete: s.isComplete,
      score: s.score,
      tasks: s.solutions,
      neutralizedTasks: s.neutralizedTasks,
    })),
    week: jobStatus.week,
  };
  return { week: jobStatus.week, result, syntheticNeutralized };
}

function _startPolling(jobId: string, syntheticNeutralized: NeutralizedTaskInfoJSON[]) {
  if (_pollingInterval !== null) clearInterval(_pollingInterval);
  _pollingInterval = setInterval(() => {
    void (async () => {
      try {
        const jobStatus = await pollJob(jobId);
        usePlanningStore.setState({ currentJobStatus: jobStatus });
        if (jobStatus.status === 'done') {
          clearInterval(_pollingInterval!);
          _pollingInterval = null;
          _clearJobFromStorage();
          usePlanningStore.setState({
            isLoading: false,
            currentJobId: null,
            currentJobStatus: null,
            pendingJobResult: _normalizeJobResult(jobStatus, syntheticNeutralized),
            status: { message: `✅ Planification semaine ${jobStatus.week} terminée`, kind: 'ok' },
          });
          void cancelJob(jobId);
        } else if (jobStatus.status === 'error') {
          clearInterval(_pollingInterval!);
          _pollingInterval = null;
          _clearJobFromStorage();
          usePlanningStore.setState({
            isLoading: false,
            status: { message: `❌ ${jobStatus.error ?? 'Erreur inconnue'}`, kind: 'err' },
            currentJobId: null,
            currentJobStatus: null,
          });
          void cancelJob(jobId);
        } else if (jobStatus.status === 'cancelled') {
          clearInterval(_pollingInterval!);
          _pollingInterval = null;
          _clearJobFromStorage();
          usePlanningStore.setState({
            isLoading: false,
            status: { message: 'Planification annulée.', kind: 'inf' },
            currentJobId: null,
            currentJobStatus: null,
          });
        }
      } catch (pollErr) {
        const is404 = pollErr instanceof Error && pollErr.message.includes('404');
        if (is404) {
          clearInterval(_pollingInterval!);
          _pollingInterval = null;
          _clearJobFromStorage();
          usePlanningStore.setState({
            isLoading: false,
            status: { message: 'La session de planification a expiré (serveur redémarré).', kind: 'inf' },
            currentJobId: null,
            currentJobStatus: null,
          });
        } else {
          console.warn('Erreur de polling (réseau?) :', pollErr);
        }
      }
    })();
  }, 5000);
}

async function _resumePendingJob() {
  const persisted = _loadJobFromStorage();
  if (!persisted) return;
  const { jobId, syntheticNeutralized } = persisted;
  try {
    const jobStatus = await pollJob(jobId);
    if (jobStatus.status === 'done') {
      _clearJobFromStorage();
      usePlanningStore.setState({
        pendingJobResult: _normalizeJobResult(jobStatus, syntheticNeutralized),
        status: { message: `✅ Planification semaine ${jobStatus.week} terminée`, kind: 'ok' },
      });
      void cancelJob(jobId);
    } else if (jobStatus.status === 'pending' || jobStatus.status === 'running') {
      usePlanningStore.setState({
        currentJobId: jobId,
        currentJobStatus: jobStatus,
        isLoading: true,
        status: { message: 'Planification en cours…', kind: 'inf' },
      });
      _startPolling(jobId, syntheticNeutralized);
    } else {
      // error ou cancelled — job terminé côté serveur, on vide le storage
      _clearJobFromStorage();
    }
  } catch {
    // 404 ou erreur réseau : job disparu (redémarrage serveur) — on vide le storage
    _clearJobFromStorage();
  }
}

// ── Auto-save de la préparation de semaine ────────────────────────────────

function _saveCurrentWeekSnapshot() {
  const ps = usePlanningStore.getState();
  const ss = useProjectStore.getState();
  if (ps.selectedWeek === null || !ss.schoolYearConfig) return;
  ss.saveWeek({
    weekNumber: ps.selectedWeek,
    schoolYear: ss.schoolYearConfig.year,
    savedAt: Date.now(),
    taskGroups: ps.taskGroups,
    manualBlockedZones: ps.blockedZones
      .filter((z) => !z.source || z.source === 'manual')
      .map((z) => ({
        id: z.id,
        start: z.start.toISOString(),
        end: z.end.toISOString(),
        label: z.label,
        source: z.source,
      })),
    preNeutralizedKeys: ps.preNeutralizedKeys,
    manualEnforcedMap: ps.manualEnforcedMap,
    // Read-back volontaire (pas une mutation) : les cours manuels sont désormais gérés par
    // addManualCourse/removeManualCourse/updateManualCourse, qui écrivent directement dans
    // weekSaves. saveWeek remplace tout le snapshot, donc il faut relire l'existant ici pour
    // ne jamais le perdre lors d'une sauvegarde déclenchée par autre chose (taskGroups, etc.).
    manualCourses: getManualCoursesForWeek(ss.weekSaves, ps.selectedWeek),
  });
}

if (typeof window !== 'undefined') {
  void _resumePendingJob();

  // Sauvegarde déclenchée par une modification dans usePlanningStore
  usePlanningStore.subscribe((state, prev) => {
    // Ignorer les changements de semaine (setSelectedWeek gère la restauration)
    if (state.selectedWeek !== prev.selectedWeek) return;
    if (
      state.taskGroups === prev.taskGroups &&
      state.blockedZones === prev.blockedZones &&
      state.preNeutralizedKeys === prev.preNeutralizedKeys &&
      state.manualEnforcedMap === prev.manualEnforcedMap
    ) return;
    _saveCurrentWeekSnapshot();
  });

  // Plus de subscribe sur useProjectStore.allCourses ici : les cours manuels n'y transitent
  // plus (addManualCourse/removeManualCourse/updateManualCourse écrivent directement dans
  // weekSaves), donc un changement d'allCourses (import CSV) n'a plus besoin de redéclencher
  // une sauvegarde de snapshot.
}
