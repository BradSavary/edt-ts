import { Resource, ResourceType } from './resource.ts';
import { ResourcesManager } from './resourcesManager.ts';
import { TasksManager } from './tasksManager.ts';
import { AvailabilityManager } from './availabilityManager.ts';
import { Task } from './task.ts';
import type { ISchedulable } from './schedulable.ts';
import type { ResourceGroupData, CoursesData, ConstraintsData, ResourceEntry, TaskGroupDeclaration } from './types.ts';

/**
 * Conteneur des données nécessaires à la planification.
 *
 * Construit vide, il s'initialise en trois étapes indépendantes :
 *   1. `initResources()` — peuple le ResourcesManager
 *   2. `initConstraints()` — initialise l'AvailabilityManager
 *   3. `initTasks()` — construit les tâches et leurs dépendances
 *
 * `isReady` passe à `true` quand les trois étapes sont complètes.
 */
export class SchedulerData {
  protected _resourcesManager: ResourcesManager | null = null;
  protected _tasksManager: TasksManager | null = null;
  protected _availabilityManager: AvailabilityManager | null = null;
  protected _taskCounter: number = 0;
  protected _groups: TaskGroupDeclaration[] = [];

  get isReady(): boolean {
    return (
      this._resourcesManager !== null &&
      this._tasksManager !== null &&
      this._availabilityManager !== null
    );
  }

  get resourcesManager(): ResourcesManager | null {
    return this._resourcesManager;
  }

  get tasksManager(): TasksManager | null {
    return this._tasksManager;
  }

  get availabilityManager(): AvailabilityManager | null {
    return this._availabilityManager;
  }

  get groups(): TaskGroupDeclaration[] {
    return this._groups;
  }

  initGroups(groups: TaskGroupDeclaration[]): void {
    this._groups = groups;
  }

  /**
   * Initialise le ResourcesManager à partir d'un tableau de groupes de ressources.
   * Peuple automatiquement enseignants (avec leur info), salles et groupes.
   */
  initResources(resourcesData: ResourceGroupData[]): void {
    const manager = new ResourcesManager();
    for (const group of resourcesData) {
      for (const r of group.resources) {
        switch (group.resourceType) {
          case 'teacher': {
            const info = r.info ? (JSON.parse(r.info) as { status?: string }) : {};
            const res = new Resource(r.id, ResourceType.TEACHER, info.status);
            if (r.maxDailyMinutes !== undefined) res.maxDailyMinutes = r.maxDailyMinutes;
            manager.addResource(res);
            break;
          }
          case 'room': {
            const res = new Resource(r.id, ResourceType.ROOM);
            if (r.maxDailyMinutes !== undefined) res.maxDailyMinutes = r.maxDailyMinutes;
            manager.addResource(res);
            break;
          }
          case 'group': {
            const res = new Resource(r.id, ResourceType.GROUP);
            if (r.maxDailyMinutes !== undefined) res.maxDailyMinutes = r.maxDailyMinutes;
            manager.addResource(res);
            break;
          }
        }
      }
    }
    this._resourcesManager = manager;
  }

  /**
   * Crée et initialise l'AvailabilityManager avec les données de contraintes fournies.
   */
  initConstraints(data: ConstraintsData): void {
    this._availabilityManager = new AvailabilityManager(data);
  }

  /**
   * Construit le tableau de tâches à partir des données de cours.
   * Applique les contraintes hebdomadaires aux ressources et détermine les dépendances CM→TD→TP.
   * Requiert que `initResources()` ait été appelé au préalable.
   */
  initTasks(coursesData: CoursesData): void {
    if (!this._resourcesManager) {
      throw new Error('initResources() doit être appelé avant initTasks()');
    }

    const { weeks: week, courses } = coursesData;

    if (this._availabilityManager !== null) {
      this._resourcesManager.applyConstraintsForWeek(week, this._availabilityManager);
    }

    this._taskCounter = 0;
    const manager = new TasksManager();

    for (const courseData of courses) {
      const normalize = (arr: ResourceEntry[]): string[][] =>
        arr.map(item => (Array.isArray(item) ? item : [item]));

      const teacherGroups = normalize(courseData.teacher);
      const groupGroups   = normalize(courseData.groups);
      const roomGroups    = normalize(courseData.rooms);

      this._taskCounter++;
      const teacherIds = courseData.teacher.flat().join('_');
      const taskId = `${courseData.code}_${teacherIds}_${courseData.groups.flat().join('_')}_${this._taskCounter}`;
      const task = new Task(taskId, courseData, []);

      task.resources[ResourceType.TEACHER] = [];
      task.resources[ResourceType.ROOM]    = [];
      task.resources[ResourceType.GROUP]   = [];

      for (const teacherGroup of teacherGroups) {
        const group: Resource[] = [];
        for (const id of teacherGroup) {
          const r = this._resourcesManager.getResource(id);
          if (r) { group.push(r); r.addTask(task); }
        }
        if (group.length > 0) task.resources[ResourceType.TEACHER].push(group);
      }

      for (const roomGroup of roomGroups) {
        const group: Resource[] = [];
        for (const id of roomGroup) {
          const r = this._resourcesManager.getResource(id);
          if (r) { group.push(r); r.addTask(task); }
        }
        if (group.length > 0) task.resources[ResourceType.ROOM].push(group);
      }

      for (const groupGroup of groupGroups) {
        const group: Resource[] = [];
        for (const id of groupGroup) {
          const r = this._resourcesManager.getResource(id);
          if (r) { group.push(r); r.addTask(task); }
        }
        if (group.length > 0) task.resources[ResourceType.GROUP].push(group);
      }

      manager.addUnit(task);
    }

    this._determineDependencies(manager.getAllUnits());
    this._tasksManager = manager;
  }

  private _determineDependencies(units: ISchedulable[]): void {
    // Pour l'instant toutes les unités sont des Task — cast explicite pour accéder à getGroups()
    const tasks = units as Task[];
    const tasksByCode = new Map<string, Task[]>();
    for (const task of tasks) {
      const list = tasksByCode.get(task.code) ?? [];
      list.push(task);
      tasksByCode.set(task.code, list);
    }

    for (const codeTasks of tasksByCode.values()) {
      const cmTasks = codeTasks.filter(t => t.type === 'CM');
      const tdTasks = codeTasks.filter(t => t.type === 'TD');
      const tpTasks = codeTasks.filter(t => t.type === 'TP');

      for (const td of tdTasks) {
        const dep = this._findDependentTask(td, cmTasks);
        if (dep) td.setDependsOn(dep);
      }
      for (const tp of tpTasks) {
        const dep = this._findDependentTask(tp, tdTasks);
        if (dep) tp.setDependsOn(dep);
      }
    }
  }

  protected _findDependentTask(task: Task, candidates: Task[]): Task | null {
    const taskGroups = task.getGroups();
    for (const candidate of candidates) {
      const candidateGroups = candidate.getGroups();
      if (taskGroups.length > 0 && taskGroups.every(g => candidateGroups.includes(g))) {
        return candidate;
      }
    }
    return null;
  }
}
