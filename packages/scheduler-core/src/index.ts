/**
 * scheduler-core — Point d'entrée public du moteur de planification.
 *
 * Exporte les classes, interfaces et types nécessaires pour
 * utiliser le moteur depuis un package externe (ex: scheduler-api).
 */

// --- Planificateur ---
export { Scheduler } from './scheduler.js';
export type { SchedulerSolution, NeutralizedUnitInfo } from './scheduler.js';
export { TaskUnit } from './taskUnit.js';
export { TaskGroupUnit } from './taskGroupUnit.js';
export type { ISchedulingUnit, SchedulingResult, UnitSolution } from './schedulingUnit.js';

// --- Modèles de données ---
export { Task } from '@edt-ts/scheduler-common';
export { Resource, ResourceType } from '@edt-ts/scheduler-common';
export { ResourcesManager } from '@edt-ts/scheduler-common';
export { TasksManager } from '@edt-ts/scheduler-common';

// --- Gestionnaires ---
export { Loader } from './loader.js';
export { AvailabilityManager } from '@edt-ts/scheduler-common';
export { SchedulerData } from '@edt-ts/scheduler-common';

// --- Types ---
export type { TimeSlot, ResourceConstraints, ConstraintsData, CourseTaskData, CoursesData, ResourceGroupData, ResourceData, RawScheduleData } from '@edt-ts/scheduler-common';
export type { AvailableSlot } from '@edt-ts/scheduler-common';
