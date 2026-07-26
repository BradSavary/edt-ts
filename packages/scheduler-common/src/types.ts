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

/**
 * Certificat individuel de la borne inférieure racine (docs/PlanOptionalTasksP2Preuve.md) :
 * une ressource (ou un cluster de groupes) dont le bin-packing exact des tâches obligatoires
 * prouve qu'au moins `lb` d'entre elles ne peuvent pas toutes être placées.
 */
export interface RootLowerBoundCertificateJSON {
  resourceIds: string[];
  taskIds: string[];
  lb: number;
  /** Résumé lisible (demande, caps par jour) — affichable tel quel. */
  note: string;
}

/**
 * Borne inférieure racine sur le nombre de tâches devant être sautées, calculée avant toute
 * recherche (certificats de bin-packing exact, mono-ressource + cluster de groupes, combinés
 * par sélection disjointe). Sûre par construction : `lb` ne dépasse jamais l'optimum réel.
 */
export interface RootLowerBoundJSON {
  lb: number;
  certificates: RootLowerBoundCertificateJSON[];
}

export interface ScheduleSolutionJSON {
  solutions: TaskSolutionJSON[];
  isComplete: boolean;
  score?: number;
  neutralizedTasks?: NeutralizedTaskInfoJSON[];
  /**
   * Présent uniquement pour searchStrategy: 'maxPlacement'. `true` = l'arbre de recherche a été
   * épuisé sous les limites : aucune solution plaçant plus de tâches n'est ATTEIGNABLE PAR LE
   * MOTEUR. Preuve relative au modèle de placement (créneaux au-plus-tôt, combinaison de
   * ressources choisie par heuristique et non branchée — cf. docs/AuditConformiteMCV.md), pas au
   * sens MILP/CP-SAT sur l'espace combinatoire complet. Absolue dans deux cas : 0 tâche sautée,
   * ou instance sans alternatives de ressources. L'objectif prouvé est le NOMBRE de tâches
   * placées, pas le score.
   */
  provenOptimal?: boolean;
  /**
   * Présent uniquement pour searchStrategy: 'maxPlacement'. Borne inférieure racine calculée
   * avant la recherche (docs/PlanOptionalTasksP2Preuve.md) — indépendante de `provenOptimal`,
   * qui peut être `true` grâce à cette borne même quand la garde historique (maxEliminations)
   * seule ne le permettrait pas.
   */
  rootBound?: RootLowerBoundJSON;
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
  /**
   * Paramètre transitoire : si true, l'ensemble de conflit d'une impasse est calculé par
   * contrefactuel (ensemble minimal de coupables, deletion-MUS) au lieu du scan d'occupation
   * approximatif — mesuré à 66,8% de faux positifs sur données réelles. N'influence que les
   * cibles d'élimination, jamais l'exploration. Défaut : false (comportement historique).
   */
  conflictSetExact?: boolean;
  /**
   * Paramètre transitoire : si true, le B&B (`OptionalTasksScheduler`, `searchStrategy:
   * 'maxPlacement'`) branche sur les combinaisons de ressources alternatives d'une unité — pas
   * seulement le créneau le plus tôt du meilleur combo comme aujourd'hui — levant l'écart
   * « meilleur combo vs union » de la recherche exacte identifié dans docs/AuditConformiteMCV.md
   * §3.2 (le tri MCV, lui, reste inchangé). Complétude accrue au prix d'un facteur de
   * branchement plus élevé (×2,2-2,7 mesuré sur le projet réel, docs/PlanComboBranchementBB.md
   * §1). Sans effet si `searchStrategy` n'est pas 'maxPlacement'. Défaut : false (comportement
   * historique).
   */
  comboBranching?: boolean;
  /**
   * Stratégie de recherche du moteur (défaut : 'elimination').
   * - 'elimination' : moteur historique — résolution gourmande, élimination itérative des unités
   *   les plus bloquantes, jusqu'à maxSolutions solutions.
   * - 'maxPlacement' : branch-and-bound sur les sauts (OptionalTasksScheduler) — maximise le
   *   nombre de tâches placées, jamais pire que 'elimination' (warm start), une seule solution
   *   (la meilleure), maxSolutions ignoré ; peut PROUVER l'optimalité du résultat relativement
   *   au modèle de placement du moteur (voir provenOptimal pour la portée exacte de la preuve).
   *   Le résultat partiel est un diagnostic pour la boucle de relâchement, pas une solution
   *   finale (docs/ConceptionTachesOptionnelles.md §1).
   */
  searchStrategy?: 'elimination' | 'maxPlacement';
  /**
   * Si true, une passe de réparation post-résolution (`Scheduler.repairNeutralized`,
   * docs/PlanPostRepair.md) tente de re-placer les unités neutralisées par
   * `solveWithElimination` — par sondage direct, puis par swap de combo à start constant
   * d'une unité déjà placée. Ne modifie jamais `_backtrack`, le blâme, ni l'élimination —
   * une révision APRÈS coup, seulement là où un échec avéré le réclame. Sans effet si
   * `searchStrategy` vaut 'maxPlacement' (hors périmètre, §1 du plan). Défaut : true
   * (gate §5 validé par Frédéric le 23/07/2026 sur le projet réel : 0 à 3 tâches
   * supplémentaires placées, coût négligeable — l'option reste débrayable dans l'UI).
   */
  postRepair?: boolean;
  /** Moteur de planification (défaut 'core'). 'cpsat' = 2e moteur OR-Tools (passerelle Python). */
  engine?: 'core' | 'cpsat';
  /**
   * CP-SAT uniquement — préférence DOUCE : dans chaque demi-journée où un enseignant est présent,
   * coller ses cours (minimiser les trous À L'INTÉRIEUR d'un bloc matin/après-midi). N'interdit ni
   * ne pénalise d'être présent matin ET après-midi, ni sur plusieurs jours. Optimisée à nombre de
   * cours placés CONSTANT (résolution 2 passes) : ne sacrifie jamais un placement ni ne viole une
   * contrainte dure. Combinable avec `minimizeTeacherDays`. Sans effet sur le core. Défaut : false.
   */
  compactTeacherHalfDays?: boolean;
  /**
   * CP-SAT uniquement — préférence DOUCE : concentrer les cours d'un enseignant sur le moins de
   * JOURNÉES distinctes possible (remplir matin+après-midi d'un jour plutôt qu'étaler). Mêmes
   * garanties que ci-dessus (à placement constant, 2 passes). Combinable avec
   * `compactTeacherHalfDays`. Sans effet sur le moteur core. Défaut : false.
   */
  minimizeTeacherDays?: boolean;
  /**
   * CP-SAT uniquement — préférence DOUCE : équilibrer la charge quotidienne d'un enseignant entre
   * les jours où il est présent (minimiser sa charge journalière maximale), pour éviter qu'il soit
   * surchargé un jour et presque vide un autre. N'AJOUTE jamais de jour de présence : activée, elle
   * minimise d'abord le nombre de jours (comme `minimizeTeacherDays`) puis équilibre CES jours.
   * Mêmes garanties que les autres douces (à placement constant, résolution lexicographique) : ne
   * sacrifie jamais un placement ni ne viole une contrainte dure. Combinable avec
   * `compactTeacherHalfDays` et `minimizeTeacherDays`. Sans effet sur le moteur core. Défaut : false.
   */
  balanceTeacherDailyLoad?: boolean;
  /**
   * CP-SAT uniquement — préférence DOUCE : pénalise le trou de midi d'un enseignant présent matin
   * et après-midi, au-delà de la pause déjeuner (limite les journées à faible ratio cours/amplitude,
   * ex. 8h+18h). Ignorée si la pause n'est pas fixe. Défaut : false.
   */
  crossNoonGap?: boolean;
  /**
   * CP-SAT uniquement — préférence DOUCE (grand confort) : pour un enseignant, garder la même salle
   * d'un cours au suivant dans une même demi-journée quand une salle commune existe. Appliquée en
   * dernier, à placement figé — ne modifie jamais l'emploi du temps ni les autres préférences.
   * Défaut : false.
   */
  minimizeTeacherRoomChanges?: boolean;
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
  conflictSetExact: false,
  comboBranching: false,
  searchStrategy: 'elimination',
  postRepair: true,
  engine: 'core',
  compactTeacherHalfDays: false,
  minimizeTeacherDays: false,
  balanceTeacherDailyLoad: false,
  crossNoonGap: false,
  minimizeTeacherRoomChanges: false,
};