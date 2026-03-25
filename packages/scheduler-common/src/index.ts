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
export { ResourcesManager } from './resourcesManager.ts';
export { TasksManager } from './tasksManager.ts';

// --- Gestionnaire de contraintes ---
export { AvailabilityManager } from './availabilityManager.ts';

// --- Données de planification ---
export { SchedulerData } from './schedulerData.ts';

// --- Types de données ---
export type { TimeSlot, ResourceConstraints, ConstraintsData, CourseTaskData, CoursesData, ResourceEntry, ResourceData, ResourceGroupData, RawScheduleData, TaskSolutionJSON, ScheduleSolutionJSON, EnforcedData } from './types.ts';
