'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import TaskCard from '@/components/planning/courses/TaskCard';
import type { TaskCardBaseProps } from '@/lib/taskCardUtils';

interface NeutralizedTaskCardProps extends TaskCardBaseProps {
  taskId: string;
  /** Contenu du tooltip (affiché à droite). Absent = pas de tooltip. */
  tooltipContent?: string;
}

export default function NeutralizedTaskCard({
  tooltipContent,
  taskId,
  ...baseProps
}: NeutralizedTaskCardProps) {
  const card = <TaskCard {...baseProps} taskId={taskId} />;

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
