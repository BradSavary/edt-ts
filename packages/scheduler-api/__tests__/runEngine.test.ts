import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawScheduleData, SchedulerConfig, ScheduleSolutionJSON } from '@edt-ts/scheduler-common';

const runCpsatMock = vi.fn<
  (raw: RawScheduleData, config?: SchedulerConfig) => Promise<ScheduleSolutionJSON[]>
>();

vi.mock('../src/cpsatGateway.js', () => ({
  runCpsat: (...args: [RawScheduleData, SchedulerConfig?]) => runCpsatMock(...args),
}));

// Import après le mock (hoisted par vitest) pour que runEngine résolve la version mockée de cpsatGateway.
const { runEngine } = await import('../src/runEngine.js');

const resources: RawScheduleData['resources'] = [
  { resourceType: 'teacher', resources: [{ id: 'T1' }] },
  { resourceType: 'group', resources: [{ id: 'G1' }] },
  { resourceType: 'room', resources: [{ id: 'R1' }] },
];

const baseCourse: RawScheduleData['courses'][number] = {
  week: 10, semester: 1, level: 0, code: 'X1', type: 'CM', name: 'Cours',
  teacher: ['T1'], groups: ['G1'], rooms: ['R1'], duration: 60,
};

const payload: RawScheduleData & { options?: SchedulerConfig } = {
  week: 10,
  resources,
  courses: [baseCourse],
  constraints: {
    Default: [{ days: 'lundi mardi mercredi jeudi vendredi', from: '08:00', to: '18:00' }],
  },
};

beforeEach(() => {
  runCpsatMock.mockReset();
});

describe('runEngine', () => {
  it('délègue à runCpsat avec raw et options correctement séparés', async () => {
    const fakeResult: ScheduleSolutionJSON[] = [
      { solutions: [], isComplete: true, score: 0, provenOptimal: true },
    ];
    runCpsatMock.mockResolvedValue(fakeResult);

    const options: SchedulerConfig = { timeoutSeconds: 12 };
    const result = await runEngine({ ...payload, options });

    expect(runCpsatMock).toHaveBeenCalledTimes(1);
    const [calledRaw, calledConfig] = runCpsatMock.mock.calls[0];
    expect(calledRaw.week).toBe(10);
    expect(calledRaw.courses).toEqual([baseCourse]);
    expect(calledConfig).toEqual(options);
    expect(result).toBe(fakeResult);
  });
});
