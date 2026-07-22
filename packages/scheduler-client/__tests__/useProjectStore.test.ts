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

  it('purge aussi les références à cet id dans weekSaves de la semaine du cours', () => {
    const c1 = makeCourse({ id: 'c1', week: 44 });
    useProjectStore.setState({
      allCourses: [c1],
      weekSaves: {
        '44': makeSnapshot({
          taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['c1'] }],
          manualEnforcedMap: { c1: { teacher: [], groups: [], rooms: [], startTime: 0 } },
        }),
      },
    });
    useProjectStore.getState().removeCourse('c1');
    const snapshot = useProjectStore.getState().weekSaves['44'];
    expect(snapshot.taskGroups).toEqual([]);
    expect(snapshot.manualEnforcedMap).toEqual({});
  });
});

describe('useProjectStore.mergeCsvData', () => {
  it('cours conservé (clé identique, salle changée) : garde son id, manualEnforcedMap/taskGroups intacts', () => {
    useProjectStore.setState({
      allCourses: [makeCourse({ id: 'csv1' })], // week 44, R101, TD, DUPONT, G1, 60min, A101
      resources: makeResources(),
      weekSaves: { '44': makeSnapshot() }, // taskGroups + manualEnforcedMap référencent 'csv1'
    });
    const before = useProjectStore.getState().weekSaves['44'];

    useProjectStore.getState().mergeCsvData(
      [makeCourse({ id: 'ignored-fresh-id', rooms: ['B202'] })],
      makeResources(),
      'nouveau.csv',
    );

    const state = useProjectStore.getState();
    expect(state.allCourses).toHaveLength(1);
    expect(state.allCourses[0].id).toBe('csv1'); // ancien id préservé
    expect(state.allCourses[0].rooms).toEqual(['B202']); // champ rafraîchi
    // Semaine non affectée par une suppression : snapshot strictement inchangé
    expect(state.weekSaves['44']).toBe(before);
  });

  it('cours supprimé : références amputées dans taskGroups/manualEnforcedMap/preNeutralizedKeys', () => {
    useProjectStore.setState({
      allCourses: [makeCourse({ id: 'csv1' })],
      resources: makeResources(),
      weekSaves: {
        '44': makeSnapshot({
          preNeutralizedKeys: ['csv1'],
        }),
      },
    });

    // Nouveau CSV avec un cours totalement différent (aucune correspondance de clé) -> csv1 supprimé
    useProjectStore.getState().mergeCsvData(
      [makeCourse({ id: 'other', code: 'R999' })],
      makeResources(),
      'nouveau.csv',
    );

    const state = useProjectStore.getState();
    expect(state.allCourses.map((c) => c.code)).toEqual(['R999']);
    const snapshot = state.weekSaves['44'];
    expect(snapshot.taskGroups).toEqual([]);
    expect(snapshot.manualEnforcedMap).toEqual({});
    expect(snapshot.preNeutralizedKeys).toEqual([]);
  });

  it('manualCourses jamais touché (même référence), quel que soit le contenu du nouveau CSV', () => {
    const manual = makeCourse({ id: 'm1', source: 'manual', code: 'MANUEL' });
    const manualCourses = [manual];
    useProjectStore.setState({
      allCourses: [makeCourse({ id: 'csv1' })],
      resources: makeResources(),
      weekSaves: { '44': makeSnapshot({ manualCourses }) },
    });

    useProjectStore.getState().mergeCsvData([makeCourse({ code: 'R999' })], makeResources(), 'nouveau.csv');

    expect(useProjectStore.getState().weekSaves['44'].manualCourses).toBe(manualCourses);
  });

  it('ressource disparue : conservée et marquée unused ; nouvelle ressource : ajoutée', () => {
    useProjectStore.setState({
      allCourses: [makeCourse({ id: 'csv1' })],
      resources: makeResources(), // DUPONT / A101 / G1
    });

    useProjectStore.getState().mergeCsvData(
      [makeCourse({ id: 'csv1', teacher: ['MARTIN'] })],
      [
        { resourceType: 'teacher', resources: [{ id: 'MARTIN' }] },
        { resourceType: 'room', resources: [{ id: 'A101' }] },
        { resourceType: 'group', resources: [{ id: 'G1' }] },
      ],
      'nouveau.csv',
    );

    const teacherGroup = useProjectStore.getState().resources.find((g) => g.resourceType === 'teacher')!;
    const dupont = teacherGroup.resources.find((r) => r.id === 'DUPONT');
    const martin = teacherGroup.resources.find((r) => r.id === 'MARTIN');
    expect(dupont?.unused).toBe(true);
    expect(martin?.unused).toBeUndefined();
  });

  it('ne pruner JAMAIS constraints (contrairement à importCsvData)', () => {
    useProjectStore.setState({
      allCourses: [makeCourse({ id: 'csv1' })],
      resources: makeResources(),
      constraints: { Default: [], DUPONT: null, DISPARU: null },
    });

    // DISPARU n'apparaît dans aucune ressource CSV, mais constraints doit rester intact
    useProjectStore.getState().mergeCsvData([makeCourse({ code: 'R999' })], makeResources(), 'nouveau.csv');

    expect(Object.keys(useProjectStore.getState().constraints).sort()).toEqual(['DISPARU', 'DUPONT', 'Default']);
  });

  it('met à jour coursesFileName', () => {
    useProjectStore.setState({ allCourses: [makeCourse({ id: 'csv1' })], resources: makeResources() });
    useProjectStore.getState().mergeCsvData([makeCourse()], makeResources(), 'fusionné.csv');
    expect(useProjectStore.getState().coursesFileName).toBe('fusionné.csv');
  });
});

describe('useProjectStore.setResourceWeeklyMaxDailyMinutes', () => {
  const teacherOf = () =>
    useProjectStore.getState().resources.find((g) => g.resourceType === 'teacher')!.resources[0];

  beforeEach(() => {
    useProjectStore.setState({ resources: makeResources() });
  });

  it('pose une limite sur une seule semaine, sans toucher au défaut', () => {
    useProjectStore.getState().setResourceMaxDailyMinutes('DUPONT', 240);
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('DUPONT', 'S40', 120);

    expect(teacherOf()).toEqual({ id: 'DUPONT', maxDailyMinutes: 240, weeklyMaxDailyMinutes: { S40: 120 } });
  });

  it('plusieurs semaines coexistent', () => {
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('DUPONT', 'S40', 120);
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('DUPONT', 'S41', 180);

    expect(teacherOf().weeklyMaxDailyMinutes).toEqual({ S40: 120, S41: 180 });
  });

  it('undefined supprime la clé de la semaine et laisse les autres', () => {
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('DUPONT', 'S40', 120);
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('DUPONT', 'S41', 180);
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('DUPONT', 'S40', undefined);

    expect(teacherOf().weeklyMaxDailyMinutes).toEqual({ S41: 180 });
  });

  it('dernière semaine supprimée : la clé weeklyMaxDailyMinutes disparaît (pas d\'objet vide persisté)', () => {
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('DUPONT', 'S40', 120);
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('DUPONT', 'S40', undefined);

    expect(teacherOf()).toEqual({ id: 'DUPONT' });
    expect('weeklyMaxDailyMinutes' in teacherOf()).toBe(false);
  });

  it('n\'affecte que la ressource visée', () => {
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('A101', 'S40', 120);

    expect(teacherOf().weeklyMaxDailyMinutes).toBeUndefined();
    const rooms = useProjectStore.getState().resources.find((g) => g.resourceType === 'room')!;
    expect(rooms.resources[0].weeklyMaxDailyMinutes).toEqual({ S40: 120 });
  });
});

/**
 * La limite quotidienne d'une semaine suit sa case à cocher : elle ne doit jamais survivre à
 * la disparition de l'override de disponibilité qui la porte, sinon elle reste appliquée par
 * le moteur alors que l'UI ne l'affiche plus (donc invisible et non modifiable).
 * Trois chemins décochent sans passer par la case — d'où une réconciliation à chaque écriture
 * de `constraints` plutôt qu'une purge par chemin.
 */
describe('limites hebdomadaires orphelines : réconciliation à chaque écriture de constraints', () => {
  const weeklyOf = () =>
    useProjectStore.getState().resources.find((g) => g.resourceType === 'teacher')!.resources[0]
      .weeklyMaxDailyMinutes;

  const slots = [{ days: 'lundi', from: '08:00', to: '18:00' }];

  beforeEach(() => {
    useProjectStore.setState({
      resources: makeResources(),
      constraints: { Default: slots, DUPONT: { default: slots, S40: slots } },
    });
    useProjectStore.getState().setResourceWeeklyMaxDailyMinutes('DUPONT', 'S40', 120);
    expect(weeklyOf()).toEqual({ S40: 120 });
  });

  it('semaine toujours cochée : la limite est conservée', () => {
    useProjectStore.getState().setConstraint('DUPONT', { default: slots, S40: slots, S41: slots });
    expect(weeklyOf()).toEqual({ S40: 120 });
  });

  it('override de la semaine retiré : la limite part avec lui', () => {
    useProjectStore.getState().setConstraint('DUPONT', { default: slots });
    expect(weeklyOf()).toBeUndefined();
  });

  it('toutes les contraintes de la ressource supprimées (setConstraint(null))', () => {
    useProjectStore.getState().setConstraint('DUPONT', null);
    expect(weeklyOf()).toBeUndefined();
  });

  it('deleteConstraint', () => {
    useProjectStore.getState().deleteConstraint('DUPONT');
    expect(weeklyOf()).toBeUndefined();
  });

  it('importConstraints sans la semaine', () => {
    useProjectStore.getState().importConstraints({ Default: slots, DUPONT: { default: slots } });
    expect(weeklyOf()).toBeUndefined();
  });

  it('importConstraints qui conserve la semaine', () => {
    useProjectStore.getState().importConstraints({ Default: slots, DUPONT: { default: slots, S40: slots } });
    expect(weeklyOf()).toEqual({ S40: 120 });
  });

  it('la limite par DÉFAUT de la ressource n\'est jamais purgée (elle ne dépend d\'aucune semaine)', () => {
    useProjectStore.getState().setResourceMaxDailyMinutes('DUPONT', 240);
    useProjectStore.getState().deleteConstraint('DUPONT');

    const teacher = useProjectStore.getState().resources.find((g) => g.resourceType === 'teacher')!.resources[0];
    expect(teacher.maxDailyMinutes).toBe(240);
    expect(teacher.weeklyMaxDailyMinutes).toBeUndefined();
  });

  it('rien d\'orphelin : `resources` garde sa référence (pas de réécriture localStorage ni de rebuild inutile)', () => {
    const before = useProjectStore.getState().resources;
    useProjectStore.getState().setConstraint('AUTRE', { default: slots });
    expect(useProjectStore.getState().resources).toBe(before);
  });
});
