'use client';

import { useEffect, useRef } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import type { CourseTaskData } from '@edt-ts/scheduler-common';

interface DraggingResources {
  teachers: string[];
  groups: string[];
  rooms: string[];
}

interface UseSidebarCourseDragOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  courses: CourseTaskData[];
  onDragStart: (resources: DraggingResources) => void;
  onDragEnd: () => void;
}

/**
 * Initialise le FullCalendar Draggable sur le conteneur de cards de cours
 * et expose les callbacks de début/fin de drag pour la mise en évidence des contraintes.
 */
export function useSidebarCourseDrag({
  containerRef,
  courses,
  onDragStart,
  onDragEnd,
}: UseSidebarCourseDragOptions): void {
  const pendingRef = useRef<(DraggingResources & { isDragging: boolean }) | null>(null);

  // FullCalendar Draggable pour les cards de cours
  useEffect(() => {
    const container = containerRef.current;
    if (!container || courses.length === 0) return;

    const draggable = new Draggable(container, {
      itemSelector: '[data-course-key]',
      eventData: (el) => ({
        title: el.getAttribute('data-title') ?? '',
        duration: { minutes: parseInt(el.getAttribute('data-duration') ?? '60', 10) },
        extendedProps: { courseKey: el.getAttribute('data-course-key') ?? '' },
      }),
    });

    return () => draggable.destroy();
  }, [containerRef, courses]);

  // Détecte le drag pour la mise en évidence des contraintes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerDown = (e: PointerEvent) => {
      const card = (e.target as Element).closest('[data-course-key]');
      if (!card) return;
      const courseKey = card.getAttribute('data-course-key');
      if (!courseKey) return;
      const course = courses[parseInt(courseKey, 10)];
      if (!course) return;
      pendingRef.current = {
        teachers: course.teacher.flatMap((r) => (Array.isArray(r) ? r : [r])),
        groups: course.groups.flatMap((r) => (Array.isArray(r) ? r : [r])),
        rooms: course.rooms.flatMap((r) => (Array.isArray(r) ? r : [r])),
        isDragging: false,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending || pending.isDragging) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) {
        pending.isDragging = true;
        onDragStart({ teachers: pending.teachers, groups: pending.groups, rooms: pending.rooms });
      }
    };

    const onPointerUp = () => {
      pendingRef.current = null;
      onDragEnd();
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
  }, [containerRef, courses, onDragStart, onDragEnd]);
}
