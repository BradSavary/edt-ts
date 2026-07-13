import type { CourseTaskData, TaskSolutionJSON, ResourceEntry, NeutralizedTaskInfoJSON } from '@edt-ts/scheduler-common';
import type { TaskCardProps } from '@/components/planning/courses/TaskCard';
import type { ManuallyNeutralizedTask } from '@/store/types';

export type TaskCardBaseProps = Pick<
  TaskCardProps,
  'code' | 'type' | 'name' | 'duration' | 'teachers' | 'groups' | 'rooms'
>;

/** Convertit un ResourceEntry[] (string | string[]) en string[] lisible. */
export function normalizeResourceEntries(entries: ResourceEntry[]): string[] {
  return entries.map((e) => (Array.isArray(e) ? e.join(' | ') : e));
}

export function courseToBaseProps(course: CourseTaskData): TaskCardBaseProps {
  return {
    code: course.code,
    type: course.type,
    name: course.name,
    duration: course.duration,
    teachers: normalizeResourceEntries(course.teacher),
    groups: normalizeResourceEntries(course.groups),
    rooms: normalizeResourceEntries(course.rooms ?? []),
  };
}

export function solutionToBaseProps(task: TaskSolutionJSON): TaskCardBaseProps {
  return {
    code: task.code,
    type: task.type,
    name: task.name,
    duration: task.duration,
    teachers: task.resources.filter((r) => r.type === 'teacher').map((r) => r.id),
    groups: task.resources.filter((r) => r.type === 'group').map((r) => r.id),
    rooms: task.resources.filter((r) => r.type === 'room').map((r) => r.id),
  };
}

export function manuallyNeutralizedToBaseProps(task: ManuallyNeutralizedTask): TaskCardBaseProps {
  return {
    code: task.code,
    type: task.type,
    name: task.name,
    duration: task.duration,
    teachers: task.teachers,
    groups: task.groups,
    rooms: task.rooms,
  };
}

/**
 * Résout les infos d'un cours neutralisé par son taskId, quelle que soit la source :
 * neutralisé par le moteur / pré-neutralisé (activeNeutralizedTasks), ou retiré
 * manuellement du calendrier après coup (manuallyNeutralizedTasks). Retourne null si
 * le taskId ne correspond à aucun des deux (ex: déjà replacé sur le calendrier).
 */
export function resolveNeutralizedTaskById(
  taskId: string,
  activeNeutralizedTasks: NeutralizedTaskInfoJSON[],
  manuallyNeutralizedTasks: ManuallyNeutralizedTask[],
): (TaskCardBaseProps & { taskId: string }) | null {
  const fromSolution = activeNeutralizedTasks.find((t) => t.task.taskId === taskId);
  if (fromSolution) return { ...solutionToBaseProps(fromSolution.task), taskId };

  const fromManual = manuallyNeutralizedTasks.find((t) => t.taskId === taskId);
  if (fromManual) return { ...manuallyNeutralizedToBaseProps(fromManual), taskId };

  return null;
}
