'use client';

import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { usePlanningStore } from '@/store/usePlanningStore';
import { getCourseGroupInfo } from '@/lib/taskGroupUtils';
import TaskCard from '@/components/planning/courses/TaskCard';
import { normalizeResourceEntries } from '@/lib/taskCardUtils';

interface Props {
  courseKey: string;
  course: CourseTaskData;
  enforced: boolean;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

export default function CourseCard({ courseKey, course, enforced, onEdit, onDuplicate, onDelete }: Props) {
  const taskGroups = usePlanningStore((s) => s.taskGroups);
  const unplaced = usePlanningStore((s) => s.unplaced);
  const togglePreNeutralized = usePlanningStore((s) => s.togglePreNeutralized);
  const groupInfo = getCourseGroupInfo(taskGroups, courseKey);
  const isNeutralized = unplaced.some((u) => u.taskId === courseKey && u.origin === 'user-pre');

  return (
    <TaskCard
      code={course.code}
      type={course.type}
      name={course.name}
      duration={course.duration}
      teachers={normalizeResourceEntries(course.teacher)}
      groups={normalizeResourceEntries(course.groups)}
      rooms={normalizeResourceEntries(course.rooms ?? [])}
      comment={course.comment}
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
