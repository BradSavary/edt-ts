'use client';

import { useCallback, useEffect } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { useExternalDragDetection } from '@/hooks/useExternalDragDetection';
import type { DraggingResources } from '@/store/usePlanningStore';

interface UseSidebarCourseDragOptions {
  container: HTMLDivElement | null;
  courses: CourseTaskData[];
}

/**
 * Initialise le FullCalendar Draggable sur le conteneur de cards de cours
 * et met à jour draggingExternal dans usePlanningStore pour la mise en évidence des contraintes.
 */
export function useSidebarCourseDrag({
  container,
  courses,
}: UseSidebarCourseDragOptions): void {
  // FullCalendar Draggable pour les cards de cours
  useEffect(() => {
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
  }, [container, courses]);

  // Détecte le drag pour la colorisation de conflits en temps réel
  const getResources = useCallback((el: HTMLElement): DraggingResources | null => {
    const courseKey = el.getAttribute('data-course-key');
    if (!courseKey) return null;
    const course = courses[parseInt(courseKey, 10)];
    if (!course) return null;
    return {
      teachers: course.teacher.flatMap((r) => (Array.isArray(r) ? r : [r])),
      groups: course.groups.flatMap((r) => (Array.isArray(r) ? r : [r])),
      rooms: course.rooms.flatMap((r) => (Array.isArray(r) ? r : [r])),
      courseKey,
    };
  }, [courses]);

  useExternalDragDetection(container, getResources);
}
