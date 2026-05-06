import type { ConstraintsData, ResourceGroupData, TimeSlot, ResourceConstraints } from '@edt-ts/scheduler-common';
import { AvailabilityManager } from '@edt-ts/scheduler-common';

export interface BlockedZone {
  id: string;
  start: Date;
  end: Date;
  /** Libellé affiché dans le calendrier (ex: "Vacances de Toussaint", "1er janvier") */
  label?: string;
  /** Origine de la zone : 'manual' (utilisateur), 'vacation' (vacances scolaires), 'public-holiday' (jour férié) */
  source?: 'manual' | 'vacation' | 'public-holiday';
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

function dateToFrenchDay(date: Date): string {
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
/**
 * Résout les slots d'un Default qui peut être TimeSlot[] ou ResourceConstraints.
 * Si ResourceConstraints, on prend l'override de la semaine donnée si disponible.
 */
function resolveDefaultSlots(defaultValue: unknown, weekNumber: number): TimeSlot[] {
  if (!defaultValue) return BASE_SLOTS;
  if (Array.isArray(defaultValue)) return defaultValue as TimeSlot[];
  // ResourceConstraints
  const rc = defaultValue as Record<string, unknown>;
  const weekKey = `S${weekNumber}`;
  const weekOverride = rc[weekKey];
  if (Array.isArray(weekOverride)) return weekOverride as TimeSlot[];
  const defSlots = rc['default'];
  if (Array.isArray(defSlots)) return defSlots as TimeSlot[];
  return BASE_SLOTS;
}

function getResourceBaseSlots(
  resourceId: string,
  weekNumber: number,
  constraints: ConstraintsData | null
): TimeSlot[] {
  if (!constraints) return BASE_SLOTS;

  // Accès bas niveau pour gérer les valeurs null du JSON réel
  const entry = (constraints as Record<string, unknown>)[resourceId];
  const weekKey = `S${weekNumber}`;

  // null explicite = «pas de contrainte pour cette ressource» → utiliser le Default de l'établissement
  if (entry === null) {
    return resolveDefaultSlots(constraints.Default, weekNumber);
  }
  // undefined = ressource absente du fichier → utiliser le Default de l'établissement
  if (entry === undefined) {
    return resolveDefaultSlots(constraints.Default, weekNumber);
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

  return resolveDefaultSlots(constraints.Default, weekNumber);
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
      // Itérer sur chaque jour calendaire couvert par la zone (support multi-jours)
      const zoneStartDay = new Date(zone.start);
      zoneStartDay.setHours(0, 0, 0, 0);
      const zoneEndDay = new Date(zone.end);
      zoneEndDay.setHours(0, 0, 0, 0);
      const cursor = new Date(zoneStartDay);
      while (cursor <= zoneEndDay) {
        const isFirst = cursor.getTime() === zoneStartDay.getTime();
        const isLast = cursor.getTime() === zoneEndDay.getTime();
        const blockedDay = dateToFrenchDay(cursor);
        const blockedFrom = isFirst ? zone.start.getHours() * 60 + zone.start.getMinutes() : 0;
        const blockedTo = isLast ? zone.end.getHours() * 60 + zone.end.getMinutes() : 24 * 60;
        if (blockedFrom < blockedTo) {
          slots = subtractIntervalFromSlots(slots, blockedDay, blockedFrom, blockedTo);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
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

/**
 * Calcule les plages horaires indisponibles (union) pour un ensemble de ressources
 * pour la semaine affichée. Un créneau est signalé si AU MOINS UNE ressource y est indisponible.
 * Accepte un AvailabilityManager déjà construit (depuis useSchedulerStore) pour éviter
 * de le recréer à chaque appel. Retourne [] si availabilityManager est null.
 */
export function computeConstraintUnavailableZones(
  resourceIds: string[],
  availabilityManager: AvailabilityManager | null,
  weekNumber: number,
  monday: Date,
): { start: Date; end: Date }[] {
  if (resourceIds.length === 0 || !availabilityManager) return [];
  const DAY_START_MIN = 7 * 60;   // 7:00
  const DAY_END_MIN = 21 * 60;    // 21:00
  const result: { start: Date; end: Date }[] = [];

  for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
    // L'AvailabilityManager encode les minutes depuis lundi 0h : lundi=0, mardi=1440, etc.
    const dayStartAbs = dayOffset * 24 * 60;
    const allUnavailable: { from: number; to: number }[] = [];

    for (const resourceId of resourceIds) {
      const avail = availabilityManager.getAvailability(resourceId, weekNumber);

      // Si aucun créneau n'est défini pour cette ressource (contrainte absente ou Default non défini),
      // on considère qu'elle est entièrement disponible → aucune indisponibilité à afficher.
      if (!avail || avail.getAvailableIntervals().length === 0) continue;

      // Plages disponibles ce jour, clampées à [DAY_START_MIN, DAY_END_MIN] (relatif au jour)
      const available: { from: number; to: number }[] = [];

      for (const iv of avail.getAvailableIntervals()) {
        // Convertir minutes absolues → minutes relatives au jour
        const ivFromAbs = iv.start - dayStartAbs;
        const ivToAbs = iv.end - dayStartAbs;
        const from = Math.max(ivFromAbs, DAY_START_MIN);
        const to = Math.min(ivToAbs, DAY_END_MIN);
        if (to > from) available.push({ from, to });
      }

      // Tri + fusion des plages disponibles
      available.sort((a, b) => a.from - b.from);
      const mergedAvail: { from: number; to: number }[] = [];
      for (const iv of available) {
        const last = mergedAvail.at(-1);
        if (last && iv.from <= last.to) last.to = Math.max(last.to, iv.to);
        else mergedAvail.push({ ...iv });
      }

      // Complément = indisponibilités pour cette ressource ce jour
      let cursor = DAY_START_MIN;
      for (const avail of mergedAvail) {
        if (avail.from > cursor) allUnavailable.push({ from: cursor, to: avail.from });
        cursor = Math.max(cursor, avail.to);
      }
      if (cursor < DAY_END_MIN) allUnavailable.push({ from: cursor, to: DAY_END_MIN });
    }

    if (allUnavailable.length === 0) continue;

    // Fusion de toutes les indisponibilités du jour (union des ressources)
    allUnavailable.sort((a, b) => a.from - b.from);
    const merged: { from: number; to: number }[] = [];
    for (const iv of allUnavailable) {
      const last = merged.at(-1);
      if (last && iv.from <= last.to) last.to = Math.max(last.to, iv.to);
      else merged.push({ ...iv });
    }

    // Conversion en dates absolues
    const dayBase = new Date(monday);
    dayBase.setDate(dayBase.getDate() + dayOffset);
    dayBase.setHours(0, 0, 0, 0);

    for (const iv of merged) {
      const start = new Date(dayBase);
      start.setHours(Math.floor(iv.from / 60), iv.from % 60, 0, 0);
      const end = new Date(dayBase);
      end.setHours(Math.floor(iv.to / 60), iv.to % 60, 0, 0);
      result.push({ start, end });
    }
  }

  return result;
}

/**
 * Soustrait les intervalles `subtract` de `base` — retourne base \ subtract (sans chevauchement).
 */
export function subtractDateZones(
  base: { start: Date; end: Date }[],
  subtract: { start: Date; end: Date }[],
): { start: Date; end: Date }[] {
  if (subtract.length === 0) return base;
  const result: { start: Date; end: Date }[] = [];
  for (const bz of base) {
    let segs = [{ start: bz.start, end: bz.end }];
    for (const sz of subtract) {
      const next: { start: Date; end: Date }[] = [];
      for (const s of segs) {
        if (s.end <= sz.start || s.start >= sz.end) {
          next.push(s);
        } else {
          if (s.start < sz.start) next.push({ start: s.start, end: sz.start });
          if (s.end > sz.end) next.push({ start: sz.end, end: s.end });
        }
      }
      segs = next;
    }
    result.push(...segs);
  }
  return result;
}
