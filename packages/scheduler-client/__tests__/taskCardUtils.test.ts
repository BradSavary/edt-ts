import { describe, it, expect } from 'vitest';
import type { CourseTaskData } from '@edt-ts/scheduler-common';
import { courseToBaseProps } from '../lib/taskCardUtils';

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

describe('courseToBaseProps', () => {
  it('propage le commentaire du cours (icône 💬 des cartes non placées)', () => {
    const props = courseToBaseProps(makeCourse({ comment: 'Attention salle non confirmée' }));
    expect(props.comment).toBe('Attention salle non confirmée');
  });

  it('commentaire absent : reste undefined, pas de chaîne vide', () => {
    const props = courseToBaseProps(makeCourse());
    expect(props.comment).toBeUndefined();
  });
});
