import type { Request, Response } from 'express';
import {
  Loader,
  Scheduler,
} from '@edt-ts/scheduler-core';
import type { RawScheduleData, TaskSolutionJSON, ScheduleSolutionJSON, NeutralizedTaskInfoJSON, SchedulerConfig, ISchedulable, Task } from '@edt-ts/scheduler-common';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';
import type {
  SchedulerSolution,
  NeutralizedUnitInfo,
  UnitSolution,
} from '@edt-ts/scheduler-core';



// --------------------------------------------------------------------------
// Sérialisation Scheduler (nouveau moteur) → JSON
// --------------------------------------------------------------------------

function serializeUnitSolutions(solutions: UnitSolution[], taskMap: Map<string, ISchedulable>): TaskSolutionJSON[] {
  return solutions.map(sol => {
    // sol.task est renseigné par TaskGroupUnit (tâche individuelle membre)
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
// POST /api/schedule/v2
// --------------------------------------------------------------------------

/**
 * Nouveau moteur (Scheduler) avec élimination intégrée.
 * Corps identique à POST /api/schedule/elimination.
 * Si options.maxEliminations = 0, aucune élimination n'est tentée.
 * Retourne un tableau de ScheduleSolutionJSON.
 */
export async function schedulerV2Handler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as RawScheduleData & { options?: SchedulerConfig };

    if (!body.week || !body.courses || !Array.isArray(body.courses)) {
      res.status(400).json({
        error: 'Corps invalide : les champs "week" et "courses" sont requis.',
      });
      return;
    }

    Loader.reload();
    Loader.loadFromRawData({
      week:        body.week,
      resources:   body.resources ?? [],
      courses:     body.courses,
      constraints: body.constraints,
      groups:      body.groups,
    });

    // Construire la map id→ISchedulable avant la résolution (état stable après loadFromRawData)
    const allTasks = Loader.tasksManager.getAllUnits();
    const taskMap = new Map<string, ISchedulable>(allTasks.map(t => [t.id, t]));

    const scheduler = new Scheduler();
    if (body.options) scheduler.configure(body.options);

    const results: SchedulerSolution[] = scheduler.solveWithElimination();

    const response: ScheduleSolutionJSON[] = results.map(r => serializeSchedulerSolution(r, taskMap));
    res.status(200).json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('❌ Erreur planification (v2) :', message);
    if (stack) console.error(stack);
    res.status(500).json({ error: message });
  }
}

// --------------------------------------------------------------------------
// GET /api/schedule/health
// --------------------------------------------------------------------------

export function healthHandler(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', package: '@edt-ts/scheduler-api' });
}

// --------------------------------------------------------------------------
// GET /api/schedule/config
// --------------------------------------------------------------------------

export function defaultConfigHandler(_req: Request, res: Response): void {
  res.status(200).json(DEFAULT_SCHEDULER_CONFIG);
}
