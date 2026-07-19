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
});
