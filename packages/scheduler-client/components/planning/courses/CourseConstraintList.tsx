'use client';

import { useState } from 'react';

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
  impossible: { label: '⛔ Impossible', className: 'text-red-700 dark:text-red-300 font-bold' },
  critical: { label: '🔴 Critique', className: 'text-red-600 dark:text-red-400' },
  tight: { label: '🟠 Tendu', className: 'text-orange-500 dark:text-orange-400' },
  ok: { label: '🟢 OK', className: 'text-green-600 dark:text-green-400' },
};

/**
 * Légende par niveau : les deux échelles cohabitant dans la liste ne mesurent pas la même chose,
 * une phrase globale mentirait sur la moitié des cours (§4.3 du plan).
 */
const LEVEL_HINT: Partial<Record<ConstraintLevel, string>> = {
  impossible: 'Aucun créneau ne convient, imposés déjà posés déduits. Verdict exact — et contextuel : il change si vous déplacez une imposition.',
  critical: 'Estimation de volume, basée sur les seules disponibilités des enseignants.',
  tight: 'Estimation de volume, basée sur les seules disponibilités des enseignants.',
};

/** Seule la section `ok` est repliée par défaut — sinon « Attention » coifferait surtout des cours sans problème. */
const COLLAPSED_BY_DEFAULT: ConstraintLevel[] = ['ok'];

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
  const levels: ConstraintLevel[] = ['impossible', 'critical', 'tight', 'ok'];
  const [collapsed, setCollapsed] = useState<Set<ConstraintLevel>>(new Set(COLLAPSED_BY_DEFAULT));
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
          <button
            type="button"
            onClick={() => setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(level)) next.delete(level); else next.add(level);
              return next;
            })}
            className={`text-xs font-semibold px-1 mt-1 text-left flex items-center gap-1 ${LEVEL_CONFIG[level].className}`}
          >
            <span className="inline-block w-2 text-muted-foreground">{collapsed.has(level) ? '▸' : '▾'}</span>
            {LEVEL_CONFIG[level].label} ({items.length})
          </button>
          {!collapsed.has(level) && LEVEL_HINT[level] && (
            <p className="text-[10px] text-muted-foreground italic px-1">{LEVEL_HINT[level]}</p>
          )}
          {!collapsed.has(level) && items.map(({ courseKey, course, reasons }) => (
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
