'use client';

import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventContentArg } from '@fullcalendar/core';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { Placement, PlacementOrigin } from '@/store/types';
import EnforceModal from '@/components/planning/modals/EnforceModal';
import TaskEditModal from '@/components/planning/modals/TaskEditModal';
import { useCalendarCore } from '@/hooks/useCalendarCore';

interface Props {
  placements: Placement[];
  parsedCourses?: CourseTaskDataWithId[];
}

function renderEventContent(info: EventContentArg) {
  const props = info.event.extendedProps as {
    name?: string;
    groups?: string[];
    rooms?: string[];
    durationMin?: number;
    origin?: PlacementOrigin;
    isBlockedZone?: boolean;
    blockedZoneSource?: 'manual' | 'vacation' | 'public-holiday';
    blockedZoneLabel?: string;
    manuallyPlaced?: boolean;
    constraintViolation?: 'red' | 'orange' | 'none';
  };

  if (props.isBlockedZone) {
    const source = props.blockedZoneSource;
    const label = props.blockedZoneLabel;
    const title = source === 'vacation' ? 'Vacances' : source === 'public-holiday' ? 'Jour férié' : 'Zone vide';
    return (
      <div className="px-1 py-0.5 text-xs overflow-hidden leading-tight h-full flex items-start gap-1 cursor-pointer select-none">
        <span className="shrink-0">🚫</span>
        <div>
          <div className="font-semibold">{label ?? title}</div>
          <div className="opacity-60">Clic pour retirer</div>
        </div>
      </div>
    );
  }

  const groups = props.groups ?? [];
  const rooms = props.rooms ?? [];

  // Badge de placement manuel
  let badgeColor = '';
  let badgeTitle = '';
  if (props.manuallyPlaced) {
    if (props.constraintViolation === 'red') {
      badgeColor = 'bg-red-500 border-red-800';
      badgeTitle = 'Contrainte enseignant non respectée';
    } else if (props.constraintViolation === 'orange') {
      badgeColor = 'bg-orange-400 border-orange-700';
      badgeTitle = 'Contrainte salle/groupe non respectée';
    } else {
      badgeColor = 'bg-blue-500 border-blue-800';
      badgeTitle = 'Placé manuellement';
    }
  }

  return (
    <div className="px-1 py-0.5 text-xs overflow-hidden leading-tight h-full relative">
      {props.manuallyPlaced && (
        <span
          className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full border-2 ${badgeColor} z-10`}
          title={badgeTitle}
        />
      )}
      <div className="font-semibold truncate flex items-center gap-1">
        {props.origin === 'pre-enforced' && <span title="Imposé">📌</span>}
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

export default function ScheduleCalendar({ placements, parsedCourses = [] }: Props) {
  const {
    week,
    monday,
    calendarRef,
    calendarWrapperRef,
    calendarEvents,
    hasSolution,
    pendingDrop,
    pendingEdit,
    setPendingEdit,
    pendingNeutralizedDrop,
    handleSelect,
    handleDateClick,
    handleEventClick,
    handleEventDragStart,
    handleEventDrop,
    handleEventDragStop,
    handleEventReceive,
    removeEnforced,
    handleModalConfirm,
    handleModalCancel,
    handleNeutralizedPlaceConfirm,
    handleNeutralizedPlaceCancel,
    handleEditConfirm,
  } = useCalendarCore(placements, parsedCourses);

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
            eventDurationEditable={false}
            selectable={!hasSolution}
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
            dragRevertDuration={0}
            height="100%"
            expandRows
          />
        </div>

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

      {pendingNeutralizedDrop && (
        <EnforceModal
          courseKey={pendingNeutralizedDrop.taskId}
          course={pendingNeutralizedDrop.course}
          startTime={pendingNeutralizedDrop.startTime}
          title="Placer la tâche"
          onConfirm={handleNeutralizedPlaceConfirm}
          onCancel={handleNeutralizedPlaceCancel}
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
          isEnforced={pendingEdit.origin === 'pre-enforced'}
          allowAlternatives={false}
          duration={pendingEdit.durationMin}
          showDuration={pendingEdit.showDuration}
          onRemoveEnforced={
            pendingEdit.origin === 'pre-enforced'
              ? () => { removeEnforced(pendingEdit.taskId); setPendingEdit(null); }
              : undefined
          }
          onConfirm={handleEditConfirm}
          onCancel={() => setPendingEdit(null)}
        />
      )}
    </>
  );
}
