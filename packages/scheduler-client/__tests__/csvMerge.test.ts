import { describe, it, expect } from 'vitest';
import type { CourseTaskData, ResourceGroupData } from '@edt-ts/scheduler-common';
import { csvCourseId, type CourseTaskDataWithId } from '../lib/courseId';
import {
  diffCsvCourses,
  diffCsvResources,
  summarizeCsvDiff,
  type ResourceDataWithStatus,
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

  it('clé disparue d\'une semaine du périmètre : supprimée, absente de merged', () => {
    const old = [makeOldCourse({ code: 'R101' })];
    // La semaine reste dans le périmètre (le CSV y apporte un autre cours), donc R101 est
    // bien vu comme disparu. Un CSV vide, lui, ne supprimerait rien — cf. « périmètre de l'import ».
    const next: CourseTaskData[] = [makeCourse({ code: 'R999' })];
    const diff = diffCsvCourses(old, next);
    expect(diff.removed.map((c) => c.code)).toEqual(['R101']);
    expect(diff.merged.map((c) => c.code)).toEqual(['R999']);
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

describe('diffCsvCourses — périmètre de l\'import', () => {
  it('cours d\'une semaine absente du CSV : ni kept ni removed, repris tel quel dans merged', () => {
    const horsPerimetre = makeOldCourse({ week: 40, code: 'HORS' });
    const old = [horsPerimetre, makeOldCourse({ week: 44, code: 'DANS' })];
    const next = [makeCourse({ week: 44, code: 'DANS', rooms: ['B202'] })];

    const diff = diffCsvCourses(old, next);

    expect(diff.untouched).toEqual([horsPerimetre]);
    expect(diff.removed).toEqual([]);
    expect(diff.kept.map((c) => c.code)).toEqual(['DANS']);
    // Référence d'objet strictement préservée : rien n'a été recopié ni recalculé.
    expect(diff.merged).toContain(horsPerimetre);
    expect(diff.merged.map((c) => c.code).sort()).toEqual(['DANS', 'HORS']);
  });

  it('CSV n\'apportant qu\'une semaine : les autres survivent même sans aucune correspondance', () => {
    const old = [
      makeOldCourse({ week: 40, code: 'A' }),
      makeOldCourse({ week: 41, code: 'B' }),
      makeOldCourse({ week: 44, code: 'C' }),
    ];
    const next = [makeCourse({ week: 44, code: 'Z' })]; // C disparaît, A et B sont hors périmètre

    const diff = diffCsvCourses(old, next);

    expect(diff.removed.map((c) => c.code)).toEqual(['C']);
    expect(diff.untouched.map((c) => c.code).sort()).toEqual(['A', 'B']);
    expect(diff.merged.map((c) => c.code).sort()).toEqual(['A', 'B', 'Z']);
  });

  it('CSV sans aucun cours : périmètre vide, projet strictement inchangé', () => {
    const old = [makeOldCourse({ week: 40 }), makeOldCourse({ week: 44 })];

    const diff = diffCsvCourses(old, []);

    expect(diff.removed).toEqual([]);
    expect(diff.kept).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.merged).toEqual(old);
  });

  it('une semaine vidée dans le fichier source n\'est plus vidée dans le projet (contrepartie assumée)', () => {
    const old = [makeOldCourse({ week: 40, code: 'A' }), makeOldCourse({ week: 44, code: 'C' })];
    const next = [makeCourse({ week: 44, code: 'C' })]; // S40 n'a plus d'heures dans le fichier

    const diff = diffCsvCourses(old, next);

    expect(diff.merged.map((c) => c.code).sort()).toEqual(['A', 'C']);
  });

  it('ordre intra-semaine préservé des deux côtés du périmètre', () => {
    const old = [
      makeOldCourse({ week: 40, code: 'H1' }),
      makeOldCourse({ week: 40, code: 'H2' }),
      makeOldCourse({ week: 44, code: 'D1' }),
    ];
    const next = [makeCourse({ week: 44, code: 'D2' }), makeCourse({ week: 44, code: 'D1' })];

    const diff = diffCsvCourses(old, next);

    expect(diff.merged.filter((c) => c.week === 40).map((c) => c.code)).toEqual(['H1', 'H2']);
    expect(diff.merged.filter((c) => c.week === 44).map((c) => c.code)).toEqual(['D2', 'D1']);
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

  /** Cours du projet APRÈS fusion : c'est eux, et non le CSV, qui décident du flag `unused`. */
  function coursesWithTeachers(teacherIds: string[]): CourseTaskData[] {
    return teacherIds.map((id, i) => makeCourse({ teacher: [id], code: `R${i}`, groups: [], rooms: [] }));
  }

  it('ressource conservée inchangée (présente des deux côtés)', () => {
    const old = makeResources(['DUPONT']);
    old[0].resources[0].maxDailyMinutes = 240;
    const next = makeResources(['DUPONT']);
    const result = diffCsvResources(old, next, coursesWithTeachers(['DUPONT']));
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources).toEqual([{ id: 'DUPONT', maxDailyMinutes: 240, unused: undefined }]);
  });

  it('weeklyMaxDailyMinutes survit à une fusion (ressource appariée)', () => {
    const old = makeResources(['DUPONT']);
    old[0].resources[0].maxDailyMinutes = 240;
    (old[0].resources[0] as ResourceDataWithStatus).weeklyMaxDailyMinutes = { S40: 120 };
    const next = makeResources(['DUPONT']);
    const result = diffCsvResources(old, next, coursesWithTeachers(['DUPONT']));
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources).toEqual([
      { id: 'DUPONT', maxDailyMinutes: 240, weeklyMaxDailyMinutes: { S40: 120 }, unused: undefined },
    ]);
  });

  it('weeklyMaxDailyMinutes survit aussi sur une ressource devenue unused', () => {
    const old = makeResources(['DUPONT']);
    (old[0].resources[0] as ResourceDataWithStatus).weeklyMaxDailyMinutes = { S40: 120 };
    const next = makeResources([]);
    const result = diffCsvResources(old, next, coursesWithTeachers([]));
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources).toEqual([
      { id: 'DUPONT', weeklyMaxDailyMinutes: { S40: 120 }, unused: true },
    ]);
  });

  it('nouvelle ressource ajoutée sans flag unused', () => {
    const old = makeResources([]);
    const next = makeResources(['MARTIN']);
    const result = diffCsvResources(old, next, coursesWithTeachers(['MARTIN']));
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources).toEqual([{ id: 'MARTIN' }]);
  });

  it('ressource disparue conservée + unused: true, champs intacts', () => {
    const old = makeResources(['DUPONT']);
    old[0].resources[0].maxDailyMinutes = 180;
    old[0].resources[0].info = 'vacataire';
    const next = makeResources([]);
    const result = diffCsvResources(old, next, coursesWithTeachers([]));
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources).toEqual([{ id: 'DUPONT', maxDailyMinutes: 180, info: 'vacataire', unused: true }]);
  });

  it('sensibilité à la casse : Dupont et DUPONT sont deux ressources distinctes', () => {
    const old = makeResources(['DUPONT']);
    const next = makeResources(['Dupont']);
    const result = diffCsvResources(old, next, coursesWithTeachers(['Dupont']));
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
    const result = diffCsvResources(old, next, coursesWithTeachers(['DUPONT']));
    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources[0].unused).toBeUndefined();
  });
});

describe('diffCsvResources — import partiel', () => {
  it('ressource utilisée seulement hors périmètre : jamais marquée unused', () => {
    const old: ResourceGroupDataWithStatus[] = [
      { resourceType: 'teacher', resources: [{ id: 'DUPONT' }, { id: 'MARTIN' }] },
      { resourceType: 'group', resources: [] },
      { resourceType: 'room', resources: [] },
    ];
    // Le CSV ne couvre que S44 et n'y cite que MARTIN ; DUPONT enseigne encore en S40.
    const csvResources: ResourceGroupData[] = [
      { resourceType: 'teacher', resources: [{ id: 'MARTIN' }] },
      { resourceType: 'group', resources: [] },
      { resourceType: 'room', resources: [] },
    ];
    const finalCourses = [
      makeCourse({ week: 40, teacher: ['DUPONT'] }),
      makeCourse({ week: 44, teacher: ['MARTIN'] }),
    ];

    const result = diffCsvResources(old, csvResources, finalCourses);

    const teacher = result.find((g) => g.resourceType === 'teacher')!;
    expect(teacher.resources.find((r) => r.id === 'DUPONT')?.unused).toBeUndefined();
    expect(teacher.resources.find((r) => r.id === 'MARTIN')?.unused).toBeUndefined();
  });

  it('salle citée en alternative compte comme utilisée', () => {
    const old: ResourceGroupDataWithStatus[] = [
      { resourceType: 'teacher', resources: [] },
      { resourceType: 'group', resources: [] },
      { resourceType: 'room', resources: [{ id: 'A101' }, { id: 'B202' }] },
    ];
    const finalCourses = [makeCourse({ rooms: [['A101', 'B202']] })];

    const result = diffCsvResources(old, [], finalCourses);

    const rooms = result.find((g) => g.resourceType === 'room')!;
    expect(rooms.resources.every((r) => r.unused === undefined)).toBe(true);
  });

  it('unused hérité d\'un import antérieur effacé si la ressource sert encore', () => {
    const old: ResourceGroupDataWithStatus[] = [
      { resourceType: 'teacher', resources: [{ id: 'DUPONT', unused: true }] },
      { resourceType: 'group', resources: [] },
      { resourceType: 'room', resources: [] },
    ];

    const result = diffCsvResources(old, [], [makeCourse({ teacher: ['DUPONT'] })]);

    expect(result.find((g) => g.resourceType === 'teacher')!.resources[0].unused).toBeUndefined();
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
      makeCourse({ week: 12, code: 'R8' }), // added — garde la S12 dans le périmètre
      // R2 (week 10) et R3 (week 12) disparaissent -> removed
    ];
    const courseDiff = diffCsvCourses(old, next);
    const summary = summarizeCsvDiff(courseDiff, [], diffCsvResources([], [], []));
    expect(summary.totalKept).toBe(1);
    expect(summary.totalAdded).toBe(2);
    expect(summary.totalRemoved).toBe(2);
    const week10 = summary.perWeek.find((w) => w.week === 10)!;
    expect(week10).toEqual({ week: 10, kept: 1, added: 1, removed: 1 });
    const week12 = summary.perWeek.find((w) => w.week === 12)!;
    expect(week12).toEqual({ week: 12, kept: 0, added: 1, removed: 1 });
  });

  it('expose le périmètre : semaines apportées vs semaines laissées intactes', () => {
    const old = [
      makeOldCourse({ week: 36, code: 'A' }),
      makeOldCourse({ week: 37, code: 'B' }),
      makeOldCourse({ week: 44, code: 'C' }),
    ];
    const next = [makeCourse({ week: 44, code: 'C' }), makeCourse({ week: 45, code: 'D' })];

    const summary = summarizeCsvDiff(diffCsvCourses(old, next), [], diffCsvResources([], [], []));

    expect(summary.scopeWeeks).toEqual([44, 45]);
    expect(summary.untouchedWeeks).toEqual([36, 37]);
    expect(summary.perWeek.map((w) => w.week)).toEqual([44, 45]);
    expect(summary.totalRemoved).toBe(0);
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
    const resourceDiff = diffCsvResources(oldResources, newResources, []);
    const summary = summarizeCsvDiff(
      { merged: [], kept: [], added: [], removed: [], untouched: [] },
      oldResources,
      resourceDiff,
    );
    expect(summary.resourcesNewlyUnused.map((r) => r.id)).toEqual(['DUPONT']);
  });
});
