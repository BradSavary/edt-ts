import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CourseTaskDataWithId } from '../lib/courseId';
import type { RunScheduleParamsFromData } from '../lib/api/scheduleApi';

/**
 * §3.3 / §5.2 (points 1-3) de docs/PlanWeekNavigation.md : `runSchedule` doit exclure du payload
 * les tâches `user-pre` **et** `user-post` (pas seulement `user-pre` comme avant ce chantier), et
 * `applyPendingResult` ne doit pas effacer les `user-post` d'avant le run dans `unplaced`.
 *
 * Même motif de stub localStorage + reset de modules que persistPlacements.test.ts.
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

function makeCourse(id: string, week: number): CourseTaskDataWithId {
  return {
    id,
    source: 'csv',
    week,
    semester: 1,
    level: 0,
    code: id.toUpperCase(),
    name: id,
    type: 'TD',
    duration: 60,
    teacher: [],
    groups: [],
    rooms: [],
  };
}

let capturedParams: RunScheduleParamsFromData[] = [];

vi.mock('../lib/api/scheduleApi', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/scheduleApi')>('../lib/api/scheduleApi');
  return {
    ...actual,
    submitJobAsync: vi.fn(async (params: RunScheduleParamsFromData) => {
      capturedParams.push(params);
      return { jobId: 'job-test' };
    }),
  };
});

let usePlanningStore: typeof import('../store/usePlanningStore').usePlanningStore;
let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  capturedParams = [];
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  ({ useProjectStore } = await import('../store/useProjectStore'));

  useProjectStore.setState({
    schoolYearConfig: { year: '2026-2027', zone: 'A', periods: [] },
    weekSaves: {},
    allCourses: ['c1', 'c2', 'c3'].map((id) => makeCourse(id, 1)),
    resources: [{ resourceType: 'teacher', resources: [] }],
  });
  usePlanningStore.getState().setSelectedWeek(1);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exclusion des user-post du payload runSchedule (§3.3 de PlanWeekNavigation)', () => {
  it("1. une tâche user-post n'est pas envoyée au moteur", async () => {
    usePlanningStore.setState({
      unplaced: [{ taskId: 'c1', origin: 'user-post' }],
    });

    await usePlanningStore.getState().runSchedule();

    expect(capturedParams).toHaveLength(1);
    const sentIds = capturedParams[0]!.courses.map((c) => c.id);
    expect(sentIds).not.toContain('c1');
    expect(sentIds.sort()).toEqual(['c2', 'c3']);
  });

  it('2. une tâche engine est envoyée au moteur', async () => {
    usePlanningStore.setState({
      unplaced: [{ taskId: 'c1', origin: 'engine', diagnostics: { reason: 'x', failureCount: 1, eliminationRound: 0 } }],
    });

    await usePlanningStore.getState().runSchedule();

    expect(capturedParams).toHaveLength(1);
    const sentIds = capturedParams[0]!.courses.map((c) => c.id);
    expect(sentIds).toContain('c1');
  });

  it('3. après applyPendingResult, une tâche user-post d\'avant le run est toujours dans unplaced', () => {
    usePlanningStore.setState({
      unplaced: [{ taskId: 'c1', origin: 'user-post' }],
      pendingJobResult: {
        week: 1,
        result: {
          week: 1,
          solution: {
            isComplete: true,
            tasks: [
              { taskId: 'c2', code: 'C2', name: 'c2', type: 'TD', week: 1, duration: 60, startTime: 120, resources: [] },
            ],
            neutralizedTasks: [],
          },
        },
      },
    });

    usePlanningStore.getState().applyPendingResult();

    const unplaced = usePlanningStore.getState().unplaced;
    expect(unplaced.some((u) => u.taskId === 'c1' && u.origin === 'user-post')).toBe(true);
  });
});
