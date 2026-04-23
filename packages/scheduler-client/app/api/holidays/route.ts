import { NextRequest, NextResponse } from 'next/server';
import type { HolidayPeriod, SchoolYearConfig } from '@/lib/schoolHolidays';

/**
 * GET /api/holidays?year=2025-2026&zone=A
 *
 * Proxifie les APIs gouvernementales côté serveur pour éviter les problèmes CORS
 * et bénéficier du cache Next.js (`revalidate: 86400`).
 *
 * Sources :
 * - Vacances scolaires : data.education.gouv.fr (Open Data Éducation Nationale)
 * - Jours fériés : calendrier.api.gouv.fr (métropole uniquement)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const year = searchParams.get('year');
  const zone = searchParams.get('zone') as 'A' | 'B' | 'C' | null;

  if (!year || !zone || !['A', 'B', 'C'].includes(zone)) {
    return NextResponse.json({ error: 'Paramètres invalides. Requis: year (ex: 2025-2026) et zone (A, B ou C).' }, { status: 400 });
  }

  const parts = year.split('-').map(Number);
  const startYear = parts[0];
  const endYear = parts[1];
  if (!startYear || !endYear || isNaN(startYear) || isNaN(endYear)) {
    return NextResponse.json({ error: "Format d'année invalide. Attendu: 'YYYY-YYYY' (ex: 2025-2026)" }, { status: 400 });
  }

  try {
    const [vacations, ph1, ph2] = await Promise.all([
      fetchVacations(year, zone),
      fetchPublicHolidays(startYear),
      fetchPublicHolidays(endYear),
    ]);

    // Dédupliquer les jours fériés (le Nouvel An peut apparaître dans les deux années)
    const phSeen = new Set<string>();
    const publicHolidays: HolidayPeriod[] = [];
    for (const ph of [...ph1, ...ph2]) {
      if (!phSeen.has(ph.id)) {
        phSeen.add(ph.id);
        publicHolidays.push(ph);
      }
    }

    const config: SchoolYearConfig = {
      year,
      zone,
      periods: [...vacations, ...publicHolidays],
    };
    return NextResponse.json(config);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/holidays]', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Convertit un datetime ISO (UTC) en date locale France au format YYYY-MM-DD */
function toFrenchDateString(isoDatetime: string): string {
  const d = new Date(isoDatetime);
  // 'en-CA' renvoie YYYY-MM-DD, timeZone Europe/Paris pour corriger l'offset UTC
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

/**
 * L'API Éducation Nationale stocke `end_date` comme le PREMIER jour de retour en classe
 * (exclusif). On soustrait 1 jour pour obtenir le DERNIER jour de vacances (inclusif).
 */
function vacationEndDate(isoDatetime: string): string {
  const d = new Date(isoDatetime);
  // Reculer d'un jour (dernier jour de vacances au lieu du premier jour de retour)
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

async function fetchVacations(year: string, zone: 'A' | 'B' | 'C'): Promise<HolidayPeriod[]> {
  const where = `annee_scolaire="${year}" and zones="Zone ${zone}"`;
  const url =
    `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records` +
    `?where=${encodeURIComponent(where)}&limit=100`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API Éducation Nationale ${res.status}: ${await res.text().catch(() => '')}`);

  const data = await res.json() as {
    results: Array<{ start_date: string; end_date: string; description: string }>;
  };

  // Dédupliquer par (start_date, end_date) — chaque période est répétée par académie
  const seen = new Set<string>();
  const periods: HolidayPeriod[] = [];
  for (const r of (data.results ?? [])) {
    const startDay = toFrenchDateString(r.start_date);
    const endDay = toFrenchDateString(r.end_date);
    const key = `${startDay}_${endDay}`;
    if (!seen.has(key)) {
      seen.add(key);
      periods.push({
        id: `vac-${startDay}`,
        label: r.description,
        start: startDay,
        end: vacationEndDate(r.end_date),
        type: 'vacation' as const,
      });
    }
  }
  return periods;
}

async function fetchPublicHolidays(year: number): Promise<HolidayPeriod[]> {
  const url = `https://calendrier.api.gouv.fr/jours-feries/metropole/${year}.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API Jours fériés ${res.status}: ${await res.text().catch(() => '')}`);

  const data = await res.json() as Record<string, string>;

  return Object.entries(data).map(([date, label]) => ({
    id: `ph-${date}`,
    label,
    start: date,
    end: date,
    type: 'public-holiday' as const,
  }));
}
