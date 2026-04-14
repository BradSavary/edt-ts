'use client';

import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventContentArg } from '@fullcalendar/core';
import type { TaskSolutionJSON, CourseTaskData } from '@edt-ts/scheduler-common';
import EnforceModal from '@/components/planning/modals/EnforceModal';
import TaskEditModal from '@/components/planning/modals/TaskEditModal';
import { formatTime, formatDate } from '@/lib/calendarUtils';
import { useCalendarCore } from '@/hooks/useCalendarCore';
import type { EventDetail } from '@/hooks/useCalendarCore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface Props {
  solutions: TaskSolutionJSON[];
  parsedCourses?: CourseTaskData[];
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

export default function ScheduleCalendar({ solutions, parsedCourses = [] }: Props) {
  const {
    week,
    monday,
    calendarRef,
    calendarWrapperRef,
    calendarEvents,
    selected,
    setSelected,
    pendingDrop,
    pendingEdit,
    setPendingEdit,
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
    handleEditRequest,
    handleEditConfirm,
  } = useCalendarCore(solutions, parsedCourses);

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
