import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CourseTaskDataWithId } from '../lib/courseId';
import type { ResourceGroupData } from '@edt-ts/scheduler-common';
import type { PreparedWeekSnapshot } from '../store/slices/weekSavesSlice';

/**
 * L'environnement de test (Node récent + jsdom) expose un `localStorage` global cassé
 * (`--localstorage-file` sans chemin valide). `useProjectStore` lit localStorage dès son
 * import (migrateLegacyProjectStorage + hydratation persist), donc on stub AVANT
 * d'importer dynamiquement le module, avec un reset de la registry de modules entre
 * chaque test pour repartir d'un store frais.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}

function makeCourse(overrides: Partial<CourseTaskDataWithId> = {}): CourseTaskDataWithId {
  return {
    id: 'csv1',
    source: 'csv',
    week: 44,
    semester: 1,
    level: 0,
    code: 'R101',
    name: 'Algorithmique',
    type: 'TD',
    duration: 60,
    teacher: ['DUPONT'],
    groups: ['G1'],
    rooms: ['A101'],
    ...overrides,
  };
}

function makeResources(): ResourceGroupData[] {
  return [
    { resourceType: 'teacher', resources: [{ id: 'DUPONT' }] },
    { resourceType: 'room', resources: [{ id: 'A101' }] },
    { resourceType: 'group', resources: [{ id: 'G1' }] },
  ];
}

function makeSnapshot(overrides: Partial<PreparedWeekSnapshot> = {}): PreparedWeekSnapshot {
  return {
    weekNumber: 44,
    schoolYear: '2026-2027',
    savedAt: 1000,
    taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['csv1'] }],
    manualBlockedZones: [],
    preNeutralizedKeys: [],
    manualEnforcedMap: { csv1: { teacher: ['DUPONT'], groups: ['G1'], rooms: ['A101'], startTime: 0 } },
    manualCourses: [],
    ...overrides,
  };
}

let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ useProjectStore } = await import('../store/useProjectStore'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useProjectStore.importCsvData', () => {
  it('remplace allCourses/resources/coursesFileName', () => {
    const newCourses = [makeCourse({ id: 'new1', code: 'R202' })];
    const newResources = makeResources();
    useProjectStore.getState().importCsvData(newCourses, newResources, 'nouveau.csv');
    const state = useProjectStore.getState();
    expect(state.allCourses.map((c) => c.code)).toEqual(['R202']);
    expect(state.resources).toEqual(newResources);
    expect(state.coursesFileName).toBe('nouveau.csv');
  });

  it('préserve manualCourses des semaines qui en ont, réinitialise le reste de leur préparation', () => {
    const manual = makeCourse({ id: 'm1', source: 'manual', code: 'MANUEL' });
    useProjectStore.setState({
      weekSaves: { '44': makeSnapshot({ manualCourses: [manual] }) },
    });

    useProjectStore.getState().importCsvData([makeCourse()], makeResources(), 'x.csv');

    const snapshot = useProjectStore.getState().weekSaves['44'];
    expect(snapshot).toBeDefined();
    expect(snapshot.manualCourses).toEqual([manual]);
    expect(snapshot.taskGroups).toEqual([]);
    expect(snapshot.manualEnforcedMap).toEqual({});
    expect(snapshot.preNeutralizedKeys).toEqual([]);
    expect(snapshot.manualBlockedZones).toEqual([]);
  });

  it('supprime l\'entrée weekSaves d\'une semaine sans cours manuel', () => {
    useProjectStore.setState({
      weekSaves: {
        '44': makeSnapshot({ manualCourses: [] }),
        '10': makeSnapshot({ weekNumber: 10, manualCourses: [makeCourse({ id: 'm2', source: 'manual', week: 10 })] }),
      },
    });

    useProjectStore.getState().importCsvData([makeCourse()], makeResources(), 'x.csv');

    const weekSaves = useProjectStore.getState().weekSaves;
    expect(weekSaves['44']).toBeUndefined();
    expect(weekSaves['10']).toBeDefined();
  });

  it("force source: 'csv' sur les cours entrants même si le tableau reçu contient une entrée 'manual'", () => {
    const contaminated = makeCourse({ id: 'sneaky', source: 'manual' as CourseTaskDataWithId['source'] });
    useProjectStore.getState().importCsvData([contaminated], makeResources(), 'x.csv');
    expect(useProjectStore.getState().allCourses[0].source).toBe('csv');
  });

  it('continue de pruner les contraintes des ressources absentes du nouveau CSV', () => {
    useProjectStore.setState({
      constraints: { Default: [], DUPONT: null, DISPARU: null },
    });
    useProjectStore.getState().importCsvData([makeCourse()], makeResources(), 'x.csv');
    const constraints = useProjectStore.getState().constraints;
    expect(Object.keys(constraints).sort()).toEqual(['DUPONT', 'Default']);
  });
});

describe('useProjectStore.removeCourse', () => {
  it('retire uniquement le cours CSV ciblé par id', () => {
    const c1 = makeCourse({ id: 'c1', code: 'R1' });
    const c2 = makeCourse({ id: 'c2', code: 'R2' });
    useProjectStore.setState({ allCourses: [c1, c2] });
    useProjectStore.getState().removeCourse('c1');
    expect(useProjectStore.getState().allCourses).toEqual([c2]);
  });
});
