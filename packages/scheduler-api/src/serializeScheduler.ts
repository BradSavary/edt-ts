import type { TaskSolutionJSON, ScheduleSolutionJSON, NeutralizedTaskInfoJSON, ISchedulable, Task } from '@edt-ts/scheduler-common';
import type { SchedulerSolution, NeutralizedUnitInfo, UnitSolution } from '@edt-ts/scheduler-core';

export function serializeUnitSolutions(solutions: UnitSolution[], taskMap: Map<string, ISchedulable>): TaskSolutionJSON[] {
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

export function serializeNeutralizedUnit(info: NeutralizedUnitInfo): NeutralizedTaskInfoJSON[] {
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

export function serializeSchedulerSolution(result: SchedulerSolution, taskMap: Map<string, ISchedulable>, algorithmName?: string): ScheduleSolutionJSON {
  const out: ScheduleSolutionJSON = {
    solutions:  serializeUnitSolutions(result.solutions, taskMap),
    isComplete: result.isComplete,
    score:      result.score,
  };
  if (result.neutralizedUnits && result.neutralizedUnits.length > 0) {
    out.neutralizedTasks = result.neutralizedUnits.flatMap(u => serializeNeutralizedUnit(u));
  }
  if (algorithmName) out.algorithmName = algorithmName;
  return out;
}
