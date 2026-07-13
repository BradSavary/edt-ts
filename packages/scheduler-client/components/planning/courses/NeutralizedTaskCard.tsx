'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import TaskCard from '@/components/planning/courses/TaskCard';
import type { TaskCardBaseProps } from '@/lib/taskCardUtils';

interface NeutralizedTaskCardProps extends TaskCardBaseProps {
  taskId: string;
  /** Contenu du tooltip (affiché à droite). Absent = pas de tooltip. */
  tooltipContent?: string;
  /** Répartition automatique de l'Autonomie dans les créneaux libres. */
  onDistribute?: () => void;
  distributeLabel?: string;
  dragEnabled?: boolean;
}

export default function NeutralizedTaskCard({
  tooltipContent,
  taskId,
  onDistribute,
  distributeLabel,
  dragEnabled,
  ...baseProps
}: NeutralizedTaskCardProps) {
  const card = (
    <TaskCard
      {...baseProps}
      taskId={taskId}
      onDistribute={onDistribute}
      distributeLabel={distributeLabel}
      dragEnabled={dragEnabled}
    />
  );

  if (!tooltipContent) return card;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>{card}</div>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        className="max-w-72 whitespace-pre-line bg-background text-foreground border shadow-md"
      >
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}
