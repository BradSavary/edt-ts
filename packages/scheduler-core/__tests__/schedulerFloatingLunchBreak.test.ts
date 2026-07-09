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

  it('une journée trop courte pour la fenêtre de pause reste utilisable (cas réel semaine 37 : jeudi 8h-12h30 vs pause 12h-14h)', () => {
    // Le groupe n'est disponible que 8h-12h30 (270min) le lundi ; la fenêtre de pause
    // flottante est 12h-14h (120min) — chevauchement réel de seulement 30min, bien
    // moins que les 90min de pause requises. Avant correctif, _resourceKeepsFloatingBreak
    // rejetait TOUT placement ce jour-là (aucun horaire ne peut jamais garder 90min
    // libres dans une fenêtre qui n'en offre que 30) — la journée entière disparaissait
    // silencieusement des solutions, quel que soit le cours testé.
    const scenario: RawScheduleData = {
      week: 21,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'T2' }] },
        { resourceType: 'group', resources: [{ id: 'G2' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 21, semester: 1, level: 0, code: 'Y2', type: 'TD', name: 'Test journée courte', teacher: ['T2'], groups: ['G2'], rooms: [], duration: 60 },
      ],
      constraints: {
        T2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        G2: [{ days: 'lundi', from: '08:00', to: '12:30' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new Scheduler();
    scheduler.configure({ lunchBreak: { type: 'floating', earliest: '12:00', latest: '14:00', duration: 90 } });
    scheduler.initSolver();

    const results = scheduler.solve();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].isComplete).toBe(true);
    expect(results[0].solutions).toHaveLength(1);
    // Le placement doit tomber dans la fenêtre 8h-12h30 (480-750), pas ailleurs.
    expect(results[0].solutions[0].start).toBeGreaterThanOrEqual(480);
    expect(results[0].solutions[0].start).toBeLessThan(750);
  });
});
