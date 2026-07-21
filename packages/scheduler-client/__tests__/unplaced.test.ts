import { describe, it, expect } from 'vitest';
import type { NeutralizedTaskInfoJSON } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { Placement } from '@/store/types';
import {
  unplacedFromEngine,
  unplacedFromPreNeutralized,
  remainingDuration,
  selectPiocheEntries,
} from '@/lib/calendar/unplaced';

function neutralized(taskId: string, overrides: Partial<NeutralizedTaskInfoJSON> = {}): NeutralizedTaskInfoJSON {
  return {
    task: {
      taskId, code: 'R1.01', name: 'Cours', type: 'TP', week: 40,
      duration: 90, startTime: -1, resources: [],
    },
    eliminationRound: 0,
    failureCount: 0,
    reason: 'Aucun créneau disponible',
    ...overrides,
  };
}

function course(id: string, duration: number): CourseTaskDataWithId {
  return {
    id, source: 'csv', week: 40, semester: 1, level: 1, code: 'R1.01', name: 'Cours', type: 'TP',
    teacher: [], groups: [], rooms: [], duration,
  };
}

function placement(taskId: string, overrides: Partial<Placement> = {}): Placement {
  return {
    placementId: taskId,
    taskId,
    startTime: 480,
    resources: { teachers: [], groups: [], rooms: [] },
    origin: 'post-enforced',
    ...overrides,
  };
}

describe('unplacedFromEngine', () => {
  it('origin: engine, diagnostics repris depuis reason/failureCount/eliminationRound', () => {
    const result = unplacedFromEngine([
      neutralized('abc123', { reason: 'Ressource saturée', failureCount: 3, eliminationRound: 2 }),
    ]);
    expect(result).toEqual([
      { taskId: 'abc123', origin: 'engine', diagnostics: { reason: 'Ressource saturée', failureCount: 3, eliminationRound: 2 } },
    ]);
  });

  it("n'invente aucun champ mort (requiredMinutes/schedulableMinutes/resourceSnapshots)", () => {
    const withDeadFields = neutralized('abc123', {
      requiredMinutes: 90, schedulableMinutes: 0, resourceSnapshots: [{ resourceId: 'G1', resourceType: 'group', availableMinutes: 0 }],
    });
    const [result] = unplacedFromEngine([withDeadFields]);
    expect(Object.keys(result.diagnostics!)).toEqual(['reason', 'failureCount', 'eliminationRound']);
  });
});

describe('unplacedFromPreNeutralized', () => {
  it('origin: user-pre, pas de diagnostics', () => {
    const result = unplacedFromPreNeutralized(['abc123', 'def456']);
    expect(result).toEqual([
      { taskId: 'abc123', origin: 'user-pre' },
      { taskId: 'def456', origin: 'user-pre' },
    ]);
    expect(result.every((u) => u.diagnostics === undefined)).toBe(true);
  });

  it('liste vide -> tableau vide', () => {
    expect(unplacedFromPreNeutralized([])).toEqual([]);
  });
});

describe('remainingDuration', () => {
  it('aucun placement -> durée du cours', () => {
    expect(remainingDuration('abc123', [], course('abc123', 90))).toBe(90);
  });

  it('un placement partiel -> différence', () => {
    const placements = [placement('abc123', { duration: 30 })];
    expect(remainingDuration('abc123', placements, course('abc123', 90))).toBe(60);
  });

  it('placements couvrant tout -> 0', () => {
    const placements = [placement('abc123', { duration: 90 })];
    expect(remainingDuration('abc123', placements, course('abc123', 90))).toBe(0);
  });

  it('sur-couverture -> 0, jamais négatif', () => {
    const placements = [placement('abc123', { duration: 60 }), placement('abc123-piece-1', { taskId: 'abc123', duration: 60 })];
    expect(remainingDuration('abc123', placements, course('abc123', 90))).toBe(0);
  });

  it('placement sans duration explicite -> couvre toute la durée du cours (règle 1)', () => {
    const placements = [placement('abc123')]; // pas de `duration`
    expect(remainingDuration('abc123', placements, course('abc123', 90))).toBe(0);
  });

  it('cours introuvable (undefined) -> 0, ne jette pas', () => {
    expect(remainingDuration('abc123', [], undefined)).toBe(0);
  });
});

describe('selectPiocheEntries', () => {
  it('entrée entièrement placée -> absente (non-régression du bug de l\'étape 1)', () => {
    const courseById = new Map([['abc123', course('abc123', 90)]]);
    const result = selectPiocheEntries(
      [{ taskId: 'abc123', origin: 'engine' }],
      [placement('abc123', { duration: 90 })],
      courseById,
    );
    expect(result).toHaveLength(0);
  });

  it('entrée partiellement placée -> présente avec le reste', () => {
    const courseById = new Map([['abc123', course('abc123', 90)]]);
    const result = selectPiocheEntries(
      [{ taskId: 'abc123', origin: 'engine' }],
      [placement('abc123', { duration: 30 })],
      courseById,
    );
    expect(result).toHaveLength(1);
    expect(result[0].remaining).toBe(60);
  });

  it('entrée non placée -> présente avec la durée pleine', () => {
    const courseById = new Map([['abc123', course('abc123', 90)]]);
    const result = selectPiocheEntries([{ taskId: 'abc123', origin: 'engine' }], [], courseById);
    expect(result).toHaveLength(1);
    expect(result[0].remaining).toBe(90);
    expect(result[0].course).toBe(courseById.get('abc123'));
  });

  it('cours introuvable -> ne jette pas, entrée ignorée', () => {
    const courseById = new Map<string, CourseTaskDataWithId>();
    expect(() =>
      selectPiocheEntries([{ taskId: 'inconnu', origin: 'engine' }], [], courseById),
    ).not.toThrow();
    expect(selectPiocheEntries([{ taskId: 'inconnu', origin: 'engine' }], [], courseById)).toHaveLength(0);
  });

  it('ne confond pas deux tâches distinctes : placer l\'une ne retire pas l\'autre de la pioche', () => {
    const courseById = new Map([['abc123', course('abc123', 90)], ['def456', course('def456', 60)]]);
    const result = selectPiocheEntries(
      [{ taskId: 'abc123', origin: 'engine' }, { taskId: 'def456', origin: 'user-pre' }],
      [placement('def456', { duration: 60 })],
      courseById,
    );
    expect(result).toHaveLength(1);
    expect(result[0].entry.taskId).toBe('abc123');
  });
});
