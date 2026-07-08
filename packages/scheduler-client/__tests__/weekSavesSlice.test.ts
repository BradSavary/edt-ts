import { describe, it, expect, beforeEach } from 'vitest';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { createWeekSavesSlice, type WeekSavesSlice, type PreparedWeekSnapshot } from '../store/slices/weekSavesSlice';

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

function makeCourse(overrides: Partial<CourseTaskData> = {}): CourseTaskData {
  return {
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

describe('weekSavesSlice (format aplati week -> snapshot)', () => {
  let useStore: UseBoundStore<StoreApi<WeekSavesSlice>>;

  beforeEach(() => {
    useStore = create<WeekSavesSlice>(createWeekSavesSlice);
  });

  it('démarre avec weekSaves vide', () => {
    expect(useStore.getState().weekSaves).toEqual({});
  });

  it('saveWeek puis loadWeekSave(week) retrouve le snapshot sans paramètre année', () => {
    const snapshot = makeSnapshot({ weekNumber: 44 });
    useStore.getState().saveWeek(snapshot);
    expect(useStore.getState().loadWeekSave(44)).toEqual(snapshot);
  });

  it('loadWeekSave retourne null pour une semaine non sauvegardée', () => {
    expect(useStore.getState().loadWeekSave(10)).toBeNull();
  });

  it('hasWeekSave reflète la présence réelle', () => {
    expect(useStore.getState().hasWeekSave(44)).toBe(false);
    useStore.getState().saveWeek(makeSnapshot({ weekNumber: 44 }));
    expect(useStore.getState().hasWeekSave(44)).toBe(true);
  });

  it('saveWeek écrase le snapshot existant pour la même semaine', () => {
    useStore.getState().saveWeek(makeSnapshot({ weekNumber: 44, savedAt: 1 }));
    useStore.getState().saveWeek(makeSnapshot({ weekNumber: 44, savedAt: 2 }));
    expect(useStore.getState().loadWeekSave(44)?.savedAt).toBe(2);
    expect(Object.keys(useStore.getState().weekSaves)).toHaveLength(1);
  });

  it('deux semaines différentes coexistent (plus de clé année intermédiaire)', () => {
    useStore.getState().saveWeek(makeSnapshot({ weekNumber: 44 }));
    useStore.getState().saveWeek(makeSnapshot({ weekNumber: 10 }));
    expect(useStore.getState().hasWeekSave(44)).toBe(true);
    expect(useStore.getState().hasWeekSave(10)).toBe(true);
    expect(Object.keys(useStore.getState().weekSaves).sort()).toEqual(['10', '44']);
  });

  it('deleteWeekSave retire uniquement la semaine ciblée', () => {
    useStore.getState().saveWeek(makeSnapshot({ weekNumber: 44 }));
    useStore.getState().saveWeek(makeSnapshot({ weekNumber: 10 }));
    useStore.getState().deleteWeekSave(44);
    expect(useStore.getState().hasWeekSave(44)).toBe(false);
    expect(useStore.getState().hasWeekSave(10)).toBe(true);
  });

  it('clearAllWeekSaves vide tout', () => {
    useStore.getState().saveWeek(makeSnapshot({ weekNumber: 44 }));
    useStore.getState().saveWeek(makeSnapshot({ weekNumber: 10 }));
    useStore.getState().clearAllWeekSaves();
    expect(useStore.getState().weekSaves).toEqual({});
  });

  describe('addManualCourse', () => {
    it("crée un snapshot par défaut si la semaine n'existe pas encore", () => {
      useStore.getState().addManualCourse(44, '2026-2027', makeCourse());
      const snapshot = useStore.getState().loadWeekSave(44);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.weekNumber).toBe(44);
      expect(snapshot?.schoolYear).toBe('2026-2027');
      expect(snapshot?.taskGroups).toEqual([]);
      expect(snapshot?.manualEnforcedMap).toEqual({});
      expect(snapshot?.manualCourses).toHaveLength(1);
    });

    it('tague le nouveau cours source: manual avec un id généré', () => {
      useStore.getState().addManualCourse(44, '2026-2027', makeCourse({ code: 'R999' }));
      const [course] = useStore.getState().loadWeekSave(44)!.manualCourses;
      expect(course.source).toBe('manual');
      expect(course.id).toBeTruthy();
      expect(course.code).toBe('R999');
    });

    it("n'écrase pas les autres champs d'un snapshot déjà existant", () => {
      useStore.getState().saveWeek(makeSnapshot({ weekNumber: 44, taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: [] }] }));
      useStore.getState().addManualCourse(44, '2026-2027', makeCourse());
      const snapshot = useStore.getState().loadWeekSave(44);
      expect(snapshot?.taskGroups).toEqual([{ id: 'g1', type: 'parallel', courseKeys: [] }]);
      expect(snapshot?.manualCourses).toHaveLength(1);
    });

    it('ajoute par spread sans recréer les objets déjà présents (garde-fou append-only)', () => {
      useStore.getState().addManualCourse(44, '2026-2027', makeCourse({ code: 'R1' }));
      const first = useStore.getState().loadWeekSave(44)!.manualCourses[0];
      useStore.getState().addManualCourse(44, '2026-2027', makeCourse({ code: 'R2' }));
      const manualCourses = useStore.getState().loadWeekSave(44)!.manualCourses;
      expect(manualCourses).toHaveLength(2);
      expect(manualCourses[0]).toBe(first);
    });

    it('lit correctement un snapshot legacy (weeklyCourses mixte) avant écriture', () => {
      const legacyCsv = { id: 'csv1', source: 'csv' as const, ...makeCourse({ code: 'CSV1' }) };
      const legacyManual = { id: 'm_legacy', source: 'manual' as const, ...makeCourse({ code: 'MANUAL1' }) };
      useStore.getState().saveWeek({
        ...makeSnapshot({ weekNumber: 44 }),
        manualCourses: undefined as never, // simule un snapshot jamais réécrit au nouveau format
        weeklyCourses: [legacyCsv, legacyManual],
      } as unknown as PreparedWeekSnapshot);

      useStore.getState().addManualCourse(44, '2026-2027', makeCourse({ code: 'NEW' }));
      const manualCourses = useStore.getState().loadWeekSave(44)!.manualCourses;
      // Le legacy CSV ne doit pas être repris, seul le manuel legacy + le nouveau
      expect(manualCourses.map((c) => c.code).sort()).toEqual(['MANUAL1', 'NEW']);
    });
  });

  describe('removeManualCourse', () => {
    it('retire uniquement le cours ciblé par id', () => {
      useStore.getState().addManualCourse(44, '2026-2027', makeCourse({ code: 'R1' }));
      useStore.getState().addManualCourse(44, '2026-2027', makeCourse({ code: 'R2' }));
      const [first, second] = useStore.getState().loadWeekSave(44)!.manualCourses;
      useStore.getState().removeManualCourse(44, first.id);
      const remaining = useStore.getState().loadWeekSave(44)!.manualCourses;
      expect(remaining).toEqual([second]);
    });

    it("no-op silencieux si la semaine n'a pas de snapshot", () => {
      expect(() => useStore.getState().removeManualCourse(44, 'unknown')).not.toThrow();
      expect(useStore.getState().loadWeekSave(44)).toBeNull();
    });
  });

  describe('updateManualCourse', () => {
    it('ne patche que le cours ciblé, laisse les autres intacts', () => {
      useStore.getState().addManualCourse(44, '2026-2027', makeCourse({ code: 'R1', duration: 60 }));
      useStore.getState().addManualCourse(44, '2026-2027', makeCourse({ code: 'R2', duration: 90 }));
      const [first, second] = useStore.getState().loadWeekSave(44)!.manualCourses;
      useStore.getState().updateManualCourse(44, first.id, { duration: 120 });
      const manualCourses = useStore.getState().loadWeekSave(44)!.manualCourses;
      expect(manualCourses.find((c) => c.id === first.id)?.duration).toBe(120);
      expect(manualCourses.find((c) => c.id === second.id)?.duration).toBe(90);
    });

    it("no-op silencieux si la semaine n'a pas de snapshot", () => {
      expect(() => useStore.getState().updateManualCourse(44, 'unknown', { duration: 10 })).not.toThrow();
      expect(useStore.getState().loadWeekSave(44)).toBeNull();
    });
  });
});
