import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import { TaskUnit } from '../src/taskUnit.js';

/**
 * CM très disponible (720 min) dont dépend un TD très contraint (60 min, tout juste
 * sa propre durée). Avec le score MCV correctif (disponibilité négative), le TD
 * score plus haut que le CM — exactement le cas qui, sans partition "prêt/pas prêt"
 * dans `_dynamicSort`, faisait planter `_backtrack` (dépendant trié avant sa
 * dépendance). Vérifié par A/B testing : ce scénario ne plantait pas avec l'ancien
 * calcul (bug qui rendait tous les scores quasi identiques), seulement après le fix
 * de la priorité — d'où ce test dédié.
 */
function buildScenario(): RawScheduleData {
  return {
    week: 10,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'T_CM' }, { id: 'T_TD' }] },
      { resourceType: 'group', resources: [{ id: 'G1' }] },
      { resourceType: 'room', resources: [] },
    ],
    courses: [
      { week: 10, semester: 1, level: 0, code: 'X1', type: 'CM', name: 'Cours magistral', teacher: ['T_CM'], groups: ['G1'], rooms: [], duration: 60 },
      { week: 10, semester: 1, level: 0, code: 'X1', type: 'TD', name: 'Travaux dirigés', teacher: ['T_TD'], groups: ['G1'], rooms: [], duration: 60 },
    ],
    constraints: {
      T_CM: [{ days: 'lundi', from: '08:00', to: '20:00' }], // 720 min : très disponible
      // Fenêtre positionnée juste après le créneau le plus tôt du CM (08:00-09:00),
      // avec 30 min de marge : tout juste suffisante pour le TD (60 min), très
      // contrainte comparée au CM (90 min vs 720 min).
      T_TD: [{ days: 'lundi', from: '09:00', to: '10:30' }],
      G1: [{ days: 'lundi', from: '08:00', to: '20:00' }],
    },
  };
}

describe('Scheduler — ordre topologique respecté même quand le dépendant est plus contraint que sa dépendance', () => {
  it('planifie le CM avant le TD sans planter, malgré un TD (dépendant) beaucoup plus contraint', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new Scheduler();
    scheduler.initSolver();

    const results = scheduler.solve();

    expect(results.length).toBeGreaterThan(0);
    const solution = results[0].solutions;
    expect(solution).toHaveLength(2);

    const cm = solution.find((s) => (s.unit as TaskUnit).task.type === 'CM')!;
    const td = solution.find((s) => (s.unit as TaskUnit).task.type === 'TD')!;
    expect(cm).toBeDefined();
    expect(td).toBeDefined();

    // La dépendance (CM) doit être terminée avant le début du dépendant (TD).
    expect(td.start).toBeGreaterThanOrEqual(cm.start + cm.unit.duration);
  });
});
