import { describe, it, expect } from 'vitest';
import type { CourseTaskData, ResourceGroupData } from '@edt-ts/scheduler-common';
import { csvCourseId, type CourseTaskDataWithId } from '../lib/courseId';
import {
  diffCsvCourses,
  diffCsvResources,
  summarizeCsvDiff,
  type ResourceGroupDataWithStatus,
} from '../lib/csvMerge';

function makeCourse(overrides: Partial<CourseTaskData> = {}): CourseTaskData {
  return {
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

function makeOldCourse(overrides: Partial<CourseTaskDataWithId> = {}): CourseTaskDataWithId {
  const base = makeCourse(overrides);
  const id = overrides.id ?? csvCourseId(base, 1);
  return { ...base, id, source: 'csv' };
}

describe('diffCsvCourses', () => {
  it('salle changée : conservé avec le même id, champs rafraîchis', () => {
    const old = [makeOldCourse({ rooms: ['A101'] })];
    const next = [makeCourse({ rooms: ['B202'] })];
    const diff = diffCsvCourses(old, next);
    expect(diff.kept).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.kept[0].id).toBe(old[0].id);
    expect(diff.kept[0].rooms).toEqual(['B202']);
  });

  it('libellé changé : conservé avec le même id', () => {
    const old = [makeOldCourse({ name: 'Algorithmique' })];
    const next = [makeCourse({ name: 'Algo (renommé)' })];
    const diff = diffCsvCourses(old, next);
    expect(diff.kept).toHaveLength(1);
    expect(diff.kept[0].id).toBe(old[0].id);
    expect(diff.kept[0].name).toBe('Algo (renommé)');
  });

  it('durée changée : removed + added avec des ids distincts', () => {
    const old = [makeOldCourse({ duration: 60 })];
    const next = [makeCourse({ duration: 90 })];
    const diff = diffCsvCourses(old, next);
    expect(diff.kept).toHaveLength(0);
    expect(diff.removed).toHaveLength(1);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed[0].id).toBe(old[0].id);
    expect(diff.added[0].id).not.toBe(old[0].id);
  });

  it('clé nouvelle : ajoutée sans suffixe d\'occurrence', () => {
    const old: CourseTaskDataWithId[] = [];
    const next = [makeCourse({ code: 'R999' })];
    const diff = diffCsvCourses(old, next);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].id).not.toMatch(/_\d+$/);
  });

  it('clé disparue : supprimée, absente de merged', () => {
    const old = [makeOldCourse({ code: 'R101' })];
    const next: CourseTaskData[] = [];
    const diff = diffCsvCourses(old, next);
    expect(diff.removed).toHaveLength(1);
    expect(diff.merged).toHaveLength(0);
  });

  it('doublons 3 -> 2 : les 2 premiers conservés (dans l\'ordre), le 3e supprimé', () => {
    const old = [
      makeOldCourse({ rooms: ['A1'] }),
      makeOldCourse({ rooms: ['A2'] }),
      makeOldCourse({ rooms: ['A3'] }),
    ];
    const next = [makeCourse({ rooms: ['B1'] }), makeCourse({ rooms: ['B2'] })];
    const diff = diffCsvCourses(old, next);
    expect(diff.kept).toHaveLength(2);
    expect(diff.removed).toHaveLength(1);
    expect(diff.kept.map((c) => c.id)).toEqual([old[0].id, old[1].id]);
    expect(diff.removed[0].id).toBe(old[2].id);
  });

  it('doublons 2 -> 4 : 2 conservés, 2 ajoutés avec des suffixes contigus', () => {
    const baseHash = csvCourseId(makeCourse(), 1);
    const old = [
      makeOldCourse({ id: baseHash, rooms: ['A1'] }),
      makeOldCourse({ id: `${baseHash}_2`, rooms: ['A2'] }),
    ];
    const next = [
      makeCourse({ rooms: ['B1'] }),
      makeCourse({ rooms: ['B2'] }),
      makeCourse({ rooms: ['B3'] }),
      makeCourse({ rooms: ['B4'] }),
    ];
    const diff = diffCsvCourses(old, next);
    expect(diff.kept).toHaveLength(2);
    expect(diff.added).toHaveLength(2);
    expect(diff.added.map((c) => c.id).sort()).toEqual([`${baseHash}_3`, `${baseHash}_4`].sort());
  });

  it('doublons avec trou : ancien a hash + hash_3 (hash_2 supprimé manuellement), le nouveau cours ajouté reçoit hash_4, pas hash_2', () => {
    const baseHash = csvCourseId(makeCourse(), 1);
    const old = [
      makeOldCourse({ id: baseHash, rooms: ['A1'] }),
      makeOldCourse({ id: `${baseHash}_3`, rooms: ['A3'] }),
    ];
    const next = [
      makeCourse({ rooms: ['B1'] }),
      makeCourse({ rooms: ['B2'] }),
      makeCourse({ rooms: ['B3'] }),
    ];
    const diff = diffCsvCourses(old, next);
    expect(diff.kept).toHaveLength(2);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].id).toBe(`${baseHash}_4`);
    expect(diff.added[0].id).not.toBe(`${baseHash}_2`);
  });

  it('merged respecte l\'ordre du nouveau CSV, pas l\'ordre groupé par clé', () => {
    const old = [makeOldCourse({ code: 'R101' })];
    const next = [
      makeCourse({ code: 'R202' }),
      makeCourse({ code: 'R101' }),
    ];
    const diff = diffCsvCourses(old, next);
    expect(diff.merged.map((c) => c.code)).toEqual(['R202', 'R101']);
  });

  it('déterminisme : deux appels identiques produisent les mêmes ids', () => {
    const old = [makeOldCourse({ code: 'R101' })];
    const next = [makeCourse({ code: 'R101', rooms: ['B1'] })];
    const diffA = diffCsvCourses(old, next);
    const diffB = diffCsvCourses(old, next);
    expect(diffA.merged.map((c) => c.id)).toEqual(diffB.merged.map((c) => c.id));
  });
});

describe('diffCsvResources', () => {
  function makeResources(teacherIds: string[]): ResourceGroupData[] {
    return [
      { resourceType: 'teacher', resources: teacherIds.map((id) => ({ id })) },
      { resourceType: 'group', resources: [] },
      { resourceType: 'room', resources: [] },
    ];
  }

  it('ressource conservée inchangée (présente des deux côtés)', () => {
    const old = makeResources(['DUPONT']);
    old[0].resources[0].maxDailyMinutes = 240;
    const next = makeResources(['DUPONT']);
    const result = diffCsvResources(old, next);
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources).toEqual([{ id: 'DUPONT', maxDailyMinutes: 240, unused: undefined }]);
  });

  it('nouvelle ressource ajoutée sans flag unused', () => {
    const old = makeResources([]);
    const next = makeResources(['MARTIN']);
    const result = diffCsvResources(old, next);
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources).toEqual([{ id: 'MARTIN' }]);
  });

  it('ressource disparue conservée + unused: true, champs intacts', () => {
    const old = makeResources(['DUPONT']);
    old[0].resources[0].maxDailyMinutes = 180;
    old[0].resources[0].info = 'vacataire';
    const next = makeResources([]);
    const result = diffCsvResources(old, next);
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources).toEqual([{ id: 'DUPONT', maxDailyMinutes: 180, info: 'vacataire', unused: true }]);
  });

  it('sensibilité à la casse : Dupont et DUPONT sont deux ressources distinctes', () => {
    const old = makeResources(['DUPONT']);
    const next = makeResources(['Dupont']);
    const result = diffCsvResources(old, next);
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources.map((r) => r.id).sort()).toEqual(['DUPONT', 'Dupont']);
    expect(teacher.resources.find((r) => r.id === 'DUPONT')?.unused).toBe(true);
    expect(teacher.resources.find((r) => r.id === 'Dupont')?.unused).toBeUndefined();
  });

  it('une ressource unused qui réapparaît retombe (unused effacé)', () => {
    const old: ResourceGroupDataWithStatus[] = [
      { resourceType: 'teacher', resources: [{ id: 'DUPONT', unused: true }] },
      { resourceType: 'group', resources: [] },
      { resourceType: 'room', resources: [] },
    ];
    const next = makeResources(['DUPONT']);
    const result = diffCsvResources(old, next);
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources[0].unused).toBeUndefined();
  });
});

describe('summarizeCsvDiff', () => {
  it('calcule les compteurs par semaine', () => {
    const old = [
      makeOldCourse({ week: 10, code: 'R1' }),
      makeOldCourse({ week: 10, code: 'R2' }),
      makeOldCourse({ week: 12, code: 'R3' }),
    ];
    const next = [
      makeCourse({ week: 10, code: 'R1', rooms: ['B1'] }), // kept (salle changée)
      makeCourse({ week: 10, code: 'R9' }), // added
      // R2 (week 10) et R3 (week 12) disparaissent -> removed
    ];
    const courseDiff = diffCsvCourses(old, next);
    const summary = summarizeCsvDiff(courseDiff, [], diffCsvResources([], []));
    expect(summary.totalKept).toBe(1);
    expect(summary.totalAdded).toBe(1);
    expect(summary.totalRemoved).toBe(2);
    const week10 = summary.perWeek.find((w) => w.week === 10)!;
    expect(week10).toEqual({ week: 10, kept: 1, added: 1, removed: 1 });
    const week12 = summary.perWeek.find((w) => w.week === 12)!;
    expect(week12).toEqual({ week: 12, kept: 0, added: 0, removed: 1 });
  });

  it('resourcesNewlyUnused ne compte que la transition de cet import', () => {
    const oldResources: ResourceGroupDataWithStatus[] = [
      { resourceType: 'teacher', resources: [{ id: 'ALREADY_UNUSED', unused: true }, { id: 'DUPONT' }] },
      { resourceType: 'group', resources: [] },
      { resourceType: 'room', resources: [] },
    ];
    const newResources: ResourceGroupData[] = [
      { resourceType: 'teacher', resources: [] }, // DUPONT et ALREADY_UNUSED disparaissent tous les deux
      { resourceType: 'group', resources: [] },
      { resourceType: 'room', resources: [] },
    ];
    const resourceDiff = diffCsvResources(oldResources, newResources);
    const summary = summarizeCsvDiff({ merged: [], kept: [], added: [], removed: [] }, oldResources, resourceDiff);
    expect(summary.resourcesNewlyUnused.map((r) => r.id)).toEqual(['DUPONT']);
  });
});
