import { describe, it, expect } from 'vitest';
import { selectPromotionCandidates, enforcedDataFromPlacement } from '../lib/calendar/promotion';
import type { Placement } from '../store/types';
import type { CourseTaskDataWithId } from '../lib/courseId';
import type { TaskGroupConfig } from '../lib/taskGroupUtils';

function course(id: string, overrides: Partial<CourseTaskDataWithId> = {}): CourseTaskDataWithId {
  return {
    id,
    source: 'csv',
    week: 1,
    semester: 1,
    level: 1,
    code: 'R1.01',
    name: 'Cours',
    type: 'CM',
    teacher: ['DUPONT'],
    groups: ['G1'],
    rooms: ['A101'],
    duration: 60,
    ...overrides,
  };
}

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    placementId: 'p1',
    taskId: 'c1',
    startTime: 600,
    origin: 'post-enforced',
    resources: { teachers: ['DUPONT'], groups: ['G1'], rooms: ['A101'] },
    ...overrides,
  };
}

describe('selectPromotionCandidates', () => {
  it('ne retient que les placements post-enforced (auto, pre-enforced absents)', () => {
    const courseById = new Map([
      ['c1', course('c1')],
      ['c2', course('c2')],
      ['c3', course('c3')],
    ]);
    const placements: Placement[] = [
      placement({ placementId: 'c1', taskId: 'c1', origin: 'auto' }),
      placement({ placementId: 'c2', taskId: 'c2', origin: 'pre-enforced' }),
      placement({ placementId: 'c3', taskId: 'c3', origin: 'post-enforced' }),
    ];

    const candidates = selectPromotionCandidates(placements, [], courseById);

    expect(candidates.map((c) => c.taskId)).toEqual(['c3']);
  });

  it('deux placements partageant le taskId -> les deux blockedBy multi-placement', () => {
    const courseById = new Map([['c1', course('c1')]]);
    const placements: Placement[] = [
      placement({ placementId: 'c1-piece-0', taskId: 'c1', startTime: 600 }),
      placement({ placementId: 'c1-piece-1', taskId: 'c1', startTime: 700 }),
    ];

    const candidates = selectPromotionCandidates(placements, [], courseById);

    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.blockedBy === 'multi-placement')).toBe(true);
  });

  it('le comptage porte sur TOUS les placements : un auto + une retouche sur le même taskId bloquent la retouche', () => {
    // Inatteignable aujourd'hui, mais le mode de défaillance serait muet : la retouche serait
    // déclarée promouvable et l'imposition figerait la tâche à un créneau alors qu'un autre de
    // ses placements vit ailleurs.
    const courseById = new Map([['c1', course('c1')]]);
    const placements: Placement[] = [
      placement({ placementId: 'c1-auto', taskId: 'c1', origin: 'auto', startTime: 600 }),
      placement({ placementId: 'c1-retouche', taskId: 'c1', startTime: 700 }),
    ];

    const candidates = selectPromotionCandidates(placements, [], courseById);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].placementId).toBe('c1-retouche');
    expect(candidates[0].blockedBy).toBe('multi-placement');
  });

  it('membre de groupe -> task-group ; non-membre -> promouvable', () => {
    const courseById = new Map([
      ['c1', course('c1')],
      ['c2', course('c2')],
    ]);
    const taskGroups: TaskGroupConfig[] = [{ id: 'g1', type: 'parallel', courseKeys: ['c1', 'other'] }];
    const placements: Placement[] = [
      placement({ placementId: 'c1', taskId: 'c1' }),
      placement({ placementId: 'c2', taskId: 'c2' }),
    ];

    const candidates = selectPromotionCandidates(placements, taskGroups, courseById);

    expect(candidates.find((c) => c.taskId === 'c1')?.blockedBy).toBe('task-group');
    expect(candidates.find((c) => c.taskId === 'c2')?.blockedBy).toBeUndefined();
  });

  it('cumul des deux blocages -> une seule raison, celle de la règle appliquée en premier (multi-placement)', () => {
    const courseById = new Map([['c1', course('c1')]]);
    const taskGroups: TaskGroupConfig[] = [{ id: 'g1', type: 'parallel', courseKeys: ['c1', 'other'] }];
    const placements: Placement[] = [
      placement({ placementId: 'c1-piece-0', taskId: 'c1', startTime: 600 }),
      placement({ placementId: 'c1-piece-1', taskId: 'c1', startTime: 700 }),
    ];

    const candidates = selectPromotionCandidates(placements, taskGroups, courseById);

    expect(candidates.every((c) => c.blockedBy === 'multi-placement')).toBe(true);
  });

  it('cours introuvable -> entrée absente, pas d\'exception', () => {
    const courseById = new Map<string, CourseTaskDataWithId>();
    const placements: Placement[] = [placement({ placementId: 'c1', taskId: 'c1' })];

    expect(() => selectPromotionCandidates(placements, [], courseById)).not.toThrow();
    expect(selectPromotionCandidates(placements, [], courseById)).toEqual([]);
  });

  it('ordre de sortie déterministe : startTime puis taskId', () => {
    const courseById = new Map([
      ['b', course('b')],
      ['a', course('a')],
      ['c', course('c')],
    ]);
    const placements: Placement[] = [
      placement({ placementId: 'b', taskId: 'b', startTime: 600 }),
      placement({ placementId: 'a', taskId: 'a', startTime: 600 }),
      placement({ placementId: 'c', taskId: 'c', startTime: 500 }),
    ];

    const candidates = selectPromotionCandidates(placements, [], courseById);

    expect(candidates.map((c) => c.taskId)).toEqual(['c', 'a', 'b']);
  });
});

describe('enforcedDataFromPlacement', () => {
  it('combo exact, aucun tableau imbriqué', () => {
    const p = placement({
      startTime: 630,
      resources: { teachers: ['DUPONT'], groups: ['G1', 'G2'], rooms: ['A101'] },
    });

    expect(enforcedDataFromPlacement(p)).toEqual({
      startTime: 630,
      teacher: ['DUPONT'],
      groups: ['G1', 'G2'],
      rooms: ['A101'],
    });
  });
});
