import { Task } from './task.ts';

/**
 * Gestionnaire d'un ensemble de tâches à planifier.
 * Analogue à ResourcesManager : encapsule un tableau de Task et expose
 * des méthodes d'accès et de filtrage.
 */
export class TasksManager {
  private _tasks: Task[] = [];

  addTask(task: Task): void {
    this._tasks.push(task);
  }

  getTask(id: string): Task | undefined {
    return this._tasks.find(t => t.id === id);
  }

  hasTask(id: string): boolean {
    return this._tasks.some(t => t.id === id);
  }

  removeTask(id: string): boolean {
    const index = this._tasks.findIndex(t => t.id === id);
    if (index === -1) return false;
    this._tasks.splice(index, 1);
    return true;
  }

  getAllTasks(): Task[] {
    return [...this._tasks];
  }

  getTaskCount(): number {
    return this._tasks.length;
  }

  isEmpty(): boolean {
    return this._tasks.length === 0;
  }

  clear(): void {
    this._tasks = [];
  }

  findTasks(predicate: (task: Task) => boolean): Task[] {
    return this._tasks.filter(predicate);
  }

  findTask(predicate: (task: Task) => boolean): Task | undefined {
    return this._tasks.find(predicate);
  }

  getByCode(code: string): Task[] {
    return this._tasks.filter(t => t.code === code);
  }

  getByType(type: string): Task[] {
    return this._tasks.filter(t => t.type === type);
  }

  forEach(callback: (task: Task, index: number) => void): void {
    this._tasks.forEach(callback);
  }

  toString(): string {
    return `TasksManager(${this._tasks.length} tâches)`;
  }
}
