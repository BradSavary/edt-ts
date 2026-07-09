import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import { TaskUnit } from '../src/taskUnit.js';

/**
 * Reproduit, via le moteur complet, l'exemple chiffré CM/TD/TP de §5.6 de
 * docs/HeuristiquePriorite-Conception.md : CM=[0,1000], TD=[500,600], TP=[560,620],
 * durées 60min chacune. `_determineDependencies()` (schedulerData.ts) détecte
 * automatiquement la chaîne CM→TD→TP via le code commun et les groupes.
 */
function buildScenario(): RawScheduleData {
  return {
    week: 30,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'T_CM' }, { id: 'T_TD' }, { id: 'T_TP' }] },
      { resourceType: 'group', resources: [{ id: 'G1' }] },
      { resourceType: 'room', resources: [] },
    ],
    courses: [
      { week: 30, semester: 1, level: 0, code: 'Z1', type: 'CM', name: 'Cours magistral', teacher: ['T_CM'], groups: ['G1'], rooms: [], duration: 60 },
      { week: 30, semester: 1, level: 0, code: 'Z1', type: 'TD', name: 'Travaux dirigés', teacher: ['T_TD'], groups: ['G1'], rooms: [], duration: 60 },
      { week: 30, semester: 1, level: 0, code: 'Z1', type: 'TP', name: 'Travaux pratiques', teacher: ['T_TP'], groups: ['G1'], rooms: [], duration: 60 },
    ],
    constraints: {
      T_CM: [{ days: 'lundi', from: '00:00', to: '16:40' }], // [0,1000]
      T_TD: [{ days: 'lundi', from: '08:20', to: '10:00' }], // [500,600]
      T_TP: [{ days: 'lundi', from: '09:20', to: '10:20' }], // [560,620]
      G1: [{ days: 'lundi', from: '00:00', to: '23:59' }],
    },
  };
}

describe('Scheduler — troncature par échéance de bout en bout (§5.6)', () => {
  it('place CM, TD et TP dans le bon ordre, sans planter, sur l\'exemple chiffré du document', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new Scheduler();
    scheduler.initSolver();

    const results = scheduler.solve();

    expect(results.length).toBeGreaterThan(0);
    const solution = results[0].solutions;
    expect(solution).toHaveLength(3);

    const cm = solution.find((s) => (s.unit as TaskUnit).task.type === 'CM')!;
    const td = solution.find((s) => (s.unit as TaskUnit).task.type === 'TD')!;
    const tp = solution.find((s) => (s.unit as TaskUnit).task.type === 'TP')!;
    expect(cm).toBeDefined();
    expect(td).toBeDefined();
    expect(tp).toBeDefined();

    // Ordre topologique respecté : chaque étape termine avant le début de la suivante.
    expect(td.start).toBeGreaterThanOrEqual(cm.start + cm.unit.duration);
    expect(tp.start).toBeGreaterThanOrEqual(td.start + td.unit.duration);

    // TP (le plus contraint, fenêtre pile à sa durée) doit être placé exactement à 560.
    expect(tp.start).toBe(560);
  });
});
