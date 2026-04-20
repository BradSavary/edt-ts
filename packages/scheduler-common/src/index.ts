/**
 * scheduler-common — Logique métier partagée, indépendante de Node.js.
 *
 * Utilisable dans scheduler-core (Node.js), scheduler-api (Express),
 * et les applications clientes (browser/Next.js).
 */

// --- Modèles de disponibilité ---
export { Availability } from './availability.ts';
export type { AvailableSlot } from './availability.ts';

// --- Modèles de ressources et tâches ---
export { Resource, ResourceType } from './resource.ts';
export { Task } from './task.ts';
export type { ISchedulable } from './schedulable.ts';
export { ResourcesManager } from './resourcesManager.ts';
export { TasksManager } from './tasksManager.ts';

// --- Gestionnaire de contraintes ---
export { AvailabilityManager } from './availabilityManager.ts';

// --- Données de planification ---
export { SchedulerData } from './schedulerData.ts';

// --- Types de données ---
export type { TimeSlot, ResourceConstraints, ConstraintsData, CourseTaskData, CoursesData, ResourceEntry, ResourceData, ResourceGroupData, RawScheduleData, TaskSolutionJSON, ScheduleSolutionJSON, NeutralizedTaskInfoJSON, ResourceAvailabilitySnapshotJSON, EnforcedData, SchedulerConfig, LunchBreakConfig, LunchBreakNone, LunchBreakFixed, LunchBreakFloating } from './types.ts';
export { DEFAULT_SCHEDULER_CONFIG } from './types.ts';
