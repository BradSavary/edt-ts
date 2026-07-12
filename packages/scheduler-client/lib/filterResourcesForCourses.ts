import type { CourseTaskData, EnforcedData, ResourceGroupData } from '@edt-ts/scheduler-common';

const TYPE_TO_COURSE_FIELD = {
  teacher: 'teacher',
  group: 'groups',
  room: 'rooms',
} as const satisfies Record<ResourceGroupData['resourceType'], keyof Pick<CourseTaskData, 'teacher' | 'groups' | 'rooms'>>;

/**
 * Filtre le catalogue de ressources pour ne garder que celles effectivement
 * référencées par `courses` (+ celles imposées via `enforcedMap`) — évite de
 * transmettre au moteur des ressources sans rapport avec la semaine planifiée
 * (ex. un enseignant qui n'intervient que d'autres semaines), qui déclenchent
 * inutilement l'avertissement "non trouvée dans les contraintes" côté moteur.
 */
export function filterResourcesForCourses<T extends ResourceGroupData>(
  resources: T[],
  courses: CourseTaskData[],
  enforcedMap: Record<string, EnforcedData>,
): T[] {
  const referencedIds: Record<'teacher' | 'groups' | 'rooms', Set<string>> = {
    teacher: new Set(),
    groups: new Set(),
    rooms: new Set(),
  };

  for (const course of courses) {
    for (const id of course.teacher.flat()) referencedIds.teacher.add(id);
    for (const id of course.groups.flat()) referencedIds.groups.add(id);
    for (const id of course.rooms.flat()) referencedIds.rooms.add(id);
  }
  for (const enforced of Object.values(enforcedMap)) {
    for (const id of enforced.teacher) referencedIds.teacher.add(id);
    for (const id of enforced.groups) referencedIds.groups.add(id);
    for (const id of enforced.rooms) referencedIds.rooms.add(id);
  }

  return resources.map((group) => {
    const field = TYPE_TO_COURSE_FIELD[group.resourceType];
    const ids = referencedIds[field];
    return {
      ...group,
      resources: group.resources.filter((r) => ids.has(r.id)),
    };
  });
}
