'use client';

import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePlanningStore } from '@/store/usePlanningStore';
import { getCourseGroupInfo } from '@/lib/taskGroupUtils';

interface Props {
  courseKey: string;
  course: CourseTaskData;
  enforced: boolean;
  onEdit?: () => void;
}

function formatEntries(entries: ResourceEntry[]): string {
  return entries
    .map((e) => (Array.isArray(e) ? e.join(' | ') : e))
    .join(', ');
}

export default function CourseCard({ courseKey, course, enforced, onEdit }: Props) {
  const teacherStr = formatEntries(course.teacher);
  const groupsStr = formatEntries(course.groups);
  const MAX_ROOMS = 2;
  const roomsStr = course.rooms && course.rooms.length > 0
    ? course.rooms.slice(0, MAX_ROOMS).map((e) => (Array.isArray(e) ? e.join(' | ') : e)).join(', ') +
      (course.rooms.length > MAX_ROOMS ? ', …' : '')
    : '';
  const taskGroups = usePlanningStore((s) => s.taskGroups);
  const preNeutralizedKeys = usePlanningStore((s) => s.preNeutralizedKeys);
  const togglePreNeutralized = usePlanningStore((s) => s.togglePreNeutralized);
  const groupInfo = getCourseGroupInfo(taskGroups, courseKey);
  const isNeutralized = preNeutralizedKeys.includes(courseKey);

  return (
    <Card
      data-course-key={!isNeutralized && !enforced ? courseKey : undefined}
      data-title={`${course.code} ${course.type}`}
      data-duration={course.duration}
      className={`text-xs select-none transition-all ${
        isNeutralized
          ? 'opacity-50 border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950 cursor-default'
          : enforced
          ? 'opacity-70 cursor-default border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950'
          : groupInfo
          ? 'cursor-grab active:cursor-grabbing border-violet-300 dark:border-violet-700 hover:border-violet-400 hover:shadow-sm'
          : 'cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-sm'
      }`}
    >
      <CardContent className="">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="font-bold text-card-foreground truncate">
            {course.code}{' '}
            <span className="font-normal text-muted-foreground">{course.type}</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); togglePreNeutralized(courseKey); }}
              className={`text-[11px] px-1 transition-colors ${
                isNeutralized
                  ? 'text-orange-500 hover:text-orange-700 dark:text-orange-400'
                  : 'text-muted-foreground hover:text-orange-500'
              }`}
              title={isNeutralized ? 'Retirer de la neutralisation' : 'Neutraliser cette tâche'}
            >
              ⊘
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="text-muted-foreground hover:text-foreground text-[11px] px-1 rotate-135"
                title="Modifier les ressources"
              >
                ✏
              </button>
            )}
            {groupInfo && (
              <Badge
                variant="outline"
                className="text-[10px] px-1 py-0 border-violet-400 text-violet-600 dark:text-violet-400"
              >
                {groupInfo.type === 'parallel' ? '∥' : '→'}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {course.duration}min
            </Badge>
          </div>
        </div>
        <div className="truncate text-foreground/70 mb-0.5">{course.name}</div>
        {teacherStr && (
          <div className="truncate text-muted-foreground">{teacherStr}</div>
        )}
        {groupsStr && (
          <div className="truncate text-muted-foreground/70">{groupsStr}</div>
        )}
        {roomsStr ? (
          <div className="truncate text-muted-foreground/60 italic">{roomsStr}</div>
        ) : (
          <div className="truncate text-red-400/70 dark:text-red-500/70 italic text-[10px]">Pas de salle par défaut</div>
        )}
        {!teacherStr && (
          <div className="truncate text-red-400/70 dark:text-red-500/70 italic text-[10px]">Pas d&apos;enseignant par défaut</div>
        )}
        {enforced && (
          <div className="mt-1 text-green-600 dark:text-green-400 font-medium">📌 Imposé</div>
        )}
        {isNeutralized && (
          <div className="mt-1 text-orange-500 dark:text-orange-400 font-medium text-[10px]">⊘ Neutralisée</div>
        )}
      </CardContent>
    </Card>
  );
}

