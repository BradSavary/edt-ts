import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

/** Expose l'état interne nécessaire pour observer le mécanisme de blâme exact dans les tests. */
class InspectableScheduler extends Scheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
  public getIterations(): number { return this._iterations; }
}

function findUnit(units: ISchedulingUnit[], codePrefix: string): ISchedulingUnit {
  const unit = units.find(u => u.id.startsWith(codePrefix));
  if (!unit) throw new Error(`Unité "${codePrefix}" introuvable parmi : ${units.map(u => u.id).join(', ')}`);
  return unit;
}

describe('Scheduler — blâme exact par ensemble minimal de conflit (conflictSetExact, deletion-MUS)', () => {
  it('flag off = défaut inchangé (repris de schedulerFailureBlame.test.ts, cas de base)', () => {
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
    const sImplicit = new Scheduler();
    sImplicit.initSolver();
    sImplicit.solve();

    Loader.loadFromRawData(scenario);
    const sExplicit = new Scheduler();
    sExplicit.configure({ conflictSetExact: false });
    sExplicit.initSolver();
    sExplicit.solve();

    expect([...sExplicit.getTaskFailureCounts().entries()])
      .toEqual([...sImplicit.getTaskFailureCounts().entries()]);
  });

  it("invariant d'inexploration : le blâme (quel que soit le mode) ne modifie jamais les placements ni le nombre d'itérations de _backtrack", () => {
    // A (lundi 8h-9h) et B (vendredi 8h-9h) enforced, partagent le même prof R que U (60min,
    // dispo lundi 8h-9h uniquement) — U échoue, ce qui fait tourner le blâme dans les deux modes.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R' }] },
        { resourceType: 'group', resources: [{ id: 'G-A' }, { id: 'G-B' }, { id: 'G-U' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'A1', type: 'TD', name: 'A',
          teacher: ['R'], groups: ['G-A'], rooms: [], duration: 60,
          enforced: { startTime: 480, teacher: ['R'], groups: ['G-A'], rooms: [] }, // lundi 8h-9h
        },
        {
          week: 30, semester: 1, level: 0, code: 'B1', type: 'TD', name: 'B',
          teacher: ['R'], groups: ['G-B'], rooms: [], duration: 60,
          enforced: { startTime: 6240, teacher: ['R'], groups: ['G-B'], rooms: [] }, // vendredi 8h-9h
        },
        {
          week: 30, semester: 1, level: 0, code: 'U1', type: 'TD', name: 'U',
          teacher: ['R'], groups: ['G-U'], rooms: [], duration: 60,
        },
      ],
      constraints: {
        R: [{ days: 'lundi,vendredi', from: '08:00', to: '19:00' }],
        'G-A': [{ days: 'lundi', from: '08:00', to: '19:00' }],
        'G-B': [{ days: 'vendredi', from: '08:00', to: '19:00' }],
        'G-U': [{ days: 'lundi', from: '08:00', to: '09:00' }], // fenêtre exacte, 60min
      },
    };

    Loader.loadFromRawData(scenario);
    const sOff = new InspectableScheduler();
    sOff.configure({ conflictSetExact: false });
    sOff.initSolver();
    const resOff = sOff.solve();

    Loader.loadFromRawData(scenario);
    const sOn = new InspectableScheduler();
    sOn.configure({ conflictSetExact: true });
    sOn.initSolver();
    const resOn = sOn.solve();

    // Instance volontairement infaisable (U ne peut jamais être placée) : aucune solution
    // complète des deux côtés, mais l'exploration elle-même (nombre d'itérations) doit être
    // strictement identique — c'est l'invariant clé du plan (§1) : le blâme n'influence jamais
    // le chemin d'exploration de _backtrack, seulement les cibles de solveWithElimination.
    expect(resOff.length).toBe(0);
    expect(resOn.length).toBe(0);
    expect(sOn.getIterations()).toBe(sOff.getIterations());
  });

  it("faux positif éliminé : le blâme exact n'accuse plus une entrée qui occupe la ressource à un moment hors de portée de l'unité en échec", () => {
    // R (prof) partagé par A, B et U. A (lundi 8h-9h, enforced) occupe le SEUL créneau
    // utilisable de U (G-U dispo lundi 8h-9h uniquement, 60min exact) — la retirer suffit à
    // rendre U plaçable. B (vendredi 8h-9h, enforced) occupe aussi R, mais à un moment où
    // U ne pourrait de toute façon jamais se placer (G-U n'est jamais dispo le vendredi) —
    // c'est exactement le biais mesuré sur la semaine 40 (66,8% de faux positifs) : l'ancien
    // scan blâme "quiconque occupe R après fromTime", sans vérifier que ce moment est
        // pertinent pour U.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R' }] },
        { resourceType: 'group', resources: [{ id: 'G-A' }, { id: 'G-B' }, { id: 'G-U' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'A1', type: 'TD', name: 'A',
          teacher: ['R'], groups: ['G-A'], rooms: [], duration: 60,
          enforced: { startTime: 480, teacher: ['R'], groups: ['G-A'], rooms: [] }, // lundi 8h-9h
        },
        {
          week: 30, semester: 1, level: 0, code: 'B1', type: 'TD', name: 'B',
          teacher: ['R'], groups: ['G-B'], rooms: [], duration: 60,
          enforced: { startTime: 6240, teacher: ['R'], groups: ['G-B'], rooms: [] }, // vendredi 8h-9h
        },
        {
          week: 30, semester: 1, level: 0, code: 'U1', type: 'TD', name: 'U',
          teacher: ['R'], groups: ['G-U'], rooms: [], duration: 60,
        },
      ],
      constraints: {
        R: [{ days: 'lundi,vendredi', from: '08:00', to: '19:00' }],
        'G-A': [{ days: 'lundi', from: '08:00', to: '19:00' }],
        'G-B': [{ days: 'vendredi', from: '08:00', to: '19:00' }],
        'G-U': [{ days: 'lundi', from: '08:00', to: '09:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const sOff = new InspectableScheduler();
    sOff.initSolver();
    sOff.solve();
    const unitsOff = sOff.getUnits();
    const aOff = findUnit(unitsOff, 'A1');
    const bOff = findUnit(unitsOff, 'B1');
    const countsOff = sOff.getTaskFailureCounts();

    expect(countsOff.get(aOff.id)).toBe(1); // vrai coupable
    expect(countsOff.get(bOff.id)).toBe(1); // faux positif de l'ancien scan

    Loader.loadFromRawData(scenario);
    const sOn = new InspectableScheduler();
    sOn.configure({ conflictSetExact: true });
    sOn.initSolver();
    sOn.solve();
    const unitsOn = sOn.getUnits();
    const aOn = findUnit(unitsOn, 'A1');
    const bOn = findUnit(unitsOn, 'B1');
    const countsOn = sOn.getTaskFailureCounts();

    expect(countsOn.get(aOn.id)).toBe(1); // toujours accusé, à raison
    expect(countsOn.get(bOn.id)).toBeUndefined(); // faux positif éliminé
  });

  it('impasse structurelle : le blâme exact retombe sur l\'unité elle-même quand aucune entrée placée ne peut être la cause', () => {
    // G-narrow n'a que 20min de disponibilité — intrinsèquement trop court pour les 60min de
    // U, quel que soit l'état de R-shared. Z (enforced) occupe R-shared à un moment sans
    // rapport — l'ancien scan la blâme à tort (elle "occupe" R-shared après fromTime=0) ; le
    // blâme exact découvre, en la libérant, que U reste inplaçable (probePlaceable échoue
    // toujours) et retombe correctement sur le repli self-blame.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R-shared' }] },
        { resourceType: 'group', resources: [{ id: 'G-narrow' }, { id: 'G-Z' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'Z1', type: 'TD', name: 'Z',
          teacher: ['R-shared'], groups: ['G-Z'], rooms: [], duration: 60,
          enforced: { startTime: 600, teacher: ['R-shared'], groups: ['G-Z'], rooms: [] }, // lundi 10h-11h
        },
        {
          week: 30, semester: 1, level: 0, code: 'U2', type: 'TD', name: 'U',
          teacher: ['R-shared'], groups: ['G-narrow'], rooms: [], duration: 60,
        },
      ],
      constraints: {
        'R-shared': [{ days: 'lundi', from: '08:00', to: '19:00' }],
        'G-Z': [{ days: 'lundi', from: '08:00', to: '19:00' }],
        'G-narrow': [{ days: 'lundi', from: '08:00', to: '08:20' }], // 20min, trop court
      },
    };

    Loader.loadFromRawData(scenario);
    const sOff = new InspectableScheduler();
    sOff.initSolver();
    sOff.solve();
    const zOff = findUnit(sOff.getUnits(), 'Z1');
    expect(sOff.getTaskFailureCounts().get(zOff.id)).toBe(1); // faux blâme (documenté, comportement actuel)

    Loader.loadFromRawData(scenario);
    const sOn = new InspectableScheduler();
    sOn.configure({ conflictSetExact: true });
    sOn.initSolver();
    sOn.solve();
    const units = sOn.getUnits();
    const zOn = findUnit(units, 'Z1');
    const uOn = findUnit(units, 'U2');
    const countsOn = sOn.getTaskFailureCounts();

    expect(countsOn.get(zOn.id)).toBeUndefined(); // plus de faux blâme sur Z
    expect(countsOn.get(uOn.id)).toBe(1); // repli self-blame correct
  });

  it(
    'coupable par quota quotidien (limite connue) : le rejet exhaustif par filtre pousse fromTime ' +
    'jusqu\'au bord de la fenêtre, rendant le contrefactuel aveugle même après libération du vrai ' +
    'coupable — comportement identique (self-blame) dans les deux modes, documenté ici plutôt que caché',
    () => {
      // E (enforced, 90min) sature à lui seul le quota journalier (90) de G-shared. U (30min,
      // teacher dédié R-U) cherche ensuite un créneau sur G-shared : earlySchedule (qui ignore
      // le quota) propose 9h30 (juste après E), rejeté par _dailyLimitAllows ; la boucle
      // exhaustive de _backtrack avance alors fromTime de 30min en 30min, chaque tentative étant
      // rejetée pour la même raison de quota (indépendante de l'heure), jusqu'à ce que fromTime
      // dépasse la fin de la fenêtre de disponibilité de G-shared (19h) — earlySchedule renvoie
      // alors null pour une raison purement GÉOMÉTRIQUE (plus aucun créneau, quota ou pas).
      // Le contrefactuel de _computeExactConflictSet réutilise ce même fromTime (déjà au bord de
      // la fenêtre) : libérer E ne change rien à ce moment précis, il n'y a plus de temps du
      // tout à cet instant, qu'E soit là ou non. Vérifié empiriquement avant d'écrire ce test —
      // ce n'est PAS un bug d'implémentation du plan, c'est une limite structurelle du choix
      // (assumé par le plan) de réutiliser le fromTime du vrai point d'impasse pour la sonde :
      // contrairement à ce qu'annonçait le plan (§1, "corrige gratuitement l'angle mort
      // maxDailyMinutes"), cette correction NE s'applique PAS aux impasses atteintes par la
      // boucle de rejet exhaustive (filtres pause flottante / quota quotidien) — seulement aux
      // impasses directes (earlySchedule → null dès le premier essai, sans marche exhaustive).
      // À rapporter comme limitation connue plutôt que de forcer un test qui ne refléterait pas
      // la réalité du mécanisme.
      const scenario: RawScheduleData = {
        week: 30,
        resources: [
          { resourceType: 'teacher', resources: [{ id: 'R-E' }, { id: 'R-U' }] },
          { resourceType: 'group', resources: [{ id: 'G-shared', maxDailyMinutes: 90 }] },
          { resourceType: 'room', resources: [] },
        ],
        courses: [
          {
            week: 30, semester: 1, level: 0, code: 'E1', type: 'TD', name: 'E',
            teacher: ['R-E'], groups: ['G-shared'], rooms: [], duration: 90,
            enforced: { startTime: 480, teacher: ['R-E'], groups: ['G-shared'], rooms: [] }, // lundi 8h-9h30
          },
          {
            week: 30, semester: 1, level: 0, code: 'U3', type: 'TD', name: 'U',
            teacher: ['R-U'], groups: ['G-shared'], rooms: [], duration: 30,
          },
        ],
        constraints: {
          'R-E': [{ days: 'lundi', from: '08:00', to: '19:00' }],
          'R-U': [{ days: 'lundi', from: '08:00', to: '19:00' }],
          'G-shared': [{ days: 'lundi', from: '08:00', to: '19:00' }],
        },
      };

      Loader.loadFromRawData(scenario);
      const sOff = new InspectableScheduler();
      sOff.initSolver();
      sOff.solve();
      const uOff = findUnit(sOff.getUnits(), 'U3');
      expect(sOff.getTaskFailureCounts().get(uOff.id)).toBe(1); // self-blame (E déjà "terminée" avant ce fromTime tardif)

      Loader.loadFromRawData(scenario);
      const sOn = new InspectableScheduler();
      sOn.configure({ conflictSetExact: true });
      sOn.initSolver();
      sOn.solve();
      const units = sOn.getUnits();
      const eOn = findUnit(units, 'E1');
      const uOn = findUnit(units, 'U3');
      const countsOn = sOn.getTaskFailureCounts();

      expect(countsOn.get(eOn.id)).toBeUndefined(); // E toujours hors de portée du contrefactuel
      expect(countsOn.get(uOn.id)).toBe(1); // même repli self-blame que flag off
    },
  );

  it('round-trip TaskGroup : libérer/restaurer un groupe déjà placé pendant le blâme d\'une autre unité ne casse rien et ne change pas le résultat final', () => {
    // Groupe séquentiel GRP1 (2 CM de 60min, code 'X') occupant EXACTEMENT G-Common
    // (lundi 8h-10h). V (TD, même code+groupe → dépendance auto-détectée sur le groupe)
    // démarre donc à fromTime=600 (fin du groupe) : G-Common n'a plus aucune disponibilité
    // à partir de 10h → impasse immédiate (pas de marche exhaustive). Le groupe partage
    // G-Common avec V : son entrée (déjà booked) doit être libérée puis restaurée pendant
    // le calcul du blâme exact de V — exerce précisément le correctif de symétrie
    // TaskGroupUnit.unBook (voir commentaire dans taskGroupUnit.ts). Vérifié empiriquement :
    // le groupe lui-même retente aussi (et échoue, G-Common ne peut contenir que 120min) —
    // les DEUX unités sont donc blâmées (self-blame chacune) dans les deux modes.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R-Grp' }, { id: 'R-V' }] },
        { resourceType: 'group', resources: [{ id: 'G-Common' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        {
          week: 30, semester: 1, level: 0, code: 'X', type: 'CM', name: 'CM-part1',
          teacher: ['R-Grp'], groups: ['G-Common'], rooms: [], duration: 60, taskGroupId: 'GRP1',
        },
        {
          week: 30, semester: 1, level: 0, code: 'X', type: 'CM', name: 'CM-part2',
          teacher: ['R-Grp'], groups: ['G-Common'], rooms: [], duration: 60, taskGroupId: 'GRP1',
        },
        {
          week: 30, semester: 1, level: 0, code: 'X', type: 'TD', name: 'V-dependant',
          teacher: ['R-V'], groups: ['G-Common'], rooms: [], duration: 30,
        },
      ],
      constraints: {
        'R-Grp': [{ days: 'lundi', from: '08:00', to: '10:00' }],
        'R-V': [{ days: 'lundi', from: '08:00', to: '19:00' }],
        'G-Common': [{ days: 'lundi', from: '08:00', to: '10:00' }],
      },
      groups: [{ id: 'GRP1', type: 'sequential' }],
    };

    Loader.loadFromRawData(scenario);
    const sOff = new Scheduler();
    sOff.initSolver();
    const resOff = sOff.solve();
    const countsOff = [...sOff.getTaskFailureCounts().entries()];

    Loader.loadFromRawData(scenario);
    const sOn = new Scheduler();
    sOn.configure({ conflictSetExact: true });
    sOn.initSolver();
    // Ne doit pas lever d'exception (round-trip unBook/book du groupe pendant le blâme de V).
    const resOn = sOn.solve();
    const countsOn = [...sOn.getTaskFailureCounts().entries()];

    expect(resOn.length).toBe(resOff.length); // 0 des deux côtés (instance infaisable)
    expect(countsOn.length).toBe(countsOff.length);
    expect(new Map(countsOn).size).toBeGreaterThan(0); // le blâme a bien tourné (groupe ET V)
  });

  it('jeu de données embarqué (80 tâches) : 80/80 placées avec le flag actif, comme sans', () => {
    Loader.reload();
    const s = new Scheduler();
    s.configure({ conflictSetExact: true });
    s.initSolver();
    const results = s.solveWithElimination();
    expect(results[0].isComplete).toBe(true);
    expect(results[0].solutions).toHaveLength(80);
    expect(results[0].neutralizedUnits ?? []).toHaveLength(0);
  });
});
