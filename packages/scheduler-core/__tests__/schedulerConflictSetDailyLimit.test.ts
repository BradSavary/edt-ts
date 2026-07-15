import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

/** Expose _units (protected) — même convention que les autres suites de tests. */
class InspectableScheduler extends Scheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
}

function findUnit(units: ISchedulingUnit[], codePrefix: string): ISchedulingUnit {
  const unit = units.find(u => u.id.startsWith(codePrefix));
  if (!unit) throw new Error(`Unité "${codePrefix}" introuvable parmi : ${units.map(u => u.id).join(', ')}`);
  return unit;
}

/**
 * U et W (enforced, 60min chacune, tôt le matin) épuisent à eux deux le plafond quotidien
 * de G (120min/jour). V (60min, même groupe G) échoue plus tard dans la journée — pas par
 * chevauchement direct (U/W ont terminé depuis longtemps), mais par CUMUL du plafond. G n'est
 * disponible qu'un seul jour (lundi) — aucune échappatoire possible pour V.
 */
function buildScenario(): RawScheduleData {
  return {
    week: 30,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'TU' }, { id: 'TW' }, { id: 'TV' }] },
      { resourceType: 'group', resources: [{ id: 'G', maxDailyMinutes: 120 }] },
      { resourceType: 'room', resources: [{ id: 'RU' }, { id: 'RW' }, { id: 'RV' }] },
    ],
    courses: [
      { week: 30, semester: 1, level: 0, code: 'U1', type: 'TD', name: 'U', teacher: ['TU'], groups: ['G'], rooms: ['RU'], duration: 60,
        enforced: { startTime: 480, teacher: ['TU'], groups: ['G'], rooms: ['RU'] } }, // 8h-9h
      { week: 30, semester: 1, level: 0, code: 'W1', type: 'TD', name: 'W', teacher: ['TW'], groups: ['G'], rooms: ['RW'], duration: 60,
        enforced: { startTime: 540, teacher: ['TW'], groups: ['G'], rooms: ['RW'] } }, // 9h-10h — G à 120/120 pour la journée
      { week: 30, semester: 1, level: 0, code: 'V1', type: 'TD', name: 'V', teacher: ['TV'], groups: ['G'], rooms: ['RV'], duration: 60 },
    ],
    constraints: {
      TU: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      TW: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      TV: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      G:  [{ days: 'lundi', from: '08:00', to: '19:30' }], // un seul jour disponible — aucune échappatoire
      RU: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      RW: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      RV: [{ days: 'lundi', from: '08:00', to: '19:30' }],
    },
  };
}

describe('Scheduler — _computeConflictSet et le plafond quotidien (conflictSetDailyLimitAware)', () => {
  it('flag désactivé (défaut) : angle mort documenté — U et W ne sont PAS blâmées, V se blâme elle-même à tort', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new InspectableScheduler();
    // conflictSetDailyLimitAware non précisé → false par défaut
    scheduler.initSolver();
    scheduler.solve();

    const units = scheduler.getUnits();
    const u = findUnit(units, 'U1'), w = findUnit(units, 'W1'), v = findUnit(units, 'V1');
    const counts = scheduler.getTaskFailureCounts();

    expect(counts.get(u.id)).toBeUndefined();
    expect(counts.get(w.id)).toBeUndefined();
    expect(counts.get(v.id)).toBe(1);
  });

  it('flag activé : U et W (vraies coupables) sont blâmées ; V ne l\'est plus', () => {
    Loader.loadFromRawData(buildScenario());
    const scheduler = new InspectableScheduler();
    scheduler.configure({ conflictSetDailyLimitAware: true });
    scheduler.initSolver();
    scheduler.solve();

    const units = scheduler.getUnits();
    const u = findUnit(units, 'U1'), w = findUnit(units, 'W1'), v = findUnit(units, 'V1');
    const counts = scheduler.getTaskFailureCounts();

    expect(counts.get(u.id)).toBe(1);
    expect(counts.get(w.id)).toBe(1);
    expect(counts.get(v.id)).toBeUndefined();
  });

  it('bout-en-bout via solveWithElimination() : le flag évite de neutraliser V à tort (U/W enforced = inéligibles, donc rien n\'est neutralisé plutôt qu\'un mauvais choix)', () => {
    Loader.loadFromRawData(buildScenario());
    const schedulerOff = new Scheduler();
    const resultsOff = schedulerOff.solveWithElimination();
    const neutralizedOff = (resultsOff[0]?.neutralizedUnits ?? []).map(n => n.unit.id);
    expect(neutralizedOff.some(id => id.startsWith('V1'))).toBe(true); // V neutralisée à tort

    Loader.loadFromRawData(buildScenario());
    const schedulerOn = new Scheduler();
    schedulerOn.configure({ conflictSetDailyLimitAware: true });
    const resultsOn = schedulerOn.solveWithElimination();
    const neutralizedOn = (resultsOn[0]?.neutralizedUnits ?? []).map(n => n.unit.id);
    // U et W sont enforced, donc inéligibles à l'élimination (boucle limitée aux non-enforced) —
    // le blâme correct désigne des unités qu'on ne peut pas neutraliser : mieux vaut ne rien
    // neutraliser (round cassé immédiatement) que de sacrifier V à tort.
    expect(neutralizedOn).toHaveLength(0);
  });
});
