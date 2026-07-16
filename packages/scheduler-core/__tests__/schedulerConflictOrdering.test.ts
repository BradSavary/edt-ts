import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

/** Expose l'état interne nécessaire pour observer/piloter le mécanisme COS dans les tests. */
class InspectableScheduler extends Scheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
  public stampFailure(id: string): void {
    const stamps = (this as unknown as { _conflictStamps: Map<string, number>; _stampCounter: number });
    stamps._conflictStamps.set(id, ++stamps._stampCounter);
  }
  public runDynamicSort(startIndex: number): void { this._dynamicSort(startIndex); }
}

function findUnit(units: ISchedulingUnit[], codePrefix: string): ISchedulingUnit {
  const unit = units.find(u => u.id.startsWith(codePrefix));
  if (!unit) throw new Error(`Unité "${codePrefix}" introuvable parmi : ${units.map(u => u.id).join(', ')}`);
  return unit;
}

// Scénario OCCEND/VICEND — repris tel quel de schedulerFailureBlame.test.ts (§5.7).
function occendScenario(): RawScheduleData {
  return {
    week: 30,
    resources: [
      { resourceType: 'teacher', resources: [{ id: 'R5' }] },
      { resourceType: 'group', resources: [{ id: 'G-OCCEND' }, { id: 'G-VICEND' }] },
      { resourceType: 'room', resources: [] },
    ],
    courses: [
      { week: 30, semester: 1, level: 0, code: 'OCCEND', type: 'TD', name: 'Occupant gourmand', teacher: ['R5'], groups: ['G-OCCEND'], rooms: [], duration: 180 },
      { week: 30, semester: 1, level: 0, code: 'VICEND', type: 'TD', name: 'Victime finale', teacher: ['R5'], groups: ['G-VICEND'], rooms: [], duration: 90 },
    ],
    constraints: {
      R5: [{ days: 'lundi', from: '08:00', to: '12:00' }],
      'G-OCCEND': [{ days: 'lundi', from: '08:00', to: '12:00' }],
      'G-VICEND': [{ days: 'lundi', from: '08:00', to: '12:00' }],
    },
  };
}

describe('Scheduler — Conflict Ordering Search (conflictOrderingSearch, Gay et al. CP 2015)', () => {
  it('flag désactivé (défaut) : comportement strictement inchangé', () => {
    Loader.loadFromRawData(occendScenario());
    const sOff = new Scheduler();
    const resOff = sOff.solveWithElimination();

    Loader.loadFromRawData(occendScenario());
    const sExplicitOff = new Scheduler();
    sExplicitOff.configure({ conflictOrderingSearch: false });
    const resExplicitOff = sExplicitOff.solveWithElimination();

    expect(resOff[0].isComplete).toBe(resExplicitOff[0].isComplete);
    expect(resOff[0].solutions.length).toBe(resExplicitOff[0].solutions.length);
    expect((resOff[0].neutralizedUnits ?? []).map(n => n.unit.id))
      .toEqual((resExplicitOff[0].neutralizedUnits ?? []).map(n => n.unit.id));
  });

  it("invariant d'inertie : sans aucune impasse, le flag actif ne change ni les placements ni le nombre d'itérations", () => {
    // Instance sans la moindre contention : chaque cours a sa propre ressource dédiée.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }] },
        { resourceType: 'group', resources: [{ id: 'G1' }, { id: 'G2' }, { id: 'G3' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'C1', type: 'TD', name: 'C1', teacher: ['T1'], groups: ['G1'], rooms: [], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'C2', type: 'TD', name: 'C2', teacher: ['T2'], groups: ['G2'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'C3', type: 'TD', name: 'C3', teacher: ['T3'], groups: ['G3'], rooms: [], duration: 45 },
      ],
      constraints: {
        T1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        T2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        T3: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        G1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        G2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        G3: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const sOff = new InspectableScheduler();
    sOff.configure({ conflictOrderingSearch: false, maxSolutions: 1 });
    sOff.initSolver();
    const resOff = sOff.solve();

    Loader.loadFromRawData(scenario);
    const sOn = new InspectableScheduler();
    sOn.configure({ conflictOrderingSearch: true, maxSolutions: 1 });
    sOn.initSolver();
    const resOn = sOn.solve();

    expect((sOn as unknown as { _iterations: number })._iterations)
      .toBe((sOff as unknown as { _iterations: number })._iterations);
    expect(resOn[0].solutions.map(s => s.start).sort())
      .toEqual(resOff[0].solutions.map(s => s.start).sort());
  });

  it('mécanisme de réordonnancement : une unité horodatée passe devant les autres "ready", sans toucher aux "notReady" ni changer l\'ordre en l\'absence d\'horodatage', () => {
    // 3 unités indépendantes (aucune dépendance) : sans horodatage, _dynamicSort ne change
    // rien au tri MCV existant ; en horodatant C3 (la moins prioritaire par construction —
    // fenêtre la plus large), elle doit passer en tête du groupe "ready" une fois le flag actif.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }] },
        { resourceType: 'group', resources: [{ id: 'G1' }, { id: 'G2' }, { id: 'G3' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'C1', type: 'TD', name: 'C1', teacher: ['T1'], groups: ['G1'], rooms: [], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'C2', type: 'TD', name: 'C2', teacher: ['T2'], groups: ['G2'], rooms: [], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'C3', type: 'TD', name: 'C3', teacher: ['T3'], groups: ['G3'], rooms: [], duration: 60 },
      ],
      constraints: {
        T1: [{ days: 'lundi', from: '08:00', to: '09:00' }], // C1 : fenêtre exacte, la plus contrainte
        T2: [{ days: 'lundi', from: '08:00', to: '10:00' }], // C2 : un peu de marge
        T3: [{ days: 'lundi', from: '08:00', to: '19:30' }], // C3 : très large, la moins prioritaire
        G1: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        G2: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        G3: [{ days: 'lundi', from: '08:00', to: '19:30' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const s = new InspectableScheduler();
    s.configure({ conflictOrderingSearch: true });
    s.initSolver();
    const c3 = findUnit(s.getUnits(), 'C3');

    // Sans horodatage : ordre MCV inchangé (C1 la plus contrainte en tête).
    s.runDynamicSort(0);
    expect(s.getUnits()[0].id).toBe(findUnit(s.getUnits(), 'C1').id);

    // C3 (la moins prioritaire par construction) horodatée → doit passer en tête au prochain tri.
    s.stampFailure(c3.id);
    s.runDynamicSort(0);
    expect(s.getUnits()[0].id).toBe(c3.id);
  });

  it("scénario adverse (repris de l'audit H1, docs/AuditBackjumping.md §4.1) : le mécanisme réel _dynamicSort+COS reste correct et jamais moins bon que sans le flag", () => {
    // Ordre initial délibérément défavorable [A,Y,X,F] tant qu'aucune impasse n'est survenue —
    // dès la première impasse, on rend la main au _dynamicSort RÉEL (celui du moteur, avec COS
    // actif si le flag l'est) : le mécanisme sous test n'est jamais court-circuité une fois
    // qu'il y a quelque chose à corriger. Constat (documenté dans le compte rendu) : dans ce
    // scénario précis, l'unité qui thrash (Y) ne subit jamais elle-même d'impasse directe (elle
    // trouve toujours un créneau, juste incompatible en aval) — COS, qui ne priorise que les
    // unités personnellement en échec, n'a donc rien à corriger ici : ce test vérifie la
    // non-régression (résultat identique, jamais plus d'itérations), pas un gain.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'P' }, { id: 'TA' }, { id: 'TY' }] },
        { resourceType: 'group', resources: [{ id: 'GA' }, { id: 'GY' }, { id: 'GX' }, { id: 'GF' }] },
        { resourceType: 'room', resources: [{ id: 'S' }, { id: 'RY' }, { id: 'RX' }] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'A1', type: 'TD', name: 'A', teacher: ['TA'], groups: ['GA'], rooms: ['S'], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'Y1', type: 'TD', name: 'Y', teacher: ['TY'], groups: ['GY'], rooms: ['RY'], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'X1', type: 'TD', name: 'X', teacher: ['P'], groups: ['GX'], rooms: ['RX'], duration: 120 },
        { week: 30, semester: 1, level: 0, code: 'F1', type: 'TD', name: 'F', teacher: ['P'], groups: ['GF'], rooms: ['S'], duration: 30 },
      ],
      constraints: {
        P:  [{ days: 'lundi', from: '08:00', to: '11:00' }],
        TA: [{ days: 'lundi', from: '08:30', to: '10:00' }],
        TY: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        S:  [{ days: 'lundi', from: '08:30', to: '10:00' }],
        RY: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        RX: [{ days: 'lundi', from: '08:00', to: '11:00' }],
        GA: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        GY: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        GX: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        GF: [{ days: 'lundi', from: '08:00', to: '19:00' }],
      },
    };

    const FIXED = ['A1', 'Y1', 'X1', 'F1'];
    class HybridScheduler extends InspectableScheduler {
      protected override _dynamicSort(startIndex: number): void {
        const stamps = (this as unknown as { _conflictStamps: Map<string, number> })._conflictStamps;
        if (stamps.size > 0) { super._dynamicSort(startIndex); return; }
        const remaining = this._units.slice(startIndex);
        remaining.sort((a, b) => FIXED.findIndex(p => a.id.startsWith(p)) - FIXED.findIndex(p => b.id.startsWith(p)));
        for (let i = 0; i < remaining.length; i++) this._units[startIndex + i] = remaining[i];
      }
    }

    Loader.loadFromRawData(scenario);
    const sOff = new HybridScheduler();
    sOff.configure({ maxSolutions: 1, timeoutSeconds: 10, maxIterations: 100_000, conflictOrderingSearch: false });
    sOff.initSolver();
    const resOff = sOff.solve();

    Loader.loadFromRawData(scenario);
    const sOn = new HybridScheduler();
    sOn.configure({ maxSolutions: 1, timeoutSeconds: 10, maxIterations: 100_000, conflictOrderingSearch: true });
    sOn.initSolver();
    const resOn = sOn.solve();

    expect(resOff.length).toBeGreaterThan(0);
    expect(resOn.length).toBeGreaterThan(0);
    const itersOff = (sOff as unknown as { _iterations: number })._iterations;
    const itersOn = (sOn as unknown as { _iterations: number })._iterations;
    expect(itersOn).toBeLessThanOrEqual(itersOff); // jamais pire — propriété centrale d'une heuristique d'ordre pure
  });

  it('jeu de données embarqué (80 tâches) : 80/80 placées avec le flag actif, comme sans', () => {
    Loader.reload();
    const s = new Scheduler();
    s.configure({ conflictOrderingSearch: true });
    s.initSolver();
    const results = s.solveWithElimination();
    expect(results[0].isComplete).toBe(true);
    expect(results[0].solutions).toHaveLength(80);
    expect(results[0].neutralizedUnits ?? []).toHaveLength(0);
  });
});
