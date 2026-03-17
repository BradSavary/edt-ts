/**
 * Types partagés entre scheduler-common, scheduler-core et les applications clientes.
 * Ces types correspondent aux structures de données JSON utilisées pour les contraintes et les cours.
 */

export interface TimeSlot {
  days: string;
  from: string;
  to: string;
}

export interface ResourceConstraints {
  default?: TimeSlot[] | null;
  [weekKey: string]: TimeSlot[] | null | undefined; // S36, S38, etc.
}

export interface ConstraintsData {
  Default?: TimeSlot[];
  [resourceId: string]: TimeSlot[] | ResourceConstraints | null | undefined;
}

export interface CourseTaskData {
  week: number;
  semester: number;
  level: number;
  code: string;
  type: string;
  teacher: string[]; // Array of alternative teachers
  groups: string[];
  name: string;
  rooms: string[];
  duration: number;
}

export interface CoursesData {
  weeks: number;
  courses: CourseTaskData[];
}
