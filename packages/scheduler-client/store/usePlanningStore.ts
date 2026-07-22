import { create } from 'zustand';
import type { EnforcedData, ConstraintsData, JobStatusResponse } from '@edt-ts/scheduler-common';
import type { BlockedZone } from '@/lib/calendar/blockedZones';
import { submitJobAsync, pollJob, cancelJob, buildScheduleStatus, JobConflictError, type ScheduleResult, type ScheduleStatus } from '@/lib/api/scheduleApi';
import { getClientId } from '@/lib/api/clientId';
import { useProjectStore } from '@/store/useProjectStore';
import { useAppConfigStore } from '@/store/useAppConfigStore';
import { type TaskGroupConfig, type GroupType, buildTaskGroupData, getCourseGroupInfo, computeGroupEnforcements } from '@/lib/taskGroupUtils';
import { computeHolidayZonesForWeek, resolveCalendarYear } from '@/lib/schoolHolidays';
import { getCoursesForWeek, getManualCoursesForWeek } from '@/lib/weekCourses';
import { filterResourcesForCourses } from '@/lib/filterResourcesForCourses';
import { createBlockedZonesSlice, type BlockedZonesSlice } from '@/store/slices/blockedZonesSlice';
import { createTaskGroupsSlice, type TaskGroupsSlice } from '@/store/slices/taskGroupsSlice';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import { getMondayOfISOWeek, dateToStartTime } from '@/lib/calendar/calendarUtils';
import { placementsFromSolution, placementsFromEnforcedMap, enforcedMapFromPlacements } from '@/lib/calendar/placements';
import { enforcedDataFromPlacement } from '@/lib/calendar/promotion';
import { computeAutonomyDistribution, type OccupancyEntry } from '@/lib/calendar/autonomyDistribution';
import { unplacedFromEngine, unplacedFromPreNeutralized } from '@/lib/calendar/unplaced';

export type { TaskGroupConfig };
export type { Placement, PlacementOrigin, Unplaced, UnplacedOrigin } from './types';
import type { Placement, Unplaced } from './types';
export type { PreparedWeekSnapshot } from './slices/weekSavesSlice';

/**
 * Déduplique par `taskId` en gardant la **première** occurrence. Les appelants passent donc les
 * `user-pre` en tête : une collision ne devrait pas se produire (un `user-pre` n'est jamais envoyé
 * au moteur, donc jamais renvoyé neutralisé), mais si elle survenait, perdre l'exclusion amont
 * serait bien plus grave que perdre des diagnostics — la tâche cesserait d'être exclue des runs
 * suivants **et** ne serait plus persistée dans `preNeutralizedKeys`, en silence.
 */
function dedupeUnplaced(entries: Unplaced[]): Unplaced[] {
  const seen = new Set<string>();
  const result: Unplaced[] = [];
  for (const entry of entries) {
    if (seen.has(entry.taskId)) continue;
    seen.add(entry.taskId);
    result.push(entry);
  }
  return result;
}

/**
 * Déduplique par `placementId` en gardant la **première** occurrence. Les appelants passent les
 * `pre-enforced` recalculés en tête (§4.3 du plan) : une imposition perdue est plus grave qu'un
 * placement persisté perdu, même raisonnement que `dedupeUnplaced`.
 */
function dedupePlacements(entries: Placement[]): Placement[] {
  const seen = new Set<string>();
  const result: Placement[] = [];
  for (const entry of entries) {
    if (seen.has(entry.placementId)) continue;
    seen.add(entry.placementId);
    result.push(entry);
  }
  return result;
}

/**
 * Copie de `map` privée de `key` — référence inchangée si la clé n'y est pas, pour ne pas
 * déclencher l'auto-save (dont la garde compare les références) sans raison.
 */
function omitKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
}

/**
 * Map manuelle → map augmentée (manuelle + propagation de groupe). Même calcul pour
 * `handleEnforceChange`, `setSelectedWeek` (restauration) et `returnToPreparation` (promotion) :
 * factorisé ici pour ne pas dupliquer l'appel à `computeGroupEnforcements`.
 */
function augmentEnforcedMap(
  manualMap: Record<string, EnforcedData>,
  taskGroups: TaskGroupConfig[],
  courses: CourseTaskDataWithId[],
): Record<string, EnforcedData> {
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
  return augmented;
}

export type Status = ScheduleStatus;

/**
 * Semaine ISO à laquelle démarre une année universitaire (ex: rentrée début septembre).
 * Un Projet chevauche 2 années civiles (S35-52 puis S1-34) — 1 n'a donc pas de sens comme
 * point de départ par défaut.
 */
export const DEFAULT_WEEK = 35;

// ── Interface ──────────────────────────────────────────────────────────────
// Contient les données "de travail" de la session : non persistées.

export interface PlanningStore extends BlockedZonesSlice, TaskGroupsSlice {
  // Sélection de la semaine
  selectedWeek: number | null;
  setSelectedWeek: (week: number | null) => void;

  // Résultat de planification (immuable, vient de l'API — source des diagnostics de non-placés ;
  // pas persisté, n'est plus lu pour l'affichage ni pour "↺ Réinitialiser", voir `placements`/`lastRun`)
  scheduleResult: ScheduleResult | null;

  /**
   * Sortie brute du dernier calcul (placements `auto` + non-placés `engine`, avant remap
   * `pre-enforced`/dédup `user-pre`) — persistée, source de "↺ Réinitialiser" qui survit au
   * rechargement (§4.6 du plan). `null` si aucun calcul n'a encore tourné pour cette semaine.
   */
  lastRun: { placements: Placement[]; unplaced: Unplaced[] } | null;

  /** Tâches de la semaine qui ne sont pas (ou pas entièrement) posées. */
  unplaced: Unplaced[];
  /** Bascule l'exclusion amont d'un cours (mode préparation). */
  togglePreNeutralized: (taskId: string) => void;

  /**
   * Retire de l'état vivant de la semaine courante toute référence aux cours donnés (suppression
   * d'un cours). Pendant de `pruneWeekSavesOfCourseIds`, qui fait le même travail sur le disque :
   * sans cet élagage-ci, l'auto-save réécrirait aussitôt les références fantômes que le store
   * projet vient d'élaguer.
   */
  pruneCourseIds: (courseIds: string[]) => void;
  /** Retire un placement du calendrier et signale la tâche comme non placée. */
  unplaceTask: (placementId: string, origin: Unplaced['origin']) => void;

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
  pendingJobResult: { week: number; result: ScheduleResult } | null;
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

  /**
   * Retour à la préparation, en promouvant les placements désignés (retouches `post-enforced`)
   * en impositions manuelles. Liste vide = ancien comportement de `resetScheduleResult`.
   */
  returnToPreparation: (promotedPlacementIds: string[]) => void;
}

// ── Type export pour les hooks ──────────────────────────────────────────────
export type DraggingResources = NonNullable<PlanningStore['draggingExternal']>;

// ── Etat interne du polling (hors store React) ──────────────────────────────
let _pollingInterval: ReturnType<typeof setInterval> | null = null;

// ── Store ──────────────────────────────────────────────────────────────────

export const usePlanningStore = create<PlanningStore>()((...a) => {
  const [set, get] = a;
  return {
  ...createBlockedZonesSlice(...a),
  ...createTaskGroupsSlice(...a),

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
      const restoredEnforcedMap = augmentEnforcedMap(snapshot.manualEnforcedMap, snapshot.taskGroups, restoredCourses);

      // Désérialiser les zones bloquées manuelles (ISO string → Date)
      const restoredManualZones: BlockedZone[] = snapshot.manualBlockedZones.map((z) => ({
        id: z.id,
        start: new Date(z.start),
        end: new Date(z.end),
        label: z.label,
        source: z.source,
      }));

      // Élaguer les placements persistés dont le cours n'existe plus (réimport CSV) : sans ça,
      // un placement fantôme reste dans l'état sans jamais s'afficher, et repart en sauvegarde
      // indéfiniment (§4.3 du plan).
      // Même élagage sur les non-placés : un `taskId` fantôme y resterait tout aussi
      // indéfiniment, et alimenterait une pioche affichant une carte sans cours.
      //
      // ⚠️ Garde indispensable : n'élaguer QUE si des cours ont été résolus pour cette semaine.
      // Une liste vide veut dire « aucun cours connu », ce qui recouvre deux situations
      // indiscernables ici — la semaine n'a réellement aucun cours, ou `allCourses` n'est pas
      // encore disponible. Élaguer sans cette garde effacerait silencieusement TOUS les
      // placements et non-placés persistés dans le second cas.
      const restoredCourseIds = new Set(restoredCourses.map((c) => c.id));
      const canPrune = restoredCourseIds.size > 0;
      const persistedPlacements = (snapshot.placements ?? []).filter(
        (p) => !canPrune || restoredCourseIds.has(p.taskId),
      );
      const persistedUnplaced = (snapshot.unplaced ?? []).filter(
        (u) => !canPrune || restoredCourseIds.has(u.taskId),
      );

      // Une tâche explicitement retirée du calendrier après un calcul (`user-post`) ne doit pas
      // revenir posée à la restauration. Le cas ne se produit que pour une imposition *propagée*
      // par un groupe : une imposition manuelle retirée a déjà quitté `manualEnforcedMap`
      // (`unplaceTask`), alors qu'une propagée est re-dérivée ici à chaque lecture.
      const removedByUser = new Set(
        persistedUnplaced.filter((u) => u.origin === 'user-post').map((u) => u.taskId),
      );

      set({
        selectedWeek: week,
        searchQuery: '',
        scheduleResult: null,
        // Les `pre-enforced` recalculés priment sur les placements persistés (dédup par
        // placementId) : une imposition perdue est plus grave qu'un placement auto perdu.
        placements: dedupePlacements([
          ...placementsFromEnforcedMap(restoredEnforcedMap, snapshot.manualEnforcedMap).filter(
            (p) => !removedByUser.has(p.taskId),
          ),
          ...persistedPlacements,
        ]),
        unplaced: dedupeUnplaced([
          ...unplacedFromPreNeutralized(snapshot.preNeutralizedKeys),
          ...persistedUnplaced,
        ]),
        lastRun: snapshot.lastRun ?? null,
        status: null,
        taskGroups: snapshot.taskGroups,
        manualEnforcedMap: snapshot.manualEnforcedMap,
        enforcedMap: restoredEnforcedMap,
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
        unplaced: [],
        lastRun: null,
        blockedZones: initialBlockedZones,
        status: null,
        taskGroups: [],
        manualEnforcedMap: {},
        enforcedMap: {},
      });
    }
  },

  scheduleResult: null,
  lastRun: null,

  unplaced: [],
  togglePreNeutralized: (taskId) => {
    set((state) => {
      const exists = state.unplaced.some((u) => u.taskId === taskId && u.origin === 'user-pre');
      return {
        unplaced: exists
          ? state.unplaced.filter((u) => !(u.taskId === taskId && u.origin === 'user-pre'))
          : [...state.unplaced, { taskId, origin: 'user-pre' as const }],
      };
    });
  },
  pruneCourseIds: (courseIds) => {
    const removed = new Set(courseIds);
    if (removed.size === 0) return;
    set((state) => {
      // Un groupe tombé sous 2 membres n'a plus de sens — même règle que
      // `pruneWeekSavesOfCourseIds`, dont ceci est le pendant en mémoire.
      const taskGroups = state.taskGroups
        .map((g) => ({ ...g, courseKeys: g.courseKeys.filter((k) => !removed.has(k)) }))
        .filter((g) => g.courseKeys.length >= 2);
      const manualEnforcedMap = Object.fromEntries(
        Object.entries(state.manualEnforcedMap).filter(([id]) => !removed.has(id)),
      );
      // `enforcedMap` est recalculée depuis la map manuelle élaguée ET les groupes élagués : un
      // simple filtrage laisserait les propagations d'un cours supprimé vers ses coéquipiers.
      const { allCourses, weekSaves } = useProjectStore.getState();
      const courses =
        state.selectedWeek !== null ? getCoursesForWeek(allCourses, weekSaves, state.selectedWeek) : [];
      const enforcedMap = augmentEnforcedMap(manualEnforcedMap, taskGroups, courses);
      // Les `pre-enforced` sont intégralement re-dérivés de la map recalculée, pas filtrés : une
      // imposition propagée depuis le cours supprimé vers ses coéquipiers a disparu de
      // `enforcedMap`, un simple filtre sur `taskId` la laisserait affichée (même schéma que
      // `setSelectedWeek`).
      const survivors = state.placements.filter(
        (p) => !removed.has(p.taskId) && p.origin !== 'pre-enforced',
      );
      return {
        taskGroups,
        manualEnforcedMap,
        enforcedMap,
        placements: dedupePlacements([
          ...placementsFromEnforcedMap(enforcedMap, manualEnforcedMap),
          ...survivors,
        ]),
        unplaced: state.unplaced.filter((u) => !removed.has(u.taskId)),
        lastRun: state.lastRun && {
          placements: state.lastRun.placements.filter((p) => !removed.has(p.taskId)),
          unplaced: state.lastRun.unplaced.filter((u) => !removed.has(u.taskId)),
        },
      };
    });
  },
  unplaceTask: (placementId, origin) => {
    set((state) => {
      const removed = state.placements.find((p) => p.placementId === placementId);
      if (!removed) return {};
      const placements = state.placements.filter((p) => p.placementId !== placementId);
      const exists = state.unplaced.some((u) => u.taskId === removed.taskId);
      return {
        placements,
        unplaced: exists ? state.unplaced : [...state.unplaced, { taskId: removed.taskId, origin }],
        // Une imposition retirée du calendrier n'est plus une imposition : les maps sont la
        // projection des `pre-enforced` affichés (hypothèse déjà faite par
        // `_saveCurrentWeekSnapshot`, qui les re-dérive de `placements`). Les laisser diverger la
        // ferait resurgir — au prochain `returnToPreparation`, qui relit `manualEnforcedMap`, ou
        // au prochain rechargement.
        ...(removed.origin === 'pre-enforced'
          ? {
              manualEnforcedMap: omitKey(state.manualEnforcedMap, removed.taskId),
              enforcedMap: omitKey(state.enforcedMap, removed.taskId),
            }
          : {}),
      };
    });
  },
  placements: [],
  updatePlacement: (placementId, patch) => {
    set((state) => {
      const placements = state.placements.map((p) => {
        if (p.placementId !== placementId) return p;
        const touchesPosition = 'startTime' in patch || 'duration' in patch || 'resources' in patch;
        const origin = p.origin === 'auto' && touchesPosition ? 'post-enforced' : p.origin;
        return { ...p, ...patch, origin };
      });
      const target = placements.find((p) => p.placementId === placementId);
      // Retoucher une imposition déjà planifiée doit suivre dans les maps, même raison que dans
      // `unplaceTask` : sinon `returnToPreparation` (ou un rechargement) la replacerait à son
      // ancienne position. Un `derived` (propagé par un groupe) ne remonte pas dans la map
      // manuelle — il est recalculé à la lecture, jamais persisté (cf. placements.ts).
      if (!target || target.origin !== 'pre-enforced') return { placements };
      const enforced = enforcedDataFromPlacement(target);
      return {
        placements,
        enforcedMap: { ...state.enforcedMap, [target.taskId]: enforced },
        manualEnforcedMap: target.derived
          ? state.manualEnforcedMap
          : { ...state.manualEnforcedMap, [target.taskId]: enforced },
      };
    });
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
    // Lit `lastRun` (persisté) plutôt que `scheduleResult` (session uniquement) : survit au
    // rechargement de page (§4.6 du plan).
    const { lastRun, unplaced, enforcedMap } = get();
    if (!lastRun) return;
    // Les tâches imposées reviennent placées par le moteur (origin 'auto') : les repasser en
    // 'pre-enforced' pour tout taskId présent dans l'imposition courante, sinon l'origine se
    // perdrait à chaque réinitialisation (même règle que applyPendingResult).
    const placements = lastRun.placements.map((p) =>
      p.taskId in enforcedMap ? { ...p, origin: 'pre-enforced' as const } : p,
    );
    const userPre = unplaced.filter((u) => u.origin === 'user-pre');
    set({
      placements,
      unplaced: dedupeUnplaced([...userPre, ...lastRun.unplaced]),
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

    const { selectedWeek, placements, blockedZones, taskGroups, unplaced, pendingJobResult } = get();
    // On n'envoie pas au moteur ce que l'utilisateur a explicitement écarté, quel que soit le
    // moment où il l'a fait (`user-pre` avant le run, `user-post` après un run précédent) : un
    // "Planifier" ne doit pas défaire un retrait manuel. Les `engine` (le moteur seul a échoué à
    // les placer) restent envoyées : les conditions ont pu changer entre-temps (§3.3 du plan).
    const excludedTaskIds = unplaced
      .filter((u) => u.origin === 'user-pre' || u.origin === 'user-post')
      .map((u) => u.taskId);
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

    // Filtrage des tâches exclues (§3.3 du plan)
    const excludedSet = new Set(excludedTaskIds);
    const filteredCourses: CourseTaskDataWithId[] = [];
    const keptIds = new Set<string>();

    for (const course of coursesForWeek) {
      if (excludedSet.has(course.id)) continue;
      keptIds.add(course.id);
      filteredCourses.push(course);
    }

    // taskGroups filtré sur les cours conservés (non exclus) — les impositions
    // (enforcedMap) sont déjà clées par course.id, aucun remapping n'est nécessaire.
    // Restreindre aux cours conservés reste en revanche nécessaire pour filterResourcesForCourses :
    // sans ça, une ressource référencée uniquement par une imposition portant sur un cours
    // exclu rentrerait dans le payload, ce que ce filtrage existe précisément pour
    // éviter. Un cours peut être à la fois exclu et imposé — togglePreNeutralized/unplaceTask ne
    // nettoient pas manualEnforcedMap, et réciproquement.
    const keptEnforced = Object.fromEntries(
      Object.entries(enforcedMap).filter(([id]) => keptIds.has(id)),
    );
    const remappedTaskGroups: TaskGroupConfig[] = taskGroups.map((g) => ({
      ...g,
      courseKeys: g.courseKeys.filter((k) => keptIds.has(k)),
    }));

    const { coursesWithGroups, declarations } = buildTaskGroupData(filteredCourses, remappedTaskGroups);

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
      _saveJobToStorage(jobId);
      _startPolling(jobId);

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
              _saveJobToStorage(newJobId);
              _startPolling(newJobId);
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
              _saveJobToStorage(newJobId);
              _startPolling(newJobId);
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
              pendingJobResult: _normalizeJobResult(jobStatus),
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
    const { pendingJobResult, enforcedMap, unplaced } = get();
    if (!pendingJobResult) return;
    const { result, week } = pendingJobResult;
    const best = result.solution;
    const userPre = unplaced.filter((u) => u.origin === 'user-pre');
    // Comme `userPre`, les `user-post` d'avant ce run ne sont jamais envoyées au moteur (§3.3 du
    // plan) : elles ne peuvent donc pas revenir dans `rawUnplaced` et seraient sinon effacées par
    // le `set` ci-dessous plutôt que de survivre au run comme les `user-pre`.
    const userPost = unplaced.filter((u) => u.origin === 'user-post');

     // Si le moteur n'a placé aucune tâche, on reste en mode préparation
    if (!best || best.tasks.length === 0) {
      const neutralizedCount = (best?.neutralizedTasks?.length ?? 0) + userPre.length;
      const neutralizedMsg = neutralizedCount ? ` — ${neutralizedCount} cours neutralisé(s)` : '';
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

    // Sortie brute du calcul, avant remap `pre-enforced`/dédup `user-pre` — persistée telle
    // quelle, c'est la référence de "↺ Réinitialiser" après rechargement (§4.6 du plan).
    const rawPlacements = placementsFromSolution(best.tasks);
    const rawUnplaced = unplacedFromEngine(best.neutralizedTasks ?? []);

    // Les tâches imposées reviennent placées par le moteur (origin 'auto') : les repasser en
    // 'pre-enforced' pour tout taskId présent dans l'imposition courante, sinon l'origine se
    // perdrait à chaque planification.
    const placements = rawPlacements.map((p) =>
      p.taskId in enforcedMap ? { ...p, origin: 'pre-enforced' as const } : p,
    );

    // Dédup sur `taskId` plutôt que de supposer qu'un `user-pre`/`user-post` (jamais envoyé au
    // moteur) ne peut pas revenir dans neutralizedTasks (§4.3 du plan précédent, toujours valable).
    set({
      selectedWeek: week,
      scheduleResult: result,
      lastRun: { placements: rawPlacements, unplaced: rawUnplaced },
      placements,
      unplaced: dedupeUnplaced([...userPre, ...userPost, ...rawUnplaced]),
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

    const augmented = augmentEnforcedMap(manualMap, taskGroups, courses);

    set({
      manualEnforcedMap: manualMap,
      enforcedMap: augmented,
      scheduleResult: null,
      // La bascule de mode est désormais fondée sur `lastRun` et non sur `scheduleResult` : sans
      // ce `null`, cette action laisserait la vue solution ouverte sur un calendrier réduit aux
      // seules impositions. « Ne pas toucher à handleEnforceChange » (§4.5) veut dire préserver
      // son comportement observable, ce qui impose de suivre le déménagement de la porte du mode.
      lastRun: null,
      // Cette action invalide déjà la solution : elle remplace toute la liste par les seuls
      // placements pre-enforced (comportement actuel conservé, cf. §4.4 du plan).
      placements: placementsFromEnforcedMap(augmented, manualMap),
      // Plus de solution moteur : les `engine`/`user-post` n'ont plus lieu d'être, seuls les
      // `user-pre` survivent (même règle que `returnToPreparation`).
      unplaced: get().unplaced.filter((u) => u.origin === 'user-pre'),
    });
  },

  // Ne touche plus ni `placements`, ni `unplaced`, ni `scheduleResult` : « signaler, jamais
  // supprimer » (§1.1/§4.5 du plan) — une tâche recouverte devient rouge au rendu (§4.1), elle
  // n'est plus détruite.
  handleBlockedZoneAdd: (start, end) => {
    set((state) => ({
      blockedZones: [
        ...state.blockedZones,
        { id: `bz-${Date.now()}-${Math.random().toString(36).slice(2)}`, start, end },
      ],
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
    }));
  },

  distributeAutonomy: (taskId) => {
    const { placements, selectedWeek, blockedZones } = get();
    if (selectedWeek === null) return;

    const { allCourses, weekSaves, availabilityManager, schoolYearConfig } = useProjectStore.getState();
    if (!availabilityManager) return;

    const courseById = new Map(getCoursesForWeek(allCourses, weekSaves, selectedWeek).map((c) => [c.id, c]));
    const course = courseById.get(taskId);
    if (!course || course.type !== 'Autonomie') return;

    // Le bouton « Répartir » n'est visible (SidebarAnalysis) que si `taskId` n'a encore aucun
    // placement : pas d'alternatives à résoudre, premier alternatif = seul possible.
    const teachers = course.teacher.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
    const groups = course.groups.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
    const rooms = course.rooms.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));

    const monday = getMondayOfISOWeek(selectedWeek, resolveCalendarYear(schoolYearConfig, selectedWeek));

    // Ce qui occupe déjà le calendrier affiché : la liste unique des placements (toutes
    // origines). Les morceaux déjà distribués pour D'AUTRES cours Autonomie susceptibles de
    // partager un groupe y figurent déjà : ce sont des placements de plein droit, donc inclus.
    // `duration` résolue via le cours quand le placement ne la porte pas explicitement (règle 1).
    const occupancy: OccupancyEntry[] = placements.map((p) => ({
      startTime: p.startTime,
      duration: p.duration ?? courseById.get(p.taskId)?.duration ?? 0,
      groups: p.resources.groups,
    }));

    const blockedZonesMinutes = blockedZones
      .map((z) => ({ start: dateToStartTime(monday, z.start), end: dateToStartTime(monday, z.end) }))
      .filter((z) => z.end > z.start);

    const result = computeAutonomyDistribution({
      groupIds: groups,
      week: selectedWeek,
      availabilityManager,
      blockedZonesMinutes,
      occupancy,
      totalDuration: course.duration,
    });

    // Chaque morceau devient un placement `post-enforced` de plein droit (déplaçable, éditable,
    // exporté en iCal). `taskId` référence le cours Autonomie réel (résolvable via courseById) ;
    // `placementId` distingue les morceaux entre eux — c'est le cas de fragmentation
    // (placementId ≠ taskId, règle 3, §3 du plan) déjà nécessaire à l'étape 1 pour cette
    // fonctionnalité préexistante. La violation n'est plus stockée, elle est dérivée au rendu.
    const pieces: Placement[] = result.pieces.map((p, i) => ({
      placementId: `${taskId}-piece-${i}`,
      taskId,
      startTime: p.startTime,
      duration: p.duration,
      resources: { teachers, groups, rooms },
      origin: 'post-enforced',
    }));

    set({ placements: [...placements, ...pieces] });
  },

  cancelAutonomyDistribution: (taskId) => {
    set((state) => ({
      // Plus de `pieceIds` à tenir à jour séparément : tous les morceaux d'une répartition
      // partagent le `taskId` du cours Autonomie source (§4.3 du plan).
      placements: state.placements.filter((p) => p.taskId !== taskId),
    }));
  },

  // Nom hérité de l'ancienne formulation « retour à la préparation » : depuis que le sélecteur de
  // semaine vit dans la barre d'outils (§3.1 du plan), cette action ne sert plus à naviguer —
  // seulement à annuler la planification automatique (§3.2 du plan). Non renommée délibérément :
  // c'est du code, pas de l'UI, et le renommage brouillerait le lien avec les usages existants.
  returnToPreparation: (promotedPlacementIds) => {
    if (_pollingInterval !== null) { clearInterval(_pollingInterval); _pollingInterval = null; }
    const { placements, manualEnforcedMap, taskGroups, selectedWeek, unplaced } = get();
    const { allCourses, weekSaves } = useProjectStore.getState();
    const courses = selectedWeek !== null ? getCoursesForWeek(allCourses, weekSaves, selectedWeek) : [];

    // Retouches désignées (post-enforced uniquement) → impositions manuelles, combo exact.
    const promotedIds = new Set(promotedPlacementIds);
    const promoted: Record<string, EnforcedData> = {};
    for (const p of placements) {
      if (p.origin === 'post-enforced' && promotedIds.has(p.placementId)) {
        promoted[p.taskId] = enforcedDataFromPlacement(p);
      }
    }

    const newManualMap = { ...manualEnforcedMap, ...promoted };
    const augmented = augmentEnforcedMap(newManualMap, taskGroups, courses);

    // Un seul `set` : deux appels (ex. handleEnforceChange() puis un reset séparé)
    // déclencheraient deux fois le `subscribe` d'auto-save, donc deux réécritures complètes du
    // fichier projet en localStorage.
    set({
      manualEnforcedMap: newManualMap,
      enforcedMap: augmented,
      // Retour à la préparation : les impositions (dont celles tout juste promues) restent
      // visibles sur le calendrier ; auto/post-enforced non promues disparaissent avec la
      // solution, ne gardent que les `user-pre`.
      placements: placementsFromEnforcedMap(augmented, newManualMap),
      unplaced: unplaced.filter((u) => u.origin === 'user-pre'),
      scheduleResult: null,
      // Sans quoi la bascule de mode (§4.6, fondée sur `lastRun`) referait apparaître la vue
      // solution après un rechargement suivant un retour explicite à la préparation.
      lastRun: null,
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
      lastRun: null,
      placements: [],
      unplaced: [],
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

function _saveJobToStorage(jobId: string) {
  try { localStorage.setItem(JOB_PERSISTENCE_KEY, JSON.stringify({ jobId, savedAt: Date.now() })); } catch {}
}

function _clearJobFromStorage() {
  try { localStorage.removeItem(JOB_PERSISTENCE_KEY); } catch {}
}

function _loadJobFromStorage(): { jobId: string } | null {
  try {
    const raw = localStorage.getItem(JOB_PERSISTENCE_KEY);
    if (!raw) return null;
    // Un ancien contenu peut porter un `syntheticNeutralized` disparu : simplement ignoré, pas
    // besoin de le typer ni de le lire (§4.3 du plan — tolérer, pas planter).
    const parsed = JSON.parse(raw) as { jobId: string; savedAt?: number };
    if (parsed.savedAt && Date.now() - parsed.savedAt > JOB_TTL_MS) {
      _clearJobFromStorage();
      return null;
    }
    return { jobId: parsed.jobId };
  } catch { return null; }
}

function _normalizeJobResult(jobStatus: JobStatusResponse): { week: number; result: ScheduleResult } {
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
  return { week: jobStatus.week, result };
}

function _startPolling(jobId: string) {
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
            pendingJobResult: _normalizeJobResult(jobStatus),
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
  const { jobId } = persisted;
  try {
    const jobStatus = await pollJob(jobId);
    if (jobStatus.status === 'done') {
      _clearJobFromStorage();
      usePlanningStore.setState({
        pendingJobResult: _normalizeJobResult(jobStatus),
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
      _startPolling(jobId);
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

  const manualBlockedZones = ps.blockedZones
    .filter((z) => !z.source || z.source === 'manual')
    .map((z) => ({
      id: z.id,
      start: z.start.toISOString(),
      end: z.end.toISOString(),
      label: z.label,
      source: z.source,
    }));
  const preNeutralizedKeys = ps.unplaced.filter((u) => u.origin === 'user-pre').map((u) => u.taskId);
  // Dérivé de `placements` (source affichée), propagés exclus — reproduit `manualEnforcedMap`.
  const manualEnforcedMap = enforcedMapFromPlacements(ps.placements, { excludeDerived: true });
  // Read-back volontaire (pas une mutation) : les cours manuels sont désormais gérés par
  // addManualCourse/removeManualCourse/updateManualCourse, qui écrivent directement dans
  // weekSaves. saveWeek remplace tout le snapshot, donc il faut relire l'existant ici pour
  // ne jamais le perdre lors d'une sauvegarde déclenchée par autre chose (taskGroups, etc.).
  const manualCourses = getManualCoursesForWeek(ss.weekSaves, ps.selectedWeek);
  // Idem pour la note libre (setWeekNote écrit directement dans weekSaves) : sans cette
  // relecture, tout changement de taskGroups/blockedZones/enforcedMap effacerait la note.
  const note = ss.weekSaves[String(ps.selectedWeek)]?.note;
  // Placements/non-placés à persister : seuls `auto`/`post-enforced` et `engine`/`user-post` —
  // `pre-enforced` et `user-pre` sont déjà couverts par `manualEnforcedMap`/`preNeutralizedKeys`
  // ci-dessus, les dupliquer créerait deux sources de vérité pour la même chose (§1.2 du plan).
  const persistedPlacements = ps.placements.filter((p) => p.origin !== 'pre-enforced');
  const persistedUnplaced = ps.unplaced.filter((u) => u.origin !== 'user-pre');

  // Ne pas créer un snapshot vide pour une semaine qui n'en a pas déjà un. Sans ça, ouvrir un
  // projet suffit à en fabriquer un pour DEFAULT_WEEK : `createNewProject`/`loadProjectFromFile`
  // enchaînent `reset()` — qui remet déjà `selectedWeek` à DEFAULT_WEEK — puis
  // `setSelectedWeek(DEFAULT_WEEK)`. La semaine ne change donc pas, le garde-fou
  // `state.selectedWeek !== prev.selectedWeek` du subscribe ne s'applique pas, et les nouvelles
  // références de `taskGroups`/`blockedZones` déclenchent une sauvegarde.
  // Si un snapshot existe déjà, on le met à jour même vide : c'est le cas légitime de
  // l'utilisateur qui efface la préparation d'une semaine. Une semaine avec des placements mais
  // sans préparation n'est pas vide non plus (§4.2 du plan).
  const isEmpty =
    ps.taskGroups.length === 0 &&
    manualBlockedZones.length === 0 &&
    preNeutralizedKeys.length === 0 &&
    Object.keys(manualEnforcedMap).length === 0 &&
    manualCourses.length === 0 &&
    note === undefined &&
    persistedPlacements.length === 0 &&
    persistedUnplaced.length === 0 &&
    ps.lastRun === null;
  if (isEmpty && !ss.hasWeekSave(ps.selectedWeek)) return;

  ss.saveWeek({
    weekNumber: ps.selectedWeek,
    schoolYear: ss.schoolYearConfig.year,
    savedAt: Date.now(),
    taskGroups: ps.taskGroups,
    manualBlockedZones,
    preNeutralizedKeys,
    manualEnforcedMap,
    manualCourses,
    note,
    placements: persistedPlacements,
    unplaced: persistedUnplaced,
    lastRun: ps.lastRun ?? undefined,
  });
}

if (typeof window !== 'undefined') {
  void _resumePendingJob();

  // Sauvegarde déclenchée par une modification dans usePlanningStore. La garde ne comparait
  // avant que les `pre-enforced`/`user-pre` (par JSON.stringify) pour éviter qu'une retouche de
  // tuile ne réécrive tout le projet — devenu inutile depuis le découpage par semaine
  // (~2,4 Ko/écriture, cbc0caa) : simplification, pas un ajout de portée (§4.4 du plan).
  usePlanningStore.subscribe((state, prev) => {
    // Ignorer les changements de semaine (setSelectedWeek gère la restauration)
    if (state.selectedWeek !== prev.selectedWeek) return;
    if (
      state.placements === prev.placements &&
      state.unplaced === prev.unplaced &&
      state.taskGroups === prev.taskGroups &&
      state.blockedZones === prev.blockedZones &&
      state.manualEnforcedMap === prev.manualEnforcedMap &&
      state.lastRun === prev.lastRun
    ) return;
    _saveCurrentWeekSnapshot();
  });

  // Plus de subscribe sur useProjectStore.allCourses ici : les cours manuels n'y transitent
  // plus (addManualCourse/removeManualCourse/updateManualCourse écrivent directement dans
  // weekSaves), donc un changement d'allCourses (import CSV) n'a plus besoin de redéclencher
  // une sauvegarde de snapshot.
}
