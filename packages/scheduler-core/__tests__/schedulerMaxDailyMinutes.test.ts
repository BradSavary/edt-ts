import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';

const MINUTES_PER_DAY = 24 * 60;

/**
 * Groupe G3 plafonné à 420min/jour (7h) mais disponible 8h-19h30 (690min) sur deux
 * jours — 5 cours de 120min (600min de demande totale) pour ce groupe, avec un
 * enseignant distinct par cours pour ne pas introduire de contrainte confondante.
 * Sans plafond respecté, rien n'empêcherait le solveur d'empiler jusqu'à 600min sur
 * un seul jour (vérifié ci-dessous via ignoreDailyLimits).
 */
function buildScenario(): RawScheduleData {
  return {
    week: 22,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'T3' }, { id: 'T4' }, { id: 'T5' }, { id: 'T6' }, { id: 'T7' }] },
      { resourceType: 'group', resources: [{ id: 'G3', maxDailyMinutes: 420 }] },
      { resourceType: 'room', resources: [] },
    ],
    courses: [
      { week: 22, semester: 1, level: 0, code: 'C1', type: 'TD', name: 'Cours 1', teacher: ['T3'], groups: ['G3'], rooms: [], duration: 120 },
      { week: 22, semester: 1, level: 0, code: 'C2', type: 'TD', name: 'Cours 2', teacher: ['T4'], groups: ['G3'], rooms: [], duration: 120 },
      { week: 22, semester: 1, level: 0, code: 'C3', type: 'TD', name: 'Cours 3', teacher: ['T5'], groups: ['G3'], rooms: [], duration: 120 },
      { week: 22, semester: 1, level: 0, code: 'C4', type: 'TD', name: 'Cours 4', teacher: ['T6'], groups: ['G3'], rooms: [], duration: 120 },
      { week: 22, semester: 1, level: 0, code: 'C5', type: 'TD', name: 'Cours 5', teacher: ['T7'], groups: ['G3'], rooms: [], duration: 120 },
    ],
    constraints: {
      T3: [{ days: 'lundi', from: '08:00', to: '19:30' }, { days: 'mardi', from: '08:00', to: '19:30' }],
      T4: [{ days: 'lundi', from: '08:00', to: '19:30' }, { days: 'mardi', from: '08:00', to: '19:30' }],
      T5: [{ days: 'lundi', from: '08:00', to: '19:30' }, { days: 'mardi', from: '08:00', to: '19:30' }],
      T6: [{ days: 'lundi', from: '08:00', to: '19:30' }, { days: 'mardi', from: '08:00', to: '19:30' }],
      T7: [{ days: 'lundi', from: '08:00', to: '19:30' }, { days: 'mardi', from: '08:00', to: '19:30' }],
      G3: [{ days: 'lundi', from: '08:00', to: '19:30' }, { days: 'mardi', from: '08:00', to: '19:30' }],
    },
  };
}

function minutesPerDayForResource(
  solutions: { start: number; resources: { id: string }[] }[],
  resourceId: string,
  courseDuration: number,
): Map<number, number> {
  const perDay = new Map<number, number>();
  for (const sol of solutions) {
    if (!sol.resources.some((r) => r.id === resourceId)) continue;
    const dayIndex = Math.floor(sol.start / MINUTES_PER_DAY);
    perDay.set(dayIndex, (perDay.get(dayIndex) ?? 0) + courseDuration);
  }
  return perDay;
}

describe('Scheduler — plafond quotidien maxDailyMinutes', () => {
  it('respecte le plafond quotidien par défaut, répartit la charge sur plusieurs jours', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new Scheduler();
    scheduler.initSolver();
    const results = scheduler.solve();

    expect(results.length).toBeGreaterThan(0);
    const r0 = results[0];
    expect(r0.isComplete).toBe(true);

    const perDay = minutesPerDayForResource(r0.solutions, 'G3', 120);
    for (const minutes of perDay.values()) {
      expect(minutes).toBeLessThanOrEqual(420);
    }
    // Les 600min de demande ne peuvent pas tenir sur un seul jour plafonné à 420 —
    // la répartition sur au moins deux jours est la preuve que le plafond a bien agi.
    expect(perDay.size).toBeGreaterThanOrEqual(2);
  });

  it('ignoreDailyLimits: true contourne le plafond (confirme que c\'est bien lui qui contraint le cas par défaut)', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new Scheduler();
    scheduler.configure({ ignoreDailyLimits: true });
    scheduler.initSolver();
    const results = scheduler.solve();

    expect(results.length).toBeGreaterThan(0);
    const r0 = results[0];
    expect(r0.isComplete).toBe(true);

    const perDay = minutesPerDayForResource(r0.solutions, 'G3', 120);
    const maxMinutesOnOneDay = Math.max(...perDay.values());
    expect(maxMinutesOnOneDay).toBeGreaterThan(420);
  });
});
