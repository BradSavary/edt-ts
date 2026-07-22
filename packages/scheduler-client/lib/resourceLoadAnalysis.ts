import type {
  CourseTaskData, EnforcedData, ResourceEntry,
  TaskSolutionJSON, NeutralizedTaskInfoJSON,
} from '@edt-ts/scheduler-common';
import { AvailabilityManager, SolutionAnalysis } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { ResourceGroupDataWithStatus } from '@/lib/csvMerge';
import { resolveMaxDailyMinutes } from '@/lib/maxDailyResolution';
import type { BlockedZone } from '@/lib/calendar/blockedZones';
import { getMondayOfISOWeek } from '@/lib/calendar/calendarUtils';
import { resolveCalendarYear, type SchoolYearConfig } from '@/lib/schoolHolidays';

const MINUTES_PER_DAY = 24 * 60;
export const DAY_LABELS = ['lun', 'mar', 'mer', 'jeu', 'ven'] as const;

export type ResourceKind = 'teacher' | 'group' | 'room';

export interface DayLoad {
  day: number; // 0=lundi..4=vendredi
  capacityMin: number;
  /** Mode 'preparation' : charge des cours enforced ce jour. Mode 'analysis' : charge placée. */
  loadMin: number;
  slackMin: number;
  /** Mode 'analysis' uniquement : slackMin >= durée de la tâche analysée (approximation — le
   *  mou peut être fragmenté en plusieurs intervalles plus courts que la durée demandée). */
  fits: boolean;
}

export interface ResourceLoadRow {
  resourceId: string;
  resourceKind: ResourceKind;
  days: DayLoad[];
  weeklyCapacity: number;
  /** Mode 'preparation' : demande hebdo totale de la ressource (tous cours de la semaine
   *  l'utilisant). Mode 'analysis' : charge hebdo effectivement placée. */
  weeklyLoad: number;
  weeklySlack: number;
  /** weeklyLoad / weeklyCapacity — Infinity si capacité nulle et charge non nulle. */
  ratio: number;
  /** Mode 'analysis' uniquement : au moins un jour a assez de mou pour la tâche analysée. */
  anyDayFits: boolean;
}

function flattenIds(entries: ResourceEntry[]): string[] {
  const ids = new Set<string>();
  for (const e of entries) {
    for (const id of Array.isArray(e) ? e : [e]) ids.add(id);
  }
  return [...ids];
}

/** Ressources candidates d'un cours, dédupliquées, taguées par type. */
function courseCandidates(course: CourseTaskData): { id: string; kind: ResourceKind }[] {
  return [
    ...flattenIds(course.teacher).map(id => ({ id, kind: 'teacher' as const })),
    ...flattenIds(course.groups).map(id => ({ id, kind: 'group' as const })),
    ...flattenIds(course.rooms).map(id => ({ id, kind: 'room' as const })),
  ];
}

function mondayMsFor(weekNumber: number, schoolYearConfig: SchoolYearConfig | null, blockedZones: BlockedZone[]): number {
  return blockedZones.length > 0 ? getMondayOfISOWeek(weekNumber, resolveCalendarYear(schoolYearConfig, weekNumber)).getTime() : 0;
}

/**
 * Capacité par jour (0-4) d'une ressource, en minutes, plafonnée par `maxDailyMinutes` si défini.
 * Source unique : `AvailabilityManager.getAvailability()` — le même primitif que
 * `analyzeConstraints` (lib/taskConstraintAnalysis.ts) pour le classement 🔴/🟠/🟢, pas
 * `applyBlockedZonesToConstraints` (troisième source de vérité interdite, voir
 * docs/PlanOptionalTasksP2Explication.md §2.2). Zones bloquées soustraites explicitement ici
 * (pas de collapse "vide → illimité" comme dans `getEntryAvailability` : une ressource
 * réellement sans capacité doit apparaître à 0, pas être traitée comme "non contrainte").
 */
function capacityByDay(
  am: AvailabilityManager,
  resourceId: string,
  weekNumber: number,
  blockedZones: BlockedZone[],
  mondayMs: number,
  maxDailyMinutes: number | undefined,
): Record<number, number> {
  const av = am.getAvailability(resourceId, weekNumber);
  const byDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  if (!av) return byDay;

  const zoned = av.copy();
  for (const zone of blockedZones) {
    zoned.removeAvailability((zone.start.getTime() - mondayMs) / 60000, (zone.end.getTime() - mondayMs) / 60000);
  }
  for (const slot of zoned.getAvailableIntervals()) {
    const day = Math.floor(slot.start / MINUTES_PER_DAY);
    if (day < 0 || day > 4) continue; // hors semaine (garde-fou, ne devrait pas arriver)
    byDay[day] += slot.end - slot.start;
  }
  if (maxDailyMinutes !== undefined) {
    for (let d = 0; d < 5; d++) byDay[d] = Math.min(byDay[d], maxDailyMinutes);
  }
  return byDay;
}

/**
 * Limites quotidiennes effectives POUR LA SEMAINE demandée : même résolution que le payload
 * moteur (`resolveMaxDailyMinutes`), sinon l'analyse de charge affichée contredirait
 * silencieusement ce que le moteur applique.
 */
function maxDailyMinutesById(resources: ResourceGroupDataWithStatus[], weekNumber: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const group of resources) {
    for (const r of group.resources) {
      const resolved = resolveMaxDailyMinutes(r, weekNumber);
      if (resolved !== undefined) m.set(r.id, resolved);
    }
  }
  return m;
}

function buildRow(
  id: string,
  kind: ResourceKind,
  capacity: Record<number, number>,
  loadByDay: Record<number, number>,
  taskDurationForFits: number | null,
): ResourceLoadRow {
  const days: DayLoad[] = [];
  let weeklyCapacity = 0;
  let weeklyLoad = 0;
  for (let d = 0; d < 5; d++) {
    const capacityMin = capacity[d] ?? 0;
    const loadMin = loadByDay[d] ?? 0;
    const slackMin = Math.max(0, capacityMin - loadMin);
    weeklyCapacity += capacityMin;
    weeklyLoad += loadMin;
    days.push({
      day: d, capacityMin, loadMin, slackMin,
      fits: taskDurationForFits !== null ? slackMin >= taskDurationForFits : true,
    });
  }
  const weeklySlack = Math.max(0, weeklyCapacity - weeklyLoad);
  const ratio = weeklyCapacity > 0 ? weeklyLoad / weeklyCapacity : (weeklyLoad > 0 ? Infinity : 0);
  const anyDayFits = taskDurationForFits !== null ? days.some(d => d.fits) : true;
  return { resourceId: id, resourceKind: kind, days, weeklyCapacity, weeklyLoad, weeklySlack, ratio, anyDayFits };
}

/**
 * Mode 'analysis' uniquement : existe-t-il un jour où TOUTES les ressources candidates ont
 * simultanément assez de mou ? C'est la seule question qui compte pour la faisabilité réelle
 * d'un placement — `row.anyDayFits` (par ressource, indépendamment des autres) ne suffit PAS :
 * chaque ressource peut avoir SON jour de mou sans qu'aucun jour ne soit commun à toutes (ex.
 * réel S40 : l'enseignant n'a du mou que lun/mar/mer/ven, les deux groupes n'en ont QUE le
 * jeudi — aucun jour commun, alors que `rows.every(r => r.anyDayFits)` vaudrait `true` et
 * masquerait à tort le blocage réel). Trouvé en revue par Frédéric (2026-07-19).
 */
export function hasCommonFeasibleDay(rows: ResourceLoadRow[]): boolean {
  if (rows.length === 0) return true;
  return [0, 1, 2, 3, 4].some(day => rows.every(r => r.days[day]?.fits === true));
}

// ── Mode préparation ──────────────────────────────────────────────────────────

/**
 * Table charge/capacité d'un cours en cours de préparation (pas encore placé) : pour chaque
 * ressource candidate (alternatives comprises), capacité par jour, charge des enforced de la
 * semaine (seule charge à jour/heure connue avant résolution) et demande hebdomadaire totale
 * (tous les cours de la semaine requérant cette ressource, alternatives comprises — approximation
 * prudente assumée, même esprit que `analyzeConstraints` : une ressource utilisée par plusieurs
 * cours en alternative compte pour chacun, même si un seul sera finalement retenu par le moteur).
 * Indicateur PRÉVENTIF : montre la tension en VOLUME, pas la fragmentation par jour (qui n'existe
 * qu'après placement — voir buildAnalysisLoadRows).
 */
export function buildPreparationLoadRows(
  course: CourseTaskData,
  weekCourses: CourseTaskData[],
  enforcedByCourseId: Map<string, EnforcedData>,
  courseIdOf: (c: CourseTaskData) => string,
  am: AvailabilityManager,
  weekNumber: number,
  resources: ResourceGroupDataWithStatus[],
  blockedZones: BlockedZone[] = [],
  schoolYearConfig: SchoolYearConfig | null = null,
): ResourceLoadRow[] {
  const mondayMs = mondayMsFor(weekNumber, schoolYearConfig, blockedZones);
  const maxDaily = maxDailyMinutesById(resources, weekNumber);

  return courseCandidates(course).map(({ id, kind }) => {
    const capacity = capacityByDay(am, id, weekNumber, blockedZones, mondayMs, maxDaily.get(id));

    const enforcedLoad: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    let weeklyDemand = 0;
    for (const c of weekCourses) {
      const candidates = courseCandidates(c);
      if (!candidates.some(cand => cand.id === id && cand.kind === kind)) continue;
      weeklyDemand += c.duration;
      const enforced = enforcedByCourseId.get(courseIdOf(c));
      if (enforced) {
        const day = Math.floor(enforced.startTime / MINUTES_PER_DAY);
        if (day >= 0 && day <= 4) enforcedLoad[day] += c.duration;
      }
    }

    const row = buildRow(id, kind, capacity, enforcedLoad, null);
    return { ...row, weeklyLoad: weeklyDemand, ratio: row.weeklyCapacity > 0 ? weeklyDemand / row.weeklyCapacity : (weeklyDemand > 0 ? Infinity : 0) };
  });
}

// ── Mode analyse ──────────────────────────────────────────────────────────────

/**
 * Table charge/capacité/mou d'une tâche sautée, sur la solution affichée (placée). `fits` par
 * jour = mou >= durée de la tâche (approximation : le mou peut être fragmenté en intervalles plus
 * courts — libellé "mou", jamais "créneau disponible", cf. plan §2.2).
 */
export function buildAnalysisLoadRows(
  neutralizedTask: NeutralizedTaskInfoJSON,
  placedSolutions: TaskSolutionJSON[],
  am: AvailabilityManager,
  weekNumber: number,
  resources: ResourceGroupDataWithStatus[],
  blockedZones: BlockedZone[] = [],
  schoolYearConfig: SchoolYearConfig | null = null,
): ResourceLoadRow[] {
  const mondayMs = mondayMsFor(weekNumber, schoolYearConfig, blockedZones);
  const maxDaily = maxDailyMinutesById(resources, weekNumber);
  const duration = neutralizedTask.task.duration;
  const analysis = new SolutionAnalysis({ solutions: placedSolutions, isComplete: false });
  const candidateIds = [...new Set(neutralizedTask.task.resources.map(r => r.id))];
  const usage = analysis.dailyUsageMinutes(candidateIds);

  return neutralizedTask.task.resources
    .filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i) // dédupliquer (mêmes ids possibles sur plusieurs slots)
    .map(({ id, type }) => {
      const capacity = capacityByDay(am, id, weekNumber, blockedZones, mondayMs, maxDaily.get(id));
      const loadByDay = usage[id] ?? {};
      return buildRow(id, type as ResourceKind, capacity, loadByDay, duration);
    });
}
