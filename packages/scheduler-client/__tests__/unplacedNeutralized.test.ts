import { describe, it, expect } from 'vitest';
import type { NeutralizedTaskInfoJSON } from '@edt-ts/scheduler-common';
import type { Placement } from '@/store/types';
import { selectUnplacedNeutralized, realTaskId, PRE_NEUTRAL_PREFIX } from '@/lib/taskCardUtils';

function neutralized(taskId: string): NeutralizedTaskInfoJSON {
  return {
    task: {
      taskId, code: 'R1.01', name: 'Cours', type: 'TP', week: 40,
      duration: 90, startTime: -1, resources: [],
    },
    eliminationRound: 0,
    failureCount: 0,
    reason: 'test',
  };
}

function placement(taskId: string): Placement {
  return {
    placementId: taskId,
    taskId,
    startTime: 480,
    resources: { teachers: [], groups: [], rooms: [] },
    origin: 'post-enforced',
  };
}

describe('realTaskId', () => {
  it('retire le préfixe des pré-neutralisées', () => {
    expect(realTaskId(`${PRE_NEUTRAL_PREFIX}abc123`)).toBe('abc123');
  });

  it('laisse intact un id non préfixé', () => {
    expect(realTaskId('abc123')).toBe('abc123');
  });
});

describe('selectUnplacedNeutralized', () => {
  it('retire de la pioche une tâche neutralisée par le moteur qui a été placée', () => {
    const result = selectUnplacedNeutralized([neutralized('abc123')], [placement('abc123')]);
    expect(result).toHaveLength(0);
  });

  it('retire de la pioche une tâche PRÉ-neutralisée placée — le placement porte l\'id réel, l\'entrée l\'id préfixé', () => {
    // Régression : la comparaison directe `p.taskId === t.task.taskId` échouait ici, la carte
    // restait dans la pioche et pouvait être déposée plusieurs fois sur le calendrier.
    const result = selectUnplacedNeutralized(
      [neutralized(`${PRE_NEUTRAL_PREFIX}abc123`)],
      [placement('abc123')],
    );
    expect(result).toHaveLength(0);
  });

  it('garde dans la pioche une tâche non placée', () => {
    const result = selectUnplacedNeutralized([neutralized('abc123')], []);
    expect(result).toHaveLength(1);
  });

  it('garde une pré-neutralisée non placée alors qu\'une autre tâche l\'est', () => {
    const result = selectUnplacedNeutralized(
      [neutralized(`${PRE_NEUTRAL_PREFIX}abc123`), neutralized('def456')],
      [placement('def456')],
    );
    expect(result).toHaveLength(1);
    expect(result[0].task.taskId).toBe(`${PRE_NEUTRAL_PREFIX}abc123`);
  });

  it('ne confond pas deux cours dont l\'un est pré-neutralisé et l\'autre non', () => {
    const result = selectUnplacedNeutralized(
      [neutralized(`${PRE_NEUTRAL_PREFIX}abc123`), neutralized('abc123')],
      [placement('abc123')],
    );
    // Les deux référencent le même cours : placer ce cours les retire tous les deux de la pioche.
    expect(result).toHaveLength(0);
  });
});
