'use client';

import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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
    <Card
      data-course-key={courseKey}
      data-title={`${course.code} ${course.type}`}
      data-duration={course.duration}
      className={`text-xs select-none transition-all cursor-grab active:cursor-grabbing ${
        enforced
          ? 'opacity-70 cursor-default border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950'
          : 'hover:border-blue-400 hover:shadow-sm'
      }`}
    >
      <CardContent className="">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="font-bold text-card-foreground truncate">
            {course.code}{' '}
            <span className="font-normal text-muted-foreground">{course.type}</span>
          </span>
          <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
            {course.duration}min
          </Badge>
        </div>
        <div className="truncate text-foreground/70 mb-0.5">{course.name}</div>
        {teacherStr && (
          <div className="truncate text-muted-foreground">{teacherStr}</div>
        )}
        {groupsStr && (
          <div className="truncate text-muted-foreground/70">{groupsStr}</div>
        )}
        {enforced && (
          <div className="mt-1 text-green-600 dark:text-green-400 font-medium">📌 Imposé</div>
        )}
      </CardContent>
    </Card>
  );
}
