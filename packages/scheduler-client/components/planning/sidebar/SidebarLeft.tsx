'use client';

import type { CourseTaskDataWithId } from '@/lib/courseId';
import { usePlanningStore } from '@/store/usePlanningStore';
import { SidebarPreparation } from '@/components/planning/sidebar/SidebarPreparation';
import { SidebarAnalysis } from '@/components/planning/sidebar/SidebarAnalysis';

interface SidebarLeftProps {
  parsedCourses: CourseTaskDataWithId[];
}

export function SidebarLeft({ parsedCourses }: SidebarLeftProps) {
  // `lastRun` (persisté) plutôt que `scheduleResult` (session uniquement) : la bascule doit
  // survivre au rechargement de page (§4.6 du plan).
  const lastRun = usePlanningStore((s) => s.lastRun);
  if (lastRun !== null) return <SidebarAnalysis />;
  return <SidebarPreparation parsedCourses={parsedCourses} />;
}


