import { describe, it, expect } from 'vitest';
import type { CourseTaskData, EnforcedData } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { PreparedWeekSnapshot } from '@/store/slices/weekSavesSlice';
import type { TaskGroupConfig } from '@/lib/taskGroupUtils';
import {
  relevantSourceCourseIds,
  matchCoursesForCopy,
  buildEnforcedCopyItems,
  buildGroupCopyItems,
  buildNewEnforcedMap,
  buildNeutralizedCopyItems,
} from '@/lib/copyWeekPrep';

function course(id: string, overrides: Partial<CourseTaskData> = {}): CourseTaskDataWithId {
  return {
    id,
    source: 'csv',
    week: 37,
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

function enforced(overrides: Partial<EnforcedData> = {}): EnforcedData {
  return { startTime: 480, teacher: ['DUPONT'], groups: ['G1'], rooms: ['A101'], ...overrides };
}

function snapshot(overrides: Partial<PreparedWeekSnapshot> = {}): PreparedWeekSnapshot {
  return {
    weekNumber: 37,
    schoolYear: '2025-2026',
    savedAt: 0,
    taskGroups: [],
    manualBlockedZones: [],
    preNeutralizedKeys: [],
    manualEnforcedMap: {},
    manualCourses: [],
    ...overrides,
  };
}

describe('relevantSourceCourseIds', () => {
  it('retourne un tableau vide sans snapshot', () => {
    expect(relevantSourceCourseIds(undefined)).toEqual([]);
  });

  it("unionne les clés enforced et les membres de groupes, sans doublon, ordre déterministe", () => {
    const snap = snapshot({
      manualEnforcedMap: { a: enforced(), b: enforced() },
      taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['b', 'c'] }],
    });
    expect(relevantSourceCourseIds(snap)).toEqual(['a', 'b', 'c']);
  });

  it('ajoute les neutralisés en queue, après enforced et groupes, sans doublon', () => {
    const snap = snapshot({
      manualEnforcedMap: { a: enforced(), b: enforced() },
      taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['b', 'c'] }],
      preNeutralizedKeys: ['c', 'd', 'a'],
    });
    expect(relevantSourceCourseIds(snap)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('matchCoursesForCopy', () => {
  it('apparie un cours source à son similaire en destination (semaine différente)', () => {
    const src = [course('s1', { week: 37 })];
    const dst = [course('d1', { week: 38 })];
    const m = matchCoursesForCopy(['s1'], src, dst);
    expect(m.get('s1')).toBe('d1');
  });

  it('renvoie null quand aucun similaire n\'existe en destination', () => {
    const src = [course('s1', { week: 37, code: 'R101' })];
    const dst = [course('d1', { week: 38, code: 'R999' })];
    const m = matchCoursesForCopy(['s1'], src, dst);
    expect(m.get('s1')).toBeNull();
  });

  it('doublons interchangeables : consomme un candidat destination différent par source, jamais deux fois le même', () => {
    const src = [course('s1', { week: 37 }), course('s2', { week: 37 })];
    const dst = [course('d1', { week: 38 }), course('d2', { week: 38 })];
    const m = matchCoursesForCopy(['s1', 's2'], src, dst);
    const matched = [m.get('s1'), m.get('s2')];
    expect(matched).toContain('d1');
    expect(matched).toContain('d2');
    expect(m.get('s1')).not.toBe(m.get('s2'));
  });

  it('plus de sources que de destinations similaires : les surnuméraires reçoivent null', () => {
    const src = [course('s1', { week: 37 }), course('s2', { week: 37 })];
    const dst = [course('d1', { week: 38 })];
    const m = matchCoursesForCopy(['s1', 's2'], src, dst);
    const values = [m.get('s1'), m.get('s2')];
    expect(values.filter((v) => v === 'd1')).toHaveLength(1);
    expect(values.filter((v) => v === null)).toHaveLength(1);
  });

  it('un cours source id introuvable (référence orpheline) reçoit null sans planter', () => {
    const m = matchCoursesForCopy(['ghost'], [], [course('d1', { week: 38 })]);
    expect(m.get('ghost')).toBeNull();
  });
});

describe('buildEnforcedCopyItems', () => {
  it('marque copiable un cours enforced avec un similaire libre en destination', () => {
    const src = [course('s1', { week: 37 })];
    const dst = [course('d1', { week: 38 })];
    const snap = snapshot({ manualEnforcedMap: { s1: enforced() } });
    const matches = matchCoursesForCopy(['s1'], src, dst);
    const items = buildEnforcedCopyItems(snap, matches, {}, dst, src);
    expect(items).toHaveLength(1);
    expect(items[0].copiable).toBe(true);
    expect(items[0].destCourseId).toBe('d1');
  });

  it('marque non copiable (déjà imposé) un cours dont le similaire est déjà enforced en destination', () => {
    const src = [course('s1', { week: 37 })];
    const dst = [course('d1', { week: 38 })];
    const snap = snapshot({ manualEnforcedMap: { s1: enforced() } });
    const matches = matchCoursesForCopy(['s1'], src, dst);
    const items = buildEnforcedCopyItems(snap, matches, { d1: enforced({ startTime: 600 }) }, dst, src);
    expect(items[0].alreadyEnforcedInDest).toBe(true);
    expect(items[0].copiable).toBe(false);
  });

  it('marque non copiable un cours sans similaire en destination', () => {
    const src = [course('s1', { week: 37, code: 'R101' })];
    const dst = [course('d1', { week: 38, code: 'R999' })];
    const snap = snapshot({ manualEnforcedMap: { s1: enforced() } });
    const matches = matchCoursesForCopy(['s1'], src, dst);
    const items = buildEnforcedCopyItems(snap, matches, {}, dst, src);
    expect(items[0].destCourseId).toBeNull();
    expect(items[0].copiable).toBe(false);
  });

  it('signale roomMismatch quand la salle imposée en S n\'est pas une alternative du cours en D, mais reste copiable', () => {
    const src = [course('s1', { week: 37, rooms: ['A101'] })];
    const dst = [course('d1', { week: 38, rooms: ['B202'] })];
    const snap = snapshot({ manualEnforcedMap: { s1: enforced({ rooms: ['A101'] }) } });
    const matches = matchCoursesForCopy(['s1'], src, dst);
    const items = buildEnforcedCopyItems(snap, matches, {}, dst, src);
    expect(items[0].roomMismatch).toBe(true);
    expect(items[0].copiable).toBe(true);
  });

  it('ignore silencieusement une référence enforced orpheline (cours source supprimé depuis)', () => {
    const snap = snapshot({ manualEnforcedMap: { ghost: enforced() } });
    const matches = matchCoursesForCopy(['ghost'], [], []);
    const items = buildEnforcedCopyItems(snap, matches, {}, [], []);
    expect(items).toHaveLength(0);
  });

  it('retourne un tableau vide sans snapshot source', () => {
    expect(buildEnforcedCopyItems(undefined, new Map(), {}, [], [])).toEqual([]);
  });
});

describe('buildGroupCopyItems', () => {
  it('marque copiable un groupe dont tous les membres ont un similaire libre en destination', () => {
    const src = [course('s1', { week: 37, code: 'A' }), course('s2', { week: 37, code: 'B' })];
    const dst = [course('d1', { week: 38, code: 'A' }), course('d2', { week: 38, code: 'B' })];
    const snap = snapshot({ taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['s1', 's2'] }] });
    const matches = matchCoursesForCopy(['s1', 's2'], src, dst);
    const items = buildGroupCopyItems(snap, matches, []);
    expect(items[0].copiable).toBe(true);
    expect(items[0].memberDestIds).toEqual(['d1', 'd2']);
  });

  it("marque non copiable un groupe si un seul membre n'a pas de similaire", () => {
    const src = [course('s1', { week: 37, code: 'A' }), course('s2', { week: 37, code: 'B' })];
    const dst = [course('d1', { week: 38, code: 'A' })]; // pas de similaire pour B
    const snap = snapshot({ taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['s1', 's2'] }] });
    const matches = matchCoursesForCopy(['s1', 's2'], src, dst);
    const items = buildGroupCopyItems(snap, matches, []);
    expect(items[0].copiable).toBe(false);
    expect(items[0].memberDestIds).toBeNull();
  });

  it('marque non copiable (déjà dans un groupe) si un membre destination appartient déjà à un autre groupe en D', () => {
    const src = [course('s1', { week: 37, code: 'A' }), course('s2', { week: 37, code: 'B' })];
    const dst = [course('d1', { week: 38, code: 'A' }), course('d2', { week: 38, code: 'B' })];
    const snap = snapshot({ taskGroups: [{ id: 'g1', type: 'parallel', courseKeys: ['s1', 's2'] }] });
    const matches = matchCoursesForCopy(['s1', 's2'], src, dst);
    const existingDestGroups: TaskGroupConfig[] = [{ id: 'gExisting', type: 'parallel', courseKeys: ['d1', 'dX'] }];
    const items = buildGroupCopyItems(snap, matches, existingDestGroups);
    expect(items[0].alreadyGroupedInDest).toBe(true);
    expect(items[0].copiable).toBe(false);
  });
});

describe('buildNeutralizedCopyItems', () => {
  it('marque copiable une tâche neutralisée avec un similaire libre en destination', () => {
    const src = [course('s1', { week: 37 })];
    const dst = [course('d1', { week: 38 })];
    const snap = snapshot({ preNeutralizedKeys: ['s1'] });
    const matches = matchCoursesForCopy(['s1'], src, dst);
    const items = buildNeutralizedCopyItems(snap, matches, new Set(), src);
    expect(items).toHaveLength(1);
    expect(items[0].copiable).toBe(true);
    expect(items[0].destCourseId).toBe('d1');
  });

  it("marque non copiable, destCourseId null, quand aucun similaire n'existe en destination", () => {
    const src = [course('s1', { week: 37, code: 'R101' })];
    const dst = [course('d1', { week: 38, code: 'R999' })];
    const snap = snapshot({ preNeutralizedKeys: ['s1'] });
    const matches = matchCoursesForCopy(['s1'], src, dst);
    const items = buildNeutralizedCopyItems(snap, matches, new Set(), src);
    expect(items[0].destCourseId).toBeNull();
    expect(items[0].copiable).toBe(false);
  });

  it('marque non copiable, alreadyNeutralizedInDest true, quand le cours destination est déjà neutralisé en D', () => {
    const src = [course('s1', { week: 37 })];
    const dst = [course('d1', { week: 38 })];
    const snap = snapshot({ preNeutralizedKeys: ['s1'] });
    const matches = matchCoursesForCopy(['s1'], src, dst);
    const items = buildNeutralizedCopyItems(snap, matches, new Set(['d1']), src);
    expect(items[0].alreadyNeutralizedInDest).toBe(true);
    expect(items[0].copiable).toBe(false);
  });

  // Le set reçu ne porte QUE les `user-pre` de D : un `engine`/`user-post` est volatil
  // (`handleEnforceChange` l'efface), le compter comme « déjà non placé » perdrait la
  // neutralisation. Voir le test de promotion dans unplacedPersistence.test.ts.
  it('reste copiable quand le cours destination est non placé pour une autre raison (hors user-pre)', () => {
    const src = [course('s1', { week: 37 })];
    const dst = [course('d1', { week: 38 })];
    const snap = snapshot({ preNeutralizedKeys: ['s1'] });
    const matches = matchCoursesForCopy(['s1'], src, dst);
    const items = buildNeutralizedCopyItems(snap, matches, new Set(), src); // d1 engine-non-placé : absent du set
    expect(items[0].alreadyNeutralizedInDest).toBe(false);
    expect(items[0].copiable).toBe(true);
  });

  it('ignore silencieusement une référence neutralisée orpheline (cours source supprimé depuis)', () => {
    const snap = snapshot({ preNeutralizedKeys: ['ghost'] });
    const matches = matchCoursesForCopy(['ghost'], [], []);
    const items = buildNeutralizedCopyItems(snap, matches, new Set(), []);
    expect(items).toHaveLength(0);
  });

  it('retourne un tableau vide sans snapshot source', () => {
    expect(buildNeutralizedCopyItems(undefined, new Map(), new Set(), [])).toEqual([]);
  });
});

describe('buildNewEnforcedMap', () => {
  it('fusionne uniquement les items sélectionnés dans la carte existante, sans la muter', () => {
    const current = { existing: enforced() };
    const items = [
      { sourceCourseId: 's1', sourceCourse: course('s1'), enforcedData: enforced({ startTime: 600 }), destCourseId: 'd1', alreadyEnforcedInDest: false, copiable: true, roomMismatch: false },
    ];
    const next = buildNewEnforcedMap(current, items);
    expect(next).not.toBe(current);
    expect(current).not.toHaveProperty('d1');
    expect(next.existing).toBeDefined();
    expect(next.d1).toEqual(enforced({ startTime: 600 }));
  });

  it('ignore un item sans destCourseId', () => {
    const items = [
      { sourceCourseId: 's1', sourceCourse: course('s1'), enforcedData: enforced(), destCourseId: null, alreadyEnforcedInDest: false, copiable: false, roomMismatch: false },
    ];
    expect(buildNewEnforcedMap({}, items)).toEqual({});
  });
});
