'use client';

import type { CourseTaskDataWithId } from '@/lib/courseId';
import { usePlanningStore } from '@/store/usePlanningStore';
import { SidebarPreparation } from '@/components/planning/sidebar/SidebarPreparation';
import { SidebarAnalysis } from '@/components/planning/sidebar/SidebarAnalysis';

interface SidebarLeftProps {
  parsedCourses: CourseTaskDataWithId[];
}

export function SidebarLeft({ parsedCourses }: SidebarLeftProps) {
  const scheduleResult = usePlanningStore((s) => s.scheduleResult);
  if (scheduleResult) return <SidebarAnalysis />;
  return <SidebarPreparation parsedCourses={parsedCourses} />;
}


