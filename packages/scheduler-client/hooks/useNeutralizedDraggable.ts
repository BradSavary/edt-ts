'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import { usePlanningStore } from '@/store/usePlanningStore';
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
  const setDraggingExternal = usePlanningStore((s) => s.setDraggingExternal);
  const pendingRef = useRef<(DraggingResources & { isDragging: boolean }) | null>(null);

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

  // Inline de la détection externe : lit containerRef.current DANS l'effet
  // (pas au moment du rendu où la ref vaut encore null)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest('[data-task-id]') as HTMLElement | null;
      if (!el) return;
      const resources = getResources(el);
      if (!resources) return;
      pendingRef.current = { ...resources, isDragging: false };
    };

    const onPointerMove = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending || pending.isDragging) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) {
        pending.isDragging = true;
        const { isDragging: _, ...resources } = pending;
        setDraggingExternal(resources);
      }
    };

    const onPointerUp = () => {
      pendingRef.current = null;
      setDraggingExternal(null);
    };

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
  }, [containerRef, hasItems, getResources, setDraggingExternal]);
}
