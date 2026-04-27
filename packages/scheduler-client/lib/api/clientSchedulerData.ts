import { SchedulerData, Task } from '@edt-ts/scheduler-common';
import type { CourseTaskData } from '@edt-ts/scheduler-common';

/**
 * Sous-classe client de SchedulerData permettant de charger l'ensemble
 * des cours (toutes semaines) sans appliquer de contraintes hebdomadaires
 * sur les ressources.
 *
 * Usage :
 *   const data = new ClientSchedulerData();
 *   data.initResources(resourcesData);
 *   data.initConstraints(constraintsData); // optionnel
 *   data.initAllTasks(allCourses);         // ← toutes semaines
 *   data.getTasksForWeek(47);              // ← filtre par semaine
 */
export class ClientSchedulerData extends SchedulerData {
  /**
   * Charge toutes les tâches sans appliquer de contraintes hebdomadaires
   * sur les ressources (pas d'appel à `applyConstraintsForWeek`).
   * Requiert que `initResources()` ait été appelé au préalable.
   */
  initAllTasks(courses: CourseTaskData[]): void {
    const savedAM = this._availabilityManager;
    this._availabilityManager = null; // skip applyConstraintsForWeek in super
    super.initTasks({ weeks: 0, courses });
    this._availabilityManager = savedAM;
  }

  /**
   * Retourne les tâches correspondant à une semaine ISO donnée.
   */
  getTasksForWeek(week: number): Task[] {
    return (this._tasksManager?.getAllUnits().filter(t => t.week === week) ?? []) as Task[];
  }
}
