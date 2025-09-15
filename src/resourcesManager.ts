import { Resource } from './resource';

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
}

export { ResourcesManager };
