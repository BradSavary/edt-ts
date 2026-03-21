import { Task } from './task.ts';

/**
 * Gestionnaire d'un ensemble de tâches à planifier.
 */
export class TasksManager {
  private _tasks: Task[] = [];

  addTask(task: Task): void {
    this._tasks.push(task);
  }

  getAllTasks(): Task[] {
    return [...this._tasks];
  }

  getTaskCount(): number {
    return this._tasks.length;
  }
}
