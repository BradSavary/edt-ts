import { Router } from 'express';
import { scheduleHandler, healthHandler } from '../controllers/scheduleController.js';

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
 *   "teachers": [{ "teacher": string, "status": string }],
 *   "groups":   [string],
 *   "rooms":    [string],
 *   "courses":  [CourseTaskData],
 *   "constraints": ConstraintsData,   // optionnel
 *   "options": { "maxSolutions": number, "timeoutSeconds": number } // optionnel
 * }
 */
router.post('/', scheduleHandler);

export default router;
