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
 * Planifie via CP-SAT (seul moteur).
 *
 * Corps JSON : { week, resources, courses, constraints?, groups?, options? }
 *
 * Options disponibles (toutes optionnelles) :
 *   - timeoutSeconds              : number  — timeout du solveur en secondes (défaut : 180)
 *   - lunchBreak                  : LunchBreakConfig — gestion de la pause méridienne (défaut : { type: 'none' })
 *       { type: 'none' }
 *       { type: 'fixed', from: 'HH:MM', to: 'HH:MM' }
 *       { type: 'floating', ... } — non supporté par CP-SAT, provoque une erreur explicite
 *   - ignoreDailyLimits           : boolean — ignore les maxDailyMinutes de toutes les ressources (défaut : false)
 *   - respectCmTdTpOrder          : boolean — calcule les dépendances de précédence CM→TD→TP (défaut : true)
 *   - minimizeTeacherDays         : boolean — préférence douce (défaut : false)
 *   - reduceTeacherHalfDays       : boolean — préférence douce (défaut : false)
 *   - compactTeacherDay           : boolean — préférence douce (défaut : false)
 *   - minimizeTeacherRoomChanges  : boolean — préférence douce (défaut : false)
 *
 * Retourne un tableau de ScheduleSolutionJSON.
 */
router.post('/v2', schedulerV2Handler);

router.post('/v2/async', submitJobHandler);   // POST  /api/schedule/v2/async
router.get('/jobs/:id', getJobHandler);        // GET   /api/schedule/jobs/:id
router.delete('/jobs/:id', cancelJobHandler);  // DELETE /api/schedule/jobs/:id

export default router;
