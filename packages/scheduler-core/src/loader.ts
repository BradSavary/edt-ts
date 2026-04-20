import { SchedulerData } from '@edt-ts/scheduler-common';
import * as fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import type { ConstraintsData, CoursesData, ResourceGroupData, ResourcesManager, TasksManager, RawScheduleData, CourseTaskData } from '@edt-ts/scheduler-common';

export type { RawScheduleData };

/**
 * Loader — point d'entrée Node.js pour la planification.
 *
 * Lit les fichiers JSON embarqués (resources.json, cours.json, contraintes.json)
 * et délègue la construction des données à SchedulerData.
 *
 * En mode API (loadFromRawData), les données sont fournies directement sans lecture disque.
 */
export class Loader {
  private static _data: SchedulerData = new SchedulerData();
  private static _currentWeek: number | null = null;

  // ── Getters ─────────────────────────────────────────────────────────────

  static get resourcesManager(): ResourcesManager {
    if (!this._data.resourcesManager) {
      this._data.initResources(Loader.loadJson<ResourceGroupData[]>(join(Loader.getJsonDir(), 'resources.json')));
    }
    return this._data.resourcesManager!;
  }

  static get tasksManager(): TasksManager {
    if (!this._data.tasksManager) {
      // S'assure que les ressources sont chargées
      void this.resourcesManager;
      const coursesData = Loader.loadJson<CoursesData>(join(Loader.getJsonDir(), 'cours.json'));
      Loader.validateEnforcedCourses(coursesData.courses);
      this._data.initConstraints(Loader._loadConstraintsFromFile());
      console.log(`📚 Chargement des tâches pour la semaine ${coursesData.weeks}`);
      this._data.initTasks(coursesData);
      this._currentWeek = coursesData.weeks;
      console.log(`✅ ${this._data.tasksManager!.getUnitCount()} tâches chargées pour la semaine ${this._currentWeek}`);
    }
    return this._data.tasksManager!;
  }

  static get currentWeek(): number | null {
    if (this._currentWeek === null && !this._data.tasksManager) {
      void this.tasksManager; // force le chargement
    }
    return this._currentWeek;
  }

  // ── Réinitialisation ────────────────────────────────────────────────────

  static reload(): void {
    this._data = new SchedulerData();
    this._currentWeek = null;
    console.log('🔄 Rechargement de toutes les données...');
  }

  // ── Chargement par semaine ───────────────────────────────────────────────

  static loadTasksForWeek(weekNumber: number): TasksManager {
    this._data = new SchedulerData();
    this._data.initResources(Loader.loadJson<ResourceGroupData[]>(join(Loader.getJsonDir(), 'resources.json')));
    this._data.initConstraints(Loader._loadConstraintsFromFile());
    const allCourses = Loader.loadJson<CoursesData>(join(Loader.getJsonDir(), 'cours.json'));
    Loader.validateEnforcedCourses(allCourses.courses);
    console.log(`📚 Chargement des tâches pour la semaine ${weekNumber}`);
    this._data.initTasks({ weeks: weekNumber, courses: allCourses.courses });
    this._currentWeek = weekNumber;
    console.log(`✅ ${this._data.tasksManager!.getUnitCount()} tâches chargées pour la semaine ${weekNumber}`);
    return this._data.tasksManager!;
  }

  // ── Mode API (données fournies en mémoire) ───────────────────────────────

  /**
   * Initialise le moteur depuis des données fournies directement (mode API REST).
   * Remplace la lecture des fichiers JSON embarqués.
   */
  static loadFromRawData(data: RawScheduleData): void {
    this._data = new SchedulerData();
    this._data.initResources(data.resources);
    if (data.constraints) {
      this._data.initConstraints(data.constraints);
    }
    Loader.validateEnforcedCourses(data.courses);
    console.log(`📚 Chargement des tâches pour la semaine ${data.week}`);
    this._data.initTasks({ weeks: data.week, courses: data.courses });
    this._currentWeek = data.week;
    console.log(`✅ ${this._data.tasksManager!.getUnitCount()} tâches chargées pour la semaine ${data.week}`);
  }

  // ── Utilitaires JSON ────────────────────────────────────────────────────

  static loadJson<T = unknown>(filePath: string): T {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch (error) {
      throw new Error(
        `Impossible de charger le fichier JSON ${filePath}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private static getJsonDir(): string {
    const __filename = fileURLToPath(import.meta.url);
    return join(dirname(__filename), 'json');
  }

  private static _loadConstraintsFromFile(): ConstraintsData {
    return Loader.loadJson<ConstraintsData>(join(Loader.getJsonDir(), 'contraintes.json'));
  }

  /**
   * Valide la cohérence des cours enforced avant l'initialisation des tâches.
   * - Les ressources enforced doivent être des listes plates (pas d'alternatives).
   * - Deux cours enforced ne peuvent pas se chevaucher sur une même ressource.
   */
  private static validateEnforcedCourses(courses: CourseTaskData[]): void {
    const enforced = courses.filter(c => c.enforced !== undefined);

    // 1. Vérification des tableaux plats (pas de string[][] dans enforced)
    for (const course of enforced) {
      const e = course.enforced!;
      const allEntries: unknown[] = [...e.teacher, ...e.groups, ...e.rooms];
      for (const entry of allEntries) {
        if (Array.isArray(entry)) {
          throw new Error(
            `Cours enforced "${course.code}" (${course.type}) : les ressources enforced ne peuvent pas contenir d'alternatives (tableau imbriqué détecté : ${JSON.stringify(entry)}).`
          );
        }
      }
    }

    // 2. Détection des conflits entre cours enforced
    for (let i = 0; i < enforced.length; i++) {
      const a = enforced[i];
      const ea = a.enforced!;
      const endA = ea.startTime + a.duration;

      for (let j = i + 1; j < enforced.length; j++) {
        const b = enforced[j];
        const eb = b.enforced!;
        const endB = eb.startTime + b.duration;

        // Chevauchement temporel ?
        if (ea.startTime < endB && endA > eb.startTime) {
          const resourcesA = new Set([...ea.teacher, ...ea.groups, ...ea.rooms]);
          const shared = [...eb.teacher, ...eb.groups, ...eb.rooms].filter(id => resourcesA.has(id));
          if (shared.length > 0) {
            throw new Error(
              `Conflit entre cours enforced "${a.code}" (${a.type}) et "${b.code}" (${b.type}) : ressource(s) partagée(s) [${shared.join(', ')}] sur le même créneau.`
            );
          }
        }
      }
    }
  }
}
