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
export { Task, TaskStatus } from './model/task.js';
export { Resource, ResourceType } from './model/resource.js';
export { ResourcesManager } from './model/resourcesManager.js';

// --- Gestionnaires ---
export { Loader } from './lib/loader.js';
export { ConstraintsManager } from './model/constraintsManager.js';

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
export type { AvailableSlot } from './model/bookable.js';
