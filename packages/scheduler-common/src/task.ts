import { Resource, ResourceType } from './resource.ts';
import { Availability } from './availability.ts';
import type { AvailableSlot } from './availability.ts';
import type { CourseTaskData, EnforcedData } from './types.ts';

// ...définitions TaskStatus, TaskScheduleResult, etc...

/**
 * Statut d'une tâche dans le processus de planification
 */
const TaskStatus = {
  PENDING: 'pending',      // En attente de planification
  SCHEDULED: 'scheduled',  // Planifiée avec créneaux assignés
  COMPLETED: 'completed',  // Terminée
  CANCELLED: 'cancelled',   // Annulée
  FAILED: 'failed'       // Échec de la planification
} as const;

type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

/**
 * Résultat de planification d'une tâche
 */
interface TaskScheduleResult {
  success: boolean;
  scheduledSlot?: AvailableSlot;
  message?: string;
}

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
  public readonly groups: string[] = [];
  public readonly enforced: EnforcedData | undefined;
  // Ressources actuellement appliquées à la tâche (une combinaison spécifique)
  private _appliedResources: Resource[] | null = null;
  // Ressources applicables à la tâche (ressources alternatives incluses)
  public readonly resources: { [K in ResourceType]: Resource[][] };
  public readonly availableRooms: Resource[]; // Toutes les salles possibles pour cette tâche
  private status: TaskStatus;
  private scheduledSlot?: AvailableSlot;
  private _schedulable: Availability | null = null;
  private dependsOn: Task | null = null;
  private dependentTasks: Task[] = [];

  constructor(id: string, courseData: CourseTaskData, resources: Resource[] = [], availableRooms: Resource[] = []) {
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

    this.availableRooms = [...availableRooms];
    this.enforced = courseData.enforced;
    this.status = TaskStatus.PENDING;
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

  getRandomApplicableResources(): Resource[] | null {
    const allCombinations = this.getApplicableResources();
    if (allCombinations.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * allCombinations.length);
    return allCombinations[randomIndex];
  }

  isSchedulableConsistentWithResources(): boolean {
    const schedulable = this.schedulable;
    for (const resource of this.getAllResources()) {
      if (!schedulable.isFullyContainedIn(resource.availability)) {
        schedulable.displaySchedule();
        resource.availability.displaySchedule();
        console.log(`⚠️ Incohérence détectée pour la tâche '${this.name}' (${this.code}) avec la ressource '${resource.id}' (${resource.type})`);
        return false;
      }
    }
    return true;
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

  getStatus(): TaskStatus {
    return this.status;
  }

  getScheduledSlot(): AvailableSlot | undefined {
    return this.scheduledSlot;
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

  removeDependency(): void {
    if (this.dependsOn) {
      this.dependsOn.removeDependentTask(this);
      this.dependsOn = null;
    }
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

  canBeScheduled(): boolean {
    if (this.status !== TaskStatus.PENDING) {
      return false;
    }

    if (this.dependsOn && this.dependsOn.status !== TaskStatus.COMPLETED) {
      return false;
    }

    return true;
  }

  getEarliestStartTime(): number {
    if (!this.dependsOn) {
      return 0;
    }

    const dependencySlot = this.dependsOn.getScheduledSlot();
    if (!dependencySlot) {
      throw new Error(`La tâche ${this.dependsOn.id} doit être planifiée avant ${this.id}`);
    }

    return dependencySlot.end;
  }

  canBeScheduledAt(start: number): boolean {
    const end = start + this.duration;
    
    return this.appliedResources.every(resource => 
      resource.isAvailable(start, end)
    );
  }

  findNextAvailableSlot(afterTime: number = 0): AvailableSlot | null {
    if (!this.canBeScheduled()) {
      return null;
    }

    const earliestStart = Math.max(afterTime, this.getEarliestStartTime());

    if (this.appliedResources.length === 0) {
      return {
        start: earliestStart,
        end: earliestStart + this.duration
      };
    }

    return this.schedulable.findNextAvailableSlot(this.duration, earliestStart);
  }

  findAllAvailableSlots(): AvailableSlot[] {
    if (!this.canBeScheduled()) {
      return [];
    }

    const earliestStart = this.getEarliestStartTime();

    if (this.appliedResources.length === 0) {
      return [{
        start: earliestStart,
        end: earliestStart + this.duration,
        duration: this.duration
      }];
    }

    const allSlots = this.schedulable.findAvailableSlots(this.duration);
    return allSlots.filter(slot => slot.start >= earliestStart);
  }

  scheduleAt(start: number): TaskScheduleResult {
    if (!this.canBeScheduled()) {
      return {
        success: false,
        message: `La tâche ne peut pas être planifiée (statut: ${this.status}, dépendances non satisfaites)`
      };
    }

    const earliestStart = this.getEarliestStartTime();
    if (start < earliestStart) {
      return {
        success: false,
        message: `La tâche ne peut pas commencer avant ${earliestStart} (dépendance non terminée)`
      };
    }

    const end = start + this.duration;

    if (!this.canBeScheduledAt(start)) {
      return {
        success: false,
        message: 'Une ou plusieurs ressources ne sont pas disponibles à ce moment'
      };
    }

    try {
      this.appliedResources.forEach(resource => {
        resource.book(start, end);
      });

      this.scheduledSlot = { start, end };
      this.status = TaskStatus.SCHEDULED;

      return {
        success: true,
        scheduledSlot: this.scheduledSlot,
        message: 'Tâche planifiée avec succès'
      };

    } catch (error) {
      this.rollbackReservations(start, end);
      
      return {
        success: false,
        message: `Erreur lors de la planification: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
      };
    }
  }

  scheduleNext(afterTime: number = 0): TaskScheduleResult {
    const nextSlot = this.findNextAvailableSlot(afterTime);
    
    if (!nextSlot) {
      return {
        success: false,
        message: 'Aucun créneau disponible trouvé'
      };
    }

    return this.scheduleAt(nextSlot.start);
  }

  cancel(): void {
    if (this.status === TaskStatus.SCHEDULED && this.scheduledSlot) {
      this.appliedResources.forEach(resource => {
        resource.addAvailability(this.scheduledSlot!.start, this.scheduledSlot!.end);
      });
    }

    this.status = TaskStatus.CANCELLED;
    this.scheduledSlot = undefined;
  }

  complete(): void {
    if (this.status !== TaskStatus.SCHEDULED) {
      throw new Error('Seules les tâches planifiées peuvent être marquées comme terminées');
    }

    this.status = TaskStatus.COMPLETED;
  }

  private rollbackReservations(start: number, end: number): void {
    this.appliedResources.forEach(resource => {
      try {
        resource.addAvailability(start, end);
      } catch (error) {
        console.warn(`Erreur lors du rollback pour la ressource ${resource.id}:`, error);
      }
    });
  }

  addResource(resource: Resource): void {
    if (this.status !== TaskStatus.PENDING) {
      throw new Error('Impossible de modifier les ressources d\'une tâche déjà planifiée');
    }

    const arr = this.resources[resource.type];
    const exists = arr.some(group => group.includes(resource));
    if (!exists) {
      arr.push([resource]);
      resource.addTask(this);
      this.invalidateSchedulable();
    }
  }

  removeResource(resource: Resource): void {
    if (this.status !== TaskStatus.PENDING) {
      throw new Error('Impossible de modifier les ressources d\'une tâche déjà planifiée');
    }

    const arr = this.resources[resource.type];
    for (let i = 0; i < arr.length; i++) {
      const group = arr[i];
      const idx = group.indexOf(resource);
      if (idx !== -1) {
        group.splice(idx, 1);
        if (group.length === 0) {
          arr.splice(i, 1);
          i--;
        }
        resource.removeTask(this);
        this.invalidateSchedulable();
        break;
      }
    }
  }

  getAllDependentTasks(): Task[] {
    const allDependents = new Set<Task>();
    const visited = new Set<Task>();

    const collectDependents = (task: Task) => {
      if (visited.has(task)) return;
      visited.add(task);

      for (const dependent of task.dependentTasks) {
        allDependents.add(dependent);
        collectDependents(dependent);
      }
    };

    collectDependents(this);
    return Array.from(allDependents);
  }

  getDependencyChain(): Task[] {
    const chain: Task[] = [];
    let current = this.dependsOn;

    while (current) {
      chain.unshift(current);
      current = current.dependsOn;
    }

    return chain;
  }

  hasBlockedTasks(): boolean {
    return this.dependentTasks.length > 0 && this.status !== TaskStatus.COMPLETED;
  }

  getBlockedTasks(): Task[] {
    if (this.status === TaskStatus.COMPLETED) {
      return [];
    }
    return this.getAllDependentTasks().filter(task => task.status === TaskStatus.PENDING);
  }

  getAvailableRooms(): Resource[] {
    return [...this.availableRooms];
  }

  getCurrentRoom(): Resource | null {
    return this.appliedResources.find(r => r.type === ResourceType.ROOM) || null;
  }

  changeRoom(newRoom: Resource): boolean {
    if (this.status !== TaskStatus.PENDING) {
      console.warn('Impossible de changer la salle d\'une tâche déjà planifiée');
      return false;
    }

    if (!this.availableRooms.some(room => room.id === newRoom.id)) {
      console.warn(`La salle '${newRoom.id}' n'est pas dans les salles disponibles pour cette tâche`);
      return false;
    }

    const currentRoom = this.getCurrentRoom();
    if (currentRoom) {
      this.removeResource(currentRoom);
    }

    this.addResource(newRoom);
    return true;
  }

  getAlternativeRooms(): Resource[] {
    const currentRoom = this.getCurrentRoom();
    if (!currentRoom) {
      return this.getAvailableRooms();
    }
    return this.availableRooms.filter(room => room.id !== currentRoom.id);
  }

  getTeacherResource(): Resource | null {
    return this.appliedResources.find(r => r.type === ResourceType.TEACHER) || null;
  }

  toString(): string {
    const resourceIds = this.appliedResources.map(r => r.id).join(', ');
    const scheduledInfo = this.scheduledSlot 
      ? ` [${this.scheduledSlot.start}-${this.scheduledSlot.end}]`
      : '';
    
    const dependsOnInfo = this.dependsOn ? ` dépend de: ${this.dependsOn.id}` : '';
    const dependentsInfo = this.dependentTasks.length > 0 
      ? ` bloque: [${this.dependentTasks.map(t => t.id).join(', ')}]` 
      : '';
    
    return `Task(${this.id}: ${this.name}, durée: ${this.duration}, ressources: [${resourceIds}], statut: ${this.status})${scheduledInfo}${dependsOnInfo}${dependentsInfo}`;
  }
}

export { Task, TaskStatus };
export type { TaskScheduleResult };
