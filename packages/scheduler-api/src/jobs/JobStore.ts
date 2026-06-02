import { randomUUID } from 'node:crypto';
import type { RawScheduleData, ScheduleSolutionJSON, SchedulerConfig } from '@edt-ts/scheduler-common';
import type { JobStatus } from '@edt-ts/scheduler-common';

export interface JobEntry {
  id: string;
  clientId: string;
  week: number;
  status: JobStatus;
  payload: RawScheduleData & { options?: SchedulerConfig };
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  result?: ScheduleSolutionJSON[];
  error?: string;
}

const store = new Map<string, JobEntry>();

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

export function createJob(
  clientId: string,
  payload: RawScheduleData & { options?: SchedulerConfig },
): JobEntry {
  const entry: JobEntry = {
    id: randomUUID(),
    clientId,
    week: payload.week,
    status: 'pending',
    payload,
    createdAt: new Date(),
  };
  store.set(entry.id, entry);
  return entry;
}

export function getJob(id: string): JobEntry | undefined {
  return store.get(id);
}

export function updateJob(id: string, partial: Partial<Omit<JobEntry, 'id' | 'clientId' | 'payload'>>): void {
  const entry = store.get(id);
  if (entry) Object.assign(entry, partial);
}

export function deleteJob(id: string): boolean {
  return store.delete(id);
}

export function hasActiveJobForClient(clientId: string): string | undefined {
  for (const entry of store.values()) {
    if (entry.clientId === clientId && (entry.status === 'pending' || entry.status === 'running')) {
      return entry.id;
    }
  }
  return undefined;
}

export function startTTLCleanup(intervalMs = 60 * 60 * 1000): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of store.entries()) {
      if (
        entry.finishedAt &&
        (entry.status === 'done' || entry.status === 'error' || entry.status === 'cancelled') &&
        now - entry.finishedAt.getTime() > TTL_MS
      ) {
        store.delete(id);
      }
    }
  }, intervalMs);
}
