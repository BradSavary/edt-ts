import type { CourseTaskData, EnforcedData, TaskGroupDeclaration } from '@edt-ts/scheduler-common';

type GroupType = TaskGroupDeclaration['type'];

/**
 * Config d'un groupe de tâches côté client (session uniquement, non persisté).
 * Les courseKeys sont des indices dans le tableau parsedCourses de la semaine courante.
 */
export interface TaskGroupConfig {
  id: string;           // ID unique pour l'UI (généré côté client) — utilisé comme taskGroupId
  type: GroupType;      // 'parallel' | 'sequential'
  courseKeys: string[]; // Indices dans parsedCourses (même que courseKey dans CourseCard)
}

/**
 * Injecte le taskGroupId dans les cours appartenant à un groupe,
 * et retourne les TaskGroupDeclaration[] correspondantes.
 *
 * @param courses - tableau original de CourseTaskData (ne sera pas muté)
 * @param groups  - configuration des groupes (courseKeys = indices dans courses)
 * @returns { coursesWithGroups, declarations }
 */
export function buildTaskGroupData(
  courses: CourseTaskData[],
  groups: TaskGroupConfig[],
): { coursesWithGroups: CourseTaskData[]; declarations: TaskGroupDeclaration[] } {
  // Construire une map index → groupId
  const keyToGroupId = new Map<number, string>();
  const declarations: TaskGroupDeclaration[] = [];

  for (const group of groups) {
    if (group.courseKeys.length < 2) continue;
    declarations.push({ id: group.id, type: group.type });
    for (const key of group.courseKeys) {
      const index = parseInt(key, 10);
      if (!isNaN(index) && index >= 0 && index < courses.length) {
        keyToGroupId.set(index, group.id);
      }
    }
  }

  // Créer une copie des cours avec taskGroupId injecté là où nécessaire
  const coursesWithGroups = courses.map((c, i) => {
    const groupId = keyToGroupId.get(i);
    if (!groupId) return c;
    return { ...c, taskGroupId: groupId };
  });

  return { coursesWithGroups, declarations };
}

/**
 * @deprecated Utiliser buildTaskGroupData à la place.
 * Conservé pour compatibilité temporaire.
 */
export function buildTaskGroupDeclarations(
  courses: CourseTaskData[],
  groups: TaskGroupConfig[],
): TaskGroupDeclaration[] {
  return buildTaskGroupData(courses, groups).declarations;
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
  courses: CourseTaskData[],
): Record<string, EnforcedData> {
  const result: Record<string, EnforcedData> = {};
  const keyIndex = group.courseKeys.indexOf(enforcedKey);
  if (keyIndex < 0) return result;

  if (group.type === 'parallel') {
    for (const key of group.courseKeys) {
      if (key === enforcedKey) continue;
      const idx = parseInt(key, 10);
      if (isNaN(idx) || idx < 0 || idx >= courses.length) continue;
      const c = courses[idx];
      result[key] = {
        startTime: enforcedData.startTime,
        teacher: pickDefaultResources(c.teacher),
        groups: pickDefaultResources(c.groups),
        rooms: pickDefaultResources(c.rooms),
      };
    }
  } else {
    // Sequential — forward propagation (tâches après dans la chaîne)
    const enforcedIdx = parseInt(enforcedKey, 10);
    if (!isNaN(enforcedIdx) && enforcedIdx >= 0 && enforcedIdx < courses.length) {
      const enforcedCourse = courses[enforcedIdx];
      let cumStart = enforcedData.startTime + enforcedCourse.duration;
      for (let i = keyIndex + 1; i < group.courseKeys.length; i++) {
        const key = group.courseKeys[i];
        const idx = parseInt(key, 10);
        if (isNaN(idx) || idx < 0 || idx >= courses.length) continue;
        const c = courses[idx];
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
        const idx = parseInt(key, 10);
        if (isNaN(idx) || idx < 0 || idx >= courses.length) continue;
        const c = courses[idx];
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
