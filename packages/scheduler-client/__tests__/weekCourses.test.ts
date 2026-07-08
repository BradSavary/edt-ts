import { describe, it, expect } from 'vitest';
import type { CourseTaskDataWithId } from '../lib/courseId';
import type { WeekSavesMap, PreparedWeekSnapshot } from '../store/slices/weekSavesSlice';
import { getManualCoursesForWeek, getCoursesForWeek } from '../lib/weekCourses';

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
