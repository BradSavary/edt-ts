'use client';

import { usePlanningStore } from '@/store/usePlanningStore';

interface NeutralizedPanelProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function NeutralizedPanel({ containerRef }: NeutralizedPanelProps) {
  const tasks = usePlanningStore((s) => s.activeNeutralizedTasks);
  const placedNeutralizedTasks = usePlanningStore((s) => s.placedNeutralizedTasks);
  const unplacedCount = tasks.filter((t) => !placedNeutralizedTasks.some((p) => p.taskId === t.taskId)).length;

  return (
    <aside className="w-64 shrink-0 bg-red-50 dark:bg-red-950/20 border-l border-red-200 dark:border-red-900 p-3 overflow-y-auto flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-red-700 dark:text-red-400 mb-1">
        Non placés ({unplacedCount})
      </p>
      <p className="text-xs text-red-600 dark:text-red-500 italic">
        Glissez un cours sur le calendrier pour le placer.
      </p>
      <div ref={containerRef} className="flex flex-col gap-2">
        {tasks.map((task) => {
          const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
          const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id);
          const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id);
          const isPlaced = placedNeutralizedTasks.some((p) => p.taskId === task.taskId);
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
              className={`p-2 rounded-lg border border-red-200 dark:border-red-800 text-xs transition-all ${
                isPlaced
                  ? 'bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700 opacity-60'
                  : 'bg-red-100/60 dark:bg-red-900/30 cursor-grab active:cursor-grabbing hover:border-red-400 hover:shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <span className="font-bold text-red-900 dark:text-red-200 truncate">
                  {task.code}{' '}
                  <span className="font-normal text-red-600 dark:text-red-400">{task.type}</span>
                </span>
                <span className="text-red-500 dark:text-red-500 shrink-0">{task.duration}min</span>
              </div>
              <div className="truncate text-red-800 dark:text-red-300 mb-0.5">{task.name}</div>
              {teachers.length > 0 && (
                <div className="truncate text-red-600 dark:text-red-400">{teachers.join(', ')}</div>
              )}
              {groups.length > 0 && (
                <div className="truncate text-red-500 dark:text-red-500">{groups.join(', ')}</div>
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
