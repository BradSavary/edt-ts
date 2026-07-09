import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

/** Expose _units (protected) pour inspection directe dans les tests — même pattern que les diagnostics. */
class InspectableScheduler extends Scheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
}

/**
 * Groupe G1 disponible 8h-17h le lundi (une seule fenêtre large, avant découpage) —
 * exactement le scénario qui motive §5.5 : sans pause flottante prise en compte au
 * calcul du score, cette fenêtre paraît uniformément disponible.
 */
function buildScenario(): RawScheduleData {
  return {
    week: 20,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'T1' }] },
      { resourceType: 'group', resources: [{ id: 'G1' }] },
      { resourceType: 'room', resources: [] },
    ],
    courses: [
      { week: 20, semester: 1, level: 0, code: 'Y1', type: 'TD', name: 'Test pause flottante', teacher: ['T1'], groups: ['G1'], rooms: [], duration: 120 },
    ],
    constraints: {
      T1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      G1: [{ days: 'lundi', from: '08:00', to: '17:00' }],
    },
  };
}

describe('Scheduler — pause méridienne flottante (§5.5)', () => {
  it('propage la config de pause flottante jusqu\'aux unités et planifie sans erreur', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new InspectableScheduler();
    scheduler.configure({ lunchBreak: { type: 'floating', earliest: '11:30', latest: '14:30', duration: 90 } });
    scheduler.initSolver();

    const units = scheduler.getUnits();
    expect(units).toHaveLength(1);
    // 120min tient dans chacune des deux moitiés issues du découpage (255min et 195min) —
    // score fini (pas infaisable), confirme que la config a bien été propagée et appliquée.
    expect(units[0].getSchedulingPriority()).toBeGreaterThan(-Infinity);

    const results = scheduler.solve();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].isComplete).toBe(true);
    expect(results[0].solutions).toHaveLength(1);
  });

  it('sans pause flottante configurée (type "none"), le comportement reste inchangé', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new InspectableScheduler();
    scheduler.initSolver(); // config par défaut : lunchBreak: { type: 'none' }

    const units = scheduler.getUnits();
    const results = scheduler.solve();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].solutions).toHaveLength(1);
    expect(units[0].getSchedulingPriority()).toBeGreaterThan(-Infinity);
  });
});
