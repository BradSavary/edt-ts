import type { RawScheduleData, ScheduleSolutionJSON, SchedulerConfig } from '@edt-ts/scheduler-common';
import { runCpsat } from './cpsatGateway.js';

/** Unique point d'entrée moteur (CP-SAT). Réutilisé par le handler sync et le worker async. */
export async function runEngine(
  payload: RawScheduleData & { options?: SchedulerConfig },
): Promise<ScheduleSolutionJSON[]> {
  const { options, ...raw } = payload;
  return runCpsat(raw, options);
}
