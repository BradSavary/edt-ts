'use client';

import { useEffect } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';
import { usePlanningStore } from '@/store/usePlanningStore';

interface UseNeutralizedDraggableOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  neutralizedTasks: TaskSolutionJSON[] | undefined;
}

/**
 * Initialise le FullCalendar Draggable sur le conteneur des tâches neutralisées
 * et met à jour draggingExternal dans usePlanningStore pour la détection de conflits.
 */
export function useNeutralizedDraggable({
  containerRef,
  neutralizedTasks,
}: UseNeutralizedDraggableOptions): void {
  const setDraggingExternal = usePlanningStore((s) => s.setDraggingExternal);

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

    let pendingDrag: { teachers: string[]; groups: string[]; rooms: string[] } | null = null;
    let isDragging = false;

    function onPointerDown(e: PointerEvent) {
      const el = (e.target as HTMLElement).closest('[data-task-id]') as HTMLElement | null;
      if (!el) return;
      if (!el.getAttribute('data-task-id')) return;
      try {
        const teachers = JSON.parse(el.getAttribute('data-teachers') ?? '[]') as string[];
        const groups = JSON.parse(el.getAttribute('data-groups') ?? '[]') as string[];
        const rooms = JSON.parse(el.getAttribute('data-rooms') ?? '[]') as string[];
        pendingDrag = { teachers, groups, rooms };
        isDragging = false;
      } catch { /* ignore */ }
    }

    function onPointerMove(e: PointerEvent) {
      if (!pendingDrag || isDragging) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) {
        isDragging = true;
        setDraggingExternal(pendingDrag);
      }
    }

    function onPointerUp() {
      pendingDrag = null;
      isDragging = false;
      setDraggingExternal(null);
    }

    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [containerRef, neutralizedTasks, setDraggingExternal]);
}
