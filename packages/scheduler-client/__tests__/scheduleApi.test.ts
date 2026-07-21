import { describe, it, expect } from 'vitest';
import { buildScheduleStatus, type ScheduleResult, type NormalizedSolution } from '../lib/api/scheduleApi';

function makeResult(solution: Partial<NormalizedSolution>, week = 44): ScheduleResult {
  return {
    week,
    solution: {
      isComplete: false,
      tasks: [],
      ...solution,
    },
  };
}

describe('buildScheduleStatus', () => {
  it('solution complète : message ok, pas de mention de nombre de solutions', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: true,
      tasks: [{ taskId: 't1', code: 'R101', name: 'Cours', type: 'CM', week: 44, duration: 60, startTime: 0, resources: [] }],
    }));
    expect(status.kind).toBe('ok');
    expect(status.message).toContain('Planification complète');
    expect(status.message).not.toMatch(/\d+ solution\(s\)/);
  });

  it('solution incomplète avec tâches neutralisées : message incomplet + décompte', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false,
      tasks: [{ taskId: 't1', code: 'R101', name: 'Cours', type: 'CM', week: 44, duration: 60, startTime: 0, resources: [] }],
      neutralizedTasks: [
        { task: { taskId: 't2', code: 'R102', name: 'Cours 2', type: 'TD', week: 44, duration: 60, startTime: 0, resources: [] }, eliminationRound: 1, failureCount: 1, reason: 'conflit' },
      ],
    }));
    expect(status.kind).toBe('err');
    expect(status.message).toContain('Incomplète');
    expect(status.message).toContain('1 cours non placé(s)');
    expect(status.message).not.toMatch(/\d+ solution\(s\)/);
  });

  it('tasks: [] → branche "Aucune solution trouvée"', () => {
    const status = buildScheduleStatus(makeResult({ isComplete: false, tasks: [] }));
    expect(status.kind).toBe('err');
    expect(status.message).toBe('❌ Aucune solution trouvée');
  });

  it('tasks: [] avec neutralisées → décompte dans le message d\'échec', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false,
      tasks: [],
      neutralizedTasks: [
        { task: { taskId: 't2', code: 'R102', name: 'Cours 2', type: 'TD', week: 44, duration: 60, startTime: 0, resources: [] }, eliminationRound: 1, failureCount: 1, reason: 'conflit' },
      ],
    }));
    expect(status.message).toBe('❌ Aucune solution trouvée — 1 cours neutralisé(s)');
  });

  it('provenOptimal avec rootBound.lb > 0 : mentionne le nombre de sauts inévitables', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false,
      tasks: [{ taskId: 't1', code: 'R101', name: 'Cours', type: 'CM', week: 44, duration: 60, startTime: 0, resources: [] }],
      provenOptimal: true,
      rootBound: { lb: 3, certificates: [] },
    }));
    expect(status.message).toContain('optimum prouvé : 3 saut(s) structurellement inévitable(s)');
  });

  it('provenOptimal sans rootBound (ou lb: 0) : message générique sans relâchement de contraintes', () => {
    const status = buildScheduleStatus(makeResult({
      isComplete: false,
      tasks: [{ taskId: 't1', code: 'R101', name: 'Cours', type: 'CM', week: 44, duration: 60, startTime: 0, resources: [] }],
      provenOptimal: true,
    }));
    expect(status.message).toContain('optimum prouvé : le moteur ne placera pas plus sans relâchement de contraintes');
  });
});
