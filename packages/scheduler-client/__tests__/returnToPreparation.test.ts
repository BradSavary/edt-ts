import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Placement } from '../store/types';
import type { CourseTaskDataWithId } from '../lib/courseId';
import type { TaskGroupConfig } from '../lib/taskGroupUtils';

/**
 * `useProjectStore`/`usePlanningStore` lisent localStorage dès leur import : on stub un
 * stockage mémoire avant l'import dynamique, avec reset de la registry entre chaque test
 * (même motif que autonomyDistributionStore.test.ts / unplacedPersistence.test.ts).
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

let usePlanningStore: typeof import('../store/usePlanningStore').usePlanningStore;
let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;

function course(id: string, overrides: Partial<CourseTaskDataWithId> = {}): CourseTaskDataWithId {
  return {
    id,
    source: 'csv',
    week: 1,
    semester: 1,
    level: 1,
    code: 'R1.01',
    name: 'Cours',
    type: 'CM',
    teacher: ['DUPONT'],
    groups: ['G1'],
    rooms: ['A101'],
    duration: 60,
    ...overrides,
  };
}

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    placementId: 'p1',
    taskId: 'c1',
    startTime: 600,
    origin: 'post-enforced',
    resources: { teachers: ['DUPONT'], groups: ['G1'], rooms: ['A101'] },
    ...overrides,
  };
}

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  ({ useProjectStore } = await import('../store/useProjectStore'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('returnToPreparation (câblage store)', () => {
  it('returnToPreparation([id]) : le placement promu devient pre-enforced sans derived, et entre dans manualEnforcedMap', () => {
    useProjectStore.setState({ allCourses: [course('c1')], weekSaves: {} });
    usePlanningStore.setState({
      selectedWeek: 1,
      taskGroups: [],
      manualEnforcedMap: {},
      enforcedMap: {},
      placements: [
        placement({
          placementId: 'c1',
          taskId: 'c1',
          startTime: 700,
          origin: 'post-enforced',
          resources: { teachers: ['T2'], groups: ['G2'], rooms: ['R2'] },
        }),
      ],
      unplaced: [],
    });

    usePlanningStore.getState().returnToPreparation(['c1']);

    const { placements, manualEnforcedMap } = usePlanningStore.getState();
    expect(manualEnforcedMap['c1']).toEqual({ startTime: 700, teacher: ['T2'], groups: ['G2'], rooms: ['R2'] });
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ taskId: 'c1', startTime: 700, origin: 'pre-enforced' });
    expect(placements[0].derived).toBeUndefined();
  });

  it('returnToPreparation([]) : strictement l\'ancien comportement de resetScheduleResult', () => {
    useProjectStore.setState({ allCourses: [], weekSaves: {} });
    const enforcedMap = { c1: { startTime: 600, teacher: ['T1'], groups: ['G1'], rooms: ['R1'] } };
    usePlanningStore.setState({
      selectedWeek: 1,
      taskGroups: [],
      manualEnforcedMap: enforcedMap,
      enforcedMap,
      placements: [
        placement({ placementId: 'c1', taskId: 'c1', startTime: 600, origin: 'pre-enforced', resources: { teachers: ['T1'], groups: ['G1'], rooms: ['R1'] } }),
        placement({ placementId: 'c2', taskId: 'c2', startTime: 800, origin: 'auto', resources: { teachers: ['T2'], groups: ['G2'], rooms: ['R2'] } }),
        placement({ placementId: 'c3', taskId: 'c3', startTime: 900, origin: 'post-enforced', resources: { teachers: ['T3'], groups: ['G3'], rooms: ['R3'] } }),
      ],
      unplaced: [
        { taskId: 'exclu-avant', origin: 'user-pre' },
        { taskId: 'neutralise-moteur', origin: 'engine', diagnostics: { reason: 'test' } },
      ],
      scheduleResult: { solution: { isComplete: true, tasks: [], neutralizedTasks: [] }, week: 1 },
      currentJobId: 'job-1',
      status: { message: 'x', kind: 'inf' },
    });

    usePlanningStore.getState().returnToPreparation([]);

    const state = usePlanningStore.getState();
    // Seul le placement pre-enforced (issu de enforcedMap/manualEnforcedMap) survit — auto et
    // post-enforced disparaissent avec la solution, comme l'ancien resetScheduleResult.
    expect(state.placements).toEqual([
      { placementId: 'c1', taskId: 'c1', startTime: 600, resources: { teachers: ['T1'], groups: ['G1'], rooms: ['R1'] }, origin: 'pre-enforced' },
    ]);
    expect(state.manualEnforcedMap).toEqual(enforcedMap);
    expect(state.unplaced).toEqual([{ taskId: 'exclu-avant', origin: 'user-pre' }]);
    expect(state.scheduleResult).toBeNull();
    expect(state.currentJobId).toBeNull();
    expect(state.currentJobStatus).toBeNull();
    expect(state.pendingJobResult).toBeNull();
    expect(state.status).toBeNull();
  });

  it('après promotion, _saveCurrentWeekSnapshot écrit l\'imposition promue dans manualEnforcedMap du snapshot', () => {
    useProjectStore.setState({
      schoolYearConfig: { year: '2026-2027', zone: 'A', periods: [] },
      allCourses: [course('c1')],
      weekSaves: {},
    });
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({
      placements: [
        placement({ placementId: 'c1', taskId: 'c1', startTime: 700, origin: 'post-enforced', resources: { teachers: ['T2'], groups: ['G2'], rooms: ['R2'] } }),
      ],
    });

    usePlanningStore.getState().returnToPreparation(['c1']);

    const snapshot = useProjectStore.getState().weekSaves['1'];
    expect(snapshot).toBeDefined();
    expect(snapshot.manualEnforcedMap['c1']).toEqual({ startTime: 700, teacher: ['T2'], groups: ['G2'], rooms: ['R2'] });
  });

  it('promotion d\'un membre de groupe via le store propage aux autres membres comme toute imposition', () => {
    const c1 = course('c1', { duration: 60 });
    const c2 = course('c2', { duration: 90, teacher: ['T2'], groups: ['G2'], rooms: ['R2'] });
    const taskGroups: TaskGroupConfig[] = [{ id: 'g1', type: 'parallel', courseKeys: ['c1', 'c2'] }];
    useProjectStore.setState({ allCourses: [c1, c2], weekSaves: {} });
    usePlanningStore.setState({
      selectedWeek: 1,
      taskGroups,
      manualEnforcedMap: {},
      enforcedMap: {},
      placements: [
        placement({ placementId: 'c1', taskId: 'c1', startTime: 630, origin: 'post-enforced', resources: { teachers: ['T1'], groups: ['G1'], rooms: ['R1'] } }),
      ],
      unplaced: [],
    });

    usePlanningStore.getState().returnToPreparation(['c1']);

    const { manualEnforcedMap, enforcedMap, placements } = usePlanningStore.getState();
    // Seule c1 est manuelle (promue) ; c2 est propagée par le groupe, pas ajoutée à manualEnforcedMap.
    expect(manualEnforcedMap).toEqual({ c1: { startTime: 630, teacher: ['T1'], groups: ['G1'], rooms: ['R1'] } });
    expect(enforcedMap['c2']).toEqual({ startTime: 630, teacher: ['T2'], groups: ['G2'], rooms: ['R2'] });

    const c2Placement = placements.find((p) => p.taskId === 'c2');
    expect(c2Placement).toMatchObject({ origin: 'pre-enforced', startTime: 630 });
    expect(c2Placement?.derived).toBe(true);
  });
});
