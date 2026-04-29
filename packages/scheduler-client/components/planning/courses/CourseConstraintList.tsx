'use client';

import type { CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import CourseCard from '@/components/planning/courses/CourseCard';
import type { TaskConstraintInfo, ConstraintLevel } from '@/lib/taskConstraintAnalysis';

const LEVEL_CONFIG: Record<ConstraintLevel, { label: string; className: string }> = {
  critical: { label: '🔴 Critique', className: 'text-red-600 dark:text-red-400' },
  tight: { label: '🟠 Tendu', className: 'text-orange-500 dark:text-orange-400' },
  ok: { label: '🟢 OK', className: 'text-green-600 dark:text-green-400' },
};

interface Props {
  taskInfos: TaskConstraintInfo[];
  enforcedMap: Record<string, EnforcedData>;
  onEditCourse?: (courseKey: string, course: CourseTaskData) => void;
  onDuplicateCourse?: (course: CourseTaskData) => void;
  onDeleteCourse?: (index: number) => void;
}

export default function CourseConstraintList({
  taskInfos,
  enforcedMap,
  onEditCourse,
  onDuplicateCourse,
  onDeleteCourse,
}: Props) {
  const levels: ConstraintLevel[] = ['critical', 'tight', 'ok'];
  const groups = levels
    .map(level => ({ level, items: taskInfos.filter(t => t.level === level) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="flex flex-col gap-1">
      {groups.map(({ level, items }) => (
        <div key={level} className="flex flex-col gap-1">
          <p className={`text-xs font-semibold px-1 mt-1 ${LEVEL_CONFIG[level].className}`}>
            {LEVEL_CONFIG[level].label} ({items.length})
          </p>
          {items.map(({ courseKey, course, index, reasons }) => (
            <Tooltip key={courseKey}>
              <TooltipTrigger asChild>
                <div>
                  <CourseCard
                    courseKey={courseKey}
                    course={course}
                    enforced={enforcedMap[courseKey] !== undefined}
                    onEdit={onEditCourse ? () => onEditCourse(courseKey, course) : undefined}
                    onDuplicate={onDuplicateCourse ? () => onDuplicateCourse(course) : undefined}
                    onDelete={onDeleteCourse ? () => onDeleteCourse(index) : undefined}
                  />
                </div>
              </TooltipTrigger>
              {reasons.length > 0 && (
                <TooltipContent side="left" className="max-w-xs text-xs whitespace-pre-line bg-background text-foreground border shadow-md">
                  <ul className="space-y-0.5 list-disc list-inside">
                    {reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </TooltipContent>
              )}
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  );
}
