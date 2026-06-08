import { Router, type Request, type Response } from 'express';

const router = Router();

interface HolidayPeriod {
  id: string;
  label: string;
  start: string;
  end: string;
  type: 'vacation' | 'public-holiday';
}

function toFrenchDateString(isoDatetime: string): string {
  const d = new Date(isoDatetime);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

function vacationEndDate(isoDatetime: string): string {
  const d = new Date(isoDatetime);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

async function fetchVacations(year: string, zone: 'A' | 'B' | 'C'): Promise<HolidayPeriod[]> {
  const where = `annee_scolaire="${year}" and zones="Zone ${zone}"`;
  const url =
    `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records` +
    `?where=${encodeURIComponent(where)}&limit=100`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API Éducation Nationale ${res.status}: ${await res.text().catch(() => '')}`);

  const data = await res.json() as {
    results: Array<{ start_date: string; end_date: string; description: string }>;
  };

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
        type: 'vacation',
      });
    }
  }
  return periods;
}

async function fetchPublicHolidays(year: number): Promise<HolidayPeriod[]> {
  const url = `https://calendrier.api.gouv.fr/jours-feries/metropole/${year}.json`;
  const res = await fetch(url);
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

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { year, zone } = req.query as Record<string, string>;

  if (!year || !zone || !['A', 'B', 'C'].includes(zone)) {
    res.status(400).json({ error: 'Paramètres invalides. Requis: year (ex: 2025-2026) et zone (A, B ou C).' });
    return;
  }

  const parts = year.split('-').map(Number);
  const startYear = parts[0];
  const endYear = parts[1];
  if (!startYear || !endYear || isNaN(startYear) || isNaN(endYear)) {
    res.status(400).json({ error: "Format d'année invalide. Attendu: 'YYYY-YYYY' (ex: 2025-2026)" });
    return;
  }

  try {
    const [vacations, ph1, ph2] = await Promise.all([
      fetchVacations(year, zone as 'A' | 'B' | 'C'),
      fetchPublicHolidays(startYear),
      fetchPublicHolidays(endYear),
    ]);

    const phSeen = new Set<string>();
    const publicHolidays: HolidayPeriod[] = [];
    for (const ph of [...ph1, ...ph2]) {
      if (!phSeen.has(ph.id)) {
        phSeen.add(ph.id);
        publicHolidays.push(ph);
      }
    }

    res.json({ year, zone, periods: [...vacations, ...publicHolidays] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/holidays]', message);
    res.status(502).json({ error: message });
  }
});

export default router;
