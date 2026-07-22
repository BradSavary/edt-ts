import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CourseTaskDataWithId } from '../lib/courseId';
import type { TaskGroupConfig } from '../lib/taskGroupUtils';

/**
 * Régression : après une planification automatique, remettre dans la pioche un cours **imposé
 * avant** le calcul annulait toute la planification et ramenait l'état de préparation.
 *
 * Cause : le geste passait par `handleEnforceChange`, qui remet `lastRun` à `null` (la bascule de
 * mode, cf. SidebarLeft) et reconstruit `placements` depuis la seule map d'imposition — donc sans
 * aucun placement `auto`. Une fois la planification faite, une imposition doit se retirer comme
 * n'importe quel autre placement (`unplaceTask`), qui nettoie en plus les maps d'imposition.
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

let usePlanningStore: typeof import('../store/usePlanningStore').usePlanningStore;
let useProjectStore: typeof import('../store/useProjectStore').useProjectStore;
let useCalendarCore: typeof import('../hooks/useCalendarCore').useCalendarCore;

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

/** Tâche telle que le moteur la renvoie (l'imposée revient posée là où elle était imposée). */
function solved(taskId: string, startTime: number) {
  return {
    taskId,
    code: 'R1.01',
    name: 'Cours',
    type: 'CM',
    week: 1,
    duration: 60,
    startTime,
    resources: [
      { id: 'DUPONT', type: 'teacher' },
      { id: 'G1', type: 'group' },
      { id: 'A101', type: 'room' },
    ],
  };
}

/** Applique un résultat moteur pour les tâches données, par le chemin applicatif réel. */
function applyRun(tasks: ReturnType<typeof solved>[]) {
  usePlanningStore.setState({
    pendingJobResult: {
      week: 1,
      result: { solution: { isComplete: true, tasks, neutralizedTasks: [] }, week: 1 },
    },
  });
  usePlanningStore.getState().applyPendingResult();
}

const ENFORCED_C1 = { startTime: 600, teacher: ['DUPONT'], groups: ['G1'], rooms: ['A101'] };

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  ({ useProjectStore } = await import('../store/useProjectStore'));
  // Import dynamique lui aussi : le hook référence le store, il doit voir la même instance que
  // celle re-créée par `vi.resetModules()` ci-dessus.
  ({ useCalendarCore } = await import('../hooks/useCalendarCore'));
  useProjectStore.setState({
    schoolYearConfig: { year: '2026-2027', zone: 'A', periods: [] },
    weekSaves: {},
    allCourses: [course('c1'), course('c2')],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('imposition remise dans la pioche après planification', () => {
  beforeEach(() => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.getState().handleEnforceChange({ c1: ENFORCED_C1 });
    applyRun([solved('c1', 600), solved('c2', 780)]);
  });

  it('la planification survit : lastRun et les placements auto restent en place', () => {
    // Pré-condition : l'imposée est bien revenue marquée comme telle.
    expect(usePlanningStore.getState().placements).toContainEqual(
      expect.objectContaining({ taskId: 'c1', origin: 'pre-enforced' }),
    );

    usePlanningStore.getState().unplaceTask('c1', 'user-post');

    const state = usePlanningStore.getState();
    expect(state.lastRun).not.toBeNull();
    expect(state.placements).toEqual([
      expect.objectContaining({ taskId: 'c2', startTime: 780, origin: 'auto' }),
    ]);
    expect(state.unplaced).toEqual([{ taskId: 'c1', origin: 'user-post' }]);
  });

  it('l\'imposition quitte les maps : elle ne resurgit pas au retour à la préparation', () => {
    usePlanningStore.getState().unplaceTask('c1', 'user-post');

    expect(usePlanningStore.getState().manualEnforcedMap).toEqual({});
    expect(usePlanningStore.getState().enforcedMap).toEqual({});

    usePlanningStore.getState().returnToPreparation([]);
    expect(usePlanningStore.getState().placements).toEqual([]);
  });

  it('l\'imposition retirée ne revient pas posée après un rechargement de semaine', () => {
    usePlanningStore.getState().unplaceTask('c1', 'user-post');

    usePlanningStore.getState().setSelectedWeek(2);
    usePlanningStore.getState().setSelectedWeek(1);

    const state = usePlanningStore.getState();
    expect(state.placements.some((p) => p.taskId === 'c1')).toBe(false);
    expect(state.unplaced).toContainEqual({ taskId: 'c1', origin: 'user-post' });
  });

  it('déplacer l\'imposition après le calcul la garde imposée, à sa nouvelle position', () => {
    usePlanningStore.getState().updatePlacement('c1', { startTime: 660 });

    const state = usePlanningStore.getState();
    expect(state.lastRun).not.toBeNull();
    expect(state.placements).toContainEqual(
      expect.objectContaining({ taskId: 'c1', startTime: 660, origin: 'pre-enforced' }),
    );
    // La map suit, sinon `returnToPreparation` la replacerait à 600.
    expect(state.manualEnforcedMap['c1']).toEqual({ ...ENFORCED_C1, startTime: 660 });
    usePlanningStore.getState().returnToPreparation([]);
    expect(usePlanningStore.getState().placements).toEqual([
      expect.objectContaining({ taskId: 'c1', startTime: 660, origin: 'pre-enforced' }),
    ]);
  });
});

/**
 * Le geste lui-même, au niveau du hook : c'est là que vivait le bug — la tuile imposée partait
 * dans `handleEnforceChange` au lieu de `unplaceTask`, quel que soit le mode.
 */
describe('geste « tuile imposée déposée hors du calendrier » (useCalendarCore)', () => {
  /** Sort la tuile `placementId` du calendrier, comme FullCalendar le ferait à la fin d'un drag. */
  function dragOutside(placementId: string, origin: string) {
    const courses = [course('c1'), course('c2')];
    const { result } = renderHook(() =>
      useCalendarCore(usePlanningStore.getState().placements, courses),
    );
    // jsdom rend un rect à zéro : un point à (500, 500) est « hors du calendrier ».
    result.current.calendarWrapperRef.current = document.createElement('div');
    const removed = vi.fn();
    result.current.handleEventDragStop({
      event: { id: placementId, extendedProps: { origin, taskId: placementId }, remove: removed },
      jsEvent: { clientX: 500, clientY: 500 },
      // Le hook ne lit que ces trois champs — cast local plutôt qu'un faux EventDragStopArg complet.
    } as unknown as Parameters<typeof result.current.handleEventDragStop>[0]);
    return { removed };
  }

  it('après planification : la tuile imposée part dans la pioche, la solution reste', () => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.getState().handleEnforceChange({ c1: ENFORCED_C1 });
    applyRun([solved('c1', 600), solved('c2', 780)]);

    const { removed } = dragOutside('c1', 'pre-enforced');

    const state = usePlanningStore.getState();
    expect(removed).toHaveBeenCalled();
    expect(state.lastRun).not.toBeNull();
    expect(state.placements).toEqual([
      expect.objectContaining({ taskId: 'c2', startTime: 780, origin: 'auto' }),
    ]);
    expect(state.unplaced).toEqual([{ taskId: 'c1', origin: 'user-post' }]);
    expect(state.manualEnforcedMap).toEqual({});
  });

  it('« Retirer l\'imposition » (modale d\'édition) suit la même règle après planification', () => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.getState().handleEnforceChange({ c1: ENFORCED_C1 });
    applyRun([solved('c1', 600), solved('c2', 780)]);

    const { result } = renderHook(() =>
      useCalendarCore(usePlanningStore.getState().placements, [course('c1'), course('c2')]),
    );
    result.current.removeEnforced('c1');

    const state = usePlanningStore.getState();
    expect(state.lastRun).not.toBeNull();
    expect(state.placements).toEqual([
      expect.objectContaining({ taskId: 'c2', origin: 'auto' }),
    ]);
    expect(state.unplaced).toEqual([{ taskId: 'c1', origin: 'user-post' }]);
  });

  it('en préparation : la tuile imposée est simplement dés-imposée, sans entrée en pioche', () => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.getState().handleEnforceChange({ c1: ENFORCED_C1 });

    dragOutside('c1', 'pre-enforced');

    const state = usePlanningStore.getState();
    expect(state.manualEnforcedMap).toEqual({});
    expect(state.placements).toEqual([]);
    // Le cours repart dans la liste de la sidebar : rien à signaler comme non placé, sinon la
    // prochaine planification l'exclurait (`user-pre`/`user-post` ne sont jamais envoyés au moteur).
    expect(state.unplaced).toEqual([]);
  });
});

describe('imposition propagée par un groupe, remise dans la pioche après planification', () => {
  const taskGroups: TaskGroupConfig[] = [{ id: 'g1', type: 'parallel', courseKeys: ['c1', 'c2'] }];

  beforeEach(() => {
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({ taskGroups });
    usePlanningStore.getState().handleEnforceChange({ c1: ENFORCED_C1 });
    applyRun([solved('c1', 600), solved('c2', 600)]);
  });

  it('retirer le membre propagé ne touche pas à l\'imposition manuelle qui la produit', () => {
    usePlanningStore.getState().unplaceTask('c2', 'user-post');

    const state = usePlanningStore.getState();
    expect(state.manualEnforcedMap).toEqual({ c1: ENFORCED_C1 });
    expect(state.placements).toEqual([
      expect.objectContaining({ taskId: 'c1', origin: 'pre-enforced' }),
    ]);
  });

  it('le membre propagé retiré ne revient pas posé au rechargement, alors qu\'il est re-dérivé', () => {
    usePlanningStore.getState().unplaceTask('c2', 'user-post');

    usePlanningStore.getState().setSelectedWeek(2);
    usePlanningStore.getState().setSelectedWeek(1);

    const state = usePlanningStore.getState();
    // La propagation reste calculée (c2 est toujours coéquipier de c1)…
    expect(state.enforcedMap['c2']).toBeDefined();
    // …mais le retrait explicite prime sur la re-dérivation.
    expect(state.placements.some((p) => p.taskId === 'c2')).toBe(false);
  });
});
