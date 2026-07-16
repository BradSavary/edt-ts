import { describe, it, expect } from 'vitest';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { courseIdentityKey, courseSimilarityKey, assignCsvCourseIds, manualCourseId, buildCourseMap } from '../lib/courseId';

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

describe('courseIdentityKey', () => {
  it('deux cours identiques sauf la salle ont la même clé (salle exclue)', () => {
    const a = makeCourse({ rooms: ['A101'] });
    const b = makeCourse({ rooms: ['B202'] });
    expect(courseIdentityKey(a)).toBe(courseIdentityKey(b));
  });

  it('deux cours identiques sauf le libellé ont la même clé (name exclu)', () => {
    const a = makeCourse({ name: 'Algorithmique' });
    const b = makeCourse({ name: 'Algo (renommé)' });
    expect(courseIdentityKey(a)).toBe(courseIdentityKey(b));
  });

  it('deux cours identiques sauf semestre/niveau ont la même clé (métadonnées exclues)', () => {
    const a = makeCourse({ semester: 1, level: 0 });
    const b = makeCourse({ semester: 3, level: 1 });
    expect(courseIdentityKey(a)).toBe(courseIdentityKey(b));
  });

  it('une durée différente change la clé (doivent être distingués)', () => {
    const a = makeCourse({ duration: 60 });
    const b = makeCourse({ duration: 90 });
    expect(courseIdentityKey(a)).not.toBe(courseIdentityKey(b));
  });

  it('un enseignant différent change la clé', () => {
    const a = makeCourse({ teacher: ['DUPONT'] });
    const b = makeCourse({ teacher: ['MARTIN'] });
    expect(courseIdentityKey(a)).not.toBe(courseIdentityKey(b));
  });

  it('des groupes différents changent la clé', () => {
    const a = makeCourse({ groups: ['G1'] });
    const b = makeCourse({ groups: ['G2'] });
    expect(courseIdentityKey(a)).not.toBe(courseIdentityKey(b));
  });

  it("une semaine, un code ou un type différent changent la clé", () => {
    const base = makeCourse();
    expect(courseIdentityKey(base)).not.toBe(courseIdentityKey(makeCourse({ week: 45 })));
    expect(courseIdentityKey(base)).not.toBe(courseIdentityKey(makeCourse({ code: 'R102' })));
    expect(courseIdentityKey(base)).not.toBe(courseIdentityKey(makeCourse({ type: 'TP' })));
  });

  it("l'ordre des enseignants/groupes n'a pas d'importance (listes triées)", () => {
    const a = makeCourse({ teacher: ['DUPONT', 'MARTIN'], groups: ['G1', 'G2'] });
    const b = makeCourse({ teacher: ['MARTIN', 'DUPONT'], groups: ['G2', 'G1'] });
    expect(courseIdentityKey(a)).toBe(courseIdentityKey(b));
  });
});

describe('courseSimilarityKey', () => {
  it('deux cours identiques sauf la semaine sont similaires', () => {
    const a = makeCourse({ week: 37 });
    const b = makeCourse({ week: 38 });
    expect(courseSimilarityKey(a)).toBe(courseSimilarityKey(b));
  });

  it('un code, type, durée, enseignant ou groupe différent casse la similarité (semaine identique par ailleurs)', () => {
    const base = makeCourse({ week: 37 });
    const other = makeCourse({ week: 38 });
    expect(courseSimilarityKey(base)).not.toBe(courseSimilarityKey({ ...other, code: 'R102' }));
    expect(courseSimilarityKey(base)).not.toBe(courseSimilarityKey({ ...other, type: 'TP' }));
    expect(courseSimilarityKey(base)).not.toBe(courseSimilarityKey({ ...other, duration: 90 }));
    expect(courseSimilarityKey(base)).not.toBe(courseSimilarityKey({ ...other, teacher: ['MARTIN'] }));
    expect(courseSimilarityKey(base)).not.toBe(courseSimilarityKey({ ...other, groups: ['G2'] }));
  });

  it('la salle et le libellé restent exclus, comme pour courseIdentityKey', () => {
    const a = makeCourse({ week: 37, rooms: ['A101'], name: 'Algorithmique' });
    const b = makeCourse({ week: 38, rooms: ['B202'], name: 'Algo (renommé)' });
    expect(courseSimilarityKey(a)).toBe(courseSimilarityKey(b));
  });
});

describe('assignCsvCourseIds', () => {
  it('deux cours interchangeables (même clé, salles différentes) reçoivent le même hash de base + suffixe d\'occurrence', () => {
    const courses = [makeCourse({ rooms: ['A101'] }), makeCourse({ rooms: ['B202'] })];
    const [first, second] = assignCsvCourseIds(courses);
    const baseHash = first.id;
    expect(second.id).toBe(`${baseHash}_2`);
  });

  it('assigne source: csv à tous les cours', () => {
    const [course] = assignCsvCourseIds([makeCourse()]);
    expect(course.source).toBe('csv');
  });

  it('deux cours de durée différente reçoivent des ids distincts sans suffixe', () => {
    const courses = [makeCourse({ duration: 60 }), makeCourse({ duration: 90 })];
    const [first, second] = assignCsvCourseIds(courses);
    expect(first.id).not.toBe(second.id);
    expect(first.id).not.toMatch(/_\d+$/);
    expect(second.id).not.toMatch(/_\d+$/);
  });

  it('id stable et déterministe : même cours -> même id sur deux appels distincts', () => {
    const course = makeCourse();
    const [a] = assignCsvCourseIds([course]);
    const [b] = assignCsvCourseIds([course]);
    expect(a.id).toBe(b.id);
  });
});

describe('manualCourseId', () => {
  it('génère des ids uniques préfixés m_', () => {
    const a = manualCourseId();
    const b = manualCourseId();
    expect(a).toMatch(/^m_/);
    expect(a).not.toBe(b);
  });
});

describe('buildCourseMap', () => {
  it('indexe les cours par id', () => {
    const [course] = assignCsvCourseIds([makeCourse()]);
    const map = buildCourseMap([course]);
    expect(map.get(course.id)).toBe(course);
  });
});
