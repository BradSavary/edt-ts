import { ResourcesManager } from '../resourcesManager';
import { Resource, ResourceType } from '../resource';
import * as fs from 'fs';

/**
 * Classe utilitaire pour charger des fichiers JSON dans un environnement Node.js
 */
export class Loader {
  /**
   * Lit un fichier JSON de manière synchrone
   * @param filePath - Le chemin vers le fichier JSON
   * @returns Le contenu du fichier JSON
   */
  static loadJson<T = any>(filePath: string): T {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(fileContent);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Impossible de charger le fichier JSON ${filePath}: ${error.message}`);
      }
      throw new Error(`Erreur inconnue lors du chargement du fichier ${filePath}`);
    }
  }

  /**
   * Charge toutes les ressources depuis les fichiers JSON et retourne un ResourcesManager
   * @returns Un ResourcesManager contenant toutes les ressources
   */
  static loadResources(): ResourcesManager {
    const manager = new ResourcesManager();

    try {
      // Charger les salles depuis rooms.json
      const rooms: string[] = Loader.loadJson<string[]>('./src/json/rooms.json');
      rooms.forEach(roomId => {
        const room = new Resource(roomId, ResourceType.ROOM);
        manager.addResource(room);
      });

      // Charger les groupes depuis groups.json
      const groups: string[] = Loader.loadJson<string[]>('./src/json/groups.json');
      groups.forEach(groupId => {
        const group = new Resource(groupId, ResourceType.GROUP);
        manager.addResource(group);
      });

      // Charger les enseignants depuis teachers.json
      const teachers: string[] = Loader.loadJson<string[]>('./src/json/teachers.json');
      teachers.forEach(teacherId => {
        const teacher = new Resource(teacherId, ResourceType.TEACHER);
        manager.addResource(teacher);
      });

      return manager;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Erreur lors du chargement des ressources: ${error.message}`);
      }
      throw new Error(`Erreur inconnue lors du chargement des ressources`);
    }
  }
}