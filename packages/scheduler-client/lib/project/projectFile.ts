import type { PersistStorage, StorageValue } from 'zustand/middleware';
import type { ResourceGroupData } from '@edt-ts/scheduler-common';
import type { SchoolYearConfig } from '@/lib/schoolHolidays';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { YearColorConfig } from '@/lib/calendar/yearColors';
import type { ConstraintsRecord } from '@/store/slices/constraintsSlice';
import { sanitizeConstraints } from '@/lib/constraintsUtils';
import type { WeekSavesMap, PreparedWeekSnapshot } from '@/store/slices/weekSavesSlice';

export const PROJECT_FILE_VERSION = 1 as const;

/**
 * Format d'un Projet complet — le format exporté/importé par l'utilisateur (fichier `.json`
 * téléchargeable). Ce n'est PLUS le format persisté en localStorage tel quel : depuis le
 * découpage par semaine (§3 du plan de refactoring stockage), `weekSaves` vit dans des clés
 * séparées (voir `PersistedProjectEntry`/`weekStorageKey`) pour que chaque modification de
 * semaine n'écrive qu'elle-même plutôt que tout le projet. L'invariant garanti n'est donc plus
 * littéral : c'est que le stockage se réassemble exactement en un `ProjectFileV1` (vérifié par
 * un test d'aller-retour, pas par construction).
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

/** `PersistedProjectFields` sans `weekSaves` : les champs qui vivent dans l'entrée projet `edt-project`. */
export type ProjectEntryFields = Omit<PersistedProjectFields, 'weekSaves'>;

export const STORAGE_VERSION = 2 as const;

/**
 * Forme de la clé localStorage `edt-project` depuis le découpage par semaine : les champs du
 * projet hors `weekSaves`, plus `weeks` (source de vérité unique de « quelles semaines existent »,
 * voir `weekStorageKey`) et `storageVersion` (marqueur du format découpé, distinct de
 * `formatVersion` qui appartient au format d'export et ne doit pas bouger).
 */
export interface PersistedProjectEntry extends ProjectEntryFields {
  weeks: number[];
  storageVersion: typeof STORAGE_VERSION;
}

function extractProjectEntryFields(fields: ProjectEntryFields): ProjectEntryFields {
  return {
    projectName: fields.projectName,
    schoolYearConfig: fields.schoolYearConfig,
    allCourses: fields.allCourses,
    resources: fields.resources,
    coursesFileName: fields.coursesFileName,
    constraints: fields.constraints,
    yearColorConfig: fields.yearColorConfig,
    tightThreshold: fields.tightThreshold,
    criticalThreshold: fields.criticalThreshold,
  };
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
const WEEK_KEY_PREFIX = 'edt-project:week:';

/** Clé localStorage d'une semaine donnée. Exportée pour la migration (§4.3) et les tests. */
export function weekStorageKey(week: number): string {
  return `${WEEK_KEY_PREFIX}${week}`;
}

/** Supprime toutes les clés `edt-project:week:*`, orphelines ou non. Exportée pour §4.4 et les tests. */
export function clearAllWeekKeys(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(WEEK_KEY_PREFIX)) keysToRemove.push(key);
  }
  for (const key of keysToRemove) localStorage.removeItem(key);
  _lastWrittenWeeks = new Map();
}

// ── Cache module-level : reflète ce qui est effectivement écrit en localStorage ─────────────
// L'état zustand est immuable : une comparaison de référence suffit pour détecter un changement,
// pas besoin de resérialiser en JSON pour comparer (ce qui annulerait le gain du découpage).
let _lastWrittenWeeks = new Map<string, PreparedWeekSnapshot>();
let _lastWrittenProjectFields: ProjectEntryFields | null = null;

function projectEntryFieldsChanged(previous: ProjectEntryFields | null, current: ProjectEntryFields): boolean {
  if (previous === null) return true;
  return (
    previous.projectName !== current.projectName ||
    previous.schoolYearConfig !== current.schoolYearConfig ||
    previous.allCourses !== current.allCourses ||
    previous.resources !== current.resources ||
    previous.coursesFileName !== current.coursesFileName ||
    previous.constraints !== current.constraints ||
    previous.yearColorConfig !== current.yearColorConfig ||
    previous.tightThreshold !== current.tightThreshold ||
    previous.criticalThreshold !== current.criticalThreshold
  );
}

function weekKeysChanged(previous: ReadonlySet<string>, current: ReadonlySet<string>): boolean {
  if (previous.size !== current.size) return true;
  for (const key of current) {
    if (!previous.has(key)) return true;
  }
  return false;
}

/**
 * Storage engine Zustand custom : persiste/relit au format découpé par semaine (§3 du plan) —
 * une clé `edt-project` pour le projet (sans `weekSaves`) plus une clé `edt-project:week:<n>`
 * par semaine, plutôt qu'un unique blob `ProjectFileV1`. But : une modification de semaine
 * n'écrit plus que sa propre clé (quelques dizaines de Ko) au lieu de tout le projet (1-3 Mo).
 * `setItem` supprime toutes les clés quand `projectName` est null (aucun projet actif).
 */
export function createProjectStorage<S extends PersistedProjectFields>(): PersistStorage<S> {
  return {
    getItem: (name) => {
      const raw = localStorage.getItem(name);
      if (!raw) return null;

      let entry: PersistedProjectEntry;
      try {
        entry = JSON.parse(raw);
      } catch (err) {
        console.error('[projectStorage] entrée projet illisible, ignorée :', err);
        return null;
      }
      if (typeof entry !== 'object' || entry === null || entry.storageVersion !== STORAGE_VERSION) {
        console.error('[projectStorage] entrée projet de format inattendu, ignorée.');
        return null;
      }

      const weekSaves: WeekSavesMap = {};
      for (const week of entry.weeks ?? []) {
        const weekRaw = localStorage.getItem(weekStorageKey(week));
        if (weekRaw == null) {
          console.error(`[projectStorage] semaine ${week} manquante, ignorée.`);
          continue;
        }
        try {
          weekSaves[String(week)] = JSON.parse(weekRaw);
        } catch (err) {
          console.error(`[projectStorage] semaine ${week} illisible, ignorée :`, err);
        }
      }

      // Répare à la volée les projets déjà enregistrés avec des créneaux de durée nulle
      // ou inversée : sans ça, l'AvailabilityManager lèverait dès le premier rendu d'une
      // semaine peuplée. Même référence retournée si les contraintes sont déjà saines,
      // donc pas de fausse réécriture du cache ci-dessous.
      const entryFields = {
        ...extractProjectEntryFields(entry),
        constraints: sanitizeConstraints(entry.constraints),
      };
      const state = { ...entryFields, weekSaves } as S;

      // Prime le cache module-level sur l'état qui vient d'être hydraté : sans ça, la toute
      // première écriture de la session (le premier déplacement de tuile) verrait un cache vide
      // et réécrirait tout, ce qui annulerait le gain pour cette écriture-là.
      _lastWrittenWeeks = new Map(Object.entries(weekSaves));
      _lastWrittenProjectFields = entryFields;

      return { state, version: PROJECT_FILE_VERSION };
    },
    setItem: (name, value: StorageValue<S>) => {
      const state = value.state;

      if (!state.projectName) {
        localStorage.removeItem(name);
        clearAllWeekKeys();
        _lastWrittenProjectFields = null;
        return;
      }

      const currentWeekSaves = state.weekSaves;
      const previousWeekKeys = new Set(_lastWrittenWeeks.keys());
      const currentWeekKeys = new Set(Object.keys(currentWeekSaves));

      // Semaines modifiées ou nouvelles : n'écrire que si la référence a changé.
      for (const [key, snapshot] of Object.entries(currentWeekSaves)) {
        if (_lastWrittenWeeks.get(key) === snapshot) continue;
        try {
          localStorage.setItem(weekStorageKey(Number(key)), JSON.stringify(snapshot));
          _lastWrittenWeeks.set(key, snapshot);
        } catch (err) {
          // Ne pas mettre à jour le cache : la prochaine sauvegarde retentera au lieu de
          // considérer cette semaine à jour alors qu'elle ne l'est pas en localStorage.
          console.error(`[projectStorage] échec écriture semaine ${key}, nouvelle tentative au prochain enregistrement :`, err);
        }
      }

      // Semaines disparues de l'état : supprimer leur clé.
      for (const key of previousWeekKeys) {
        if (!currentWeekKeys.has(key)) {
          localStorage.removeItem(weekStorageKey(Number(key)));
          _lastWrittenWeeks.delete(key);
        }
      }

      // Entrée projet : n'écrire que si un champ hors weekSaves a changé, ou si la liste des
      // semaines a changé. Sinon, chaque édition de semaine réécrirait aussi l'entrée projet.
      const entryFields = extractProjectEntryFields(state);
      const listChanged = weekKeysChanged(previousWeekKeys, currentWeekKeys);
      if (listChanged || projectEntryFieldsChanged(_lastWrittenProjectFields, entryFields)) {
        const weeks = Array.from(currentWeekKeys, Number).sort((a, b) => a - b);
        const entry: PersistedProjectEntry = { ...entryFields, weeks, storageVersion: STORAGE_VERSION };
        try {
          localStorage.setItem(name, JSON.stringify(entry));
          _lastWrittenProjectFields = entryFields;
        } catch (err) {
          console.error('[projectStorage] échec écriture entrée projet, nouvelle tentative au prochain enregistrement :', err);
        }
      }
    },
    removeItem: (name) => {
      localStorage.removeItem(name);
      clearAllWeekKeys();
      _lastWrittenProjectFields = null;
    },
  };
}

export { PROJECT_STORAGE_KEY };
