import { Router } from 'express';
import { healthHandler, defaultConfigHandler, schedulerV2Handler } from '../controllers/scheduleController.js';

const router = Router();

/**
 * GET /api/schedule/health
 * Vérifie que l'API est opérationnelle.
 */
router.get('/health', healthHandler);

/**
 * GET /api/schedule/config
 * Retourne la configuration par défaut du solver.
 */
router.get('/config', defaultConfigHandler);

/**
 * POST /api/schedule/v2
 * Nouveau moteur (Scheduler) avec élimination intégrée.
 *
 * Corps JSON : { week, resources, courses, constraints?, groups?, options? }
 * Si options.maxEliminations = 0, aucune élimination n'est tentée.
 *
 * Retourne un tableau de ScheduleSolutionJSON.
 */
router.post('/v2', schedulerV2Handler);

export default router;
