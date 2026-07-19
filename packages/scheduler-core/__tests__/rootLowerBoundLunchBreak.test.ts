import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { OptionalTasksScheduler } from '../src/optionalTasksScheduler.js';

/**
 * Cohérence de la borne racine avec la pause méridienne FIXE.
 *
 * Les deux types de pause sont implémentés par des mécanismes opposés (voir la docstring de
 * `computeRootLowerBound`) : le flottant est un gate au placement, que la borne doit modéliser
 * elle-même (`floatingLunchDeduction`) ; le fixe est une AMPUTATION des disponibilités des GROUP
 * par `_applyLunchBreak()`, que la borne ne doit surtout pas re-déduire. D'où ces tests passant
 * par le moteur (et non par le module pur) : seul `initSolver()` applique l'amputation.
 */
function build(n90: number, n60: number, avail: Array<{ from: string; to: string }>): RawScheduleData {
  return {
    week: 20,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'T1' }] },
      { resourceType: 'group', resources: [{ id: 'G1' }] },
      { resourceType: 'room', resources: [] },
    ],
    courses: [
      ...Array.from({ length: n90 }, (_, i) => ({
        week: 20, semester: 1, level: 0, code: `A${i}`, type: 'TD', name: `A${i}`,
        teacher: ['T1'], groups: ['G1'], rooms: [], duration: 90,
      })),
      ...Array.from({ length: n60 }, (_, i) => ({
        week: 20, semester: 1, level: 0, code: `B${i}`, type: 'TD', name: `B${i}`,
        teacher: ['T1'], groups: ['G1'], rooms: [], duration: 60,
      })),
    ],
    constraints: {
      T1: [{ days: 'lundi', from: '07:00', to: '20:00' }],
      G1: avail.map(a => ({ days: 'lundi', from: a.from, to: a.to })),
    },
  };
}

const FIXED = { type: 'fixed', from: '12:00', to: '13:30' } as const;

function run(data: RawScheduleData): { placed: number; total: number; lb: number } {
  Loader.reload();
  Loader.loadFromRawData(data);
  const total = Loader.tasksManager.getAllUnits().length;
  const s = new OptionalTasksScheduler();
  s.configure({
    searchStrategy: 'maxPlacement', maxSolutions: 1, maxEliminations: 3,
    timeoutSeconds: 10, maxIterations: 1_000_000, ignoreDailyLimits: false,
    conflictOrderingSearch: true, lunchBreak: FIXED,
  });
  const sol = s.solveWithElimination()[0];
  let placed = 0;
  for (const us of sol?.solutions ?? []) placed += us.task ? 1 : us.unit.getMemberTasks().length;
  return { placed, total, lb: s.rootBound.lb };
}

describe('Borne racine — pause méridienne fixe', () => {
  it('capacité dépassée : lb ne dépasse jamais le nombre réellement sauté', () => {
    // G1 8:00-18:00 (600min) ; la pause fixe 12:00-13:30 est RETIRÉE par _applyLunchBreak
    // ⟹ 8:00-12:00 (240) + 13:30-18:00 (270) = 510min utilisables.
    // Demande 3×90 + 5×60 = 570 > 510 ⟹ au moins un saut inévitable.
    const r = run(build(3, 5, [{ from: '08:00', to: '18:00' }]));
    expect(r.lb).toBeLessThanOrEqual(r.total - r.placed); // lb > sautées = preuve FAUSSE
    expect(r.lb).toBe(1);
  });

  it('indisponibilité chevauchant la plage de pause : pas de double déduction', () => {
    // G1 indispo 11:30-13:00 : la plage de pause est DÉJÀ partiellement absente des dispos.
    // removeAvailability ne peut pas retirer deux fois ⟹ 8:00-11:30 (210) + 13:30-18:00 (270)
    // = 480min. Demande 3×90 + 3×60 = 450 ≤ 480 : tout passe, lb doit rester 0.
    const r = run(build(3, 3, [{ from: '08:00', to: '11:30' }, { from: '13:00', to: '18:00' }]));
    expect(r.placed).toBe(6);
    expect(r.lb).toBe(0);
  });

  it('jour court : plage de pause hors des dispos, aucune capacité à retrancher', () => {
    // G1 dispo 8:00-11:00 (180min) seulement ; la pause 12:00-13:30 est entièrement hors dispo.
    // Demande 2×90 = 180 : tout passe. Une déduction abusive donnerait lb > 0.
    const r = run(build(2, 0, [{ from: '08:00', to: '11:00' }]));
    expect(r.placed).toBe(2);
    expect(r.lb).toBe(0);
  });
});
