import { describe, it, expect } from 'vitest';
import { Task, type RawScheduleData } from '@edt-ts/scheduler-common';
import { Loader } from '../src/loader.js';

/**
 * §5.2 de docs/PlanStableTaskIds.md — initTasks doit adopter l'id fourni par l'appelant
 * quand il est présent, et retomber sur le format positionnel historique sinon.
 */

const resources: RawScheduleData['resources'] = [
  { resourceType: 'teacher', resources: [{ id: 'T1' }, { id: 'T2' }] },
  { resourceType: 'group', resources: [{ id: 'G1' }] },
  { resourceType: 'room', resources: [] },
];

function baseCourse(overrides: Partial<RawScheduleData['courses'][number]> = {}): RawScheduleData['courses'][number] {
  return {
    week: 10, semester: 1, level: 0, code: 'X1', type: 'CM', name: 'Cours',
    teacher: ['T1'], groups: ['G1'], rooms: [], duration: 60,
    ...overrides,
  };
}

describe('initTasks — identifiant stable fourni par l\'appelant (§5.2)', () => {
  it('cours avec id fourni : task.id vaut exactement cet id, pas le format positionnel', () => {
    Loader.loadFromRawData({
      week: 10, resources,
      courses: [baseCourse({ id: 'k3f9a2' })],
    });
    const units = Loader.tasksManager.getAllUnits() as Task[];
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe('k3f9a2');
  });

  it('cours sans id : format positionnel historique inchangé (code_teachers_groups_counter)', () => {
    Loader.loadFromRawData({
      week: 10, resources,
      courses: [baseCourse()],
    });
    const units = Loader.tasksManager.getAllUnits() as Task[];
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe('X1_T1_G1_1');
  });

  it('mélange avec/sans id dans la même semaine : chacun son régime', () => {
    Loader.loadFromRawData({
      week: 10, resources,
      courses: [
        baseCourse({ id: 'stable-id-1' }),
        baseCourse({ code: 'X2', teacher: ['T2'] }),
      ],
    });
    const units = Loader.tasksManager.getAllUnits() as Task[];
    expect(units).toHaveLength(2);
    const withId = units.find(u => u.code === 'X1')!;
    const withoutId = units.find(u => u.code === 'X2')!;
    expect(withId.id).toBe('stable-id-1');
    expect(withoutId.id).toBe('X2_T2_G1_2');
  });

  it('deux cours avec le même id fourni : initTasks lève une erreur d\'unicité', () => {
    expect(() => Loader.loadFromRawData({
      week: 10, resources,
      courses: [
        baseCourse({ id: 'dup-id' }),
        baseCourse({ code: 'X2', teacher: ['T2'], id: 'dup-id' }),
      ],
    })).toThrow(/identifiant de cours dupliqué.*dup-id/);
  });
});
