import type { StateCreator } from 'zustand';
import type { EnforcedData, CourseTaskData } from '@edt-ts/scheduler-common';
import type { TaskGroupConfig } from '@/lib/taskGroupUtils';
import type { SerializedBlockedZone } from '@/store/types';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Snapshot de préparation d'une semaine (pré-planification uniquement).
 * Clé de stockage : saves[schoolYear][weekNumber].
 */
export interface PreparedWeekSnapshot {
  weekNumber: number;
  /** Ex: "2025-2026" */
  schoolYear: string;
  /** Timestamp de dernière sauvegarde */
  savedAt: number;
  taskGroups: TaskGroupConfig[];
  /** Zones bloquées ajoutées manuellement (vacances/jours fériés exclus, re-générés auto) */
  manualBlockedZones: SerializedBlockedZone[];
  preNeutralizedKeys: string[];
  manualEnforcedMap: Record<string, EnforcedData>;
  /** Snapshot des cours de la semaine au moment de la sauvegarde */
  weeklyCourses: CourseTaskData[];
}

/** saves[schoolYear][weekNumber] */
export type WeekSavesMap = Record<string, Record<string, PreparedWeekSnapshot>>;

// ── Slice ──────────────────────────────────────────────────────────────────

export interface WeekSavesSlice {
  weekSaves: WeekSavesMap;
  saveWeek: (snapshot: PreparedWeekSnapshot) => void;
  loadWeekSave: (schoolYear: string, weekNumber: number) => PreparedWeekSnapshot | null;
  hasWeekSave: (schoolYear: string, weekNumber: number) => boolean;
  deleteWeekSave: (schoolYear: string, weekNumber: number) => void;
  clearAllWeekSaves: () => void;
}

export const createWeekSavesSlice: StateCreator<WeekSavesSlice> = (set, get) => ({
  weekSaves: {},

  saveWeek: (snapshot) => {
    set((state) => ({
      weekSaves: {
        ...state.weekSaves,
        [snapshot.schoolYear]: {
          ...(state.weekSaves[snapshot.schoolYear] ?? {}),
          [String(snapshot.weekNumber)]: snapshot,
        },
      },
    }));
  },

  loadWeekSave: (schoolYear, weekNumber) => {
    return get().weekSaves[schoolYear]?.[String(weekNumber)] ?? null;
  },

  hasWeekSave: (schoolYear, weekNumber) => {
    return get().weekSaves[schoolYear]?.[String(weekNumber)] !== undefined;
  },

  deleteWeekSave: (schoolYear, weekNumber) => {
    set((state) => {
      const yearSaves = { ...(state.weekSaves[schoolYear] ?? {}) };
      delete yearSaves[String(weekNumber)];
      return {
        weekSaves: {
          ...state.weekSaves,
          [schoolYear]: yearSaves,
        },
      };
    });
  },

  clearAllWeekSaves: () => {
    set({ weekSaves: {} });
  },
});
