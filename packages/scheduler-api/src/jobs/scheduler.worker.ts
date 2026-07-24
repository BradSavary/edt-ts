import { workerData, parentPort } from 'node:worker_threads';
import type { RawScheduleData, SchedulerConfig } from '@edt-ts/scheduler-common';
import { runEngine } from '../runEngine.js';

if (!parentPort) throw new Error('scheduler.worker doit être lancé via worker_threads');

console.log('[Worker] Démarré, jobId =', workerData?.jobId, '| execArgv =', process.execArgv);

const { jobId, payload } = workerData as {
  jobId: string;
  payload: RawScheduleData & { options?: SchedulerConfig };
};

// --------------------------------------------------------------------------
// Exécution du moteur
// --------------------------------------------------------------------------
// IIFE (pas de top-level await) : le worker est bundlé en CJS par esbuild (JobQueue._getWorkerCode).

(async () => {
  try {
    const result = await runEngine(payload);
    parentPort!.postMessage({ type: 'done', jobId, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort!.postMessage({ type: 'error', jobId, error: message });
  }
})();
