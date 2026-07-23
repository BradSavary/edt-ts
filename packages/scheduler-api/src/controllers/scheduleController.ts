import type { Request, Response } from 'express';
import {
  Loader,
  OptionalTasksScheduler,
  createScheduler,
} from '@edt-ts/scheduler-core';
import type { RawScheduleData, ScheduleSolutionJSON, SchedulerConfig, ISchedulable } from '@edt-ts/scheduler-common';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';
import type { SchedulerSolution } from '@edt-ts/scheduler-core';
import { serializeSchedulerSolution } from '../serializeScheduler.js';

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

    const scheduler = createScheduler(body.options);
    if (body.options) scheduler.configure(body.options);

    const results: SchedulerSolution[] = scheduler.solveWithElimination();
    if (
      body.options?.postRepair &&
      body.options?.searchStrategy !== 'maxPlacement' &&
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
