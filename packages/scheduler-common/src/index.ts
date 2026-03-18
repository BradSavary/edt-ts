/**
 * scheduler-common — Logique métier partagée, indépendante de Node.js.
 *
 * Utilisable dans scheduler-core (Node.js), scheduler-api (Express),
 * et les applications clientes (browser/Next.js).
 */

// --- Modèles de disponibilité ---
export { TimeInterval, AvailabilityManager, TimestampUtils, formatTimestamp, formatInterval, formatIntervals } from './bookable.ts';
export type { AvailableSlot } from './bookable.ts';

// --- Modèles de ressources et tâches ---
export { Resource, ResourceType } from './resource.ts';
export { Task, TaskStatus } from './task.ts';
export type { TaskScheduleResult } from './task.ts';
export { ResourcesManager } from './resourcesManager.ts';
export { TasksManager } from './tasksManager.ts';

// --- Gestionnaire de contraintes ---
export { ConstraintsManager } from './constraintsManager.ts';

// --- Données de planification ---
export { SchedulerData } from './schedulerData.ts';

// --- Types de données ---
export type { TimeSlot, ResourceConstraints, ConstraintsData, CourseTaskData, CoursesData, ResourceEntry, ResourceData, ResourceGroupData } from './types.ts';
