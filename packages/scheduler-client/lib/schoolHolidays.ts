import { getMondayOfISOWeek } from '@/lib/calendar/calendarUtils';
import type { BlockedZone } from '@/lib/calendar/blockedZones';

// ── Modèles ────────────────────────────────────────────────────────────────

export interface HolidayPeriod {
  id: string;
  /** Libellé affiché ("Vacances de Toussaint", "1er janvier"…) */
  label: string;
  /** Date de début inclusive au format ISO "YYYY-MM-DD" */
  start: string;
  /** Date de fin inclusive au format ISO "YYYY-MM-DD" */
  end: string;
  type: 'vacation' | 'public-holiday';
}

export interface SchoolYearConfig {
  /** Ex: "2025-2026" */
  year: string;
  zone: 'A' | 'B' | 'C';
  periods: HolidayPeriod[];
}

// ── Fetch depuis la route API interne ─────────────────────────────────────

/**
 * Appelle /api/holidays?year=2025-2026&zone=A
 * La route Next.js proxifie vers les APIs gouvernementales.
 */
export async function fetchSchoolHolidayConfig(
  year: string,
  zone: 'A' | 'B' | 'C',
): Promise<SchoolYearConfig> {
  const params = new URLSearchParams({ year, zone });
  const res = await fetch(`/api/holidays?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Erreur chargement vacances (${res.status})${body ? ': ' + body : ''}`);
  }
  return res.json() as Promise<SchoolYearConfig>;
}

// ── Calcul des zones bloquées pour une semaine ─────────────────────────────

/**
 * À partir d'un `SchoolYearConfig` et d'un numéro de semaine ISO,
 * retourne les `BlockedZone[]` correspondant aux vacances et jours fériés
 * qui chevauchent cette semaine.
 *
 * Le `year` de la semaine est déduit depuis `config.year` :
 *  - semaine >= 35 → première année (ex: 2025 pour "2025-2026")
 *  - semaine < 35  → deuxième année (ex: 2026 pour "2025-2026")
 */
export function computeHolidayZonesForWeek(
  config: SchoolYearConfig,
  isoWeek: number,
): BlockedZone[] {
  const parts = config.year.split('-').map(Number);
  const startYear = parts[0] ?? new Date().getFullYear();
  const endYear = parts[1] ?? startYear + 1;
  const year = isoWeek >= 35 ? startYear : endYear;

  const monday = getMondayOfISOWeek(isoWeek, year);
  const weekEnd = new Date(monday);
  weekEnd.setDate(monday.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const zones: BlockedZone[] = [];

  for (const period of config.periods) {
    // Dates de la période (fin inclusive → fin du jour)
    const periodStart = new Date(period.start + 'T00:00:00');
    const periodEnd = new Date(period.end + 'T23:59:59');

    // Pas de chevauchement avec la semaine
    if (periodEnd < monday || periodStart > weekEnd) continue;

    // Intersection avec la semaine
    const zoneStart = periodStart < monday ? new Date(monday) : new Date(periodStart);
    const zoneEnd = periodEnd > weekEnd ? new Date(weekEnd) : new Date(periodEnd);
    zoneStart.setHours(0, 0, 0, 0);
    zoneEnd.setHours(23, 59, 59, 999);

    zones.push({
      id: `holiday-${period.id}-w${isoWeek}-y${year}`,
      start: zoneStart,
      end: zoneEnd,
      label: period.label,
      source: period.type,
    });
  }

  return zones;
}

// ── Années scolaires disponibles ───────────────────────────────────────────

/** Génère les années scolaires disponibles autour de l'année courante. */
export function getAvailableSchoolYears(): string[] {
  const currentMonth = new Date().getMonth(); // 0-indexed
  const currentYear = new Date().getFullYear();
  // Si on est en septembre ou après → l'année scolaire courante commence cette année
  const baseYear = currentMonth >= 8 ? currentYear : currentYear - 1;
  return [baseYear - 1, baseYear, baseYear + 1].map((y) => `${y}-${y + 1}`);
}
