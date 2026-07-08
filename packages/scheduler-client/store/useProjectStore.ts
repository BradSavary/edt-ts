import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StateCreator } from 'zustand';
import { createConstraintsSlice, type ConstraintsSlice } from './slices/constraintsSlice';
import { createWeekSavesSlice, type WeekSavesSlice } from './slices/weekSavesSlice';
import type { CourseTaskData, ResourceGroupData, ConstraintsData } from '@edt-ts/scheduler-common';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import { manualCourseId, type CourseTaskDataWithId } from '../lib/courseId';
import { ClientSchedulerData } from '../lib/api/clientSchedulerData';
import { type YearColorConfig, DEFAULT_YEAR_COLORS } from '../lib/calendar/yearColors';
import type { SchoolYearConfig } from '../lib/schoolHolidays';
import { migrateLegacyProjectStorage } from '../lib/project/legacyMigration';
import { createProjectStorage, PROJECT_STORAGE_KEY } from '../lib/project/projectFile';
import { DEFAULT_SLOTS } from '../lib/constraintsUtils';

// Migration one-shot AVANT que le storage engine ci-dessous ne lise `edt-project`.
migrateLegacyProjectStorage();

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
  resources: ResourceGroupData[];
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
  addCourse: (course: CourseTaskData) => void;
  removeCourse: (index: number) => void;
  setYearColorConfig: (config: YearColorConfig) => void;
  /** Change l'année scolaire du projet actif (ex: rechargement des vacances). */
  setSchoolYearConfig: (config: SchoolYearConfig) => void;
  setTightThreshold: (threshold: number) => void;
  setCriticalThreshold: (threshold: number) => void;
  setResourceMaxDailyMinutes: (id: string, maxDailyMinutes: number | undefined) => void;
  /**
   * Action atomique d'import CSV : remplace cours et ressources, purge les sauvegardes
   * de semaine du projet actif, élague les contraintes obsolètes et remet à zéro les impositions.
   * Comportement destructif volontairement conservé pour cette itération (voir plan de refactoring) :
   * le diff non destructif course-par-course est hors scope.
   */
  importCsvData: (courses: CourseTaskDataWithId[], resources: ResourceGroupData[], fileName: string) => void;
}

// ── Store combiné ──────────────────────────────────────────────────────────

export type ProjectStore = ConstraintsSlice & ProjectDataSlice & WeekSavesSlice;

const EMPTY_PROJECT_FIELDS = {
  projectName: null as string | null,
  schoolYearConfig: null as SchoolYearConfig | null,
  allCourses: [] as CourseTaskDataWithId[],
  resources: [] as ResourceGroupData[],
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
      addCourse: (course) => set((state) => ({
        allCourses: [...state.allCourses, { ...course, id: manualCourseId(), source: 'manual' as const }],
      })),
      removeCourse: (index) => set((state) => ({ allCourses: state.allCourses.filter((_, i) => i !== index) })),
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
          return {
            allCourses: courses,
            resources,
            coursesFileName: fileName,
            weekSaves: {},
            constraints: prunedConstraints,
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
