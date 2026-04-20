import type { ISchedulable } from './schedulable.ts';

/**
 * Gestionnaire d'un ensemble d'unités planifiables (Task ou TaskGroup).
 */
export class TasksManager {
  private _units: ISchedulable[] = [];

  addUnit(unit: ISchedulable): void {
    this._units.push(unit);
  }

  getAllUnits(): ISchedulable[] {
    return [...this._units];
  }

  getUnitCount(): number {
    return this._units.length;
  }
}
