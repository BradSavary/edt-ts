import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';
import { Availability, AvailabilityManager } from '@edt-ts/scheduler-common';
import type { BlockedZone } from '@/lib/calendar/blockedZones';
import { getMondayOfISOWeek } from '@/lib/calendar/calendarUtils';

export type ConstraintLevel = 'critical' | 'tight' | 'ok';

export interface TaskConstraintInfo {
  courseKey: string;
  course: CourseTaskData;
  index: number;
  level: ConstraintLevel;
  reasons: string[];
}

export interface ResourceOverload {
  resourceId: string;
  availableMinutes: number;
  totalDemandMinutes: number;
}

export interface ConstraintAnalysisResult {
  taskInfos: TaskConstraintInfo[];
  overloadedResources: ResourceOverload[];
  hasOverload: boolean;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Analyze constraint levels for all courses in a given week.
 *
 * Logic: for each resource, compare its individual available time with the total demand
 * from all tasks that use it (no intersection between resources).
 *
 *   critical : resource available time < total demand from its tasks
 *   tight    : resource available time < total demand × 1.5
 *   ok       : otherwise
 *
 * A task's level = worst level of any of its resources.
 * For alternative groups ([A, B, C]), pick the best-case resource (most available).
 *
 * The analysis is independent of enforced/non-enforced status.
 */
/**
 * Convert blocked zones to the Availability time coordinate system:
 * minutes since Monday 00:00 of the given week.
 * Then compute the intersection with the resource's available intervals.
 */
function computeBlockedOverlapMinutes(
  blockedZones: BlockedZone[],
  availableIntervals: { start: number; end: number }[],
  mondayMs: number,
): number {
  let total = 0;
  for (const zone of blockedZones) {
    // Convert absolute Date to minutes since Monday 00:00
    const zStart = (zone.start.getTime() - mondayMs) / 60000;
    const zEnd = (zone.end.getTime() - mondayMs) / 60000;
    for (const slot of availableIntervals) {
      const overlapStart = Math.max(zStart, slot.start);
      const overlapEnd = Math.min(zEnd, slot.end);
      if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
    }
  }
  return total;
}

/**
 * Analyze constraint levels for teachers in a given week.
 * Only teacher resources are analysed (rooms and groups are ignored).
 * Blocked zones reduce the effective availability of all resources.
 */
export function analyzeConstraints(
  courses: CourseTaskData[],
  am: AvailabilityManager,
  weekNumber: number,
  blockedZones: BlockedZone[] = [],
): ConstraintAnalysisResult {

  // 1. Pre-compute monday timestamp for blocked zone coordinate conversion
  const mondayMs = blockedZones.length > 0 ? getMondayOfISOWeek(weekNumber).getTime() : 0;

  // 2. Collect all unique teacher resource IDs (rooms and groups are not analysed)
  const allIds = new Set<string>();
  for (const c of courses) {
    const addEntry = (e: ResourceEntry) => {
      if (Array.isArray(e)) e.forEach(id => allIds.add(id));
      else allIds.add(e);
    };
    c.teacher.forEach(addEntry);
  }

  // 3. Get total available minutes and interval count per resource (-1 = unconstrained)
  const availMap = new Map<string, number>();          // id → total minutes (-1 = unconstrained)
  const intervalCountMap = new Map<string, number>();  // id → number of distinct available intervals
  for (const id of allIds) {
    const av = am.getAvailability(id, weekNumber);
    if (!av || av.isEmpty()) {
      availMap.set(id, -1);
    } else {
      const intervals = av.getAvailableIntervals();
      const blockedOverlap = blockedZones.length > 0
        ? computeBlockedOverlapMinutes(blockedZones, intervals, mondayMs)
        : 0;
      const effectiveAvail = Math.max(0, av.getTotalAvailableTime() - blockedOverlap);
      availMap.set(id, effectiveAvail);
      intervalCountMap.set(id, intervals.length);
    }
  }

  // 3. Build group key → demand accumulator
  // A "group" is the canonical sorted key of its alternatives, e.g. "SalleA|SalleB|SalleC"
  // For single-resource entries, the group is just the resource id.
  // Demand is not split: each task contributes its full duration to the group it uses.
  const groupDemand = new Map<string, number>(); // groupKey → total minutes demanded
  const groupIds = new Map<string, string[]>();   // groupKey → sorted ids

  // Only teacher entries
  for (const course of courses) {
    for (const e of course.teacher) {
      const ids = Array.isArray(e) ? [...e].sort() : [e];
      const key = ids.join('|');
      groupDemand.set(key, (groupDemand.get(key) ?? 0) + course.duration);
      if (!groupIds.has(key)) groupIds.set(key, ids);
    }
  }

  // 4. Classify each group using a composite score:
  //   fill_ratio = demand / combined_capacity
  //   mean_slot_h = combined_capacity / (total_interval_count * 60)  → average slot size in hours
  //   score = fill_ratio / log2(1 + mean_slot_h)
  //     → large spread-out capacity reduces score (many long slots = easy to place)
  //     → small or few slots amplifies score (hard to fit tasks)
  //   fill_ratio >= 1 → always critical (demand exceeds capacity regardless of slot size)
  //   score >= 0.175 → tight
  //   If any alternative is unconstrained (avail=-1) → ok
  const overloadedResources: ResourceOverload[] = [];
  interface GroupClassification { level: 'critical' | 'tight'; combinedAvail: number; totalDemand: number; score: number; }
  const groupLevelMap = new Map<string, GroupClassification>();

  for (const [key, ids] of groupIds.entries()) {
    const d = groupDemand.get(key) ?? 0;
    let combinedAvail = 0;
    let totalIntervals = 0;
    let unconstrained = false;
    for (const id of ids) {
      const avail = availMap.get(id) ?? -1;
      if (avail === -1) { unconstrained = true; break; }
      combinedAvail += avail;
      totalIntervals += intervalCountMap.get(id) ?? 1;
    }
    if (unconstrained) continue;
    if (combinedAvail === 0) {
      if (d > 0) groupLevelMap.set(key, { level: 'critical', combinedAvail, totalDemand: Math.round(d), score: Infinity });
      continue;
    }
    const fillRatio = d / combinedAvail;
    // fill_ratio > 1 = always critical regardless of slot size
    // For fill_ratio < 1, apply granularity penalty: small/few slots → higher score
    //   score = fill_ratio / log2(1 + mean_slot_h)
    //   large mean slot → score decreases (easy to fit)
    //   small mean slot → score stays close to fill_ratio (hard to fit)
    const meanSlotH = combinedAvail / (totalIntervals * 60);
    const score = fillRatio >= 1 ? fillRatio : fillRatio / Math.log2(1 + meanSlotH);
    if (score >= 1) {
      overloadedResources.push({ resourceId: key, availableMinutes: combinedAvail, totalDemandMinutes: Math.round(d) });
      groupLevelMap.set(key, { level: 'critical', combinedAvail, totalDemand: Math.round(d), score });
    } else if (score >= 0.175) {
      groupLevelMap.set(key, { level: 'tight', combinedAvail, totalDemand: Math.round(d), score });
    }
  }

  // 5. Per-task analysis (teachers only): worst group level wins
  const taskInfos: TaskConstraintInfo[] = courses.map((course, index) => {
    const courseKey = String(index);
    const reasons: string[] = [];
    let level: ConstraintLevel = 'ok';

    for (const e of course.teacher) {
      const ids = Array.isArray(e) ? [...e].sort() : [e];
      const key = ids.join('|');
      const classification = groupLevelMap.get(key);
      if (!classification) continue;

      const { level: groupLevel, combinedAvail, totalDemand, score } = classification;
      const scoreLabel = isFinite(score) ? ` (score ${score.toFixed(2)})` : '';
      const label = ids.length > 1 ? `(${ids.join(' | ')})` : ids[0];
      if (groupLevel === 'critical') {
        reasons.push(`${label} surchargé${scoreLabel} : ${formatMinutes(totalDemand)} demandés, ${formatMinutes(combinedAvail)} dispo combinée`);
        level = 'critical';
      } else if (groupLevel === 'tight' && level !== 'critical') {
        reasons.push(`${label} tendu${scoreLabel} : ${formatMinutes(totalDemand)} demandés, ${formatMinutes(combinedAvail)} dispo combinée`);
        level = 'tight';
      }
    }

    return { courseKey, course, index, level, reasons };
  });

  return {
    taskInfos,
    overloadedResources,
    hasOverload: overloadedResources.length > 0 || taskInfos.some(t => t.level === 'critical'),
  };
}

