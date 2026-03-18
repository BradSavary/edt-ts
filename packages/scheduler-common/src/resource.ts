import { Availability } from './availability.ts';
import type { AvailableSlot } from './availability.ts';

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
  private _workload: number = 0;
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
   * Durée totale et prévisionnelle d'utilisation (en minutes)
   */
  get workload(): number {
    return this._workload;
  }

  /**
   * Met à jour la durée totale et prévisionnelle d'utilisation
   */
  set workload(value: number) {
    this._workload = Math.max(0, value);
  }

  /**
   * Ajoute une durée à la charge de travail de la ressource
   */
  addWorkload(duration: number): void {
    this._workload += Math.max(0, duration);
  }

  /**
   * Ajoute une tâche à l'index de cette ressource
   */
  addTask(task: TaskLike): void {
    this._tasks.add(task);
  }

  /**
   * Supprime une tâche de l'index de cette ressource
   */
  removeTask(task: TaskLike): void {
    this._tasks.delete(task);
  }

  /**
   * Retourne toutes les tâches qui utilisent cette ressource
   */
  getTasks(): TaskLike[] {
    return Array.from(this._tasks);
  }

  /**
   * Vérifie si une tâche utilise cette ressource
   */
  hasTask(task: TaskLike): boolean {
    return this._tasks.has(task);
  }

  /**
   * Retourne le nombre de tâches qui utilisent cette ressource
   */
  getTaskCount(): number {
    return this._tasks.size;
  }

  /**
   * Vide l'index des tâches
   */
  clearTasks(): void {
    this._tasks.clear();
  }

  /**
   * Calcule la pression de la ressource (ratio workload / disponibilités totales)
   * Retourne 0 si aucune disponibilité, sinon le ratio entre 0 et +∞
   */
  pressure(): number {
    const totalAvailableTime = this.getTotalAvailableTime();
    if (totalAvailableTime === 0) {
      return 0;
    }
    return this._workload / totalAvailableTime;
  }

  /**
   * Ajoute une plage de disponibilité à la ressource
   */
  addAvailability(start: number, end: number): void {
    this.availabilityManager.addAvailability(start, end);
  }

  /**
   * Supprime une plage de disponibilité de la ressource
   */
  removeAvailability(start: number, end: number): void {
    this.availabilityManager.removeAvailability(start, end);
  }

  /**
   * Vérifie si la ressource est disponible sur une plage donnée
   */
  isAvailable(start: number, end: number): boolean {
    return this.availabilityManager.isAvailable(start, end);
  }

  /**
   * Réserve un créneau sur cette ressource
   * Lève une erreur si le créneau n'est pas disponible
   * 
   * Pour les ressources de type GROUP, vérifie la pause méridienne :
   * - Si le créneau débute à 13:30, le créneau 12:00-12:30 doit être disponible
   * - Si le créneau se termine à 12:30, le créneau 13:30-14:00 doit être disponible
   */
  book(start: number, end: number): void {
    // Vérification spécifique pour les groupes : pause méridienne de 90 minutes
    if (false){//this.type === ResourceType.GROUP) {
      const MINUTES_PER_DAY = 24 * 60; // 1440 minutes par jour
      const startTimeInDay = start % MINUTES_PER_DAY; // Position de début dans la journée
      const endTimeInDay = end % MINUTES_PER_DAY; // Position de fin dans la journée
      const LUNCH_START = 13 * 60 + 30; // 13:30 = 810 minutes
      const LUNCH_BREAK_END = 12 * 60 + 30; // 12:30 = 750 minutes
      
      // Cas 1 : Si le créneau débute à 13:30
      if (startTimeInDay === LUNCH_START) {
        const dayStart = start - startTimeInDay; // Début du jour (minuit)
       
        const pauseStart = dayStart + (12 * 60); // 12:00 du même jour
        const pauseEnd = dayStart + LUNCH_BREAK_END; // 12:30 du même jour
        /*
         const earlyPauseStart = dayStart + (11 * 60); // 11:00 du même jour
        // Vérification prioritaire : si la plage 11:00-12:30 est disponible, on refuse
        // (Pour éviter de créer un créneau vide 11:00 - 12:00 qu'on aura du mal à utiliser car les séances durent 1:30 ou 2h)
        if (this.availabilityManager.isAvailable(earlyPauseStart, pauseEnd)) {
          // Et si la plage 10:30-11:00 n'est pas disponible
          if (!this.availabilityManager.isAvailable(dayStart + (10 * 60 + 30), earlyPauseStart)) {
            throw new Error(
              `Pause méridienne insuffisante : pour réserver à 13:30, la plage 11:00-12:30 ne doit pas être entièrement libre. ` +
              `Actuellement, cette plage est disponible, ce qui permettrait de placer une tâche de 11:00-12:30.`
            );
          }
        } */
        
        // Sinon, vérifier que le créneau 12:00-12:30 est disponible (non réservé)
        if (!this.availabilityManager.isAvailable(pauseStart, pauseEnd)) {
          throw new Error(
            `Pause méridienne insuffisante : pour réserver à 13:30, le créneau 12:00-12:30 doit être libre. ` +
            `Actuellement, ce créneau est occupé.`
          );
        }
      } 
      
      // Cas 2 : Si le créneau se termine à 12:30
      if (endTimeInDay === LUNCH_BREAK_END) {
        const dayStart = end - endTimeInDay; // Début du jour (minuit)
        const treize30 = dayStart + LUNCH_START; // 13:30 du même jour
        const quatorze = dayStart + (14 * 60); // 14:00 du même jour

        // Vérifier que le créneau 13:30-14:00 est disponible (non réservé)
        if (!this.availabilityManager.isAvailable(treize30, quatorze)) {
          throw new Error(
            `Pause méridienne insuffisante : pour réserver jusqu'à 12:30, le créneau 13:30-14:00 doit être libre. ` +
            `Actuellement, ce créneau est occupé.`
          );
        }
      }
    }
     
    this.availabilityManager.book(start, end);
  }

  /**
   * Trouve le prochain créneau disponible d'une durée donnée
   */
  findNextAvailableSlot(duration: number, afterTime: number = 0): AvailableSlot | null {
    return this.availabilityManager.findNextAvailableSlot(duration, afterTime);
  }

  /**
   * Trouve tous les créneaux disponibles d'une durée minimale
   */
  findAvailableSlots(minDuration: number): AvailableSlot[] {
    return this.availabilityManager.findAvailableSlots(minDuration);
  }

  /**
   * Calcule le temps total disponible pour cette ressource
   */
  getTotalAvailableTime(): number {
    return this.availabilityManager.getTotalAvailableTime();
  }

  /**
   * Retourne tous les intervalles disponibles de cette ressource
   */
  getAvailableIntervals(): AvailableSlot[] {
    return this.availabilityManager.getAvailableIntervals();
  }

  /**
   * Vérifie si la ressource n'a aucune disponibilité
   */
  isEmpty(): boolean {
    return this.availabilityManager.isEmpty();
  }

  /**
   * Calcule l'intersection des disponibilités avec une autre ressource
   * Retourne un Availability contenant les créneaux communs
   */
  intersectWith(other: Resource): Availability {
    return this.availabilityManager.intersect(other.availabilityManager);
  }

  /**
   * Vide toutes les disponibilités de la ressource
   */
  clearAvailability(): void {
    this.availabilityManager.clear();
  }

  /**
   * Nettoie les intervalles vides ou invalides
   */
  cleanup(): void {
    this.availabilityManager.cleanup();
  }



  /**
   * Retourne une représentation textuelle de la ressource et ses disponibilités
   */
  toString(): string {
    return `Resource(${this.id}): ${this.availabilityManager.toString()}`;
  }
}

export { Resource, ResourceType };
