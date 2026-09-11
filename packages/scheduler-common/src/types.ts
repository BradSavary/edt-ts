/**
 * Types partagés entre scheduler-common et les applications clientes.
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
  /**
   * Identifiant stable fourni par l'appelant. Quand il est présent, il devient le `taskId` de la
   * tâche, de bout en bout jusqu'à la réponse JSON. Absent (fixtures, scripts d'essai), on retombe
   * sur l'identifiant positionnel historique.
   */
  id?: string;
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


/**
 * Tâche que le moteur n'a pas pu placer. `reason` est le seul diagnostic produit : les compteurs
 * d'élimination et d'échec du moteur maison ont disparu avec lui (voir `docs/archive/`).
 */
export interface NeutralizedTaskInfoJSON {
  task: TaskSolutionJSON;
  reason: string;
  taskGroupId?: string;
}

export interface ScheduleSolutionJSON {
  solutions: TaskSolutionJSON[];
  isComplete: boolean;
  score?: number;
  neutralizedTasks?: NeutralizedTaskInfoJSON[];
  /**
   * `true` = CP-SAT a prouvé l'optimalité du nombre de tâches placées (arbre de recherche
   * épuisé sous les limites, aucune solution plaçant plus de tâches n'est atteignable).
   */
  provenOptimal?: boolean;
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
 * Aucun moteur ne l'implémente aujourd'hui (CP-SAT lève une erreur explicite dessus).
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
  /** Timeout en secondes avant arrêt du backtracking (défaut : 180) */
  timeoutSeconds?: number;
  /** Gestion de la pause méridienne (défaut : aucune) */
  lunchBreak?: LunchBreakConfig;
  /** Si true, ignore les limites maxDailyMinutes de toutes les ressources (défaut : false) */
  ignoreDailyLimits?: boolean;
  /**
   * Préférence DOUCE, PRIORITAIRE sur les autres : concentrer les cours d'un enseignant sur le
   * moins de JOURNÉES distinctes possible (remplir matin+après-midi d'un jour plutôt qu'étaler).
   * Optimisée à nombre de cours placés CONSTANT : ne sacrifie jamais un placement ni ne viole une
   * contrainte dure. Défaut : false.
   */
  minimizeTeacherDays?: boolean;
  /**
   * Préférence DOUCE : pour chaque demi-journée de présence d'un enseignant dont la charge est
   * sous-utilisée (≤ 2h — typiquement un unique cours isolé), essaie de la reporter sur une autre
   * demi-journée pour la vider, sans changer le nombre de jours de présence. Aucun plafond dur sur
   * la charge quotidienne : le report peut la dégrader autant que la disponibilité et le plafond
   * quotidien de l'enseignant le permettent. Ne sacrifie jamais un placement ni ne viole une
   * contrainte dure. Défaut : false.
   */
  reduceTeacherHalfDays?: boolean;
  /**
   * Préférence DOUCE : minimise TOUS les trous entre cours consécutifs d'un enseignant sur une
   * journée (pas seulement une demi-journée), à l'exception de la pause méridienne elle-même —
   * seule autorisée à excéder les autres trous. Si l'enseignant a des cours avant ET après la
   * pause, les resserre autour de celle-ci. Aucun seuil, aucun plafond dur : réduit autant que
   * possible sans jamais rendre le modèle infaisable. Fusion de deux préférences auparavant
   * séparées (compacité par demi-journée + trou de midi). Défaut : false.
   */
  compactTeacherDay?: boolean;
  /**
   * Préférence DOUCE (grand confort) : pour un enseignant, garder la même salle d'un cours au
   * suivant dans une même demi-journée quand une salle commune existe. Appliquée en dernier, à
   * placement figé — ne modifie jamais l'emploi du temps ni les autres préférences.
   * Défaut : false.
   */
  minimizeTeacherRoomChanges?: boolean;
}

/** Valeurs par défaut appliquées par le solver lorsqu'une option n'est pas fournie. */
export const DEFAULT_SCHEDULER_CONFIG: Required<SchedulerConfig> = {
  timeoutSeconds: 180,
  lunchBreak: { type: 'none' },
  ignoreDailyLimits: false,
  minimizeTeacherDays: false,
  reduceTeacherHalfDays: false,
  compactTeacherDay: false,
  minimizeTeacherRoomChanges: false,
};