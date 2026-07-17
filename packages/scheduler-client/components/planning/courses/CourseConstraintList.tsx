'use client';

import type { CourseTaskData, EnforcedData, ResourceGroupData } from '@edt-ts/scheduler-common';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { BlockedZone } from '@/lib/calendar/blockedZones';
import type { SchoolYearConfig } from '@/lib/schoolHolidays';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import CourseCard from '@/components/planning/courses/CourseCard';
import ResourceLoadPopover from '@/components/planning/courses/ResourceLoadPopover';
import { buildPreparationLoadRows } from '@/lib/resourceLoadAnalysis';
import type { TaskConstraintInfo, ConstraintLevel } from '@/lib/taskConstraintAnalysis';

const LEVEL_CONFIG: Record<ConstraintLevel, { label: string; className: string }> = {
  critical: { label: '🔴 Critique', className: 'text-red-600 dark:text-red-400' },
  tight: { label: '🟠 Tendu', className: 'text-orange-500 dark:text-orange-400' },
  ok: { label: '🟢 OK', className: 'text-green-600 dark:text-green-400' },
};

interface Props {
  taskInfos: TaskConstraintInfo[];
  enforcedMap: Record<string, EnforcedData>;
  onEditCourse?: (courseKey: string, course: CourseTaskDataWithId) => void;
  onDuplicateCourse?: (course: CourseTaskData) => void;
  onDeleteCourse?: (courseId: string) => void;
  /** Analyse de charge (P2-Explication §2) : présent uniquement si le contexte le permet. */
  loadAnalysisContext?: {
    availabilityManager: AvailabilityManager;
    selectedWeek: number;
    resources: ResourceGroupData[];
    blockedZones: BlockedZone[];
    schoolYearConfig: SchoolYearConfig | null;
  };
}

export default function CourseConstraintList({
  taskInfos,
  enforcedMap,
  onEditCourse,
  onDuplicateCourse,
  onDeleteCourse,
  loadAnalysisContext,
}: Props) {
  const levels: ConstraintLevel[] = ['critical', 'tight', 'ok'];
  const groups = levels
    .map(level => ({
      level,
      items: taskInfos
        .filter(t => t.level === level)
        .sort((a, b) => b.fillRatio - a.fillRatio),
    }))
    .filter(g => g.items.length > 0);

  const weekCourses = taskInfos.map(t => t.course);
  const enforcedByCourseId = new Map(Object.entries(enforcedMap));

  return (
    <div className="flex flex-col gap-1">
      {groups.map(({ level, items }) => (
        <div key={level} className="flex flex-col gap-1">
          <p className={`text-xs font-semibold px-1 mt-1 ${LEVEL_CONFIG[level].className}`}>
            {LEVEL_CONFIG[level].label} ({items.length})
          </p>
          {items.map(({ courseKey, course, reasons }) => (
            <div key={courseKey} className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <CourseCard
                      courseKey={courseKey}
                      course={course}
                      enforced={enforcedMap[courseKey] !== undefined}
                      onEdit={onEditCourse ? () => onEditCourse(courseKey, course) : undefined}
                      onDuplicate={onDuplicateCourse ? () => onDuplicateCourse(course) : undefined}
                      onDelete={onDeleteCourse ? () => onDeleteCourse(courseKey) : undefined}
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
              {loadAnalysisContext && (
                <div className="absolute top-1 right-1">
                  <ResourceLoadPopover
                    mode="preparation"
                    rows={buildPreparationLoadRows(
                      course,
                      weekCourses,
                      enforcedByCourseId,
                      (c) => (c as CourseTaskDataWithId).id,
                      loadAnalysisContext.availabilityManager,
                      loadAnalysisContext.selectedWeek,
                      loadAnalysisContext.resources,
                      loadAnalysisContext.blockedZones,
                      loadAnalysisContext.schoolYearConfig,
                    )}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
