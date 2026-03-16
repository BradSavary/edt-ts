/**
 * scheduler-core — Point d'entrée public du moteur de planification.
 *
 * Exporte les classes, interfaces et types nécessaires pour
 * utiliser le moteur depuis un package externe (ex: scheduler-api).
 */

// --- Planificateurs ---
export { Schedule } from './schedule.js';
export { ScheduleAR } from './scheduleAR.js';
export type { ScheduleSolution, TaskSolution } from './schedule.js';

// --- Modèles de données ---
export { Task, TaskStatus } from './task.js';
export { Resource, ResourceType } from './resource.js';
export { ResourcesManager } from './resourcesManager.js';

// --- Gestionnaires ---
export { Loader } from './lib/loader.js';
export { ConstraintsManager } from './constraintsManager.js';

// --- Analyse ---
export { ScheduleAnalysis } from './scheduleAnalysis.js';

// --- Types ---
export type {
  TimeSlot,
  ConstraintsData,
  CourseTaskData,
  CoursesData,
  TeacherConstraints,
} from './lib/loader.js';
export type { RawScheduleData } from './lib/loader.js';
export type { AvailableSlot } from './bookable.js';
