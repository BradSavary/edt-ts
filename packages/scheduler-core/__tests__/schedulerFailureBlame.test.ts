import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

/** Expose _units (protected) pour retrouver une unité par préfixe d'id dans les tests. */
class InspectableScheduler extends Scheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
}

function findUnit(units: ISchedulingUnit[], codePrefix: string): ISchedulingUnit {
  const unit = units.find(u => u.id.startsWith(codePrefix));
  if (!unit) throw new Error(`Unité "${codePrefix}" introuvable parmi : ${units.map(u => u.id).join(', ')}`);
  return unit;
}

describe('Scheduler — attribution du blâme par occupation réelle (§5.7)', () => {
  it("cas de base (exemple A/B/C du document) : l'occupant d'une ressource saturée est blâmé, pas l'unité qui échoue", () => {
    // R1 : 8h-12h (240min). OCC1 (enforced) occupe [8h,9h] (60min) → il ne reste que
    // 180min, insuffisant pour VIC1 (200min) — VIC1 échoue dès son premier essai.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R1' }] },
        { resourceType: 'group', resources: [{ id: 'G-OCC1' }, { id: 'G-VIC1' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'OCC1', type: 'TD', name: 'Occupant',
          teacher: ['R1'], groups: ['G-OCC1'], rooms: [], duration: 60,
          enforced: { startTime: 480, teacher: ['R1'], groups: ['G-OCC1'], rooms: [] },
        },
        {
          week: 30, semester: 1, level: 0, code: 'VIC1', type: 'TD', name: 'Victime',
          teacher: ['R1'], groups: ['G-VIC1'], rooms: [], duration: 200,
        },
      ],
      constraints: {
        R1: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        'G-OCC1': [{ days: 'lundi', from: '08:00', to: '12:00' }],
        'G-VIC1': [{ days: 'lundi', from: '08:00', to: '12:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new InspectableScheduler();
    scheduler.initSolver();
    scheduler.solve();

    const units = scheduler.getUnits();
    const occUnit = findUnit(units, 'OCC1');
    const vicUnit = findUnit(units, 'VIC1');
    const counts = scheduler.getTaskFailureCounts();

    expect(counts.get(occUnit.id)).toBe(1); // l'occupant de R1 est blâmé...
    expect(counts.get(vicUnit.id)).toBeUndefined(); // ...pas la victime qui a échoué
  });

  it('repli sans occupant : une infaisabilité structurelle (aucune réservation en cause) blâme encore l\'unité elle-même', () => {
    // Aucune autre unité n'est réservée — R2 est juste trop courte (30min) pour la
    // tâche (60min), dès le départ. Comportement de repli identique à l'ancien mécanisme.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R2' }] },
        { resourceType: 'group', resources: [{ id: 'G-STRUCT' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'STRUCT1', type: 'TD', name: 'Infaisable',
          teacher: ['R2'], groups: ['G-STRUCT'], rooms: [], duration: 60,
        },
      ],
      constraints: {
        R2: [{ days: 'lundi', from: '08:00', to: '08:30' }],
        'G-STRUCT': [{ days: 'lundi', from: '08:00', to: '19:30' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new InspectableScheduler();
    scheduler.initSolver();
    scheduler.solve();

    const units = scheduler.getUnits();
    const structUnit = findUnit(units, 'STRUCT1');
    const counts = scheduler.getTaskFailureCounts();

    expect(counts.get(structUnit.id)).toBe(1);
  });

  it('filtre temporel : une réservation entièrement AVANT fromTime n\'est pas blâmée, même si elle partage la ressource', () => {
    // R3 : 8h-12h (240min). E (enforced) occupe [8h,9h] et se termine à 9h — bien AVANT
    // que F ne commence sa recherche (fromTime=11h, imposé par sa dépendance sur G, un
    // CM du même code enforced à 10h-11h sur une ressource R4 sans rapport). Il ne reste
    // que [11h,12h]=60min sur R3, insuffisant pour F (90min) — mais ce n'est PAS la faute
    // de E (sa réservation est hors de la fenêtre pertinente), donc F doit être blâmée
    // elle-même (repli), pas E.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R3' }, { id: 'R4' }] },
        { resourceType: 'group', resources: [{ id: 'G-E' }, { id: 'G-F' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'E1', type: 'TD', name: 'Occupant précoce',
          teacher: ['R3'], groups: ['G-E'], rooms: [], duration: 60,
          enforced: { startTime: 480, teacher: ['R3'], groups: ['G-E'], rooms: [] }, // 8h-9h
        },
        {
          week: 30, semester: 1, level: 0, code: 'X1', type: 'CM', name: 'Ancre de dépendance',
          teacher: ['R4'], groups: ['G-F'], rooms: [], duration: 60,
          enforced: { startTime: 600, teacher: ['R4'], groups: ['G-F'], rooms: [] }, // 10h-11h
        },
        {
          // Même code que le CM ci-dessus + groupes inclus → dépendance auto-détectée
          // (_determineDependencies, schedulerData.ts) : fromTime(F) = 11h00 = 660.
          week: 30, semester: 1, level: 0, code: 'X1', type: 'TD', name: 'Victime tardive',
          teacher: ['R3'], groups: ['G-F'], rooms: [], duration: 90,
        },
      ],
      constraints: {
        R3: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        R4: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        'G-E': [{ days: 'lundi', from: '08:00', to: '12:00' }],
        'G-F': [{ days: 'lundi', from: '08:00', to: '12:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new InspectableScheduler();
    scheduler.initSolver();
    scheduler.solve();

    const units = scheduler.getUnits();
    const eUnit = findUnit(units, 'E1');
    const fUnit = findUnit(units, 'X1_R3');
    const counts = scheduler.getTaskFailureCounts();

    expect(counts.get(fUnit.id)).toBe(1); // repli : F blâmée elle-même...
    expect(counts.get(eUnit.id)).toBeUndefined(); // ...E exclue malgré le partage de ressource
  });

  it("bout-en-bout via solveWithElimination() : l'unité réellement bloquante est éliminée, pas la victime jamais blâmée", () => {
    // R5 : 8h-12h (240min), aucune dépendance. OCCEND (180min) est plus prioritaire
    // (moins de marge, §5.1) que VICEND (90min) → OCCEND est placé en premier par le
    // tri MCV, quelle que soit sa position parmi ses 3 créneaux possibles, VICEND ne
    // trouve jamais assez de place → OCCEND accumule tout le blâme (jamais VICEND, qui
    // n'est jamais elle-même la cause). Avec l'ancien mécanisme (blâme par tour de rôle),
    // c'est VICEND qui aurait été éliminée à tort.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R5' }] },
        { resourceType: 'group', resources: [{ id: 'G-OCCEND' }, { id: 'G-VICEND' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'OCCEND', type: 'TD', name: 'Occupant gourmand',
          teacher: ['R5'], groups: ['G-OCCEND'], rooms: [], duration: 180,
        },
        {
          week: 30, semester: 1, level: 0, code: 'VICEND', type: 'TD', name: 'Victime finale',
          teacher: ['R5'], groups: ['G-VICEND'], rooms: [], duration: 90,
        },
      ],
      constraints: {
        R5: [{ days: 'lundi', from: '08:00', to: '12:00' }],
        'G-OCCEND': [{ days: 'lundi', from: '08:00', to: '12:00' }],
        'G-VICEND': [{ days: 'lundi', from: '08:00', to: '12:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new Scheduler();
    const results = scheduler.solveWithElimination();

    const r0 = results[0];
    expect(r0.neutralizedUnits).toBeDefined();
    const neutralizedIds = (r0.neutralizedUnits ?? []).map(n => n.unit.id);
    expect(neutralizedIds.some(id => id.startsWith('OCCEND'))).toBe(true);
    expect(neutralizedIds.some(id => id.startsWith('VICEND'))).toBe(false);
    expect(r0.isComplete).toBe(true);
  });
});
