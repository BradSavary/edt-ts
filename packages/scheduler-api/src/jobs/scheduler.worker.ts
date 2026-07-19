import { workerData, parentPort } from 'node:worker_threads';
import {
  Loader,
  OptionalTasksScheduler,
  createScheduler,
} from '@edt-ts/scheduler-core';
import type { RawScheduleData, SchedulerConfig, ScheduleSolutionJSON, ISchedulable } from '@edt-ts/scheduler-common';
import type { SchedulerSolution } from '@edt-ts/scheduler-core';
import { serializeSchedulerSolution } from '../serializeScheduler.js';

if (!parentPort) throw new Error('scheduler.worker doit être lancé via worker_threads');

console.log('[Worker] Démarré, jobId =', workerData?.jobId, '| execArgv =', process.execArgv);

const { jobId, payload } = workerData as {
  jobId: string;
  payload: RawScheduleData & { options?: SchedulerConfig };
};

// --------------------------------------------------------------------------
// Exécution du moteur
// --------------------------------------------------------------------------

try {
  Loader.reload();
  Loader.loadFromRawData({
    week:        payload.week,
    resources:   payload.resources ?? [],
    courses:     payload.courses,
    constraints: payload.constraints,
    groups:      payload.groups,
  });

  const allTasks = Loader.tasksManager.getAllUnits();
  const taskMap = new Map<string, ISchedulable>(allTasks.map(t => [t.id, t]));

  const scheduler = createScheduler(payload.options);
  if (payload.options) scheduler.configure(payload.options);

  const results: SchedulerSolution[] = scheduler.solveWithElimination();
  const response: ScheduleSolutionJSON[] = results.map(r => serializeSchedulerSolution(r, taskMap));
  if (scheduler instanceof OptionalTasksScheduler) {
    for (const sol of response) {
      sol.provenOptimal = scheduler.provenOptimal;
      sol.rootBound = scheduler.rootBound;
    }
  }

  parentPort.postMessage({ type: 'done', jobId, result: response });
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  parentPort.postMessage({ type: 'error', jobId, error: message });
}
