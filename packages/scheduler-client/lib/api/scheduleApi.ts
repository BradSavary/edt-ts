import type { RawScheduleData, TaskSolutionJSON, NeutralizedTaskInfoJSON, NoSolutionStatus, EnforcedData, ConstraintsData, SchedulerConfig, TaskGroupDeclaration, JobSubmitResponse, JobStatusResponse } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { ResourceGroupDataWithStatus } from '@/lib/csvMerge';
import { resolveMaxDailyMinutes } from '@/lib/maxDailyResolution';
import { type BlockedZone, applyBlockedZonesToConstraints } from '@/lib/calendar/blockedZones';

// En dev : vide → les rewrites Next.js proxifient /api/* vers localhost:3000
// En prod : '/edtts' → les appels vont vers /edtts/api/* (proxifié par Apache .htaccess)
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export interface NormalizedSolution {
  isComplete: boolean;
  score?: number;
  tasks: TaskSolutionJSON[];
  neutralizedTasks?: NeutralizedTaskInfoJSON[];
  /** `true` si CP-SAT a prouvé l'optimum du nombre de cours placés (voir ScheduleSolutionJSON.provenOptimal). */
  provenOptimal?: boolean;
  /** Renseigné uniquement quand aucune tâche n'est placée — voir `ScheduleSolutionJSON`. */
  noSolutionStatus?: NoSolutionStatus;
}

export interface ScheduleResult {
  solution: NormalizedSolution;
  week: number;
}

export interface RunScheduleParamsFromData {
  week: number;
  courses: CourseTaskDataWithId[];
  resources: ResourceGroupDataWithStatus[];
  constraintsData: ConstraintsData | null;
  enforcedMap: Record<string, EnforcedData>;
  blockedZones: BlockedZone[];
  schedulerConfig?: SchedulerConfig;
  groups?: TaskGroupDeclaration[];
}

function _buildPayload(
  weekNum: number,
  resources: ResourceGroupDataWithStatus[],
  courses: CourseTaskDataWithId[],
  constraintsData: ConstraintsData | null,
  enforcedMap: Record<string, EnforcedData>,
  blockedZones: BlockedZone[],
  schedulerConfig?: SchedulerConfig,
  groups?: TaskGroupDeclaration[],
): RawScheduleData & { options?: Record<string, unknown> } {
  const coursesWithEnforced = courses.map((course) => {
    const enforced = enforcedMap[course.id];
    return enforced ? { ...course, enforced } : course;
  });

  // `weeklyMaxDailyMinutes` est purement client : le moteur est mono-semaine et n'attend
  // qu'un scalaire `maxDailyMinutes`. Résolution ici, au même endroit et dans le même esprit
  // que la résolution hebdomadaire de `Default` juste en dessous.
  const resolvedResources = resources.map((group) => ({
    ...group,
    resources: group.resources.map((r) => {
      const { weeklyMaxDailyMinutes: _weekly, maxDailyMinutes: _perResource, ...rest } = r;
      const maxDailyMinutes = resolveMaxDailyMinutes(r, weekNum);
      return maxDailyMinutes !== undefined ? { ...rest, maxDailyMinutes } : rest;
    }),
  }));

  let resolvedConstraintsData = constraintsData;
  if (resolvedConstraintsData && resolvedConstraintsData.Default !== undefined && !Array.isArray(resolvedConstraintsData.Default)) {
    const rc = resolvedConstraintsData.Default as import('@edt-ts/scheduler-common').ResourceConstraints;
    const weekKey = `S${weekNum}`;
    resolvedConstraintsData = {
      ...resolvedConstraintsData,
      Default: (rc[weekKey] ?? rc.default ?? []) as import('@edt-ts/scheduler-common').TimeSlot[],
    };
  }

  const effectiveConstraints = applyBlockedZonesToConstraints(resolvedResources, resolvedConstraintsData, blockedZones, weekNum);
  const hasConstraints = !!constraintsData || blockedZones.length > 0;
  const options: Record<string, unknown> = { ...schedulerConfig };

  return {
    week: weekNum,
    resources: resolvedResources,
    courses: coursesWithEnforced,
    ...(hasConstraints ? { constraints: effectiveConstraints } : {}),
    ...(groups && groups.length > 0 ? { groups } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

export interface ScheduleStatus {
  message: string;
  kind: 'ok' | 'err' | 'inf';
}

/**
 * Construit le message de statut UI à partir d'un résultat de planification.
 */
export function buildScheduleStatus(result: ScheduleResult): ScheduleStatus {
  const best = result.solution;

  // Les types hors périmètre du moteur (`Autonomie`) reviennent dans `neutralizedTasks` alors
  // qu'ils n'ont jamais été soumis : ils ne sont pas un échec du moteur et ne doivent donc pas
  // être comptés ici. Sans ce filtre, `isComplete` passé à `true` au §6.4 produirait la phrase
  // contradictoire « ✅ Planification complète — 3 cours non placé(s) ».
  const engineFailures = (best?.neutralizedTasks ?? []).filter((n) => n.reasonSlug !== 'excluded-type');

   if (!best || best.tasks.length === 0) {
    const neutralizedMsg = engineFailures.length ? ` — ${engineFailures.length} cours neutralisé(s)` : '';
    // Deux situations opposées que l'ancien texte confondait (§5.3) : une contradiction prouvée
    // ne se résout pas en attendant plus longtemps, un budget épuisé peut-être si.
    const causeMsg =
      best?.noSolutionStatus === 'infeasible'
        ? ' — contraintes contradictoires : aucun emploi du temps ne peut les satisfaire'
        : best?.noSolutionStatus === 'unknown'
          ? ' — temps de calcul épuisé avant la première solution : réessayez avec un délai plus long'
          : '';
    return {
      message: `❌ Aucune solution trouvée${neutralizedMsg}${causeMsg}`,
      kind: 'err',
    };
  }
  const neutralizedMsg = engineFailures.length
    ? ` — ${engineFailures.length} cours non placé(s)` : '';
  const provenMsg = !best.isComplete && best.provenOptimal
    ? ' — optimum prouvé : le moteur ne placera pas plus sans relâchement de contraintes'
    : '';
  return {
    message: `${best.isComplete ? '✅ Planification complète' : '⚠️ Incomplète'}${neutralizedMsg}${provenMsg}`,
    kind: best.isComplete ? 'ok' : 'err',
  };
}

// --------------------------------------------------------------------------
// API asynchrone (job queue)
// --------------------------------------------------------------------------

export class JobConflictError extends Error {
  constructor(public readonly existingJobId: string) {
    super('Un job est déjà en cours pour ce client.');
    this.name = 'JobConflictError';
  }
}

/**
 * Soumet un job de planification asynchrone.
 * Retourne immédiatement un { jobId } — le calcul s'effectue en arrière-plan.
 */
export async function submitJobAsync(
  params: RunScheduleParamsFromData,
  clientId: string,
): Promise<JobSubmitResponse> {
  const { week, courses, resources, constraintsData, enforcedMap, blockedZones, schedulerConfig, groups } = params;
  const payload = _buildPayload(week, resources, courses, constraintsData, enforcedMap, blockedZones, schedulerConfig, groups);

  const endpoint = `${API_BASE}/api/schedule/v2/async`;
  console.groupCollapsed(`📤 Requête ${endpoint}`);
  console.log(payload);
  console.groupEnd();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': clientId,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`L'API a répondu avec une erreur ${response.status} : ${rawText.slice(0, 200)}`);
  }

  console.groupCollapsed(`📥 Réponse ${endpoint}`);
  console.log(data);
  console.groupEnd();

  if (response.status === 409) {
    const d = data as { error?: string; existingJobId?: string };
    throw new JobConflictError(d.existingJobId ?? '');
  }
  if (!response.ok) {
    const d = data as { error?: string };
    throw new Error(d?.error ?? `Erreur ${response.status}`);
  }

  return data as JobSubmitResponse;
}

/** Interroge le statut d'un job. */
export async function pollJob(jobId: string): Promise<JobStatusResponse> {
  const endpoint = `${API_BASE}/api/schedule/jobs/${jobId}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Erreur lors du polling (${response.status})`);
  }
  const data = await response.json() as JobStatusResponse;
  console.groupCollapsed(`📥 Poll ${endpoint}`);
  console.log(data);
  console.groupEnd();
  return data;
}

/** Annule ou supprime un job. */
export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`${API_BASE}/api/schedule/jobs/${jobId}`, { method: 'DELETE' });
}
