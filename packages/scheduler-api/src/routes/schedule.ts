import { Router } from 'express';
import { healthHandler, defaultConfigHandler, schedulerV2Handler } from '../controllers/scheduleController.js';
import { submitJobHandler, getJobHandler, cancelJobHandler } from '../controllers/jobsController.js';

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
 *
 * Options disponibles (toutes optionnelles) :
 *   - maxSolutions       : number   — nb max de solutions complètes (défaut : 6)
 *   - timeoutSeconds     : number   — timeout du backtracking en secondes (défaut : 180)
 *   - maxIterations      : number   — limite de sécurité sur les itérations (défaut : 1 000 000)
 *   - maxEliminations    : number   — nb max de rounds d'élimination ; 0 = aucun (défaut : 3)
 *   - resourceSelection  : 'deterministic' | 'random' — stratégie de sélection des ressources (défaut : 'deterministic')
 *   - lunchBreak         : LunchBreakConfig — gestion de la pause méridienne (défaut : { type: 'none' })
 *       { type: 'none' }
 *       { type: 'fixed', from: 'HH:MM', to: 'HH:MM' }
 *       { type: 'floating', duration: number, earliest: 'HH:MM', latest: 'HH:MM' }
 *   - ignoreDailyLimits  : boolean  — ignore les maxDailyMinutes de toutes les ressources (défaut : false)
 *
 * Retourne un tableau de ScheduleSolutionJSON.
 */
router.post('/v2', schedulerV2Handler);

router.post('/v2/async', submitJobHandler);   // POST  /api/schedule/v2/async
router.get('/jobs/:id', getJobHandler);        // GET   /api/schedule/jobs/:id
router.delete('/jobs/:id', cancelJobHandler);  // DELETE /api/schedule/jobs/:id

export default router;
