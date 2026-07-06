import type { CourseTaskData, EnforcedData, TaskGroupDeclaration } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';

export type GroupType = TaskGroupDeclaration['type'];

export interface ParallelGroupIssue {
  conflictingTeachers?: string[];
  conflictingGroups?: string[];
  roomShortfall?: { available: number; needed: number };
}

/**
 * Vérifie la validité d'un groupe 'parallel' :
 * - Aucun intervenant fixe (string, non-alternatif) ne doit apparaître dans plus d'une tâche
 * - Aucun groupe étudiant fixe ne doit apparaître dans plus d'une tâche
 * - L'union des salles possibles de toutes les tâches doit être >= nombre de tâches
 *
 * Retourne null si valide, sinon un objet décrivant les problèmes.
 */
export function validateParallelGroup(
  group: TaskGroupConfig,
  courses: CourseTaskDataWithId[],
): ParallelGroupIssue | null {
  if (group.type !== 'parallel' || group.courseKeys.length < 2) return null;

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const tasks = group.courseKeys
    .map((key) => courseById.get(key))
    .filter((t): t is CourseTaskDataWithId => Boolean(t));

  if (tasks.length < 2) return null;

  const issue: ParallelGroupIssue = {};
  let hasIssue = false;

  // Intervenants fixes (string non-alternatif) en conflit
  const teacherCounts = new Map<string, number>();
  for (const task of tasks) {
    for (const entry of task.teacher) {
      if (typeof entry === 'string') {
        teacherCounts.set(entry, (teacherCounts.get(entry) ?? 0) + 1);
      }
    }
  }
  const conflictingTeachers = [...teacherCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  if (conflictingTeachers.length > 0) {
    issue.conflictingTeachers = conflictingTeachers;
    hasIssue = true;
  }

  // Groupes étudiants fixes en conflit
  const groupCounts = new Map<string, number>();
  for (const task of tasks) {
    for (const entry of task.groups) {
      if (typeof entry === 'string') {
        groupCounts.set(entry, (groupCounts.get(entry) ?? 0) + 1);
      }
    }
  }
  const conflictingGroups = [...groupCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  if (conflictingGroups.length > 0) {
    issue.conflictingGroups = conflictingGroups;
    hasIssue = true;
  }

  // Salles disponibles (union de toutes les alternatives) >= nombre de tâches
  const allRooms = new Set<string>();
  for (const task of tasks) {
    for (const entry of task.rooms) {
      if (typeof entry === 'string') allRooms.add(entry);
      else for (const r of entry) allRooms.add(r);
    }
  }
  if (allRooms.size < tasks.length) {
    issue.roomShortfall = { available: allRooms.size, needed: tasks.length };
    hasIssue = true;
  }

  return hasIssue ? issue : null;
}

/**
 * Config d'un groupe de tâches côté client (session uniquement, non persisté).
 * Les courseKeys sont des IDs de cours (CourseTaskDataWithId.id).
 */
export interface TaskGroupConfig {
  id: string;           // ID unique pour l'UI (généré côté client) — utilisé comme taskGroupId
  type: GroupType;      // 'parallel' | 'sequential'
  courseKeys: string[]; // IDs de cours (CourseTaskDataWithId.id)
}

/**
 * Injecte le taskGroupId dans les cours appartenant à un groupe,
 * et retourne les TaskGroupDeclaration[] correspondantes.
 *
 * @param courses - tableau de CourseTaskDataWithId (ne sera pas muté)
 * @param groups  - configuration des groupes (courseKeys = IDs de cours)
 * @returns { coursesWithGroups, declarations }
 */
export function buildTaskGroupData(
  courses: CourseTaskDataWithId[],
  groups: TaskGroupConfig[],
): { coursesWithGroups: CourseTaskData[]; declarations: TaskGroupDeclaration[] } {
  // Construire une map courseId → groupId
  const idToGroupId = new Map<string, string>();
  const declarations: TaskGroupDeclaration[] = [];

  for (const group of groups) {
    if (group.courseKeys.length < 2) continue;
    declarations.push({ id: group.id, type: group.type });
    for (const courseId of group.courseKeys) {
      idToGroupId.set(courseId, group.id);
    }
  }

  // Créer une copie des cours avec taskGroupId injecté là où nécessaire
  const coursesWithGroups = courses.map((c) => {
    const groupId = idToGroupId.get(c.id);
    if (!groupId) return c;
    return { ...c, taskGroupId: groupId };
  });

  return { coursesWithGroups, declarations };
}

/**
 * Retourne l'info de groupe d'un courseKey (ou null si non membre).
 */
export function getCourseGroupInfo(
  groups: TaskGroupConfig[],
  courseKey: string,
): { groupId: string; type: GroupType; indexInGroup: number } | null {
  for (const group of groups) {
    const idx = group.courseKeys.indexOf(courseKey);
    if (idx >= 0) {
      return { groupId: group.id, type: group.type, indexInGroup: idx };
    }
  }
  return null;
}

/**
 * Prend la première ressource de chaque groupe alternatif d'un cours.
 * Utilisé pour les enforcements automatiques (ressources par défaut).
 */
function pickDefaultResources(entries: (string | string[])[]): string[] {
  return entries
    .map((e) => (Array.isArray(e) ? e[0] : e))
    .filter((r): r is string => Boolean(r));
}

/**
 * Calcule les enforcements auto pour les autres membres d'un groupe
 * quand une tâche du groupe est enforcée.
 * Retourne un map courseKey → EnforcedData (membres uniquement, sans la tâche source).
 *
 * - Parallel  : tous les membres reçoivent le même startTime
 * - Sequential: propagation forward (membres suivants) et backward (membres précédents)
 */
export function computeGroupEnforcements(
  enforcedKey: string,
  enforcedData: EnforcedData,
  group: TaskGroupConfig,
  courses: CourseTaskDataWithId[],
): Record<string, EnforcedData> {
  const result: Record<string, EnforcedData> = {};
  const keyIndex = group.courseKeys.indexOf(enforcedKey);
  if (keyIndex < 0) return result;

  const courseById = new Map(courses.map((c) => [c.id, c]));

  if (group.type === 'parallel') {
    for (const key of group.courseKeys) {
      if (key === enforcedKey) continue;
      const c = courseById.get(key);
      if (!c) continue;
      result[key] = {
        startTime: enforcedData.startTime,
        teacher: pickDefaultResources(c.teacher),
        groups: pickDefaultResources(c.groups),
        rooms: pickDefaultResources(c.rooms),
      };
    }
  } else {
    // Sequential — forward propagation (tâches après dans la chaîne)
    const enforcedCourse = courseById.get(enforcedKey);
    if (enforcedCourse) {
      let cumStart = enforcedData.startTime + enforcedCourse.duration;
      for (let i = keyIndex + 1; i < group.courseKeys.length; i++) {
        const key = group.courseKeys[i];
        const c = courseById.get(key);
        if (!c) continue;
        result[key] = {
          startTime: cumStart,
          teacher: pickDefaultResources(c.teacher),
          groups: pickDefaultResources(c.groups),
          rooms: pickDefaultResources(c.rooms),
        };
        cumStart += c.duration;
      }
      // Backward propagation (tâches avant dans la chaîne)
      let cumEnd = enforcedData.startTime;
      for (let i = keyIndex - 1; i >= 0; i--) {
        const key = group.courseKeys[i];
        const c = courseById.get(key);
        if (!c) continue;
        const startTime = cumEnd - c.duration;
        result[key] = {
          startTime,
          teacher: pickDefaultResources(c.teacher),
          groups: pickDefaultResources(c.groups),
          rooms: pickDefaultResources(c.rooms),
        };
        cumEnd = startTime;
      }
    }
  }

  return result;
}
