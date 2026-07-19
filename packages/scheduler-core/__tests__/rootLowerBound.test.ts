import { describe, it, expect } from 'vitest';
import { Task, Resource, ResourceType, type CourseTaskData, type RawScheduleData } from '@edt-ts/scheduler-common';
import { computeRootLowerBound } from '../src/rootLowerBound.js';
import { Loader } from '../src/loader.js';

/**
 * Micro-tests du module pur `rootLowerBound.ts` (§3.4 du plan) : assertions directes sur
 * `computeRootLowerBound`, sans passer par le moteur (Scheduler/OptionalTasksScheduler).
 */

const DAY = 24 * 60;

function makeResource(id: string, type: ResourceType, windows: Array<{ day: number; from: number; to: number }>): Resource {
  const r = new Resource(id, type);
  for (const w of windows) r.availability.addAvailability(w.day * DAY + w.from, w.day * DAY + w.to);
  return r;
}

function makeTask(id: string, duration: number, resources: Resource[]): Task {
  const courseData: CourseTaskData = {
    week: 30, semester: 1, level: 0, code: id, type: 'TD', teacher: [], groups: [], name: id, rooms: [], duration,
  };
  return new Task(id, courseData, resources);
}

describe('computeRootLowerBound — micro-tests du module pur (P2-preuve §3.4)', () => {
  it('(a) pause fixe non re-déduite : une ressource GROUP déjà nette de la pause fixe garde sa pleine capacité', () => {
    // G1 dispo lundi 8h-12h30 (270min) + 14h-19h (300min) — la pause 12h30-14h est déjà ABSENTE
    // des disponibilités (comme le ferait Scheduler._applyLunchBreak pour lunchBreak: 'fixed').
    // 6 tâches de 90min (540min de demande) tiennent exactement dans les 570min disponibles —
    // toute re-déduction de la pause (piège de sûreté identifié au plan §1) ferait chuter la
    // capacité sous 540min et produirait à tort lb > 0.
    const g1 = makeResource('G1', ResourceType.GROUP, [
      { day: 0, from: 8 * 60, to: 12 * 60 + 30 },
      { day: 0, from: 14 * 60, to: 19 * 60 },
    ]);
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask(`T${i}`, 90, [g1]));

    const result = computeRootLowerBound(tasks, {
      lunchBreak: { type: 'fixed', from: '12:30', to: '14:00' },
      ignoreDailyLimits: false,
    });

    expect(result.lb).toBe(0);
  });

  it('(b) limite de nœuds basse ⟹ repli sur la borne de comptage, jamais plus forte que la borne exacte', () => {
    // Scénario pigeonhole (1 ressource, 3 fenêtres de 120min, 4 tâches de 90min) : lb exact = 1.
    // Avec une limite de nœuds artificiellement basse, le DFS bascule sur le repli de comptage
    // (qui ignore la contrainte de fenêtre/jour) et ne peut donc que SOUS-estimer lb — jamais le
    // dépasser (principe de sûreté cardinal, docs/PlanOptionalTasksP2Preuve.md §1).
    const r = makeResource('DUBOIS', ResourceType.TEACHER, [
      { day: 0, from: 8 * 60, to: 10 * 60 },
      { day: 1, from: 8 * 60, to: 10 * 60 },
      { day: 2, from: 8 * 60, to: 10 * 60 },
    ]);
    const tasks = Array.from({ length: 4 }, (_, i) => makeTask(`T${i}`, 90, [r]));

    const exact = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(exact.lb).toBe(1);

    const crippled = computeRootLowerBound(tasks, {
      lunchBreak: { type: 'none' }, ignoreDailyLimits: false, monoNodeLimit: 1,
    });
    expect(crippled.lb).toBe(0);
    expect(crippled.lb).toBeLessThanOrEqual(exact.lb);
  });

  it('(c) scénarios 1-2 (pigeonhole DUBOIS, cluster) : lb ≤ optimum connu', () => {
    const dubois: RawScheduleData = {
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
    // Optimum connu (vérifié par le B&B dans schedulerOptionalTasks.test.ts) : 3 placées, 1 sautée.
    Loader.loadFromRawData(dubois);
    const duboisTasks = Loader.tasksManager.getAllUnits() as Task[];
    const duboisResult = computeRootLowerBound(duboisTasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(duboisResult.lb).toBeLessThanOrEqual(1);
    expect(duboisResult.lb).toBe(1);

    const cluster: RawScheduleData = {
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
          { days: 'lundi', from: '08:00', to: '09:30' },
          { days: 'mardi', from: '08:00', to: '12:30' },
        ],
        G2: [
          { days: 'lundi', from: '08:00', to: '12:30' },
          { days: 'mardi', from: '08:00', to: '09:30' },
        ],
      },
    };
    // Optimum connu (vérifié par le B&B dans schedulerOptionalTasks.test.ts) : 4 placées, 1 sautée.
    Loader.loadFromRawData(cluster);
    const clusterTasks = Loader.tasksManager.getAllUnits() as Task[];
    const clusterResult = computeRootLowerBound(clusterTasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(clusterResult.lb).toBeLessThanOrEqual(1);
    expect(clusterResult.lb).toBe(1);
  });

  it('(d) sûreté de la mémoïsation DFS : deux chemins vers le même état résiduel avec des placed différents', () => {
    // Régression (trouvée en relecture post-livraison) : la mémo des DFS de maxPackMono/cluster
    // était clée sur (idx, résidus) SANS `placed` — {60} et {30+30} atteignent le MÊME résidu
    // de fenêtre, le second chemin (meilleur) était élagué à tort. R dispo lundi 60min + mardi
    // 30min ; T60(R seul, lundi seulement) ; Ta30/Tb30(R+R3, R3 dispo lundi seulement) ;
    // Tc30(R+R2, R2 dispo mardi seulement). Optimum réel = 1 saut (sauter T60, placer Ta+Tb
    // lundi et Tc mardi) ⟹ lb ≤ 1. Avant correctif : lb=2 (borne INVALIDE, sens interdit par le
    // principe de sûreté cardinal §1 du plan).
    const r = makeResource('R', ResourceType.TEACHER, [
      { day: 0, from: 8 * 60, to: 9 * 60 },
      { day: 1, from: 8 * 60, to: 8 * 60 + 30 },
    ]);
    const r3 = makeResource('R3', ResourceType.TEACHER, [{ day: 0, from: 8 * 60, to: 9 * 60 }]);
    const r2 = makeResource('R2', ResourceType.TEACHER, [{ day: 1, from: 8 * 60, to: 8 * 60 + 30 }]);

    const tasks = [
      makeTask('T60', 60, [r]),
      makeTask('Ta30', 30, [r, r3]),
      makeTask('Tb30', 30, [r, r3]),
      makeTask('Tc30', 30, [r, r2]),
    ];

    const result = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(result.lb).toBeLessThanOrEqual(1);
    expect(result.lb).toBe(1);
  });

  it('(e) deadline très basse ⟹ repli sûr : lb jamais supérieur à la référence, aucune exception (PlanLbCoutRacine §4.1)', () => {
    // Scénario volontairement gros (2 groupes, 8 CM communs {G1,G2} + 1 TD par groupe, fenêtres
    // de 175min/jour — juste assez pour 1 CM de 90min/jour, pas 2) : mesuré à ~19 360 nœuds dans
    // le DFS cluster à deadline généreuse. Nécessaire pour que le contrôle « tous les 4096
    // nœuds » (§2.2) ait au moins une chance de se déclencher pendant ce test — un scénario plus
    // petit convergerait avant le premier palier de 4096 et ne testerait rien.
    const groups = ['G1', 'G2'];
    const cmTeachers = Array.from({ length: 8 }, (_, i) => `TJ${i + 1}`);
    const tdTeachers = ['TM1', 'TM2'];
    const days = 'lundi,mardi,mercredi,jeudi,vendredi';
    const scenario: RawScheduleData = {
      week: 30,
      resources: [
        { resourceType: 'teacher', resources: [...cmTeachers, ...tdTeachers].map(id => ({ id })) },
        { resourceType: 'group', resources: groups.map(id => ({ id })) },
        { resourceType: 'room', resources: [] },
      ],
      courses: [
        ...cmTeachers.map((t, i) => ({
          week: 30, semester: 1, level: 0, code: `J${i + 1}`, type: 'CM', name: `j${i + 1}`,
          teacher: [t], groups, rooms: [], duration: 90,
        })),
        ...groups.map((g, i) => ({
          week: 30, semester: 1, level: 0, code: `M${i + 1}`, type: 'TD', name: `m${i + 1}`,
          teacher: [tdTeachers[i]], groups: [[g]], rooms: [], duration: 90,
        })),
      ],
      constraints: {
        ...Object.fromEntries([...cmTeachers, ...tdTeachers].map(t => [t, [{ days, from: '08:00', to: '19:00' }]])),
        ...Object.fromEntries(groups.map(g => [g, [{ days, from: '08:00', to: '10:55' }]])), // 175min
      },
    };

    Loader.loadFromRawData(scenario);
    const tasks = Loader.tasksManager.getAllUnits() as Task[];

    const reference = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false, deadlineMs: 30_000 });
    expect(reference.lb).toBeGreaterThan(0); // sanity : un certificat non trivial existe bien

    const crippled = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false, deadlineMs: -1000 });
    expect(crippled.lb).toBeLessThanOrEqual(reference.lb);
  });

  it('(f) warm start neutre sur la borne : lb identique avec/sans skippedTaskIds (réutilise le pigeonhole DUBOIS) (PlanLbCoutRacine §4.2)', () => {
    const dubois: RawScheduleData = {
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
    Loader.loadFromRawData(dubois);
    const duboisTasks = Loader.tasksManager.getAllUnits() as Task[];

    const withoutWarmStart = computeRootLowerBound(duboisTasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(withoutWarmStart.lb).toBe(1);

    // Warm start réaliste : bestInit = 3 (l'optimum connu du pigeonhole DUBOIS — 3 placées, 1
    // sautée, vérifié par le B&B dans schedulerOptionalTasks.test.ts), amorcé en sautant UNE
    // tâche quelconque (les 4 tâches sont structurellement interchangeables).
    const skippedTaskIds = new Set([duboisTasks[0].id]);
    const withWarmStart = computeRootLowerBound(duboisTasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false, skippedTaskIds });
    expect(withWarmStart.lb).toBe(withoutWarmStart.lb);
  });

  const FLOATING_12_14 = { type: 'floating', duration: 90, earliest: '12:00', latest: '14:00' } as const;

  it('(e) pause flottante : une indispo DANS la fenêtre porte une partie de la pause — pas de lb surestimée', () => {
    // Régression de cohérence avec Scheduler._resourceKeepsFloatingBreak depuis sa réécriture
    // (docs/PlanFloatingLunchBreakGap.md) : la pause est un trou contigu LIBRE DE COURS, et une
    // indisponibilité déclarée peut en porter une partie sans coûter de disponibilité.
    //
    // G1 dispo 8:00-13:00 + 13:30-18:00 (570min brutes), indispo 13:00-13:30 DANS la fenêtre.
    // Pause placée en 12:30-14:00 : 30 min portées par l'indispo ⟹ coût réel 60 min, capacité
    // utilisable 510 min. Les 7 tâches (3×90 + 4×60 = 510) tiennent EXACTEMENT — vérifié sur le
    // moteur lui-même : 3×90 en 8:00-12:30 puis 4×60 en 14:00-18:00, isComplete=true.
    // L'ancienne formule retranchait 90 en bloc (dispo ∩ fenêtre = 60+30 = 90 ≥ 90), ramenait la
    // capacité à 480 < 510 et rendait lb=1 sur un optimum réel de 0 : preuve d'optimalité FAUSSE.
    const g1 = makeResource('G1', ResourceType.GROUP, [
      { day: 0, from: 8 * 60, to: 13 * 60 },
      { day: 0, from: 13 * 60 + 30, to: 18 * 60 },
    ]);
    const tasks = [
      ...Array.from({ length: 3 }, (_, i) => makeTask(`A${i}`, 90, [g1])),
      ...Array.from({ length: 4 }, (_, i) => makeTask(`B${i}`, 60, [g1])),
    ];

    const result = computeRootLowerBound(tasks, { lunchBreak: FLOATING_12_14, ignoreDailyLimits: false });

    expect(result.lb).toBe(0);
  });

  it('(f) pause flottante sur dispo CONTINUE : la déduction reste de duration entière', () => {
    // Témoin du test (e) : sans indispo dans la fenêtre, toute position de pause coûte 90 min de
    // disponibilité — le minimum vaut donc bien `duration` et le comportement est inchangé.
    // Capacité 570 - 90 = 480 : 8 tâches de 60 (480min) passent, 9 (540min) ne passent pas.
    const g1 = makeResource('G1', ResourceType.GROUP, [{ day: 0, from: 8 * 60, to: 17 * 60 + 30 }]);

    const exactly480 = computeRootLowerBound(
      Array.from({ length: 8 }, (_, i) => makeTask(`T${i}`, 60, [g1])),
      { lunchBreak: FLOATING_12_14, ignoreDailyLimits: false },
    );
    expect(exactly480.lb).toBe(0);

    const over480 = computeRootLowerBound(
      Array.from({ length: 9 }, (_, i) => makeTask(`T${i}`, 60, [g1])),
      { lunchBreak: FLOATING_12_14, ignoreDailyLimits: false },
    );
    expect(over480.lb).toBe(1);
  });

  // ── §3 du plan LB-Surrogate-Symétrie (2026-07-19) : borne surrogate aux nœuds (§1) + symétrie
  // fenêtres / hachage memo cluster (§2). Ces changements sont des optimisations de recherche
  // pures — lb attendu identique à celui déjà validé par les tests ci-dessus, sur des instances
  // choisies pour que la NOUVELLE borne (ou le NOUVEAU memo) soit celle qui décide, pas juste la
  // cardinalité brute qu'elle remplace.

  it('§1.3 — borne surrogate mono mordante : fenêtres tassées, la cardinalité seule ne prunerait pas', () => {
    // 1 enseignant, fenêtres day0=180min + day1=120min (total 300min). 6 tâches de 60min :
    // 5 tiennent EXACTEMENT (300min), la 6e non (360min > 300) -> lb = 1, connu par le volume.
    const r = makeResource('R', ResourceType.TEACHER, [
      { day: 0, from: 8 * 60, to: 11 * 60 },  // 180min
      { day: 1, from: 8 * 60, to: 10 * 60 },  // 120min
    ]);
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask(`T${i}`, 60, [r]));
    const result = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(result.lb).toBe(1);
  });

  it('§1.3 — fragmentation par fenêtre plus stricte que le volume agrégé (chaque fenêtre ne loge qu\'un seul item)', () => {
    // 4 fenêtres (50/80/100/40 min, jours distincts), 5 tâches de 70min : le volume agrégé (270min)
    // suggérerait jusqu'à 3 placées, mais AUCUNE fenêtre ne loge 2×70min (même la plus grande, 100 :
    // 2×70=140>100) -> seules 2 tâches tiennent (une dans la fenêtre 80, une dans la 100) -> lb = 3.
    // Vérifie que la borne surrogate (un élagage) n'entrave jamais la recherche EXACTE en-dessous
    // de cet optimum réel — elle accélère le DFS, elle ne remplace jamais son résultat.
    const r = makeResource('R', ResourceType.TEACHER, [
      { day: 0, from: 8 * 60, to: 8 * 60 + 50 },       // 50min
      { day: 1, from: 8 * 60, to: 9 * 60 + 20 },       // 80min
      { day: 2, from: 8 * 60, to: 9 * 60 + 40 },       // 100min
      { day: 3, from: 8 * 60, to: 8 * 60 + 40 },       // 40min
    ]);
    const tasks = Array.from({ length: 5 }, (_, i) => makeTask(`T${i}`, 70, [r]));
    const result = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(result.lb).toBe(3);
  });

  it('§1.3 — capacité journalière (maxDailyMinutes) plus stricte que la somme des fenêtres', () => {
    // 1 ressource, 2 fenêtres DISJOINTES le même jour (90+90=180min), mais maxDailyMinutes=100 :
    // la capacité réelle du jour est 100, pas 180. 2 tâches de 90min : une seule tient (90<=100),
    // la seconde ferait 180>100 -> lb = 1. Exerce la branche "capacité du jour" (dayTotal) du
    // min(winTotal,dayTotal) de la borne surrogate, distincte de la branche "fenêtre" ci-dessus.
    const r = makeResource('R', ResourceType.TEACHER, [
      { day: 0, from: 8 * 60, to: 9 * 60 + 30 },
      { day: 0, from: 10 * 60, to: 11 * 60 + 30 },
    ]);
    r.maxDailyMinutes = 100;
    const tasks = Array.from({ length: 2 }, (_, i) => makeTask(`T${i}`, 90, [r]));
    const result = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(result.lb).toBe(1);
  });

  it('§2.1 — symétrie exacte : 3 fenêtres strictement identiques (même jour, longueur, éligibilité), lb connu à la main', () => {
    // 3 fenêtres de 60min sur le même jour, toutes de même classe (day, len, éligibilité
    // identique car un seul type de tâche). 4 tâches de 60min -> pigeonhole exact, lb = 1. Vérifie
    // que §2.1 (n'essayer qu'une fenêtre par classe intacte) ne coupe pas la solution à 3 placées.
    const r = makeResource('R', ResourceType.TEACHER, [
      { day: 0, from: 8 * 60, to: 9 * 60 },
      { day: 0, from: 10 * 60, to: 11 * 60 },
      { day: 0, from: 12 * 60, to: 13 * 60 },
    ]);
    const tasks = Array.from({ length: 4 }, (_, i) => makeTask(`T${i}`, 60, [r]));
    const result = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(result.lb).toBe(1);
  });

  it('§2.1 — les 3 fenêtres symétriques suffisent exactement (3 tâches) : lb = 0, aucune solution perdue', () => {
    const r = makeResource('R', ResourceType.TEACHER, [
      { day: 0, from: 8 * 60, to: 9 * 60 },
      { day: 0, from: 10 * 60, to: 11 * 60 },
      { day: 0, from: 12 * 60, to: 13 * 60 },
    ]);
    const tasks = Array.from({ length: 3 }, (_, i) => makeTask(`T${i}`, 60, [r]));
    const result = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(result.lb).toBe(0);
  });

  it('§1.4/§2.3 — cluster à ≥4 ressources consommées, capacités croisées : lb connu, verrouille la vérification exacte du memo', () => {
    // G1,G2 dispo 8:00-11:00 (180min) le même jour. CM1/CM2 (chacune consomme G1+G2, 90min,
    // enseignants distincts TJ1/TJ2) + TD1(G1 seul,TM1)/TD2(G2 seul,TM2). 6 ressources consommées
    // (TJ1,TJ2,TM1,TM2,G1,G2). Optimum réel = 3 (un seul CM + les deux TD : p.ex. CM1+TD1+TD2 —
    // CM1 consomme 90 de G1 et 90 de G2, laissant 90 dans chaque groupe, exactement repris par
    // TD1/TD2) ; placer les 2 CM ensemble sature G1/G2 (2×90=180) et n'en laisse plus pour aucun
    // TD (2/4 placées seulement, moins bon). lb = 4 - 3 = 1, vérifié par calcul direct — verrou de
    // non-régression sur le hachage Zobrist + Int32Array du DFS cluster.
    const g1 = makeResource('G1', ResourceType.GROUP, [{ day: 0, from: 8 * 60, to: 11 * 60 }]);
    const g2 = makeResource('G2', ResourceType.GROUP, [{ day: 0, from: 8 * 60, to: 11 * 60 }]);
    const tj1 = makeResource('TJ1', ResourceType.TEACHER, [{ day: 0, from: 8 * 60, to: 19 * 60 }]);
    const tj2 = makeResource('TJ2', ResourceType.TEACHER, [{ day: 0, from: 8 * 60, to: 19 * 60 }]);
    const tm1 = makeResource('TM1', ResourceType.TEACHER, [{ day: 0, from: 8 * 60, to: 19 * 60 }]);
    const tm2 = makeResource('TM2', ResourceType.TEACHER, [{ day: 0, from: 8 * 60, to: 19 * 60 }]);
    const tasks = [
      makeTask('CM1', 90, [tj1, g1, g2]),
      makeTask('CM2', 90, [tj2, g1, g2]),
      makeTask('TD1', 90, [tm1, g1]),
      makeTask('TD2', 90, [tm2, g2]),
    ];
    const result = computeRootLowerBound(tasks, { lunchBreak: { type: 'none' }, ignoreDailyLimits: false });
    expect(result.lb).toBe(1);
  });

  it('§2.1 — l\'élagage de symétrie MORD vraiment : lb exacte atteinte sous un budget de nœuds serré', () => {
    // Les tests §2.1 ci-dessus verrouillent la SÛRETÉ (aucune solution coupée), pas l'EFFICACITÉ :
    // un élagage inopérant rend exactement la même `lb`, donc aucune assertion sur `lb` seule ne
    // peut le détecter. C'est ainsi qu'un marquage de symétrie partagé (écrasé par les appels
    // enfants, donc quasi inopérant après le premier) est passé inaperçu.
    //
    // Ce test observe le mécanisme via `monoNodeLimit` : au-delà du budget, `maxPackMono` bascule
    // sur son repli de comptage et `lb` retombe à 0. Mesuré sur cette instance : 1621 nœuds avec
    // le marquage par (profondeur, classe), 4118 avec un marquage partagé. Le budget ci-dessous
    // est entre les deux — le test ne passe QUE si l'élagage de symétrie est effectif.
    //
    // Instance : 8 fenêtres de 130min identiques réparties sur 5 jours (2 par jour sur les 3
    // premiers), 12 tâches de 70min. Chaque fenêtre ne loge qu'une tâche -> 8 placées, lb = 4.
    const wins: Array<{ day: number; from: number; to: number }> = [];
    for (let i = 0; i < 8; i++) {
      const day = i % 5, slot = Math.floor(i / 5);
      wins.push({ day, from: 8 * 60 + slot * 180, to: 8 * 60 + slot * 180 + 130 });
    }
    const r = makeResource('R', ResourceType.TEACHER, wins);
    const tasks = Array.from({ length: 12 }, (_, i) => makeTask(`T${i}`, 70, [r]));

    const opts = { lunchBreak: { type: 'none' } as const, ignoreDailyLimits: false };
    expect(computeRootLowerBound(tasks, opts).lb).toBe(4);                          // référence exacte
    expect(computeRootLowerBound(tasks, { ...opts, monoNodeLimit: 2500 }).lb).toBe(4); // sous budget serré
  });
});
