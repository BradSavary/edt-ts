import { Availability } from './availability.ts';

// Référence forward pour éviter la dépendance circulaire resource ↔ task
// Task est uniquement utilisé pour typer le Set interne et les méthodes publiques
type TaskLike = { readonly id: string };

/**
 * Types de ressources disponibles
 */
const ResourceType = {
  TEACHER: 'teacher',
  ROOM: 'room',
  GROUP: 'group'
} as const;

export type ResourceType = typeof ResourceType[keyof typeof ResourceType];

/**
 * Classe représentant une ressource abstraite avec des plages de disponibilité
 * Une ressource peut être une salle, un équipement, une personne, etc.
 */
class Resource {
  public readonly id: string;
  public readonly type: ResourceType;
  public readonly status: string | undefined;
  private availabilityManager: Availability;
  private _tasks: Set<TaskLike> = new Set();

  constructor(id: string, type: ResourceType, status?: string) {
    this.id = id;
    this.type = type;
    this.status = type === ResourceType.TEACHER ? status : undefined;
    this.availabilityManager = new Availability();
  }

  /**
   * Retourne le gestionnaire de disponibilités de cette ressource
   */
  get availability(): Availability {
    return this.availabilityManager;
  }

  /**
   * Définit le gestionnaire de disponibilités de cette ressource
   */
  set availability(manager: Availability) {
    this.availabilityManager = manager;
  }

  /**
   * Retourne le type de cette ressource
   */
  get resourceType(): ResourceType {
    return this.type;
  }

  /**
   * Ajoute une tâche à l'index de cette ressource
   */
  addTask(task: TaskLike): void {
    this._tasks.add(task);
  }

  /**
   * Retourne toutes les tâches qui utilisent cette ressource
   */
  getTasks(): TaskLike[] {
    return Array.from(this._tasks);
  }

  /**
   * Réserve un créneau sur cette ressource.
   * Lève une erreur si le créneau n'est pas disponible.
   */
  book(start: number, end: number): void {
    this.availabilityManager.book(start, end);
  }

  /**
   * Calcule le temps total disponible pour cette ressource
   */
  getTotalAvailableTime(): number {
    return this.availabilityManager.getTotalAvailableTime();
  }

  /**
   * Retourne une représentation textuelle de la ressource et ses disponibilités
   */
  toString(): string {
    return `Resource(${this.id}): ${this.availabilityManager.toString()}`;
  }
}

export { Resource, ResourceType };
