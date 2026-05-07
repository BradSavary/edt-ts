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
  /** Maximum fill ratio across all teacher entries of this task (demande / dispo conjointe) */
  fillRatio: number;
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
 * Teachers are the primary scheduling signal. Rooms and groups are considered
 * as availability reducers via intersection, not as independent signals.
 *
 * For each teacher entry in a task:
 *   effective_avail = teacher_avail ∩ room_avail ∩ group_avail (minus blocked zones)
 *   fill_ratio = global_teacher_demand / effective_avail_minutes
 *
 *   critical : fill_ratio >= 1           (global demand ≥ joint available time)
 *   tight    : fill_ratio >= tightThreshold
 *   ok       : otherwise
 *
 * Two tasks sharing the same teacher will have different levels if their rooms or
 * groups restrict the teacher's available time differently.
 * Groups being "busy" but available during teacher slots do not increase tension.
 * The analysis is independent of enforced/non-enforced status.
 */
export function analyzeConstraints(
  courses: CourseTaskData[],
  am: AvailabilityManager,
  weekNumber: number,
  blockedZones: BlockedZone[] = [],
  tightThreshold = 0.5,
  criticalThreshold = 1.0,
): ConstraintAnalysisResult {

  const mondayMs = blockedZones.length > 0 ? getMondayOfISOWeek(weekNumber).getTime() : 0;

  /**
   * Compute the union availability for a single resource entry (single or alternatives).
   * For alternatives [A, B]: union of availabilities (best case — scheduler picks one).
   * Returns null if any alternative is unconstrained (entry imposes no restriction).
   */
  function getEntryAvailability(entry: ResourceEntry): Availability | null {
    const ids = Array.isArray(entry) ? entry : [entry];
    let result: Availability | null = null;
    for (const id of ids) {
      const av = am.getAvailability(id, weekNumber);
      if (!av || av.isEmpty()) return null; // unconstrained → no restriction from this entry
      if (result === null) {
        result = av.copy();
      } else {
        // Union: add all intervals from av (addAvailability handles merging)
        for (const slot of av.getAvailableIntervals()) {
          result.addAvailability(slot.start, slot.end);
        }
      }
    }
    return result;
  }

  /**
   * Compute the intersection across ALL entries of a resource type.
   * Multiple entries = multiple resources required simultaneously → intersect.
   * Returns null if all entries are unconstrained (type does not restrict at all).
   */
  function getTypeAvailability(entries: ResourceEntry[]): Availability | null {
    let result: Availability | null = null;
    for (const entry of entries) {
      const entryAvail = getEntryAvailability(entry);
      if (entryAvail === null) continue; // unconstrained entry → no contribution
      result = result === null ? entryAvail : result.intersect(entryAvail);
    }
    return result;
  }

  // 1. Accumulate global demand per teacher group key across all tasks.
  const teacherGroupDemand = new Map<string, number>(); // groupKey → total minutes demanded
  const teacherGroupIds = new Map<string, string[]>();   // groupKey → sorted ids
  for (const course of courses) {
    for (const e of course.teacher) {
      const ids = Array.isArray(e) ? [...e].sort() : [e];
      const key = ids.join('|');
      teacherGroupDemand.set(key, (teacherGroupDemand.get(key) ?? 0) + course.duration);
      if (!teacherGroupIds.has(key)) teacherGroupIds.set(key, ids);
    }
  }

  // 2. Per-task analysis: for each teacher entry, compute joint effective availability
  //    = teacher_avail ∩ room_avail ∩ group_avail (minus blocked zones)
  //    fill_ratio = global_teacher_demand / joint_effective_minutes
  const overloadMap = new Map<string, ResourceOverload>();

  const taskInfos: TaskConstraintInfo[] = courses.map((course, index) => {
    const courseKey = String(index);
    const reasons: string[] = [];
    let level: ConstraintLevel = 'ok';
    let maxFillRatio = 0;

    // Pre-compute room and group availabilities once per task (shared across teacher entries)
    const roomAvail = getTypeAvailability(course.rooms);
    const groupAvail = getTypeAvailability(course.groups);

    for (const e of course.teacher) {
      const ids = Array.isArray(e) ? [...e].sort() : [e];
      const key = ids.join('|');
      const teacherDemand = teacherGroupDemand.get(key) ?? 0;
      if (teacherDemand === 0) continue;

      const teacherAvail = getEntryAvailability(e);
      if (teacherAvail === null) continue; // unconstrained teacher → no tension signal

      // Compute joint effective availability: teacher ∩ rooms ∩ groups
      // intersect() returns a new instance; teacherAvail is already a copy
      let effective: Availability = teacherAvail;
      if (roomAvail !== null) effective = effective.intersect(roomAvail);
      if (groupAvail !== null) effective = effective.intersect(groupAvail);

      // Subtract blocked zones (safe: effective is already a detached instance)
      if (blockedZones.length > 0) {
        for (const zone of blockedZones) {
          const zStart = (zone.start.getTime() - mondayMs) / 60000;
          const zEnd = (zone.end.getTime() - mondayMs) / 60000;
          effective.removeAvailability(zStart, zEnd);
        }
      }

      const effectiveMinutes = effective.getTotalAvailableTime();
      const fillRatio = effectiveMinutes > 0 ? teacherDemand / effectiveMinutes : Infinity;
      if (fillRatio > maxFillRatio) maxFillRatio = fillRatio;

      const label = ids.length > 1 ? `(${ids.join(' | ')})` : ids[0];
      const fillLabel = isFinite(fillRatio) ? ` (${(fillRatio * 100).toFixed(0)}%)` : '';

      if (fillRatio >= criticalThreshold) {
        reasons.push(`${label} surchargé${fillLabel} : ${formatMinutes(Math.round(teacherDemand))} demandés, ${formatMinutes(effectiveMinutes)} dispo conjointe`);
        level = 'critical';
        // Track worst-case (minimum effective time) per teacher key
        const existing = overloadMap.get(key);
        if (!existing || effectiveMinutes < existing.availableMinutes) {
          overloadMap.set(key, { resourceId: key, availableMinutes: effectiveMinutes, totalDemandMinutes: Math.round(teacherDemand) });
        }
      } else if (fillRatio >= tightThreshold && level !== 'critical') {
        reasons.push(`${label} tendu${fillLabel} : ${formatMinutes(Math.round(teacherDemand))} demandés, ${formatMinutes(effectiveMinutes)} dispo conjointe`);
        level = 'tight';
      }
    }

    return { courseKey, course, index, level, reasons, fillRatio: maxFillRatio };
  });

  const overloadedResources = [...overloadMap.values()];
  return {
    taskInfos,
    overloadedResources,
    hasOverload: overloadedResources.length > 0 || taskInfos.some(t => t.level === 'critical'),
  };
}

