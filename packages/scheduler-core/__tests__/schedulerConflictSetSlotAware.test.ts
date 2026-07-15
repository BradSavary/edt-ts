import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

class InspectableScheduler extends Scheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
}

function findUnit(units: ISchedulingUnit[], codePrefix: string): ISchedulingUnit {
  const unit = units.find(u => u.id.startsWith(codePrefix));
  if (!unit) throw new Error(`Unité "${codePrefix}" introuvable parmi : ${units.map(u => u.id).join(', ')}`);
  return unit;
}

describe('Scheduler — _computeConflictSet ne blâme un slot que s\'il est collectivement saturé', () => {
  /**
   * ROOM_HOG (enforced) monopolise SALLE toute la journée — vraie cause de l'échec de A.
   * OCCT1 (enforced) occupe juste T1, une alternative parmi cinq pour A (T2..T5 libres) — sans
   * aucun rapport avec la salle. OCCT1 ne doit PAS être blâmée : le slot "prof" de A a quatre
   * autres alternatives libres, donc T1 n'était jamais la cause du blocage.
   */
  it('une unité occupant une alternative parmi plusieurs libres n\'est pas blâmée à tort', () => {
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }, { id: 'T4' }, { id: 'T5' }, { id: 'THOG' }] },
        { resourceType: 'group', resources: [{ id: 'GA' }, { id: 'G_X' }, { id: 'GHOG' }] },
        { resourceType: 'room', resources: [{ id: 'SALLE' }, { id: 'ROOM_X' }] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'ROOMHOG', type: 'TD', name: 'ROOM_HOG', teacher: ['THOG'], groups: ['GHOG'], rooms: ['SALLE'], duration: 600,
          enforced: { startTime: 480, teacher: ['THOG'], groups: ['GHOG'], rooms: ['SALLE'] } }, // 8h-18h, monopolise SALLE
        { week: 30, semester: 1, level: 0, code: 'OCCT1', type: 'TD', name: 'OCCT1', teacher: ['T1'], groups: ['G_X'], rooms: ['ROOM_X'], duration: 30,
          enforced: { startTime: 480, teacher: ['T1'], groups: ['G_X'], rooms: ['ROOM_X'] } }, // occupe juste T1, sans rapport avec SALLE
        { week: 30, semester: 1, level: 0, code: 'A1', type: 'TD', name: 'A', teacher: [['T1', 'T2', 'T3', 'T4', 'T5']], groups: ['GA'], rooms: ['SALLE'], duration: 60 },
      ],
      constraints: {
        T1: [{ days: 'lundi', from: '08:00', to: '18:00' }], T2: [{ days: 'lundi', from: '08:00', to: '18:00' }],
        T3: [{ days: 'lundi', from: '08:00', to: '18:00' }], T4: [{ days: 'lundi', from: '08:00', to: '18:00' }],
        T5: [{ days: 'lundi', from: '08:00', to: '18:00' }], THOG: [{ days: 'lundi', from: '08:00', to: '18:00' }],
        GA: [{ days: 'lundi', from: '08:00', to: '18:00' }], G_X: [{ days: 'lundi', from: '08:00', to: '18:00' }], GHOG: [{ days: 'lundi', from: '08:00', to: '18:00' }],
        SALLE: [{ days: 'lundi', from: '08:00', to: '18:00' }], ROOM_X: [{ days: 'lundi', from: '08:00', to: '18:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new InspectableScheduler();
    scheduler.initSolver();
    scheduler.solve();

    const units = scheduler.getUnits();
    const roomHog = findUnit(units, 'ROOMHOG'), occt1 = findUnit(units, 'OCCT1');
    const counts = scheduler.getTaskFailureCounts();

    expect(counts.get(roomHog.id)).toBe(1); // vraie cause : slot salle saturé (1 seule salle, occupée)
    expect(counts.get(occt1.id)).toBeUndefined(); // slot prof avait 4 autres alternatives libres
  });

  /**
   * Limite connue et documentée (approximation, pas une re-simulation par combo). A a besoin
   * de (T1 OU T2) ET (R1 OU R2), 60min :
   *  - T1 n'est disponible QUE 8h-9h, entièrement consommée par X (enforced, exactement 8h-9h)
   *    → combo (T1,*) toujours impossible, quelle que soit la salle : X est la vraie cause.
   *  - T2 n'est disponible QUE 14h-15h.
   *  - R1 n'est disponible QUE 8h-9h (jamais personne ne la réserve) → ne recouvre jamais la
   *    fenêtre de T2 (14h-15h) : combo (T2,R1) impossible pour une raison structurelle, sans
   *    rapport avec une occupation.
   *  - R2 est large (8h-18h) mais Y (enforced) la réserve pile 14h-15h → combo (T2,R2)
   *    impossible : Y est la vraie cause.
   * Bilan : A échoue toujours, X et Y sont chacun la cause réelle d'au moins un combo — mais au
   * sens du test "slot collectivement saturé", le slot prof a T2 "techniquement libre" et le
   * slot salle a R1 "techniquement libre", donc ni X ni Y ne sont blâmées. Ce test documente
   * explicitement cette limite assumée (pas une régression) — une correction par re-simulation
   * par combo (cf. mémoire de session) serait nécessaire pour la lever.
   */
  it('limite connue : slots partiellement libres mais jamais alignés dans le temps → ni X ni Y blâmés', () => {
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'T1' }, { id: 'T2' }, { id: 'TY' }] },
        { resourceType: 'group', resources: [{ id: 'GA' }, { id: 'GX' }, { id: 'GY' }] },
        { resourceType: 'room', resources: [{ id: 'R1' }, { id: 'R2' }, { id: 'RX' }] },
      ],
      courses: [
        // X occupe T1 en entier (seule fenêtre possible de T1), avec une salle dédiée sans rapport avec A
        { week: 30, semester: 1, level: 0, code: 'X1', type: 'TD', name: 'X', teacher: ['T1'], groups: ['GX'], rooms: ['RX'], duration: 60,
          enforced: { startTime: 480, teacher: ['T1'], groups: ['GX'], rooms: ['RX'] } },
        // Y occupe R2 exactement 14h-15h (avec un prof dédié, sans rapport avec A)
        { week: 30, semester: 1, level: 0, code: 'Y1', type: 'TD', name: 'Y', teacher: ['TY'], groups: ['GY'], rooms: ['R2'], duration: 60,
          enforced: { startTime: 840, teacher: ['TY'], groups: ['GY'], rooms: ['R2'] } },
        // A : prof (T1 OU T2) + salle (R1 OU R2), 60min — aucun combo ne trouve jamais de créneau
        { week: 30, semester: 1, level: 0, code: 'A1', type: 'TD', name: 'A', teacher: [['T1', 'T2']], groups: ['GA'], rooms: [['R1', 'R2']], duration: 60 },
      ],
      constraints: {
        T1: [{ days: 'lundi', from: '08:00', to: '09:00' }], // T1 : uniquement 8h-9h, consommée en entier par X
        T2: [{ days: 'lundi', from: '14:00', to: '15:00' }], // T2 : uniquement 14h-15h
        TY: [{ days: 'lundi', from: '08:00', to: '18:00' }],
        GA: [{ days: 'lundi', from: '08:00', to: '18:00' }], GX: [{ days: 'lundi', from: '08:00', to: '18:00' }], GY: [{ days: 'lundi', from: '08:00', to: '18:00' }],
        R1: [{ days: 'lundi', from: '08:00', to: '09:00' }], // R1 : uniquement 8h-9h — ne recouvre jamais la fenêtre de T2
        R2: [{ days: 'lundi', from: '08:00', to: '18:00' }], // R2 : large, mais Y la prend pile 14h-15h
        RX: [{ days: 'lundi', from: '08:00', to: '18:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new InspectableScheduler();
    scheduler.initSolver();
    const results = scheduler.solve();

    expect(results).toHaveLength(0); // A ne peut jamais être placée (aucun combo ne trouve de créneau)

    const units = scheduler.getUnits();
    const x = findUnit(units, 'X1'), y = findUnit(units, 'Y1'), a = findUnit(units, 'A1');
    const counts = scheduler.getTaskFailureCounts();

    // Limite assumée : ni X ni Y ne sont identifiées comme coupables (chaque slot a une
    // alternative techniquement libre), A se blâme elle-même à défaut.
    expect(counts.get(x.id)).toBeUndefined();
    expect(counts.get(y.id)).toBeUndefined();
    expect(counts.get(a.id)).toBe(1);
  });
});
