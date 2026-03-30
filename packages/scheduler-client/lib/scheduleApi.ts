import type { RawScheduleData, TaskSolutionJSON, CourseTaskData, EnforcedData, ConstraintsData } from '@edt-ts/scheduler-common';
import { parseCsvCourses } from '@/lib/parseCsvCourses';
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

export interface RunScheduleParams {
  weekStr: string;
  resourcesFile: File;
  coursesCsvFile: File;
  constraintsData: ConstraintsData | null;
  enforcedMap: Record<string, EnforcedData>;
  blockedZones: BlockedZone[];
  mode: 'standard' | 'elimination';
}

async function readJSON<T>(file: File): Promise<T> {
  const text = await file.text();
  return JSON.parse(text) as T;
}

/**
 * Construit le payload, appelle l'API et normalise la réponse.
 * Lève une Error en cas de problème (validation, réseau, API).
 */
export async function runScheduleRequest(params: RunScheduleParams): Promise<ScheduleResult> {
  const { weekStr, resourcesFile, coursesCsvFile, constraintsData, enforcedMap, blockedZones, mode } = params;

  const weekNum = parseInt(weekStr, 10);
  if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) {
    throw new Error('"week" doit être un entier entre 1 et 53.');
  }

  const resources = await readJSON<RawScheduleData['resources']>(resourcesFile);
  const csvText = await coursesCsvFile.text();
  const courses: CourseTaskData[] = parseCsvCourses(csvText, weekNum);

  if (!Array.isArray(resources)) {
    throw new Error('Le fichier resources doit être un tableau JSON.');
  }
  if (courses.length === 0) {
    throw new Error(`Aucun cours trouvé pour la semaine ${weekNum} dans le CSV.`);
  }

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

  const payload: RawScheduleData & { options?: { eliminationCount?: number } } = {
    week: weekNum,
    resources,
    courses: coursesWithEnforced,
    ...(hasConstraints ? { constraints: effectiveConstraints } : {}),
    ...(mode === 'elimination' ? { options: { eliminationCount: 5 } } : {}),
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
