import { Resource } from './resource.ts';
import { AvailabilityManager } from './availabilityManager.ts';

/**
 * Gestionnaire d'un ensemble de ressources avec indexation optimisée
 * Permet l'accès rapide aux ressources par identifiant
 */
class ResourcesManager {
  // Index principal : Map pour accès O(1) par identifiant
  private resources: Map<string, Resource> = new Map();

  /**
   * Ajoute une ressource au gestionnaire
   */
  addResource(resource: Resource): void {
    this.resources.set(resource.id, resource);
  }

  /**
   * Récupère une ressource par son identifiant (accès O(1))
   */
  getResource(id: string): Resource | undefined {
    return this.resources.get(id);
  }

  /**
   * Récupère toutes les ressources
   */
  getAllResources(): Resource[] {
    return Array.from(this.resources.values());
  }

  /**
   * Applique les contraintes pour une semaine spécifique
   */
  applyConstraintsForWeek(weekNumber: number, am: AvailabilityManager): void {
    for (const resource of this.resources.values()) {
      const availability = am.getAvailability(resource.id, weekNumber);
      if (availability) {
        resource.availability = availability;
      }
    }
  }
}

export { ResourcesManager };
