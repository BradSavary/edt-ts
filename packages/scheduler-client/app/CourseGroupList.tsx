'use client';

import { useState, useMemo, useEffect } from 'react';
import type { CourseTaskData, ResourceEntry, EnforcedData } from '@edt-ts/scheduler-common';
import CourseCard from './CourseCard';

export type GroupBy = 'code' | 'teacher';

interface Props {
  courses: CourseTaskData[];
  groupBy: GroupBy;
  enforcedMap: Record<string, EnforcedData>;
}

function getTeacherLabel(teacher: ResourceEntry[]): string {
  if (!teacher || teacher.length === 0) return 'Sans enseignant';
  const first = teacher[0];
  if (Array.isArray(first)) return first[0] ?? 'Sans enseignant';
  return first;
}

export default function CourseGroupList({ courses, groupBy, enforcedMap }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, { index: number; course: CourseTaskData }[]>();
    courses.forEach((course, i) => {
      const key = groupBy === 'code' ? course.code : getTeacherLabel(course.teacher);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ index: i, course });
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'fr'));
  }, [courses, groupBy]);

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // Ferme tous les groupes au changement de tab
  useEffect(() => {
    setOpenGroups(new Set());
  }, [groupBy]);

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {groups.map(([key, items]) => (
        <div key={key}>
          <button
            type="button"
            onClick={() => toggleGroup(key)}
            className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-left text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-zinc-800 rounded hover:bg-gray-200 dark:hover:bg-zinc-700 transition"
          >
            <span className="truncate">{key}</span>
            <span className="flex items-center gap-1.5 shrink-0 text-gray-400 dark:text-gray-500">
              <span>{items.length}</span>
              <span className="text-[10px]">{openGroups.has(key) ? '▲' : '▼'}</span>
            </span>
          </button>
          {openGroups.has(key) && (
            <div className="flex flex-col gap-1 mt-1 pl-2 border-l-2 border-gray-200 dark:border-zinc-700">
              {items.map(({ index, course }) => (
                <CourseCard
                  key={index}
                  courseKey={String(index)}
                  course={course}
                  enforced={enforcedMap[String(index)] !== undefined}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
