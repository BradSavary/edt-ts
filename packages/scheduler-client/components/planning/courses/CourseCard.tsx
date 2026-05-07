'use client';

import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';
import { usePlanningStore } from '@/store/usePlanningStore';
import { getCourseGroupInfo } from '@/lib/taskGroupUtils';
import TaskCard from '@/components/planning/courses/TaskCard';

interface Props {
  courseKey: string;
  course: CourseTaskData;
  enforced: boolean;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

function normalizeEntries(entries: ResourceEntry[]): string[] {
  return entries.map((e) => (Array.isArray(e) ? e.join(' | ') : e));
}

export default function CourseCard({ courseKey, course, enforced, onEdit, onDuplicate, onDelete }: Props) {
  const taskGroups = usePlanningStore((s) => s.taskGroups);
  const preNeutralizedKeys = usePlanningStore((s) => s.preNeutralizedKeys);
  const togglePreNeutralized = usePlanningStore((s) => s.togglePreNeutralized);
  const groupInfo = getCourseGroupInfo(taskGroups, courseKey);
  const isNeutralized = preNeutralizedKeys.includes(courseKey);

  return (
    <TaskCard
      code={course.code}
      type={course.type}
      name={course.name}
      duration={course.duration}
      teachers={normalizeEntries(course.teacher)}
      groups={normalizeEntries(course.groups)}
      rooms={normalizeEntries(course.rooms ?? [])}
      isNeutralized={isNeutralized}
      isEnforced={enforced}
      groupInfo={groupInfo}
      courseKey={courseKey}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      onToggleNeutralize={() => togglePreNeutralized(courseKey)}
      neutralizeLabel={isNeutralized ? 'Retirer la neutralisation' : 'Neutraliser'}
    />
  );
}
