import type { CourseTaskData, ResourceGroupData, ResourceData } from '@edt-ts/scheduler-common';
import { courseIdentityKey, csvCourseId, type CourseTaskDataWithId } from '@/lib/courseId';

// ── Diff des cours ───────────────────────────────────────────────────────

export interface CourseDiffResult {
  /** Futur allCourses, dans l'ordre du nouveau CSV. */
  merged: CourseTaskDataWithId[];
  /** Appariés par clé d'identité : id ancien préservé, champs rafraîchis depuis le nouveau CSV. */
  kept: CourseTaskDataWithId[];
  /** Sans correspondance côté ancien projet : id fraîchement généré. */
  added: CourseTaskDataWithId[];
  /** Anciens cours en excès pour leur clé : disparus du nouveau CSV. */
  removed: CourseTaskDataWithId[];
}

/** Extrait le numéro d'occurrence encodé dans un id (`hash` → 1, `hash_N` → N). */
function occurrenceOfId(id: string, baseHash: string): number {
  if (id === baseHash) return 1;
  if (id.startsWith(`${baseHash}_`)) {
    const n = parseInt(id.slice(baseHash.length + 1), 10);
    if (!isNaN(n)) return n;
  }
  return 1;
}

/**
 * Diff intelligent entre les cours CSV actuels du projet et un CSV fraîchement réimporté.
 * Regroupe les deux côtés par `courseIdentityKey`, apparie min(ancien, nouveau) instances de
 * chaque clé dans l'ordre d'apparition (déterministe, sans importance sémantique puisque les
 * doublons d'une même clé sont interchangeables par définition). Le surplus éventuel devient
 * `added` (nouveau) ou `removed` (ancien) selon le côté excédentaire — jamais les deux à la
 * fois pour une même clé, puisque `min(N,M)` épuise toujours le plus petit côté.
 *
 * Pour les cours appariés (`kept`), l'id ANCIEN est préservé (pas recalculé) : c'est ce qui
 * permet à taskGroups/manualEnforcedMap/preNeutralizedKeys de rester valides sans remapping.
 * Pour les cours `added`, l'occurrence est strictement croissante par rapport au maximum déjà
 * utilisé pour cette clé (jamais de comblement de trou laissé par une suppression manuelle
 * antérieure — voir lib/weekCourses.ts et store/useProjectStore.ts::removeCourse).
 *
 * `newCourses` peut être un `CourseTaskDataWithId[]` (ex: sortie de `parseCsvFull`, qui assigne
 * déjà des ids "jetables" via `assignCsvCourseIds`) : ses champs `id`/`source` sont ignorés ici,
 * seuls les champs métier comptent.
 */
export function diffCsvCourses(
  oldCourses: CourseTaskDataWithId[],
  newCourses: CourseTaskData[],
): CourseDiffResult {
  const oldByKey = new Map<string, CourseTaskDataWithId[]>();
  for (const c of oldCourses) {
    const key = courseIdentityKey(c);
    const list = oldByKey.get(key);
    if (list) list.push(c); else oldByKey.set(key, [c]);
  }

  const newByKey = new Map<string, CourseTaskData[]>();
  for (const c of newCourses) {
    const key = courseIdentityKey(c);
    const list = newByKey.get(key);
    if (list) list.push(c); else newByKey.set(key, [c]);
  }

  const kept: CourseTaskDataWithId[] = [];
  const added: CourseTaskDataWithId[] = [];
  const removed: CourseTaskDataWithId[] = [];
  const finalIdByNewCourse = new Map<CourseTaskData, string>();

  const allKeys = new Set<string>([...oldByKey.keys(), ...newByKey.keys()]);

  for (const key of allKeys) {
    const oldList = oldByKey.get(key) ?? [];
    const newList = newByKey.get(key) ?? [];
    const pairCount = Math.min(oldList.length, newList.length);

    for (let i = 0; i < pairCount; i++) {
      const oldCourse = oldList[i];
      const newCourse = newList[i];
      const mergedCourse: CourseTaskDataWithId = { ...newCourse, id: oldCourse.id, source: 'csv' };
      kept.push(mergedCourse);
      finalIdByNewCourse.set(newCourse, oldCourse.id);
    }

    if (newList.length > pairCount) {
      const representative = oldList[0] ?? newList[0];
      const baseHash = csvCourseId(representative, 1);
      let nextOccurrence = Math.max(0, ...oldList.map((c) => occurrenceOfId(c.id, baseHash))) + 1;
      for (let i = pairCount; i < newList.length; i++) {
        const newCourse = newList[i];
        const id = csvCourseId(newCourse, nextOccurrence);
        nextOccurrence++;
        added.push({ ...newCourse, id, source: 'csv' });
        finalIdByNewCourse.set(newCourse, id);
      }
    }

    for (let i = pairCount; i < oldList.length; i++) {
      removed.push(oldList[i]);
    }
  }

  const merged = newCourses.map((c) => ({
    ...c,
    id: finalIdByNewCourse.get(c)!,
    source: 'csv' as const,
  }));

  return { merged, kept, added, removed };
}

// ── Diff des ressources ──────────────────────────────────────────────────

/** Extension client-only de ResourceData : `unused` n'existe pas dans @edt-ts/scheduler-common. */
export interface ResourceDataWithStatus extends ResourceData {
  /** true si absent du dernier CSV importé en mode fusion — conservée pour ne pas perdre ses contraintes. */
  unused?: boolean;
  /**
   * Limites quotidiennes spécifiques à une semaine, en minutes, clés « S36 » (même
   * convention que ResourceConstraints). Absent pour une semaine ⇒ `maxDailyMinutes`
   * (le défaut de la ressource) s'applique. Champ purement client : résolu en un
   * scalaire par `_buildPayload` avant l'envoi au moteur, qui ne le voit jamais.
   */
  weeklyMaxDailyMinutes?: Record<string, number>;
}

export interface ResourceGroupDataWithStatus {
  resourceType: ResourceGroupData['resourceType'];
  resources: ResourceDataWithStatus[];
}

const RESOURCE_TYPES: ResourceGroupData['resourceType'][] = ['teacher', 'group', 'room'];

/**
 * Réconcilie la liste des ressources du projet avec celles fraîchement extraites du CSV.
 * Identité = (resourceType, id), sensible à la casse (comportement natif Map/Set string).
 * - Présent des deux côtés : objet ancien conservé (garde maxDailyMinutes/info), `unused` effacé.
 * - Présent seulement dans l'ancien : conservé, `unused: true`.
 * - Présent seulement dans le nouveau : ajouté, sans flag.
 */
export function diffCsvResources(
  oldResources: ResourceGroupData[] | ResourceGroupDataWithStatus[],
  newResources: ResourceGroupData[],
): ResourceGroupDataWithStatus[] {
  return RESOURCE_TYPES.map((resourceType) => {
    const oldGroup = oldResources.find((g) => g.resourceType === resourceType);
    const newGroup = newResources.find((g) => g.resourceType === resourceType);
    const oldById = new Map((oldGroup?.resources ?? []).map((r) => [r.id, r] as const));
    const newIds = new Set((newGroup?.resources ?? []).map((r) => r.id));

    const resources: ResourceDataWithStatus[] = [];
    for (const [id, r] of oldById) {
      resources.push({ ...r, unused: newIds.has(id) ? undefined : true });
    }
    for (const r of newGroup?.resources ?? []) {
      if (!oldById.has(r.id)) resources.push({ ...r });
    }
    return { resourceType, resources };
  });
}

// ── Résumé pour l'aperçu utilisateur ─────────────────────────────────────

export interface WeekCourseDiffCount {
  week: number;
  kept: number;
  added: number;
  removed: number;
}

export interface CsvMergeSummary {
  perWeek: WeekCourseDiffCount[];
  totalKept: number;
  totalAdded: number;
  totalRemoved: number;
  resourcesAdded: { resourceType: ResourceGroupData['resourceType']; id: string }[];
  /** Ressources qui passent used → unused À CET IMPORT (pas celles déjà unused avant). */
  resourcesNewlyUnused: { resourceType: ResourceGroupData['resourceType']; id: string }[];
}

export function summarizeCsvDiff(
  courseDiff: CourseDiffResult,
  oldResources: ResourceGroupData[] | ResourceGroupDataWithStatus[],
  resourceDiff: ResourceGroupDataWithStatus[],
): CsvMergeSummary {
  const byWeek = new Map<number, WeekCourseDiffCount>();
  function bump(week: number, field: 'kept' | 'added' | 'removed') {
    const entry = byWeek.get(week) ?? { week, kept: 0, added: 0, removed: 0 };
    entry[field]++;
    byWeek.set(week, entry);
  }
  for (const c of courseDiff.kept) bump(c.week, 'kept');
  for (const c of courseDiff.added) bump(c.week, 'added');
  for (const c of courseDiff.removed) bump(c.week, 'removed');
  const perWeek = [...byWeek.values()].sort((a, b) => a.week - b.week);

  const oldKeys = new Set<string>();
  const oldUnusedKeys = new Set<string>();
  for (const g of oldResources) {
    for (const r of g.resources) {
      const key = `${g.resourceType}:${r.id}`;
      oldKeys.add(key);
      if ((r as ResourceDataWithStatus).unused) oldUnusedKeys.add(key);
    }
  }

  const resourcesAdded: CsvMergeSummary['resourcesAdded'] = [];
  const resourcesNewlyUnused: CsvMergeSummary['resourcesNewlyUnused'] = [];
  for (const g of resourceDiff) {
    for (const r of g.resources) {
      const key = `${g.resourceType}:${r.id}`;
      if (!oldKeys.has(key)) {
        resourcesAdded.push({ resourceType: g.resourceType, id: r.id });
      } else if (r.unused && !oldUnusedKeys.has(key)) {
        resourcesNewlyUnused.push({ resourceType: g.resourceType, id: r.id });
      }
    }
  }

  return {
    perWeek,
    totalKept: courseDiff.kept.length,
    totalAdded: courseDiff.added.length,
    totalRemoved: courseDiff.removed.length,
    resourcesAdded,
    resourcesNewlyUnused,
  };
}
