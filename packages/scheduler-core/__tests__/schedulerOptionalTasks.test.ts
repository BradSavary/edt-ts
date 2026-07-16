import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import { OptionalTasksScheduler } from '../src/optionalTasksScheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

/** Expose l'état interne nécessaire pour observer le B&B dans les tests. */
class InspectableOptionalTasksScheduler extends OptionalTasksScheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
  public getIterations(): number { return this._iterations; }
  public isProvenOptimal(): boolean {
    return (this as unknown as { _provenOptimal: boolean })._provenOptimal;
  }
}

function findUnit(units: ISchedulingUnit[], codePrefix: string): ISchedulingUnit {
  const unit = units.find(u => u.id.startsWith(codePrefix));
  if (!unit) throw new Error(`Unité "${codePrefix}" introuvable parmi : ${units.map(u => u.id).join(', ')}`);
  return unit;
}

describe('OptionalTasksScheduler — branch-and-bound sur les sauts (docs/PlanOptionalTasksP1.md)', () => {
  it('instance faisable : 0 saut, arrêt anticipé, mêmes placements que Scheduler.solve()', () => {
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'T1' }, { id: 'T2' }] },
        { resourceType: 'group', resources: [{ id: 'G1' }, { id: 'G2' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'C1', type: 'TD', name: 'C1', teacher: ['T1'], groups: ['G1'], rooms: [], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'C2', type: 'TD', name: 'C2', teacher: ['T2'], groups: ['G2'], rooms: [], duration: 60 },
      ],
      constraints: {
        T1: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        T2: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        G1: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        G2: [{ days: 'lundi', from: '08:00', to: '19:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const sOpt = new InspectableOptionalTasksScheduler();
    const resOpt = sOpt.solveWithElimination();

    expect(resOpt).toHaveLength(1);
    expect(resOpt[0].isComplete).toBe(true);
    expect(resOpt[0].solutions).toHaveLength(2);
    expect(resOpt[0].neutralizedUnits ?? []).toHaveLength(0);
    expect(sOpt.isProvenOptimal()).toBe(true);

    Loader.loadFromRawData(scenario);
    const sGreedy = new Scheduler();
    sGreedy.initSolver();
    const resGreedy = sGreedy.solve();

    expect(resOpt[0].solutions.map(s => s.start).sort())
      .toEqual(resGreedy[0].solutions.map(s => s.start).sort());
  });

  it('pigeonhole (cas de référence DUBOIS, conception §3.2) : 3 placées, 1 sautée, optimum PROUVÉ', () => {
    // 1 prof, 3 fenêtres de 120min (lundi/mardi/mercredi 8h-10h), 4 cours de 90min sur des
    // groupes disjoints très larges — bin-packing pur : 4 tâches de 90min ne tiennent jamais
    // à plus de 3 dans 3 fenêtres de 120min, quel que soit l'ordre. LB=1, optimum=1.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'DUBOIS' }] },
        { resourceType: 'group', resources: [{ id: 'GA' }, { id: 'GB' }, { id: 'GC' }, { id: 'GD' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'A', type: 'TD', name: 'A', teacher: ['DUBOIS'], groups: ['GA'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'B', type: 'TD', name: 'B', teacher: ['DUBOIS'], groups: ['GB'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'C', type: 'TD', name: 'C', teacher: ['DUBOIS'], groups: ['GC'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'D', type: 'TD', name: 'D', teacher: ['DUBOIS'], groups: ['GD'], rooms: [], duration: 90 },
      ],
      constraints: {
        DUBOIS: [
          { days: 'lundi', from: '08:00', to: '10:00' },
          { days: 'mardi', from: '08:00', to: '10:00' },
          { days: 'mercredi', from: '08:00', to: '10:00' },
        ],
        GA: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        GB: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        GC: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        GD: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const sOpt = new InspectableOptionalTasksScheduler();
    sOpt.configure({ maxSolutions: 1, maxEliminations: 6, timeoutSeconds: 60, maxIterations: 100_000 });
    const resOpt = sOpt.solveWithElimination();

    expect(resOpt).toHaveLength(1);
    expect(resOpt[0].solutions).toHaveLength(3);
    expect(resOpt[0].neutralizedUnits ?? []).toHaveLength(1);
    expect(resOpt[0].isComplete).toBe(false);
    expect(sOpt.isProvenOptimal()).toBe(true);

    Loader.loadFromRawData(scenario);
    const sGreedy = new Scheduler();
    sGreedy.configure({ maxSolutions: 1, maxEliminations: 6, timeoutSeconds: 60, maxIterations: 100_000 });
    const resGreedy = sGreedy.solveWithElimination();

    const nSkippedOpt = (resOpt[0].neutralizedUnits ?? []).length;
    const nSkippedGreedy = (resGreedy[0]?.neutralizedUnits ?? []).length;
    expect(nSkippedOpt).toBeLessThanOrEqual(nSkippedGreedy);
  });

  it('borne maxEliminations : 0 saut autorisé sur une instance pigeonhole → aucun incumbent', () => {
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'DUBOIS' }] },
        { resourceType: 'group', resources: [{ id: 'GA' }, { id: 'GB' }, { id: 'GC' }, { id: 'GD' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'A', type: 'TD', name: 'A', teacher: ['DUBOIS'], groups: ['GA'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'B', type: 'TD', name: 'B', teacher: ['DUBOIS'], groups: ['GB'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'C', type: 'TD', name: 'C', teacher: ['DUBOIS'], groups: ['GC'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'D', type: 'TD', name: 'D', teacher: ['DUBOIS'], groups: ['GD'], rooms: [], duration: 90 },
      ],
      constraints: {
        DUBOIS: [
          { days: 'lundi', from: '08:00', to: '10:00' },
          { days: 'mardi', from: '08:00', to: '10:00' },
          { days: 'mercredi', from: '08:00', to: '10:00' },
        ],
        GA: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        GB: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        GC: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        GD: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const s = new OptionalTasksScheduler();
    s.configure({ maxEliminations: 0 });
    const res = s.solveWithElimination();

    expect(res).toEqual([]);
  });

  it('cascade de dépendants : sauter un CM inplaçable saute aussi son TD dépendant (coût 2, raisons distinctes)', () => {
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'RCM' }, { id: 'RTD' }] },
        { resourceType: 'group', resources: [{ id: 'G-CM' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        // CM : fenêtre 20min, trop courte pour ses 60min → structurellement inplaçable
        { week: 30, semester: 1, level: 0, code: 'X', type: 'CM', name: 'CM', teacher: ['RCM'], groups: ['G-CM'], rooms: [], duration: 60 },
        // TD même code + mêmes groupes → dépendance auto-détectée sur le CM
        { week: 30, semester: 1, level: 0, code: 'X', type: 'TD', name: 'TD', teacher: ['RTD'], groups: ['G-CM'], rooms: [], duration: 60 },
      ],
      constraints: {
        RCM: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        RTD: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        'G-CM': [{ days: 'lundi', from: '08:00', to: '08:20' }], // 20min, trop court pour le CM (60min)
      },
    };

    Loader.loadFromRawData(scenario);
    const s6 = new OptionalTasksScheduler();
    s6.configure({ maxEliminations: 6 });
    const res6 = s6.solveWithElimination();
    expect(res6).toHaveLength(1);
    const skipped = res6[0].neutralizedUnits ?? [];
    expect(skipped).toHaveLength(2);
    const cm = skipped.find(n => n.unit.id.startsWith('X_RCM'))!;
    const td = skipped.find(n => n.unit.id.startsWith('X_RTD'))!;
    expect(cm).toBeDefined();
    expect(td).toBeDefined();
    expect(cm.reason).toContain('structurellement insuffisantes');
    expect(td.reason).toContain('cascade');
    expect(td.reason).toContain(cm.unit.id);

    // Coût de la cascade = 2 : avec maxEliminations:1, la borne interdit ce saut → aucun incumbent.
    Loader.loadFromRawData(scenario);
    const s1 = new OptionalTasksScheduler();
    s1.configure({ maxEliminations: 1 });
    expect(s1.solveWithElimination()).toEqual([]);
  });

  it('coût des groupes : sauter un TaskGroupUnit de 2 membres coûte 2 (pas 1)', () => {
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'RG' }] },
        { resourceType: 'group', resources: [{ id: 'G-Seq' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'SEQ', type: 'TD', name: 'part1', teacher: ['RG'], groups: ['G-Seq'], rooms: [], duration: 60, taskGroupId: 'GRP1' },
        { week: 30, semester: 1, level: 0, code: 'SEQ', type: 'TD', name: 'part2', teacher: ['RG'], groups: ['G-Seq'], rooms: [], duration: 60, taskGroupId: 'GRP1' },
      ],
      constraints: {
        RG: [{ days: 'lundi', from: '08:00', to: '08:30' }], // 30min, insuffisant pour les 120min du groupe
        'G-Seq': [{ days: 'lundi', from: '08:00', to: '19:00' }],
      },
      groups: [{ id: 'GRP1', type: 'sequential' }],
    };

    Loader.loadFromRawData(scenario);
    const s1 = new OptionalTasksScheduler();
    s1.configure({ maxEliminations: 1 });
    expect(s1.solveWithElimination()).toEqual([]); // coût réel 2 > borne 1

    Loader.loadFromRawData(scenario);
    const s2 = new OptionalTasksScheduler();
    s2.configure({ maxEliminations: 2 });
    const res2 = s2.solveWithElimination();
    expect(res2).toHaveLength(1);
    expect(res2[0].neutralizedUnits ?? []).toHaveLength(1); // 1 UNITÉ (le groupe), mais coût 2 en tâches
  });

  it('anytime sous budget minuscule : un incumbent existe mais l\'optimum n\'est pas prouvé', () => {
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'DUBOIS' }] },
        { resourceType: 'group', resources: [{ id: 'GA' }, { id: 'GB' }, { id: 'GC' }, { id: 'GD' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'A', type: 'TD', name: 'A', teacher: ['DUBOIS'], groups: ['GA'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'B', type: 'TD', name: 'B', teacher: ['DUBOIS'], groups: ['GB'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'C', type: 'TD', name: 'C', teacher: ['DUBOIS'], groups: ['GC'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'D', type: 'TD', name: 'D', teacher: ['DUBOIS'], groups: ['GD'], rooms: [], duration: 90 },
      ],
      constraints: {
        DUBOIS: [
          { days: 'lundi', from: '08:00', to: '10:00' },
          { days: 'mardi', from: '08:00', to: '10:00' },
          { days: 'mercredi', from: '08:00', to: '10:00' },
        ],
        GA: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        GB: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        GC: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        GD: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
      },
    };

    // budget=6 : vérifié empiriquement juste au-dessus de la 1ère descente complète (qui
    // atteint déjà la solution optimale 3/1 dans ce scénario, mais SANS explorer assez pour
    // le prouver — l'arbre n'est pas épuisé).
    Loader.loadFromRawData(scenario);
    const s = new InspectableOptionalTasksScheduler();
    s.configure({ maxIterations: 6, timeoutSeconds: 60 });
    const res = s.solveWithElimination();

    expect(res).toHaveLength(1);
    expect(res[0].solutions.length).toBeGreaterThan(0);
    expect(s.isProvenOptimal()).toBe(false);
  });

  it('enforced jamais sautées : reste dans solutions, jamais dans neutralizedUnits', () => {
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'RE' }] },
        { resourceType: 'group', resources: [{ id: 'G-E' }, { id: 'G-U' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'E1', type: 'TD', name: 'E',
          teacher: ['RE'], groups: ['G-E'], rooms: [], duration: 60,
          enforced: { startTime: 480, teacher: ['RE'], groups: ['G-E'], rooms: [] },
        },
        // 700min > 660min de disponibilité journalière (8h-19h) : ne peut jamais tenir.
        { week: 30, semester: 1, level: 0, code: 'U1', type: 'TD', name: 'U', teacher: ['RE'], groups: ['G-U'], rooms: [], duration: 700 },
      ],
      constraints: {
        RE: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        'G-E': [{ days: 'lundi', from: '08:00', to: '19:00' }],
        'G-U': [{ days: 'lundi', from: '08:00', to: '19:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const s = new InspectableOptionalTasksScheduler();
    const res = s.solveWithElimination();

    expect(res).toHaveLength(1);
    const eUnit = findUnit(s.getUnits(), 'E1');
    const uUnit = findUnit(s.getUnits(), 'U1');
    expect(res[0].solutions.some(sol => sol.unit.id === eUnit.id)).toBe(true);
    expect((res[0].neutralizedUnits ?? []).some(n => n.unit.id === eUnit.id)).toBe(false);
    expect((res[0].neutralizedUnits ?? []).some(n => n.unit.id === uUnit.id)).toBe(true);
  });

  it('jeu de données embarqué (80 tâches) : 80/80 placées, 0 sautée, optimum prouvé', () => {
    Loader.reload();
    const s = new InspectableOptionalTasksScheduler();
    const res = s.solveWithElimination();

    expect(res).toHaveLength(1);
    expect(res[0].isComplete).toBe(true);
    expect(res[0].solutions).toHaveLength(80);
    expect(res[0].neutralizedUnits ?? []).toHaveLength(0);
    expect(s.isProvenOptimal()).toBe(true);
  });
});
