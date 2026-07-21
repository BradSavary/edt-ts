import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CourseTaskDataWithId } from '../lib/courseId';

/**
 * §6.2 de docs/PlanPersistPlacements.md : 8 cas ciblés sur la persistance des placements/
 * non-placés (nouveaux champs `placements`/`unplaced`/`lastRun` de `PreparedWeekSnapshot`).
 *
 * Même motif de stub localStorage + reset de modules que les autres tests de store
 * (voir unplacedPersistence.test.ts / useProjectStore.test.ts).
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

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.resetModules();
  ({ usePlanningStore } = await import('../store/usePlanningStore'));
  ({ useProjectStore } = await import('../store/useProjectStore'));

  // Requis pour que `_saveCurrentWeekSnapshot` ne s'auto-annule pas (elle bail out sans
  // schoolYearConfig) — voir usePlanningStore.ts.
  useProjectStore.setState({ schoolYearConfig: { year: '2026-2027', zone: 'A', periods: [] }, weekSaves: {}, allCourses: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persistance des placements/non-placés (§6.2 de PlanPersistPlacements)', () => {
  it('1. aller-retour complet : les 3 origines de placements et de non-placés survivent à un changement de semaine', () => {
    useProjectStore.setState({
      allCourses: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => makeCourse(id, 1)),
    });
    usePlanningStore.getState().setSelectedWeek(1);

    const originalPlacements = [
      { placementId: 'c1', taskId: 'c1', startTime: 60, resources: { teachers: ['T1'], groups: ['G1'], rooms: ['R1'] }, origin: 'pre-enforced' as const },
      { placementId: 'c2', taskId: 'c2', startTime: 120, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' as const },
      { placementId: 'c3', taskId: 'c3', startTime: 180, resources: { teachers: [], groups: [], rooms: [] }, origin: 'post-enforced' as const },
    ];
    const originalUnplaced = [
      { taskId: 'c4', origin: 'user-pre' as const },
      { taskId: 'c5', origin: 'engine' as const, diagnostics: { reason: 'échec test', failureCount: 1, eliminationRound: 0 } },
      { taskId: 'c6', origin: 'user-post' as const },
    ];

    usePlanningStore.setState({
      manualEnforcedMap: { c1: { startTime: 60, teacher: ['T1'], groups: ['G1'], rooms: ['R1'] } },
      enforcedMap: { c1: { startTime: 60, teacher: ['T1'], groups: ['G1'], rooms: ['R1'] } },
      placements: originalPlacements,
      unplaced: originalUnplaced,
    });

    // Changement de semaine puis retour : passe par la sauvegarde puis la restauration.
    usePlanningStore.getState().setSelectedWeek(2);
    usePlanningStore.getState().setSelectedWeek(1);

    expect(usePlanningStore.getState().placements).toEqual(originalPlacements);
    expect(usePlanningStore.getState().unplaced).toEqual(originalUnplaced);
  });

  it("2. aucun pre-enforced ni user-pre n'est écrit dans les nouveaux champs persistés", () => {
    useProjectStore.setState({ allCourses: ['c1', 'c2'].map((id) => makeCourse(id, 1)) });
    usePlanningStore.getState().setSelectedWeek(1);

    usePlanningStore.setState({
      manualEnforcedMap: { c1: { startTime: 60, teacher: [], groups: [], rooms: [] } },
      enforcedMap: { c1: { startTime: 60, teacher: [], groups: [], rooms: [] } },
      placements: [
        { placementId: 'c1', taskId: 'c1', startTime: 60, resources: { teachers: [], groups: [], rooms: [] }, origin: 'pre-enforced' },
        { placementId: 'c2', taskId: 'c2', startTime: 120, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' },
      ],
      unplaced: [
        { taskId: 'c3', origin: 'user-pre' },
        { taskId: 'c4', origin: 'engine', diagnostics: { reason: 'x', failureCount: 1, eliminationRound: 0 } },
      ],
    });

    const snapshot = useProjectStore.getState().weekSaves['1'];
    expect(snapshot.placements?.some((p) => p.origin === 'pre-enforced')).toBe(false);
    expect(snapshot.unplaced?.some((u) => u.origin === 'user-pre')).toBe(false);
    // Les deux origines couvertes par le mécanisme existant : présentes ailleurs.
    expect(snapshot.manualEnforcedMap.c1).toBeDefined();
    expect(snapshot.preNeutralizedKeys).toEqual(['c3']);
  });

  it('3. un placement dont le cours a disparu est élagué à la restauration, et ne repart pas en sauvegarde', () => {
    useProjectStore.setState({ allCourses: [makeCourse('c-ghost', 1), makeCourse('c-real', 1)] });
    usePlanningStore.getState().setSelectedWeek(1);

    usePlanningStore.setState({
      placements: [
        { placementId: 'c-ghost', taskId: 'c-ghost', startTime: 60, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' },
        { placementId: 'c-real', taskId: 'c-real', startTime: 120, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' },
      ],
    });
    expect(useProjectStore.getState().weekSaves['1'].placements?.map((p) => p.taskId).sort()).toEqual(['c-ghost', 'c-real']);

    // Réimport CSV : c-ghost disparaît de allCourses.
    useProjectStore.setState({ allCourses: [makeCourse('c-real', 1)] });

    usePlanningStore.getState().setSelectedWeek(2);
    usePlanningStore.getState().setSelectedWeek(1);

    expect(usePlanningStore.getState().placements.map((p) => p.taskId)).toEqual(['c-real']);

    // Ne repart pas en sauvegarde : un déclenchement de save ultérieur ne doit plus contenir le fantôme.
    usePlanningStore.getState().handleBlockedZoneAdd(new Date('2026-09-07T08:00:00Z'), new Date('2026-09-07T09:00:00Z'));
    expect(useProjectStore.getState().weekSaves['1'].placements?.map((p) => p.taskId)).toEqual(['c-real']);
  });

  it("3bis. aucun cours résolu pour la semaine : on n'élague RIEN plutôt que de tout effacer", () => {
    // « Aucun cours connu » recouvre deux situations indiscernables ici — la semaine n'a
    // réellement aucun cours, ou `allCourses` n'est pas encore disponible. Élaguer sans garde
    // effacerait silencieusement tous les placements et non-placés persistés dans le second cas.
    useProjectStore.setState({ allCourses: [makeCourse('c-real', 1)] });
    usePlanningStore.getState().setSelectedWeek(1);
    usePlanningStore.setState({
      placements: [
        { placementId: 'c-real', taskId: 'c-real', startTime: 120, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' },
      ],
      unplaced: [{ taskId: 'c-real', origin: 'engine' }],
    });

    // allCourses vidé (hydratation pas encore faite, par exemple).
    useProjectStore.setState({ allCourses: [] });
    usePlanningStore.getState().setSelectedWeek(2);
    usePlanningStore.getState().setSelectedWeek(1);

    expect(usePlanningStore.getState().placements.map((p) => p.taskId)).toEqual(['c-real']);
    expect(usePlanningStore.getState().unplaced.map((u) => u.taskId)).toEqual(['c-real']);
  });

  it('4. déduplication : un cours à la fois imposé et présent dans les placements persistés → une seule entrée, l\'imposition l\'emporte', () => {
    useProjectStore.setState({ allCourses: [makeCourse('c1', 1)] });
    useProjectStore.getState().saveWeek({
      weekNumber: 1,
      schoolYear: '2026-2027',
      savedAt: Date.now(),
      taskGroups: [],
      manualBlockedZones: [],
      preNeutralizedKeys: [],
      manualEnforcedMap: { c1: { startTime: 60, teacher: ['T1'], groups: [], rooms: [] } },
      manualCourses: [],
      // Reliquat incohérent délibéré : un placement persisté pour le même taskId, à un autre créneau.
      placements: [{ placementId: 'c1', taskId: 'c1', startTime: 999, resources: { teachers: ['TX'], groups: [], rooms: [] }, origin: 'post-enforced' }],
      unplaced: [],
    });

    usePlanningStore.getState().setSelectedWeek(1);

    const placements = usePlanningStore.getState().placements;
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ taskId: 'c1', origin: 'pre-enforced', startTime: 60 });
  });

  it('5. lastRun restauré permet à resetCurrentSolution de fonctionner sans scheduleResult (rechargement simulé)', () => {
    useProjectStore.setState({ allCourses: [makeCourse('c2', 1)] });
    const lastRun = {
      placements: [{ placementId: 'c2', taskId: 'c2', startTime: 100, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' as const }],
      unplaced: [{ taskId: 'c5', origin: 'engine' as const, diagnostics: { reason: 'x', failureCount: 1, eliminationRound: 0 } }],
    };
    useProjectStore.getState().saveWeek({
      weekNumber: 1,
      schoolYear: '2026-2027',
      savedAt: Date.now(),
      taskGroups: [],
      manualBlockedZones: [],
      preNeutralizedKeys: [],
      manualEnforcedMap: {},
      manualCourses: [],
      lastRun,
    });

    usePlanningStore.getState().setSelectedWeek(1);
    expect(usePlanningStore.getState().lastRun).toEqual(lastRun);
    expect(usePlanningStore.getState().scheduleResult).toBeNull();

    // Une retouche modifie l'affichage...
    usePlanningStore.setState({ placements: [{ placementId: 'c2', taskId: 'c2', startTime: 500, resources: { teachers: [], groups: [], rooms: [] }, origin: 'post-enforced' }] });

    // ... "↺ Réinitialiser" doit fonctionner sans scheduleResult, en lisant lastRun.
    usePlanningStore.getState().resetCurrentSolution();
    expect(usePlanningStore.getState().placements).toEqual(lastRun.placements);
    expect(usePlanningStore.getState().unplaced).toEqual(lastRun.unplaced);
  });

  it('6. un snapshot ancien (sans placements/unplaced/lastRun) se lit sans erreur, avec des listes vides', () => {
    useProjectStore.setState({ allCourses: [makeCourse('c1', 1)] });
    useProjectStore.getState().saveWeek({
      weekNumber: 1,
      schoolYear: '2026-2027',
      savedAt: Date.now(),
      taskGroups: [],
      manualBlockedZones: [],
      preNeutralizedKeys: [],
      manualEnforcedMap: {},
      manualCourses: [],
      // placements/unplaced/lastRun volontairement absents (snapshot d'avant ce chantier).
    });

    expect(() => usePlanningStore.getState().setSelectedWeek(1)).not.toThrow();
    expect(usePlanningStore.getState().placements).toEqual([]);
    expect(usePlanningStore.getState().unplaced).toEqual([]);
    expect(usePlanningStore.getState().lastRun).toBeNull();
  });

  it("7. une semaine sans préparation mais avec des placements est sauvegardée (garde du §4.2)", () => {
    useProjectStore.setState({ allCourses: [makeCourse('c1', 7)] });
    usePlanningStore.getState().setSelectedWeek(7);
    expect(useProjectStore.getState().hasWeekSave(7)).toBe(false);

    usePlanningStore.setState({
      placements: [{ placementId: 'c1', taskId: 'c1', startTime: 60, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' }],
    });

    expect(useProjectStore.getState().hasWeekSave(7)).toBe(true);
    expect(useProjectStore.getState().weekSaves['7'].placements).toHaveLength(1);
  });

  it('8. ajouter une zone bloquée par-dessus un placement ne le supprime pas (§4.5)', () => {
    useProjectStore.setState({ allCourses: [makeCourse('c1', 1)] });
    usePlanningStore.getState().setSelectedWeek(1);
    const placement = { placementId: 'c1', taskId: 'c1', startTime: 60, resources: { teachers: [], groups: [], rooms: [] }, origin: 'auto' as const };
    usePlanningStore.setState({
      placements: [placement],
      scheduleResult: { solution: { isComplete: true, tasks: [] }, week: 1 },
    });

    usePlanningStore.getState().handleBlockedZoneAdd(new Date('2026-09-07T08:00:00Z'), new Date('2026-09-07T09:00:00Z'));

    expect(usePlanningStore.getState().placements).toEqual([placement]);
    expect(usePlanningStore.getState().scheduleResult).not.toBeNull();

    usePlanningStore.getState().handleBlockedZoneMove(usePlanningStore.getState().blockedZones[0]!.id, new Date('2026-09-07T09:00:00Z'), new Date('2026-09-07T10:00:00Z'));
    expect(usePlanningStore.getState().placements).toEqual([placement]);
    expect(usePlanningStore.getState().scheduleResult).not.toBeNull();
  });
});
