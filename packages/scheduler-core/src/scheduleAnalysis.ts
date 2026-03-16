/**
 * Module d'analyse et de statistiques pour les solutions de planification
 * Fournit des méthodes pour analyser les résultats produits par les schedulers
 */

import type { TaskSolution } from './schedule.js';
import type { Resource } from './resource.js';
import { ResourceType } from './resource.js';

/**
 * Statistiques d'utilisation pour une ressource
 */
interface ResourceUsageStats {
  resourceId: string;
  resourceType: ResourceType;
  taskCount: number;
  totalMinutes: number;
  totalHours: number;
  tasks: Array<{
    taskName: string;
    startTime: number;
    duration: number;
    day: number;
    dayOfWeek: string;
  }>;
}

/**
 * Statistiques d'utilisation par jour
 */
interface DailyUsageStats {
  day: number;
  dayOfWeek: string;
  taskCount: number;
  totalMinutes: number;
  totalHours: number;
  resourcesUsed: Set<string>;
}

/**
 * Statistiques globales de la solution
 */
interface GlobalStats {
  totalTasks: number;
  plannedTasks: number;
  unplannedTasks: number;
  completionRate: number;
  totalResourcesUsed: number;
  teachersUsed: number;
  roomsUsed: number;
  groupsUsed: number;
  timeSpan: {
    firstTaskStart: number;
    lastTaskEnd: number;
    totalDays: number;
  };
}

/**
 * Statistiques de charge quotidienne pour une ressource
 */
interface ResourceDailyLoad {
  resourceId: string;
  resourceType: ResourceType;
  dailyUsage: Map<number, number>; // day -> minutes
  maxDailyUsage: number;
  avgDailyUsage: number;
  totalUsage: number;
}

/**
 * Scores d'évaluation de la solution
 */
export interface SolutionScores {
  plannedTasks: number;
  vacataireCompactnessScore: number;
  permanentCompactnessScore: number;
}

/**
 * Classe d'analyse de solutions de planification
 * Fournit diverses méthodes d'analyse statistique sur les résultats
 */
export class ScheduleAnalysis {
  private solutions: TaskSolution[];
  private readonly DAYS_OF_WEEK = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  constructor(solutions: TaskSolution[]) {
    this.solutions = solutions;
  }

  /**
   * Met à jour les solutions à analyser
   */
  setSolutions(solutions: TaskSolution[]): void {
    this.solutions = solutions;
  }

  /**
   * Calcule le numéro du jour à partir d'un timestamp en minutes
   */
  private getDayFromMinutes(minutes: number): number {
    return Math.floor(minutes / (24 * 60));
  }

  /**
   * Retourne le nom du jour de la semaine
   */
  private getDayOfWeek(day: number): string {
    return this.DAYS_OF_WEEK[day % 7];
  }

  /**
   * Extrait toutes les ressources utilisées dans la solution
   */
  private getAllUsedResources(): Resource[] {
    const resourcesSet = new Set<Resource>();
    
    for (const solution of this.solutions) {
      for (const resource of solution.task.getAllResources()) {
        resourcesSet.add(resource);
      }
    }
    
    return Array.from(resourcesSet);
  }

  /**
   * Analyse l'utilisation d'une ressource spécifique
   */
  analyzeResourceUsage(resourceId: string): ResourceUsageStats | null {
    const resourceTasks = this.solutions.filter(sol => 
      sol.task.getAllResources().some(r => r.id === resourceId)
    );

    if (resourceTasks.length === 0) {
      return null;
    }

    const resource = resourceTasks[0].task.getAllResources().find(r => r.id === resourceId);
    if (!resource) return null;

    let totalMinutes = 0;
    const tasks = resourceTasks.map(sol => {
      const duration = sol.task.duration;
      totalMinutes += duration;
      const day = this.getDayFromMinutes(sol.startTime);
      
      return {
        taskName: sol.task.name,
        startTime: sol.startTime,
        duration,
        day,
        dayOfWeek: this.getDayOfWeek(day)
      };
    });

    return {
      resourceId,
      resourceType: resource.type,
      taskCount: resourceTasks.length,
      totalMinutes,
      totalHours: totalMinutes / 60,
      tasks
    };
  }

  /**
   * Analyse l'utilisation de toutes les ressources d'un type donné
   */
  analyzeResourcesByType(type: ResourceType): ResourceUsageStats[] {
    const allResources = this.getAllUsedResources();
    const resourcesOfType = allResources.filter(r => r.type === type);
    
    const stats: ResourceUsageStats[] = [];
    
    for (const resource of resourcesOfType) {
      const usage = this.analyzeResourceUsage(resource.id);
      if (usage) {
        stats.push(usage);
      }
    }
    
    // Trier par nombre de tâches décroissant
    stats.sort((a, b) => b.taskCount - a.taskCount);
    
    return stats;
  }

  /**
   * Calcule les statistiques d'utilisation par jour
   */
  analyzeDailyUsage(): DailyUsageStats[] {
    const dailyStats = new Map<number, DailyUsageStats>();
    
    for (const solution of this.solutions) {
      const day = this.getDayFromMinutes(solution.startTime);
      
      if (!dailyStats.has(day)) {
        dailyStats.set(day, {
          day,
          dayOfWeek: this.getDayOfWeek(day),
          taskCount: 0,
          totalMinutes: 0,
          totalHours: 0,
          resourcesUsed: new Set<string>()
        });
      }
      
      const stats = dailyStats.get(day)!;
      stats.taskCount++;
      stats.totalMinutes += solution.task.duration;
      stats.totalHours = stats.totalMinutes / 60;
      
      // Ajouter toutes les ressources utilisées
      for (const resource of solution.task.getAllResources()) {
        stats.resourcesUsed.add(resource.id);
      }
    }
    
    // Convertir en tableau et trier par jour
    return Array.from(dailyStats.values()).sort((a, b) => a.day - b.day);
  }

  /**
   * Calcule la charge quotidienne pour chaque ressource
   */
  analyzeResourceDailyLoad(resourceType?: ResourceType): ResourceDailyLoad[] {
    const allResources = resourceType 
      ? this.getAllUsedResources().filter(r => r.type === resourceType)
      : this.getAllUsedResources();
    
    const loads: ResourceDailyLoad[] = [];
    
    for (const resource of allResources) {
      const dailyUsage = new Map<number, number>();
      
      // Calculer l'usage par jour pour cette ressource
      for (const solution of this.solutions) {
        if (solution.task.getAllResources().some(r => r.id === resource.id)) {
          const day = this.getDayFromMinutes(solution.startTime);
          const currentUsage = dailyUsage.get(day) || 0;
          dailyUsage.set(day, currentUsage + solution.task.duration);
        }
      }
      
      if (dailyUsage.size > 0) {
        const usages = Array.from(dailyUsage.values());
        const totalUsage = usages.reduce((sum, u) => sum + u, 0);
        const maxDailyUsage = Math.max(...usages);
        const avgDailyUsage = totalUsage / dailyUsage.size;
        
        loads.push({
          resourceId: resource.id,
          resourceType: resource.type,
          dailyUsage,
          maxDailyUsage,
          avgDailyUsage,
          totalUsage
        });
      }
    }
    
    // Trier par charge maximale décroissante
    loads.sort((a, b) => b.maxDailyUsage - a.maxDailyUsage);
    
    return loads;
  }

  /**
   * Calcule les statistiques globales de la solution
   */
  getGlobalStats(totalTasksExpected?: number): GlobalStats {
    const allResources = this.getAllUsedResources();
    const teachers = allResources.filter(r => r.type === ResourceType.TEACHER);
    const rooms = allResources.filter(r => r.type === ResourceType.ROOM);
    const groups = allResources.filter(r => r.type === ResourceType.GROUP);
    
    let firstTaskStart = Infinity;
    let lastTaskEnd = -Infinity;
    
    for (const solution of this.solutions) {
      firstTaskStart = Math.min(firstTaskStart, solution.startTime);
      lastTaskEnd = Math.max(lastTaskEnd, solution.startTime + solution.task.duration);
    }
    
    const totalDays = firstTaskStart === Infinity ? 0 : 
      this.getDayFromMinutes(lastTaskEnd) - this.getDayFromMinutes(firstTaskStart) + 1;
    
    const plannedTasks = this.solutions.length;
    const unplannedTasks = totalTasksExpected ? totalTasksExpected - plannedTasks : 0;
    const completionRate = totalTasksExpected ? (plannedTasks / totalTasksExpected) * 100 : 100;
    
    return {
      totalTasks: totalTasksExpected || plannedTasks,
      plannedTasks,
      unplannedTasks,
      completionRate,
      totalResourcesUsed: allResources.length,
      teachersUsed: teachers.length,
      roomsUsed: rooms.length,
      groupsUsed: groups.length,
      timeSpan: {
        firstTaskStart: firstTaskStart === Infinity ? 0 : firstTaskStart,
        lastTaskEnd: lastTaskEnd === -Infinity ? 0 : lastTaskEnd,
        totalDays
      }
    };
  }

  /**
   * Trouve les ressources les plus chargées
   */
  getTopResourcesByLoad(type: ResourceType, limit: number = 10): ResourceUsageStats[] {
    const stats = this.analyzeResourcesByType(type);
    return stats.slice(0, limit);
  }

  /**
   * Trouve les jours les plus chargés
   */
  getBusiestDays(limit: number = 5): DailyUsageStats[] {
    const dailyStats = this.analyzeDailyUsage();
    return dailyStats
      .sort((a, b) => b.taskCount - a.taskCount)
      .slice(0, limit);
  }

  /**
   * Détecte les ressources qui dépassent un quota journalier
   */
  findQuotaViolations(resourceType: ResourceType, maxMinutesPerDay: number): Array<{
    resourceId: string;
    day: number;
    dayOfWeek: string;
    usage: number;
    excess: number;
  }> {
    const loads = this.analyzeResourceDailyLoad(resourceType);
    const violations: Array<{
      resourceId: string;
      day: number;
      dayOfWeek: string;
      usage: number;
      excess: number;
    }> = [];
    
    for (const load of loads) {
      for (const [day, usage] of load.dailyUsage.entries()) {
        if (usage > maxMinutesPerDay) {
          violations.push({
            resourceId: load.resourceId,
            day,
            dayOfWeek: this.getDayOfWeek(day),
            usage,
            excess: usage - maxMinutesPerDay
          });
        }
      }
    }
    
    return violations.sort((a, b) => b.excess - a.excess);
  }

  /**
   * Génère un rapport textuel complet
   */
  generateReport(totalTasksExpected?: number): string {
    const report: string[] = [];
    const globalStats = this.getGlobalStats(totalTasksExpected);
    
    report.push('📊 RAPPORT D\'ANALYSE DE PLANIFICATION');
    report.push('=====================================\n');
    
    // Statistiques globales
    report.push('📈 STATISTIQUES GLOBALES');
    report.push('------------------------');
    report.push(`Tâches planifiées: ${globalStats.plannedTasks}/${globalStats.totalTasks}`);
    report.push(`Taux de complétion: ${globalStats.completionRate.toFixed(1)}%`);
    report.push(`Ressources utilisées: ${globalStats.totalResourcesUsed} (${globalStats.teachersUsed} enseignants, ${globalStats.roomsUsed} salles, ${globalStats.groupsUsed} groupes)`);
    report.push(`Période: ${globalStats.timeSpan.totalDays} jour(s)\n`);
    
    // Top enseignants
    report.push('👨‍🏫 TOP 10 ENSEIGNANTS LES PLUS CHARGÉS');
    report.push('---------------------------------------');
    const topTeachers = this.getTopResourcesByLoad(ResourceType.TEACHER, 10);
    for (let i = 0; i < topTeachers.length; i++) {
      const teacher = topTeachers[i];
      report.push(`${i + 1}. ${teacher.resourceId}: ${teacher.taskCount} cours (${teacher.totalHours.toFixed(1)}h)`);
    }
    report.push('');
    
    // Top salles
    report.push('🏫 TOP 10 SALLES LES PLUS UTILISÉES');
    report.push('-----------------------------------');
    const topRooms = this.getTopResourcesByLoad(ResourceType.ROOM, 10);
    for (let i = 0; i < topRooms.length; i++) {
      const room = topRooms[i];
      report.push(`${i + 1}. ${room.resourceId}: ${room.taskCount} cours (${room.totalHours.toFixed(1)}h)`);
    }
    report.push('');
    
    // Jours les plus chargés
    report.push('📅 JOURS LES PLUS CHARGÉS');
    report.push('-------------------------');
    const busiestDays = this.getBusiestDays(5);
    for (const day of busiestDays) {
      report.push(`${day.dayOfWeek} (jour ${day.day}): ${day.taskCount} cours, ${day.totalHours.toFixed(1)}h, ${day.resourcesUsed.size} ressources`);
    }
    report.push('');
    
    return report.join('\n');
  }

  /**
   * Exporte les statistiques en JSON
   */
  exportToJSON(): string {
    const data = {
      globalStats: this.getGlobalStats(),
      dailyUsage: this.analyzeDailyUsage(),
      teacherStats: this.analyzeResourcesByType(ResourceType.TEACHER),
      roomStats: this.analyzeResourcesByType(ResourceType.ROOM),
      groupStats: this.analyzeResourcesByType(ResourceType.GROUP),
      resourceDailyLoads: {
        teachers: this.analyzeResourceDailyLoad(ResourceType.TEACHER),
        rooms: this.analyzeResourceDailyLoad(ResourceType.ROOM),
        groups: this.analyzeResourceDailyLoad(ResourceType.GROUP)
      }
    };
    
    return JSON.stringify(data, (_key, value) => {
      // Convertir les Sets et Maps en objets sérialisables
      if (value instanceof Set) {
        return Array.from(value);
      }
      if (value instanceof Map) {
        return Object.fromEntries(value);
      }
      return value;
    }, 2);
  }

  /**
   * Calcule la somme des interruptions (gaps) pour chaque ressource par jour
   * Une interruption = temps entre la fin d'un cours et le début du suivant
   * Calcul entre le premier et le dernier cours de chaque journée
   * 
   * Si les cours d'une ressource s'étendent du matin à l'après-midi (premier cours avant 12h00
   * et dernier cours après 14h00), la durée de la pause méridienne est soustraite du total.
   * 
   * @param resourceType Optionnel : filtrer par type de ressource
   * @param lunchBreakMinutes Durée de la pause méridienne en minutes (par défaut : 120 min = 2h)
   * @returns Statistiques de gaps par ressource et par jour
   */
  analyzeResourceGaps(resourceType?: ResourceType, lunchBreakMinutes: number = 120): Array<{
    resourceId: string;
    resourceType: ResourceType;
    dailyGaps: Map<number, {
      day: number;
      dayOfWeek: string;
      firstCourseStart: number;
      lastCourseEnd: number;
      totalGapDuration: number; // Somme des interruptions en minutes
      numberOfGaps: number;
      averageGap: number;
      courseCount: number;
    }>;
    totalGaps: number; // Somme totale sur tous les jours
  }> {
    const allResources = resourceType 
      ? this.getAllUsedResources().filter(r => r.type === resourceType)
      : this.getAllUsedResources();
    
    const results: Array<{
      resourceId: string;
      resourceType: ResourceType;
      dailyGaps: Map<number, any>;
      totalGaps: number;
    }> = [];
    
    for (const resource of allResources) {
      const dailyGaps = new Map<number, any>();
      let totalGaps = 0;
      
      // Grouper les cours par jour pour cette ressource
      const coursesByDay = new Map<number, Array<{ start: number; end: number }>>();
      
      for (const solution of this.solutions) {
        if (solution.task.getAllResources().some(r => r.id === resource.id)) {
          const day = this.getDayFromMinutes(solution.startTime);
          const start = solution.startTime;
          const end = start + solution.task.duration;
          
          if (!coursesByDay.has(day)) {
            coursesByDay.set(day, []);
          }
          coursesByDay.get(day)!.push({ start, end });
        }
      }
      
      // Calculer les gaps pour chaque jour
      for (const [day, courses] of coursesByDay.entries()) {
        // Trier les cours par heure de début
        courses.sort((a, b) => a.start - b.start);
        
        if (courses.length < 2) {
          // Pas de gap possible avec 0 ou 1 cours
          dailyGaps.set(day, {
            day,
            dayOfWeek: this.getDayOfWeek(day),
            firstCourseStart: courses[0]?.start || 0,
            lastCourseEnd: courses[0]?.end || 0,
            totalGapDuration: 0,
            numberOfGaps: 0,
            averageGap: 0,
            courseCount: courses.length
          });
          continue;
        }
        
        const firstCourseStart = courses[0].start;
        const lastCourseEnd = courses[courses.length - 1].end;
        
        let totalGapDuration = 0;
        let numberOfGaps = 0;
        
        // Calculer les gaps entre les cours consécutifs
        for (let i = 0; i < courses.length - 1; i++) {
          const currentEnd = courses[i].end;
          const nextStart = courses[i + 1].start;
          
          const gap = nextStart - currentEnd;
          
          if (gap > 0) {
            totalGapDuration += gap;
            numberOfGaps++;
          }
        }
        
        // Vérifier si les cours s'étendent sur matin et après-midi
        // Matin = avant 12h00 (720 min dans la journée), Après-midi = après 14h00 (840 min dans la journée)
        const firstCourseTimeOfDay = firstCourseStart % (24 * 60);
        const lastCourseTimeOfDay = lastCourseEnd % (24 * 60);
        
        const morningEnd = 12 * 60; // 12h00 = 720 minutes
        const afternoonStart = 14 * 60; // 14h00 = 840 minutes
        
        let adjustedGapDuration = totalGapDuration;
        
        // Si le premier cours commence le matin ET le dernier se termine l'après-midi
        if (firstCourseTimeOfDay < morningEnd && lastCourseTimeOfDay > afternoonStart) {
          // Soustraire la pause méridienne
          adjustedGapDuration = Math.max(0, totalGapDuration - lunchBreakMinutes);
        }
        
        const averageGap = numberOfGaps > 0 ? adjustedGapDuration / numberOfGaps : 0;
        
        dailyGaps.set(day, {
          day,
          dayOfWeek: this.getDayOfWeek(day),
          firstCourseStart,
          lastCourseEnd,
          totalGapDuration: adjustedGapDuration,
          numberOfGaps,
          averageGap,
          courseCount: courses.length
        });
        
        totalGaps += adjustedGapDuration;
      }
      
      if (dailyGaps.size > 0) {
        results.push({
          resourceId: resource.id,
          resourceType: resource.type,
          dailyGaps,
          totalGaps
        });
      }
    }
    
    // Trier par gaps totaux décroissants
    results.sort((a, b) => b.totalGaps - a.totalGaps);
    
    return results;
  }

  /**
   * Analyse le regroupement des cours par demi-journée pour chaque ressource
   * 
   * Une demi-journée est définie comme :
   * - Matin : cours se terminant au plus tard à 13h00 (fin <= 780 minutes)
   * - Après-midi : cours débutant après 13h00 (début > 780 minutes)
   * - 13h00 est toujours inclus dans la pause méridienne
   * 
   * Métrique de regroupement :
   * - halfDaysUsed : nombre de demi-journées différentes utilisées
   * - averageCoursesPerHalfDay : densité moyenne (plus élevé = meilleur regroupement)
   * - compactnessScore : ratio entre minimum théorique et réel (0-1, 1 = parfait)
   * - fragmentationIndex : nombre de jours avec seulement matin OU après-midi
   * 
   * @param resourceType Optionnel : filtrer par type de ressource
   * @param maxCoursesPerHalfDay Nombre maximum de cours théorique par demi-journée (défaut : 2)
   * @returns Statistiques de regroupement par ressource
   */
  analyzeHalfDayGrouping(resourceType?: ResourceType, maxCoursesPerHalfDay: number = 2): Array<{
    resourceId: string;
    resourceType: ResourceType;
    totalCourses: number;
    halfDaysUsed: number;
    minHalfDaysNeeded: number;
    averageCoursesPerHalfDay: number;
    compactnessScore: number;
    fragmentationIndex: number;
    halfDayBreakdown: Map<string, {
      day: number;
      dayOfWeek: string;
      period: 'morning' | 'afternoon';
      courseCount: number;
      totalDuration: number;
      courses: Array<{ name: string; start: number; duration: number }>;
    }>;
    distribution: Map<number, number>;
  }> {
    const LUNCH_BREAK = 13 * 60;   // 13h00 = 780 minutes (frontière matin/après-midi)

    // Extraire toutes les ressources uniques
    const resourcesSet = new Set<string>();
    const resourceTypeMap = new Map<string, ResourceType>();

    for (const solution of this.solutions) {
      for (const resource of solution.task.getAllResources()) {
        if (!resourceType || resource.type === resourceType) {
          resourcesSet.add(resource.id);
          resourceTypeMap.set(resource.id, resource.type);
        }
      }
    }

    const results: Array<any> = [];

    // Analyser chaque ressource
    for (const resourceId of resourcesSet) {
      const resType = resourceTypeMap.get(resourceId)!;

      // Grouper les cours par demi-journée
      const halfDayMap = new Map<string, {
        day: number;
        dayOfWeek: string;
        period: 'morning' | 'afternoon';
        courseCount: number;
        totalDuration: number;
        courses: Array<{ name: string; start: number; duration: number }>;
      }>();

      let totalCourses = 0;

      // Collecter tous les cours de cette ressource
      for (const solution of this.solutions) {
        if (solution.task.getAllResources().some(r => r.id === resourceId)) {
          const day = this.getDayFromMinutes(solution.startTime);
          const timeOfDay = solution.startTime % (24 * 60);
          const courseEnd = timeOfDay + solution.task.duration;

          // Déterminer la période (matin ou après-midi)
          // Matin : cours se termine au plus tard à 13h00 (fin <= 780 minutes)
          // Après-midi : cours débute après 13h00 (début > 780 minutes)
          let period: 'morning' | 'afternoon' | null = null;

          if (courseEnd <= LUNCH_BREAK) {
            period = 'morning';
          } else if (timeOfDay > LUNCH_BREAK) {
            period = 'afternoon';
          }

          // Si le cours est dans une demi-journée valide
          if (period) {
            const key = `${day}-${period}`;
            
            if (!halfDayMap.has(key)) {
              halfDayMap.set(key, {
                day,
                dayOfWeek: this.getDayOfWeek(day),
                period,
                courseCount: 0,
                totalDuration: 0,
                courses: []
              });
            }

            const halfDay = halfDayMap.get(key)!;
            halfDay.courseCount++;
            halfDay.totalDuration += solution.task.duration;
            halfDay.courses.push({
              name: solution.task.name,
              start: solution.startTime,
              duration: solution.task.duration
            });

            totalCourses++;
          }
        }
      }

      if (totalCourses === 0) continue;

      // Calculer les métriques
      const halfDaysUsed = halfDayMap.size;
      const minHalfDaysNeeded = Math.ceil(totalCourses / maxCoursesPerHalfDay);
      const averageCoursesPerHalfDay = totalCourses / halfDaysUsed;
      const compactnessScore = minHalfDaysNeeded / halfDaysUsed;

      // Calculer l'index de fragmentation
      // Compter les jours où on a seulement le matin OU l'après-midi (pas les deux)
      const daysUsed = new Map<number, Set<'morning' | 'afternoon'>>();
      for (const data of halfDayMap.values()) {
        if (!daysUsed.has(data.day)) {
          daysUsed.set(data.day, new Set());
        }
        daysUsed.get(data.day)!.add(data.period);
      }

      let fragmentationIndex = 0;
      for (const periods of daysUsed.values()) {
        if (periods.size === 1) {
          fragmentationIndex++;
        }
      }

      // Calculer la distribution (combien de demi-journées ont X cours)
      const distribution = new Map<number, number>();
      for (const halfDay of halfDayMap.values()) {
        const count = halfDay.courseCount;
        distribution.set(count, (distribution.get(count) || 0) + 1);
      }

      results.push({
        resourceId,
        resourceType: resType,
        totalCourses,
        halfDaysUsed,
        minHalfDaysNeeded,
        averageCoursesPerHalfDay,
        compactnessScore,
        fragmentationIndex,
        halfDayBreakdown: halfDayMap,
        distribution
      });
    }

    // Trier par score de compacité décroissant (meilleurs regroupements en premier)
    results.sort((a, b) => b.compactnessScore - a.compactnessScore);

    return results;
  }

  /**
   * Calcule les scores d'évaluation de la solution
   * 
   * @returns Objet contenant :
   *   - plannedTasks : nombre de tâches planifiées
   *   - vacataireCompactnessScore : somme des scores de compacité des enseignants vacataires
   *   - permanentCompactnessScore : somme des scores de compacité des enseignants permanents
   */
  getSolutionScores(): SolutionScores {
    // Nombre de tâches planifiées
    const plannedTasks = this.solutions.length;

    // Analyser le regroupement des enseignants
    const teacherGrouping = this.analyzeHalfDayGrouping(ResourceType.TEACHER);

    // Calculer la somme des scores de compacité pour les vacataires
    let vacataireCompactnessScore = 0;
    let permanentCompactnessScore = 0;

    for (const teacher of teacherGrouping) {
      // Trouver la ressource correspondante pour obtenir son status
      const resource = this.getAllUsedResources().find(
        r => r.id === teacher.resourceId && r.type === ResourceType.TEACHER
      );

      if (resource && resource.status) {
        if (resource.status === 'VACATAIRE') {
          vacataireCompactnessScore += teacher.compactnessScore;
        } else if (resource.status === 'PERMANENT') {
          permanentCompactnessScore += teacher.compactnessScore;
        }
      }
    }

    return {
      plannedTasks,
      vacataireCompactnessScore,
      permanentCompactnessScore
    };
  }
}
