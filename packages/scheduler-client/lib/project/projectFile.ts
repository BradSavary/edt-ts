import type { PersistStorage, StorageValue } from 'zustand/middleware';
import type { ResourceGroupData } from '@edt-ts/scheduler-common';
import type { SchoolYearConfig } from '@/lib/schoolHolidays';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { YearColorConfig } from '@/lib/calendar/yearColors';
import type { ConstraintsRecord } from '@/store/slices/constraintsSlice';
import type { WeekSavesMap } from '@/store/slices/weekSavesSlice';

export const PROJECT_FILE_VERSION = 1 as const;

/**
 * Format d'un Projet complet — à la fois le format persisté (localStorage `edt-project`)
 * et le format exporté/importé par l'utilisateur (fichier `.json` téléchargeable).
 * Une seule paire de fonctions (`stateToProjectFile`/`projectFileToState`) convertit
 * dans les deux sens, pour garantir que "sauvegardé" et "exportable" ne divergent jamais.
 */
export interface ProjectFileV1 {
  formatVersion: 1;
  /** ISO 8601, horodatage de l'écriture/export (informatif) */
  exportedAt: string;
  name: string;
  schoolYearConfig: SchoolYearConfig;
  coursesFileName: string | null;
  /** Cours déjà parsés (pas le CSV brut) — voir justification dans le plan de refactoring */
  allCourses: CourseTaskDataWithId[];
  resources: ResourceGroupData[];
  constraints: ConstraintsRecord;
  weekSaves: WeekSavesMap;
  yearColorConfig: YearColorConfig;
  tightThreshold: number;
  criticalThreshold: number;
}

/** Champs du store réellement persistés/exportés (sans les fonctions ni les instances non sérialisables). */
export interface PersistedProjectFields {
  projectName: string | null;
  schoolYearConfig: SchoolYearConfig | null;
  allCourses: CourseTaskDataWithId[];
  resources: ResourceGroupData[];
  coursesFileName: string | null;
  constraints: ConstraintsRecord;
  weekSaves: WeekSavesMap;
  yearColorConfig: YearColorConfig;
  tightThreshold: number;
  criticalThreshold: number;
}

/**
 * `state.projectName`/`state.schoolYearConfig` doivent être non-null à l'appel
 * (garanti par convention : le bouton d'export n'est rendu que si un projet existe,
 * et le storage engine ne persiste que dans ce cas — voir `projectStorage()`).
 */
export function stateToProjectFile(state: PersistedProjectFields): ProjectFileV1 {
  if (!state.projectName || !state.schoolYearConfig) {
    throw new Error('Aucun projet actif : impossible de générer un fichier de projet.');
  }
  return {
    formatVersion: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    name: state.projectName,
    schoolYearConfig: state.schoolYearConfig,
    coursesFileName: state.coursesFileName,
    allCourses: state.allCourses,
    resources: state.resources,
    constraints: state.constraints,
    weekSaves: state.weekSaves,
    yearColorConfig: state.yearColorConfig,
    tightThreshold: state.tightThreshold,
    criticalThreshold: state.criticalThreshold,
  };
}

export function projectFileToState(file: ProjectFileV1): PersistedProjectFields {
  return {
    projectName: file.name,
    schoolYearConfig: file.schoolYearConfig,
    allCourses: file.allCourses,
    resources: file.resources,
    coursesFileName: file.coursesFileName,
    constraints: file.constraints,
    weekSaves: file.weekSaves,
    yearColorConfig: file.yearColorConfig,
    tightThreshold: file.tightThreshold,
    criticalThreshold: file.criticalThreshold,
  };
}

/** Validation pragmatique : vérifie la version et la présence des champs obligatoires. */
export function isProjectFileV1(value: unknown): value is ProjectFileV1 {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.formatVersion === 1 &&
    typeof v.name === 'string' &&
    typeof v.schoolYearConfig === 'object' && v.schoolYearConfig !== null &&
    Array.isArray(v.allCourses) &&
    Array.isArray(v.resources) &&
    typeof v.constraints === 'object' && v.constraints !== null &&
    typeof v.weekSaves === 'object' && v.weekSaves !== null &&
    typeof v.yearColorConfig === 'object' && v.yearColorConfig !== null &&
    typeof v.tightThreshold === 'number' &&
    typeof v.criticalThreshold === 'number'
  );
}

export function parseProjectFile(text: string): ProjectFileV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Fichier projet invalide : JSON illisible.');
  }
  if (!isProjectFileV1(parsed)) {
    throw new Error('Fichier projet invalide ou non reconnu.');
  }
  return parsed;
}

const PROJECT_STORAGE_KEY = 'edt-project';

/**
 * Storage engine Zustand custom : persiste/relit directement au format `ProjectFileV1`
 * (le format exporté par l'utilisateur), plutôt que le format d'enveloppe par défaut
 * de `zustand/persist`. `setItem` supprime la clé quand `projectName` est null
 * (aucun projet actif) au lieu d'écrire un fichier incohérent.
 */
export function createProjectStorage<S extends PersistedProjectFields>(): PersistStorage<S> {
  return {
    getItem: (name) => {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      try {
        const file = parseProjectFile(raw);
        return { state: projectFileToState(file) as S, version: file.formatVersion };
      } catch (err) {
        console.error('[projectStorage] localStorage corrompu, ignoré :', err);
        return null;
      }
    },
    setItem: (name, value: StorageValue<S>) => {
      const state = value.state;
      if (!state.projectName) {
        localStorage.removeItem(name);
        return;
      }
      const file = stateToProjectFile(state);
      localStorage.setItem(name, JSON.stringify(file));
    },
    removeItem: (name) => localStorage.removeItem(name),
  };
}

export { PROJECT_STORAGE_KEY };
