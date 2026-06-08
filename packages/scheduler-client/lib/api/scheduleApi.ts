import type { RawScheduleData, TaskSolutionJSON, NeutralizedTaskInfoJSON, CourseTaskData, EnforcedData, ConstraintsData, ResourceGroupData, SchedulerConfig, TaskGroupDeclaration, JobSubmitResponse, JobStatusResponse } from '@edt-ts/scheduler-common';
import { type BlockedZone, applyBlockedZonesToConstraints } from '@/lib/calendar/blockedZones';

// En dev : vide → les rewrites Next.js proxifient /api/* vers localhost:3000
// En prod : '/edtts' → les appels vont vers /edtts/api/* (proxifié par Apache .htaccess)
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export interface NormalizedSolution {
  isComplete: boolean;
  score?: number;
  tasks: TaskSolutionJSON[];
  neutralizedTasks?: NeutralizedTaskInfoJSON[];
}

export interface ScheduleResult {
  solutions: NormalizedSolution[];
  week: number;
}

export interface RunScheduleParamsFromData {
  week: number;
  courses: CourseTaskData[];
  resources: ResourceGroupData[];
  constraintsData: ConstraintsData | null;
  enforcedMap: Record<string, EnforcedData>;
  blockedZones: BlockedZone[];
  schedulerConfig?: SchedulerConfig;
  groups?: TaskGroupDeclaration[];
}

function _buildPayload(
  weekNum: number,
  resources: ResourceGroupData[],
  courses: CourseTaskData[],
  constraintsData: ConstraintsData | null,
  enforcedMap: Record<string, EnforcedData>,
  blockedZones: BlockedZone[],
  schedulerConfig?: SchedulerConfig,
  groups?: TaskGroupDeclaration[],
): RawScheduleData & { options?: Record<string, unknown> } {
  const coursesWithEnforced = courses.map((course, i) => {
    const enforced = enforcedMap[String(i)];
    return enforced ? { ...course, enforced } : course;
  });

  let resolvedConstraintsData = constraintsData;
  if (resolvedConstraintsData && resolvedConstraintsData.Default !== undefined && !Array.isArray(resolvedConstraintsData.Default)) {
    const rc = resolvedConstraintsData.Default as import('@edt-ts/scheduler-common').ResourceConstraints;
    const weekKey = `S${weekNum}`;
    resolvedConstraintsData = {
      ...resolvedConstraintsData,
      Default: (rc[weekKey] ?? rc.default ?? []) as import('@edt-ts/scheduler-common').TimeSlot[],
    };
  }

  const effectiveConstraints = applyBlockedZonesToConstraints(resources, resolvedConstraintsData, blockedZones, weekNum);
  const hasConstraints = !!constraintsData || blockedZones.length > 0;
  const options: Record<string, unknown> = { ...schedulerConfig };

  return {
    week: weekNum,
    resources,
    courses: coursesWithEnforced,
    ...(hasConstraints ? { constraints: effectiveConstraints } : {}),
    ...(groups && groups.length > 0 ? { groups } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

/**
 * Logique commune : applique enforcedMap + blockedZones, construit le payload,
 * appelle l'API et normalise la réponse.
 */
async function _callScheduleApi(
  weekNum: number,
  resources: ResourceGroupData[],
  courses: CourseTaskData[],
  constraintsData: ConstraintsData | null,
  enforcedMap: Record<string, EnforcedData>,
  blockedZones: BlockedZone[],
  schedulerConfig?: SchedulerConfig,
  groups?: TaskGroupDeclaration[],
): Promise<ScheduleResult> {
  const payload = _buildPayload(weekNum, resources, courses, constraintsData, enforcedMap, blockedZones, schedulerConfig, groups);

  const endpoint = `${API_BASE}/api/schedule/v2`;
  console.groupCollapsed(`📤 Requête ${endpoint}`);
  console.log(payload);
  console.groupEnd();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  if (!response.ok) {
    const err = data as { error?: string };
    throw new Error(err?.error ?? `Erreur ${response.status}`);
  }

  const d = data as { solutions: TaskSolutionJSON[]; isComplete: boolean; score?: number; neutralizedTasks?: NeutralizedTaskInfoJSON[] }[];
  const normalized: NormalizedSolution[] = d.map((s) => ({
    isComplete: s.isComplete,
    score: s.score,
    tasks: s.solutions,
    neutralizedTasks: s.neutralizedTasks,
  }));

  if (normalized.length === 0) {
    throw new Error('Aucune solution trouvée.');
  }

  return { solutions: normalized, week: weekNum };
}

/**
 * Variante données pré-parsées : utilise les données déjà en mémoire (store).
 * Préférer cette fonction quand les données sont disponibles dans useSchedulerStore.
 */
export async function runScheduleRequestFromData(params: RunScheduleParamsFromData): Promise<ScheduleResult> {
  const { week, courses, resources, constraintsData, enforcedMap, blockedZones, schedulerConfig, groups } = params;

  if (week < 1 || week > 53) {
    throw new Error('"week" doit être un entier entre 1 et 53.');
  }
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('resources est requis et ne peut pas être vide.');
  }
  if (courses.length === 0) {
    throw new Error(`Aucun cours trouvé pour la semaine ${week}.`);
  }

  return _callScheduleApi(week, resources, courses, constraintsData, enforcedMap, blockedZones, schedulerConfig, groups);
}

export interface ScheduleStatus {
  message: string;
  kind: 'ok' | 'err' | 'inf';
}

/**
 * Construit le message de statut UI à partir d'un résultat de planification.
 */
export function buildScheduleStatus(result: ScheduleResult): ScheduleStatus {
  const best = result.solutions[0];
  const neutralizedMsg = best.neutralizedTasks?.length
    ? ` — ${best.neutralizedTasks.length} cours non placé(s)` : '';
  return {
    message: `${best.isComplete ? '✅ Planification complète' : '⚠️ Incomplète'} — ${result.solutions.length} solution(s)${neutralizedMsg}`,
    kind: best.isComplete ? 'ok' : 'err',
  };
}

// --------------------------------------------------------------------------
// API asynchrone (job queue)
// --------------------------------------------------------------------------

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

  const response = await fetch(`${API_BASE}/api/schedule/v2/async`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': clientId,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string; existingJobId?: string };
    throw new Error(data?.error ?? `Erreur ${response.status}`);
  }

  return response.json() as Promise<JobSubmitResponse>;
}

/** Interroge le statut d'un job. */
export async function pollJob(jobId: string): Promise<JobStatusResponse> {
  const response = await fetch(`${API_BASE}/api/schedule/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Erreur lors du polling (${response.status})`);
  }
  return response.json() as Promise<JobStatusResponse>;
}

/** Annule ou supprime un job. */
export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`${API_BASE}/api/schedule/jobs/${jobId}`, { method: 'DELETE' });
}
