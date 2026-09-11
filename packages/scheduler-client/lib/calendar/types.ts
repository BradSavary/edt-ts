import type { CourseTaskData } from '@edt-ts/scheduler-common';
import type { PlacementOrigin } from '@/store/types';

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
  /** Origine du placement (absent pour une zone bloquée, qui n'est pas un placement). */
  origin?: PlacementOrigin;
  /** `Placement.taskId` — résout le cours via `courseById`. `event.id` porte `placementId`. */
  taskId?: string;
  isBlockedZone?: boolean;
  blockedZoneId?: string;
  blockedZoneSource?: 'manual' | 'vacation' | 'public-holiday';
  blockedZoneLabel?: string;
  /** Indique que la tâche a été placée ou déplacée manuellement. */
  manuallyPlaced?: boolean;
  /** Violation de contrainte détectée au moment du placement. */
  constraintViolation?: 'red' | 'orange' | 'none';
  /** Commentaire libre du cours (repéré à l'écran, jamais transmis au moteur). */
  comment?: string;
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
  /** Surcharge par event de l'éditabilité globale FullCalendar (défaut : `editable` du calendrier). */
  editable?: boolean;
  extendedProps: CalendarEventExtProps;
}

export interface DraggingState {
  id: string;
  teachers: string[];
  groups: string[];
  rooms: string[];
}

export interface PendingEditData {
  /** `event.id` — identité du placement édité. */
  placementId: string;
  /** Tâche référencée — résout le cours (courseById). */
  taskId: string;
  title: string;
  teachers: string[];
  groups: string[];
  rooms: string[];
  startTime: number;
  durationMin: number;
  origin: PlacementOrigin;
  showDuration?: boolean;
  teacherOptions: string[];
  groupOptions: string[];
  roomOptions: string[];
  comment?: string;
}
