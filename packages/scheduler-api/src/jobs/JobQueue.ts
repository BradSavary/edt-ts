import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { getJob, updateJob } from './JobStore.js';
import type { ScheduleSolutionJSON } from '@edt-ts/scheduler-common';

// Le bundle du worker est produit paresseusement au premier job pour ne pas
// bloquer la boucle événementielle (et donc app.listen()) au démarrage.
const WORKER_TS_PATH = fileURLToPath(new URL('./scheduler.worker.ts', import.meta.url));
let _workerCode: string | null = null;

function _getWorkerCode(): string {
  if (_workerCode === null) {
    const { outputFiles } = buildSync({
      entryPoints: [WORKER_TS_PATH],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      write: false,
      external: ['node:*'],
      logLevel: 'warning',
    });
    _workerCode = outputFiles[0].text;
    console.log('[JobQueue] Worker bundlé avec esbuild (%d bytes)', _workerCode.length);
  }
  return _workerCode;
}

class JobQueue {
  private queue: string[] = [];
  private activeWorker: Worker | null = null;
  private activeJobId: string | null = null;

  enqueue(jobId: string): void {
    this.queue.push(jobId);
    if (this.activeWorker === null) {
      this.processNext();
    }
  }

  cancel(jobId: string): void {
    // Cas 1 : job en file d'attente (pas encore démarré)
    const idx = this.queue.indexOf(jobId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      updateJob(jobId, { status: 'cancelled', finishedAt: new Date() });
      return;
    }

    // Cas 2 : job en cours d'exécution
    if (this.activeJobId === jobId && this.activeWorker) {
      void this.activeWorker.terminate();
      this.activeWorker = null;
      this.activeJobId = null;
      updateJob(jobId, { status: 'cancelled', finishedAt: new Date() });
      this.processNext();
    }
  }

  private processNext(): void {
    if (this.queue.length === 0) {
      this.activeWorker = null;
      this.activeJobId = null;
      return;
    }

    const jobId = this.queue.shift()!;
    const entry = getJob(jobId);

    // Job supprimé entre-temps (ex : TTL ou DELETE direct) → passer au suivant
    if (!entry) {
      this.processNext();
      return;
    }

    updateJob(jobId, { status: 'running', startedAt: new Date() });
    this.runWorker(jobId);
  }

  private runWorker(jobId: string): void {
    const entry = getJob(jobId);
    if (!entry) return;

    console.log(`[JobQueue] Démarrage worker pour job ${jobId}`);
    const worker = new Worker(_getWorkerCode(), {
      eval: true,
      workerData: { jobId, payload: entry.payload },
    });

    this.activeWorker = worker;
    this.activeJobId = jobId;

    worker.on('message', (msg: { type: string; jobId: string; result?: ScheduleSolutionJSON[]; error?: string }) => {
      // Ignorer les messages d'un worker annulé (stale message après terminate())
      if (this.activeWorker !== worker) return;
      if (msg.type === 'done') {
        updateJob(msg.jobId, { status: 'done', result: msg.result, finishedAt: new Date() });
      } else if (msg.type === 'error') {
        updateJob(msg.jobId, { status: 'error', error: msg.error, finishedAt: new Date() });
      }
      this.activeWorker = null;
      this.activeJobId = null;
      this.processNext();
    });

    worker.on('error', (err) => {
      if (this.activeWorker !== worker) return;
      console.error(`❌ Worker error (job ${jobId}):`, err.message);
      updateJob(jobId, { status: 'error', error: err.message, finishedAt: new Date() });
      this.activeWorker = null;
      this.activeJobId = null;
      this.processNext();
    });

    worker.on('exit', (code) => {
      // Gérer les sorties inattendues (terminate() déclenche exit avec code 1)
      const current = getJob(jobId);
      if (current && current.status === 'running') {
        const msg = `Worker exited avec code ${code}`;
        updateJob(jobId, { status: 'error', error: msg, finishedAt: new Date() });
        this.activeWorker = null;
        this.activeJobId = null;
        this.processNext();
      }
    });
  }
}

export const jobQueue = new JobQueue();
