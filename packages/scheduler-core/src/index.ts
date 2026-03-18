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
export { TasksManager } from '@edt-ts/scheduler-common';

// --- Gestionnaires ---
export { Loader } from './loader.js';
export { AvailabilityManager } from '@edt-ts/scheduler-common';
export { SchedulerData } from '@edt-ts/scheduler-common';

// --- Analyse ---
export { ScheduleAnalysis } from './scheduleAnalysis.js';

// --- Types ---
export type { TimeSlot, ResourceConstraints, ConstraintsData, CourseTaskData, CoursesData, ResourceGroupData, ResourceData, RawScheduleData } from '@edt-ts/scheduler-common';
export type { AvailableSlot } from '@edt-ts/scheduler-common';
