import type { Request, Response } from 'express';
import {
  Loader,
  Schedule,
  Scheduler,
} from '@edt-ts/scheduler-core';
import type { RawScheduleData, TaskSolutionJSON, ScheduleSolutionJSON, NeutralizedTaskInfoJSON, SchedulerConfig, ISchedulable, Task } from '@edt-ts/scheduler-common';
import { DEFAULT_SCHEDULER_CONFIG } from '@edt-ts/scheduler-common';
import type {
  TaskSolution,
  ScheduleSolution,
  NeutralizedTaskInfo,
  SchedulerSolution,
  NeutralizedUnitInfo,
  UnitSolution,
} from '@edt-ts/scheduler-core';

// --------------------------------------------------------------------------
// Serialisation d'une TaskSolution vers JSON plain
// --------------------------------------------------------------------------

function serializeSolution(solutions: TaskSolution[]): TaskSolutionJSON[] {
  return solutions.map(sol => {
    const task = sol.unit;
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

/** Sérialise une Task non planifiée (startTime = -1 car absence de créneau) */
function serializeTask(task: ISchedulable): TaskSolutionJSON {
  const resources = task.getAllResources?.() ?? [];
  return {
    taskId: task.id,
    code: task.code,
    name: task.name,
    type: task.type,
    week: task.week,
    duration: task.duration,
    startTime: -1,
    resources: resources.map((r: { id: string; type: string }) => ({
      id: r.id,
      type: r.type,
    })),
  };
}

/** Sérialise un NeutralizedTaskInfo vers NeutralizedTaskInfoJSON */
function serializeNeutralizedTaskInfo(info: NeutralizedTaskInfo): NeutralizedTaskInfoJSON {
  return {
    task: serializeTask(info.unit),
    eliminationRound: info.eliminationRound,
    failureCount: info.failureCount,
    requiredMinutes: info.requiredMinutes,
    schedulableMinutes: info.schedulableMinutes,
    resourceSnapshots: info.resourceSnapshots,
    reason: info.reason,
  };
}

/** Sérialise un ScheduleSolution vers ScheduleSolutionJSON */
function serializeScheduleSolution(result: ScheduleSolution): ScheduleSolutionJSON {
  const out: ScheduleSolutionJSON = {
    solutions: serializeSolution(result.solutions),
    isComplete: result.isComplete,
    score: result.score,
  };
  if (result.neutralizedTasks && result.neutralizedTasks.length > 0) {
    out.neutralizedTasks = result.neutralizedTasks.map(serializeNeutralizedTaskInfo);
  }
  return out;
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
 *     "timeoutSeconds": 60,
 *     "lunchBreak": { "type": "none" }
 *   }
 * }
 * ```
 *
 * Exemples de valeurs pour `options.lunchBreak` :
 * - Aucune contrainte (défaut) : `{ "type": "none" }`
 * - Pause fixe            : `{ "type": "fixed", "from": "12:00", "to": "13:30" }`
 * - Pause flottante        : `{ "type": "floating", "duration": 90, "earliest": "12:00", "latest": "14:00" }`
 *
 * La contrainte `fixed` bloque la plage horaire dans les disponibilités des groupes (avant le backtracking).
 * La contrainte `floating` filtre les créneaux : elle garantit qu'un bloc libre d'au moins `duration`
 * minutes reste disponible dans `[earliest, latest]` pour chaque groupe impliqué dans la tâche.
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
    const body = req.body as RawScheduleData & { options?: SchedulerConfig };

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
    const scheduler = new Schedule();
    if (body.options) scheduler.configure(body.options);

    // ── Résolution ───────────────────────────────────────────────────────
    scheduler.initSolver();
    const results: ScheduleSolution[] = scheduler.solve();

    // ── Réponse ──────────────────────────────────────────────────────────
    res.status(200).json({
      solutionCount: results.length,
      solutions: results.map(r => ({
        score: r.score,
        isComplete: r.isComplete,
        scheduledCount: r.solutions.length,
        conflictCount: r.conflictCount,
        tasks: serializeSolution(r.solutions),
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('❌ Erreur planification :', message);
    res.status(500).json({ error: message });
  }
}

// --------------------------------------------------------------------------
// POST /api/schedule/elimination
// --------------------------------------------------------------------------

/**
 * Même corps que POST /api/schedule, plus :
 * - `options.eliminationCount` (number, défaut 3) : nombre maximum de tâches
 *   que l'algorithme est autorisé à neutraliser pour débloquer la recherche.
 *
 * Retourne un tableau de ScheduleSolutionJSON (solutions complètes triées par
 * score décroissant, avec les tâches neutralisées le cas échéant).
 */
export async function solveWithEliminationHandler(req: Request, res: Response): Promise<void> {
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
      week: body.week,
      resources: body.resources ?? [],
      courses: body.courses,
      constraints: body.constraints,
    });

    const scheduler = new Schedule();
    if (body.options) scheduler.configure(body.options);

    const results: ScheduleSolution[] = scheduler.solveWithTaskElimination();

    const response: ScheduleSolutionJSON[] = results.map(serializeScheduleSolution);
    res.status(200).json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('❌ Erreur planification (elimination) :', message);
    res.status(500).json({ error: message });
  }
}

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
