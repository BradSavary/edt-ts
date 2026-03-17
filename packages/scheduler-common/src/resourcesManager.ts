import { Resource } from './resource.ts';
import { ConstraintsManager } from './constraintsManager.ts';

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
   * Supprime une ressource du gestionnaire
   */
  removeResource(id: string): boolean {
    return this.resources.delete(id);
  }

  /**
   * Récupère une ressource par son identifiant (accès O(1))
   */
  getResource(id: string): Resource | undefined {
    return this.resources.get(id);
  }

  /**
   * Vérifie si une ressource existe
   */
  hasResource(id: string): boolean {
    return this.resources.has(id);
  }

  /**
   * Récupère toutes les ressources
   */
  getAllResources(): Resource[] {
    return Array.from(this.resources.values());
  }

  /**
   * Récupère tous les identifiants de ressources
   */
  getAllResourceIds(): string[] {
    return Array.from(this.resources.keys());
  }

  /**
   * Compte le nombre total de ressources
   */
  getResourceCount(): number {
    return this.resources.size;
  }

  /**
   * Vide le gestionnaire de toutes les ressources
   */
  clear(): void {
    this.resources.clear();
  }

  /**
   * Vérifie si le gestionnaire est vide
   */
  isEmpty(): boolean {
    return this.resources.size === 0;
  }

  /**
   * Trouve les ressources qui correspondent à un prédicat
   */
  findResources(predicate: (resource: Resource) => boolean): Resource[] {
    return Array.from(this.resources.values()).filter(predicate);
  }

  /**
   * Trouve la première ressource qui correspond à un prédicat
   */
  findResource(predicate: (resource: Resource) => boolean): Resource | undefined {
    for (const resource of this.resources.values()) {
      if (predicate(resource)) {
        return resource;
      }
    }
    return undefined;
  }

  /**
   * Exécute une fonction pour chaque ressource
   */
  forEach(callback: (resource: Resource, id: string) => void): void {
    this.resources.forEach(callback);
  }

  /**
   * Retourne une représentation textuelle du gestionnaire
   */
  toString(): string {
    return `ResourcesManager(${this.getResourceCount()} ressources)`;
  }

  /**
   * Applique les contraintes de disponibilité aux ressources
   * en utilisant le ConstraintsManager pour la semaine par défaut
   */
  applyConstraints(): void {
    for (const resource of this.resources.values()) {
      const availabilityManager = ConstraintsManager.getAvailabilityManager(resource.id);
      if (availabilityManager) {
        resource.availability = availabilityManager;
      }
    }
  }

  /**
   * Applique les contraintes pour une semaine spécifique
   */
  applyConstraintsForWeek(weekNumber: number): void {
    for (const resource of this.resources.values()) {
      const availabilityManager = ConstraintsManager.getAvailabilityManager(resource.id, weekNumber);
      if (availabilityManager) {
        resource.availability = availabilityManager;
      }
    }
  }

  /**
   * Obtient les statistiques des contraintes pour les ressources gérées
   */
  getConstraintsStats(): {
    resourcesWithConstraints: number;
    resourcesWithOverrides: number;
    averageAvailability: number;
  } {
    let resourcesWithConstraints = 0;
    let resourcesWithOverrides = 0;
    let totalAvailability = 0;

    for (const resource of this.resources.values()) {
      const hasConstraints = ConstraintsManager.hasResource(resource.id);
      if (hasConstraints) {
        resourcesWithConstraints++;
        const overrides = ConstraintsManager.getOverrideWeeks(resource.id);
        if (overrides.length > 0) {
          resourcesWithOverrides++;
        }
        totalAvailability += resource.getTotalAvailableTime();
      }
    }

    return {
      resourcesWithConstraints,
      resourcesWithOverrides,
      averageAvailability: this.resources.size > 0 ? totalAvailability / this.resources.size : 0
    };
  }
}

export { ResourcesManager };
