'use client';

import { useState, useRef, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventContentArg, EventClickArg, EventApi } from '@fullcalendar/core';
import type { EventReceiveArg, EventDragStopArg } from '@fullcalendar/interaction';
import type { TaskSolutionJSON, CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import EnforceModal from './EnforceModal';
import type { EnforceSelection } from './EnforceModal';
import { getMondayOfISOWeek, startTimeToDate, formatTime, formatDate } from '../lib/calendarUtils';

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
}

interface Props {
  solutions: TaskSolutionJSON[];
  week: number;
  parsedCourses?: CourseTaskData[];
  onEnforceChange?: (map: Record<string, EnforcedData>) => void;
}

// ─── Composant local : détail d'un event cliqué ───────────────────────────────

interface EventDetailPopupProps {
  detail: EventDetail;
  onClose: () => void;
  onRemoveEnforced: (courseKey: string) => void;
}

function EventDetailPopup({ detail, onClose, onRemoveEnforced }: EventDetailPopupProps) {
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
      </div>
    </div>
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
  };
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

export default function ScheduleCalendar({ solutions, week, parsedCourses = [], onEnforceChange }: Props) {
  const monday = getMondayOfISOWeek(week);
  const [selected, setSelected] = useState<EventDetail | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarWrapperRef = useRef<HTMLDivElement | null>(null);
  // Ref vers l'event FullCalendar en cours de traitement (pendant modal)
  const pendingEventRef = useRef<EventApi | null>(null);
  // Map interne des cours imposés (source de vérité côté ScheduleCalendar)
  const enforcedMapRef = useRef<Record<string, EnforcedData>>({});

  // Quand des résultats arrivent, vider les events imposés du calendrier
  useEffect(() => {
    if (solutions.length > 0) {
      calendarRef.current?.getApi().getEvents().forEach((ev) => {
        if (ev.extendedProps.isEnforced) ev.remove();
      });
    }
  }, [solutions.length]);

  // Quand les cours changent (nouvelle semaine / nouveau CSV), tout réinitialiser
  const prevParsedCoursesRef = useRef<CourseTaskData[]>(parsedCourses);
  useEffect(() => {
    if (prevParsedCoursesRef.current !== parsedCourses) {
      prevParsedCoursesRef.current = parsedCourses;
      // Retirer tous les events imposés du calendrier
      calendarRef.current?.getApi().getEvents().forEach((ev) => {
        if (ev.extendedProps.isEnforced) ev.remove();
      });
      enforcedMapRef.current = {};
      onEnforceChange?.({});
    }
  }, [parsedCourses, onEnforceChange]);

  function confirmEnforce(courseKey: string, enforced: EnforcedData, event: EventApi) {
    const idx = parseInt(courseKey, 10);
    const course = parsedCourses[idx];
    const teacherStr = enforced.teacher.join(', ');

    event.setProp('id', `enforced-${courseKey}`);
    event.setProp('title', [course?.code ?? '?', course?.type ?? '', teacherStr].filter(Boolean).join(' • '));
    event.setProp('backgroundColor', '#22c55e');
    event.setProp('borderColor', '#16a34a');
    event.setProp('textColor', '#fff');
    event.setExtendedProp('name', course?.name ?? '');
    event.setExtendedProp('code', course?.code ?? '');
    event.setExtendedProp('type', course?.type ?? '');
    event.setExtendedProp('teachers', enforced.teacher);
    event.setExtendedProp('groups', enforced.groups);
    event.setExtendedProp('rooms', enforced.rooms);
    event.setExtendedProp('durationMin', course?.duration ?? 0);
    event.setExtendedProp('isEnforced', true);
    event.setExtendedProp('courseKey', courseKey);

    const newMap = { ...enforcedMapRef.current, [courseKey]: enforced };
    enforcedMapRef.current = newMap;
    onEnforceChange?.({ ...newMap });
  }

  function removeEnforced(courseKey: string) {
    calendarRef.current?.getApi().getEventById(`enforced-${courseKey}`)?.remove();
    const newMap = { ...enforcedMapRef.current };
    delete newMap[courseKey];
    enforcedMapRef.current = newMap;
    onEnforceChange?.({ ...newMap });
  }

  function handleEventClick(arg: EventClickArg) {
    const ext = arg.event.extendedProps as {
      name?: string;
      teachers?: string[];
      groups?: string[];
      rooms?: string[];
      code?: string;
      type?: string;
      durationMin?: number;
      isEnforced?: boolean;
      courseKey?: string;
    };
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
    });
  }

  function handleEventReceive(info: EventReceiveArg) {
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

  function handleEventDragStop(info: EventDragStopArg) {
    if (!info.event.extendedProps.isEnforced) return;

    const calEl = calendarWrapperRef.current;
    if (!calEl) return;

    const rect = calEl.getBoundingClientRect();
    const { clientX, clientY } = info.jsEvent as MouseEvent;
    const isOutside =
      clientX < rect.left || clientX > rect.right ||
      clientY < rect.top || clientY > rect.bottom;

    if (isOutside) {
      const courseKey = info.event.extendedProps.courseKey as string;
      info.event.remove();
      const newMap = { ...enforcedMapRef.current };
      delete newMap[courseKey];
      enforcedMapRef.current = newMap;
      onEnforceChange?.({ ...newMap });
    }
  }

  const solutionEvents = solutions.map((task) => {
    const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
    const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id);
    const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id);

    const start = startTimeToDate(monday, task.startTime);
    const end = new Date(start.getTime() + task.duration * 60 * 1000);

    return {
      id: task.taskId,
      title: [task.code, task.type, ...teachers].join(' • '),
      start,
      end,
      backgroundColor: '#22c55e',
      borderColor: '#16a34a',
      textColor: '#fff',
      extendedProps: {
        name: task.name,
        code: task.code,
        type: task.type,
        teachers,
        groups,
        rooms,
        durationMin: task.duration,
      },
    };
  });

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
        droppable={solutions.length === 0}
        editable={solutions.length === 0}
        events={solutionEvents}
        eventContent={renderEventContent}
        eventClick={handleEventClick}
        eventReceive={handleEventReceive}
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
    </>
  );
}

