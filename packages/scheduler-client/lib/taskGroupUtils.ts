import type { CourseTaskData, EnforcedData, TaskGroupDeclaration, GroupType } from '@edt-ts/scheduler-common';

/**
 * Config d'un groupe de tâches côté client (session uniquement, non persisté).
 * Les courseKeys sont des indices dans le tableau parsedCourses de la semaine courante.
 */
export interface TaskGroupConfig {
  id: string;           // ID unique pour l'UI (généré côté client)
  type: GroupType;      // 'parallel' | 'sequential'
  courseKeys: string[]; // Indices dans parsedCourses (même que courseKey dans CourseCard)
}

/**
 * Reproduit la logique de génération d'ID de SchedulerData.initTasks().
 * Doit correspondre exactement : `${code}_${teacherIds}_${groupIds}_${counter}`
 * où counter = index + 1 (1-based dans le moteur).
 */
export function computeEngineTaskId(course: CourseTaskData, index: number): string {
  const teacherIds = course.teacher.flat().join('_');
  return `${course.code}_${teacherIds}_${course.groups.flat().join('_')}_${index + 1}`;
}

/**
 * Convertit la liste de TaskGroupConfig en TaskGroupDeclaration[] pour l'API.
 * @param courses - tableau de CourseTaskData pour la semaine courante (dans l'ordre d'envoi à l'API)
 * @param groups  - configuration des groupes (courseKeys = indices dans courses)
 */
export function buildTaskGroupDeclarations(
  courses: CourseTaskData[],
  groups: TaskGroupConfig[],
): TaskGroupDeclaration[] {
  const result: TaskGroupDeclaration[] = [];
  for (const group of groups) {
    if (group.courseKeys.length < 2) continue;
    const taskIds: string[] = [];
    for (const key of group.courseKeys) {
      const index = parseInt(key, 10);
      if (isNaN(index) || index < 0 || index >= courses.length) continue;
      taskIds.push(computeEngineTaskId(courses[index], index));
    }
    if (taskIds.length >= 2) {
      result.push({ type: group.type, taskIds });
    }
  }
  return result;
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
