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
  default?: TimeSlot[];
  [weekKey: string]: TimeSlot[] | undefined; // S36, S38, etc. — toujours un tableau si présent
}

export interface ConstraintsData {
  Default?: TimeSlot[];
  [resourceId: string]: TimeSlot[] | ResourceConstraints | undefined;
}

/**
 * Un élément de ressource est soit un identifiant unique (string),
 * soit un groupe d'alternatives dont une seule sera choisie (string[]).
 *
 * Convention : [A, [B, C]] signifie A ET (B OU C).
 */
export type ResourceEntry = string | string[];

export interface CourseTaskData {
  week: number;
  semester: number;
  level: number;
  code: string;
  type: string;
  teacher: ResourceEntry[];
  groups: ResourceEntry[];
  name: string;
  rooms: ResourceEntry[];
  duration: number;
}

export interface CoursesData {
  weeks: number;
  courses: CourseTaskData[];
}

export interface ResourceData {
  id: string;
  info?: string; // JSON string pour les métadonnées spécifiques au type (ex: '{"status":"VACATAIRE"}')
}

export interface ResourceGroupData {
  resourceType: 'teacher' | 'room' | 'group';
  resources: ResourceData[];
}
