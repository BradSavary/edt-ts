import { ResourcesManager } from '../resourcesManager.js';
import { Resource, ResourceType } from '../resource.js';
import { Task } from '../task.js';
import * as fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Types pour les contraintes JSON
interface TimeSlot {
  days: string;
  from: string;
  to: string;
}

interface ResourceConstraints {
  default?: TimeSlot[] | null;
  [weekKey: string]: TimeSlot[] | null | undefined; // S36, S38, etc.
}

interface ConstraintsData {
  Default?: TimeSlot[];
  [resourceId: string]: TimeSlot[] | ResourceConstraints | null | undefined;
}

// Types pour les données de cours JSON
interface CourseTaskData {
  code: string;
  teacher: string;
  groups: string[];
  name: string;
  rooms: string[];
}

interface CoursesData {
  week: number;
  tasks: CourseTaskData[];
}

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

  /**
   * Charge les contraintes de disponibilité depuis contraintes.json
   * @returns Les données de contraintes
   */
  static loadConstraints(): ConstraintsData {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const constraintsPath = join(__dirname, '..', 'json', 'contraintes.json');
      
      const data = fs.readFileSync(constraintsPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Impossible de charger le fichier contraintes.json: ${error.message}`);
      }
      throw new Error(`Erreur inconnue lors du chargement des contraintes`);
    }
  }

  /**
   * Charge les tâches d'une semaine donnée depuis cours.json
   * Les ressources auront leurs contraintes appliquées pour la semaine spécifiée
   * @param weekNumber - Numéro de la semaine (optionnel, utilise la semaine du JSON si non spécifié)
   * @returns Un tableau de Task avec les ressources configurées
   */
  static loadTasks(weekNumber?: number): Task[] {
    try {
      // Charger les données de cours
      const coursesData: CoursesData = Loader.loadJson('./src/json/cours.json');
      const targetWeek = weekNumber || coursesData.week;

      console.log(`📚 Chargement des tâches pour la semaine ${targetWeek}`);

      // Charger toutes les ressources
      const resourcesManager = Loader.loadResources();

      // Appliquer les contraintes pour la semaine spécifiée
      resourcesManager.applyConstraintsForWeek(targetWeek);

      // Créer les tâches
      const tasks: Task[] = [];

      for (const courseData of coursesData.tasks) {
        // Collecter toutes les ressources nécessaires
        const taskResources: Resource[] = [];

        // Ajouter l'enseignant
        if (courseData.teacher && resourcesManager.hasResource(courseData.teacher)) {
          const teacher = resourcesManager.getResource(courseData.teacher);
          if (teacher) taskResources.push(teacher);
        }

        // Ajouter les salles
        for (const roomId of courseData.rooms) {
          if (resourcesManager.hasResource(roomId)) {
            const room = resourcesManager.getResource(roomId);
            if (room) taskResources.push(room);
          }
        }

        // Ajouter les groupes
        for (const groupId of courseData.groups) {
          if (resourcesManager.hasResource(groupId)) {
            const group = resourcesManager.getResource(groupId);
            if (group) taskResources.push(group);
          }
        }

        // Créer la tâche
        const taskId = `${courseData.code}_${courseData.teacher}_${courseData.groups.join('_')}`;
        const task = new Task(taskId, courseData.name, 90, taskResources); // 90 minutes par défaut

        tasks.push(task);
      }

      console.log(`✅ ${tasks.length} tâches chargées pour la semaine ${targetWeek}`);
      return tasks;

    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Erreur lors du chargement des tâches: ${error.message}`);
      }
      throw new Error(`Erreur inconnue lors du chargement des tâches`);
    }
  }
}

// Export des types pour utilisation dans d'autres modules
export type { TimeSlot, ResourceConstraints, ConstraintsData, CourseTaskData, CoursesData };