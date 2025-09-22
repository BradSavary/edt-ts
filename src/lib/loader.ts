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

// Types pour l'extraction des enseignants
interface Course {
  teacher?: string;
  enseignant?: string;
  professeur?: string;
  prof?: string;
}

interface TeacherConstraints {
  [key: string]: any;
}

// Types pour les données de cours JSON
interface CourseTaskData {
  week: number;
  semester: number;
  level: number;
  code: string;
  type: string;
  teacher: string;
  groups: string[];
  name: string;
  rooms: string[];
  duration: number;
}

interface CoursesData {
  weeks: number;
  courses: CourseTaskData[];
}

/**
 * Classe utilitaire pour charger des fichiers JSON dans un environnement Node.js
 * Centralise l'accès aux données chargées via des propriétés statiques
 */
export class Loader {
  // Propriétés statiques pour centraliser les données
  private static _resourcesManager: ResourcesManager | null = null;
  private static _tasks: Task[] | null = null;
  private static _currentWeek: number | null = null;
  private static _taskCounter: number = 0; // Compteur pour IDs uniques

  /**
   * Getter pour le ResourcesManager
   * Charge automatiquement les ressources si nécessaire
   */
  static get resourcesManager(): ResourcesManager {
    if (this._resourcesManager === null) {
      this._resourcesManager = this.loadResources();
    }
    return this._resourcesManager;
  }

  /**
   * Getter pour les tâches
   * Charge automatiquement les tâches si nécessaire
   */
  static get tasks(): Task[] {
    if (this._tasks === null) {
      this._tasks = this.loadTasks();
    }
    return this._tasks;
  }

  /**
   * Getter pour la semaine courante des tâches chargées
   */
  static get currentWeek(): number | null {
    // Déclenche le chargement des tâches si nécessaire pour obtenir la semaine
    if (this._currentWeek === null && this._tasks === null) {
      this.tasks; // Force le chargement
    }
    return this._currentWeek;
  }

  /**
   * Recharge toutes les données (utile pour le développement ou les tests)
   */
  static reload(): void {
    this._resourcesManager = null;
    this._tasks = null;
    this._currentWeek = null;
    console.log('🔄 Rechargement de toutes les données...');
  }

  /**
   * Charge les tâches pour une semaine spécifique et met à jour les propriétés statiques
   */
  static loadTasksForWeek(weekNumber: number): Task[] {
    this._tasks = this.loadTasks(weekNumber);
    this._currentWeek = weekNumber;
    return this._tasks;
  }
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
      // Réinitialiser le compteur de tâches pour un chargement cohérent
      this._taskCounter = 0;
      
      // Charger les données de cours
      const coursesData: CoursesData = Loader.loadJson('./src/json/cours.json');
      const targetWeek = weekNumber || coursesData.weeks;

      console.log(`📚 Chargement des tâches pour la semaine ${targetWeek}`);

      // Utiliser le ResourcesManager centralisé
      const resourcesManager = this.resourcesManager;

      // Appliquer les contraintes pour la semaine spécifiée
      resourcesManager.applyConstraintsForWeek(targetWeek);

      // Créer les tâches
      const tasks: Task[] = [];
      const missingResources = {
        teachers: new Set<string>(),
        rooms: new Set<string>(),
        groups: new Set<string>()
      };

      for (const courseData of coursesData.courses) {
        // Collecter toutes les ressources nécessaires
        const taskResources: Resource[] = [];

        // Ajouter l'enseignant
        if (courseData.teacher) {
          if (resourcesManager.hasResource(courseData.teacher)) {
            const teacher = resourcesManager.getResource(courseData.teacher);
            taskResources.push(teacher!); // ! car hasResource garantit que getResource ne retourne pas null
          } else {
            console.warn(`⚠️  Enseignant '${courseData.teacher}' introuvable dans les ressources pour le cours ${courseData.code}`);
            missingResources.teachers.add(courseData.teacher);
          }
        }

        // Ajouter TOUTES les salles possibles à la tâche
        const taskRooms: Resource[] = [];
        if (courseData.rooms.length > 0) {
          // Filtrer et collecter toutes les salles disponibles
          for (const roomId of courseData.rooms) {
            if (resourcesManager.hasResource(roomId)) {
              const room = resourcesManager.getResource(roomId);
              taskRooms.push(room!);
            } else {
              console.warn(`⚠️  Salle '${roomId}' introuvable dans les ressources pour le cours ${courseData.code}`);
              missingResources.rooms.add(roomId);
            }
          }
        }

        // COMPATIBILITÉ: Pour le moment, sélectionner une seule salle au hasard pour la planification
        if (taskRooms.length > 0) {
          const randomIndex = Math.floor(Math.random() * taskRooms.length);
          const selectedRoom = taskRooms[randomIndex];
          taskResources.push(selectedRoom);
          
          // TODO: Plus tard, on utilisera toutes les salles possibles (taskRooms)
          // Pour l'instant, on garde une seule salle pour compatibilité avec les algorithmes existants
        }

        // Ajouter les groupes
        for (const groupId of courseData.groups) {
          if (resourcesManager.hasResource(groupId)) {
            const group = resourcesManager.getResource(groupId);
            taskResources.push(group!); // ! car hasResource garantit que getResource ne retourne pas null
          } else {
            console.warn(`⚠️  Groupe '${groupId}' introuvable dans les ressources pour le cours ${courseData.code}`);
            missingResources.groups.add(groupId);
          }
        }

        // Créer la tâche avec un ID unique
        this._taskCounter++; // Incrémenter le compteur
        const taskId = `${courseData.code}_${courseData.teacher}_${courseData.groups.join('_')}_${this._taskCounter}`;
        const task = new Task(taskId, courseData, taskResources, taskRooms);

        tasks.push(task);
      }

      console.log(`✅ ${tasks.length} tâches chargées pour la semaine ${targetWeek}`);
      
      // Déterminer les dépendances entre les tâches
      this.determineDependencies(tasks);
     // console.log(`🔗 Dépendances déterminées pour ${tasks.length} tâches`);
          
      // Afficher un résumé des ressources manquantes
      const totalMissing = missingResources.teachers.size + missingResources.rooms.size + missingResources.groups.size;
      if (totalMissing > 0) {
        console.warn(`\n⚠️  Résumé des ressources manquantes (${totalMissing} au total):`);
        if (missingResources.teachers.size > 0) {
          console.warn(`   👨‍🏫 Enseignants manquants (${missingResources.teachers.size}): ${Array.from(missingResources.teachers).join(', ')}`);
        }
        if (missingResources.rooms.size > 0) {
          console.warn(`   🏫 Salles manquantes (${missingResources.rooms.size}): ${Array.from(missingResources.rooms).join(', ')}`);
        }
        if (missingResources.groups.size > 0) {
          console.warn(`   👥 Groupes manquants (${missingResources.groups.size}): ${Array.from(missingResources.groups).join(', ')}`);
        }
      }
      
      // Mettre à jour les propriétés statiques si c'est le chargement principal
      if (!weekNumber) {
        this._tasks = tasks;
        this._currentWeek = targetWeek;
      }
      
      return tasks;

    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Erreur lors du chargement des tâches: ${error.message}`);
      }
      throw new Error(`Erreur inconnue lors du chargement des tâches`);
    }
  }

  /**
   * Détermine les dépendances entre les tâches selon les règles métier
   * @param tasks - Le tableau de tâches pour lesquelles déterminer les dépendances
   * @returns Le tableau de tâches avec les dépendances configurées
   */
  static determineDependencies(tasks: Task[]): Task[] {
   
    // Grouper les tâches par code
    const tasksByCode = new Map<string, Task[]>();

    tasks.forEach(task => {
      const code = task.code;
      if (!tasksByCode.has(code)) {
        tasksByCode.set(code, []);
      }
      tasksByCode.get(code)!.push(task);
    });

    // Pour chaque groupe de tâches avec le même code
    tasksByCode.forEach((codeTasks) => {
      // Séparer les tâches par type
      const cmTasks = codeTasks.filter(task => task.type === 'CM');
      const tdTasks = codeTasks.filter(task => task.type === 'TD');
      const tpTasks = codeTasks.filter(task => task.type === 'TP');

      // Règle: TP dépend de TD qui dépend de CM
      // D'abord, faire dépendre les TD des CM appropriés
      tdTasks.forEach(tdTask => {
        const dependentCM = this.findDependentTask(tdTask, cmTasks);
        if (dependentCM) {
          tdTask.setDependsOn(dependentCM);
        }
      });

      // Ensuite, faire dépendre les TP des TD appropriés
      tpTasks.forEach(tpTask => {
        const dependentTD = this.findDependentTask(tpTask, tdTasks);
        if (dependentTD) {
          tpTask.setDependsOn(dependentTD);
        }
      });
    });

    return tasks;
  }

  /**
   * Trouve la tâche dont dépend une tâche donnée selon les règles de groupes
   * @param task - La tâche pour laquelle chercher une dépendance
   * @param candidateTasks - Les tâches candidates comme dépendances
   * @returns La tâche dont dépend la tâche donnée, ou null si aucune
   */
  private static findDependentTask(task: Task, candidateTasks: Task[]): Task | null {
    // Récupérer les groupes de la tâche
    const taskGroups = task.getGroups();
    
    // Chercher une tâche candidate qui satisfait TOUTES les conditions :
    // 1. Même code (déjà filtré par l'appelant)
    // 2. Type approprié (déjà filtré par l'appelant) 
    // 3. Tous les groupes de la tâche courante sont inclus dans les groupes du candidat
    for (const candidate of candidateTasks) {
      const candidateGroups = candidate.getGroups();
      
      // Vérifier si tous les groupes de la tâche sont inclus dans les groupes du candidat
      // ET que le candidat a au moins les mêmes groupes (peut en avoir plus)
      const allGroupsIncluded = taskGroups.every(group => candidateGroups.includes(group));
      
      if (allGroupsIncluded && taskGroups.length > 0) {
        return candidate;
      }
    }
    
    return null;
  }

  /**
   * Alias pour loadJson pour compatibilité avec l'ancien code Utils
   * @param filePath - Le chemin vers le fichier JSON
   * @returns Le contenu du fichier JSON
   */
  static loadJsonSync<T = any>(filePath: string): T {
    return this.loadJson<T>(filePath);
  }

  /**
   * Version asynchrone de loadJson
   * @param filePath - Le chemin vers le fichier JSON
   * @returns Une promesse qui résout avec le contenu du fichier JSON
   */
  static async loadJsonAsync<T = any>(filePath: string): Promise<T> {
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
   * Extrait la liste unique des enseignants depuis un objet de contraintes
   * @param constraints - L'objet contenant les contraintes des enseignants
   * @returns Un tableau trié des noms d'enseignants uniques
   */
  static extractTeachersFromConstraints(constraints: TeacherConstraints): string[] {
    const teachers = new Set<string>();
    
    Object.keys(constraints).forEach(key => {
      // Ignorer les clés qui ne sont pas des enseignants (comme "Default")
      if (key === 'Default') return;
      
      // Nettoyer le nom de l'enseignant
      const cleanName = key
        .trim()
        .replace(/[^\w\s\-\.]/g, '') // Enlever les caractères spéciaux sauf tirets et points
        .replace(/\s+/g, ' '); // Normaliser les espaces
      
      if (cleanName && cleanName.length > 1) {
        teachers.add(cleanName);
      }
    });
    
    return Array.from(teachers).sort();
  }

  /**
   * Charge le fichier contraintes.json et extrait les enseignants
   * @param constraintsFilePath - Le chemin vers le fichier contraintes.json
   * @returns Une promesse qui résout avec le tableau des enseignants uniques
   */
  static async extractTeachersFromFile(constraintsFilePath: string = './src/json/contraintes.json'): Promise<string[]> {
    try {
      const constraints = await this.loadJsonAsync<TeacherConstraints>(constraintsFilePath);
      return this.extractTeachersFromConstraints(constraints);
    } catch (error) {
      throw new Error(`Impossible d'extraire les enseignants du fichier ${constraintsFilePath}: ${error}`);
    }
  }

  /**
   * Régénère le fichier teachers.json à partir du fichier contraintes.json
   * @param constraintsFilePath - Le chemin vers le fichier contraintes.json (par défaut: './src/json/contraintes.json')
   * @param outputPath - Le chemin de sortie pour teachers.json (par défaut: './src/json/teachers.json')
   * @returns Une promesse qui résout quand le fichier a été créé
   */
  static async regenerateTeachersFile(
    constraintsFilePath: string = './src/json/contraintes.json',
    outputPath: string = './src/json/teachers.json'
  ): Promise<void> {
    try {
      console.log(`📚 Chargement des contraintes depuis ${constraintsFilePath}...`);
      const teachers = await this.extractTeachersFromFile(constraintsFilePath);
      
      console.log(`👨‍🏫 ${teachers.length} enseignants trouvés`);
      
      // Créer le contenu JSON formaté
      const jsonContent = JSON.stringify(teachers, null, 2);
      
      // Créer le répertoire si nécessaire
      const dir = dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(outputPath, jsonContent, 'utf8');
      console.log(`✅ Fichier ${outputPath} régénéré avec succès !`);
      
    } catch (error) {
      console.error('❌ Erreur lors de la régénération du fichier teachers.json:', error);
      throw error;
    }
  }

  /**
   * Version synchrone pour Node.js uniquement
   * Régénère le fichier teachers.json de manière synchrone
   * @param constraintsFilePath - Le chemin vers le fichier contraintes.json
   * @param outputPath - Le chemin de sortie pour teachers.json
   */
  static regenerateTeachersFileSync(
    constraintsFilePath: string = './src/json/contraintes.json',
    outputPath: string = './src/json/teachers.json'
  ): void {
    try {
      console.log(`📚 Chargement des contraintes depuis ${constraintsFilePath}...`);
      const constraints = this.loadJsonSync<TeacherConstraints>(constraintsFilePath);
      const teachers = this.extractTeachersFromConstraints(constraints);
      
      console.log(`👨‍🏫 ${teachers.length} enseignants trouvés`);
      
      // Créer le répertoire si nécessaire
      const dir = dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const jsonContent = JSON.stringify(teachers, null, 2);
      fs.writeFileSync(outputPath, jsonContent, 'utf8');
      
      console.log(`✅ Fichier ${outputPath} régénéré avec succès !`);
    } catch (error) {
      console.error('❌ Erreur lors de la régénération du fichier teachers.json:', error);
      throw error;
    }
  }

  /**
   * Statistiques sur les enseignants et leurs contraintes
   * @param constraintsFilePath - Le chemin vers le fichier contraintes.json
   * @returns Statistiques détaillées
   */
  static async getTeachingStats(constraintsFilePath: string = './src/json/contraintes.json'): Promise<{
    totalTeachers: number;
    teachers: string[];
    teachersWithConstraints: { [teacher: string]: number };
  }> {
    const constraints = await this.loadJsonAsync<TeacherConstraints>(constraintsFilePath);
    const teachers = this.extractTeachersFromConstraints(constraints);
    
    const teachersWithConstraints: { [teacher: string]: number } = {};
    
    teachers.forEach(teacher => {
      const teacherData = constraints[teacher];
      if (teacherData && typeof teacherData === 'object' && !Array.isArray(teacherData)) {
        // Compter le nombre de périodes de contraintes définies
        teachersWithConstraints[teacher] = Object.keys(teacherData).length;
      } else {
        teachersWithConstraints[teacher] = 0;
      }
    });
    
    return {
      totalTeachers: teachers.length,
      teachers,
      teachersWithConstraints
    };
  }
}

// Export des types pour utilisation dans d'autres modules
export type { TimeSlot, ResourceConstraints, ConstraintsData, CourseTaskData, CoursesData, Course, TeacherConstraints };