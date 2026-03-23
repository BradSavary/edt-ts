'use client';

import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';

interface Props {
  courseKey: string;
  course: CourseTaskData;
  enforced: boolean;
}

function formatEntries(entries: ResourceEntry[]): string {
  return entries
    .map((e) => (Array.isArray(e) ? e.join(' | ') : e))
    .join(', ');
}

export default function CourseCard({ courseKey, course, enforced }: Props) {
  const teacherStr = formatEntries(course.teacher);
  const groupsStr = formatEntries(course.groups);

  return (
    <div
      data-course-key={courseKey}
      data-title={`${course.code} ${course.type}`}
      data-duration={course.duration}
      className={`p-2 rounded-lg border text-xs select-none transition-all ${
        enforced
          ? 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700 opacity-70 cursor-default'
          : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-600 hover:border-blue-400 hover:shadow-sm cursor-grab active:cursor-grabbing'
      }`}
    >
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className="font-bold text-gray-900 dark:text-white truncate">
          {course.code}{' '}
          <span className="font-normal text-gray-500 dark:text-gray-400">{course.type}</span>
        </span>
        <span className="text-gray-400 dark:text-gray-500 shrink-0">{course.duration}min</span>
      </div>
      <div className="truncate text-gray-600 dark:text-gray-300 mb-0.5">{course.name}</div>
      {teacherStr && (
        <div className="truncate text-gray-500 dark:text-gray-400">{teacherStr}</div>
      )}
      {groupsStr && (
        <div className="truncate text-gray-400 dark:text-gray-500">{groupsStr}</div>
      )}
      {enforced && (
        <div className="mt-1 text-green-600 dark:text-green-400 font-medium">📌 Imposé</div>
      )}
    </div>
  );
}
