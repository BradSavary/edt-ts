import { describe, it, expect } from 'vitest';
import {
  computeHolidayZonesForWeek,
  getAvailableSchoolYears,
  type SchoolYearConfig,
} from '../lib/schoolHolidays';

function makeConfig(periods: SchoolYearConfig['periods'] = []): SchoolYearConfig {
  return { year: '2025-2026', zone: 'A', periods };
}

describe('computeHolidayZonesForWeek', () => {
  it('retourne [] si aucune période ne chevauche la semaine', () => {
    const config = makeConfig([
      {
        id: 'toussaint',
        label: 'Vacances de Toussaint',
        start: '2025-10-18',
        end: '2025-11-02',
        type: 'vacation',
      },
    ]);
    // Semaine 47 2025 = lundi 17 nov → période terminée le 2 nov, pas de chevauchement
    const zones = computeHolidayZonesForWeek(config, 47);
    expect(zones).toHaveLength(0);
  });

  it('retourne une zone quand une période chevauche la semaine', () => {
    // Semaine 44 2025 = lundi 27 oct (chevauchement avec la Toussaint 18 oct → 2 nov)
    const config = makeConfig([
      {
        id: 'toussaint',
        label: 'Vacances de Toussaint',
        start: '2025-10-18',
        end: '2025-11-02',
        type: 'vacation',
      },
    ]);
    const zones = computeHolidayZonesForWeek(config, 44);
    expect(zones).toHaveLength(1);
    expect(zones[0].label).toBe('Vacances de Toussaint');
    expect(zones[0].source).toBe('vacation');
  });

  it('source est "public-holiday" pour un jour férié', () => {
    const config = makeConfig([
      {
        id: 'armistice',
        label: '11 novembre',
        start: '2025-11-11',
        end: '2025-11-11',
        type: 'public-holiday',
      },
    ]);
    // Semaine 46 2025 = lundi 10 nov
    const zones = computeHolidayZonesForWeek(config, 46);
    expect(zones).toHaveLength(1);
    expect(zones[0].source).toBe('public-holiday');
  });

  it('génère un id de zone contenant l\'id de la période et le numéro de semaine', () => {
    const config = makeConfig([
      {
        id: 'noel',
        label: 'Vacances de Noël',
        start: '2025-12-20',
        end: '2026-01-04',
        type: 'vacation',
      },
    ]);
    // Semaine 52 2025 = lundi 22 déc
    const zones = computeHolidayZonesForWeek(config, 52);
    expect(zones[0].id).toContain('noel');
    expect(zones[0].id).toContain('52');
  });

  it('utilise l\'année de fin pour les semaines < 35 (2ème partie de l\'année scolaire)', () => {
    // "2025-2026" → semaine 8 → 2026
    const config = makeConfig([
      {
        id: 'hiver',
        label: "Vacances d'hiver",
        start: '2026-02-14',
        end: '2026-03-01',
        type: 'vacation',
      },
    ]);
    // Semaine 8 2026 = lundi 16 fév → chevauchement avec la période
    const zones = computeHolidayZonesForWeek(config, 8);
    expect(zones).toHaveLength(1);
  });

  it('clippe la zone au début de la semaine si la période commence avant', () => {
    const config = makeConfig([
      {
        id: 'ete',
        label: 'Grandes vacances',
        start: '2025-07-01',
        end: '2025-09-07',
        type: 'vacation',
      },
    ]);
    // Semaine 35 2025 = lundi 25 août
    const zones = computeHolidayZonesForWeek(config, 35);
    expect(zones).toHaveLength(1);
    // La zone commence le lundi (pas le 1er juillet)
    expect(zones[0].start.getDay()).toBe(1); // lundi
  });

  it('clippe la zone à la fin de la semaine si la période se termine après', () => {
    const config = makeConfig([
      {
        id: 'ete',
        label: 'Grandes vacances',
        start: '2025-07-01',
        end: '2025-09-07',
        type: 'vacation',
      },
    ]);
    // Semaine 35 2025 = lundi 25 août → dimanche 31 août
    const zones = computeHolidayZonesForWeek(config, 35);
    // La zone se termine au plus tard dimanche de la semaine
    expect(zones[0].end.getDay()).toBe(0); // dimanche (0 en getDay())
  });

  it('retourne plusieurs zones si plusieurs périodes chevauchent la semaine', () => {
    const config = makeConfig([
      {
        id: 'p1',
        label: 'Période 1',
        start: '2025-11-10',
        end: '2025-11-11',
        type: 'vacation',
      },
      {
        id: 'p2',
        label: 'Période 2',
        start: '2025-11-12',
        end: '2025-11-14',
        type: 'public-holiday',
      },
    ]);
    // Semaine 46 2025 = lundi 10 nov
    const zones = computeHolidayZonesForWeek(config, 46);
    expect(zones).toHaveLength(2);
  });
});

describe('getAvailableSchoolYears', () => {
  it('retourne exactement 3 années scolaires', () => {
    expect(getAvailableSchoolYears()).toHaveLength(3);
  });

  it('retourne des années au format "YYYY-YYYY+1"', () => {
    const years = getAvailableSchoolYears();
    for (const y of years) {
      expect(y).toMatch(/^\d{4}-\d{4}$/);
      const [a, b] = y.split('-').map(Number);
      expect(b).toBe((a ?? 0) + 1);
    }
  });

  it('les trois années sont consécutives', () => {
    const years = getAvailableSchoolYears();
    const firstYears = years.map((y) => Number(y.split('-')[0]));
    expect(firstYears[1]).toBe((firstYears[0] ?? 0) + 1);
    expect(firstYears[2]).toBe((firstYears[0] ?? 0) + 2);
  });
});
