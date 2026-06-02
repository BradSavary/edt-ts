import { workerData, parentPort } from 'node:worker_threads';
import {
  Loader,
  Scheduler,
} from '@edt-ts/scheduler-core';
import type { RawScheduleData, SchedulerConfig, TaskSolutionJSON, ScheduleSolutionJSON, NeutralizedTaskInfoJSON, ISchedulable, Task } from '@edt-ts/scheduler-common';
import type { SchedulerSolution, NeutralizedUnitInfo, UnitSolution } from '@edt-ts/scheduler-core';

if (!parentPort) throw new Error('scheduler.worker doit être lancé via worker_threads');

console.log('[Worker] Démarré, jobId =', workerData?.jobId, '| execArgv =', process.execArgv);

const { jobId, payload } = workerData as {
  jobId: string;
  payload: RawScheduleData & { options?: SchedulerConfig };
};

// --------------------------------------------------------------------------
// Sérialisation (copie de scheduleController — état isolé par thread)
// --------------------------------------------------------------------------

function serializeUnitSolutions(solutions: UnitSolution[], taskMap: Map<string, ISchedulable>): TaskSolutionJSON[] {
  return solutions.map(sol => {
    const meta = sol.task ?? taskMap.get(sol.unit.id);
    return {
      taskId:    meta?.id       ?? sol.unit.id,
      code:      meta?.code     ?? '',
      name:      meta?.name     ?? '',
      type:      meta?.type     ?? '',
      week:      meta?.week     ?? 0,
      duration:  meta?.duration ?? sol.unit.duration,
      startTime: sol.start,
      resources: sol.resources.map(r => ({ id: r.id, type: r.type })),
    };
  });
}

function serializeNeutralizedUnit(info: NeutralizedUnitInfo): NeutralizedTaskInfoJSON[] {
  return info.unit.getMemberTasks().map((memberTask: Task) => {
    const seen = new Set<string>();
    const candidateResources: { id: string; type: string }[] = [];
    for (const alternatives of Object.values(memberTask.resources)) {
      for (const combo of alternatives as Array<Array<{ id: string; type: string }>>) {
        for (const r of combo) {
          if (!seen.has(r.id)) { seen.add(r.id); candidateResources.push({ id: r.id, type: r.type }); }
        }
      }
    }
    const taskJSON: TaskSolutionJSON = {
      taskId:    memberTask.id,
      code:      memberTask.code,
      name:      memberTask.name,
      type:      memberTask.type,
      week:      memberTask.week,
      duration:  memberTask.duration,
      startTime: -1,
      resources: candidateResources,
    };
    return {
      task:             taskJSON,
      eliminationRound: info.eliminationRound,
      failureCount:     info.failureCount,
      reason:           info.reason,
    };
  });
}

function serializeSchedulerSolution(result: SchedulerSolution, taskMap: Map<string, ISchedulable>): ScheduleSolutionJSON {
  const out: ScheduleSolutionJSON = {
    solutions:  serializeUnitSolutions(result.solutions, taskMap),
    isComplete: result.isComplete,
    score:      result.score,
  };
  if (result.neutralizedUnits && result.neutralizedUnits.length > 0) {
    out.neutralizedTasks = result.neutralizedUnits.flatMap(u => serializeNeutralizedUnit(u));
  }
  return out;
}

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

  const scheduler = new Scheduler();
  if (payload.options) scheduler.configure(payload.options);

  const results: SchedulerSolution[] = scheduler.solveWithElimination();
  const response: ScheduleSolutionJSON[] = results.map(r => serializeSchedulerSolution(r, taskMap));

  parentPort.postMessage({ type: 'done', jobId, result: response });
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  parentPort.postMessage({ type: 'error', jobId, error: message });
}
