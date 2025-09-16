import { AvailabilityManager } from './bookable';
import type { AvailableSlot } from './bookable';

/**
 * Types de ressources disponibles
 */
const ResourceType = {
  TEACHER: 'teacher',
  ROOM: 'room',
  GROUP: 'group'
} as const;

type ResourceType = typeof ResourceType[keyof typeof ResourceType];

/**
 * Classe représentant une ressource abstraite avec des plages de disponibilité
 * Une ressource peut être une salle, un équipement, une personne, etc.
 */
class Resource {
  public readonly id: string;
  public readonly type: ResourceType;
  private availabilityManager: AvailabilityManager;
  // Durée totale et prévisionnelle d'utilisation (en minutes)
  private _workload: number = 0;

  constructor(id: string, type: ResourceType) {
    this.id = id;
    this.type = type;
    this.availabilityManager = new AvailabilityManager();
  }

  /**
   * Retourne le gestionnaire de disponibilités de cette ressource
   */
  get availability(): AvailabilityManager {
    return this.availabilityManager;
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
   */
  book(start: number, end: number): void {
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
   * Retourne un AvailabilityManager contenant les créneaux communs
   */
  intersectWith(other: Resource): AvailabilityManager {
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
export type { ResourceType as ResourceTypeType };
