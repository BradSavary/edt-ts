import type { ConstraintsData, ResourceGroupData, TimeSlot, ResourceConstraints } from '@edt-ts/scheduler-common';

export interface BlockedZone {
  id: string;
  start: Date;
  end: Date;
}

// Base d'disponibilité fictive quand aucun fichier de contraintes n'est chargé
const BASE_SLOTS: TimeSlot[] = [
  { days: 'lundi, mardi, mercredi, jeudi, vendredi', from: '7:00', to: '21:00' },
];

// Date.getDay() → index JS (0=dimanche), on remet lundi=0
const JS_DAY_TO_FRENCH: Record<number, string> = {
  0: 'dimanche',
  1: 'lundi',
  2: 'mardi',
  3: 'mercredi',
  4: 'jeudi',
  5: 'vendredi',
  6: 'samedi',
};

export function dateToFrenchDay(date: Date): string {
  return JS_DAY_TO_FRENCH[date.getDay()] ?? 'lundi';
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function parseDayList(daysStr: string): string[] {
  return daysStr.split(',').map((d) => d.trim().toLowerCase());
}

/**
 * Retire un intervalle [blockedFrom, blockedTo) du jour `blockedDay`
 * dans une liste de TimeSlots.
 */
function subtractIntervalFromSlots(
  slots: TimeSlot[],
  blockedDay: string,
  blockedFrom: number,
  blockedTo: number
): TimeSlot[] {
  const result: TimeSlot[] = [];

  for (const slot of slots) {
    const days = parseDayList(slot.days);
    const hasDay = days.some((d) => d === blockedDay);

    if (!hasDay) {
      result.push(slot);
      continue;
    }

    // Autres jours non bloqués — conserver tels quels
    const otherDays = days.filter((d) => d !== blockedDay);
    if (otherDays.length > 0) {
      result.push({ days: otherDays.join(', '), from: slot.from, to: slot.to });
    }

    const sFrom = timeToMinutes(slot.from);
    const sTo = timeToMinutes(slot.to);

    if (sTo <= blockedFrom || sFrom >= blockedTo) {
      // Pas de chevauchement sur ce jour — conserver
      result.push({ days: blockedDay, from: slot.from, to: slot.to });
    } else {
      // Chevauchement — découper autour de l'intervalle bloqué
      if (sFrom < blockedFrom) {
        result.push({ days: blockedDay, from: slot.from, to: minutesToTime(blockedFrom) });
      }
      if (sTo > blockedTo) {
        result.push({ days: blockedDay, from: minutesToTime(blockedTo), to: slot.to });
      }
    }
  }

  return result;
}

/**
 * Retourne les créneaux de disponibilité de base d'une ressource
 * pour la semaine `weekNumber`, en tenant compte des contraintes existantes.
 */
function getResourceBaseSlots(
  resourceId: string,
  weekNumber: number,
  constraints: ConstraintsData | null
): TimeSlot[] {
  if (!constraints) return BASE_SLOTS;

  // Accès bas niveau pour gérer les valeurs null du JSON réel
  const entry = (constraints as Record<string, unknown>)[resourceId];
  const weekKey = `S${weekNumber}`;

  if (entry === undefined || entry === null) {
    return constraints.Default ?? BASE_SLOTS;
  }

  if (Array.isArray(entry)) {
    return entry as TimeSlot[];
  }

  // ResourceConstraints
  const rc = entry as Record<string, unknown>;
  const weekOverride = rc[weekKey];
  if (Array.isArray(weekOverride)) return weekOverride as TimeSlot[];

  const defaultSlots = rc['default'];
  if (Array.isArray(defaultSlots)) return defaultSlots as TimeSlot[];

  return constraints.Default ?? BASE_SLOTS;
}

/**
 * Retourne une copie de `baseConstraints` où chaque ressource de `resourceGroups`
 * possède un override hebdomadaire (S{weekNumber}) égal à sa disponibilité de base
 * moins les zones de vide.
 */
export function applyBlockedZonesToConstraints(
  resourceGroups: ResourceGroupData[],
  baseConstraints: ConstraintsData | null,
  blockedZones: BlockedZone[],
  weekNumber: number
): ConstraintsData {
  if (blockedZones.length === 0) return baseConstraints ?? {};

  const result: ConstraintsData = baseConstraints ? { ...baseConstraints } : {};
  const weekKey = `S${weekNumber}`;

  const allResourceIds = resourceGroups.flatMap((g) => g.resources.map((r) => r.id));

  for (const resourceId of allResourceIds) {
    let slots = getResourceBaseSlots(resourceId, weekNumber, baseConstraints);

    for (const zone of blockedZones) {
      const blockedDay = dateToFrenchDay(zone.start);
      const blockedFrom = zone.start.getHours() * 60 + zone.start.getMinutes();
      const blockedTo = zone.end.getHours() * 60 + zone.end.getMinutes();
      if (blockedFrom >= blockedTo) continue;
      slots = subtractIntervalFromSlots(slots, blockedDay, blockedFrom, blockedTo);
    }

    const existing = (result as Record<string, unknown>)[resourceId];

    if (existing === null || existing === undefined) {
      result[resourceId] = {
        default: baseConstraints?.Default ?? BASE_SLOTS,
        [weekKey]: slots,
      } as ResourceConstraints;
    } else if (Array.isArray(existing)) {
      result[resourceId] = {
        default: existing as TimeSlot[],
        [weekKey]: slots,
      } as ResourceConstraints;
    } else {
      // ResourceConstraints existant — ajouter/remplacer l'override de la semaine
      result[resourceId] = {
        ...(existing as ResourceConstraints),
        [weekKey]: slots,
      } as ResourceConstraints;
    }
  }

  return result;
}
