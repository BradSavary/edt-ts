import { describe, it, expect } from 'vitest';
import { AvailabilityManager } from '@edt-ts/scheduler-common';
import type { ConstraintsData, CourseTaskData, EnforcedData, NeutralizedTaskInfoJSON, ResourceGroupData, TaskSolutionJSON } from '@edt-ts/scheduler-common';
import { buildPreparationLoadRows, buildAnalysisLoadRows } from '../lib/resourceLoadAnalysis';

function makeManager(data: ConstraintsData): AvailabilityManager {
  return new AvailabilityManager(data);
}

function course(overrides: Partial<CourseTaskData> & { code: string; duration: number }): CourseTaskData {
  return {
    week: 30, semester: 1, level: 0, type: 'TD', name: overrides.code,
    teacher: [], groups: [], rooms: [],
    ...overrides,
  };
}

describe('buildPreparationLoadRows', () => {
  it('cas nominal : capacité/jour + demande hebdo agrégée sur toute la semaine', () => {
    const am = makeManager({
      Default: [],
      T1: [{ days: 'lundi', from: '08:00', to: '12:00' }], // 240min, lundi seulement
    });
    const c1 = course({ code: 'C1', duration: 60, teacher: ['T1'] });
    const c2 = course({ code: 'C2', duration: 90, teacher: ['T1'] });

    const rows = buildPreparationLoadRows(c1, [c1, c2], new Map(), (c) => c.code, am, 30, []);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.resourceId).toBe('T1');
    expect(row.resourceKind).toBe('teacher');
    expect(row.weeklyCapacity).toBe(240); // uniquement lundi
    expect(row.weeklyLoad).toBe(150); // 60 (C1) + 90 (C2), même ressource
    expect(row.ratio).toBeCloseTo(150 / 240);
    expect(row.days[0].capacityMin).toBe(240); // lundi = day 0
    expect(row.days[1].capacityMin).toBe(0); // mardi : jour vide
  });

  it('ressource sans contrainte propre : repli sur Default', () => {
    const am = makeManager({
      Default: [{ days: 'lundi', from: '08:00', to: '10:00' }], // 120min
    });
    const c1 = course({ code: 'C1', duration: 30, teacher: ['TX'] }); // TX absent des contraintes

    const rows = buildPreparationLoadRows(c1, [c1], new Map(), (c) => c.code, am, 30, []);

    expect(rows[0].weeklyCapacity).toBe(120);
  });

  it('maxDailyMinutes plafonne la capacité quotidienne', () => {
    const am = makeManager({
      Default: [],
      T1: [{ days: 'lundi', from: '08:00', to: '12:00' }], // 240min bruts
    });
    const resources: ResourceGroupData[] = [
      { resourceType: 'teacher', resources: [{ id: 'T1', maxDailyMinutes: 90 }] },
    ];
    const c1 = course({ code: 'C1', duration: 30, teacher: ['T1'] });

    const rows = buildPreparationLoadRows(c1, [c1], new Map(), (c) => c.code, am, 30, resources);

    expect(rows[0].days[0].capacityMin).toBe(90); // plafonné, pas 240
    expect(rows[0].weeklyCapacity).toBe(90);
  });

  it('jour vide : capacité et charge nulles, pas d\'erreur', () => {
    const am = makeManager({ Default: [{ days: 'lundi', from: '08:00', to: '09:00' }] });
    const c1 = course({ code: 'C1', duration: 15, teacher: ['T1'] });

    const rows = buildPreparationLoadRows(c1, [c1], new Map(), (c) => c.code, am, 30, []);

    const vendredi = rows[0].days[4];
    expect(vendredi.capacityMin).toBe(0);
    expect(vendredi.loadMin).toBe(0);
    expect(vendredi.slackMin).toBe(0);
  });

  it('enforced épinglé : sa charge apparaît sur le jour de son startTime', () => {
    const am = makeManager({
      Default: [],
      T1: [{ days: 'lundi,mardi', from: '08:00', to: '12:00' }],
    });
    const c1 = course({ code: 'C1', duration: 60, teacher: ['T1'] });
    const c2 = course({ code: 'C2', duration: 60, teacher: ['T1'] });
    const enforcedMap = new Map<string, EnforcedData>([
      ['C2', { startTime: 24 * 60 + 8 * 60, teacher: ['T1'], groups: [], rooms: [] }], // mardi 08:00
    ]);

    const rows = buildPreparationLoadRows(c1, [c1, c2], enforcedMap, (c) => c.code, am, 30, []);

    expect(rows[0].days[0].loadMin).toBe(0); // lundi : rien d'enforced
    expect(rows[0].days[1].loadMin).toBe(60); // mardi : C2 enforced
    expect(rows[0].weeklyLoad).toBe(120); // demande totale (C1 + C2), pas juste l'enforced
  });

  it('cas LAVEFVE (miniature) : demande proche de la capacité, ratio de tension élevé', () => {
    // 5 jours de 100min de capacité (500 total) pour un groupe requis par 5 cours de 90min
    // (450 total) — ratio ≈ 0.9, tension visible sans qu'aucun jour ne soit individuellement
    // dépassé (reproduit la lecture "volume global" du mode préparation).
    const am = makeManager({
      Default: [],
      'BUT2-G1': [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '09:40' }], // 100min/jour
    });
    const courses = ['lun', 'mar', 'mer', 'jeu', 'ven'].map((d, i) =>
      course({ code: `C${i}`, duration: 90, groups: ['BUT2-G1'] }),
    );

    const rows = buildPreparationLoadRows(courses[0], courses, new Map(), (c) => c.code, am, 30, []);

    expect(rows[0].weeklyCapacity).toBe(500);
    expect(rows[0].weeklyLoad).toBe(450);
    expect(rows[0].ratio).toBeCloseTo(0.9);
  });
});

describe('buildAnalysisLoadRows', () => {
  function neutralizedTask(duration: number, resources: { id: string; type: string }[]): NeutralizedTaskInfoJSON {
    return {
      task: { taskId: 'X', code: 'X', name: 'X', type: 'TD', week: 30, duration, startTime: -1, resources },
      eliminationRound: 0,
      failureCount: 0,
      reason: 'test',
    };
  }

  it('cas nominal : mou par jour et fits calculé sur la durée de la tâche sautée', () => {
    const am = makeManager({
      Default: [],
      T1: [{ days: 'lundi', from: '08:00', to: '12:00' }], // 240min
    });
    const placed: TaskSolutionJSON[] = [
      { taskId: 'P1', code: 'P1', name: 'P1', type: 'TD', week: 30, duration: 180, startTime: 480, resources: [{ id: 'T1', type: 'teacher' }] },
    ];
    const skipped = neutralizedTask(90, [{ id: 'T1', type: 'teacher' }]);

    const rows = buildAnalysisLoadRows(skipped, placed, am, 30, []);

    expect(rows).toHaveLength(1);
    expect(rows[0].days[0].capacityMin).toBe(240);
    expect(rows[0].days[0].loadMin).toBe(180);
    expect(rows[0].days[0].slackMin).toBe(60);
    expect(rows[0].days[0].fits).toBe(false); // 60min de mou < 90min requis
    expect(rows[0].anyDayFits).toBe(false);
  });

  it('mou suffisant sur un autre jour → anyDayFits true', () => {
    const am = makeManager({
      Default: [],
      T1: [{ days: 'lundi,mardi', from: '08:00', to: '12:00' }], // 240min/jour
    });
    const placed: TaskSolutionJSON[] = [
      { taskId: 'P1', code: 'P1', name: 'P1', type: 'TD', week: 30, duration: 60, startTime: 480, resources: [{ id: 'T1', type: 'teacher' }] },
    ];
    const skipped = neutralizedTask(90, [{ id: 'T1', type: 'teacher' }]);

    const rows = buildAnalysisLoadRows(skipped, placed, am, 30, []);

    expect(rows[0].days[0].fits).toBe(true); // lundi : 240-60=180 >= 90
    expect(rows[0].days[1].fits).toBe(true); // mardi : rien placé, 240 >= 90
    expect(rows[0].anyDayFits).toBe(true);
  });

  it('cas LAVEFVE (miniature) : volume hebdo suffisant mais aucun jour avec assez de mou', () => {
    // 5 jours à 100min de capacité, 90min placées chaque jour → 10min de mou/jour (jamais assez
    // pour une tâche de 50min), mais 50min de mou hebdo cumulé (500-450) — exactement le
    // phénomène observé par Frédéric sur S40 (33,5h/34,5h, granularité insuffisante).
    const am = makeManager({
      Default: [],
      'BUT2-G1': [{ days: 'lundi,mardi,mercredi,jeudi,vendredi', from: '08:00', to: '09:40' }], // 100min/jour
    });
    const placed: TaskSolutionJSON[] = [0, 1, 2, 3, 4].map((d) => ({
      taskId: `P${d}`, code: `P${d}`, name: `P${d}`, type: 'TD', week: 30, duration: 90,
      startTime: d * 24 * 60 + 480, resources: [{ id: 'BUT2-G1', type: 'group' }],
    }));
    const skipped = neutralizedTask(50, [{ id: 'BUT2-G1', type: 'group' }]);

    const rows = buildAnalysisLoadRows(skipped, placed, am, 30, []);

    expect(rows[0].weeklyCapacity).toBe(500);
    expect(rows[0].weeklyLoad).toBe(450);
    expect(rows[0].weeklySlack).toBe(50); // suffisant en cumulé...
    expect(rows[0].days.every((d) => d.slackMin < 50)).toBe(true); // ...mais jamais en un seul jour
    expect(rows[0].anyDayFits).toBe(false);
  });
});
