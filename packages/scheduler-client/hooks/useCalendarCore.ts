'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type FullCalendar from '@fullcalendar/react';
import type { EventApi, EventDropArg } from '@fullcalendar/core';
import type { EventReceiveArg, EventDragStopArg } from '@fullcalendar/interaction';
import type { EventClickArg } from '@fullcalendar/core';
import type { TaskSolutionJSON, CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { EnforceSelection } from '@/components/planning/modals/EnforceModal';
import type { TaskEditUpdate } from '@/components/planning/modals/TaskEditModal';
import { getMondayOfISOWeek, startTimeToDate, computeStaticConflicts, computeDragHighlights, computeConstraintViolation } from '@/lib/calendar/calendarUtils';
import type { ResourceEventInfo } from '@/lib/calendar/calendarUtils';
import { computeConstraintUnavailableZones, subtractDateZones } from '@/lib/calendar/blockedZones';
import { resolveCalendarYear } from '@/lib/schoolHolidays';
import { levelFromCode, getEventColors } from '@/lib/calendar/yearColors';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useProjectStore } from '@/store/useProjectStore';
import type { PendingDrop, PendingNeutralizedDrop, CalendarEventExtProps, CalendarEventData, DraggingState, PendingEditData } from '@/lib/calendar/types';

export type { PendingDrop, PendingNeutralizedDrop, CalendarEventExtProps, CalendarEventData, DraggingState, PendingEditData };

// ── Hook principal ─────────────────────────────────────────────────────────

export function useCalendarCore(solutions: TaskSolutionJSON[], parsedCourses: CourseTaskDataWithId[]) {
  // ── Store planning ──────────────────────────────────────────────────────
  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const week = selectedWeek ?? 1;
  const taskOverrides = usePlanningStore((s) => s.taskOverrides);
  const placedNeutralizedTasks = usePlanningStore((s) => s.placedNeutralizedTasks);
  const manuallyNeutralizedTasks = usePlanningStore((s) => s.manuallyNeutralizedTasks);
  const searchQuery = usePlanningStore((s) => s.searchQuery);
  const activeSolution = usePlanningStore((s) => s.activeSolution);
  const setTaskOverride = usePlanningStore((s) => s.setTaskOverride);
  const addPlacedNeutralizedTask = usePlanningStore((s) => s.addPlacedNeutralizedTask);
  const updatePlacedNeutralizedTask = usePlanningStore((s) => s.updatePlacedNeutralizedTask);
  const removePlacedNeutralizedTask = usePlanningStore((s) => s.removePlacedNeutralizedTask);
  const addManuallyNeutralizedTask = usePlanningStore((s) => s.addManuallyNeutralizedTask);
  const storeEnforcedMap = usePlanningStore((s) => s.enforcedMap);
  const enforcedViolations = usePlanningStore((s) => s.enforcedViolations);
  const setEnforcedViolation = usePlanningStore((s) => s.setEnforcedViolation);
  const handleEnforceChange = usePlanningStore((s) => s.handleEnforceChange);
  const blockedZones = usePlanningStore((s) => s.blockedZones);
  const handleBlockedZoneAdd = usePlanningStore((s) => s.handleBlockedZoneAdd);
  const handleBlockedZoneRemove = usePlanningStore((s) => s.handleBlockedZoneRemove);
  const handleBlockedZoneMove = usePlanningStore((s) => s.handleBlockedZoneMove);
  const externalDragging = usePlanningStore((s) => s.draggingExternal);

  const availabilityManager = useProjectStore((s) => s.availabilityManager);
  const resources = useProjectStore((s) => s.resources);
  const yearColorConfig = useProjectStore((s) => s.yearColorConfig);
  const schoolYearConfig = useProjectStore((s) => s.schoolYearConfig);

  const monday = useMemo(
    () => getMondayOfISOWeek(week, resolveCalendarYear(schoolYearConfig, week)),
    [week, schoolYearConfig],
  );

  // ── Options de ressources (pour les modals d'édition) ─────────────────
  const resourceOptions = useMemo(() => ({
    teacherOptions: resources.filter((g) => g.resourceType === 'teacher').flatMap((g) => g.resources.map((r) => r.id)),
    groupOptions: resources.filter((g) => g.resourceType === 'group').flatMap((g) => g.resources.map((r) => r.id)),
    roomOptions: resources.filter((g) => g.resourceType === 'room').flatMap((g) => g.resources.map((r) => r.id)),
  }), [resources]);

  // ── État local UI ──────────────────────────────────────────────────────
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEditData | null>(null);
  const [pendingNeutralizedDrop, setPendingNeutralizedDrop] = useState<PendingNeutralizedDrop | null>(null);
  const [dragging, setDragging] = useState<DraggingState | null>(null);

  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarWrapperRef = useRef<HTMLDivElement | null>(null);
  const pendingEventRef = useRef<EventApi | null>(null);

  // ── Map ID → cours (O(1) lookup) ──────────────────────────────────────
  const courseById = useMemo(
    () => new Map(parsedCourses.map((c) => [c.id, c])),
    [parsedCourses],
  );

  // ── Événements imposés dérivés ─────────────────────────────────────────
  const enforcedEventsState = useMemo<CalendarEventData[]>(() => {
    return Object.entries(storeEnforcedMap).map(([courseKey, enforced]) => {
      const course = courseById.get(courseKey);
      const teacherStr = enforced.teacher.join(', ');
      const title = [course?.code ?? '?', course?.type ?? '', teacherStr].filter(Boolean).join(' • ');
      const startDate = new Date(monday.getTime() + enforced.startTime * 60 * 1000);
      const endDate = new Date(startDate.getTime() + (course?.duration ?? 60) * 60 * 1000);
      const violation = enforcedViolations[courseKey];
      return {
        id: `enforced-${courseKey}`,
        title,
        start: startDate,
        end: endDate,
        ...getEventColors(levelFromCode(course?.code ?? ''), course?.type ?? '', yearColorConfig),
        extendedProps: {
          name: course?.name ?? '',
          code: course?.code ?? '',
          type: course?.type ?? '',
          teachers: enforced.teacher,
          groups: enforced.groups,
          rooms: enforced.rooms,
          durationMin: course?.duration ?? 0,
          isEnforced: true,
          courseKey,
          manuallyPlaced: (violation !== undefined && violation !== 'none') ? true : undefined,
          constraintViolation: violation,
        },
      };
    });
  }, [storeEnforcedMap, courseById, monday, yearColorConfig, enforcedViolations]);

  const prevParsedCoursesRef = useRef<CourseTaskData[]>(parsedCourses);
  const prevSelectedWeekRef = useRef<number | null>(selectedWeek);
  const skipNextParsedCoursesResetRef = useRef(false);
  const weekChangedRef = useRef(false);

  // Marque le flag quand la semaine change (setSelectedWeek gère déjà manualEnforcedMap)
  useEffect(() => {
    if (prevSelectedWeekRef.current !== selectedWeek) {
      prevSelectedWeekRef.current = selectedWeek;
      weekChangedRef.current = true;
    }
  }, [selectedWeek]);

  useEffect(() => {
    if (prevParsedCoursesRef.current !== parsedCourses) {
      const prev = prevParsedCoursesRef.current;
      prevParsedCoursesRef.current = parsedCourses;
      // Un ajout de cours (append) ne change pas les indices existants — pas de reset.
      const isAppendOnly =
        parsedCourses.length > prev.length &&
        prev.every((c, i) => parsedCourses[i] === c);
      // parsedCourses fusionne allCourses + weekSaves[week].manualCourses (getCoursesForWeek) :
      // un nouveau tableau est reconstruit à chaque changement de weekSaves, y compris quand
      // l'autosave de préparation de semaine réécrit weekSaves sans qu'aucun cours n'ait
      // réellement changé (ex: juste après ce même handleEnforceChange({}) plus bas). Sans ce
      // garde, ce rebuild "à contenu identique" serait pris pour un vrai changement et
      // redéclencherait handleEnforceChange({}) indéfiniment (boucle infinie).
      const sameContent =
        parsedCourses.length === prev.length &&
        prev.every((c, i) => parsedCourses[i] === c);
      if (skipNextParsedCoursesResetRef.current || weekChangedRef.current || isAppendOnly || sameContent) {
        skipNextParsedCoursesResetRef.current = false;
        weekChangedRef.current = false;
      } else {
        handleEnforceChange({});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedCourses]);

  // ── Handlers ──────────────────────────────────────────────────────────

  /** Retrouve le CourseTaskData original à partir du taskId (format: code_teachers_groups_counter). */
  function getCourseFromTaskId(taskId: string): import('@edt-ts/scheduler-common').CourseTaskData | null {
    if (taskId.startsWith('pre-neutral-')) return null;
    const parts = taskId.split('_');
    const counterStr = parts.at(-1);
    if (!counterStr) return null;
    const counter = parseInt(counterStr, 10);
    if (isNaN(counter) || counter < 1 || counter > parsedCourses.length) return null;
    return parsedCourses[counter - 1] ?? null;
  }

  function confirmEnforce(courseKey: string, enforced: EnforcedData, event: EventApi) {
    event.remove();
    const newMap = { ...usePlanningStore.getState().manualEnforcedMap, [courseKey]: enforced };
    handleEnforceChange(newMap);
  }

  function removeEnforced(courseKey: string) {
    const newMap = { ...usePlanningStore.getState().manualEnforcedMap };
    delete newMap[courseKey];
    handleEnforceChange(newMap);
  }

  function handleSelect(selectInfo: { start: Date; end: Date }) {
    handleBlockedZoneAdd(selectInfo.start, selectInfo.end);
    calendarRef.current?.getApi().unselect();
  }

  function handleDateClick(info: { date: Date }) {
    const clicked = info.date;
    const zone = blockedZones.find((z) => z.start <= clicked && z.end > clicked);
    if (zone) handleBlockedZoneRemove(zone.id);
  }

  function handleEventClick(arg: EventClickArg) {
    const ext = arg.event.extendedProps as CalendarEventExtProps;

    if (ext.isBlockedZone && ext.blockedZoneId) {
      handleBlockedZoneRemove(ext.blockedZoneId);
      return;
    }

    const startTime = arg.event.start
      ? Math.round((arg.event.start.getTime() - monday.getTime()) / 60000)
      : 0;

    setPendingEdit({
      taskId: arg.event.id,
      courseKey: ext.courseKey,
      title: arg.event.title,
      teachers: ext.teachers ?? [],
      groups: ext.groups ?? [],
      rooms: ext.rooms ?? [],
      startTime,
      durationMin: ext.durationMin ?? 0,
      isEnforced: ext.isEnforced,
      isNeutralizedPlaced: ext.isNeutralizedPlaced,
      showDuration: true,
      ...resourceOptions,
    });
  }

  function handleEventDragStart(info: { event: { id: string; extendedProps: unknown } }) {
    const ext = info.event.extendedProps as CalendarEventExtProps;
    if (ext.isBlockedZone) return;
    setDragging({
      id: info.event.id,
      teachers: ext.teachers ?? [],
      groups: ext.groups ?? [],
      rooms: ext.rooms ?? [],
    });
  }

  function handleReceiveNeutralizedTask(info: EventReceiveArg) {
    const ext = info.event.extendedProps as {
      taskId?: string;
      teachers?: string[];
      groups?: string[];
      rooms?: string[];
      durationMin?: number;
      code?: string;
      name?: string;
      type?: string;
    };
    const taskId = ext.taskId;
    const startDate = info.event.start;
    if (!startDate || !taskId) { info.event.remove(); return; }

    const teachers = ext.teachers ?? [];
    const groups = ext.groups ?? [];
    const rooms = ext.rooms ?? [];
    const durationMin = ext.durationMin ?? 60;
    const code = ext.code ?? '';
    const name = ext.name ?? '';
    const type = ext.type ?? '';
    const startTime = Math.round((startDate.getTime() - monday.getTime()) / 60000);

    info.event.remove();

    // Si le cours original a des alternatives de salle/enseignant, demander la sélection
    const originalCourse = getCourseFromTaskId(taskId);
    const hasAlts = originalCourse && [...originalCourse.teacher, ...originalCourse.rooms].some((e) => Array.isArray(e));
    // Si pas de cours original mais plusieurs rooms dans les candidats
    const hasMultipleRooms = !originalCourse && rooms.length > 1;

    if (originalCourse && hasAlts) {
      setPendingNeutralizedDrop({ taskId, code, name, type, startTime, durationMin, teachers, groups, rooms, course: originalCourse });
      return;
    }

    if (hasMultipleRooms) {
      // Construire un CourseTaskData synthétique pour réutiliser EnforceModal
      const syntheticCourse: import('@edt-ts/scheduler-common').CourseTaskData = {
        week: 0, semester: 0, level: 0, code, name, type, duration: durationMin,
        teacher: teachers,
        groups: groups,
        rooms: [rooms],
      };
      setPendingNeutralizedDrop({ taskId, code, name, type, startTime, durationMin, teachers, groups, rooms, course: syntheticCourse });
      return;
    }

    const violation = availabilityManager
      ? computeConstraintViolation(startTime, durationMin, teachers, groups, rooms, availabilityManager, week)
      : 'none';
    addPlacedNeutralizedTask({ taskId, code, name, type, startTime, duration: durationMin, teachers, groups, rooms, constraintViolation: violation });
  }

  function handleEventReceive(info: EventReceiveArg) {
    if (info.event.extendedProps.isNeutralizedTask) {
      handleReceiveNeutralizedTask(info);
      return;
    }
    const courseKey = info.event.extendedProps.courseKey as string;
    const startDate = info.event.start;
    if (!startDate || !courseKey) { info.event.remove(); return; }

    const course = courseById.get(courseKey);
    if (!course) { info.event.remove(); return; }

    const startTime = Math.round((startDate.getTime() - monday.getTime()) / 60000);
    const hasAlternatives = [...course.teacher, ...course.rooms].some((e) => Array.isArray(e));

    if (!hasAlternatives) {
      const teacher = course.teacher.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
      const groups = course.groups.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
      const rooms = course.rooms.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
      confirmEnforce(courseKey, { startTime, teacher, groups, rooms }, info.event);
    } else {
      pendingEventRef.current = info.event;
      setPendingDrop({ courseKey, startTime, course });
    }
  }

  function handleModalConfirm(sel: EnforceSelection) {
    const event = pendingEventRef.current;
    if (!event) return;
    confirmEnforce(sel.courseKey, {
      startTime: sel.startTime,
      teacher: sel.teacher,
      groups: sel.groups,
      rooms: sel.rooms,
    }, event);
    pendingEventRef.current = null;
    setPendingDrop(null);
  }

  function handleModalCancel() {
    pendingEventRef.current?.remove();
    pendingEventRef.current = null;
    setPendingDrop(null);
  }

  function handleNeutralizedPlaceConfirm(sel: EnforceSelection) {
    if (!pendingNeutralizedDrop) return;
    const violation = availabilityManager
      ? computeConstraintViolation(sel.startTime, pendingNeutralizedDrop.durationMin, sel.teacher, sel.groups, sel.rooms, availabilityManager, week)
      : 'none';
    addPlacedNeutralizedTask({
      taskId: pendingNeutralizedDrop.taskId,
      code: pendingNeutralizedDrop.code,
      name: pendingNeutralizedDrop.name,
      type: pendingNeutralizedDrop.type,
      startTime: sel.startTime,
      duration: pendingNeutralizedDrop.durationMin,
      teachers: sel.teacher,
      groups: sel.groups,
      rooms: sel.rooms,
      constraintViolation: violation,
    });
    setPendingNeutralizedDrop(null);
  }

  function handleNeutralizedPlaceCancel() {
    setPendingNeutralizedDrop(null);
  }

  function handleEditConfirm(update: TaskEditUpdate) {
    if (!pendingEdit) return;

    if (pendingEdit.isEnforced && pendingEdit.courseKey) {
      const courseKey = pendingEdit.courseKey;
      const state = usePlanningStore.getState();
      const existing = state.manualEnforcedMap[courseKey] ?? state.enforcedMap[courseKey];
      if (existing) {
        const updated: EnforcedData = { ...existing, teacher: update.teachers, groups: update.groups, rooms: update.rooms };
        const newMap = { ...state.manualEnforcedMap, [courseKey]: updated };
        handleEnforceChange({ ...newMap });
      }
    } else if (pendingEdit.isNeutralizedPlaced) {
      updatePlacedNeutralizedTask(pendingEdit.taskId, {
        teachers: update.teachers,
        groups: update.groups,
        rooms: update.rooms,
        ...(update.duration !== undefined ? { duration: update.duration } : {}),
      });
    } else {
      const taskId = pendingEdit.taskId;
      const existingOverride = taskOverrides[taskId];
      setTaskOverride(taskId, {
        startTime: existingOverride?.startTime ?? pendingEdit.startTime,
        teachers: update.teachers,
        groups: update.groups,
        rooms: update.rooms,
        ...(existingOverride?.constraintViolation !== undefined ? { constraintViolation: existingOverride.constraintViolation } : {}),
        ...(update.duration !== undefined ? { duration: update.duration } : (existingOverride?.duration !== undefined ? { duration: existingOverride.duration } : {})),
      });
    }

    // Mise à jour du cours pour que la CourseCard en sidebar reflète les changements
    if (pendingEdit.courseKey !== undefined) {
      const course = courseById.get(pendingEdit.courseKey);
      if (course) {
        const patch = {
          teacher: update.teachers as typeof course.teacher,
          groups: update.groups as typeof course.groups,
          rooms: update.rooms as typeof course.rooms,
          ...(update.duration !== undefined ? { duration: update.duration } : {}),
        };
        skipNextParsedCoursesResetRef.current = true;
        if (course.source === 'manual') {
          if (selectedWeek !== null) useProjectStore.getState().updateManualCourse(selectedWeek, course.id, patch);
        } else {
          const { allCourses, setCourses } = useProjectStore.getState();
          setCourses(allCourses.map((c) => (c === course ? { ...c, ...patch } : c)));
        }
      }
    }

    setPendingEdit(null);
  }

  function handleEventDrop(info: EventDropArg) {
    setDragging(null);
    const ext = info.event.extendedProps as CalendarEventExtProps;

    if (ext.isBlockedZone && ext.blockedZoneId) {
      const start = info.event.start;
      const end = info.event.end;
      if (!start || !end) { info.revert(); return; }
      handleBlockedZoneMove(ext.blockedZoneId, start, end);
      return;
    }

    if (ext.isEnforced) {
      const courseKey = ext.courseKey;
      const startDate = info.event.start;
      if (!startDate || !courseKey) return;

      const newStartTime = Math.round((startDate.getTime() - monday.getTime()) / 60000);
      const state = usePlanningStore.getState();
      const existing = state.manualEnforcedMap[courseKey] ?? state.enforcedMap[courseKey];
      if (!existing) return;

      const updated: EnforcedData = { ...existing, startTime: newStartTime };
      const newMap = { ...state.manualEnforcedMap, [courseKey]: updated };
      handleEnforceChange({ ...newMap });
      // Calculer la violation au nouveau créneau
      if (availabilityManager) {
        const duration = ext.durationMin ?? 0;
        const violation = computeConstraintViolation(newStartTime, duration, existing.teacher, existing.groups, existing.rooms, availabilityManager, week);
        setEnforcedViolation(courseKey, violation);
      }
      return;
    }

    const taskId = info.event.id;
    const startDate = info.event.start;
    if (!startDate || !taskId) return;
    const newStartTime = Math.round((startDate.getTime() - monday.getTime()) / 60000);
    const teachers = ext.teachers ?? [];
    const groups = ext.groups ?? [];
    const rooms = ext.rooms ?? [];

    if (ext.isNeutralizedPlaced) {
      const violation = availabilityManager
        ? computeConstraintViolation(newStartTime, ext.durationMin ?? 0, teachers, groups, rooms, availabilityManager, week)
        : 'none';
      updatePlacedNeutralizedTask(taskId, { startTime: newStartTime, constraintViolation: violation });
      return;
    }

    // Déterminer si la tâche est revenue à sa position d'origine
    const originalTask = solutions.find((t) => t.taskId === taskId);
    const originalStartTime = originalTask?.startTime ?? null;
    const isAtOrigin = originalStartTime !== null && newStartTime === originalStartTime;
    const violation = (!isAtOrigin && availabilityManager)
      ? computeConstraintViolation(newStartTime, ext.durationMin ?? 0, teachers, groups, rooms, availabilityManager, week)
      : 'none';

    if (taskId in taskOverrides) {
      const existing = taskOverrides[taskId];
      setTaskOverride(taskId, { ...existing, startTime: newStartTime, constraintViolation: isAtOrigin ? undefined : violation });
    } else {
      setTaskOverride(taskId, { startTime: newStartTime, teachers, groups, rooms, constraintViolation: isAtOrigin ? undefined : violation });
    }
  }

  function handleEventDragStop(info: EventDragStopArg) {
    setDragging(null);
    const calEl = calendarWrapperRef.current;
    if (!calEl) return;

    const rect = calEl.getBoundingClientRect();
    const { clientX, clientY } = info.jsEvent as MouseEvent;
    const isOutside =
      clientX < rect.left || clientX > rect.right ||
      clientY < rect.top || clientY > rect.bottom;

    if (!isOutside) return;

    const ext = info.event.extendedProps as CalendarEventExtProps;

    if (ext.isEnforced && ext.courseKey) {
      const courseKey = ext.courseKey;
      const state = usePlanningStore.getState();
      // Si auto-propagé (pas dans manualEnforcedMap), on le retire de la propagation
      // en l'ajoutant d'abord dans manualEnforcedMap puis en le supprimant
      const newMap = { ...state.manualEnforcedMap };
      delete newMap[courseKey];
      handleEnforceChange({ ...newMap });
    }

    if (ext.isNeutralizedPlaced && info.event.id) {
      const taskId = info.event.id;
      removePlacedNeutralizedTask(taskId);
      // Si la tâche vient de activeSolution, la remettre dans la pioche
      const solutionTask = usePlanningStore.getState().activeSolution.find((t) => t.taskId === taskId);
      if (solutionTask) {
        addManuallyNeutralizedTask({
          taskId,
          code: ext.code ?? solutionTask.code,
          name: ext.name ?? solutionTask.name,
          type: ext.type ?? solutionTask.type,
          duration: ext.durationMin ?? solutionTask.duration,
          teachers: ext.teachers ?? [],
          groups: ext.groups ?? [],
          rooms: ext.rooms ?? [],
        });
      }
    }

    // Tâche planifiée ordinaire déposée hors du calendrier → pioche
    if (!ext.isEnforced && !ext.isNeutralizedPlaced && !ext.isBlockedZone) {
      const taskId = info.event.id;
      info.event.remove();
      addManuallyNeutralizedTask({
        taskId,
        code: ext.code ?? '',
        name: ext.name ?? '',
        type: ext.type ?? '',
        duration: ext.durationMin ?? 60,
        teachers: ext.teachers ?? [],
        groups: ext.groups ?? [],
        rooms: ext.rooms ?? [],
      });
    }
  }

  // ── Calcul des événements calendrier ──────────────────────────────────
  const calendarEvents = useMemo(() => {
    const blockEvts = blockedZones.map((zone) => ({
      id: `blocked-${zone.id}`,
      start: zone.start,
      end: zone.end,
      backgroundColor:
        zone.source === 'vacation'
          ? 'rgba(99,179,237,0.95)'
          : zone.source === 'public-holiday'
            ? 'rgba(154,117,210,0.95)'
            : 'rgba(239,68,68,0.95)',
      borderColor:
        zone.source === 'vacation'
          ? 'rgba(66,153,225,0.9)'
          : zone.source === 'public-holiday'
            ? 'rgba(128,90,213,0.9)'
            : 'rgba(220, 34, 34, 1)',
      classNames: ['fc-blocked-zone'],
      extendedProps: {
        isBlockedZone: true,
        blockedZoneId: zone.id,
        blockedZoneSource: zone.source ?? 'manual',
        blockedZoneLabel: zone.label,
      },
    }));

    const solEvts: CalendarEventData[] = solutions
      .filter((task) =>
        !placedNeutralizedTasks.some((p) => p.taskId === task.taskId) &&
        !manuallyNeutralizedTasks.some((m) => m.taskId === task.taskId),
      )
      .map((task) => {
      const override = taskOverrides[task.taskId];
      const teachers = override?.teachers ?? task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
      const groups = override?.groups ?? task.resources.filter((r) => r.type === 'group').map((r) => r.id);
      const rooms = override?.rooms ?? task.resources.filter((r) => r.type === 'room').map((r) => r.id);
      const startTime = override?.startTime ?? task.startTime;
      const duration = override?.duration ?? task.duration;
      const isManuallyPlaced = override !== undefined && override.startTime !== task.startTime;
      const start = startTimeToDate(monday, startTime);
      const end = new Date(start.getTime() + duration * 60 * 1000);
      return {
        id: task.taskId,
        title: [task.code, task.type, ...teachers].join(' • '),
        start,
        end,
        ...getEventColors(levelFromCode(task.code), task.type, yearColorConfig),
        extendedProps: { name: task.name, code: task.code, type: task.type, teachers, groups, rooms, durationMin: duration, manuallyPlaced: isManuallyPlaced || undefined, constraintViolation: isManuallyPlaced ? (override?.constraintViolation ?? 'none') : undefined },
      };
    });

    const placedNeutralizedEvts: CalendarEventData[] = placedNeutralizedTasks
      .filter((task) => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return (
          task.code.toLowerCase().includes(q) ||
          task.name.toLowerCase().includes(q) ||
          task.teachers.some((t) => t.toLowerCase().includes(q)) ||
          task.rooms.some((r) => r.toLowerCase().includes(q)) ||
          task.groups.some((g) => g.toLowerCase().includes(q))
        );
      })
      .map((task) => {
      const start = startTimeToDate(monday, task.startTime);
      const end = new Date(start.getTime() + task.duration * 60 * 1000);
      const title = [task.code, task.type, ...task.teachers].filter(Boolean).join(' • ');
      const originalTask = solutions.find((t) => t.taskId === task.taskId);
      const isAtOrigin = originalTask !== undefined && task.startTime === originalTask.startTime;
      return {
        id: task.taskId,
        title,
        start,
        end,
        ...getEventColors(levelFromCode(task.code), task.type, yearColorConfig),
        extendedProps: {
          name: task.name,
          code: task.code,
          type: task.type,
          teachers: task.teachers,
          groups: task.groups,
          rooms: task.rooms,
          durationMin: task.duration,
          isNeutralizedPlaced: true,
          taskId: task.taskId,
          manuallyPlaced: isAtOrigin ? undefined : true,
          constraintViolation: isAtOrigin ? undefined : (task.constraintViolation ?? 'none'),
        },
      };
    });

    const resourceEvents: ResourceEventInfo[] = [
      ...solEvts.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
        teachers: e.extendedProps.teachers ?? [],
        groups: e.extendedProps.groups ?? [],
        rooms: e.extendedProps.rooms ?? [],
      })),
      ...(!activeSolution || activeSolution.length === 0 ? enforcedEventsState : []).map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
        teachers: e.extendedProps.teachers ?? [],
        groups: e.extendedProps.groups ?? [],
        rooms: e.extendedProps.rooms ?? [],
      })),
      ...placedNeutralizedEvts.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
        teachers: e.extendedProps.teachers ?? [],
        groups: e.extendedProps.groups ?? [],
        rooms: e.extendedProps.rooms ?? [],
      })),
    ];

    const activeDragResources = dragging ?? externalDragging ?? null;
    const highlights = dragging
      ? computeDragHighlights(resourceEvents, dragging)
      : activeDragResources
        ? computeDragHighlights(resourceEvents, { id: '', ...activeDragResources })
        : computeStaticConflicts(resourceEvents);

    function applyHighlight(evt: CalendarEventData): CalendarEventData {
      const hl = highlights[evt.id];
      const isDragActive = activeDragResources !== null;
      if (!hl) {
        if (!isDragActive) return evt;
        // Drag actif, aucune collision → vert
        return {
          ...evt,
          backgroundColor: '#22c55e',
          borderColor: '#16a34a',
        };
      }
      return {
        ...evt,
        backgroundColor: hl === 'red' ? '#ef4444' : '#f97316',
        borderColor: hl === 'red' ? '#dc2626' : '#ea580c',
      };
    }

    const constraintBgEvents: { id: string; start: Date; end: Date; display: string; backgroundColor: string; classNames: string[] }[] = [];
    if (activeDragResources && availabilityManager) {
      // Rouge : enseignants indisponibles (prioritaire)
      const teacherIds = activeDragResources.teachers;
      const teacherZones = teacherIds.length > 0
        ? computeConstraintUnavailableZones(teacherIds, availabilityManager, week, monday)
        : [];

      // Orange : salles + groupes indisponibles, SAUF les plages déjà couvertes par le rouge
      const otherIds = [...activeDragResources.groups, ...activeDragResources.rooms];
      const otherZones = otherIds.length > 0
        ? subtractDateZones(
            computeConstraintUnavailableZones(otherIds, availabilityManager, week, monday),
            teacherZones,
          )
        : [];

      otherZones.forEach((z: { start: Date; end: Date }, i: number) => {
        constraintBgEvents.push({
          id: `constraint-bg-other-${i}`,
          start: z.start,
          end: z.end,
          display: 'background',
          backgroundColor: 'rgb(234, 88, 12, 1)',
          classNames: ['fc-constraint-unavailable', 'fc-constraint-other'],
        });
      });

      teacherZones.forEach((z, i) => {
        constraintBgEvents.push({
          id: `constraint-bg-teacher-${i}`,
          start: z.start,
          end: z.end,
          display: 'background',
          backgroundColor: 'rgb(182, 0, 23, 1)',
          classNames: ['fc-constraint-unavailable', 'fc-constraint-teacher'],
        });
      });
    }

    return [
      ...solEvts.map(applyHighlight),
      ...blockEvts,
      ...(!activeSolution || activeSolution.length === 0 ? enforcedEventsState.map(applyHighlight) : []),
      ...placedNeutralizedEvts.map(applyHighlight),
      ...constraintBgEvents,
    ];
  }, [solutions, activeSolution, blockedZones, monday, enforcedEventsState, taskOverrides, placedNeutralizedTasks, manuallyNeutralizedTasks, searchQuery, enforcedViolations, dragging, externalDragging, availabilityManager, week, yearColorConfig]);

  return {
    week,
    monday,
    calendarRef,
    calendarWrapperRef,
    calendarEvents,
    // État des modals
    pendingDrop,
    pendingEdit,
    setPendingEdit,
    pendingNeutralizedDrop,
    dragging,
    // Handlers FullCalendar
    handleSelect,
    handleDateClick,
    handleEventClick,
    handleEventDragStart,
    handleEventDrop,
    handleEventDragStop,
    handleEventReceive,
    // Handlers modals
    confirmEnforce,
    removeEnforced,
    handleModalConfirm,
    handleModalCancel,
    handleNeutralizedPlaceConfirm,
    handleNeutralizedPlaceCancel,
    handleEditConfirm,
    // Données pour les modals
    solutions,
  };
}
