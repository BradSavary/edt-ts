import type { ConstraintsData, ResourceConstraints, TimeSlot } from '@edt-ts/scheduler-common';

export type ResourceType = 'teacher' | 'room' | 'group' | 'other';

const STORAGE_KEY = 'edt-constraints';

export const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
export type DayName = (typeof DAYS)[number];

export interface DaySlot {
  from: string;
  to: string;
}

export type DayMap = Record<DayName, DaySlot[]>;

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  teacher: 'Enseignant',
  room: 'Salle',
  group: 'Groupe',
  other: 'Autre',
};

/** Detect resource type from its ID key */
export function detectResourceType(id: string): ResourceType {
  if (id === 'Default') return 'other';
  if (/^BUT\d+-G\d{1,2}$/i.test(id)) return 'group';
  if (/^(R\d+|ADM\d+|\d+)$/.test(id)) return 'room';
  if (/^(Amphi|Labo|Studio|R0X)/i.test(id)) return 'room';
  if (id.includes(' ') && /^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŒ]/.test(id)) return 'teacher';
  return 'other';
}

export function loadConstraints(): ConstraintsData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ConstraintsData) : null;
  } catch {
    return null;
  }
}

export function saveConstraints(data: ConstraintsData): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearConstraints(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

/** Normalize "36" or "S36" → "S36" */
export function normalizeWeekKey(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return `S${trimmed}`;
  if (/^[Ss]\d+$/.test(trimmed)) return `S${trimmed.slice(1)}`;
  return trimmed;
}

/** Get week-specific keys from a ResourceConstraints (excludes "default") */
export function getWeekKeys(rc: ResourceConstraints): string[] {
  return Object.keys(rc).filter((k) => k !== 'default');
}

/** Normalize TimeSlot[] | ResourceConstraints | null → ResourceConstraints | null */
export function normalizeToRC(
  value: TimeSlot[] | ResourceConstraints | null | undefined,
): ResourceConstraints | null {
  if (value == null) return null;
  if (Array.isArray(value)) return { default: value };
  return value;
}

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

/** Compress per-day DayMap back to TimeSlot[] (one entry per day/slot) */
export function dayMapToSlots(dayMap: DayMap): TimeSlot[] {
  const result: TimeSlot[] = [];
  for (const day of DAYS) {
    for (const slot of dayMap[day]) {
      if (slot.from && slot.to) {
        result.push({ days: day, from: slot.from, to: slot.to });
      }
    }
  }
  return result;
}

export function exportAsJSON(data: ConstraintsData): string {
  return JSON.stringify(data, null, 2);
}

// --- Resource weeks (semaines d'activité extraites du CSV) ---

const RESOURCE_WEEKS_KEY = 'edt-resource-weeks';

/** Retourne le mapping resourceId → semaines ISO (lu depuis localStorage). */
export function loadResourceWeeks(): Record<string, number[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(RESOURCE_WEEKS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number[]>) : {};
  } catch {
    return {};
  }
}

/** Sauvegarde le mapping resourceId → semaines ISO dans localStorage. */
export function saveResourceWeeks(map: Record<string, number[]>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(RESOURCE_WEEKS_KEY, JSON.stringify(map));
}

