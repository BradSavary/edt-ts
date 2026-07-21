import type { TaskSolutionJSON, EnforcedData } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { Placement } from '@/store/types';

/**
 * Convertit les tâches placées par le moteur en placements `auto`. `placementId === taskId` :
 * l'étape 1 ne produit qu'un placement par tâche (pas de fragment).
 */
export function placementsFromSolution(tasks: TaskSolutionJSON[]): Placement[] {
  return tasks.map((task) => ({
    placementId: task.taskId,
    taskId: task.taskId,
    startTime: task.startTime,
    duration: task.duration,
    resources: {
      teachers: task.resources.filter((r) => r.type === 'teacher').map((r) => r.id),
      groups: task.resources.filter((r) => r.type === 'group').map((r) => r.id),
      rooms: task.resources.filter((r) => r.type === 'room').map((r) => r.id),
    },
    origin: 'auto',
  }));
}

/**
 * Convertit une map d'impositions en placements `pre-enforced`. `map` est la map **augmentée**
 * (manuelle + propagation de groupe) — c'est ce que le calendrier affiche. Si `manualMap` est
 * fourni, les entrées de `map` absentes de `manualMap` (donc issues de la seule propagation)
 * sont marquées `derived: true` — voir `enforcedMapFromPlacements`, qui les exclut.
 */
export function placementsFromEnforcedMap(
  map: Record<string, EnforcedData>,
  manualMap?: Record<string, EnforcedData>,
): Placement[] {
  return Object.entries(map).map(([taskId, enforced]) => ({
    placementId: taskId,
    taskId,
    startTime: enforced.startTime,
    resources: { teachers: enforced.teacher, groups: enforced.groups, rooms: enforced.rooms },
    origin: 'pre-enforced' as const,
    ...(manualMap && !(taskId in manualMap) ? { derived: true as const } : {}),
  }));
}

/**
 * Inverse de `placementsFromEnforcedMap`, restreint aux placements `pre-enforced`. Deux usages :
 * - payload moteur (`runSchedule`) : tout `pre-enforced`, propagés compris — le moteur doit
 *   recevoir la même imposition augmentée qu'avant ce chantier.
 * - `manualEnforcedMap` persisté (`_saveCurrentWeekSnapshot`, §1.2) : `excludeDerived: true`
 *   pour ne jamais écrire sur disque une imposition issue de la seule propagation de groupe —
 *   elle est recalculée à la lecture (`setSelectedWeek`/`handleEnforceChange`), jamais figée.
 */
export function enforcedMapFromPlacements(
  placements: Placement[],
  options?: { excludeDerived?: boolean },
): Record<string, EnforcedData> {
  const result: Record<string, EnforcedData> = {};
  for (const p of placements) {
    if (p.origin !== 'pre-enforced') continue;
    if (options?.excludeDerived && p.derived) continue;
    result[p.taskId] = {
      startTime: p.startTime,
      teacher: p.resources.teachers,
      groups: p.resources.groups,
      rooms: p.resources.rooms,
    };
  }
  return result;
}

/**
 * Conversion de frontière vers `TaskSolutionJSON`, consommé par l'export iCal et les
 * statistiques. `code`/`name`/`type` viennent du cours référencé (résolu par l'appelant via
 * `courseById.get(placement.taskId)`), jamais du placement lui-même (règle 1, §3 du plan).
 */
export function toTaskSolutionJSON(
  placement: Placement,
  course: CourseTaskDataWithId | undefined,
  week: number,
): TaskSolutionJSON {
  return {
    taskId: placement.taskId,
    code: course?.code ?? '',
    name: course?.name ?? '',
    type: course?.type ?? '',
    week,
    duration: placement.duration ?? course?.duration ?? 0,
    startTime: placement.startTime,
    resources: [
      ...placement.resources.teachers.map((id) => ({ id, type: 'teacher' })),
      ...placement.resources.groups.map((id) => ({ id, type: 'group' })),
      ...placement.resources.rooms.map((id) => ({ id, type: 'room' })),
    ],
  };
}
