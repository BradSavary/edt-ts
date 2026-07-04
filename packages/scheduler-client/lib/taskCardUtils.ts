import type { CourseTaskData, TaskSolutionJSON, ResourceEntry } from '@edt-ts/scheduler-common';
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
