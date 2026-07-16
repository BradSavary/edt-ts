/**
 * Types partagés entre scheduler-common, scheduler-core et les applications clientes.
 * Ces types correspondent aux structures de données JSON utilisées pour les contraintes et les cours.
 */

export interface TimeSlot {
  days: string;
  from: string;
  to: string;
}

export interface ResourceConstraints {
  default?: TimeSlot[];
  [weekKey: string]: TimeSlot[] | undefined; // S36, S38, etc. — toujours un tableau si présent
}

export interface ConstraintsData {
  Default?: TimeSlot[];
  [resourceId: string]: TimeSlot[] | ResourceConstraints | undefined;
}

/**
 * Déclaration d'un groupe de tâches transmise dans le payload.
 * Les tâches membres référencent ce groupe via leur champ `taskGroupId`.
 *  - parallel  : toutes les tâches démarrent au même instant
 *  - sequential : les tâches s'enchaînent sans gap (fin de l'une = début de la suivante)
 */
export interface TaskGroupDeclaration {
  id: string;
  type: 'parallel' | 'sequential';
}

/**
 * Un élément de ressource est soit un identifiant unique (string),
 * soit un groupe d'alternatives dont une seule sera choisie (string[]).
 *
 * Convention : [A, [B, C]] signifie A ET (B OU C).
 */
export type ResourceEntry = string | string[];

/**
 * Placement imposé pour un cours : heure et ressources fixes, sans alternatives.
 * Prioritaire sur les disponibilités des ressources (peut générer un warning).
 */
export interface EnforcedData {
  startTime: number;   // Minutes depuis lundi minuit
  teacher: string[];   // IDs exacts, sans alternatives
  groups: string[];
  rooms: string[];
}

export interface CourseTaskData {
  week: number;
  semester: number;
  level: number;
  code: string;
  type: string;
  teacher: ResourceEntry[];
  groups: ResourceEntry[];
  name: string;
  rooms: ResourceEntry[];
  duration: number;
  enforced?: EnforcedData;
  /** Identifiant du groupe auquel appartient cette tâche (référence une TaskGroupDeclaration). */
  taskGroupId?: string;
}

export interface CoursesData {
  weeks: number;
  courses: CourseTaskData[];
}

export interface ResourceData {
  id: string;
  info?: string; // JSON string pour les métadonnées spécifiques au type (ex: '{"status":"VACATAIRE"}')
  /** Durée maximale d'utilisation quotidienne en minutes. Aucune limite si absent. */
  maxDailyMinutes?: number;
}

export interface ResourceGroupData {
  resourceType: 'teacher' | 'room' | 'group';
  resources: ResourceData[];
}

/**
 * Données brutes transmises à Loader.loadFromRawData() (mode API REST).
 * Correspond au corps JSON du POST /api/schedule.
 */
export interface TaskGroupDeclaration {
  /** Identifiant du groupe, défini par l'utilisateur. Doit correspondre aux `taskGroupId` des CourseTaskData. */
  id: string;
  /** Type du groupe : 'parallel' (même heure de début) ou 'sequential' (tâches consécutives). */
  type: 'parallel' | 'sequential';
}

export interface RawScheduleData {
  week: number;
  resources: ResourceGroupData[];
  courses: CourseTaskData[];
  constraints?: ConstraintsData;
  groups?: TaskGroupDeclaration[];
}

/**
 * Représentation JSON sérialisable d'une tâche planifiée.
 * Correspond à un élément du tableau `solutions` retourné par POST /api/schedule.
 */
export interface TaskSolutionJSON {
  taskId: string;
  code: string;
  name: string;
  type: string;
  week: number;
  duration: number;
  startTime: number;
  resources: { id: string; type: string }[];
  taskGroupId?: string;
}


export interface ResourceAvailabilitySnapshotJSON {
  resourceId: string;
  resourceType: string;
  availableMinutes: number;
}

export interface NeutralizedTaskInfoJSON {
  task: TaskSolutionJSON;
  eliminationRound: number;
  failureCount: number;
  requiredMinutes?: number;
  schedulableMinutes?: number;
  resourceSnapshots?: ResourceAvailabilitySnapshotJSON[];
  reason: string;
  taskGroupId?: string;
}

export interface ScheduleSolutionJSON {
  solutions: TaskSolutionJSON[];
  isComplete: boolean;
  score?: number;
  neutralizedTasks?: NeutralizedTaskInfoJSON[];
}

// --------------------------------------------------------------------------
// Types pour le système de jobs asynchrones
// --------------------------------------------------------------------------

/** Statuts possibles d'un job de planification asynchrone. */
export type JobStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

/** Réponse à POST /api/schedule/v2/async — retournée immédiatement après soumission. */
export interface JobSubmitResponse {
  jobId: string;
}

/** Réponse à GET /api/schedule/jobs/:id. Le champ `result` n'est présent que si status === 'done'. */
export interface JobStatusResponse {
  jobId: string;
  clientId: string;
  status: JobStatus;
  week: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: ScheduleSolutionJSON[];
  error?: string;
}

/**
/**
 * Aucune gestion particulière de la pause méridienne.
 */
export interface LunchBreakNone {
  type: 'none';
}

/**
 * Pause méridienne fixe : même tranche horaire chaque jour.
 * Les heures sont exprimées en format "HH:MM" (ex : "12:30", "14:00").
 */
export interface LunchBreakFixed {
  type: 'fixed';
  /** Heure de début de la pause (ex : "12:30") */
  from: string;
  /** Heure de fin de la pause (ex : "14:00") */
  to: string;
}

/**
 * Pause méridienne flottante : durée fixe à placer dans une fenêtre horaire.
 * Les heures sont exprimées en format "HH:MM".
 */
export interface LunchBreakFloating {
  type: 'floating';
  /** Durée de la pause en minutes (ex : 60) */
  duration: number;
  /** Début de la fenêtre dans laquelle la pause doit avoir lieu (ex : "12:00") */
  earliest: string;
  /** Fin de la fenêtre dans laquelle la pause doit avoir lieu (ex : "14:00") */
  latest: string;
}

/** Union discriminée des modes de gestion de la pause méridienne. */
export type LunchBreakConfig = LunchBreakNone | LunchBreakFixed | LunchBreakFloating;

/**
 * Options de configuration du solver, transmissibles de l'API vers le moteur.
 * Tous les champs sont optionnels — les valeurs par défaut sont appliquées dans Schedule.
 */
export interface SchedulerConfig {
  /** Nombre maximum de solutions complètes à trouver (défaut : 6) */
  maxSolutions?: number;
  /** Timeout en secondes avant arrêt du backtracking (défaut : 180) */
  timeoutSeconds?: number;
  /** Limite de sécurité sur le nombre d'itérations (défaut : 1 000 000) */
  maxIterations?: number;
  /** Nombre de tâches à remonter/éliminer dans les stratégies priority-retry / elimination (défaut : 3) */
  maxEliminations?: number;
  /** Gestion de la pause méridienne (défaut : aucune) */
  lunchBreak?: LunchBreakConfig;
  /** Si true, ignore les limites maxDailyMinutes de toutes les ressources (défaut : false) */
  ignoreDailyLimits?: boolean;
  /**
   * Paramètre transitoire : si true, active le Conflict Ordering Search (Gay et al., CP 2015) —
   * les unités récemment en échec sont priorisées dans le tri dynamique, devant le score MCV.
   * Sans impasse, strictement sans effet (ordre MCV inchangé). Défaut : false (comportement
   * historique) — à activer explicitement pour comparer avec/sans sur le projet réel avant
   * toute généralisation (cf. incidents DailyUsageReader et tie-break popularité, revertés).
   */
  conflictOrderingSearch?: boolean;
}

/** Valeurs par défaut appliquées par le solver lorsqu'une option n'est pas fournie. */
export const DEFAULT_SCHEDULER_CONFIG: Required<SchedulerConfig> = {
  maxSolutions: 6,
  timeoutSeconds: 180,
  maxIterations: 1_000_000,
  maxEliminations: 3,
  lunchBreak: { type: 'none' },
  ignoreDailyLimits: false,
  conflictOrderingSearch: false,
};