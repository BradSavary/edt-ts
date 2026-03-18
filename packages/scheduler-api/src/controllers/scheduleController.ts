import type { Request, Response } from 'express';
import {
  Loader,
  ScheduleAR,
} from '@edt-ts/scheduler-core';
import type { RawScheduleData, TaskSolutionJSON } from '@edt-ts/scheduler-common';
import type {
  TaskSolution,
  ScheduleSolution,
} from '@edt-ts/scheduler-core';

// --------------------------------------------------------------------------
// Serialisation d'une TaskSolution vers JSON plain
// --------------------------------------------------------------------------

function serializeSolution(solutions: TaskSolution[]): TaskSolutionJSON[] {
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
 * Corps attendu de la requête — sérialisation JSON de `RawScheduleData & { options? }`.
 *
 * ```json
 * {
 *   "week": 47,
 *   "resources": [
 *     {
 *       "resourceType": "teacher",
 *       "resources": [
 *         { "id": "John Doe", "info": "{\"status\":\"PERMANENT\"}" }
 *       ]
 *     },
 *     {
 *       "resourceType": "room",
 *       "resources": [{ "id": "Salle101" }, { "id": "Salle102" }]
 *     },
 *     {
 *       "resourceType": "group",
 *       "resources": [{ "id": "BUT1-G1" }, { "id": "BUT1-G2" }]
 *     }
 *   ],
 *   "courses": [
 *     {
 *       "week": 47,
 *       "semester": 1,
 *       "level": 1,
 *       "code": "R101",
 *       "type": "CM",
 *       "name": "Intro programmation",
 *       "duration": 120,
 *       "teacher": ["John Doe"],
 *       "groups": ["BUT1-G1", "BUT1-G2"],
 *       "rooms": [["Salle101", "Salle102"]]
 *     }
 *   ],
 *   "constraints": {
 *     "Default": [{ "days": "lundi, mardi, jeudi, vendredi", "from": "08:00", "to": "18:00" }],
 *     "John Doe": [{ "days": "lundi, mercredi", "from": "09:00", "to": "17:00" }],
 *     "BUT1-G1": {
 *       "default": [{ "days": "lundi, mardi, jeudi", "from": "08:00", "to": "18:00" }],
 *       "S48": [{ "days": "lundi", "from": "08:00", "to": "12:00" }]
 *     }
 *   },
 *   "options": {
 *     "maxSolutions": 10,
 *     "timeoutSeconds": 60
 *   }
 * }
 * ```
 *
 * Notes :
 * - `resources` : obligatoire en pratique. Si absent ou vide, aucune ressource n'est chargée
 *   et la planification produira un résultat vide.
 * - `constraints` : optionnel. Si absent, aucune contrainte de disponibilité n'est appliquée —
 *   les ressources sont considérées disponibles sur toute la semaine.
 *   Les fichiers JSON embarqués (`resources.json`, `contraintes.json`) ne sont jamais lus
 *   par cet endpoint ; toutes les données doivent être fournies dans le corps de la requête.
 * - `courses[].teacher/groups/rooms` : chaque élément est soit un `string` (ressource unique),
 *   soit un `string[]` (alternatives — une seule sera choisie).
 * - `constraints` — voir `ConstraintsData` : chaque ressource peut avoir des créneaux fixes
 *   (`TimeSlot[]`) ou des overrides hebdomadaires (`{ default, S36, S47, ... }`).
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

    // ── Réinitialisation pour chaque requête ──
    Loader.reload();

    // ── Chargement des données brutes dans le moteur ─────────────────────
    Loader.loadFromRawData({
      week: body.week,
      resources: body.resources ?? [],
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
