import { Resource, ResourceType } from './resource.ts';
import { Availability } from './availability.ts';
import type { CourseTaskData, EnforcedData } from './types.ts';
import type { ISchedulable } from './schedulable.ts';

/**
 * Classe représentant une tâche à planifier
 * Une tâche a une durée et peut nécessiter plusieurs ressources simultanément
 * Elle peut aussi dépendre d'autres tâches (ordre de planification)
 */
class Task implements ISchedulable {
 
  public readonly id: string;
  public readonly code: string;
  public readonly name: string;
  public readonly duration: number;
  public readonly type: string;
  public readonly week: number;
  public readonly semester: number;
  public readonly level: number;
  public readonly enforced: EnforcedData | undefined;
  // Ressources actuellement appliquées à la tâche (une combinaison spécifique)
  private _appliedResources: Resource[] | null = null;
  // Ressources applicables à la tâche (ressources alternatives incluses)
  public readonly resources: { [K in ResourceType]: Resource[][] };
  private _schedulable: Availability | null = null;
  private dependsOn: ISchedulable | null = null;
  private dependentUnits: ISchedulable[] = [];

  constructor(id: string, courseData: CourseTaskData, resources: Resource[] = []) {
    if (courseData.duration <= 0) {
      throw new Error('La durée de la tâche doit être positive');
    }
    this.id = id;
    this.code = courseData.code;
    this.name = courseData.name;
    this.duration = courseData.duration;
    this.type = courseData.type;
    this.week = courseData.week;
    this.semester = courseData.semester;
    this.level = courseData.level;
 
    this.resources = {
      [ResourceType.TEACHER]: [],
      [ResourceType.ROOM]: [],
      [ResourceType.GROUP]: []
    };
    resources.forEach(resource => {
      this.resources[resource.type].push([resource]);
      resource.addTask(this);
    });

    this.enforced = courseData.enforced;
  }

  get isEnforced(): boolean {
    return this.enforced !== undefined;
  }

  get schedulable(): Availability {
    if (this._schedulable === null) {
      this._schedulable = this._computeSchedulable();
    }
    return this._schedulable;
  }

  get appliedResources(): Resource[] {
    return (this._appliedResources || []) as Resource[];
  }

  set appliedResources(resources: Resource[] | null) {
    this._appliedResources = resources;
    this.invalidateSchedulable();
  }

  invalidateSchedulable(): void {
    this._schedulable = null;
  }

  getAllResources(): Resource[] {
    return this.appliedResources;
  }

  getApplicableResources(): Resource[][] {
    const allGroups: Resource[][] = [
      ...this.resources[ResourceType.TEACHER],
      ...this.resources[ResourceType.ROOM],
      ...this.resources[ResourceType.GROUP]
    ];
    
    if (allGroups.length === 0) return [];

    function cartesian(arrays: Resource[][]): Resource[][] {
      return arrays.reduce<Resource[][]>((acc, curr) => {
        if (acc.length === 0) {
          return curr.map(resource => [resource]);
        }
        const result: Resource[][] = [];
        for (const combination of acc) {
          for (const resource of curr) {
            result.push([...combination, resource]);
          }
        }
        return result;
      }, []);
    }

    return cartesian(allGroups);
  }

  private _computeSchedulable(): Availability {
    const allResources = this.getAllResources();
    if (allResources.length === 0) {
      return new Availability();
    }

    let result = allResources[0].availability.copy();
    for (let i = 1; i < allResources.length; i++) {
      result = result.intersect(allResources[i].availability);
      if (result.isEmpty()) {
        break;
      }
    }
    return result;
  }

  getGroups(): string[] {
    return this.resources[ResourceType.GROUP]
      .map(arr => arr.join(', '));
  }

  setDependsOn(unit: ISchedulable): void {
    if (unit === this) {
      throw new Error('Une tâche ne peut pas dépendre d\'elle-même');
    }

    if (this.wouldCreateCircularDependency(unit)) {
      throw new Error('Cette dépendance créerait une dépendance circulaire');
    }

    if (this.dependsOn) {
      this.dependsOn._removeDependentUnit(this);
    }

    this.dependsOn = unit;
    unit._addDependentUnit(this);
  }

  getDependsOn(): ISchedulable | null {
    return this.dependsOn;
  }

  getDependentUnits(): ISchedulable[] {
    return [...this.dependentUnits];
  }

  hasDependentUnits(): boolean {
    return this.dependentUnits.length > 0;
  }

  /** @internal — appelé uniquement par setDependsOn */
  _addDependentUnit(unit: ISchedulable): void {
    if (!this.dependentUnits.includes(unit)) {
      this.dependentUnits.push(unit);
    }
  }

  /** @internal — appelé uniquement par setDependsOn */
  _removeDependentUnit(unit: ISchedulable): void {
    const index = this.dependentUnits.indexOf(unit);
    if (index !== -1) {
      this.dependentUnits.splice(index, 1);
    }
  }

  private wouldCreateCircularDependency(unit: ISchedulable): boolean {
    const visited = new Set<ISchedulable>();

    const checkDependency = (current: ISchedulable): boolean => {
      if (visited.has(current)) return false;
      if (current === this) return true;
      visited.add(current);
      for (const dependent of current.getDependentUnits()) {
        if (checkDependency(dependent)) return true;
      }
      return false;
    };

    return checkDependency(unit);
  }

  getTeacherResource(): Resource | null {
    return this.appliedResources.find(r => r.type === ResourceType.TEACHER) || null;
  }

  /**
   * Vérifie si le schedulable de la tâche contient au moins un créneau
   * d'une durée >= à la durée de la tâche (avec les ressources actuellement appliquées)
   */
  hasSchedulableSlot(): boolean {
    return this.schedulable.hasSlotOfDuration(this.duration);
  }

}

export { Task };
