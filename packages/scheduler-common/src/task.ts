import { Resource, ResourceType } from './resource.ts';
import { Availability } from './availability.ts';
import type { CourseTaskData, EnforcedData } from './types.ts';

/** Type d'un groupe de tâches */
export type GroupType = 'parallel' | 'sequential';

/**
 * Classe représentant une tâche à planifier
 * Une tâche a une durée et peut nécessiter plusieurs ressources simultanément
 * Elle peut aussi dépendre d'autres tâches (ordre de planification)
 */
class Task {
 
  public readonly id: string;
  public readonly code: string;
  public readonly name: string;
  public readonly duration: number;
  public readonly type: string;
  public readonly week: number;
  public readonly semester: number;
  public readonly level: number;
  public readonly enforced: EnforcedData | undefined;
  public readonly taskGroupId: string | undefined;
  // Ressources actuellement appliquées à la tâche (une combinaison spécifique)
  private _appliedResources: Resource[] | null = null;
  // Ressources applicables à la tâche (ressources alternatives incluses)
  public readonly resources: { [K in ResourceType]: Resource[][] };
  private _schedulable: Availability | null = null;
  private dependsOn: Task | null = null;
  private dependentTasks: Task[] = [];

  // --- Groupe de tâches ---
  // Pour la représentante : type du groupe et liste des membres
  private _groupType: GroupType | null = null;
  private _groupMembers: Task[] = [];
  // Pour un membre : pointeur vers sa représentante
  private _groupRepresentative: Task | null = null;
  // Permet d'ignorer la propriété enforced (ex: groupe mixte enforced/non-enforced)
  private _enforcedOverridden: boolean = false;

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
    this.taskGroupId = courseData.taskGroupId;
 
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
    return this.enforced !== undefined && !this._enforcedOverridden;
  }

  /**
   * Ignore la propriété `enforced` de cette tâche.
   * Utilisé quand un groupe contient un mélange de tâches enforced et non-enforced.
   */
  overrideEnforced(): void {
    this._enforcedOverridden = true;
  }

  /**
   * Dissout le groupe dont cette tâche est la représentante.
   * Tous les membres redeviennent des tâches indépendantes.
   */
  dissolveGroup(): void {
    if (this._groupType === null) return;
    for (const member of this._groupMembers) {
      member._groupRepresentative = null;
    }
    this._groupType = null;
    this._groupMembers = [];
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

  setDependsOn(task: Task): void {
    if (task === this) {
      throw new Error('Une tâche ne peut pas dépendre d\'elle-même');
    }

    if (this.wouldCreateCircularDependency(task)) {
      throw new Error('Cette dépendance créerait une dépendance circulaire');
    }

    if (this.dependsOn) {
      this.dependsOn.removeDependentTask(this);
    }

    this.dependsOn = task;
    task.addDependentTask(this);
  } 

  getDependsOn(): Task | null {
    return this.dependsOn;
  }

  getDependentTasks(): Task[] {
    return [...this.dependentTasks];
  }

  hasDependentTasks(): boolean {
    return this.dependentTasks.length > 0;
  }

  private addDependentTask(task: Task): void {
    if (!this.dependentTasks.includes(task)) {
      this.dependentTasks.push(task);
    }
  }

  private removeDependentTask(task: Task): void {
    const index = this.dependentTasks.indexOf(task);
    if (index !== -1) {
      this.dependentTasks.splice(index, 1);
    }
  }

  private wouldCreateCircularDependency(task: Task): boolean {
    const visited = new Set<Task>();
    
    const checkDependency = (currentTask: Task): boolean => {
      if (visited.has(currentTask)) {
        return false;
      }
      
      if (currentTask === this) {
        return true;
      }
      
      visited.add(currentTask);
      
      for (const dependent of currentTask.dependentTasks) {
        if (checkDependency(dependent)) {
          return true;
        }
      }
      
      return false;
    };
    
    return checkDependency(task);
  }

  getTeacherResource(): Resource | null {
    return this.appliedResources.find(r => r.type === ResourceType.TEACHER) || null;
  }

  // ---------------------------------------------------------------------------
  // Groupe de tâches
  // ---------------------------------------------------------------------------

  /**
   * Déclare cette tâche comme représentante d'un groupe.
   * Ne peut être appelé qu'une fois (une tâche ne peut pas être représentante de deux groupes).
   */
  makeGroupRepresentative(type: GroupType): void {
    if (this._groupRepresentative !== null) {
      throw new Error(`La tâche "${this.name}" est déjà membre d'un groupe — elle ne peut pas être représentante.`);
    }
    if (this._groupType !== null) {
      throw new Error(`La tâche "${this.name}" est déjà représentante d'un groupe.`);
    }
    this._groupType = type;
  }

  /**
   * Ajoute une tâche membre à ce groupe.
   * La tâche cible devient membre de ce groupe (pointeur vers représentante).
   */
  addGroupMember(member: Task): void {
    if (this._groupType === null) {
      throw new Error(`La tâche "${this.name}" n'est pas représentante d'un groupe.`);
    }
    if (member === this) {
      throw new Error('Une tâche ne peut pas être membre de son propre groupe.');
    }
    if (member._groupRepresentative !== null || member._groupType !== null) {
      throw new Error(`La tâche "${member.name}" appartient déjà à un groupe.`);
    }
    member._groupRepresentative = this;
    this._groupMembers.push(member);
  }

  isGroupRepresentative(): boolean {
    return this._groupType !== null;
  }

  isGroupMember(): boolean {
    return this._groupRepresentative !== null;
  }

  getGroupType(): GroupType | null {
    return this._groupType;
  }

  getGroupRepresentative(): Task | null {
    return this._groupRepresentative;
  }

  getGroupMembers(): Task[] {
    return [...this._groupMembers];
  }

  /**
   * Transfère le rôle de représentante à une autre tâche du groupe.
   * `newRepresentative` doit être un membre actuel de ce groupe.
   * Après l'appel : `newRepresentative` est représentante, `this` devient membre.
   */
  transferGroupTo(newRepresentative: Task): void {
    if (this._groupType === null) {
      throw new Error(`La tâche "${this.name}" n'est pas représentante d'un groupe.`);
    }
    const idx = this._groupMembers.indexOf(newRepresentative);
    if (idx === -1) {
      throw new Error(`La tâche "${newRepresentative.name}" n'est pas membre du groupe de "${this.name}".`);
    }
    const type = this._groupType;
    const otherMembers = this._groupMembers.filter(m => m !== newRepresentative);

    // Réinitialiser l'ancienne représentante
    this._groupType = null;
    this._groupMembers = [];
    this._groupRepresentative = newRepresentative;

    // Configurer la nouvelle représentante
    newRepresentative._groupRepresentative = null;
    newRepresentative._groupType = type;
    newRepresentative._groupMembers = [this, ...otherMembers];

    // Mettre à jour le pointeur représentante des autres membres
    for (const m of otherMembers) {
      m._groupRepresentative = newRepresentative;
    }
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
