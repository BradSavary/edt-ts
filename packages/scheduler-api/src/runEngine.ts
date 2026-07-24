import {
  Loader,
  OptionalTasksScheduler,
  createScheduler,
} from '@edt-ts/scheduler-core';
import type { RawScheduleData, ScheduleSolutionJSON, SchedulerConfig, ISchedulable } from '@edt-ts/scheduler-common';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';
import type { SchedulerSolution } from '@edt-ts/scheduler-core';
import { serializeSchedulerSolution } from './serializeScheduler.js';
import { runCpsat } from './cpsatGateway.js';

/**
 * Point de branchement unique entre les deux moteurs (`core` / `cpsat`). Réutilisé par le handler
 * sync (`POST /api/schedule/v2`) et le worker de jobs async (`scheduler.worker.ts`).
 */
export async function runEngine(
  payload: RawScheduleData & { options?: SchedulerConfig },
): Promise<ScheduleSolutionJSON[]> {
  const { options, ...raw } = payload;
  if (options?.engine === 'cpsat') {
    return runCpsat(raw, options);
  }
  return runCoreEngine(payload);
}

async function runCoreEngine(
  payload: RawScheduleData & { options?: SchedulerConfig },
): Promise<ScheduleSolutionJSON[]> {
  Loader.reload();
  Loader.loadFromRawData({
    week:        payload.week,
    resources:   payload.resources ?? [],
    courses:     payload.courses,
    constraints: payload.constraints,
    groups:      payload.groups,
  });

  // Construire la map id→ISchedulable avant la résolution (état stable après loadFromRawData)
  const allTasks = Loader.tasksManager.getAllUnits();
  const taskMap = new Map<string, ISchedulable>(allTasks.map(t => [t.id, t]));

  const scheduler = createScheduler(payload.options);
  if (payload.options) scheduler.configure(payload.options);

  const results: SchedulerSolution[] = scheduler.solveWithElimination();
  if (
    (payload.options?.postRepair ?? DEFAULT_SCHEDULER_CONFIG.postRepair) &&
    payload.options?.searchStrategy !== 'maxPlacement' &&
    (results[0]?.neutralizedUnits?.length ?? 0) > 0
  ) {
    results[0] = scheduler.repairNeutralized(results[0]);
  }

  const response: ScheduleSolutionJSON[] = results.map(r => serializeSchedulerSolution(r, taskMap));
  if (scheduler instanceof OptionalTasksScheduler) {
    for (const sol of response) {
      sol.provenOptimal = scheduler.provenOptimal;
      sol.rootBound = scheduler.rootBound;
    }
  }
  return response;
}
