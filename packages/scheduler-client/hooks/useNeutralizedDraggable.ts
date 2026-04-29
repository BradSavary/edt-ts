'use client';

import { useCallback, useEffect } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import { useExternalDragDetection } from '@/hooks/useExternalDragDetection';
import type { DraggingResources } from '@/store/usePlanningStore';

interface UseNeutralizedDraggableOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  hasItems: boolean;
}

/**
 * Initialise le FullCalendar Draggable sur le conteneur des tâches neutralisées
 * et met à jour draggingExternal dans usePlanningStore pour la détection de conflits.
 */
export function useNeutralizedDraggable({
  containerRef,
  hasItems,
}: UseNeutralizedDraggableOptions): void {
  // FullCalendar Draggable
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasItems) return;

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
  }, [containerRef, hasItems]);

  // Détection du drag externe pour la colorisation de conflits en temps réel
  const getResources = useCallback((el: HTMLElement): DraggingResources | null => {
    if (!el.getAttribute('data-task-id')) return null;
    try {
      return {
        teachers: JSON.parse(el.getAttribute('data-teachers') ?? '[]') as string[],
        groups: JSON.parse(el.getAttribute('data-groups') ?? '[]') as string[],
        rooms: JSON.parse(el.getAttribute('data-rooms') ?? '[]') as string[],
      };
    } catch {
      return null;
    }
  }, []);

  useExternalDragDetection(containerRef.current, getResources);
}
