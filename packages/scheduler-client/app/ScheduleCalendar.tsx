'use client';

import { useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import type { EventContentArg, EventClickArg } from '@fullcalendar/core';
import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';

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
}

interface Props {
  solutions: TaskSolutionJSON[];
  week: number;
}

/**
 * Calcule le lundi de la semaine ISO donnée.
 * Gestion de l'année universitaire : semaines >= 35 = année N-1 si on est en Jan-Août.
 */
function getMondayOfISOWeek(isoWeek: number): Date {
  const now = new Date();
  const year = now.getMonth() < 8 && isoWeek >= 35 ? now.getFullYear() - 1 : now.getFullYear();
  // Le 4 janvier est toujours dans la semaine ISO 1
  const jan4 = new Date(year, 0, 4);
  const jan4DayOfWeek = jan4.getDay() === 0 ? 7 : jan4.getDay(); // 1=Lun … 7=Dim
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - (jan4DayOfWeek - 1) + (isoWeek - 1) * 7);
  return monday;
}

/**
 * Convertit startTime (minutes depuis lundi minuit) en objet Date absolu.
 */
function toEventDate(monday: Date, startTimeMinutes: number): Date {
  const dayOffset = Math.floor(startTimeMinutes / (24 * 60));
  const minutesInDay = startTimeMinutes % (24 * 60);
  const date = new Date(monday);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(Math.floor(minutesInDay / 60), minutesInDay % 60, 0, 0);
  return date;
}

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
  return `${DAY_LABELS[date.getDay()]} ${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
}

function renderEventContent(info: EventContentArg) {
  const props = info.event.extendedProps as {
    name: string;
    groups: string[];
    rooms: string[];
    durationMin: number;
  };
  return (
    <div className="px-1 py-0.5 text-xs overflow-hidden leading-tight h-full">
      <div className="font-semibold truncate">{info.event.title}</div>
      <div className="truncate opacity-90">{props.name}</div>
      {props.groups.length > 0 && (
        <div className="truncate opacity-80">{props.groups.join(', ')}</div>
      )}
      {props.rooms.length > 0 && (
        <div className="truncate opacity-80">{props.rooms.join(', ')}</div>
      )}
    </div>
  );
}

export default function ScheduleCalendar({ solutions, week }: Props) {
  const monday = getMondayOfISOWeek(week);
  const [selected, setSelected] = useState<EventDetail | null>(null);

  function handleEventClick(arg: EventClickArg) {
    const ext = arg.event.extendedProps as {
      name: string;
      teachers: string[];
      groups: string[];
      rooms: string[];
      code: string;
      type: string;
      durationMin: number;
    };
    setSelected({
      title: arg.event.title,
      name: ext.name,
      code: ext.code,
      type: ext.type,
      teachers: ext.teachers,
      groups: ext.groups,
      rooms: ext.rooms,
      start: arg.event.start!,
      end: arg.event.end!,
      durationMin: ext.durationMin,
    });
  }

  const events = solutions.map((task) => {
    const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
    const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id);
    const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id);

    const start = toEventDate(monday, task.startTime);
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
    <div className="flex-1 bg-white dark:bg-zinc-900 rounded-lg shadow overflow-hidden flex flex-col">
      <div className="flex-1 min-h-0">
      <FullCalendar
        key={week}
        plugins={[timeGridPlugin]}
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
        events={events}
        eventContent={renderEventContent}
        eventClick={handleEventClick}
        height="100%"
        expandRows
      />
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-black dark:text-white">
                  {selected.code} {selected.type} — {selected.teachers.join(', ')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{selected.name}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Date</dt>
                <dd className="text-black dark:text-white">{formatDate(selected.start)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Horaire</dt>
                <dd className="text-black dark:text-white">
                  {formatTime(selected.start)} – {formatTime(selected.end)}
                </dd>
              </div>
              {selected.groups.length > 0 && (
                <div className="flex gap-2">
                  <dt className="font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Groupes</dt>
                  <dd className="text-black dark:text-white">{selected.groups.join(', ')}</dd>
                </div>
              )}
              {selected.rooms.length > 0 && (
                <div className="flex gap-2">
                  <dt className="font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Salle</dt>
                  <dd className="text-black dark:text-white">{selected.rooms.join(', ')}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
