'use client';

import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { usePlanningStore } from '@/store/usePlanningStore';
import { SidebarPreparation } from '@/components/planning/SidebarPreparation';
import { SidebarAnalysis } from '@/components/planning/SidebarAnalysis';

interface SidebarLeftProps {
  parsedCourses: CourseTaskData[];
}

export function SidebarLeft({ parsedCourses }: SidebarLeftProps) {
  const scheduleResult = usePlanningStore((s) => s.scheduleResult);
  if (scheduleResult) return <SidebarAnalysis />;
  return <SidebarPreparation parsedCourses={parsedCourses} />;
}


