import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
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

/**
 * docs/PlanSyncSidebarEnforced.md — un cours imposé a deux enregistrements (cours-modèle lu par
 * la carte sidebar, imposition concrète lue par la tuile calendrier). Ce bloc couvre les deux
 * sens de réconciliation entre eux.
 */
describe('synchronisation carte sidebar / tuile calendrier d’un cours imposé', () => {
  const coursesFor = () => useProjectStore.getState().allCourses.filter((c) => c.week === 1);

  /** Pose `pendingEdit` puis confirme, comme le ferait un utilisateur retouchant une tuile. */
  function editViaTile(update: { teachers: string[]; groups: string[]; rooms: string[]; duration?: number }) {
    const { result } = renderHook(() =>
      useCalendarCore(usePlanningStore.getState().placements, coursesFor()),
    );
    act(() => {
      result.current.setPendingEdit({
        placementId: 'c1',
        taskId: 'c1',
        title: 'c1',
        teachers: ['T1'],
        groups: ['G1'],
        rooms: ['R1'],
        startTime: 60,
        durationMin: 60,
        origin: 'pre-enforced',
        teacherOptions: [],
        groupOptions: [],
        roomOptions: [],
      });
    });
    act(() => {
      result.current.handleEditConfirm(update);
    });
  }

  it('sens calendrier → modèle : retoucher la salle depuis la tuile met à jour le cours ET manualEnforcedMap', () => {
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });

    editViaTile({ teachers: ['T1'], groups: ['G1'], rooms: ['R9'] });

    const c1 = useProjectStore.getState().allCourses.find((c) => c.id === 'c1')!;
    expect(c1.rooms).toEqual(['R9']);
    expect(usePlanningStore.getState().manualEnforcedMap.c1.rooms).toEqual(['R9']);
  });

  it('les alternatives du modèle survivent à une retouche qui ne les concerne pas', () => {
    const { allCourses, setCourses } = useProjectStore.getState();
    setCourses(allCourses.map((c) => (c.id === 'c1' ? { ...c, teacher: [['T1', 'T2']] } : c)));
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });

    editViaTile({ teachers: ['T1'], groups: ['G1'], rooms: ['R9'] });

    const c1 = useProjectStore.getState().allCourses.find((c) => c.id === 'c1')!;
    expect(c1.teacher).toEqual([['T1', 'T2']]);
  });

  it('une salle choisie hors des alternatives élargit le OU du modèle au lieu de le détruire', () => {
    const { allCourses, setCourses } = useProjectStore.getState();
    setCourses(allCourses.map((c) => (c.id === 'c1' ? { ...c, rooms: [['R1', 'R2']] } : c)));
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });

    editViaTile({ teachers: ['T1'], groups: ['G1'], rooms: ['B12'] });

    const c1 = useProjectStore.getState().allCourses.find((c) => c.id === 'c1')!;
    // La modale du calendrier tourne sans « + OU » : le combo concret ne peut pas exprimer le OU du
    // modèle, il ne doit donc pas pouvoir le supprimer. L'imposition, elle, porte bien B12 seul.
    expect(c1.rooms).toEqual([['R1', 'R2', 'B12']]);
    expect(usePlanningStore.getState().manualEnforcedMap.c1.rooms).toEqual(['B12']);
  });

  it('un combo dont l’ordre diffère du modèle ne le réordonne ni ne l’altère', () => {
    const { allCourses, setCourses } = useProjectStore.getState();
    setCourses(allCourses.map((c) => (c.id === 'c1' ? { ...c, rooms: [['R1', 'R2'], 'R3'] } : c)));
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });

    // Ordre historique d'EnforceModal : les entrées fixes d'abord, puis les alternatives résolues.
    editViaTile({ teachers: ['T1'], groups: ['G1'], rooms: ['R3', 'R2'] });

    const c1 = useProjectStore.getState().allCourses.find((c) => c.id === 'c1')!;
    expect(c1.rooms).toEqual([['R1', 'R2'], 'R3']);
  });

  it('la durée reste synchrone (non-régression) : la retouche écrit le cours et laisse l’imposition en place', () => {
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });

    editViaTile({ teachers: ['T1'], groups: ['G1'], rooms: ['R1'], duration: 90 });

    const c1 = useProjectStore.getState().allCourses.find((c) => c.id === 'c1')!;
    expect(c1.duration).toBe(90);
    expect(usePlanningStore.getState().manualEnforcedMap.c1).toBeDefined();
  });

  it('sens modèle → imposition : éditer la salle depuis la sidebar réaligne enforcedMap, startTime inchangé', () => {
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });

    const { allCourses, setCourses } = useProjectStore.getState();
    setCourses(allCourses.map((c) => (c.id === 'c1' ? { ...c, rooms: ['R9'] } : c)));
    usePlanningStore.getState().syncEnforcedAfterCourseEdit('c1');

    const state = usePlanningStore.getState();
    expect(state.enforcedMap.c1.rooms).toEqual(['R9']);
    expect(state.enforcedMap.c1.startTime).toBe(60);
  });

  it('le choix déjà imposé est préservé quand le modèle réordonne ses alternatives', () => {
    const { allCourses, setCourses } = useProjectStore.getState();
    setCourses(allCourses.map((c) => (c.id === 'c1' ? { ...c, teacher: [['T1', 'T2']] } : c)));
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });

    setCourses(useProjectStore.getState().allCourses.map((c) => (c.id === 'c1' ? { ...c, teacher: [['T2', 'T1']] } : c)));
    usePlanningStore.getState().syncEnforcedAfterCourseEdit('c1');

    expect(usePlanningStore.getState().enforcedMap.c1.teacher).toEqual(['T1']);
  });

  it('imposition dérivée d’un groupe : la salle propagée suit le cours patché, sans entrer dans manualEnforcedMap', () => {
    usePlanningStore.setState({ taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['c1', 'c2'] }] });
    usePlanningStore.getState().handleEnforceChange({ c1: enforced(60) });
    expect(Object.keys(usePlanningStore.getState().enforcedMap).sort()).toEqual(['c1', 'c2']);

    const { allCourses, setCourses } = useProjectStore.getState();
    setCourses(allCourses.map((c) => (c.id === 'c2' ? { ...c, rooms: ['R9'] } : c)));
    usePlanningStore.getState().syncEnforcedAfterCourseEdit('c2');

    const state = usePlanningStore.getState();
    expect(state.enforcedMap.c2.rooms).toEqual(['R9']);
    expect(state.manualEnforcedMap.c2).toBeUndefined();
  });

  it('no-op sur un cours non imposé : ni manualEnforcedMap ni placements ne changent de référence', () => {
    const before = usePlanningStore.getState();

    usePlanningStore.getState().syncEnforcedAfterCourseEdit('c3');

    const after = usePlanningStore.getState();
    expect(after.manualEnforcedMap).toBe(before.manualEnforcedMap);
    expect(after.placements).toBe(before.placements);
  });
});
