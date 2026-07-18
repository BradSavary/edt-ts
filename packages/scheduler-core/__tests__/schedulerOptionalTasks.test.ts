import { describe, it, expect } from 'vitest';
import type { RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';
import { Scheduler } from '../src/scheduler.js';
import { OptionalTasksScheduler, createScheduler } from '../src/optionalTasksScheduler.js';
import type { ISchedulingUnit } from '../src/schedulingUnit.js';

/** Expose l'état interne nécessaire pour observer le B&B dans les tests. */
class InspectableOptionalTasksScheduler extends OptionalTasksScheduler {
  public getUnits(): ISchedulingUnit[] { return this._units; }
  public getIterations(): number { return this._iterations; }
  public isProvenOptimal(): boolean { return this.provenOptimal; } // getter public depuis P3
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
    // Coût de la cascade (2 tâches) déjà atteint dès le 1er round du gourmand (P1.5, warm
    // start) : le B&B (borne=2) ne peut rien trouver de STRICTEMENT meilleur — impossible ici,
    // le CM est structurellement inplaçable — donc le résultat final reste celui de la passe
    // gourmande, avec ses raisons uniformisées (`_genericizeReasons`, révision post-usage §R —
    // les explications MUS ont été retirées, jugées pas assez utiles par Frédéric) : le CM reçoit
    // la raison générique de la classe ; le TD, dont la dépendance (le CM) est elle-même sautée,
    // reçoit la formule de cascade (même texte que `_recordIncumbent` pour un incumbent B&B).
    expect(cm.reason).toBe('Ne peut pas tenir sous les contraintes actuelles — relâchement nécessaire pour atteindre 100%.');
    expect(td.reason).toContain('Sautée par cascade');
    expect(td.reason).toContain(cm.unit.id);

    // Coût de la cascade = 2 : la borne task-aware du B&B (min(1+1,2)=2) interdirait ce saut en
    // isolation, mais le gourmand (maxEliminations:1 = 1 ROUND, pas 1 tâche) trouve et cascade
    // CM+TD en un seul round — même raisonnement que le test "coût des groupes" ci-dessus, warm
    // start oblige : le résultat gourmand est rendu tel quel plutôt que rejeté.
    Loader.loadFromRawData(scenario);
    const s1 = new OptionalTasksScheduler();
    s1.configure({ maxEliminations: 1 });
    const res1 = s1.solveWithElimination();
    expect(res1).toHaveLength(1);
    expect(res1[0].neutralizedUnits ?? []).toHaveLength(2); // CM + TD, hérités de la passe gourmande
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

    // maxEliminations:1 — le coût RÉEL du groupe (2 tâches) dépasse la borne task-aware du B&B
    // (min(1+1,2)=2, donc "strictement mieux que 2" = impossible), mais le moteur gourmand,
    // qui compte en ROUNDS pas en tâches (sémantique différente, assumée depuis P1 — voir
    // docstring de la classe), trouve ET élimine le groupe entier en 1 round. Avec le warm
    // start (P1.5), "jamais pire que le gourmand" prime : ce résultat gourmand est rendu tel
    // quel plutôt que rejeté au nom du décompte plus strict du B&B.
    Loader.loadFromRawData(scenario);
    const s1 = new OptionalTasksScheduler();
    s1.configure({ maxEliminations: 1 });
    const res1 = s1.solveWithElimination();
    expect(res1).toHaveLength(1);
    expect(res1[0].neutralizedUnits ?? []).toHaveLength(1); // le groupe entier, hérité de la passe gourmande

    Loader.loadFromRawData(scenario);
    const s2 = new OptionalTasksScheduler();
    s2.configure({ maxEliminations: 2 });
    const res2 = s2.solveWithElimination();
    expect(res2).toHaveLength(1);
    expect(res2[0].neutralizedUnits ?? []).toHaveLength(1); // 1 UNITÉ (le groupe), mais coût 2 en tâches
  });

  it('anytime sous budget minuscule : incumbent optimal, prouvé par la borne racine (P2-preuve) malgré le budget B&B minuscule', () => {
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
    // atteint déjà la solution optimale 3/1 dans ce scénario). C'est le scénario pigeonhole
    // DUBOIS de référence (docs/PlanOptionalTasksP2Preuve.md §0) : la borne racine le prouve
    // AVANT toute itération B&B (certificat mono-ressource sur DUBOIS, lb=1), donc
    // `provenOptimal` est désormais true ici quel que soit le budget B&B — ce test ne
    // démontre plus « budget minuscule ⟹ non prouvé » (obsolète depuis P2-preuve) mais la
    // non-régression du résultat gourmand sous budget minuscule.
    Loader.loadFromRawData(scenario);
    const s = new InspectableOptionalTasksScheduler();
    s.configure({ maxIterations: 6, timeoutSeconds: 60 });
    const res = s.solveWithElimination();

    expect(res).toHaveLength(1);
    expect(res[0].solutions.length).toBeGreaterThan(0);
    expect(s.isProvenOptimal()).toBe(true);
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

  it('élagage prouvé (P1.5, docs/PlanOptionalTasksP15.md §4.1) : budget modeste suffit à prouver l\'optimum', () => {
    // 1 unité structurellement inplaçable (fenêtre 20min < 60min requis) + 5 unités "libres" à
    // fenêtres larges (beaucoup d'alternatives de placement) — combinatoire suffisante pour
    // révéler, sans l'élagage à l'entrée de nœud, l'énumération exhaustive de feuilles à coût
    // égal (signature P1 : 4542 feuilles de coût 4 sur S37 réelle, jamais de preuve même à
    // 20000 itérations — voir STATUT docs/PlanOptionalTasksP1.md). Avec l'élagage (P1.5), le
    // warm start amorce déjà le bon coût (1) et la coupe à l'entrée de nœud prouve l'optimum
    // en une seule visite de nœud (calibré empiriquement : provenOptimal dès budget=100).
    const freeCourses = Array.from({ length: 5 }, (_, i) => ({
      week: 30, semester: 1, level: 0, code: `F${i}`, type: 'TD', name: `F${i}`,
      teacher: [`TF${i}`], groups: [`GF${i}`], rooms: [], duration: 60,
    }));
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'TU' }, ...freeCourses.map(c => ({ id: c.teacher[0] }))] },
        { resourceType: 'group', resources: [{ id: 'GU' }, ...freeCourses.map(c => ({ id: c.groups[0] }))] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'U', type: 'TD', name: 'U', teacher: ['TU'], groups: ['GU'], rooms: [], duration: 60 },
        ...freeCourses,
      ],
      constraints: {
        TU: [{ days: 'lundi', from: '08:00', to: '08:20' }], // 20min, trop court pour 60min : inplaçable
        GU: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        ...Object.fromEntries(freeCourses.map(c => [c.teacher[0], [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }]])),
        ...Object.fromEntries(freeCourses.map(c => [c.groups[0], [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }]])),
      },
    };

    Loader.loadFromRawData(scenario);
    const s = new InspectableOptionalTasksScheduler();
    s.configure({ maxEliminations: 6, timeoutSeconds: 60, maxIterations: 500 });
    const res = s.solveWithElimination();

    expect(res).toHaveLength(1);
    expect(res[0].solutions).toHaveLength(5);
    expect(res[0].neutralizedUnits ?? []).toHaveLength(1);
    expect(s.isProvenOptimal()).toBe(true);
  });

  it('warm start = jamais pire (P1.5 §4.2) : à budget B&B minuscule, jamais moins bon que le gourmand au même budget', () => {
    // Occupant "gourmand" U0 (240min) saturant EXACTEMENT la fenêtre du prof R (240min) +
    // 8 victimes (30min chacune, même prof R) dont la somme (240min) sature elle aussi la
    // fenêtre — best-case = sauter U0 seul (coût 1), pire cas = enchaîner les victimes en
    // sautant chacune (coût 8) si U0 est placé en premier sans être remis en cause.
    // maxIterations est PARTAGÉ entre la passe gourmande et la passe B&B (même _config) : au
    // même budget minuscule, la comparaison valide n'est PAS contre un gourmand à budget
    // illimité (qui trouverait 1 sautée) mais contre CE gourmand-là, au MÊME budget (qui peut
    // lui-même être tronqué et rendre un résultat dégradé) — le warm start garantit alors
    // seulement de ne jamais faire PIRE que cette référence à budget égal, pas mieux que
    // l'idéal. Vérifié empiriquement : budget=5 → gourmand seul ET warm start rendent tous
    // deux exactement 5 sautées (voir STATUT du chantier, session P1.5 §"fausse alerte").
    const nVictims = 8;
    const victims = Array.from({ length: nVictims }, (_, i) => ({
      week: 30, semester: 1, level: 0, code: `V${i}`, type: 'TD', name: `V${i}`,
      teacher: ['R'], groups: [`GV${i}`], rooms: [], duration: 30,
    }));
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R' }] },
        { resourceType: 'group', resources: [{ id: 'GU0' }, ...victims.map((_, i) => ({ id: `GV${i}` }))] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'U0', type: 'TD', name: 'U0', teacher: ['R'], groups: ['GU0'], rooms: [], duration: 240 },
        ...victims,
      ],
      constraints: {
        R: [{ days: 'lundi', from: '08:00', to: '12:00' }], // 240min, exactement la durée de U0
        GU0: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        ...Object.fromEntries(victims.map((_, i) => [`GV${i}`, [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }]])),
      },
    };
    const tinyBudget = 5;

    Loader.loadFromRawData(scenario);
    const sOpt = new OptionalTasksScheduler();
    sOpt.configure({ maxEliminations: 6, timeoutSeconds: 60, maxIterations: tinyBudget });
    const resOpt = sOpt.solveWithElimination();

    Loader.loadFromRawData(scenario);
    const sGreedy = new Scheduler();
    sGreedy.configure({ maxEliminations: 6, timeoutSeconds: 60, maxIterations: tinyBudget });
    const resGreedy = sGreedy.solveWithElimination();

    const nSkippedOpt = (resOpt[0]?.neutralizedUnits ?? []).length;
    const nSkippedGreedy = (resGreedy[0]?.neutralizedUnits ?? []).length;
    expect(nSkippedOpt).toBeLessThanOrEqual(nSkippedGreedy);
    expect(nSkippedOpt).toBe(5); // égal au gourmand au même budget (calibré empiriquement)
  });

  it('court-circuit gourmand-complet (P1.5 §4.3) : instance faisable → pas de passe B&B', () => {
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

    Loader.loadFromRawData(scenario);
    const sGreedy = new Scheduler();
    const resGreedy = sGreedy.solveWithElimination();

    expect(resOpt).toHaveLength(1);
    expect(resOpt[0].isComplete).toBe(true);
    expect(resOpt[0].neutralizedUnits ?? []).toHaveLength(0);
    expect(sOpt.isProvenOptimal()).toBe(true);
    // White-box : aucune passe B&B n'a tourné — les itérations sont EXACTEMENT celles de la
    // seule passe gourmande (pas de _resetBacktrackState() supplémentaire dans le court-circuit).
    expect(sOpt.getIterations()).toBe((sGreedy as unknown as { _iterations: number })._iterations);
  });
});

describe('createScheduler — fabrique (docs/PlanOptionalTasksP3.md §2)', () => {
  it('sans config : Scheduler (comportement historique)', () => {
    const s = createScheduler();
    expect(s).toBeInstanceOf(Scheduler);
    expect(s).not.toBeInstanceOf(OptionalTasksScheduler);
  });

  it("searchStrategy: 'elimination' : Scheduler", () => {
    const s = createScheduler({ searchStrategy: 'elimination' });
    expect(s).toBeInstanceOf(Scheduler);
    expect(s).not.toBeInstanceOf(OptionalTasksScheduler);
  });

  it("searchStrategy: 'maxPlacement' : OptionalTasksScheduler", () => {
    const s = createScheduler({ searchStrategy: 'maxPlacement' });
    expect(s).toBeInstanceOf(OptionalTasksScheduler);
  });
});

describe('OptionalTasksScheduler — soundness de provenOptimal (docs/PlanOptionalTasksP3.md §0)', () => {
  it('greedyCost > maxEliminations+1 : résultat gourmand rendu (jamais pire), optimum prouvé par la borne racine (P2-preuve)', () => {
    // Groupe séquentiel de 3 membres, structurellement inplaçable (fenêtre 30min < 60min pour
    // CHAQUE membre pris individuellement — RG ne peut jamais tenir aucun des 3). maxEliminations:1
    // → borne d'attaque B&B = 2, strictement sous le coût réel du saut (3 tâches, le groupe
    // entier) : l'arbre B&B, à lui seul, ne prouve donc que « rien à coût ≤ 2 », pas l'optimalité
    // du résultat gourmand rendu (garde historique §0, docs/PlanOptionalTasksP3.md — avant ce
    // correctif, `!_budgetExceeded` seul aurait à tort revendiqué `provenOptimal === true` ici).
    // Depuis P2-preuve, la borne racine est INDÉPENDANTE de ce cap : certificat mono-ressource sur
    // RG (chaque membre a un domaine réel de 30min < 60min requis, donc MaxPack=0, lb=3) prouve
    // directement `finalCost(3) <= lb(3)` — la garde §0 seule ne suffisait pas, la LB si
    // (exactement le cas visé par docs/PlanOptionalTasksP2Preuve.md §2 : « la LB peut mettre
    // _provenOptimal = true là où la garde seule dirait false »).
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
        { week: 30, semester: 1, level: 0, code: 'SEQ', type: 'TD', name: 'part3', teacher: ['RG'], groups: ['G-Seq'], rooms: [], duration: 60, taskGroupId: 'GRP1' },
      ],
      constraints: {
        RG: [{ days: 'lundi', from: '08:00', to: '08:30' }], // 30min, insuffisant pour les 180min du groupe
        'G-Seq': [{ days: 'lundi', from: '08:00', to: '19:00' }],
      },
      groups: [{ id: 'GRP1', type: 'sequential' }],
    };

    Loader.loadFromRawData(scenario);
    const s = new OptionalTasksScheduler();
    s.configure({ maxEliminations: 1 });
    const res = s.solveWithElimination();

    expect(res).toHaveLength(1);
    expect(res[0].solutions).toHaveLength(0);
    expect(res[0].neutralizedUnits ?? []).toHaveLength(1); // le groupe entier, hérité de la passe gourmande
    expect(s.provenOptimal).toBe(true);
  });

  it('greedyCost <= maxEliminations+1 : preuve saine, provenOptimal reste true (non-régression)', () => {
    // Même famille de scénario que « coût des groupes » (P1.5) mais avec maxEliminations:2 :
    // coût du groupe (2 tâches) = borne (2) exactement — la preuve couvre tout l'intervalle,
    // provenOptimal doit rester true (le correctif §0 ne doit pas casser ce cas déjà validé).
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
    const s = new OptionalTasksScheduler();
    s.configure({ maxEliminations: 2 });
    const res = s.solveWithElimination();

    expect(res).toHaveLength(1);
    expect(res[0].neutralizedUnits ?? []).toHaveLength(1);
    expect(s.provenOptimal).toBe(true);
  });
});

describe('OptionalTasksScheduler — raisons génériques uniformes (révision post-usage, docs/PlanOptionalTasksP2Explication.md §R)', () => {
  it('chemin hérité : toutes les raisons non-cascade sont le texte générique exact, jamais du texte gourmand', () => {
    // Occupant (60min) + victime (30min) sur une fenêtre de 60min pile : le gourmand place
    // l'une, saute l'autre. Le B&B n'améliore pas (résultat hérité) — la raison doit être le
    // texte générique EXACT, jamais "Unité la plus bloquante" (texte gourmand brut) ni du MUS
    // ("créneaux nécessaires occupés par", retiré en révision post-usage).
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'R' }] },
        { resourceType: 'group', resources: [{ id: 'G-OCC' }, { id: 'G-VIC' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'OCC', type: 'TD', name: 'occupant', teacher: ['R'], groups: ['G-OCC'], rooms: [], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'VIC', type: 'TD', name: 'victime', teacher: ['R'], groups: ['G-VIC'], rooms: [], duration: 30 },
      ],
      constraints: {
        R: [{ days: 'lundi', from: '08:00', to: '09:00' }], // 60min pile
        'G-OCC': [{ days: 'lundi', from: '08:00', to: '19:00' }],
        'G-VIC': [{ days: 'lundi', from: '08:00', to: '19:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const s = new OptionalTasksScheduler();
    s.configure({ maxEliminations: 6 });
    const res = s.solveWithElimination();

    expect(res).toHaveLength(1);
    const skipped = res[0].neutralizedUnits ?? [];
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe('Ne peut pas tenir sous les contraintes actuelles — relâchement nécessaire pour atteindre 100%.');
    expect(skipped[0].reason).not.toContain('Unité la plus bloquante');
    expect(skipped[0].reason).not.toContain('créneaux nécessaires occupés par');
  });
});

describe('OptionalTasksScheduler — branchement combo (flag comboBranching, docs/PlanComboBranchementBB.md)', () => {
  it("LE test de complétude — affectation croisée : flag off 1/2 (relatif), flag on 2/2 (prouvé)", () => {
    // T1 a 2 profs alternatifs {A, B} et une fenêtre (via son groupe G1) EXACTEMENT de sa
    // durée (08:00-08:30, 30min) — doit démarrer pile à 08:00, sans autre option temporelle.
    // A et B sont tous deux libres à 08:00 : tie-break naturel (earlySchedule/earlyScheduleForCombo
    // à égalité, index croissant) désigne A. T2 n'a AUCUNE alternative, a besoin de A précisément,
    // et sa fenêtre propre (via G2) est large ouverte — seul l'usage de A par T1 peut le bloquer.
    // Si T1 utilise A (choix du tie-break) : A épuisé, T2 ne tient nulle part → sauté. Le seul 2/2
    // exige T1 via B (l'option jamais essayée par earlySchedule/_backtrack au même instant, cf.
    // plan §1/§3) — structurellement invisible sans branchement combo.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'A' }, { id: 'B' }] },
        { resourceType: 'group', resources: [{ id: 'G1' }, { id: 'G2' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'T1', type: 'TD', name: 'T1', teacher: [['A', 'B']], groups: ['G1'], rooms: [], duration: 30 },
        { week: 30, semester: 1, level: 0, code: 'T2', type: 'TD', name: 'T2', teacher: ['A'], groups: ['G2'], rooms: [], duration: 30 },
      ],
      constraints: {
        A: [{ days: 'lundi', from: '08:00', to: '08:30' }],
        B: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        G1: [{ days: 'lundi', from: '08:00', to: '08:30' }],
        G2: [{ days: 'lundi', from: '08:00', to: '19:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const sOff = new InspectableOptionalTasksScheduler();
    const resOff = sOff.solveWithElimination();

    expect(resOff).toHaveLength(1);
    expect(resOff[0].solutions).toHaveLength(1);
    expect(resOff[0].neutralizedUnits ?? []).toHaveLength(1);
    expect(resOff[0].isComplete).toBe(false);
    expect(sOff.isProvenOptimal()).toBe(true); // preuve relative au modèle (combos non branchés)

    Loader.loadFromRawData(scenario);
    const sOn = new InspectableOptionalTasksScheduler();
    sOn.configure({ comboBranching: true });
    const resOn = sOn.solveWithElimination();

    expect(resOn).toHaveLength(1);
    expect(resOn[0].solutions).toHaveLength(2);
    expect(resOn[0].neutralizedUnits ?? []).toHaveLength(0);
    expect(resOn[0].isComplete).toBe(true);
    expect(sOn.isProvenOptimal()).toBe(true); // preuve quasi absolue avec le flag actif
  });

  it('neutralité mono-combo : instance sans alternatives → itérations et résultat strictement identiques flag off/on', () => {
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
    const sOff = new InspectableOptionalTasksScheduler();
    const resOff = sOff.solveWithElimination();

    Loader.loadFromRawData(scenario);
    const sOn = new InspectableOptionalTasksScheduler();
    sOn.configure({ comboBranching: true });
    const resOn = sOn.solveWithElimination();

    expect(sOn.getIterations()).toBe(sOff.getIterations());
    expect(resOn[0].solutions.map(s => s.start).sort())
      .toEqual(resOff[0].solutions.map(s => s.start).sort());
    expect(resOn[0].neutralizedUnits ?? []).toEqual(resOff[0].neutralizedUnits ?? []);
  });

  it('déterminisme : deux runs flag on donnent des résultats identiques', () => {
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'A' }, { id: 'B' }] },
        { resourceType: 'group', resources: [{ id: 'G1' }, { id: 'G2' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'T1', type: 'TD', name: 'T1', teacher: [['A', 'B']], groups: ['G1'], rooms: [], duration: 30 },
        { week: 30, semester: 1, level: 0, code: 'T2', type: 'TD', name: 'T2', teacher: ['A'], groups: ['G2'], rooms: [], duration: 30 },
      ],
      constraints: {
        A: [{ days: 'lundi', from: '08:00', to: '08:30' }],
        B: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        G1: [{ days: 'lundi', from: '08:00', to: '08:30' }],
        G2: [{ days: 'lundi', from: '08:00', to: '19:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const s1 = new InspectableOptionalTasksScheduler();
    s1.configure({ comboBranching: true });
    const res1 = s1.solveWithElimination();

    Loader.loadFromRawData(scenario);
    const s2 = new InspectableOptionalTasksScheduler();
    s2.configure({ comboBranching: true });
    const res2 = s2.solveWithElimination();

    expect(s2.getIterations()).toBe(s1.getIterations());
    expect(res2[0].solutions.map(s => s.start).sort())
      .toEqual(res1[0].solutions.map(s => s.start).sort());
    expect(res2[0].neutralizedUnits ?? []).toEqual(res1[0].neutralizedUnits ?? []);
  });

  it('pigeonhole DUBOIS (scénario existant, conception §3.2) : flag on garde les mêmes conclusions, mono-combo → aucun coût supplémentaire', () => {
    // DUBOIS n'a aucune alternative (1 seul prof, pas de salle, 1 groupe par cours) : le
    // branchement combo n'a structurellement rien à explorer de plus ici — même conclusion
    // ET mêmes itérations que flag off (cf. test de neutralité mono-combo ci-dessus, sur un
    // scénario existant et déjà couvert par ailleurs plutôt qu'une nouvelle instance).
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
    const sOff = new InspectableOptionalTasksScheduler();
    sOff.configure({ maxSolutions: 1, maxEliminations: 6, timeoutSeconds: 60, maxIterations: 100_000 });
    const resOff = sOff.solveWithElimination();

    Loader.loadFromRawData(scenario);
    const sOn = new InspectableOptionalTasksScheduler();
    sOn.configure({ maxSolutions: 1, maxEliminations: 6, timeoutSeconds: 60, maxIterations: 100_000, comboBranching: true });
    const resOn = sOn.solveWithElimination();

    expect(resOn[0].solutions).toHaveLength(3);
    expect(resOn[0].neutralizedUnits ?? []).toHaveLength(1);
    expect(resOn[0].isComplete).toBe(false);
    expect(sOn.isProvenOptimal()).toBe(true);
    expect(sOn.getIterations()).toBe(sOff.getIterations());
  });
});

describe('OptionalTasksScheduler — borne racine par certificats (P2-preuve, docs/PlanOptionalTasksP2Preuve.md)', () => {
  it('pigeonhole DUBOIS (scénario de référence, conception §3.2) : lb=1, optimum prouvé, B&B court-circuité (0 itération)', () => {
    // Même scénario que le test "pigeonhole (cas de référence DUBOIS)" ci-dessus : 1 prof, 3
    // fenêtres de 120min, 4 tâches de 90min → certificat mono-ressource sur DUBOIS, lb=1.
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

    expect(sOpt.rootBound.lb).toBe(1);
    expect(sOpt.rootBound.certificates).toHaveLength(1);
    expect(sOpt.rootBound.certificates[0].resourceIds).toEqual(['DUBOIS']);
    expect(resOpt[0].solutions).toHaveLength(3);
    expect(resOpt[0].neutralizedUnits ?? []).toHaveLength(1);
    expect(sOpt.isProvenOptimal()).toBe(true);

    // B&B court-circuité : mêmes itérations qu'un gourmand seul (aucun appel à _bb()), comme
    // pour le test « court-circuit gourmand-complet » (P1.5 §4.3), généralisé ici au cas lb>0.
    Loader.loadFromRawData(scenario);
    const sGreedy = new Scheduler();
    sGreedy.configure({ maxSolutions: 1, maxEliminations: 6, timeoutSeconds: 60, maxIterations: 100_000 });
    sGreedy.solveWithElimination();
    expect(sOpt.getIterations()).toBe((sGreedy as unknown as { _iterations: number })._iterations);
  });

  it('cluster de groupes : lb=1 par le cluster {G1+G2}, 0 en mono-ressource (les deux niveaux)', () => {
    // 2 groupes G1/G2, 3 tâches jointes (CM communs, groups: ['G1','G2'] → deux slots
    // obligatoires distincts = A ET B, docs/types.ts §ResourceEntry) + 1 tâche mono par groupe.
    // G1 : lundi 90min (court) + mardi 270min (large). G2 : lundi 270min (large) + mardi 90min
    // (court) — symétrique inversé. Calibré empiriquement (packing exact vérifié à la main ET
    // via script) : le certificat mono sur G1 seul (resp. G2 seul) voit sa capacité RAFFINÉE par
    // l'union des domaines revenir à la pleine capacité brute grâce à la tâche mono correspondante
    // (domaine large, non contraint par l'autre groupe) → lb=0 des deux côtés pris isolément.
    // Mais la journée courte de G1 (lundi, 1 créneau) et celle de G2 (mardi, 1 créneau) forcent
    // chacune au plus 1 tâche jointe (la jointe consomme G1 ET G2 en même temps) : au plus 2 des 3
    // jointes tiennent, quelle que soit l'affectation — seul le cluster voit cette coupure
    // croisée, invisible à un certificat mono isolé.
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'TJ1' }, { id: 'TJ2' }, { id: 'TJ3' }, { id: 'TM1' }, { id: 'TM2' }] },
        { resourceType: 'group', resources: [{ id: 'G1' }, { id: 'G2' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'J1', type: 'CM', name: 'j1', teacher: ['TJ1'], groups: ['G1', 'G2'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'J2', type: 'CM', name: 'j2', teacher: ['TJ2'], groups: ['G1', 'G2'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'J3', type: 'CM', name: 'j3', teacher: ['TJ3'], groups: ['G1', 'G2'], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'M1', type: 'TD', name: 'm1', teacher: ['TM1'], groups: [['G1']], rooms: [], duration: 90 },
        { week: 30, semester: 1, level: 0, code: 'M2', type: 'TD', name: 'm2', teacher: ['TM2'], groups: [['G2']], rooms: [], duration: 90 },
      ],
      constraints: {
        TJ1: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        TJ2: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        TJ3: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        TM1: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        TM2: [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '19:00' }],
        G1: [
          { days: 'lundi', from: '08:00', to: '09:30' }, // 90min — jour court
          { days: 'mardi', from: '08:00', to: '12:30' }, // 270min — jour large
        ],
        G2: [
          { days: 'lundi', from: '08:00', to: '12:30' }, // 270min — jour large
          { days: 'mardi', from: '08:00', to: '09:30' }, // 90min — jour court
        ],
      },
    };

    Loader.loadFromRawData(scenario);
    const sOpt = new InspectableOptionalTasksScheduler();
    sOpt.configure({ maxSolutions: 1, maxEliminations: 6, timeoutSeconds: 30, maxIterations: 200_000 });
    const resOpt = sOpt.solveWithElimination();

    // Niveau cluster : lb=1, seul certificat retenu, porte sur {G1,G2} et les 5 tâches.
    expect(sOpt.rootBound.lb).toBe(1);
    expect(sOpt.rootBound.certificates).toHaveLength(1);
    const cert = sOpt.rootBound.certificates[0];
    expect(new Set(cert.resourceIds)).toEqual(new Set(['G1', 'G2']));
    expect(cert.taskIds).toHaveLength(5);
    expect(cert.lb).toBe(1);

    // Niveau mono : aucun certificat mono-ressource sur G1 ou G2 seul (sinon un 2e certificat
    // serait présent dans la liste ci-dessus, puisque même un mono à lb=0 n'est pas retenu —
    // vérifié directement en s'assurant qu'il n'y a bien qu'UN SEUL certificat au total).
    expect(resOpt[0].solutions).toHaveLength(4);
    expect(resOpt[0].neutralizedUnits ?? []).toHaveLength(1);
    expect(sOpt.isProvenOptimal()).toBe(true);
  });

  it('neutralité : instance faisable (+ 1 tâche enforced) → lb=0, comportement strictement inchangé', () => {
    // Reprend le scénario "court-circuit gourmand-complet" (2 tâches indépendantes) et ajoute
    // une 3e tâche enforced PARTAGEANT G1 avec C1 — exerce l'exclusion des tâches enforced des
    // S_r (§1.1) et la soustraction de leur occupation des fenêtres (§1.2) sans rendre
    // l'instance infaisable (G1 garde largement assez de disponibilité pour C1 après
    // soustraction du créneau enforced).
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [{ id: 'T1' }, { id: 'T2' }, { id: 'TE' }] },
        { resourceType: 'group', resources: [{ id: 'G1' }, { id: 'G2' }] },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        { week: 30, semester: 1, level: 0, code: 'C1', type: 'TD', name: 'C1', teacher: ['T1'], groups: ['G1'], rooms: [], duration: 60 },
        { week: 30, semester: 1, level: 0, code: 'C2', type: 'TD', name: 'C2', teacher: ['T2'], groups: ['G2'], rooms: [], duration: 60 },
        {
          week: 30, semester: 1, level: 0, code: 'E1', type: 'TD', name: 'E1',
          teacher: ['TE'], groups: ['G1'], rooms: [], duration: 60,
          enforced: { startTime: 480, teacher: ['TE'], groups: ['G1'], rooms: [] }, // lundi 08:00
        },
      ],
      constraints: {
        T1: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        T2: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        TE: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        G1: [{ days: 'lundi', from: '08:00', to: '19:00' }],
        G2: [{ days: 'lundi', from: '08:00', to: '19:00' }],
      },
    };

    Loader.loadFromRawData(scenario);
    const sOpt = new InspectableOptionalTasksScheduler();
    const resOpt = sOpt.solveWithElimination();

    Loader.loadFromRawData(scenario);
    const sGreedy = new Scheduler();
    const resGreedy = sGreedy.solveWithElimination();

    expect(sOpt.rootBound.lb).toBe(0);
    expect(sOpt.rootBound.certificates).toHaveLength(0);
    expect(resOpt[0].isComplete).toBe(true);
    expect(resOpt[0].neutralizedUnits ?? []).toHaveLength(0);
    expect(sOpt.isProvenOptimal()).toBe(true);
    // Comportement strictement inchangé : mêmes itérations que le gourmand seul (le module ne
    // modifie ni les placements ni la convergence d'une instance faisable).
    expect(sOpt.getIterations()).toBe((sGreedy as unknown as { _iterations: number })._iterations);
    expect(resOpt[0].solutions.map(s => s.start).sort())
      .toEqual(resGreedy[0].solutions.map(s => s.start).sort());
  });
});
