'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type FullCalendar from '@fullcalendar/react';
import type { EventApi, EventDropArg } from '@fullcalendar/core';
import type { EventReceiveArg, EventDragStopArg } from '@fullcalendar/interaction';
import type { EventClickArg } from '@fullcalendar/core';
import type { TaskSolutionJSON, CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import type { EnforceSelection } from '@/components/planning/modals/EnforceModal';
import type { TaskEditUpdate } from '@/components/planning/modals/TaskEditModal';
import { getMondayOfISOWeek, startTimeToDate, computeStaticConflicts, computeDragHighlights } from '@/lib/calendarUtils';
import type { ResourceEventInfo } from '@/lib/calendarUtils';
import { computeConstraintUnavailableZones } from '@/lib/blockedZones';
import { levelFromCode, getEventColors } from '@/lib/yearColors';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useSchedulerStore } from '@/store/useSchedulerStore';

/** Soustrait les intervalles `subtract` de `base` — retourne base \ subtract (sans chevauchement). */
function subtractDateZones(
  base: { start: Date; end: Date }[],
  subtract: { start: Date; end: Date }[],
): { start: Date; end: Date }[] {
  if (subtract.length === 0) return base;
  const result: { start: Date; end: Date }[] = [];
  for (const bz of base) {
    let segs = [{ start: bz.start, end: bz.end }];
    for (const sz of subtract) {
      const next: { start: Date; end: Date }[] = [];
      for (const s of segs) {
        if (s.end <= sz.start || s.start >= sz.end) {
          next.push(s);
        } else {
          if (s.start < sz.start) next.push({ start: s.start, end: sz.start });
          if (s.end > sz.end) next.push({ start: sz.end, end: s.end });
        }
      }
      segs = next;
    }
    result.push(...segs);
  }
  return result;
}

// ── Types partagés ─────────────────────────────────────────────────────────

export interface PendingDrop {
  courseKey: string;
  startTime: number;
  course: CourseTaskData;
}

export interface EventDetail {
  title: string;
  name: string;
  code: string;
  type: string;
  teachers: string[];
  groups: string[];
  rooms: string[];
  start: Date;
  end: Date;
  durationMin: number;
  isEnforced?: boolean;
  courseKey?: string;
  eventId?: string;
  isNeutralizedPlaced?: boolean;
}

export interface CalendarEventExtProps {
  name?: string;
  code?: string;
  type?: string;
  teachers?: string[];
  groups?: string[];
  rooms?: string[];
  durationMin?: number;
  isEnforced?: boolean;
  courseKey?: string;
  isNeutralizedPlaced?: boolean;
  taskId?: string;
  isBlockedZone?: boolean;
  blockedZoneId?: string;
}

export interface CalendarEventData {
  id: string;
  title?: string;
  start: Date;
  end: Date;
  backgroundColor: string;
  borderColor?: string;
  textColor?: string;
  classNames?: string[];
  extendedProps: CalendarEventExtProps;
}

export interface DraggingState {
  id: string;
  teachers: string[];
  groups: string[];
  rooms: string[];
}

export interface PendingEditData {
  taskId: string;
  courseKey?: string;
  title: string;
  teachers: string[];
  groups: string[];
  rooms: string[];
  startTime: number;
  durationMin: number;
  isEnforced?: boolean;
  isNeutralizedPlaced?: boolean;
  teacherOptions: string[];
  groupOptions: string[];
  roomOptions: string[];
}

// ── Hook principal ─────────────────────────────────────────────────────────

export function useCalendarCore(solutions: TaskSolutionJSON[], parsedCourses: CourseTaskData[]) {
  // ── Store planning ──────────────────────────────────────────────────────
  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const week = selectedWeek ?? 1;
  const taskOverrides = usePlanningStore((s) => s.taskOverrides);
  const placedNeutralizedTasks = usePlanningStore((s) => s.placedNeutralizedTasks);
  const setTaskOverride = usePlanningStore((s) => s.setTaskOverride);
  const moveTaskOverride = usePlanningStore((s) => s.moveTaskOverride);
  const addPlacedNeutralizedTask = usePlanningStore((s) => s.addPlacedNeutralizedTask);
  const updatePlacedNeutralizedTask = usePlanningStore((s) => s.updatePlacedNeutralizedTask);
  const removePlacedNeutralizedTask = usePlanningStore((s) => s.removePlacedNeutralizedTask);
  const storeEnforcedMap = usePlanningStore((s) => s.enforcedMap);
  const handleEnforceChange = usePlanningStore((s) => s.handleEnforceChange);
  const blockedZones = usePlanningStore((s) => s.blockedZones);
  const handleBlockedZoneAdd = usePlanningStore((s) => s.handleBlockedZoneAdd);
  const handleBlockedZoneRemove = usePlanningStore((s) => s.handleBlockedZoneRemove);
  const handleBlockedZoneMove = usePlanningStore((s) => s.handleBlockedZoneMove);
  const externalDragging = usePlanningStore((s) => s.draggingExternal);

  const availabilityManager = useSchedulerStore((s) => s.availabilityManager);
  const resources = useSchedulerStore((s) => s.resources);
  const yearColorConfig = useSchedulerStore((s) => s.yearColorConfig);

  const monday = useMemo(() => getMondayOfISOWeek(week), [week]);

  // ── État local UI ──────────────────────────────────────────────────────
  const [selected, setSelected] = useState<EventDetail | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEditData | null>(null);
  const [dragging, setDragging] = useState<DraggingState | null>(null);

  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarWrapperRef = useRef<HTMLDivElement | null>(null);
  const pendingEventRef = useRef<EventApi | null>(null);

  // ── Événements imposés dérivés ─────────────────────────────────────────
  const enforcedEventsState = useMemo<CalendarEventData[]>(() => {
    return Object.entries(storeEnforcedMap).map(([courseKey, enforced]) => {
      const course = parsedCourses[parseInt(courseKey, 10)];
      const teacherStr = enforced.teacher.join(', ');
      const title = [course?.code ?? '?', course?.type ?? '', teacherStr].filter(Boolean).join(' • ');
      const startDate = new Date(monday.getTime() + enforced.startTime * 60 * 1000);
      const endDate = new Date(startDate.getTime() + (course?.duration ?? 60) * 60 * 1000);
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
        },
      };
    });
  }, [storeEnforcedMap, parsedCourses, monday, yearColorConfig]);

  const prevParsedCoursesRef = useRef<CourseTaskData[]>(parsedCourses);
  useEffect(() => {
    if (prevParsedCoursesRef.current !== parsedCourses) {
      prevParsedCoursesRef.current = parsedCourses;
      handleEnforceChange({});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedCourses]);

  // ── Handlers ──────────────────────────────────────────────────────────

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
    setSelected({
      title: arg.event.title,
      name: ext.name ?? '',
      code: ext.code ?? '',
      type: ext.type ?? '',
      teachers: ext.teachers ?? [],
      groups: ext.groups ?? [],
      rooms: ext.rooms ?? [],
      start: arg.event.start!,
      end: arg.event.end!,
      durationMin: ext.durationMin ?? 0,
      isEnforced: ext.isEnforced,
      courseKey: ext.courseKey,
      eventId: arg.event.id,
      isNeutralizedPlaced: ext.isNeutralizedPlaced,
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
    addPlacedNeutralizedTask({ taskId, code, name, type, startTime, duration: durationMin, teachers, groups, rooms });
  }

  function handleEventReceive(info: EventReceiveArg) {
    if (info.event.extendedProps.isNeutralizedTask) {
      handleReceiveNeutralizedTask(info);
      return;
    }
    const courseKey = info.event.extendedProps.courseKey as string;
    const startDate = info.event.start;
    if (!startDate || !courseKey) { info.event.remove(); return; }

    const idx = parseInt(courseKey, 10);
    const course = parsedCourses[idx];
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

  function handleEditRequest() {
    if (!selected) return;
    const startTime = Math.round((selected.start.getTime() - monday.getTime()) / 60000);

    const teacherOptions = resources
      .filter((g) => g.resourceType === 'teacher')
      .flatMap((g) => g.resources.map((r) => r.id));
    const groupOptions = resources
      .filter((g) => g.resourceType === 'group')
      .flatMap((g) => g.resources.map((r) => r.id));
    const roomOptions = resources
      .filter((g) => g.resourceType === 'room')
      .flatMap((g) => g.resources.map((r) => r.id));

    setPendingEdit({
      taskId: selected.eventId ?? '',
      courseKey: selected.courseKey,
      title: selected.title,
      teachers: selected.teachers,
      groups: selected.groups,
      rooms: selected.rooms,
      startTime,
      durationMin: selected.durationMin,
      isEnforced: selected.isEnforced,
      isNeutralizedPlaced: selected.isNeutralizedPlaced,
      teacherOptions,
      groupOptions,
      roomOptions,
    });
  }

  function handleEditConfirm(update: TaskEditUpdate) {
    if (!pendingEdit) return;

    if (pendingEdit.isEnforced && pendingEdit.courseKey) {
      const courseKey = pendingEdit.courseKey;
      const state = usePlanningStore.getState();
      // Chercher dans manualEnforcedMap d'abord, puis dans enforcedMap (auto-propagé)
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
      });
    } else {
      const taskId = pendingEdit.taskId;
      const existingOverride = taskOverrides[taskId];
      setTaskOverride(taskId, {
        startTime: existingOverride?.startTime ?? pendingEdit.startTime,
        teachers: update.teachers,
        groups: update.groups,
        rooms: update.rooms,
      });
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
      updatePlacedNeutralizedTask(taskId, { startTime: newStartTime });
      return;
    }

    if (taskId in taskOverrides) {
      moveTaskOverride(taskId, newStartTime);
    } else {
      setTaskOverride(taskId, { startTime: newStartTime, teachers, groups, rooms });
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
      removePlacedNeutralizedTask(info.event.id);
    }
  }

  // ── Calcul des événements calendrier ──────────────────────────────────
  const calendarEvents = useMemo(() => {
    const blockEvts = blockedZones.map((zone) => ({
      id: `blocked-${zone.id}`,
      start: zone.start,
      end: zone.end,
      backgroundColor: 'rgba(239,68,68)',
      borderColor: 'rgba(220, 34, 34, 1)',
      classNames: ['fc-blocked-zone'],
      extendedProps: { isBlockedZone: true, blockedZoneId: zone.id },
    }));

    const solEvts: CalendarEventData[] = solutions.map((task) => {
      const override = taskOverrides[task.taskId];
      const teachers = override?.teachers ?? task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
      const groups = override?.groups ?? task.resources.filter((r) => r.type === 'group').map((r) => r.id);
      const rooms = override?.rooms ?? task.resources.filter((r) => r.type === 'room').map((r) => r.id);
      const startTime = override?.startTime ?? task.startTime;
      const start = startTimeToDate(monday, startTime);
      const end = new Date(start.getTime() + task.duration * 60 * 1000);
      return {
        id: task.taskId,
        title: [task.code, task.type, ...teachers].join(' • '),
        start,
        end,
        ...getEventColors(levelFromCode(task.code), task.type, yearColorConfig),
        extendedProps: { name: task.name, code: task.code, type: task.type, teachers, groups, rooms, durationMin: task.duration },
      };
    });

    const placedNeutralizedEvts: CalendarEventData[] = placedNeutralizedTasks.map((task) => {
      const start = startTimeToDate(monday, task.startTime);
      const end = new Date(start.getTime() + task.duration * 60 * 1000);
      const title = [task.code, task.type, ...task.teachers].filter(Boolean).join(' • ');
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
      ...(solutions.length === 0 ? enforcedEventsState : []).map((e) => ({
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
      if (!hl) return evt;
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

      otherZones.forEach((z, i) => {
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
      ...(solutions.length === 0 ? enforcedEventsState.map(applyHighlight) : []),
      ...placedNeutralizedEvts.map(applyHighlight),
      ...constraintBgEvents,
    ];
  }, [solutions, blockedZones, monday, enforcedEventsState, taskOverrides, placedNeutralizedTasks, dragging, externalDragging, availabilityManager, week, yearColorConfig]);

  return {
    week,
    monday,
    calendarRef,
    calendarWrapperRef,
    calendarEvents,
    // État des modals
    selected,
    setSelected,
    pendingDrop,
    pendingEdit,
    setPendingEdit,
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
    handleEditRequest,
    handleEditConfirm,
    // Données pour les modals
    solutions,
  };
}
