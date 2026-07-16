import type { EnforcedData } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import { courseSimilarityKey } from '@/lib/courseId';
import type { PreparedWeekSnapshot } from '@/store/slices/weekSavesSlice';
import type { TaskGroupConfig } from '@/lib/taskGroupUtils';

/**
 * Logique de correspondance pour la copie de préparation d'une semaine source S vers une
 * semaine destination D (voir `CopyWeekPrepModal`). Extrait de la couche UI pour rester
 * testable indépendamment : ce module ne connaît ni React ni le store, seulement des données.
 */

/** Union, dans un ordre déterministe, des ids de cours source concernés par une copie
 *  (clés enforced + membres de groupes) — c'est sur cet ensemble qu'on calcule l'appariement. */
export function relevantSourceCourseIds(snapshot: PreparedWeekSnapshot | undefined): string[] {
  if (!snapshot) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of Object.keys(snapshot.manualEnforcedMap)) {
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  for (const group of snapshot.taskGroups) {
    for (const id of group.courseKeys) {
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
  }
  return ids;
}

/**
 * Apparie chaque cours source pertinent à un cours destination "similaire"
 * (`courseSimilarityKey` identique), en consommant les candidats destination un par un
 * pour ne jamais assigner deux fois le même cours destination — les doublons (même clé de
 * similarité, des deux côtés) sont interchangeables, l'ordre d'appariement n'a pas
 * d'importance fonctionnelle tant qu'il est déterministe et cohérent entre l'étape enforced
 * et l'étape groupes (d'où le calcul en un seul passage, partagé par les deux).
 * `null` = aucun cours similaire disponible en D pour ce cours source.
 */
export function matchCoursesForCopy(
  relevantIds: string[],
  sourceCourses: CourseTaskDataWithId[],
  destCourses: CourseTaskDataWithId[],
): Map<string, string | null> {
  const sourceById = new Map(sourceCourses.map((c) => [c.id, c]));

  const destBySimKey = new Map<string, CourseTaskDataWithId[]>();
  for (const c of destCourses) {
    const key = courseSimilarityKey(c);
    const list = destBySimKey.get(key);
    if (list) list.push(c);
    else destBySimKey.set(key, [c]);
  }

  const usedDestIds = new Set<string>();
  const result = new Map<string, string | null>();
  for (const sourceId of relevantIds) {
    const sourceCourse = sourceById.get(sourceId);
    if (!sourceCourse) { result.set(sourceId, null); continue; }
    const candidates = destBySimKey.get(courseSimilarityKey(sourceCourse)) ?? [];
    const match = candidates.find((c) => !usedDestIds.has(c.id));
    if (match) {
      usedDestIds.add(match.id);
      result.set(sourceId, match.id);
    } else {
      result.set(sourceId, null);
    }
  }
  return result;
}

export interface EnforcedCopyItem {
  sourceCourseId: string;
  sourceCourse: CourseTaskDataWithId;
  enforcedData: EnforcedData;
  destCourseId: string | null;
  alreadyEnforcedInDest: boolean;
  copiable: boolean;
  /** Salle(s) imposée(s) en S absente(s) des alternatives connues du cours en D — la salle est
   *  copiée telle quelle malgré tout (décision produit), ce drapeau sert juste à avertir l'utilisateur. */
  roomMismatch: boolean;
}

function roomsAreKnownForDest(enforcedData: EnforcedData, destCourse: CourseTaskDataWithId): boolean {
  const validRooms = new Set(destCourse.rooms.flat());
  return enforcedData.rooms.every((r) => validRooms.has(r));
}

/** Construit la liste des cours enforced copiables/non copiables de S, dans l'ordre de `manualEnforcedMap`. */
export function buildEnforcedCopyItems(
  sourceSnapshot: PreparedWeekSnapshot | undefined,
  matches: Map<string, string | null>,
  destEnforcedMap: Record<string, EnforcedData>,
  destCourses: CourseTaskDataWithId[],
  sourceCourses: CourseTaskDataWithId[],
): EnforcedCopyItem[] {
  if (!sourceSnapshot) return [];
  const sourceById = new Map(sourceCourses.map((c) => [c.id, c]));
  const destById = new Map(destCourses.map((c) => [c.id, c]));

  const items: EnforcedCopyItem[] = [];
  for (const [sourceCourseId, enforcedData] of Object.entries(sourceSnapshot.manualEnforcedMap)) {
    const sourceCourse = sourceById.get(sourceCourseId);
    if (!sourceCourse) continue; // référence orpheline (cours source supprimé depuis) — ignorée
    const destCourseId = matches.get(sourceCourseId) ?? null;
    const destCourse = destCourseId ? destById.get(destCourseId) : undefined;
    const alreadyEnforcedInDest = destCourseId !== null && destCourseId in destEnforcedMap;
    items.push({
      sourceCourseId,
      sourceCourse,
      enforcedData,
      destCourseId,
      alreadyEnforcedInDest,
      copiable: destCourseId !== null && !alreadyEnforcedInDest,
      roomMismatch: destCourse ? !roomsAreKnownForDest(enforcedData, destCourse) : false,
    });
  }
  return items;
}

export interface GroupCopyItem {
  sourceGroup: TaskGroupConfig;
  /** Cours destination des membres, dans le même ordre que sourceGroup.courseKeys — null si un membre au moins n'a pas de similaire. */
  memberDestIds: string[] | null;
  alreadyGroupedInDest: boolean;
  copiable: boolean;
}

/** Construit la liste des groupes copiables/non copiables de S. */
export function buildGroupCopyItems(
  sourceSnapshot: PreparedWeekSnapshot | undefined,
  matches: Map<string, string | null>,
  destTaskGroups: TaskGroupConfig[],
): GroupCopyItem[] {
  if (!sourceSnapshot) return [];
  const destGroupedIds = new Set(destTaskGroups.flatMap((g) => g.courseKeys));

  return sourceSnapshot.taskGroups.map((sourceGroup) => {
    const memberDestIds: string[] = [];
    let allFound = true;
    for (const key of sourceGroup.courseKeys) {
      const destId = matches.get(key) ?? null;
      if (destId === null) { allFound = false; break; }
      memberDestIds.push(destId);
    }
    const alreadyGroupedInDest = allFound && memberDestIds.some((id) => destGroupedIds.has(id));
    return {
      sourceGroup,
      memberDestIds: allFound ? memberDestIds : null,
      alreadyGroupedInDest,
      copiable: allFound && !alreadyGroupedInDest,
    };
  });
}

/** Fusionne les enforced sélectionnés dans la carte destination courante (ne mute pas l'entrée). */
export function buildNewEnforcedMap(
  currentDestEnforcedMap: Record<string, EnforcedData>,
  selectedItems: EnforcedCopyItem[],
): Record<string, EnforcedData> {
  const next = { ...currentDestEnforcedMap };
  for (const item of selectedItems) {
    if (!item.destCourseId) continue;
    next[item.destCourseId] = { ...item.enforcedData };
  }
  return next;
}
