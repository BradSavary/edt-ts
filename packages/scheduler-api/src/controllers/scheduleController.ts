import type { Request, Response } from 'express';
import type { RawScheduleData, SchedulerConfig } from '@edt-ts/scheduler-common';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';
import { runEngine } from '../runEngine.js';

// --------------------------------------------------------------------------
// POST /api/schedule/v2
// --------------------------------------------------------------------------

/**
 * Planifie via CP-SAT (seul moteur). Retourne un tableau de ScheduleSolutionJSON.
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

    const response = await runEngine(body);
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
