import type { StateCreator } from 'zustand';
import type { CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import type { TaskGroupConfig } from '@/lib/taskGroupUtils';
import type { SerializedBlockedZone } from '@/store/types';
import { manualCourseId, type CourseTaskDataWithId } from '@/lib/courseId';
import { getManualCoursesForWeek } from '@/lib/weekCourses';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Snapshot de préparation d'une semaine (pré-planification uniquement).
 * Clé de stockage : saves[weekNumber]. Un Projet ne porte que sur une seule
 * année scolaire (project.schoolYearConfig), donc plus besoin de clé année ici.
 */
export interface PreparedWeekSnapshot {
  weekNumber: number;
  /** Ex: "2025-2026". Redondant avec project.schoolYearConfig.year, gardé comme métadonnée. */
  schoolYear: string;
  /** Timestamp de dernière sauvegarde */
  savedAt: number;
  taskGroups: TaskGroupConfig[];
  /** Zones bloquées ajoutées manuellement (vacances/jours fériés exclus, re-générés auto) */
  manualBlockedZones: SerializedBlockedZone[];
  preNeutralizedKeys: string[];
  manualEnforcedMap: Record<string, EnforcedData>;
  /** Cours créés manuellement pour cette semaine (les cours CSV vivent dans allCourses, jamais dupliqués ici). */
  manualCourses: CourseTaskDataWithId[];
}

/** saves[weekNumber] */
export type WeekSavesMap = Record<string, PreparedWeekSnapshot>;

function emptySnapshot(weekNumber: number, schoolYear: string): PreparedWeekSnapshot {
  return {
    weekNumber,
    schoolYear,
    savedAt: Date.now(),
    taskGroups: [],
    manualBlockedZones: [],
    preNeutralizedKeys: [],
    manualEnforcedMap: {},
    manualCourses: [],
  };
}

// ── Slice ──────────────────────────────────────────────────────────────────

export interface WeekSavesSlice {
  weekSaves: WeekSavesMap;
  saveWeek: (snapshot: PreparedWeekSnapshot) => void;
  loadWeekSave: (weekNumber: number) => PreparedWeekSnapshot | null;
  hasWeekSave: (weekNumber: number) => boolean;
  deleteWeekSave: (weekNumber: number) => void;
  clearAllWeekSaves: () => void;
  /** Crée un nouveau cours manuel pour la semaine (crée le snapshot s'il n'existe pas encore). */
  addManualCourse: (weekNumber: number, schoolYear: string, course: CourseTaskData) => void;
  /** Retire un cours manuel de la semaine par id. No-op si la semaine n'a pas de snapshot. */
  removeManualCourse: (weekNumber: number, courseId: string) => void;
  /** Modifie les ressources/durée d'un cours manuel existant. No-op si la semaine n'a pas de snapshot. */
  updateManualCourse: (
    weekNumber: number,
    courseId: string,
    patch: Partial<Pick<CourseTaskData, 'teacher' | 'groups' | 'rooms' | 'duration'>>,
  ) => void;
}

export const createWeekSavesSlice: StateCreator<WeekSavesSlice> = (set, get) => ({
  weekSaves: {},

  saveWeek: (snapshot) => {
    set((state) => ({
      weekSaves: {
        ...state.weekSaves,
        [String(snapshot.weekNumber)]: snapshot,
      },
    }));
  },

  loadWeekSave: (weekNumber) => {
    return get().weekSaves[String(weekNumber)] ?? null;
  },

  hasWeekSave: (weekNumber) => {
    return get().weekSaves[String(weekNumber)] !== undefined;
  },

  deleteWeekSave: (weekNumber) => {
    set((state) => {
      const next = { ...state.weekSaves };
      delete next[String(weekNumber)];
      return { weekSaves: next };
    });
  },

  clearAllWeekSaves: () => {
    set({ weekSaves: {} });
  },

  addManualCourse: (weekNumber, schoolYear, course) => {
    set((state) => {
      const key = String(weekNumber);
      // Lecture défensive via getManualCoursesForWeek (pas snapshot.manualCourses directement) :
      // un snapshot legacy pas encore réécrit au nouveau format ne doit pas être lu comme vide.
      const existingManual = getManualCoursesForWeek(state.weekSaves, weekNumber);
      const newCourse: CourseTaskDataWithId = { ...course, id: manualCourseId(), source: 'manual' as const };
      const base = state.weekSaves[key] ?? emptySnapshot(weekNumber, schoolYear);
      return {
        weekSaves: {
          ...state.weekSaves,
          [key]: { ...base, manualCourses: [...existingManual, newCourse] },
        },
      };
    });
  },

  removeManualCourse: (weekNumber, courseId) => {
    set((state) => {
      const key = String(weekNumber);
      const existing = state.weekSaves[key];
      if (!existing) return {};
      const existingManual = getManualCoursesForWeek(state.weekSaves, weekNumber);
      return {
        weekSaves: {
          ...state.weekSaves,
          [key]: { ...existing, manualCourses: existingManual.filter((c) => c.id !== courseId) },
        },
      };
    });
  },

  updateManualCourse: (weekNumber, courseId, patch) => {
    set((state) => {
      const key = String(weekNumber);
      const existing = state.weekSaves[key];
      if (!existing) return {};
      const existingManual = getManualCoursesForWeek(state.weekSaves, weekNumber);
      return {
        weekSaves: {
          ...state.weekSaves,
          [key]: {
            ...existing,
            manualCourses: existingManual.map((c) => (c.id === courseId ? { ...c, ...patch } : c)),
          },
        },
      };
    });
  },
});
