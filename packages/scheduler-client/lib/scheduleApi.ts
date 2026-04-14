import type { RawScheduleData, TaskSolutionJSON, CourseTaskData, EnforcedData, ConstraintsData, ResourceGroupData, SchedulerConfig } from '@edt-ts/scheduler-common';
import { type BlockedZone, applyBlockedZonesToConstraints } from '@/lib/blockedZones';

export interface NormalizedSolution {
  isComplete: boolean;
  score?: number;
  tasks: TaskSolutionJSON[];
  neutralizedTasks?: TaskSolutionJSON[];
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
  mode: 'standard' | 'elimination';
  schedulerConfig?: SchedulerConfig;
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
  mode: 'standard' | 'elimination',
  schedulerConfig?: SchedulerConfig,
): Promise<ScheduleResult> {
  const coursesWithEnforced = courses.map((course, i) => {
    const enforced = enforcedMap[String(i)];
    return enforced ? { ...course, enforced } : course;
  });

  const effectiveConstraints = applyBlockedZonesToConstraints(
    resources,
    constraintsData,
    blockedZones,
    weekNum,
  );
  const hasConstraints = !!constraintsData || blockedZones.length > 0;

  const options: Record<string, unknown> = { ...schedulerConfig };

  const payload: RawScheduleData & { options?: Record<string, unknown> } = {
    week: weekNum,
    resources,
    courses: coursesWithEnforced,
    ...(hasConstraints ? { constraints: effectiveConstraints } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };

  const endpoint = mode === 'elimination' ? '/api/schedule/elimination' : '/api/schedule';

  console.groupCollapsed(`📤 Payload envoyé à POST ${endpoint}`);
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

  let normalized: NormalizedSolution[];

  if (mode === 'standard') {
    const d = data as { solutionCount: number; solutions: { score?: number; isComplete: boolean; scheduledCount: number; conflictCount: number; tasks: TaskSolutionJSON[] }[] };
    normalized = d.solutions.map((s) => ({
      isComplete: s.isComplete,
      score: s.score,
      tasks: s.tasks,
    }));
  } else {
    const d = data as { solutions: TaskSolutionJSON[]; isComplete: boolean; score?: number; neutralizedTasks?: TaskSolutionJSON[] }[];
    normalized = d.map((s) => ({
      isComplete: s.isComplete,
      score: s.score,
      tasks: s.solutions,
      neutralizedTasks: s.neutralizedTasks,
    }));
  }

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
  const { week, courses, resources, constraintsData, enforcedMap, blockedZones, mode, schedulerConfig } = params;

  if (week < 1 || week > 53) {
    throw new Error('"week" doit être un entier entre 1 et 53.');
  }
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('resources est requis et ne peut pas être vide.');
  }
  if (courses.length === 0) {
    throw new Error(`Aucun cours trouvé pour la semaine ${week}.`);
  }

  return _callScheduleApi(week, resources, courses, constraintsData, enforcedMap, blockedZones, mode, schedulerConfig);
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
