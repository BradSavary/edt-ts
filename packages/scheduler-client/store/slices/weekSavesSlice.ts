import type { StateCreator } from 'zustand';
import type { EnforcedData } from '@edt-ts/scheduler-common';
import type { TaskGroupConfig } from '@/lib/taskGroupUtils';
import type { SerializedBlockedZone } from '@/store/types';
import type { CourseTaskDataWithId } from '@/lib/courseId';

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
  /** Snapshot des cours de la semaine au moment de la sauvegarde */
  weeklyCourses: CourseTaskDataWithId[];
}

/** saves[weekNumber] */
export type WeekSavesMap = Record<string, PreparedWeekSnapshot>;

// ── Slice ──────────────────────────────────────────────────────────────────

export interface WeekSavesSlice {
  weekSaves: WeekSavesMap;
  saveWeek: (snapshot: PreparedWeekSnapshot) => void;
  loadWeekSave: (weekNumber: number) => PreparedWeekSnapshot | null;
  hasWeekSave: (weekNumber: number) => boolean;
  deleteWeekSave: (weekNumber: number) => void;
  clearAllWeekSaves: () => void;
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
});
