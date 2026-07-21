import { create } from 'zustand';
import type { EnforcedData, NeutralizedTaskInfoJSON, ConstraintsData, JobStatusResponse } from '@edt-ts/scheduler-common';
import type { BlockedZone } from '@/lib/calendar/blockedZones';
import { submitJobAsync, pollJob, cancelJob, buildScheduleStatus, JobConflictError, type ScheduleResult, type ScheduleStatus } from '@/lib/api/scheduleApi';
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
import { placementsFromSolution, placementsFromEnforcedMap, enforcedMapFromPlacements } from '@/lib/calendar/placements';
import { computeAutonomyDistribution, type OccupancyEntry } from '@/lib/calendar/autonomyDistribution';
import { resolveNeutralizedTaskById } from '@/lib/taskCardUtils';

export type { TaskGroupConfig };
export type { Placement, PlacementOrigin, ManuallyNeutralizedTask, PlacedNeutralizedTask, AutonomyDistribution } from './types';
import type { Placement, AutonomyDistribution } from './types';
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

  // Résultat de planification (immuable, vient de l'API — source du "↺ Réinitialiser" et des
  // diagnostics de non-placés ; n'est plus lu pour l'affichage, voir `placements`)
  scheduleResult: ScheduleResult | null;

  activeNeutralizedTasks: NeutralizedTaskInfoJSON[];

  /** Emploi du temps courant de la semaine — toutes origines confondues (auto, imposé, retouché). */
  placements: Placement[];
  /** Déplace/édite un placement. Un `auto` dont le patch touche startTime/duration/resources bascule en `post-enforced`. */
  updatePlacement: (placementId: string, patch: Partial<Omit<Placement, 'placementId' | 'taskId'>>) => void;
  addPlacement: (placement: Placement) => void;
  removePlacement: (placementId: string) => void;
  /** Remet la solution courante à son état initial du moteur. */
  resetCurrentSolution: () => void;

  // Filtrage
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Contraintes de session — map augmentée (manuelle + propagation de groupe), consommée par
  // SidebarPreparation (badge "imposé" en mode préparation) et par runSchedule (payload moteur).
  // Le rendu calendrier ne la lit plus directement : voir `placements` (origin: 'pre-enforced').
  enforcedMap: Record<string, EnforcedData>;

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

  /** Calcule et applique la répartition automatique d'un cours Autonomie neutralisé (taskId). */
  distributeAutonomy: (taskId: string) => void;

  /** Annule une répartition : retire tous les morceaux placés et l'entrée de suivi (taskId). */
  cancelAutonomyDistribution: (taskId: string) => void;

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
        placements: placementsFromEnforcedMap(restoredEnforcedMap, snapshot.manualEnforcedMap),
        activeNeutralizedTasks: [],
        manuallyNeutralizedTasks: [],
        autonomyDistributions: {},
        syntheticNeutralizedTasks: [],
        status: null,
        taskGroups: snapshot.taskGroups,
        manualEnforcedMap: snapshot.manualEnforcedMap,
        enforcedMap: restoredEnforcedMap,
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
        placements: [],
        activeNeutralizedTasks: [],
        preNeutralizedKeys: [],
        manuallyNeutralizedTasks: [],
        autonomyDistributions: {},
        syntheticNeutralizedTasks: [],
        blockedZones: initialBlockedZones,
        status: null,
        taskGroups: [],
        manualEnforcedMap: {},
        enforcedMap: {},
      });
    }
  },

  scheduleResult: null,

  activeNeutralizedTasks: [],
  placements: [],
  updatePlacement: (placementId, patch) => {
    set((state) => ({
      placements: state.placements.map((p) => {
        if (p.placementId !== placementId) return p;
        const touchesPosition = 'startTime' in patch || 'duration' in patch || 'resources' in patch;
        const origin = p.origin === 'auto' && touchesPosition ? 'post-enforced' : p.origin;
        return { ...p, ...patch, origin };
      }),
    }));
  },
  addPlacement: (placement) => {
    set((state) => ({
      placements: [...state.placements.filter((p) => p.placementId !== placement.placementId), placement],
    }));
  },
  removePlacement: (placementId) => {
    set((state) => ({
      placements: state.placements.filter((p) => p.placementId !== placementId),
    }));
  },
  resetCurrentSolution: () => {
    const { scheduleResult, syntheticNeutralizedTasks, enforcedMap } = get();
    if (!scheduleResult) return;
    const solution = scheduleResult.solution;
    // Les tâches imposées reviennent placées par le moteur (origin 'auto') : les repasser en
    // 'pre-enforced' pour tout taskId présent dans l'imposition courante, sinon l'origine se
    // perdrait à chaque réinitialisation (même règle que applyPendingResult).
    const placements = placementsFromSolution(solution?.tasks ?? []).map((p) =>
      p.taskId in enforcedMap ? { ...p, origin: 'pre-enforced' as const } : p,
    );
    set({
      placements,
      manuallyNeutralizedTasks: [],
      autonomyDistributions: {},
      activeNeutralizedTasks: [...(solution?.neutralizedTasks ?? []), ...syntheticNeutralizedTasks],
    });
  },

  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  enforcedMap: {},

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

    const { selectedWeek, placements, blockedZones, taskGroups, preNeutralizedKeys, pendingJobResult } = get();
    // Reconstruit depuis `placements` (source de vérité affichée) plutôt que de lire l'ancien
    // champ `enforcedMap` séparément — propagés compris, le moteur doit recevoir la même
    // imposition augmentée qu'avant ce chantier (cf. lib/calendar/placements.ts).
    const enforcedMap = enforcedMapFromPlacements(placements);
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
    const keptIds = new Set<string>();
    const preNeutCourses: CourseTaskDataWithId[] = [];

    for (const course of coursesForWeek) {
      if (preNeutSet.has(course.id)) {
        preNeutCourses.push(course);
      } else {
        keptIds.add(course.id);
        filteredCourses.push(course);
      }
    }

    // taskGroups filtré sur les cours conservés (non pré-neutralisés) — les impositions
    // (enforcedMap) sont déjà clées par course.id, aucun remapping n'est nécessaire.
    // Restreindre aux cours conservés reste en revanche nécessaire pour filterResourcesForCourses :
    // sans ça, une ressource référencée uniquement par une imposition portant sur un cours
    // pré-neutralisé rentrerait dans le payload, ce que ce filtrage existe précisément pour
    // éviter. Un cours peut être à la fois pré-neutralisé et imposé — togglePreNeutralized ne
    // nettoie pas manualEnforcedMap, et réciproquement.
    const keptEnforced = Object.fromEntries(
      Object.entries(enforcedMap).filter(([id]) => keptIds.has(id)),
    );
    const remappedTaskGroups: TaskGroupConfig[] = taskGroups.map((g) => ({
      ...g,
      courseKeys: g.courseKeys.filter((k) => keptIds.has(k)),
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
    const filteredResources = filterResourcesForCourses(resources, coursesWithGroups, keptEnforced);

    const clientId = getClientId();
    const submitParams = {
      week: selectedWeek,
      courses: coursesWithGroups,
      resources: filteredResources,
      constraintsData: constraints as ConstraintsData | null,
      enforcedMap,
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
    const { pendingJobResult, enforcedMap } = get();
    if (!pendingJobResult) return;
    const { result, syntheticNeutralized, week } = pendingJobResult;
    const best = result.solution;

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

    // Les tâches imposées reviennent placées par le moteur (origin 'auto') : les repasser en
    // 'pre-enforced' pour tout taskId présent dans l'imposition courante, sinon l'origine se
    // perdrait à chaque planification.
    const placements = placementsFromSolution(best.tasks).map((p) =>
      p.taskId in enforcedMap ? { ...p, origin: 'pre-enforced' as const } : p,
    );

    set({
      selectedWeek: week,
      scheduleResult: result,
      placements,
      activeNeutralizedTasks: [...(best.neutralizedTasks ?? []), ...syntheticNeutralized],
      syntheticNeutralizedTasks: syntheticNeutralized,
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
      scheduleResult: null,
      // Cette action invalide déjà la solution : elle remplace toute la liste par les seuls
      // placements pre-enforced (comportement actuel conservé, cf. §4.4 du plan).
      placements: placementsFromEnforcedMap(augmented, manualMap),
      activeNeutralizedTasks: [],
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

  distributeAutonomy: (taskId) => {
    const {
      placements, manuallyNeutralizedTasks,
      activeNeutralizedTasks, autonomyDistributions, selectedWeek, blockedZones,
    } = get();
    if (selectedWeek === null) return;

    const info = resolveNeutralizedTaskById(taskId, activeNeutralizedTasks, manuallyNeutralizedTasks);
    if (!info || info.type !== 'Autonomie') return;

    const { allCourses, weekSaves, availabilityManager, schoolYearConfig } = useProjectStore.getState();
    if (!availabilityManager) return;

    const monday = getMondayOfISOWeek(selectedWeek, resolveCalendarYear(schoolYearConfig, selectedWeek));

    // Ce qui occupe déjà le calendrier affiché : la liste unique des placements (toutes
    // origines). Les morceaux déjà distribués pour D'AUTRES cours Autonomie susceptibles de
    // partager un groupe y figurent déjà : ce sont des placements de plein droit, donc inclus.
    // `duration` résolue via le cours quand le placement ne la porte pas explicitement (règle 1).
    const courseById = new Map(getCoursesForWeek(allCourses, weekSaves, selectedWeek).map((c) => [c.id, c]));
    const occupancy: OccupancyEntry[] = placements.map((p) => ({
      startTime: p.startTime,
      duration: p.duration ?? courseById.get(p.taskId)?.duration ?? 0,
      groups: p.resources.groups,
    }));

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

    // Chaque morceau devient un placement `post-enforced` de plein droit (déplaçable, éditable,
    // exporté en iCal). `taskId` référence le cours Autonomie réel (résolvable via courseById) ;
    // `placementId` distingue les morceaux entre eux — c'est le cas de fragmentation
    // (placementId ≠ taskId, règle 3, §3 du plan) déjà nécessaire à l'étape 1 pour cette
    // fonctionnalité préexistante. constraintViolation:'none' car posés dans des créneaux
    // réellement libres.
    const pieces: Placement[] = result.pieces.map((p, i) => ({
      placementId: `${taskId}-piece-${i}`,
      taskId,
      startTime: p.startTime,
      duration: p.duration,
      resources: { teachers: info.teachers, groups: info.groups, rooms: info.rooms },
      origin: 'post-enforced',
      constraintViolation: 'none',
    }));

    const distribution: AutonomyDistribution = {
      originalTaskId: taskId,
      totalDuration: info.duration,
      remainingDuration: result.remainingDuration,
      pieceIds: pieces.map((pc) => pc.placementId),
    };

    set({
      placements: [...placements, ...pieces],
      autonomyDistributions: { ...autonomyDistributions, [taskId]: distribution },
    });
  },

  cancelAutonomyDistribution: (taskId) => {
    set((state) => {
      const dist = state.autonomyDistributions[taskId];
      const next = { ...state.autonomyDistributions };
      delete next[taskId];
      return {
        // Retirer tous les morceaux issus de cette répartition (par placementId — `pieceIds`
        // reste correct même si un morceau a déjà été retiré à la main entre-temps).
        placements: dist ? state.placements.filter((p) => !dist.pieceIds.includes(p.placementId)) : state.placements,
        autonomyDistributions: next,
      };
    });
  },

  resetScheduleResult: () => {
    if (_pollingInterval !== null) { clearInterval(_pollingInterval); _pollingInterval = null; }
    const { enforcedMap, manualEnforcedMap } = get();
    set({
      scheduleResult: null,
      activeNeutralizedTasks: [],
      // Retour à la préparation : les impositions restent visibles sur le calendrier (comme
      // avant ce chantier, cf. `activeSolution.length === 0 ? enforcedEventsState : []`) ;
      // auto/post-enforced disparaissent avec la solution.
      placements: placementsFromEnforcedMap(enforcedMap, manualEnforcedMap),
      manuallyNeutralizedTasks: [],
      autonomyDistributions: {},
      syntheticNeutralizedTasks: [],
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
      activeNeutralizedTasks: [],
      placements: [],
      preNeutralizedKeys: [],
      manuallyNeutralizedTasks: [],
      autonomyDistributions: {},
      syntheticNeutralizedTasks: [],
      enforcedMap: {},
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
  const first = jobStatus.result?.[0];
  const result: ScheduleResult = {
    solution: first
      ? {
          isComplete: first.isComplete,
          score: first.score,
          tasks: first.solutions,
          neutralizedTasks: first.neutralizedTasks,
          provenOptimal: first.provenOptimal,
          rootBound: first.rootBound,
        }
      : { isComplete: false, tasks: [], neutralizedTasks: [] },
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
    // Dérivé de `placements` (source affichée), propagés exclus — reproduit `manualEnforcedMap`.
    manualEnforcedMap: enforcedMapFromPlacements(ps.placements, { excludeDerived: true }),
    // Read-back volontaire (pas une mutation) : les cours manuels sont désormais gérés par
    // addManualCourse/removeManualCourse/updateManualCourse, qui écrivent directement dans
    // weekSaves. saveWeek remplace tout le snapshot, donc il faut relire l'existant ici pour
    // ne jamais le perdre lors d'une sauvegarde déclenchée par autre chose (taskGroups, etc.).
    manualCourses: getManualCoursesForWeek(ss.weekSaves, ps.selectedWeek),
    // Idem pour la note libre (setWeekNote écrit directement dans weekSaves) : sans cette
    // relecture, tout changement de taskGroups/blockedZones/enforcedMap effacerait la note.
    note: ss.weekSaves[String(ps.selectedWeek)]?.note,
  });
}

if (typeof window !== 'undefined') {
  void _resumePendingJob();

  // Sauvegarde déclenchée par une modification dans usePlanningStore
  usePlanningStore.subscribe((state, prev) => {
    // Ignorer les changements de semaine (setSelectedWeek gère la restauration)
    if (state.selectedWeek !== prev.selectedWeek) return;
    // `placements` change à chaque déplacement d'une tâche auto/post-enforced — ne redéclencher
    // une sauvegarde que si les `pre-enforced` (non dérivés) ont réellement changé, sinon chaque
    // retouche réécrirait tout le projet en localStorage.
    const enforcedChanged =
      state.placements !== prev.placements &&
      JSON.stringify(enforcedMapFromPlacements(state.placements, { excludeDerived: true })) !==
        JSON.stringify(enforcedMapFromPlacements(prev.placements, { excludeDerived: true }));
    if (
      state.taskGroups === prev.taskGroups &&
      state.blockedZones === prev.blockedZones &&
      state.preNeutralizedKeys === prev.preNeutralizedKeys &&
      state.manualEnforcedMap === prev.manualEnforcedMap &&
      !enforcedChanged
    ) return;
    _saveCurrentWeekSnapshot();
  });

  // Plus de subscribe sur useProjectStore.allCourses ici : les cours manuels n'y transitent
  // plus (addManualCourse/removeManualCourse/updateManualCourse écrivent directement dans
  // weekSaves), donc un changement d'allCourses (import CSV) n'a plus besoin de redéclencher
  // une sauvegarde de snapshot.
}
