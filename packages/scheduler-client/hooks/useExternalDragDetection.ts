'use client';

import { useEffect, useRef } from 'react';
import { usePlanningStore } from '@/store/usePlanningStore';
import type { DraggingResources } from '@/store/usePlanningStore';

/**
 * Détecte le début d'un drag externe (depuis un conteneur non-calendrier)
 * et met à jour `draggingExternal` dans usePlanningStore pour la colorisation
 * des conflits en temps réel.
 *
 * @param container  L'élément HTML contenant les items draggables
 * @param getResources  Callback appelé au pointerdown sur un item draggable ;
 *                      retourne les ressources du cours/tâche ou null si l'élément
 *                      n'est pas un item draggable.
 */
export function useExternalDragDetection(
  container: HTMLDivElement | null,
  getResources: (el: HTMLElement) => DraggingResources | null,
): void {
  const setDraggingExternal = usePlanningStore((s) => s.setDraggingExternal);
  const pendingRef = useRef<(DraggingResources & { isDragging: boolean }) | null>(null);

  useEffect(() => {
    if (!container) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest('[data-course-key],[data-task-id]') as HTMLElement | null;
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
  }, [container, getResources, setDraggingExternal]);
}
