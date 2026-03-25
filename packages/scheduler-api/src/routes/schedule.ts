import { Router } from 'express';
import { scheduleHandler, healthHandler, solveWithEliminationHandler } from '../controllers/scheduleController.js';

const router = Router();

/**
 * GET /api/schedule/health
 * Vérifie que l'API est opérationnelle.
 */
router.get('/health', healthHandler);

/**
 * POST /api/schedule
 * Planifie un ensemble de tâches selon les ressources et contraintes fournies.
 *
 * Corps JSON attendu :
 * {
 *   "week": <number>,
 *   "resources": [{ "resourceType": "teacher"|"room"|"group", "resources": [{ "id": string, "info"?: string }] }],
 *   "courses":  [CourseTaskData],
 *   "constraints": ConstraintsData,   // optionnel
 *   "options": { "maxSolutions": number, "timeoutSeconds": number } // optionnel
 * }
 */
router.post('/', scheduleHandler);

/**
 * POST /api/schedule/elimination
 * Planifie en autorisant la neutralisation des tâches les plus bloquantes.
 *
 * Corps JSON : identique à POST /api/schedule, plus :
 * {
 *   "options": { "eliminationCount": 3 }   // nombre max de tâches neutralisables (défaut: 3)
 * }
 *
 * Retourne un tableau de ScheduleSolutionJSON.
 */
router.post('/elimination', solveWithEliminationHandler);

export default router;
