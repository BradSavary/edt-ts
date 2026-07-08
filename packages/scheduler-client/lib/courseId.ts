import type { CourseTaskData } from '@edt-ts/scheduler-common';

/**
 * Extension client-only de CourseTaskData avec un identifiant stable.
 * - Cours CSV  : id = hash déterministe de la clé d'identité (voir `courseIdentityKey`),
 *   + suffixe d'occurrence pour les doublons
 * - Cours manuels : id = identifiant unique basé sur l'horodatage (non déterministe par nature)
 * Cette interface vit uniquement dans scheduler-client ; scheduler-common reste inchangé.
 */
export interface CourseTaskDataWithId extends CourseTaskData {
  /** Identifiant stable, figé à la création du cours. L'édition d'un cours ne change pas son id. */
  id: string;
  /** Origine du cours. */
  source: 'csv' | 'manual';
}

// ── Hash djb2 (32 bits non signé) ─────────────────────────────────────────

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Clé d'identité d'un cours : semaine + code + type + enseignant(s) + groupe(s) + durée.
 * Deux cours partageant cette clé sont considérés interchangeables — c'est la même notion
 * utilisée pour désambiguïser les doublons à l'import ET (plus tard) pour apparier les cours
 * d'un CSV réimporté aux cours existants du projet (merge non destructif).
 *
 * Volontairement exclus :
 * - `rooms` : une salle réassignée ne change pas la nature du cours (une contrainte de
 *   planification, pas une identité).
 * - `name` : purement cosmétique, et de toute façon unique par `code`.
 * - `semester`/`level` : métadonnées de positionnement curriculaire, non pertinentes pour
 *   la validité d'un placement déjà fait sur ce cours.
 *
 * Les listes de ressources sont triées pour que l'ordre n'ait pas d'importance.
 */
export function courseIdentityKey(course: CourseTaskData): string {
  const teachers = course.teacher.flat().sort().join(',');
  const groups = course.groups.flat().sort().join(',');
  return [
    course.week,
    course.code,
    course.type,
    course.duration,
    teachers,
    groups,
  ].join('\x00');
}

/**
 * Génère un ID déterministe pour un cours CSV.
 * @param course  Le cours source
 * @param occurrence  Rang parmi les doublons identiques (commence à 1).
 *                    occurrence = 1 → pas de suffixe ; occurrence > 1 → suffixe `_N`.
 */
function csvCourseId(course: CourseTaskData, occurrence: number): string {
  const hash = djb2(courseIdentityKey(course)).toString(36);
  return occurrence > 1 ? `${hash}_${occurrence}` : hash;
}

/**
 * Génère un ID unique pour un cours créé manuellement.
 * Non déterministe : timestamp + partie aléatoire garantissent l'unicité dans la session.
 */
export function manualCourseId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Attribue des IDs déterministes à un tableau de cours CSV.
 * Les cours avec la même clé d'identité (doublons interchangeables — voir `courseIdentityKey`)
 * reçoivent le même hash de base et un suffixe d'occurrence (`_2`, `_3`, …) à partir du
 * deuxième doublon.
 */
export function assignCsvCourseIds(courses: CourseTaskData[]): CourseTaskDataWithId[] {
  const counts = new Map<string, number>();
  return courses.map((course) => {
    const key = courseIdentityKey(course);
    const occ = (counts.get(key) ?? 0) + 1;
    counts.set(key, occ);
    return { ...course, id: csvCourseId(course, occ), source: 'csv' as const };
  });
}

/**
 * Construit une Map `id → cours` pour une recherche en O(1).
 * À utiliser avec `useMemo` dans les composants/hooks.
 */
export function buildCourseMap(courses: CourseTaskDataWithId[]): Map<string, CourseTaskDataWithId> {
  return new Map(courses.map((c) => [c.id, c]));
}
