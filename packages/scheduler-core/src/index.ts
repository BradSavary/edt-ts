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
export { Task, TaskStatus } from '@edt-ts/scheduler-common';
export { Resource, ResourceType } from '@edt-ts/scheduler-common';
export { ResourcesManager } from '@edt-ts/scheduler-common';

// --- Gestionnaires ---
export { Loader } from './lib/loader.js';
export { ConstraintsManager } from '@edt-ts/scheduler-common';

// --- Analyse ---
export { ScheduleAnalysis } from './scheduleAnalysis.js';

// --- Types ---
export type { TimeSlot, ResourceConstraints, ConstraintsData, CourseTaskData, CoursesData } from '@edt-ts/scheduler-common';
export type { TeacherConstraints } from './lib/loader.js';
export type { RawScheduleData } from './lib/loader.js';
export type { AvailableSlot } from '@edt-ts/scheduler-common';
