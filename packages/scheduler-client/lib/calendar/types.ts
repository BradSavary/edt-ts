import type { CourseTaskData } from '@edt-ts/scheduler-common';

// ── Types FullCalendar partagés ────────────────────────────────────────────

export interface PendingDrop {
  courseKey: string;
  startTime: number;
  course: CourseTaskData;
}

export interface PendingNeutralizedDrop {
  taskId: string;
  code: string;
  name: string;
  type: string;
  startTime: number;
  durationMin: number;
  teachers: string[];
  groups: string[];
  rooms: string[];
  course: CourseTaskData;
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
  blockedZoneSource?: 'manual' | 'vacation' | 'public-holiday';
  blockedZoneLabel?: string;
  /** Indique que la tâche a été placée ou déplacée manuellement. */
  manuallyPlaced?: boolean;
  /** Violation de contrainte détectée au moment du placement. */
  constraintViolation?: 'red' | 'orange' | 'none';
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
  showDuration?: boolean;
  teacherOptions: string[];
  groupOptions: string[];
  roomOptions: string[];
}
