import type { ConstraintsData, ResourceConstraints, TimeSlot } from '@edt-ts/scheduler-common';

export type ResourceTypeUI = 'teacher' | 'room' | 'group' | 'other';

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


