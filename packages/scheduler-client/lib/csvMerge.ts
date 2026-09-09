import type { CourseTaskData, ResourceGroupData, ResourceData } from '@edt-ts/scheduler-common';
import { courseIdentityKey, csvCourseId, type CourseTaskDataWithId } from '@/lib/courseId';

// ── Diff des cours ───────────────────────────────────────────────────────

export interface CourseDiffResult {
  /** Futur allCourses : cours hors périmètre inchangés, puis cours du périmètre dans l'ordre du CSV. */
  merged: CourseTaskDataWithId[];
  /** Appariés par clé d'identité : id ancien préservé, champs rafraîchis depuis le nouveau CSV. */
  kept: CourseTaskDataWithId[];
  /** Sans correspondance côté ancien projet : id fraîchement généré. */
  added: CourseTaskDataWithId[];
  /** Anciens cours en excès pour leur clé, DANS LE PÉRIMÈTRE : disparus du nouveau CSV. */
  removed: CourseTaskDataWithId[];
  /**
   * Anciens cours d'une semaine absente du CSV importé : hors périmètre, donc repris tels quels
   * (mêmes références d'objet) sans jamais être comparés. Ni `kept` ni `removed`.
   */
  untouched: CourseTaskDataWithId[];
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
 *
 * PÉRIMÈTRE — un import ne peut toucher que les semaines pour lesquelles le CSV apporte au
 * moins un cours. Les cours des autres semaines sont repris tels quels dans `merged` et
 * ressortent en `untouched` : ils ne sont jamais comparés, donc jamais `removed`, donc leur
 * préparation n'est jamais élaguée (voir `pruneWeekSavesOfCourseIds`). C'est ce qui rend sûr
 * l'import d'un fichier partiel — n'apportant que quelques semaines — dans un projet déjà
 * préparé ou planifié. Contrepartie assumée : vider une semaine de tous ses cours dans le
 * fichier source ne la vide plus dans le projet (la semaine sort simplement du périmètre) ;
 * il faut supprimer ces cours à la main, ou passer par « Tout remplacer ».
 *
 * DANS LE PÉRIMÈTRE — regroupe les deux côtés par `courseIdentityKey`, apparie min(ancien, nouveau) instances de
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
  // Périmètre de l'import : les semaines réellement apportées par le CSV. Dérivé des cours
  // produits par le parsing, pas des colonnes SXX de l'en-tête : un fichier de ventilation
  // garde en général toutes les colonnes de l'année, colonnes vides comprises.
  const scopeWeeks = new Set(newCourses.map((c) => c.week));

  const untouched: CourseTaskDataWithId[] = [];
  const oldByKey = new Map<string, CourseTaskDataWithId[]>();
  for (const c of oldCourses) {
    if (!scopeWeeks.has(c.week)) {
      untouched.push(c);
      continue;
    }
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

  // Une semaine est soit entièrement dans le périmètre, soit entièrement dehors : concaténer
  // les deux blocs préserve donc exactement l'ordre INTRA-semaine (le seul qui compte — tous
  // les consommateurs filtrent par `c.week`, cf. getCoursesForWeek).
  const merged = [
    ...untouched,
    ...newCourses.map((c) => ({
      ...c,
      id: finalIdByNewCourse.get(c)!,
      source: 'csv' as const,
    })),
  ];

  return { merged, kept, added, removed, untouched };
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

/** Ids réellement cités par au moins un cours, par type de ressource (alternatives aplaties). */
function usedResourceIds(courses: CourseTaskData[]): Map<ResourceGroupData['resourceType'], Set<string>> {
  const used = new Map<ResourceGroupData['resourceType'], Set<string>>(
    RESOURCE_TYPES.map((t) => [t, new Set<string>()]),
  );
  for (const c of courses) {
    for (const id of c.teacher.flat()) used.get('teacher')!.add(id);
    for (const id of c.groups.flat()) used.get('group')!.add(id);
    for (const id of c.rooms.flat()) used.get('room')!.add(id);
  }
  return used;
}

/**
 * Réconcilie la liste des ressources du projet avec celles fraîchement extraites du CSV.
 * Identité = (resourceType, id), sensible à la casse (comportement natif Map/Set string).
 * - Présent des deux côtés : objet ancien conservé (garde maxDailyMinutes/info).
 * - Présent seulement dans l'ancien : conservé (jamais supprimé, sinon ses contraintes seraient perdues).
 * - Présent seulement dans le nouveau : ajouté.
 *
 * Le flag `unused` n'est PAS déduit de la présence dans le CSV importé mais recalculé depuis
 * `finalCourses` — les cours du projet après fusion, cours manuels compris. Un import partiel
 * (quelques semaines seulement) ne doit pas marquer inutilisé un enseignant ou une salle qui
 * sert encore dans une semaine hors périmètre. Corollaire : un `unused` devenu faux depuis un
 * import antérieur est effacé au passage.
 */
export function diffCsvResources(
  oldResources: ResourceGroupData[] | ResourceGroupDataWithStatus[],
  newResources: ResourceGroupData[],
  finalCourses: CourseTaskData[],
): ResourceGroupDataWithStatus[] {
  const used = usedResourceIds(finalCourses);
  return RESOURCE_TYPES.map((resourceType) => {
    const oldGroup = oldResources.find((g) => g.resourceType === resourceType);
    const newGroup = newResources.find((g) => g.resourceType === resourceType);
    const oldById = new Map((oldGroup?.resources ?? []).map((r) => [r.id, r] as const));
    const usedIds = used.get(resourceType)!;

    const resources: ResourceDataWithStatus[] = [];
    for (const [id, r] of oldById) {
      resources.push({ ...r, unused: usedIds.has(id) ? undefined : true });
    }
    for (const r of newGroup?.resources ?? []) {
      if (!oldById.has(r.id)) resources.push({ ...r, unused: usedIds.has(r.id) ? undefined : true });
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
  /** Semaines apportées par le CSV — les seules que l'import peut modifier. Triées. */
  scopeWeeks: number[];
  /** Semaines du projet absentes du CSV : conservées intégralement, préparation comprise. Triées. */
  untouchedWeeks: number[];
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

  const asc = (a: number, b: number) => a - b;
  const scopeWeeks = [...new Set(perWeek.map((w) => w.week))].sort(asc);
  const untouchedWeeks = [...new Set(courseDiff.untouched.map((c) => c.week))].sort(asc);

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
    scopeWeeks,
    untouchedWeeks,
    resourcesAdded,
    resourcesNewlyUnused,
  };
}
