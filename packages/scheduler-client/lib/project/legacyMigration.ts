import {
  PROJECT_FILE_VERSION,
  STORAGE_VERSION,
  isProjectFileV1,
  projectFileToState,
  weekStorageKey,
  type ProjectFileV1,
  type PersistedProjectEntry,
} from './projectFile';
import { getAvailableSchoolYears, type SchoolYearConfig } from '@/lib/schoolHolidays';
import { DEFAULT_YEAR_COLORS } from '@/lib/calendar/yearColors';
import { DEFAULT_SLOTS } from '@/lib/constraintsUtils';

const LEGACY_KEY = 'edt-scheduler';
const PROJECT_KEY = 'edt-project';
const MIGRATION_BANNER_KEY = 'edt-migration-banner';

/** Retire l'extension d'un nom de fichier (ex: "cours.csv" -> "cours"), pour un nom de projet lisible. */
function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '');
}

/**
 * Migration one-shot de l'ancien store `edt-scheduler` (pré-Projet) vers `edt-project`.
 * Exécutée en synchrone AVANT que `useProjectStore` ne lise `edt-project`, pour que
 * la persistance zustand trouve directement les données migrées au premier hydrate.
 *
 * `schedulerConfig` (ancien blob) n'est volontairement PAS migré vers `useAppConfigStore` :
 * il a toujours des valeurs par défaut sûres, la perte est jugée mineure au regard de la
 * complexité que ça ajouterait ici.
 */
export function migrateLegacyProjectStorage(): void {
  if (typeof window === 'undefined') return;
  // localStorage peut être indisponible/instrumenté de façon incomplète (navigation privée,
  // quota, environnement de test) : la migration est un best-effort, jamais bloquant au démarrage.
  try {
    if (localStorage.getItem(PROJECT_KEY) !== null) return; // déjà migré / projet déjà créé
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return; // rien à migrer

    let oldState: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      oldState = (parsed.state as Record<string, unknown> | undefined) ?? parsed;
    } catch {
      return; // blob illisible : on ne bloque pas le démarrage, tant pis pour la migration
    }

    const legacySchoolYearConfig = oldState.schoolYearConfig as SchoolYearConfig | null | undefined;
    const hadSchoolYear = legacySchoolYearConfig != null;
    const availableYears = getAvailableSchoolYears();
    const schoolYearConfig: SchoolYearConfig = hadSchoolYear
      ? (legacySchoolYearConfig as SchoolYearConfig)
      : { year: availableYears[1] ?? availableYears[0] ?? '', zone: 'A', periods: [] };

    // L'ancien modèle autorisait des weekSaves sur plusieurs années scolaires ;
    // un Projet = une seule année. Seule celle retenue ci-dessus est migrée ; cas
    // multi-années jugé assez marginal pour ne pas justifier un flux interactif.
    const legacyWeekSaves = oldState.weekSaves as Record<string, ProjectFileV1['weekSaves']> | undefined;
    const flatWeekSaves: ProjectFileV1['weekSaves'] = legacyWeekSaves?.[schoolYearConfig.year] ?? {};

    const coursesFileName = (oldState.coursesFileName as string | null | undefined) ?? null;

    const file: ProjectFileV1 = {
      formatVersion: PROJECT_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      name: coursesFileName ? `Projet — ${stripExtension(coursesFileName)}` : 'Projet migré',
      schoolYearConfig,
      coursesFileName,
      allCourses: (oldState.allCourses as ProjectFileV1['allCourses'] | undefined) ?? [],
      resources: (oldState.resources as ProjectFileV1['resources'] | undefined) ?? [],
      constraints: (oldState.constraints as ProjectFileV1['constraints'] | undefined) ?? { Default: DEFAULT_SLOTS },
      weekSaves: flatWeekSaves,
      yearColorConfig: (oldState.yearColorConfig as ProjectFileV1['yearColorConfig'] | undefined) ?? DEFAULT_YEAR_COLORS,
      tightThreshold: (oldState.tightThreshold as number | undefined) ?? 0.5,
      criticalThreshold: (oldState.criticalThreshold as number | undefined) ?? 1.0,
    };

    localStorage.setItem(PROJECT_KEY, JSON.stringify(file));
    localStorage.removeItem(LEGACY_KEY);
    if (!hadSchoolYear) {
      try { sessionStorage.setItem(MIGRATION_BANNER_KEY, '1'); } catch { /* sessionStorage indisponible : tant pis pour le bandeau */ }
    }
  } catch {
    // localStorage indisponible/instrumenté de façon incomplète : on abandonne la migration
    // sans bloquer le chargement du store.
  }
}

/**
 * Migration one-shot du monolithe `edt-project` (un seul blob `ProjectFileV1`, `weekSaves`
 * inclus) vers le format découpé par semaine (§3 du plan de refactoring stockage) : une clé
 * `edt-project:week:<n>` par semaine, l'entrée `edt-project` ne portant plus que le reste des
 * champs + `weeks` + `storageVersion: 2`. Best-effort, jamais bloquant, sur le modèle de
 * `migrateLegacyProjectStorage`. Doit s'exécuter juste après elle et avant toute lecture par le
 * storage engine (voir l'appel dans `useProjectStore.ts`) — la chaîne de migration est
 * `edt-scheduler` → monolithe `edt-project` → clés `edt-project` + `edt-project:week:*` découpées.
 */
export function migrateProjectStorageToSplitKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return; // rien à migrer

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // blob illisible : on ne bloque pas le démarrage, tant pis pour la migration
    }

    if (typeof parsed === 'object' && parsed !== null && (parsed as { storageVersion?: unknown }).storageVersion === STORAGE_VERSION) {
      return; // déjà migré
    }
    if (!isProjectFileV1(parsed)) return; // format inattendu (ni monolithe v1, ni v2) : on n'insiste pas

    const fields = projectFileToState(parsed);
    const weeks = Object.keys(fields.weekSaves).map(Number);

    // Écrire les semaines AVANT l'entrée projet : si l'opération est interrompue au milieu, on
    // préfère des orphelins (inoffensifs, ignorés à la lecture) à une entrée projet qui référence
    // des semaines inexistantes.
    for (const week of weeks) {
      try {
        localStorage.setItem(weekStorageKey(week), JSON.stringify(fields.weekSaves[String(week)]));
      } catch {
        // best-effort : semaine perdue plutôt que migration bloquée
      }
    }

    const entry: PersistedProjectEntry = {
      projectName: fields.projectName,
      schoolYearConfig: fields.schoolYearConfig,
      allCourses: fields.allCourses,
      resources: fields.resources,
      coursesFileName: fields.coursesFileName,
      constraints: fields.constraints,
      yearColorConfig: fields.yearColorConfig,
      tightThreshold: fields.tightThreshold,
      criticalThreshold: fields.criticalThreshold,
      weeks,
      storageVersion: STORAGE_VERSION,
    };
    localStorage.setItem(PROJECT_KEY, JSON.stringify(entry));
  } catch {
    // localStorage indisponible/instrumenté de façon incomplète : on abandonne la migration
    // sans bloquer le chargement du store.
  }
}

/** Lecture pure (sans effet de bord) du flag "bandeau de migration". */
export function hasMigrationBanner(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(MIGRATION_BANNER_KEY) !== null;
  } catch {
    return false;
  }
}

/** Efface le flag — à appeler une fois le bandeau affiché (`/project`). */
export function clearMigrationBanner(): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(MIGRATION_BANNER_KEY); } catch { /* sessionStorage indisponible */ }
}
