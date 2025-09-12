import { AvailabilityManager } from './bookable';
import type { AvailableSlot } from './bookable';

/**
 * Classe représentant une ressource abstraite avec des plages de disponibilité
 * Une ressource peut être une salle, un équipement, une personne, etc.
 */
class Resource {
  public readonly id: string;
  private availabilityManager: AvailabilityManager;

  constructor(id: string) {
    this.id = id;
    this.availabilityManager = new AvailabilityManager();
  }

  /**
   * Retourne le gestionnaire de disponibilités de cette ressource
   */
  get availability(): AvailabilityManager {
    return this.availabilityManager;
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
   * Retourne une nouvelle ressource contenant les créneaux communs
   */
  intersectWith(other: Resource): Resource {
    const result = new Resource(`${this.id}_intersect_${other.id}`);
    result.availabilityManager = this.availabilityManager.intersect(other.availabilityManager);
    return result;
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

export { Resource };
