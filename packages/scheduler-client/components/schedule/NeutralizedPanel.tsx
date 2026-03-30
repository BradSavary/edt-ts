'use client';

import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';

interface NeutralizedPanelProps {
  tasks: TaskSolutionJSON[];
  placedNeutralizedIds: Set<string>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function NeutralizedPanel({ tasks, placedNeutralizedIds, containerRef }: NeutralizedPanelProps) {
  const unplacedCount = tasks.filter((t) => !placedNeutralizedIds.has(t.taskId)).length;

  return (
    <aside className="w-64 shrink-0 bg-amber-50 dark:bg-amber-950/20 border-l border-amber-200 dark:border-amber-900 p-3 overflow-y-auto flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1">
        Non placés ({unplacedCount})
      </p>
      <p className="text-xs text-amber-600 dark:text-amber-500 italic">
        Glissez un cours sur le calendrier pour le placer.
      </p>
      <div ref={containerRef} className="flex flex-col gap-2">
        {tasks.map((task) => {
          const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
          const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id);
          const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id);
          const isPlaced = placedNeutralizedIds.has(task.taskId);
          return (
            <div
              key={task.taskId}
              data-task-id={!isPlaced ? task.taskId : undefined}
              data-title={`${task.code} ${task.type}`}
              data-duration={task.duration}
              data-teachers={JSON.stringify(teachers)}
              data-groups={JSON.stringify(groups)}
              data-rooms={JSON.stringify(rooms)}
              data-code={task.code}
              data-name={task.name}
              data-type={task.type}
              className={`p-2 rounded-lg border border-amber-200 dark:border-amber-800 text-xs transition-all ${
                isPlaced
                  ? 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700 opacity-60'
                  : 'bg-amber-100/60 dark:bg-amber-900/30 cursor-grab active:cursor-grabbing hover:border-amber-400 hover:shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <span className="font-bold text-amber-900 dark:text-amber-200 truncate">
                  {task.code}{' '}
                  <span className="font-normal text-amber-600 dark:text-amber-400">{task.type}</span>
                </span>
                <span className="text-amber-500 dark:text-amber-500 shrink-0">{task.duration}min</span>
              </div>
              <div className="truncate text-amber-800 dark:text-amber-300 mb-0.5">{task.name}</div>
              {teachers.length > 0 && (
                <div className="truncate text-amber-600 dark:text-amber-400">{teachers.join(', ')}</div>
              )}
              {groups.length > 0 && (
                <div className="truncate text-amber-500 dark:text-amber-500">{groups.join(', ')}</div>
              )}
              {isPlaced && (
                <div className="mt-1 text-green-600 dark:text-green-400 font-medium">✅ Placé</div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
