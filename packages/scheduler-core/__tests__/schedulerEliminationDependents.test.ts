import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';

describe("Scheduler.solveWithElimination() — neutralisation en chaîne des dépendants (CM/TD/TP)", () => {
  it("TD blâmé et éliminé : son TP dépendant (même code) est neutralisé avec lui, sans planter", () => {
    // Reprise du scénario OCCEND/VICEND (schedulerFailureBlame.test.ts), avec un CM et un TP
    // du même code que OCCEND pour câbler automatiquement les dépendances (_determineDependencies) :
    //   CM (code OCCEND) → enforced, 30min, teacher dédié RCM — placé trivialement, aucun rapport
    //   avec R5, ne consomme rien de sa marge.
    //   TD (code OCCEND) → dépend du CM (même groupes). R5 8h-12h (240min), 180min → peu de marge,
    //   MCV le place en premier, il accumule tout le blâme face à VICEND (§5.7).
    //   TP (code OCCEND) → dépend du TD (même groupes). Ressources propres, sans rapport avec R5 —
    //   sa seule contrainte est la dépendance : s'il n'est pas neutralisé avec le TD, il devient
    //   orphelin au round suivant et _backtrack lève une exception.
    //   VICEND (code VICEND) → 90min sur R5, jamais elle-même la cause, ne doit jamais être touchée.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R5' }, { id: 'RCM' }, { id: 'RTP' }] },
        { resourceType: 'group', resources: [{ id: 'G-OCCEND' }, { id: 'G-VICEND' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'OCCEND', type: 'CM', name: 'Ancre CM',
          teacher: ['RCM'], groups: ['G-OCCEND'], rooms: [], duration: 30,
          enforced: { startTime: 480, teacher: ['RCM'], groups: ['G-OCCEND'], rooms: [] }, // 8h-8h30
        },
        {
          week: 30, semester: 1, level: 0, code: 'OCCEND', type: 'TD', name: 'Occupant gourmand',
          teacher: ['R5'], groups: ['G-OCCEND'], rooms: [], duration: 180,
        },
        {
          week: 30, semester: 1, level: 0, code: 'OCCEND', type: 'TP', name: 'TP dépendant',
          teacher: ['RTP'], groups: ['G-OCCEND'], rooms: [], duration: 60,
        },
        {
          week: 30, semester: 1, level: 0, code: 'VICEND', type: 'TD', name: 'Victime finale',
          teacher: ['R5'], groups: ['G-VICEND'], rooms: [], duration: 90,
        },
      ],
      constraints: {
        R5:  [{ days: 'lundi', from: '08:00', to: '12:00' }],
        RCM: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        RTP: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        'G-OCCEND': [{ days: 'lundi', from: '08:00', to: '19:30' }],
        'G-VICEND': [{ days: 'lundi', from: '08:00', to: '19:30' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new Scheduler();

    // Ne doit jamais lever — c'est le crash reproduit avant correctif (dépendant orphelin).
    const results = scheduler.solveWithElimination();

    const r0 = results[0];
    expect(r0.isComplete).toBe(true);
    expect(r0.neutralizedUnits).toBeDefined();

    const neutralized = r0.neutralizedUnits ?? [];
    const neutralizedIds = neutralized.map(n => n.unit.id);

    // Le TD occupant ET son TP dépendant sont neutralisés, au même round.
    expect(neutralizedIds.some(id => id.startsWith('OCCEND_R5'))).toBe(true);
    expect(neutralizedIds.some(id => id.startsWith('OCCEND_RTP'))).toBe(true);
    const tdEntry = neutralized.find(n => n.unit.id.startsWith('OCCEND_R5'))!;
    const tpEntry = neutralized.find(n => n.unit.id.startsWith('OCCEND_RTP'))!;
    expect(tpEntry.eliminationRound).toBe(tdEntry.eliminationRound);
    expect(tpEntry.reason).toContain(tdEntry.unit.label);

    // Le CM (aucun rapport avec la contention) et VICEND (jamais elle-même la cause) restent en place.
    expect(neutralizedIds.some(id => id.startsWith('OCCEND_RCM'))).toBe(false);
    expect(neutralizedIds.some(id => id.startsWith('VICEND'))).toBe(false);
  });

  it("non-régression : une unité éliminée SANS dépendants garde le comportement d'origine", () => {
    // Reprise exacte du scénario OCCEND/VICEND de schedulerFailureBlame.test.ts, sans CM ni TP —
    // le correctif ne doit rien changer quand il n'y a rien à neutraliser en chaîne.
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
    expect(r0.isComplete).toBe(true);
    const neutralizedIds = (r0.neutralizedUnits ?? []).map(n => n.unit.id);
    expect(neutralizedIds.filter(id => id.startsWith('OCCEND'))).toHaveLength(1);
    expect(neutralizedIds.some(id => id.startsWith('VICEND'))).toBe(false);
    expect(r0.neutralizedUnits).toHaveLength(1); // exactement OCCEND, rien d'autre
  });

  it("chaîne transitive : CM éliminé → TD et TP dépendants neutralisés avec lui, au même round", () => {
    // Le CM lui-même est cette fois le "gourmand" en contention directe avec VICEND sur R5.
    // TD dépend du CM (même code+groupes), TP dépend du TD — chaîne à 2 niveaux de profondeur.
    // Leurs propres ressources n'ont aucun rapport avec R5 : seule la dépendance doit être
    // vérifiée par ce test, pas leur plaçabilité individuelle.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R5' }, { id: 'RTD' }, { id: 'RTP' }] },
        { resourceType: 'group', resources: [{ id: 'G-OCCEND' }, { id: 'G-VICEND' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'OCCEND', type: 'CM', name: 'CM gourmand',
          teacher: ['R5'], groups: ['G-OCCEND'], rooms: [], duration: 180,
        },
        {
          week: 30, semester: 1, level: 0, code: 'OCCEND', type: 'TD', name: 'TD dépendant du CM',
          teacher: ['RTD'], groups: ['G-OCCEND'], rooms: [], duration: 60,
        },
        {
          week: 30, semester: 1, level: 0, code: 'OCCEND', type: 'TP', name: 'TP dépendant du TD',
          teacher: ['RTP'], groups: ['G-OCCEND'], rooms: [], duration: 60,
        },
        {
          week: 30, semester: 1, level: 0, code: 'VICEND', type: 'TD', name: 'Victime finale',
          teacher: ['R5'], groups: ['G-VICEND'], rooms: [], duration: 90,
        },
      ],
      constraints: {
        R5:  [{ days: 'lundi', from: '08:00', to: '12:00' }],
        RTD: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        RTP: [{ days: 'lundi', from: '08:00', to: '19:30' }],
        'G-OCCEND': [{ days: 'lundi', from: '08:00', to: '19:30' }],
        'G-VICEND': [{ days: 'lundi', from: '08:00', to: '19:30' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new Scheduler();
    const results = scheduler.solveWithElimination();

    const r0 = results[0];
    expect(r0.isComplete).toBe(true);
    const neutralized = r0.neutralizedUnits ?? [];
    const neutralizedIds = neutralized.map(n => n.unit.id);

    expect(neutralizedIds.some(id => id.startsWith('OCCEND_R5'))).toBe(true);  // CM
    expect(neutralizedIds.some(id => id.startsWith('OCCEND_RTD'))).toBe(true); // TD
    expect(neutralizedIds.some(id => id.startsWith('OCCEND_RTP'))).toBe(true); // TP
    expect(neutralizedIds.some(id => id.startsWith('VICEND'))).toBe(false);

    const rounds = new Set(neutralized.map(n => n.eliminationRound));
    expect(rounds.size).toBe(1); // toute la chaîne au même round
  });
});
