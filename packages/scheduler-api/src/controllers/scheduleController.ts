import type { Request, Response } from 'express';
import {
  Loader,
  ConstraintsManager,
  ScheduleAR,
  ResourceType,
} from '@edt-ts/scheduler-core';
import type {
  RawScheduleData,
  TaskSolution,
  ScheduleSolution,
} from '@edt-ts/scheduler-core';

// --------------------------------------------------------------------------
// Serialisation d'une TaskSolution vers JSON plain
// --------------------------------------------------------------------------

function serializeSolution(solutions: TaskSolution[]): object[] {
  return solutions.map(sol => {
    const task = sol.task;
    const resources = task.getAllResources?.() ?? [];
    return {
      taskId: task.id,
      code: task.code,
      name: task.name,
      type: task.type,
      week: task.week,
      duration: task.duration,
      startTime: sol.startTime,
      resources: resources.map((r: { id: string; type: string }) => ({
        id: r.id,
        type: r.type,
      })),
    };
  });
}

// --------------------------------------------------------------------------
// POST /api/schedule
// --------------------------------------------------------------------------

/**
 * Corps attendu de la requête :
 * {
 *   "week": 36,
 *   "teachers": [{ "teacher": "John Doe", "status": "P" }, ...],
 *   "groups":   ["BUT1-G1", "BUT1-G2"],
 *   "rooms":    ["Salle101"],
 *   "courses":  [ <CourseTaskData>, ... ],
 *   "constraints": { "Default": [...], "John Doe": [...] },  // optionnel
 *   "options": { "maxSolutions": 10, "timeoutSeconds": 60 }  // optionnel
 * }
 */
export async function scheduleHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as RawScheduleData & {
      options?: { maxSolutions?: number; timeoutSeconds?: number };
    };

    // ── Validation minimale ──────────────────────────────────────────────
    if (!body.week || !body.courses || !Array.isArray(body.courses)) {
      res.status(400).json({
        error: 'Corps invalide : les champs "week" et "courses" sont requis.',
      });
      return;
    }

    // ── Réinitialisation de l'état statique (important en mode serveur) ──
    ConstraintsManager.reset();
    Loader.reload();

    // ── Chargement des données brutes dans le moteur ─────────────────────
    Loader.loadFromRawData({
      week: body.week,
      teachers: body.teachers ?? [],
      groups: body.groups ?? [],
      rooms: body.rooms ?? [],
      courses: body.courses,
      constraints: body.constraints,
    });

    // ── Configuration du planificateur ───────────────────────────────────
    const scheduler = new ScheduleAR();
    if (body.options?.maxSolutions !== undefined) {
      scheduler.setMaxCompleteSolutions(body.options.maxSolutions);
    }
    if (body.options?.timeoutSeconds !== undefined) {
      scheduler.setTimeoutSeconds(body.options.timeoutSeconds);
    }

    // ── Résolution ───────────────────────────────────────────────────────
    const result: ScheduleSolution = scheduler.solve();

    // ── Réponse ──────────────────────────────────────────────────────────
    res.status(200).json({
      isComplete: result.isComplete,
      scheduledCount: result.solutions.length,
      conflictCount: result.conflictCount,
      solutions: serializeSolution(result.solutions),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('❌ Erreur planification :', message);
    res.status(500).json({ error: message });
  }
}

// --------------------------------------------------------------------------
// GET /api/schedule/health
// --------------------------------------------------------------------------

export function healthHandler(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', package: '@edt-ts/scheduler-api' });
}
