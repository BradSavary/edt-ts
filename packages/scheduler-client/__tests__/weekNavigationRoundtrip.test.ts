import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CourseTaskDataWithId } from '../lib/courseId';

/**
 * §5.2 point 4 de docs/PlanWeekNavigation.md — la démonstration accessible de la demande
 * d'origine : « Planifier, retoucher deux tâches. Changer de semaine depuis la barre d'outils,
 * sans rien annuler. Revenir : tout est là, retouches comprises. »
 *
 * Contrairement à persistPlacements.test.ts (cas 1, qui pose l'état directement via `setState`),
 * ce test passe par le chemin applicatif réel — `applyPendingResult` puis `updatePlacement` —
 * pour vérifier que ce chemin-là aussi survit à un aller-retour de semaine, `lastRun` compris.
 *
 * Même motif de stub localStorage + reset de modules que les autres tests de store.
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

let usePlanningStore: typeof import('../store/usePlanningStore').usePlanningStore;
let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  ({ useProjectStore } = await import('../store/useProjectStore'));

  useProjectStore.setState({
    schoolYearConfig: { year: '2026-2027', zone: 'A', periods: [] },
    weekSaves: {},
    allCourses: ['c1', 'c2', 'c3'].map((id) => makeCourse(id, 1)),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('changement de semaine sans passer par "Annuler la planification automatique" (§5.2.4)', () => {
  it('placements retouchés et lastRun survivent à un aller-retour de semaine', () => {
    usePlanningStore.getState().setSelectedWeek(1);

    // Simule un run terminé (chemin réel : applyPendingResult, pas un setState direct).
    usePlanningStore.setState({
      pendingJobResult: {
        week: 1,
        result: {
          week: 1,
          solution: {
            isComplete: true,
            tasks: [
              { taskId: 'c1', code: 'C1', name: 'c1', type: 'TD', week: 1, duration: 60, startTime: 60, resources: [] },
              { taskId: 'c2', code: 'C2', name: 'c2', type: 'TD', week: 1, duration: 60, startTime: 120, resources: [] },
            ],
            neutralizedTasks: [
              { task: { taskId: 'c3', code: 'C3', name: 'c3', type: 'TD', week: 1, duration: 60, startTime: -1, resources: [] }, eliminationRound: 0, failureCount: 1, reason: 'échec test' },
            ],
          },
        },
      },
    });
    usePlanningStore.getState().applyPendingResult();

    expect(usePlanningStore.getState().lastRun).not.toBeNull();
    expect(usePlanningStore.getState().placements).toHaveLength(2);

    // Retouche deux tâches (chemin réel : updatePlacement, bascule auto → post-enforced).
    usePlanningStore.getState().updatePlacement('c1', { startTime: 300 });
    usePlanningStore.getState().updatePlacement('c2', { startTime: 360 });

    const retouchedPlacements = usePlanningStore.getState().placements;
    const retouchedLastRun = usePlanningStore.getState().lastRun;
    const retouchedUnplaced = usePlanningStore.getState().unplaced;
    expect(retouchedPlacements.every((p) => p.origin === 'post-enforced')).toBe(true);

    // Changement de semaine depuis la barre d'outils, sans "Annuler la planification automatique".
    usePlanningStore.getState().setSelectedWeek(2);
    usePlanningStore.getState().setSelectedWeek(1);

    expect(usePlanningStore.getState().placements).toEqual(retouchedPlacements);
    expect(usePlanningStore.getState().unplaced).toEqual(retouchedUnplaced);
    expect(usePlanningStore.getState().lastRun).toEqual(retouchedLastRun);
  });
});
