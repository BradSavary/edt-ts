import type { ConstraintsData, ResourceConstraints, TimeSlot } from '@edt-ts/scheduler-common';

export type ResourceTypeUI = 'teacher' | 'room' | 'group' | 'other';

/**
 * Types de ressources qui existent réellement dans le catalogue (`resources`) et côté moteur.
 * `other` en est exclu : c'est une case de rangement de l'UI pour les clés de contraintes
 * orphelines (JSON importé, ancien projet), pas une catégorie de ressource planifiable.
 */
export type ResourceCatalogType = Exclude<ResourceTypeUI, 'other'>;

export const RESOURCE_CATALOG_TYPES: ResourceCatalogType[] = ['teacher', 'room', 'group'];

export const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
export type DayName = (typeof DAYS)[number];

export interface DaySlot {
  from: string;
  to: string;
}

export type DayMap = Record<DayName, DaySlot[]>;

export const RESOURCE_TYPE_LABELS: Record<ResourceTypeUI, string> = {
  teacher: 'Enseignant',
  room: 'Salle',
  group: 'Groupe',
  other: 'Autre',
};

/** Detect resource type from its ID key */
export function detectResourceType(id: string): ResourceTypeUI {
  if (id === 'Default') return 'other';
  if (/^BUT\d+-G\d{1,2}$/i.test(id)) return 'group';
  if (/^(R\d+|ADM\d+|\d+)$/.test(id)) return 'room';
  if (/^(Amphi|Labo|Studio|R0X)/i.test(id)) return 'room';
  if (id.includes(' ') && /^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŒ]/.test(id)) return 'teacher';
  return 'other';
}

/** Normalize "36" or "S36" → "S36" */
export function normalizeWeekKey(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return `S${trimmed}`;
  if (/^[Ss]\d+$/.test(trimmed)) return `S${trimmed.slice(1)}`;
  return trimmed;
}

/** Get week-specific keys from a ResourceConstraints (excludes "default") (example: "S36") */
export function getWeekKeys(rc: ResourceConstraints): string[] {
  return Object.keys(rc).filter((k) => /^S\d+$/.test(k));
}

/** Normalize TimeSlot[] | ResourceConstraints | null → ResourceConstraints | null */
export function normalizeToRC(
  value: TimeSlot[] | ResourceConstraints | null | undefined,
): ResourceConstraints | null {
  if (value == null) return null;
  if (Array.isArray(value)) return { default: value };
  return value;
}

export const DEFAULT_SLOTS: TimeSlot[] = [
  { days: 'lundi, mardi, mercredi, jeudi, vendredi', from: '08:00', to: '12:30' },
  { days: 'lundi, mardi, mercredi', from: '13:30', to: '19:30' },
  { days: 'vendredi', from: '13:30', to: '17:30' },
];

export function emptyDayMap(): DayMap {
  return { lundi: [], mardi: [], mercredi: [], jeudi: [], vendredi: [], samedi: [] };
}

/** Pad single-digit hour: "8:00" → "08:00" for <input type="time"> */
export function normalizeTimeForInput(time: string): string {
  const [h, m] = time.split(':');
  return `${String(parseInt(h ?? '0', 10)).padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`;
}

/** Expand TimeSlot[] to per-day format */
export function slotsToDayMap(slots: TimeSlot[]): DayMap {
  const result = emptyDayMap();
  for (const slot of slots) {
    const dayList = slot.days
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d): d is DayName => (DAYS as readonly string[]).includes(d));
    for (const day of dayList) {
      result[day].push({
        from: normalizeTimeForInput(slot.from),
        to: normalizeTimeForInput(slot.to),
      });
    }
  }
  return result;
}

/** Minutes since midnight for a "HH:MM" string, or null if unparsable */
function slotMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** A slot is usable only if it covers a strictly positive duration */
export function isValidSlot(slot: DaySlot): boolean {
  if (!slot.from || !slot.to) return false;
  const from = slotMinutes(slot.from);
  const to = slotMinutes(slot.to);
  if (from === null || to === null) return true; // format libre : laissé tel quel
  return from < to;
}

/** Compress per-day DayMap back to TimeSlot[] (one entry per day/slot) */
export function dayMapToSlots(dayMap: DayMap): TimeSlot[] {
  const result: TimeSlot[] = [];
  for (const day of DAYS) {
    for (const slot of dayMap[day]) {
      // Les créneaux de durée nulle ou inversée ne sont pas sérialisés : ils ne
      // décrivent aucune disponibilité et faisaient planter l'AvailabilityManager.
      if (isValidSlot(slot)) {
        result.push({ days: day, from: slot.from, to: slot.to });
      }
    }
  }
  return result;
}

/**
 * Retire d'un tableau de créneaux ceux de durée nulle ou inversée (`from >= to`).
 * Retourne le tableau d'origine (même référence) si rien n'est à retirer, pour que les
 * comparaisons par référence du stockage ne voient pas de faux changement.
 */
export function sanitizeSlots(slots: TimeSlot[]): TimeSlot[] {
  const kept = slots.filter((s) => isValidSlot(s));
  return kept.length === slots.length ? slots : kept;
}

/**
 * Nettoie un enregistrement de contraintes complet (toutes ressources, `Default` inclus,
 * base `default` et surcharges hebdomadaires `S<n>`) de ses créneaux de durée nulle ou
 * inversée. Un tel créneau ne décrit aucune disponibilité et fait lever `TimeInterval`,
 * ce qui casse tout rendu ou tout solve utilisant les contraintes concernées.
 *
 * Appelé sur tous les chemins d'entrée des contraintes (édition, import JSON, ouverture
 * d'un fichier projet, réhydratation localStorage) pour réparer aussi les projets déjà
 * enregistrés avec de tels créneaux. Retourne l'objet d'origine si rien n'a changé.
 */
export function sanitizeConstraints<T extends Record<string, unknown>>(constraints: T): T {
  let changed = false;
  const result: Record<string, unknown> = {};

  for (const [resourceId, value] of Object.entries(constraints)) {
    if (Array.isArray(value)) {
      const kept = sanitizeSlots(value as TimeSlot[]);
      if (kept !== value) changed = true;
      result[resourceId] = kept;
      continue;
    }

    if (value !== null && typeof value === 'object') {
      const rc = value as Record<string, unknown>;
      let rcChanged = false;
      const nextRC: Record<string, unknown> = {};
      for (const [key, slots] of Object.entries(rc)) {
        if (Array.isArray(slots)) {
          const kept = sanitizeSlots(slots as TimeSlot[]);
          if (kept !== slots) rcChanged = true;
          nextRC[key] = kept;
        } else {
          nextRC[key] = slots;
        }
      }
      if (rcChanged) changed = true;
      result[resourceId] = rcChanged ? nextRC : value;
      continue;
    }

    result[resourceId] = value;
  }

  return changed ? (result as T) : constraints;
}

export function exportAsJSON(data: ConstraintsData): string {
  return JSON.stringify(data, null, 2);
}


