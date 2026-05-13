import type { ScheduleSolutionJSON, TaskSolutionJSON } from './types.ts';

const MINUTES_PER_DAY = 24 * 60;

/** Étendue (max − min) et écart-type des créneaux de début. */
export interface DispersionStats {
  etendue: number;
  ecartType: number;
}

/**
 * Analyse d'une `ScheduleSolutionJSON` du point de vue de l'utilisation
 * des ressources (enseignants, salles, groupes).
 *
 * Seules les tâches effectivement planifiées (startTime ≥ 0) sont prises
 * en compte. Les dayIndex suivent la convention du moteur : 0 = lundi,
 * 1 = mardi, …, 4 = vendredi.
 */
export class SolutionAnalysis {
  private readonly tasks: TaskSolutionJSON[];

  constructor(solution: ScheduleSolutionJSON) {
    this.tasks = solution.solutions.filter(t => t.startTime >= 0);
  }

  // ── Helpers privés ─────────────────────────────────────────────────────────

  private allResourceIds(): string[] {
    const ids = new Set<string>();
    for (const t of this.tasks) {
      for (const r of t.resources) {
        ids.add(r.id);
      }
    }
    return Array.from(ids);
  }

  private resolveIds(resourceIds?: string[]): string[] {
    return resourceIds && resourceIds.length > 0 ? resourceIds : this.allResourceIds();
  }

  private tasksForResource(resourceId: string): TaskSolutionJSON[] {
    return this.tasks.filter(t => t.resources.some(r => r.id === resourceId));
  }

  private dayOf(startTime: number): number {
    return Math.floor(startTime / MINUTES_PER_DAY);
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  // ── API publique ───────────────────────────────────────────────────────────

  /**
   * Temps d'utilisation quotidien (en minutes) par ressource et par jour.
   *
   * @param resourceIds IDs des ressources à analyser ; toutes si omis.
   * @returns `Record<resourceId, Record<dayIndex, minutes>>`
   */
  dailyUsageMinutes(resourceIds?: string[]): Record<string, Record<number, number>> {
    const result: Record<string, Record<number, number>> = {};
    for (const id of this.resolveIds(resourceIds)) {
      const daily: Record<number, number> = {};
      for (const t of this.tasksForResource(id)) {
        const day = this.dayOf(t.startTime);
        daily[day] = (daily[day] ?? 0) + t.duration;
      }
      result[id] = daily;
    }
    return result;
  }

  /**
   * Amplitude horaire quotidienne (en minutes) par ressource et par jour.
   * Définie comme : fin du dernier cours − début du premier cours du jour.
   *
   * @param resourceIds IDs des ressources à analyser ; toutes si omis.
   * @returns `Record<resourceId, Record<dayIndex, minutes>>`
   */
  dailyAmplitudeMinutes(resourceIds?: string[]): Record<string, Record<number, number>> {
    const result: Record<string, Record<number, number>> = {};
    for (const id of this.resolveIds(resourceIds)) {
      const byDay: Record<number, TaskSolutionJSON[]> = {};
      for (const t of this.tasksForResource(id)) {
        const day = this.dayOf(t.startTime);
        (byDay[day] ??= []).push(t);
      }
      const daily: Record<number, number> = {};
      for (const [dayStr, dayTasks] of Object.entries(byDay)) {
        const first = Math.min(...dayTasks.map(t => t.startTime));
        const last = Math.max(...dayTasks.map(t => t.startTime + t.duration));
        daily[Number(dayStr)] = last - first;
      }
      result[id] = daily;
    }
    return result;
  }

  /**
   * Dispersion temporelle hebdomadaire des créneaux de début par ressource.
   * Calculée sur les startTime absolus (incluant le décalage jour).
   *
   * @param resourceIds IDs des ressources à analyser ; toutes si omis.
   * @returns `Record<resourceId, DispersionStats>`
   */
  weeklyDispersion(resourceIds?: string[]): Record<string, DispersionStats> {
    const result: Record<string, DispersionStats> = {};
    for (const id of this.resolveIds(resourceIds)) {
      const times = this.tasksForResource(id).map(t => t.startTime);
      if (times.length === 0) {
        result[id] = { etendue: 0, ecartType: 0 };
        continue;
      }
      result[id] = {
        etendue: Math.max(...times) - Math.min(...times),
        ecartType: this.stdDev(times),
      };
    }
    return result;
  }

  /**
   * Dispersion temporelle quotidienne des créneaux de début par ressource et
   * par jour. Calculée sur les minutes-dans-la-journée (startTime % 1440).
   *
   * @param resourceIds IDs des ressources à analyser ; toutes si omis.
   * @returns `Record<resourceId, Record<dayIndex, DispersionStats>>`
   */
  dailyDispersion(resourceIds?: string[]): Record<string, Record<number, DispersionStats>> {
    const result: Record<string, Record<number, DispersionStats>> = {};
    for (const id of this.resolveIds(resourceIds)) {
      const byDay: Record<number, number[]> = {};
      for (const t of this.tasksForResource(id)) {
        const day = this.dayOf(t.startTime);
        const timeOfDay = t.startTime % MINUTES_PER_DAY;
        (byDay[day] ??= []).push(timeOfDay);
      }
      const daily: Record<number, DispersionStats> = {};
      for (const [dayStr, times] of Object.entries(byDay)) {
        daily[Number(dayStr)] = {
          etendue: Math.max(...times) - Math.min(...times),
          ecartType: this.stdDev(times),
        };
      }
      result[id] = daily;
    }
    return result;
  }
}
