import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StateCreator } from 'zustand';
import { createConstraintsSlice, type ConstraintsSlice } from './slices/constraintsSlice';
import { createWeekSavesSlice, type WeekSavesSlice } from './slices/weekSavesSlice';
import type { ResourceGroupData, ConstraintsData } from '@edt-ts/scheduler-common';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '../lib/courseId';
import { ClientSchedulerData } from '../lib/api/clientSchedulerData';
import { type YearColorConfig, DEFAULT_YEAR_COLORS } from '../lib/calendar/yearColors';
import type { SchoolYearConfig } from '../lib/schoolHolidays';
import { migrateLegacyProjectStorage, migrateProjectStorageToSplitKeys } from '../lib/project/legacyMigration';
import { createProjectStorage, PROJECT_STORAGE_KEY } from '../lib/project/projectFile';
import { DEFAULT_SLOTS } from '../lib/constraintsUtils';
import { getManualCoursesForWeek, pruneWeekSavesOfCourseIds } from '../lib/weekCourses';
import type { WeekSavesMap } from './slices/weekSavesSlice';
import { diffCsvCourses, diffCsvResources, type ResourceGroupDataWithStatus } from '../lib/csvMerge';

// Migrations one-shot AVANT que le storage engine ci-dessous ne lise `edt-project`.
// Ordre impératif : edt-scheduler (ancien monolithe pré-Projet) -> edt-project monolithe
// -> edt-project + edt-project:week:* (découpé par semaine). Inverser casse la migration
// des utilisateurs venant du plus ancien format.
migrateLegacyProjectStorage();
migrateProjectStorageToSplitKeys();

// ── Slice : données du Projet actif ─────────────────────────────────────────
// projectName === null ⇔ aucun projet chargé. Tous les autres champs sont
// garantis cohérents avec cet état par convention (createProject/closeProject),
// pas par le typage — le RouteGuard garantit leur usage seulement quand un
// projet existe réellement.

interface ProjectDataSlice {
  /** Nom du projet, utilisé pour les exports. null ⇔ aucun projet chargé. */
  projectName: string | null;
  /** Configuration année scolaire + vacances/jours fériés. Non-null si projectName non-null. */
  schoolYearConfig: SchoolYearConfig | null;
  allCourses: CourseTaskDataWithId[];
  resources: ResourceGroupDataWithStatus[];
  coursesFileName: string | null;
  yearColorConfig: YearColorConfig;
  /** Taux de remplissage (demande/dispo) pour le niveau 'tight' dans analyzeConstraints (défaut : 0.5) */
  tightThreshold: number;
  /** Taux de remplissage pour le niveau 'critical' dans analyzeConstraints (défaut : 1.0) */
  criticalThreshold: number;
  /** Instance reconstruite depuis constraints — non persistée, jamais null si constraints non vide */
  availabilityManager: AvailabilityManager | null;
  /** Instance ClientSchedulerData — non persistée, reconstruite quand allCourses ou resources change */
  clientSchedulerData: ClientSchedulerData | null;

  /** Crée un nouveau projet (remplace entièrement l'état courant). */
  createProject: (name: string, schoolYearConfig: SchoolYearConfig) => void;
  /** Renomme le projet actif (utilisé pour les exports). */
  renameProject: (name: string) => void;
  /** Referme le projet actif : repasse à l'état "aucun projet". */
  closeProject: () => void;

  setCourses: (courses: CourseTaskDataWithId[], fileName?: string) => void;
  setResources: (resources: ResourceGroupData[]) => void;
  /** Retire un cours CSV par id, et élague les références à cet id dans weekSaves. */
  removeCourse: (id: string) => void;
  setYearColorConfig: (config: YearColorConfig) => void;
  /** Change l'année scolaire du projet actif (ex: rechargement des vacances). */
  setSchoolYearConfig: (config: SchoolYearConfig) => void;
  setTightThreshold: (threshold: number) => void;
  setCriticalThreshold: (threshold: number) => void;
  setResourceMaxDailyMinutes: (id: string, maxDailyMinutes: number | undefined) => void;
  /**
   * Limite quotidienne d'une ressource pour la seule semaine `weekKey` (« S36 »).
   * `minutes === undefined` ⇒ suppression de la clé (retour à l'héritage du défaut) ;
   * si plus aucune semaine n'est surchargée, `weeklyMaxDailyMinutes` disparaît entièrement
   * (pas d'objet vide dans le localStorage, cf. docs/PlanSplitWeekStorage.md).
   */
  setResourceWeeklyMaxDailyMinutes: (id: string, weekKey: string, minutes: number | undefined) => void;
  /**
   * "Tout remplacer" : remplace cours (CSV uniquement, `source` forcé) et ressources,
   * élague les contraintes obsolètes. Préserve les cours manuels de chaque semaine (`weekSaves`)
   * mais réinitialise le reste de leur préparation (taskGroups/zones/impositions manuelles),
   * puisque ces champs référencent des ids de cours CSV invalidés par le réimport.
   */
  importCsvData: (courses: CourseTaskDataWithId[], resources: ResourceGroupData[], fileName: string) => void;
  /**
   * "Fusionner" : diff intelligent par clé d'identité (voir lib/csvMerge.ts). Les cours appariés
   * gardent leur ancien id (taskGroups/manualEnforcedMap/preNeutralizedKeys restent valides sans
   * remapping), seules les références aux cours réellement supprimés sont élaguées. Les ressources
   * disparues sont conservées et marquées `unused` plutôt que supprimées — `constraints` n'a donc
   * jamais besoin d'être élaguée ici (contrairement à `importCsvData`).
   */
  mergeCsvData: (courses: CourseTaskDataWithId[], resources: ResourceGroupData[], fileName: string) => void;
}

// ── Store combiné ──────────────────────────────────────────────────────────

export type ProjectStore = ConstraintsSlice & ProjectDataSlice & WeekSavesSlice;

const EMPTY_PROJECT_FIELDS = {
  projectName: null as string | null,
  schoolYearConfig: null as SchoolYearConfig | null,
  allCourses: [] as CourseTaskDataWithId[],
  resources: [] as ResourceGroupDataWithStatus[],
  coursesFileName: null as string | null,
  yearColorConfig: DEFAULT_YEAR_COLORS,
  tightThreshold: 0.5,
  criticalThreshold: 1.0,
  constraints: { Default: DEFAULT_SLOTS } as ConstraintsSlice['constraints'],
  weekSaves: {} as WeekSavesSlice['weekSaves'],
};

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get, api) => ({
      ...(createConstraintsSlice as StateCreator<ProjectStore, [], [], ConstraintsSlice>)(set, get, api),
      ...(createWeekSavesSlice as StateCreator<ProjectStore, [], [], WeekSavesSlice>)(set, get, api),

      // Project data slice
      projectName: null,
      allCourses: [],
      resources: [],
      coursesFileName: null,
      yearColorConfig: DEFAULT_YEAR_COLORS,
      schoolYearConfig: null,
      tightThreshold: 0.5,
      criticalThreshold: 1.0,
      availabilityManager: null, // Reconstruit par subscribe ci-dessous
      clientSchedulerData: null, // Reconstruit par subscribe ci-dessous

      createProject: (name, schoolYearConfig) => set({
        ...EMPTY_PROJECT_FIELDS,
        projectName: name,
        schoolYearConfig,
      }),
      renameProject: (name) => set({ projectName: name }),
      closeProject: () => set({ ...EMPTY_PROJECT_FIELDS }),

      setCourses: (allCourses, fileName) => set({ allCourses, ...(fileName !== undefined ? { coursesFileName: fileName } : {}) }),
      setResources: (resources) => set({ resources }),
      removeCourse: (id) => set((state) => {
        const course = state.allCourses.find((c) => c.id === id);
        const removedIdsByWeek = new Map<number, Set<string>>();
        if (course) removedIdsByWeek.set(course.week, new Set([id]));
        return {
          allCourses: state.allCourses.filter((c) => c.id !== id),
          weekSaves: pruneWeekSavesOfCourseIds(state.weekSaves, removedIdsByWeek),
        };
      }),
      importCsvData: (courses, resources, fileName) => {
        const validIds = resources.flatMap((g) => g.resources.map((r) => r.id));
        set((state) => {
          const validSet = new Set(validIds);
          const current = state.constraints;
          const prunedConstraints: typeof current = {};
          if ('Default' in current) prunedConstraints.Default = current.Default;
          for (const [id, value] of Object.entries(current)) {
            if (id !== 'Default' && validSet.has(id)) prunedConstraints[id] = value;
          }

          // Force source: 'csv' quel que soit ce qu'affirme l'entrée (ferme le vecteur de
          // contamination si un fichier JSON de cours ré-importé contient des entrées 'manual').
          const normalizedCourses = courses.map((c) => ({ ...c, source: 'csv' as const }));

          // Préserve les cours manuels de chaque semaine ; réinitialise le reste (taskGroups/
          // zones/impositions manuelles référencent des ids de cours CSV invalidés par le réimport).
          const nextWeekSaves: WeekSavesMap = {};
          for (const [week, snapshot] of Object.entries(state.weekSaves)) {
            const manualCourses = getManualCoursesForWeek(state.weekSaves, Number(week));
            if (manualCourses.length === 0) continue;
            nextWeekSaves[week] = {
              weekNumber: snapshot.weekNumber,
              schoolYear: snapshot.schoolYear,
              savedAt: Date.now(),
              taskGroups: [],
              manualBlockedZones: [],
              preNeutralizedKeys: [],
              manualEnforcedMap: {},
              manualCourses,
            };
          }

          return {
            allCourses: normalizedCourses,
            resources,
            coursesFileName: fileName,
            weekSaves: nextWeekSaves,
            constraints: prunedConstraints,
          };
        });
      },
      mergeCsvData: (courses, resources, fileName) => {
        set((state) => {
          const courseDiff = diffCsvCourses(state.allCourses, courses);
          const finalResources = diffCsvResources(state.resources, resources);

          const removedIdsByWeek = new Map<number, Set<string>>();
          for (const c of courseDiff.removed) {
            const existing = removedIdsByWeek.get(c.week);
            if (existing) existing.add(c.id);
            else removedIdsByWeek.set(c.week, new Set([c.id]));
          }

          return {
            allCourses: courseDiff.merged,
            resources: finalResources,
            coursesFileName: fileName,
            weekSaves: pruneWeekSavesOfCourseIds(state.weekSaves, removedIdsByWeek),
            // constraints délibérément NON prunées : en mode fusion aucune ressource n'est
            // vraiment supprimée (juste marquée unused), donc aucune clé de constraints ne
            // peut devenir orpheline — contrairement à importCsvData.
          };
        });
      },
      setYearColorConfig: (yearColorConfig) => set({ yearColorConfig }),
      setSchoolYearConfig: (schoolYearConfig) => set({ schoolYearConfig }),
      setTightThreshold: (tightThreshold) => set({ tightThreshold }),
      setCriticalThreshold: (criticalThreshold) => set({ criticalThreshold }),
      setResourceMaxDailyMinutes: (id, maxDailyMinutes) => set((state) => ({
        resources: state.resources.map((group) => ({
          ...group,
          resources: group.resources.map((r) =>
            r.id === id ? { ...r, maxDailyMinutes } : r
          ),
        })),
      })),
      setResourceWeeklyMaxDailyMinutes: (id, weekKey, minutes) => set((state) => ({
        resources: state.resources.map((group) => ({
          ...group,
          resources: group.resources.map((r) => {
            if (r.id !== id) return r;
            const next = { ...(r.weeklyMaxDailyMinutes ?? {}) };
            if (minutes === undefined) delete next[weekKey];
            else next[weekKey] = minutes;
            const { weeklyMaxDailyMinutes: _drop, ...rest } = r;
            return Object.keys(next).length > 0 ? { ...rest, weeklyMaxDailyMinutes: next } : rest;
          }),
        })),
      })),
    }),
    {
      name: PROJECT_STORAGE_KEY,
      version: 1,
      storage: createProjectStorage(),
      partialize: (state) => ({
        projectName: state.projectName,
        schoolYearConfig: state.schoolYearConfig,
        constraints: state.constraints,
        allCourses: state.allCourses,
        resources: state.resources,
        coursesFileName: state.coursesFileName,
        yearColorConfig: state.yearColorConfig,
        tightThreshold: state.tightThreshold,
        criticalThreshold: state.criticalThreshold,
        weekSaves: state.weekSaves,
      }),
    },
  ),
);

// ── Rebuild availabilityManager côté client uniquement ────────────────────
// Exécuté seulement dans le browser : le serveur Next.js (SSR) n'a pas window.
// Le middleware persist hydrate depuis localStorage puis déclenche setState,
// ce qui provoque le subscribe et construit le premier AvailabilityManager.
// Ensuite, chaque modification de constraints via constraintsSlice le reconstruit.

function buildClientSchedulerData(state: ProjectStore): ClientSchedulerData | null {
  if (state.allCourses.length === 0 || state.resources.length === 0) return null;
  const data = new ClientSchedulerData();
  data.initResources(state.resources);
  data.initAllTasks(state.allCourses);
  return data;
}

/**
 * Normalise constraints avant de passer à AvailabilityManager :
 * - Default doit être TimeSlot[] (AvailabilityManager ne supporte pas ResourceConstraints pour Default)
 * - Les ressources null (héritant de Default) reçoivent le ResourceConstraints complet de Default
 *   pour que les overrides hebdomadaires de Default soient appliqués correctement pendant le drag.
 */
function normalizeConstraintsForAM(constraints: ConstraintsSlice['constraints']): ConstraintsData {
  const result = { ...constraints } as ConstraintsData;
  const d = result.Default;

  if (d === undefined || Array.isArray(d)) {
    // Default est déjà TimeSlot[] ou absent — pas de changement
    return result;
  }

  // Default est un ResourceConstraints — extraire la base pour la clé Default
  const defaultRC = d as import('@edt-ts/scheduler-common').ResourceConstraints;
  result.Default = (defaultRC.default ?? []) as import('@edt-ts/scheduler-common').TimeSlot[];

  // Propager le ResourceConstraints complet aux ressources qui héritent de Default (valeur null)
  // Ainsi, AvailabilityManager applique les overrides hebdomadaires de Default pour ces ressources
  for (const [resourceId, v] of Object.entries(result)) {
    if (resourceId === 'Default') continue;
    if (v === null) {
      result[resourceId] = defaultRC;
    }
  }

  return result;
}

if (typeof window !== 'undefined') {
  // Reconstruit l'AvailabilityManager à chaque changement de constraints.
  // Toujours créé (même avec constraints vides) pour que computeConstraintUnavailableZones
  // fonctionne dès le premier drag — les ressources sans contrainte définie seront ignorées.
  // Reconstruit le ClientSchedulerData à chaque changement de allCourses ou resources.
  useProjectStore.subscribe((state, prevState) => {
    const updates: Record<string, unknown> = {};
    if (state.constraints !== prevState.constraints) {
      updates.availabilityManager = new AvailabilityManager(normalizeConstraintsForAM(state.constraints));
    }
    if (state.allCourses !== prevState.allCourses || state.resources !== prevState.resources) {
      updates.clientSchedulerData = buildClientSchedulerData(state);
    }
    if (Object.keys(updates).length > 0) {
      useProjectStore.setState(updates as Partial<ProjectStore>);
    }
  });

  // Initialisation immédiate : gère le cas où persist a déjà hydraté le store
  // avant que le subscribe soit installé (navigation SPA, hot-reload).
  const initialState = useProjectStore.getState();
  useProjectStore.setState({
    availabilityManager: new AvailabilityManager(normalizeConstraintsForAM(initialState.constraints)),
    clientSchedulerData: buildClientSchedulerData(initialState),
  });
}
