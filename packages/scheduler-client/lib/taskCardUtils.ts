import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';
import type { TaskCardProps } from '@/components/planning/courses/TaskCard';

export type TaskCardBaseProps = Pick<
  TaskCardProps,
  'code' | 'type' | 'name' | 'duration' | 'teachers' | 'groups' | 'rooms' | 'comment'
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
    comment: course.comment,
  };
}

