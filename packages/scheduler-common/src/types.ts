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

/**
 * Placement imposé pour un cours : heure et ressources fixes, sans alternatives.
 * Prioritaire sur les disponibilités des ressources (peut générer un warning).
 */
export interface EnforcedData {
  startTime: number;   // Minutes depuis lundi minuit
  teacher: string[];   // IDs exacts, sans alternatives
  groups: string[];
  rooms: string[];
}

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
  enforced?: EnforcedData;
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

/**
 * Données brutes transmises à Loader.loadFromRawData() (mode API REST).
 * Correspond au corps JSON du POST /api/schedule.
 */
export interface RawScheduleData {
  week: number;
  resources: ResourceGroupData[];
  courses: CourseTaskData[];
  constraints?: ConstraintsData;
}

/**
 * Représentation JSON sérialisable d'une tâche planifiée.
 * Correspond à un élément du tableau `solutions` retourné par POST /api/schedule.
 */
export interface TaskSolutionJSON {
  taskId: string;
  code: string;
  name: string;
  type: string;
  week: number;
  duration: number;
  startTime: number;
  resources: { id: string; type: string }[];
}


export interface ScheduleSolutionJSON {
  solutions: TaskSolutionJSON[];
  isComplete: boolean;
  score?: number;
  neutralizedTasks?: TaskSolutionJSON[];
}