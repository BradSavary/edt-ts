'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventContentArg, EventClickArg, EventApi, EventDropArg } from '@fullcalendar/core';
import type { EventReceiveArg, EventDragStopArg } from '@fullcalendar/interaction';
import type { TaskSolutionJSON, CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import EnforceModal from '@/components/planning/modals/EnforceModal';
import type { EnforceSelection } from '@/components/planning/modals/EnforceModal';
import TaskEditModal from '@/components/planning/modals/TaskEditModal';
import type { TaskEditUpdate } from '@/components/planning/modals/TaskEditModal';
import { getMondayOfISOWeek, startTimeToDate, formatTime, formatDate, computeStaticConflicts, computeDragHighlights } from '@/lib/calendarUtils';
import type { ResourceEventInfo } from '@/lib/calendarUtils';
import { computeConstraintUnavailableZones } from '@/lib/blockedZones';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useSchedulerStore } from '@/store/useSchedulerStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface PendingDrop {
  courseKey: string;
  startTime: number;
  course: CourseTaskData;
}

interface EventDetail {
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

interface Props {
  solutions: TaskSolutionJSON[];
  parsedCourses?: CourseTaskData[];
  /** Ressources d'un cours drag depuis l'extérieur (sidebar gauche ou droite). */
  externalDragging?: { teachers: string[]; groups: string[]; rooms: string[] } | null;
}

// Typed event stored in React state, compatible with FullCalendar EventInput
interface CalendarEventExtProps {
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

interface CalendarEventData {
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

// Resources of the event being dragged (for live conflict preview)
interface DraggingState {
  id: string;
  teachers: string[];
  groups: string[];
  rooms: string[];
}

// Parameters for the inline resource-edit modal
interface PendingEditData {
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

// ─── Composant local : détail d'un event cliqué ───────────────────────────────

interface EventDetailPopupProps {
  detail: EventDetail;
  onClose: () => void;
  onRemoveEnforced: (courseKey: string) => void;
  onEditResources?: () => void;
}

function EventDetailPopup({ detail, onClose, onRemoveEnforced, onEditResources }: EventDetailPopupProps) {
  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {detail.code} {detail.type} — {detail.teachers.join(', ')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{detail.name}</p>

        <Separator />

        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="font-medium text-muted-foreground w-24 shrink-0">Date</dt>
            <dd className="text-foreground">{formatDate(detail.start)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-muted-foreground w-24 shrink-0">Horaire</dt>
            <dd className="text-foreground">
              {formatTime(detail.start)} – {formatTime(detail.end)}
            </dd>
          </div>
          {detail.groups.length > 0 && (
            <div className="flex gap-2">
              <dt className="font-medium text-muted-foreground w-24 shrink-0">Groupes</dt>
              <dd className="text-foreground">{detail.groups.join(', ')}</dd>
            </div>
          )}
          {detail.rooms.length > 0 && (
            <div className="flex gap-2">
              <dt className="font-medium text-muted-foreground w-24 shrink-0">Salle</dt>
              <dd className="text-foreground">{detail.rooms.join(', ')}</dd>
            </div>
          )}
        </dl>

        {detail.isEnforced && detail.courseKey && (
          <Button
            variant="outline"
            className="w-full border-destructive text-destructive hover:bg-destructive/10"
            onClick={() => { onRemoveEnforced(detail.courseKey!); onClose(); }}
          >
            Retirer l&apos;imposition
          </Button>
        )}
        {onEditResources && (
          <Button
            variant="outline"
            className="w-full border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950"
            onClick={() => { onEditResources(); onClose(); }}
          >
            ✏️ Modifier les ressources
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function renderEventContent(info: EventContentArg) {
  const props = info.event.extendedProps as {
    name?: string;
    groups?: string[];
    rooms?: string[];
    durationMin?: number;
    isEnforced?: boolean;
    isBlockedZone?: boolean;
  };

  if (props.isBlockedZone) {
    return (
      <div className="px-1 py-0.5 text-xs overflow-hidden leading-tight h-full flex items-start gap-1 cursor-pointer select-none">
        <span className="shrink-0">🚫</span>
        <div>
          <div className="font-semibold">Zone vide</div>
          <div className="opacity-60">Clic pour retirer</div>
        </div>
      </div>
    );
  }

  const groups = props.groups ?? [];
  const rooms = props.rooms ?? [];
  return (
    <div className="px-1 py-0.5 text-xs overflow-hidden leading-tight h-full">
      <div className="font-semibold truncate flex items-center gap-1">
        {props.isEnforced && <span title="Imposé">📌</span>}
        {info.event.title}
      </div>
      {props.name && <div className="truncate opacity-90">{props.name}</div>}
      {groups.length > 0 && (
        <div className="truncate opacity-80">{groups.join(', ')}</div>
      )}
      {rooms.length > 0 && (
        <div className="truncate opacity-80">{rooms.join(', ')}</div>
      )}
    </div>
  );
}

export default function ScheduleCalendar({ solutions, parsedCourses = [], externalDragging }: Props) {
  // ── Store planning ────────────────────────────────────────────────────
  const selectedWeek = usePlanningStore((s) => s.selectedWeek);
  const week = selectedWeek ?? 1;
  const taskOverrides = usePlanningStore((s) => s.taskOverrides);
  const placedNeutralizedTasks = usePlanningStore((s) => s.placedNeutralizedTasks);
  const setTaskOverride = usePlanningStore((s) => s.setTaskOverride);
  const addPlacedNeutralizedTask = usePlanningStore((s) => s.addPlacedNeutralizedTask);
  const updatePlacedNeutralizedTask = usePlanningStore((s) => s.updatePlacedNeutralizedTask);
  const removePlacedNeutralizedTask = usePlanningStore((s) => s.removePlacedNeutralizedTask);
  const storeEnforcedMap = usePlanningStore((s) => s.enforcedMap);
  const handleEnforceChange = usePlanningStore((s) => s.handleEnforceChange);
  const blockedZones = usePlanningStore((s) => s.blockedZones);
  const handleBlockedZoneAdd = usePlanningStore((s) => s.handleBlockedZoneAdd);
  const handleBlockedZoneRemove = usePlanningStore((s) => s.handleBlockedZoneRemove);
  const handleBlockedZoneMove = usePlanningStore((s) => s.handleBlockedZoneMove);
  // AvailabilityManager reconstruit automatiquement quand constraints change dans useSchedulerStore
  const availabilityManager = useSchedulerStore((s) => s.availabilityManager);
  const resources = useSchedulerStore((s) => s.resources);

  const monday = useMemo(() => getMondayOfISOWeek(week), [week]);

  // ── État local UI (non partagé entre sessions) ─────────────────────────
  const [selected, setSelected] = useState<EventDetail | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEditData | null>(null);
  const [dragging, setDragging] = useState<DraggingState | null>(null);

  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarWrapperRef = useRef<HTMLDivElement | null>(null);
  const pendingEventRef = useRef<EventApi | null>(null);

  // ── Vues dérivées des événements imposés (depuis enforcedMap du store) ─
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
        backgroundColor: '#22c55e',
        borderColor: '#16a34a',
        textColor: '#fff',
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
  }, [storeEnforcedMap, parsedCourses, monday]);

  const prevParsedCoursesRef = useRef<CourseTaskData[]>(parsedCourses);
  useEffect(() => {
    if (prevParsedCoursesRef.current !== parsedCourses) {
      prevParsedCoursesRef.current = parsedCourses;
      handleEnforceChange({});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedCourses]);

  function confirmEnforce(courseKey: string, enforced: EnforcedData, event: EventApi) {
    event.remove();
    const newMap = { ...usePlanningStore.getState().enforcedMap, [courseKey]: enforced };
    handleEnforceChange(newMap);
  }

  function removeEnforced(courseKey: string) {
    const newMap = { ...usePlanningStore.getState().enforcedMap };
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

  function handleEventDragStart(info: EventDragStopArg) {
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
      const existing = usePlanningStore.getState().enforcedMap[courseKey];
      if (existing) {
        const updated: EnforcedData = { ...existing, teacher: update.teachers, groups: update.groups, rooms: update.rooms };
        const newMap = { ...usePlanningStore.getState().enforcedMap, [courseKey]: updated };
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
      const existing = usePlanningStore.getState().enforcedMap[courseKey];
      if (!existing) return;

      const updated: EnforcedData = { ...existing, startTime: newStartTime };
      const newMap = { ...usePlanningStore.getState().enforcedMap, [courseKey]: updated };
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
    const durationMin = ext.durationMin ?? 60;

    if (ext.isNeutralizedPlaced) {
      updatePlacedNeutralizedTask(taskId, { startTime: newStartTime });
      return;
    }

    const existing = taskOverrides[taskId];
    setTaskOverride(taskId, {
      startTime: newStartTime,
      teachers: existing?.teachers ?? teachers,
      groups: existing?.groups ?? groups,
      rooms: existing?.rooms ?? rooms,
    });
    void durationMin;
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
      const newMap = { ...usePlanningStore.getState().enforcedMap };
      delete newMap[courseKey];
      handleEnforceChange({ ...newMap });
    }

    if (ext.isNeutralizedPlaced && info.event.id) {
      removePlacedNeutralizedTask(info.event.id);
    }
  }

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
        backgroundColor: '#22c55e',
        borderColor: '#16a34a',
        textColor: '#fff',
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
        backgroundColor: '#22c55e',
        borderColor: '#16a34a',
        textColor: '#fff',
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
      // Même condition que pour l'affichage : inclure les enforced seulement avant planification.
      // Après, les tasks de la solution les représentent déjà et les doubler causerait de fausses collisions.
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

    // Zones d'indisponibilité des ressources pendant le drag (background events ambrés)
    const constraintBgEvents: { id: string; start: Date; end: Date; display: string; backgroundColor: string; classNames: string[] }[] = [];
    if (activeDragResources && availabilityManager) {
      const resourceIds = [...activeDragResources.teachers, ...activeDragResources.groups, ...activeDragResources.rooms];
      const zones = computeConstraintUnavailableZones(resourceIds, availabilityManager, week, monday);
      zones.forEach((z, i) => {
        constraintBgEvents.push({
          id: `constraint-bg-${i}`,
          start: z.start,
          end: z.end,
          display: 'background',
          backgroundColor: 'rgb(182, 0, 23, 1)',
          classNames: ['fc-constraint-unavailable'],
        });
      });
    }

    return [
      ...solEvts.map(applyHighlight),
      ...blockEvts,
      // Avant planification : affiche les cours imposés comme prévisualisation (📌).
      // Après planification : la solution les contient déjà ; ne pas les doubler.
      ...(solutions.length === 0 ? enforcedEventsState.map(applyHighlight) : []),
      ...placedNeutralizedEvts.map(applyHighlight),
      ...constraintBgEvents,
    ];
  }, [solutions, blockedZones, monday, enforcedEventsState, taskOverrides, placedNeutralizedTasks, dragging, externalDragging, availabilityManager, week]);

  return (
    <>
      <div className="flex-1 bg-card rounded-lg shadow overflow-hidden flex flex-col border border-border">
        <div ref={calendarWrapperRef} className="flex-1 min-h-0">
          <FullCalendar
            ref={calendarRef}
            key={week}
            plugins={[timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            initialDate={monday}
            locale="fr"
            dayHeaderFormat={{ weekday: 'short', day: 'numeric', month: 'short' }}
            headerToolbar={false}
            slotMinTime="07:00:00"
            slotMaxTime="21:00:00"
            allDaySlot={false}
            businessHours={{
              daysOfWeek: [1, 2, 3, 4, 5],
              startTime: '08:00',
              endTime: '19:30',
            }}
            slotDuration="00:30:00"
            slotLabelInterval="01:00:00"
            weekends={false}
            firstDay={1}
            droppable
            editable
            selectable={solutions.length === 0}
            selectMirror
            selectMinDistance={5}
            selectAllow={(info) => {
              const endAdjusted = new Date(info.end.getTime() - 1);
              return info.start.toDateString() === endAdjusted.toDateString();
            }}
            select={handleSelect}
            dateClick={handleDateClick}
            events={calendarEvents}
            eventContent={renderEventContent}
            eventClick={handleEventClick}
            eventReceive={handleEventReceive}
            eventDrop={handleEventDrop}
            eventDragStart={handleEventDragStart}
            eventDragStop={handleEventDragStop}
            height="100%"
            expandRows
          />
        </div>

        {selected && (
          <EventDetailPopup
            detail={selected}
            onClose={() => setSelected(null)}
            onRemoveEnforced={removeEnforced}
            onEditResources={handleEditRequest}
          />
        )}
      </div>

      {pendingDrop && (
        <EnforceModal
          courseKey={pendingDrop.courseKey}
          course={pendingDrop.course}
          startTime={pendingDrop.startTime}
          onConfirm={handleModalConfirm}
          onCancel={handleModalCancel}
        />
      )}

      {pendingEdit && (
        <TaskEditModal
          title={pendingEdit.title}
          teachers={pendingEdit.teachers}
          groups={pendingEdit.groups}
          rooms={pendingEdit.rooms}
          teacherOptions={pendingEdit.teacherOptions}
          groupOptions={pendingEdit.groupOptions}
          roomOptions={pendingEdit.roomOptions}
          onConfirm={handleEditConfirm}
          onCancel={() => setPendingEdit(null)}
        />
      )}
    </>
  );
}
