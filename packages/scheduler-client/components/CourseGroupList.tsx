'use client';

import { useState, useMemo, useEffect } from 'react';
import type { CourseTaskData, ResourceEntry, EnforcedData } from '@edt-ts/scheduler-common';
import { Button } from '@/components/ui/button';
import CourseCard from '@/components/CourseCard';

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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => toggleGroup(key)}
            className="w-full flex items-center justify-between px-2 py-1.5 h-auto text-xs font-semibold text-left rounded bg-muted hover:bg-muted/80"
          >
            <span className="truncate">{key}</span>
            <span className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
              <span>{items.length}</span>
              <span className="text-[10px]">{openGroups.has(key) ? '▲' : '▼'}</span>
            </span>
          </Button>
          {openGroups.has(key) && (
            <div className="flex flex-col gap-1 mt-1 pl-2 border-l-2 border-border">
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
