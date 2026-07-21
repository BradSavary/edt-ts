import { describe, it, expect } from 'vitest';
import type { CourseTaskDataWithId } from '../lib/courseId';
import type { WeekSavesMap, PreparedWeekSnapshot } from '../store/slices/weekSavesSlice';
import { getManualCoursesForWeek, getCoursesForWeek, pruneWeekSavesOfCourseIds } from '../lib/weekCourses';

function makeCourse(overrides: Partial<CourseTaskDataWithId> = {}): CourseTaskDataWithId {
  return {
    id: 'c1',
    source: 'csv',
    week: 44,
    semester: 1,
    level: 0,
    code: 'R101',
    name: 'Algorithmique',
    type: 'TD',
    duration: 60,
    teacher: [],
    groups: [],
    rooms: [],
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PreparedWeekSnapshot> = {}): PreparedWeekSnapshot {
  return {
    weekNumber: 44,
    schoolYear: '2026-2027',
    savedAt: 1000,
    taskGroups: [],
    manualBlockedZones: [],
    preNeutralizedKeys: [],
    manualEnforcedMap: {},
    manualCourses: [],
    ...overrides,
  };
}

describe('getManualCoursesForWeek', () => {
  it('retourne [] si aucune entrée pour la semaine', () => {
    expect(getManualCoursesForWeek({}, 44)).toEqual([]);
  });

  it('retourne manualCourses si présent (nouveau format)', () => {
    const manual = makeCourse({ id: 'm1', source: 'manual' });
    const weekSaves: WeekSavesMap = { '44': makeSnapshot({ manualCourses: [manual] }) };
    expect(getManualCoursesForWeek(weekSaves, 44)).toEqual([manual]);
  });

  it('fallback sur weeklyCourses.filter(source === manual) si manualCourses absent (ancien format)', () => {
    const csv = makeCourse({ id: 'csv1', source: 'csv' });
    const manual = makeCourse({ id: 'm1', source: 'manual' });
    const legacySnapshot = {
      ...makeSnapshot(),
      manualCourses: undefined as never,
      weeklyCourses: [csv, manual],
    } as unknown as PreparedWeekSnapshot;
    const weekSaves: WeekSavesMap = { '44': legacySnapshot };
    expect(getManualCoursesForWeek(weekSaves, 44)).toEqual([manual]);
  });
});

describe('getCoursesForWeek', () => {
  it('CSV filtré (ordre d\'origine) suivi des manuels (ordre de création)', () => {
    const csv1 = makeCourse({ id: 'csv1', source: 'csv', week: 44, code: 'CSV1' });
    const csv2 = makeCourse({ id: 'csv2', source: 'csv', week: 44, code: 'CSV2' });
    const otherWeekCsv = makeCourse({ id: 'csv3', source: 'csv', week: 10, code: 'CSV3' });
    const manual1 = makeCourse({ id: 'm1', source: 'manual', week: 44, code: 'M1' });
    const manual2 = makeCourse({ id: 'm2', source: 'manual', week: 44, code: 'M2' });

    const allCourses = [csv1, csv2, otherWeekCsv];
    const weekSaves: WeekSavesMap = { '44': makeSnapshot({ manualCourses: [manual1, manual2] }) };

    const result = getCoursesForWeek(allCourses, weekSaves, 44);
    expect(result.map((c) => c.code)).toEqual(['CSV1', 'CSV2', 'M1', 'M2']);
  });

  it('ne retourne que les cours CSV si aucun cours manuel pour la semaine', () => {
    const csv1 = makeCourse({ id: 'csv1', source: 'csv', week: 44 });
    expect(getCoursesForWeek([csv1], {}, 44)).toEqual([csv1]);
  });
});

describe('pruneWeekSavesOfCourseIds', () => {
  it('sans suppression, retourne la même référence weekSaves', () => {
    const weekSaves: WeekSavesMap = { '44': makeSnapshot() };
    const result = pruneWeekSavesOfCourseIds(weekSaves, new Map());
    expect(result).toBe(weekSaves);
  });

  it('une semaine sans suppression garde sa référence de snapshot strictement inchangée', () => {
    const untouched = makeSnapshot({ weekNumber: 10 });
    const weekSaves: WeekSavesMap = { '10': untouched, '44': makeSnapshot() };
    const result = pruneWeekSavesOfCourseIds(weekSaves, new Map([[44, new Set(['c1'])]]));
    expect(result['10']).toBe(untouched);
  });

  it('filtre courseKeys des taskGroups, garde le groupe si >= 2 membres restants', () => {
    const weekSaves: WeekSavesMap = {
      '44': makeSnapshot({
        taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['c1', 'c2', 'c3'] }],
      }),
    };
    const result = pruneWeekSavesOfCourseIds(weekSaves, new Map([[44, new Set(['c2'])]]));
    expect(result['44'].taskGroups).toEqual([{ id: 'g1', type: 'parallel', courseKeys: ['c1', 'c3'] }]);
  });

  it('retire entièrement un groupe tombé à moins de 2 membres', () => {
    const weekSaves: WeekSavesMap = {
      '44': makeSnapshot({
        taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['c1', 'c2'] }],
      }),
    };
    const result = pruneWeekSavesOfCourseIds(weekSaves, new Map([[44, new Set(['c2'])]]));
    expect(result['44'].taskGroups).toEqual([]);
  });

  it('filtre preNeutralizedKeys et manualEnforcedMap', () => {
    const weekSaves: WeekSavesMap = {
      '44': makeSnapshot({
        preNeutralizedKeys: ['c1', 'c2'],
        manualEnforcedMap: {
          c1: { startTime: 0, teacher: [], groups: [], rooms: [] },
          c2: { startTime: 60, teacher: [], groups: [], rooms: [] },
        },
      }),
    };
    const result = pruneWeekSavesOfCourseIds(weekSaves, new Map([[44, new Set(['c2'])]]));
    expect(result['44'].preNeutralizedKeys).toEqual(['c1']);
    expect(Object.keys(result['44'].manualEnforcedMap)).toEqual(['c1']);
  });

  it('ne touche jamais manualCourses', () => {
    const manual = makeCourse({ id: 'm1', source: 'manual' });
    const weekSaves: WeekSavesMap = {
      '44': makeSnapshot({ manualCourses: [manual], preNeutralizedKeys: ['c1'] }),
    };
    const result = pruneWeekSavesOfCourseIds(weekSaves, new Map([[44, new Set(['c1'])]]));
    expect(result['44'].manualCourses).toBe(weekSaves['44'].manualCourses);
  });

  it('élague les placements, non-placés et lastRun persistés des cours supprimés', () => {
    // Sans ça, un réimport CSV laisse des fantômes sur le disque indéfiniment : l'élagage
    // défensif de `setSelectedWeek` les masque à l'affichage, il ne les retire pas.
    const placement = (taskId: string) => ({
      placementId: taskId,
      taskId,
      startTime: 480,
      resources: { teachers: [], groups: [], rooms: [] },
      origin: 'auto' as const,
    });
    const saves: WeekSavesMap = {
      '44': makeSnapshot({
        placements: [placement('c1'), placement('c2')],
        unplaced: [{ taskId: 'c1', origin: 'engine' }, { taskId: 'c2', origin: 'user-post' }],
        lastRun: {
          placements: [placement('c1'), placement('c2')],
          unplaced: [{ taskId: 'c1', origin: 'engine' }],
        },
      }),
    };

    const next = pruneWeekSavesOfCourseIds(saves, new Map([[44, new Set(['c1'])]]));

    expect(next['44'].placements!.map((p) => p.taskId)).toEqual(['c2']);
    expect(next['44'].unplaced!.map((u) => u.taskId)).toEqual(['c2']);
    expect(next['44'].lastRun!.placements.map((p) => p.taskId)).toEqual(['c2']);
    expect(next['44'].lastRun!.unplaced).toEqual([]);
  });

  it('laisse les nouveaux champs absents absents (snapshot ancien format)', () => {
    const saves: WeekSavesMap = { '44': makeSnapshot({ preNeutralizedKeys: ['c1'] }) };

    const next = pruneWeekSavesOfCourseIds(saves, new Map([[44, new Set(['c1'])]]));

    expect(next['44'].placements).toBeUndefined();
    expect(next['44'].unplaced).toBeUndefined();
    expect(next['44'].lastRun).toBeUndefined();
  });

  it("no-op si la semaine listée n'a pas de snapshot", () => {
    const weekSaves: WeekSavesMap = { '44': makeSnapshot() };
    const result = pruneWeekSavesOfCourseIds(weekSaves, new Map([[99, new Set(['x'])]]));
    expect(result['44']).toBe(weekSaves['44']);
    expect(result['99']).toBeUndefined();
  });
});
