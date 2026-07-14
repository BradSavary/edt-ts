import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import { BackjumpingScheduler, createScheduler } from '../src/backjumpingScheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

/** Expose _units (protected) — même convention que schedulerFailureBlame.test.ts. */
class InspectableBackjumpingScheduler extends BackjumpingScheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
}

function findUnit(units: ISchedulingUnit[], codePrefix: string): ISchedulingUnit {
  const unit = units.find(u => u.id.startsWith(codePrefix));
  if (!unit) throw new Error(`Unité "${codePrefix}" introuvable parmi : ${units.map(u => u.id).join(', ')}`);
  return unit;
}

/** Instrumente earlySchedule sur chaque unité : retourne un log des appels (id + créneau demandé/obtenu), dans l'ordre réel d'exécution. */
function instrumentEarlySchedule(units: ISchedulingUnit[]): { id: string; fromTime: number; start: number | null }[] {
  const log: { id: string; fromTime: number; start: number | null }[] = [];
  for (const u of units) {
    const original = u.earlySchedule.bind(u);
    u.earlySchedule = (fromTime: number) => {
      const result = original(fromTime);
      log.push({ id: u.id, fromTime, start: result?.start ?? null });
      return result;
    };
  }
  return log;
}

describe('BackjumpingScheduler — rejoue les scénarios de schedulerFailureBlame.test.ts (§5.7 inchangé)', () => {
  it("cas de base (exemple A/B/C) : même occupant blâmé, même comportement que Scheduler", () => {
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
    const scheduler = new InspectableBackjumpingScheduler();
    scheduler.initSolver();
    scheduler.solve();

    const units = scheduler.getUnits();
    const occUnit = findUnit(units, 'OCC1');
    const vicUnit = findUnit(units, 'VIC1');
    const counts = scheduler.getTaskFailureCounts();

    expect(counts.get(occUnit.id)).toBe(1);
    expect(counts.get(vicUnit.id)).toBeUndefined();
  });

  it('repli sans occupant : infaisabilité structurelle blâme encore l\'unité elle-même', () => {
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
    const scheduler = new InspectableBackjumpingScheduler();
    scheduler.initSolver();
    scheduler.solve();

    const units = scheduler.getUnits();
    const structUnit = findUnit(units, 'STRUCT1');
    const counts = scheduler.getTaskFailureCounts();

    expect(counts.get(structUnit.id)).toBe(1);
  });

  it('filtre temporel : une réservation entièrement AVANT fromTime n\'est pas blâmée', () => {
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
          enforced: { startTime: 480, teacher: ['R3'], groups: ['G-E'], rooms: [] },
        },
        {
          week: 30, semester: 1, level: 0, code: 'X1', type: 'CM', name: 'Ancre de dépendance',
          teacher: ['R4'], groups: ['G-F'], rooms: [], duration: 60,
          enforced: { startTime: 600, teacher: ['R4'], groups: ['G-F'], rooms: [] },
        },
        {
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
    const scheduler = new InspectableBackjumpingScheduler();
    scheduler.initSolver();
    scheduler.solve();

    const units = scheduler.getUnits();
    const eUnit = findUnit(units, 'E1');
    const fUnit = findUnit(units, 'X1_R3');
    const counts = scheduler.getTaskFailureCounts();

    expect(counts.get(fUnit.id)).toBe(1);
    expect(counts.get(eUnit.id)).toBeUndefined();
  });

  it("bout-en-bout via solveWithElimination() : l'unité réellement bloquante est éliminée, pas la victime", () => {
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
    const scheduler = new BackjumpingScheduler();
    const results = scheduler.solveWithElimination();

    const r0 = results[0];
    expect(r0.neutralizedUnits).toBeDefined();
    const neutralizedIds = (r0.neutralizedUnits ?? []).map(n => n.unit.id);
    expect(neutralizedIds.some(id => id.startsWith('OCCEND'))).toBe(true);
    expect(neutralizedIds.some(id => id.startsWith('VICEND'))).toBe(false);
    expect(r0.isComplete).toBe(true);
  });
});

describe('BackjumpingScheduler — saut prouvé par instrumentation (§4.5, exemple des "5 réunions A-E")', () => {
  it("A et E partagent SALLE (fenêtre exactement saturée par A) : E échoue, on ne re-sollicite JAMAIS B, C, D", () => {
    // Reprise directe de l'exemple du document de conception : 5 réunions A-E, E échoue à
    // cause de A. Ici, grâce au tri MCV dynamique (déjà en place indépendamment du
    // backjumping), dès que A réserve SALLE (8h-9h, fenêtre exactement de sa durée),
    // E devient instantanément l'unité la plus contrainte (0 créneau restant) et est donc
    // traitée juste après A — B, C, D (largement disponibles sur leurs propres ressources)
    // ne sont JAMAIS sollicitées, ce qui est une preuve encore plus forte que la formulation
    // du document (qui suppose un ordre chronologique figé) : elles ne sont pas seulement
    // "non re-sollicitées après le saut", elles ne sont jamais sollicitées du tout.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'PA' }, { id: 'PB' }, { id: 'PC' }, { id: 'PD' }, { id: 'PE' }] },
        { resourceType: 'group', resources: [{ id: 'GA' }, { id: 'GB' }, { id: 'GC' }, { id: 'GD' }, { id: 'GE' }] },
        { resourceType: 'room', resources: [{ id: 'SALLE' }, { id: 'RB' }, { id: 'RC' }, { id: 'RD' }] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'A1', type: 'TD', name: 'Reunion A', teacher: ['PA'], groups: ['GA'], rooms: ['SALLE'], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'B1', type: 'TD', name: 'Reunion B', teacher: ['PB'], groups: ['GB'], rooms: ['RB'], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'C1', type: 'TD', name: 'Reunion C', teacher: ['PC'], groups: ['GC'], rooms: ['RC'], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'D1', type: 'TD', name: 'Reunion D', teacher: ['PD'], groups: ['GD'], rooms: ['RD'], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'E1', type: 'TD', name: 'Reunion E', teacher: ['PE'], groups: ['GE'], rooms: ['SALLE'], duration: 60 },
      ],
      constraints: {
        PA: [{ days: 'lundi', from: '08:00', to: '09:00' }],
        PB: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        PC: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        PD: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        PE: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        GA: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        GB: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        GC: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        GD: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        GE: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        SALLE: [{ days: 'lundi', from: '08:00', to: '09:00' }],
        RB: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        RC: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        RD: [{ days: 'lundi', from: '08:00', to: '20:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new InspectableBackjumpingScheduler();
    scheduler.configure({ maxSolutions: 1 });
    scheduler.initSolver();
    const log = instrumentEarlySchedule(scheduler.getUnits());
    const results = scheduler.solve();

    const calledIds = log.map(l => l.id);
    const unitA = findUnit(scheduler.getUnits(), 'A1');
    const unitB = findUnit(scheduler.getUnits(), 'B1');
    const unitC = findUnit(scheduler.getUnits(), 'C1');
    const unitD = findUnit(scheduler.getUnits(), 'D1');
    const unitE = findUnit(scheduler.getUnits(), 'E1');

    // B, C, D ne sont jamais sollicitées : la seule fenêtre exploitée par le moteur est A <-> E.
    expect(calledIds.filter(id => id === unitB.id)).toHaveLength(0);
    expect(calledIds.filter(id => id === unitC.id)).toHaveLength(0);
    expect(calledIds.filter(id => id === unitD.id)).toHaveLength(0);

    // A est bien tentée deux fois (placement initial, puis retour après l'échec de E),
    // E une seule fois (son unique tentative échoue immédiatement).
    expect(calledIds.filter(id => id === unitA.id)).toHaveLength(2);
    expect(calledIds.filter(id => id === unitE.id)).toHaveLength(1);
    expect(calledIds).toEqual([unitA.id, unitE.id, unitA.id]);

    // Infaisable par construction (SALLE ne peut accueillir A ET E) : aucune solution.
    expect(results).toHaveLength(0);
  });
});

describe('BackjumpingScheduler — conflit multiple imbriqué : preuve du rescan à chaud (sans fusion Prosser)', () => {
  it('P1 et P2 (profondeurs différentes) bloquent P3 : la cible du saut est le plus profond (P2), puis re-scan pur après déplacement de P1', () => {
    // SHARED : fenêtre de 120min (8h-10h), exactement assez pour DEUX réunions de 60min.
    // P1, P2, P3 réclament chacune SHARED (aucune alternative de ressource) → 3x60=180min
    // demandés pour 120min disponibles : infaisable par construction (somme des énergies,
    // §4.4), mais l'intérêt du test est le CHEMIN emprunté pour le prouver.
    //
    // Trace confirmée (voir packages/scheduler-core/examples/backjumping-explore-tmp.ts,
    // supprimé après usage) :
    //   P1@0->480, P2@0->540, P3@0->NULL (occupants={P1,P2}, cible=P2 le plus profond)
    //   P2@570->NULL (P1 déjà hors fenêtre pertinente à 570 → occupants={} → repli)
    //   P1@510->510 (P1 retente, réussit)
    //   P2@0->NULL (occupants={P1} seul désormais — P2 n'est plus dans _solution du tout
    //               à ce stade : preuve que rien n'a été mémorisé de la 1ère fusion)
    //   P1@540->540 (P1 retente encore, réussit)
    //   P2@0->480 (réussit enfin, sur le nouveau trou laissé par P1)
    //   P3@0->NULL (occupants={P1,P2} à NOUVEAU, mais avec des horaires différents du 1er
    //               passage — preuve que le conflit est recalculé à chaud, pas réutilisé)
    //   P2@510->NULL, P1@570->NULL → plus aucun candidat, aucune solution.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'SHARED' }] },
        { resourceType: 'group', resources: [{ id: 'G1' }, { id: 'G2' }, { id: 'G3' }] },
        { resourceType: 'room', resources: [{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'P1', type: 'TD', name: 'P1', teacher: ['SHARED'], groups: ['G1'], rooms: ['R1'], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'P2', type: 'TD', name: 'P2', teacher: ['SHARED'], groups: ['G2'], rooms: ['R2'], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'P3', type: 'TD', name: 'P3', teacher: ['SHARED'], groups: ['G3'], rooms: ['R3'], duration: 60 },
      ],
      constraints: {
        SHARED: [{ days: 'lundi', from: '08:00', to: '10:00' }],
        G1: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        G2: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        G3: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        R1: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        R2: [{ days: 'lundi', from: '08:00', to: '20:00' }],
        R3: [{ days: 'lundi', from: '08:00', to: '20:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const scheduler = new InspectableBackjumpingScheduler();
    scheduler.configure({ maxSolutions: 1 });
    scheduler.initSolver();
    const log = instrumentEarlySchedule(scheduler.getUnits());
    const results = scheduler.solve();

    const p1 = findUnit(scheduler.getUnits(), 'P1');
    const p2 = findUnit(scheduler.getUnits(), 'P2');
    const p3 = findUnit(scheduler.getUnits(), 'P3');

    // Le tout premier échec (P3) doit immédiatement suivre P1 puis P2 (les deux occupants
    // possibles) — et le saut doit revenir sur P2 (le plus profond), jamais directement sur P1.
    expect(log[0]).toMatchObject({ id: p1.id, start: 480 });
    expect(log[1]).toMatchObject({ id: p2.id, start: 540 });
    expect(log[2]).toMatchObject({ id: p3.id, start: null });
    expect(log[3].id).toBe(p2.id); // cible du saut = P2, pas P1 : preuve du "plus profond d'abord"

    // Après le déplacement de P1, un second échec de P2 doit retrouver P1 SEUL comme
    // occupant (et non plus {P1,P2}) : preuve que rien n'a été mémorisé de l'ensemble de
    // conflit précédent, seul l'état courant de _solution compte (rescan à chaud).
    const secondP2Failure = log.findIndex((entry, i) => i > 3 && entry.id === p2.id && entry.start === null);
    expect(secondP2Failure).toBeGreaterThan(3);
    expect(log[secondP2Failure + 1].id).toBe(p1.id); // cible du 2e saut = P1 (seul occupant restant)

    // Infaisable par construction (3x60min > 120min disponibles) : aucune solution, mais
    // convergence rapide (pas d'explosion combinatoire malgré les rescans répétés).
    expect(results).toHaveLength(0);
    expect((scheduler as unknown as { _iterations: number })._iterations).toBeLessThan(20);
  });
});

describe('BackjumpingScheduler — non-régression sur le jeu embarqué (80 tâches)', () => {
  it('place toujours 80/80 unités, sans neutralisation, comme Scheduler', () => {
    Loader.reload();
    const scheduler = new BackjumpingScheduler();
    scheduler.initSolver();
    const results = scheduler.solveWithElimination();

    expect(results.length).toBeGreaterThan(0);
    const r0 = results[0];
    expect(r0.isComplete).toBe(true);
    expect(r0.solutions).toHaveLength(80);
    expect(r0.neutralizedUnits ?? []).toHaveLength(0);
  });
});

describe('createScheduler — fabrique de sélection par configuration', () => {
  it("retourne un Scheduler par défaut (pas d'options, ou algorithm='backtracking')", () => {
    expect(createScheduler()).toBeInstanceOf(Scheduler);
    expect(createScheduler()).not.toBeInstanceOf(BackjumpingScheduler);
    expect(createScheduler({ algorithm: 'backtracking' })).toBeInstanceOf(Scheduler);
  });

  it("retourne un BackjumpingScheduler quand algorithm='backjumping'", () => {
    const scheduler = createScheduler({ algorithm: 'backjumping' });
    expect(scheduler).toBeInstanceOf(BackjumpingScheduler);
  });

  it('algorithmName reflète la classe réellement instanciée', () => {
    expect(createScheduler().algorithmName).toBe('backtracking');
    expect(createScheduler({ algorithm: 'backjumping' }).algorithmName).toBe('backjumping');
  });
});
