import type { CourseTaskData, ResourceEntry } from '@edt-ts/scheduler-common';
import { Availability, AvailabilityManager } from '@edt-ts/scheduler-common';

export type FeasibilityResourceKind = 'teacher' | 'room' | 'group';

export interface UnschedulableReason {
  resourceKind: FeasibilityResourceKind;
  /** L'entrée bloquante (un seul id, ou toutes les alternatives si aucune ne convient). */
  resourceIds: string[];
  kind: 'no-availability' | 'insufficient-duration';
  message: string;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Union des disponibilités de toutes les alternatives d'une entrée (une seule alternative
 * disponible suffit à débloquer l'entrée — cf. `ResourceEntry`, "A ET (B OU C)").
 * Contrairement à `getEntryAvailability` (lib/taskConstraintAnalysis.ts), une ressource vide
 * n'est PAS traitée comme "non contrainte" : elle doit apparaître vide, c'est justement ce qu'on
 * cherche à détecter ici (même choix que `capacityByDay` dans lib/resourceLoadAnalysis.ts).
 */
function unionAvailability(ids: string[], am: AvailabilityManager, weekNumber: number): Availability {
  const result = new Availability();
  for (const id of ids) {
    const av = am.getAvailability(id, weekNumber);
    if (!av) continue;
    for (const slot of av.getAvailableIntervals()) {
      result.addAvailability(slot.start, slot.end);
    }
  }
  return result;
}

function checkEntry(
  entry: ResourceEntry,
  resourceKind: FeasibilityResourceKind,
  duration: number,
  am: AvailabilityManager,
  weekNumber: number,
): UnschedulableReason | null {
  const ids = Array.isArray(entry) ? entry : [entry];
  const union = unionAvailability(ids, am, weekNumber);
  const label = ids.length > 1 ? ids.join(' | ') : ids[0];

  if (union.isEmpty()) {
    return {
      resourceKind,
      resourceIds: ids,
      kind: 'no-availability',
      message: `${label} : aucune disponibilité définie`,
    };
  }

  if (!union.hasSlotOfDuration(duration)) {
    const longest = union.getAvailableIntervals().reduce((max, slot) => Math.max(max, slot.end - slot.start), 0);
    return {
      resourceKind,
      resourceIds: ids,
      kind: 'insufficient-duration',
      message: `${label} : aucun créneau ≥ ${formatMinutes(duration)} (dispo max en continu : ${formatMinutes(longest)})`,
    };
  }

  return null;
}

/**
 * Cours structurellement impossible à placer : au moins une ressource associée (enseignant,
 * salle ou groupe) n'a soit aucune disponibilité déclarée pour la semaine, soit jamais de
 * créneau contigu aussi long que la durée du cours. Indépendant du statut `enforced` — un cours
 * imposé ignore les disponibilités, c'est à l'appelant de l'exclure via `enforcedMap`.
 */
export function getCourseUnschedulableReasons(
  course: CourseTaskData,
  am: AvailabilityManager,
  weekNumber: number,
): UnschedulableReason[] {
  const reasons: UnschedulableReason[] = [];
  const groups: { kind: FeasibilityResourceKind; entries: ResourceEntry[] }[] = [
    { kind: 'teacher', entries: course.teacher },
    { kind: 'room', entries: course.rooms ?? [] },
    { kind: 'group', entries: course.groups },
  ];

  for (const { kind, entries } of groups) {
    for (const entry of entries) {
      const reason = checkEntry(entry, kind, course.duration, am, weekNumber);
      if (reason) reasons.push(reason);
    }
  }

  return reasons;
}
