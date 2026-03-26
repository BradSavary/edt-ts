'use client';

import { useEffect } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';

interface UseNeutralizedDraggableOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  neutralizedTasks: TaskSolutionJSON[] | undefined;
  onExternalDragStart: (task: { id: string; teachers: string[]; groups: string[]; rooms: string[] }) => void;
  onExternalDragEnd: () => void;
}

/**
 * Initialise le FullCalendar Draggable sur le conteneur des tâches neutralisées
 * et expose les callbacks de début/fin de drag externe pour la détection de conflits.
 */
export function useNeutralizedDraggable({
  containerRef,
  neutralizedTasks,
  onExternalDragStart,
  onExternalDragEnd,
}: UseNeutralizedDraggableOptions): void {
  // FullCalendar Draggable
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !neutralizedTasks?.length) return;

    const draggable = new Draggable(container, {
      itemSelector: '[data-task-id]',
      eventData: (el) => ({
        title: el.getAttribute('data-title') ?? '',
        duration: { minutes: parseInt(el.getAttribute('data-duration') ?? '60', 10) },
        extendedProps: {
          isNeutralizedTask: true,
          taskId: el.getAttribute('data-task-id') ?? '',
          teachers: JSON.parse(el.getAttribute('data-teachers') ?? '[]') as string[],
          groups: JSON.parse(el.getAttribute('data-groups') ?? '[]') as string[],
          rooms: JSON.parse(el.getAttribute('data-rooms') ?? '[]') as string[],
          code: el.getAttribute('data-code') ?? '',
          name: el.getAttribute('data-name') ?? '',
          type: el.getAttribute('data-type') ?? '',
          durationMin: parseInt(el.getAttribute('data-duration') ?? '60', 10),
        },
      }),
    });

    return () => draggable.destroy();
  }, [containerRef, neutralizedTasks]);

  // Détection du drag externe pour la colorisation de conflits en temps réel
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleDragStart(e: DragEvent) {
      const el = (e.target as HTMLElement).closest('[data-task-id]') as HTMLElement | null;
      if (!el) return;
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;
      try {
        const teachers = JSON.parse(el.getAttribute('data-teachers') ?? '[]') as string[];
        const groups = JSON.parse(el.getAttribute('data-groups') ?? '[]') as string[];
        const rooms = JSON.parse(el.getAttribute('data-rooms') ?? '[]') as string[];
        onExternalDragStart({ id: taskId, teachers, groups, rooms });
      } catch { /* ignore */ }
    }

    container.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', onExternalDragEnd);
    return () => {
      container.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('dragend', onExternalDragEnd);
    };
  }, [containerRef, neutralizedTasks, onExternalDragStart, onExternalDragEnd]);
}
