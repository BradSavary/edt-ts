import { describe, it, expect, beforeEach } from 'vitest';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
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
    weeklyCourses: [],
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
});
