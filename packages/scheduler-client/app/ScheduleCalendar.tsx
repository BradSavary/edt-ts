'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventContentArg, EventClickArg, EventApi, EventDropArg } from '@fullcalendar/core';
import type { EventReceiveArg, EventDragStopArg } from '@fullcalendar/interaction';
import type { TaskSolutionJSON, CourseTaskData, EnforcedData, ResourceEntry, ResourceGroupData } from '@edt-ts/scheduler-common';
import EnforceModal from './EnforceModal';
import type { EnforceSelection } from './EnforceModal';
import TaskEditModal from './TaskEditModal';
import type { TaskEditUpdate } from './TaskEditModal';
import { getMondayOfISOWeek, startTimeToDate, formatTime, formatDate } from '../lib/calendarUtils';
import type { BlockedZone } from '../lib/blockedZones';

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
  week: number;
  parsedCourses?: CourseTaskData[];
  onEnforceChange?: (map: Record<string, EnforcedData>) => void;
  blockedZones?: BlockedZone[];
  onBlockedZoneAdd?: (start: Date, end: Date) => void;
  onBlockedZoneRemove?: (id: string) => void;
  onBlockedZoneMove?: (id: string, start: Date, end: Date) => void;
  onNeutralizedTaskPlaced?: (taskId: string) => void;
  onNeutralizedTaskRemoved?: (taskId: string) => void;
  /** Clé de solution courante : quand elle change, les états locaux de placement sont réinitialisés. */
  solutionKey?: number;
  /** Liste complète des ressources (issues du resources.json) pour peupler les selects d'édition. */
  resourcesList?: ResourceGroupData[];
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

// Override position/resources for a moved or edited solution task
interface PlacedTaskOverride {
  startTime: number;
  teachers: string[];
  groups: string[];
  rooms: string[];
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md p-6 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-black dark:text-white">
              {detail.code} {detail.type} — {detail.teachers.join(', ')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{detail.name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Date</dt>
            <dd className="text-black dark:text-white">{formatDate(detail.start)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Horaire</dt>
            <dd className="text-black dark:text-white">
              {formatTime(detail.start)} – {formatTime(detail.end)}
            </dd>
          </div>
          {detail.groups.length > 0 && (
            <div className="flex gap-2">
              <dt className="font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Groupes</dt>
              <dd className="text-black dark:text-white">{detail.groups.join(', ')}</dd>
            </div>
          )}
          {detail.rooms.length > 0 && (
            <div className="flex gap-2">
              <dt className="font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Salle</dt>
              <dd className="text-black dark:text-white">{detail.rooms.join(', ')}</dd>
            </div>
          )}
        </dl>

        {detail.isEnforced && detail.courseKey && (
          <button
            onClick={() => { onRemoveEnforced(detail.courseKey!); onClose(); }}
            className="mt-4 w-full px-4 py-2 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm font-semibold rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition"
          >
            Retirer l&apos;imposition
          </button>
        )}
        {onEditResources && (
          <button
            onClick={() => { onEditResources(); onClose(); }}
            className="mt-2 w-full px-4 py-2 border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 text-sm font-semibold rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 transition"
          >
            ✏️ Modifier les ressources
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Helpers : détection de conflits de ressources ───────────────────────────

type ResourceEventInfo = { id: string; start: Date; end: Date; teachers: string[]; groups: string[]; rooms: string[] };

/**
 * Retourne une map eventId → 'red' | 'orange' basée sur les chevauchements
 * temporels effectifs entre événements partageant des ressources.
 * rouge = conflit enseignant ou groupe ; orange = conflit salle uniquement.
 */
function computeStaticConflicts(events: ResourceEventInfo[]): Record<string, 'red' | 'orange'> {
  const result: Record<string, 'red' | 'orange'> = {};
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (a.start >= b.end || b.start >= a.end) continue;
      const setTeachers = new Set(a.teachers);
      const setGroups = new Set(a.groups);
      const setRooms = new Set(a.rooms);
      const sharedTeacher = b.teachers.some((t) => setTeachers.has(t));
      const sharedGroup = b.groups.some((g) => setGroups.has(g));
      const sharedRoom = b.rooms.some((r) => setRooms.has(r));
      if (sharedTeacher || sharedGroup) {
        result[a.id] = 'red';
        result[b.id] = 'red';
      } else if (sharedRoom) {
        if (result[a.id] !== 'red') result[a.id] = 'orange';
        if (result[b.id] !== 'red') result[b.id] = 'orange';
      }
    }
  }
  return result;
}

/**
 * Pendant un glissement, met en évidence tous les événements existants
 * qui partagent des ressources avec l'événement glissé (indépendamment du créneau).
 */
function computeDragHighlights(events: ResourceEventInfo[], drag: DraggingState): Record<string, 'red' | 'orange'> {
  const result: Record<string, 'red' | 'orange'> = {};
  const dragTeachers = new Set(drag.teachers);
  const dragGroups = new Set(drag.groups);
  const dragRooms = new Set(drag.rooms);
  for (const evt of events) {
    if (evt.id === drag.id) continue;
    const sharedTeacher = evt.teachers.some((t) => dragTeachers.has(t));
    const sharedGroup = evt.groups.some((g) => dragGroups.has(g));
    const sharedRoom = evt.rooms.some((r) => dragRooms.has(r));
    if (sharedTeacher || sharedGroup) result[evt.id] = 'red';
    else if (sharedRoom) result[evt.id] = 'orange';
  }
  return result;
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

export default function ScheduleCalendar({ solutions, week, parsedCourses = [], onEnforceChange, blockedZones = [], onBlockedZoneAdd, onBlockedZoneRemove, onBlockedZoneMove, onNeutralizedTaskPlaced, onNeutralizedTaskRemoved, solutionKey, resourcesList = [] }: Props) {
  const monday = useMemo(() => getMondayOfISOWeek(week), [week]);
  const [selected, setSelected] = useState<EventDetail | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEditData | null>(null);
  // Événements imposés gérés par état React pour être toujours inclus dans la prop events
  const [enforcedEventsState, setEnforcedEventsState] = useState<CalendarEventData[]>([]);
  // Overrides de position/ressources pour les tâches planifiées déplacées ou éditées
  const [taskOverrides, setTaskOverrides] = useState<Record<string, PlacedTaskOverride>>({});
  // Tâches neutralisées placées manuellement sur le calendrier
  const [placedNeutralizedEvents, setPlacedNeutralizedEvents] = useState<CalendarEventData[]>([]);
  // État du glissement en cours (pour prévisualisation des conflits)
  const [dragging, setDragging] = useState<DraggingState | null>(null);

  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarWrapperRef = useRef<HTMLDivElement | null>(null);
  // Ref vers l'event FullCalendar en cours de traitement (pendant modal)
  const pendingEventRef = useRef<EventApi | null>(null);
  // Map interne des cours imposés (source de vérité côté ScheduleCalendar)
  const enforcedMapRef = useRef<Record<string, EnforcedData>>({});

  // Quand la solution sélectionnée change, réinitialiser les états locaux de placement
  useEffect(() => {
    setPlacedNeutralizedEvents([]);
    setTaskOverrides({});
    setDragging(null);
  // solutionKey change = nouvelle solution sélectionnée dans la sidebar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solutionKey]);

  // Quand des résultats arrivent, vider les events imposés et les ajustements manuels
  useEffect(() => {
    if (solutions.length > 0) {
      setEnforcedEventsState([]);
      enforcedMapRef.current = {};
      setTaskOverrides({});
      setPlacedNeutralizedEvents([]);
    }
  }, [solutions.length]);

  // Quand les cours changent (nouvelle semaine / nouveau CSV), tout réinitialiser
  const prevParsedCoursesRef = useRef<CourseTaskData[]>(parsedCourses);
  useEffect(() => {
    if (prevParsedCoursesRef.current !== parsedCourses) {
      prevParsedCoursesRef.current = parsedCourses;
      // Vider les events imposés via état
      setEnforcedEventsState([]);
      enforcedMapRef.current = {};
      onEnforceChange?.({});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedCourses]); // onEnforceChange intentionnellement exclu : recrée à chaque render

  function confirmEnforce(courseKey: string, enforced: EnforcedData, event: EventApi) {
    const idx = parseInt(courseKey, 10);
    const course = parsedCourses[idx];
    const teacherStr = enforced.teacher.join(', ');
    const title = [course?.code ?? '?', course?.type ?? '', teacherStr].filter(Boolean).join(' • ');
    const startDate = new Date(monday.getTime() + enforced.startTime * 60 * 1000);
    const endDate = new Date(startDate.getTime() + (course?.duration ?? 60) * 60 * 1000);

    // Supprimer l'événement reçu temporairement par FullCalendar
    event.remove();

    // Ajouter via état React (inclus dans la prop events = toujours visible)
    setEnforcedEventsState((prev) => {
      const filtered = prev.filter((e) => e.id !== `enforced-${courseKey}`);
      return [
        ...filtered,
        {
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
        },
      ];
    });

    const newMap = { ...enforcedMapRef.current, [courseKey]: enforced };
    enforcedMapRef.current = newMap;
    onEnforceChange?.({ ...newMap });
  }

  function removeEnforced(courseKey: string) {
    setEnforcedEventsState((prev) =>
      prev.filter((e) => e.id !== `enforced-${courseKey}`)
    );
    const newMap = { ...enforcedMapRef.current };
    delete newMap[courseKey];
    enforcedMapRef.current = newMap;
    onEnforceChange?.({ ...newMap });
  }

  function handleSelect(selectInfo: { start: Date; end: Date }) {
    if (!onBlockedZoneAdd) return;
    onBlockedZoneAdd(selectInfo.start, selectInfo.end);
    calendarRef.current?.getApi().unselect();
  }

  function handleDateClick(info: { date: Date }) {
    if (!onBlockedZoneRemove) return;
    const clicked = info.date;
    const zone = blockedZones.find((z) => z.start <= clicked && z.end > clicked);
    if (zone) onBlockedZoneRemove(zone.id);
  }

  function handleEventClick(arg: EventClickArg) {
    const ext = arg.event.extendedProps as CalendarEventExtProps;

    if (ext.isBlockedZone && ext.blockedZoneId) {
      onBlockedZoneRemove?.(ext.blockedZoneId);
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

  // ── Glissement démarré : enregistre les ressources pour la prévisualisation ──
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

  // ── Réception d'une tâche neutralisée glissée depuis la sidebar ────────────
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
    const title = [code, type, ...teachers].filter(Boolean).join(' • ');
    const endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);

    info.event.remove();
    setPlacedNeutralizedEvents((prev) => {
      const filtered = prev.filter((e) => e.id !== taskId);
      return [
        ...filtered,
        {
          id: taskId,
          title,
          start: startDate,
          end: endDate,
          backgroundColor: '#22c55e',
          borderColor: '#16a34a',
          textColor: '#fff',
          extendedProps: { name, code, type, teachers, groups, rooms, durationMin, isNeutralizedPlaced: true, taskId },
        },
      ];
    });
    onNeutralizedTaskPlaced?.(taskId);
  }

  function handleEventReceive(info: EventReceiveArg) {
    // Tâche neutralisée glissée depuis la sidebar droite
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

    // Vérifier si le cours a des alternatives (salles ou enseignants)
    const hasAlternatives = [...course.teacher, ...course.rooms].some((e) => Array.isArray(e));

    if (!hasAlternatives) {
      // Confirmation directe : ressources sans ambiguïté
      const teacher = course.teacher.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
      const groups = course.groups.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
      const rooms = course.rooms.flatMap((e) => (Array.isArray(e) ? [e[0]] : [e]));
      confirmEnforce(courseKey, { startTime, teacher, groups, rooms }, info.event);
    } else {
      // Garder l'event visible, afficher le modal de sélection
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

  // ── Édition des ressources d'une tâche placée ──────────────────────────────

  function handleEditRequest() {
    if (!selected) return;
    const startTime = Math.round((selected.start.getTime() - monday.getTime()) / 60000);

    // Construire les listes d'options depuis le resources.json complet
    const teacherOptions = resourcesList
      .filter((g) => g.resourceType === 'teacher')
      .flatMap((g) => g.resources.map((r) => r.id));
    const groupOptions = resourcesList
      .filter((g) => g.resourceType === 'group')
      .flatMap((g) => g.resources.map((r) => r.id));
    const roomOptions = resourcesList
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
      const existing = enforcedMapRef.current[courseKey];
      if (existing) {
        const updated: EnforcedData = { ...existing, teacher: update.teachers, groups: update.groups, rooms: update.rooms };
        const newMap = { ...enforcedMapRef.current, [courseKey]: updated };
        enforcedMapRef.current = newMap;
        onEnforceChange?.({ ...newMap });
        const course = parsedCourses[parseInt(courseKey, 10)];
        const newTitle = [course?.code ?? '?', course?.type ?? '', update.teachers.join(', ')].filter(Boolean).join(' • ');
        setEnforcedEventsState((prev) =>
          prev.map((e) => {
            if (e.id !== `enforced-${courseKey}`) return e;
            return { ...e, title: newTitle, extendedProps: { ...e.extendedProps, teachers: update.teachers, groups: update.groups, rooms: update.rooms } };
          })
        );
      }
    } else if (pendingEdit.isNeutralizedPlaced) {
      const taskId = pendingEdit.taskId;
      setPlacedNeutralizedEvents((prev) =>
        prev.map((e) => {
          if (e.id !== taskId) return e;
          const newTitle = [e.extendedProps.code ?? '', e.extendedProps.type ?? '', ...update.teachers].filter(Boolean).join(' • ');
          return { ...e, title: newTitle, extendedProps: { ...e.extendedProps, teachers: update.teachers, groups: update.groups, rooms: update.rooms } };
        })
      );
    } else {
      const taskId = pendingEdit.taskId;
      const existingOverride = taskOverrides[taskId];
      setTaskOverrides((prev) => ({
        ...prev,
        [taskId]: {
          startTime: existingOverride?.startTime ?? pendingEdit.startTime,
          teachers: update.teachers,
          groups: update.groups,
          rooms: update.rooms,
        },
      }));
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
      onBlockedZoneMove?.(ext.blockedZoneId, start, end);
      return;
    }

    if (ext.isEnforced) {
      const courseKey = ext.courseKey;
      const startDate = info.event.start;
      if (!startDate || !courseKey) return;

      const newStartTime = Math.round((startDate.getTime() - monday.getTime()) / 60000);
      const existing = enforcedMapRef.current[courseKey];
      if (!existing) return;

      const updated: EnforcedData = { ...existing, startTime: newStartTime };
      const newMap = { ...enforcedMapRef.current, [courseKey]: updated };
      enforcedMapRef.current = newMap;
      onEnforceChange?.({ ...newMap });

      const course = parsedCourses[parseInt(courseKey, 10)];
      const newEnd = new Date(startDate.getTime() + (course?.duration ?? 60) * 60 * 1000);
      setEnforcedEventsState((prev) =>
        prev.map((e) => {
          if (e.id !== `enforced-${courseKey}`) return e;
          return { ...e, start: startDate, end: newEnd };
        })
      );
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
      const newEnd = new Date(startDate.getTime() + durationMin * 60 * 1000);
      setPlacedNeutralizedEvents((prev) =>
        prev.map((e) => e.id !== taskId ? e : { ...e, start: startDate, end: newEnd })
      );
      return;
    }

    // Tâche planifiée déplacée manuellement
    setTaskOverrides((prev) => ({
      ...prev,
      [taskId]: { startTime: newStartTime, teachers, groups, rooms },
    }));
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
      setEnforcedEventsState((prev) =>
        prev.filter((e) => e.id !== `enforced-${courseKey}`)
      );
      const newMap = { ...enforcedMapRef.current };
      delete newMap[courseKey];
      enforcedMapRef.current = newMap;
      onEnforceChange?.({ ...newMap });
    }

    if (ext.isNeutralizedPlaced && info.event.id) {
      setPlacedNeutralizedEvents((prev) =>
        prev.filter((e) => e.id !== info.event.id)
      );
      onNeutralizedTaskRemoved?.(info.event.id);
    }
  }

  // Événements calendrier : solutions (avec overrides) + zones vide + imposés + neutralisés placés
  // + coloration des conflits de ressources (statique) ou prévisualisation pendant glissement
  const calendarEvents = useMemo(() => {
    const blockEvts = blockedZones.map((zone) => ({
      id: `blocked-${zone.id}`,
      start: zone.start,
      end: zone.end,
      backgroundColor: 'rgba(239,68,68)',
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

    // Ressources de tous les événements positionnés (hors zones vides) pour la détection de conflits
    const resourceEvents: ResourceEventInfo[] = [
      ...solEvts.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
        teachers: e.extendedProps.teachers ?? [],
        groups: e.extendedProps.groups ?? [],
        rooms: e.extendedProps.rooms ?? [],
      })),
      ...enforcedEventsState.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
        teachers: e.extendedProps.teachers ?? [],
        groups: e.extendedProps.groups ?? [],
        rooms: e.extendedProps.rooms ?? [],
      })),
      ...placedNeutralizedEvents.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
        teachers: e.extendedProps.teachers ?? [],
        groups: e.extendedProps.groups ?? [],
        rooms: e.extendedProps.rooms ?? [],
      })),
    ];

    // Durant le glissement : prévisualiser les conflits potentiels
    // Hors glissement : afficher les conflits réels entre événements placés
    const highlights = dragging
      ? computeDragHighlights(resourceEvents, dragging)
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

    return [
      ...solEvts.map(applyHighlight),
      ...blockEvts,
      ...enforcedEventsState.map(applyHighlight),
      ...placedNeutralizedEvents.map(applyHighlight),
    ];
  }, [solutions, blockedZones, monday, enforcedEventsState, taskOverrides, placedNeutralizedEvents, dragging]);

  return (
    <>
    <div className="flex-1 bg-white dark:bg-zinc-900 rounded-lg shadow overflow-hidden flex flex-col">
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
          // Interdit la sélection sur plusieurs jours
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

