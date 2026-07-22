import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CourseTaskDataWithId } from '../lib/courseId';

/**
 * Non-régression du bug « éditer un cours fait sauter toute la préparation de la semaine » :
 * un effet de `useCalendarCore` remettait à zéro les impositions dès que la liste des cours
 * changeait par référence (héritage des clés de cours par INDEX, antérieur aux ids stables).
 * Éditer un cours — ex. lui retirer une salle — n'invalide aucune clé : la préparation doit
 * survivre telle quelle. Seule une VRAIE suppression élague, et de façon ciblée (`pruneCourseIds`).
 *
 * Même motif de stub localStorage + reset de modules que les autres tests de store
 * (voir persistPlacements.test.ts).
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
let renderHook: typeof import('@testing-library/react').renderHook;
let cleanup: typeof import('@testing-library/react').cleanup;

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
    teacher: ['T1'],
    groups: ['G1'],
    rooms: ['R1', 'R2'],
  };
}

const enforced = (startTime: number) => ({
  startTime,
  teacher: ['T1'],
  groups: ['G1'],
  rooms: ['R1'],
});

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  ({ useProjectStore } = await import('../store/useProjectStore'));
  // Importés après `resetModules` comme les stores : sans ça, le hook réimporté et
  // `renderHook` chargeraient deux instances distinctes de React (« Invalid hook call »).
  ({ useCalendarCore } = await import('../hooks/useCalendarCore'));
  ({ renderHook, cleanup } = await import('@testing-library/react'));

  useProjectStore.setState({
    schoolYearConfig: { year: '2026-2027', zone: 'A', periods: [] },
    weekSaves: {},
    allCourses: ['c1', 'c2', 'c3'].map((id) => makeCourse(id, 1)),
  });
  usePlanningStore.getState().setSelectedWeek(1);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('édition d’un cours et préparation de semaine', () => {
  it('retirer une salle d’un cours ne touche à aucune imposition', () => {
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60), c2: enforced(120) });

    // Ce que fait SidebarPreparation.handleEditConfirm : remplacer l'objet cours dans allCourses.
    const { allCourses, setCourses } = useProjectStore.getState();
    setCourses(allCourses.map((c) => (c.id === 'c1' ? { ...c, rooms: ['R1'] } : c)));

    const state = usePlanningStore.getState();
    expect(Object.keys(state.manualEnforcedMap).sort()).toEqual(['c1', 'c2']);
    expect(Object.keys(state.enforcedMap).sort()).toEqual(['c1', 'c2']);
    expect(state.placements.map((p) => p.taskId).sort()).toEqual(['c1', 'c2']);
  });

  it('l’édition est persistée sans écraser la préparation du snapshot de semaine', () => {
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });

    const { allCourses, setCourses } = useProjectStore.getState();
    setCourses(allCourses.map((c) => (c.id === 'c1' ? { ...c, rooms: [] } : c)));

    expect(
      Object.keys(useProjectStore.getState().weekSaves['1'].manualEnforcedMap),
    ).toEqual(['c1']);
  });

  it('le calendrier monté ne remet plus les impositions à zéro quand la liste de cours change', () => {
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60), c2: enforced(120) });

    const coursesFor = () => useProjectStore.getState().allCourses.filter((c) => c.week === 1);
    const { rerender } = renderHook(
      ({ courses }: { courses: CourseTaskDataWithId[] }) =>
        useCalendarCore(usePlanningStore.getState().placements, courses),
      { initialProps: { courses: coursesFor() } },
    );

    const { allCourses, setCourses } = useProjectStore.getState();
    setCourses(allCourses.map((c) => (c.id === 'c1' ? { ...c, rooms: ['R1'] } : c)));
    rerender({ courses: coursesFor() });

    // C'est précisément ici que l'ancien effet appelait `handleEnforceChange({})`.
    expect(Object.keys(usePlanningStore.getState().manualEnforcedMap).sort()).toEqual(['c1', 'c2']);
    expect(usePlanningStore.getState().placements).toHaveLength(2);
  });

  it('pruneCourseIds retire les références au cours supprimé et à lui seul', () => {
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60), c2: enforced(120) });
    usePlanningStore.setState({
      unplaced: [{ taskId: 'c3', origin: 'user-pre' }],
      lastRun: {
        placements: [
          { placementId: 'c1', taskId: 'c1', startTime: 60, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' },
          { placementId: 'c2', taskId: 'c2', startTime: 120, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' },
        ],
        unplaced: [{ taskId: 'c3', origin: 'engine' }],
      },
    });

    useProjectStore.getState().removeCourse('c1');
    usePlanningStore.getState().pruneCourseIds(['c1']);

    const state = usePlanningStore.getState();
    expect(Object.keys(state.manualEnforcedMap)).toEqual(['c2']);
    expect(Object.keys(state.enforcedMap)).toEqual(['c2']);
    expect(state.placements.map((p) => p.taskId)).toEqual(['c2']);
    expect(state.lastRun?.placements.map((p) => p.taskId)).toEqual(['c2']);
    expect(state.unplaced.map((u) => u.taskId)).toEqual(['c3']);
  });

  it('pruneCourseIds supprime les impositions propagées depuis le cours retiré', () => {
    // c1 et c2 dans un même groupe parallèle : imposer c1 propage sur c2.
    usePlanningStore.setState({
      taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['c1', 'c2'] }],
    });
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });
    expect(Object.keys(usePlanningStore.getState().enforcedMap).sort()).toEqual(['c1', 'c2']);

    useProjectStore.getState().removeCourse('c1');
    usePlanningStore.getState().pruneCourseIds(['c1']);

    const state = usePlanningStore.getState();
    // Le groupe tombe à 1 membre → dissous ; l'imposition propagée sur c2 disparaît avec lui.
    expect(state.taskGroups).toEqual([]);
    expect(state.enforcedMap).toEqual({});
    expect(state.placements).toEqual([]);
  });
});
