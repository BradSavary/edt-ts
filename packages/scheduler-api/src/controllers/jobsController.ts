import type { Request, Response } from 'express';
import type { RawScheduleData, SchedulerConfig, JobSubmitResponse, JobStatusResponse } from '@edt-ts/scheduler-common';
import { createJob, getJob, deleteJob, hasActiveJobForClient } from '../jobs/JobStore.js';
import { jobQueue } from '../jobs/JobQueue.js';

function toJobStatusResponse(entry: ReturnType<typeof getJob>): JobStatusResponse | null {
  if (!entry) return null;
  const resp: JobStatusResponse = {
    jobId:     entry.id,
    clientId:  entry.clientId,
    status:    entry.status,
    week:      entry.week,
    createdAt: entry.createdAt.toISOString(),
  };
  if (entry.startedAt)  resp.startedAt  = entry.startedAt.toISOString();
  if (entry.finishedAt) resp.finishedAt = entry.finishedAt.toISOString();
  if (entry.status === 'done')  resp.result = entry.result;
  if (entry.status === 'error') resp.error  = entry.error;
  return resp;
}

// POST /api/schedule/v2/async
export function submitJobHandler(req: Request, res: Response): void {
  const clientId = req.headers['x-client-id'];
  if (!clientId || typeof clientId !== 'string') {
    res.status(400).json({ error: 'Header X-Client-Id manquant.' });
    return;
  }

  const body = req.body as RawScheduleData & { options?: SchedulerConfig };

  if (!body.week || !body.courses || !Array.isArray(body.courses)) {
    res.status(400).json({ error: 'Corps invalide : les champs "week" et "courses" sont requis.' });
    return;
  }

  const existingJobId = hasActiveJobForClient(clientId);
  if (existingJobId) {
    res.status(409).json({
      error: 'Un job est déjà en cours pour ce client.',
      existingJobId,
    });
    return;
  }

  const entry = createJob(clientId, body);
  jobQueue.enqueue(entry.id);

  const response: JobSubmitResponse = { jobId: entry.id };
  res.status(202).json(response);
}

// GET /api/schedule/jobs/:id
export function getJobHandler(req: Request, res: Response): void {
  const rawId = req.params['id'];
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const entry = getJob(id);

  if (!entry) {
    res.status(404).json({ error: 'Job introuvable.' });
    return;
  }

  res.status(200).json(toJobStatusResponse(entry));
}

// DELETE /api/schedule/jobs/:id
export function cancelJobHandler(req: Request, res: Response): void {
  const rawId = req.params['id'];
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const entry = getJob(id);

  if (!entry) {
    res.status(404).json({ error: 'Job introuvable.' });
    return;
  }

  if (entry.status === 'pending' || entry.status === 'running') {
    jobQueue.cancel(id);
  } else {
    // Terminé (done / error / cancelled) → supprime directement du store
    deleteJob(id);
  }

  res.status(204).send();
}
