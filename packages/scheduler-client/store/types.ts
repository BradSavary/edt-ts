// ── Types de session planning (non persistés) ──────────────────────────────

/** Origine d'un placement — d'où vient la décision de poser cette tâche là. */
export type PlacementOrigin =
  | 'pre-enforced'   // posé à la main AVANT toute planification auto ; transmis au moteur
  | 'auto'           // posé par le moteur
  | 'post-enforced'; // retouche manuelle d'un placement auto

export interface Placement {
  /**
   * Identité du placement. Égale à `taskId` dans le cas courant (un placement par tâche) ;
   * distincte pour les fragments d'une même tâche (morceaux d'Autonomie répartie).
   */
  placementId: string;
  /** Tâche placée — c'est `CourseTaskDataWithId.id` (cf. docs/PlanStableTaskIds.md). */
  taskId: string;
  /** Minutes depuis lundi minuit. */
  startTime: number;
  /** Durée effective si elle diffère de celle du cours (retouche manuelle, fragment). */
  duration?: number;
  /** Combo exact appliqué, sans alternatives. */
  resources: { teachers: string[]; groups: string[]; rooms: string[] };
  origin: PlacementOrigin;
  /** Violation détectée au moment du placement. */
  constraintViolation?: 'red' | 'orange' | 'none';
  /**
   * `pre-enforced` uniquement : imposition propagée automatiquement depuis un groupe de tâches
   * (jamais saisie à la main). Non persisté — exclu de `manualEnforcedMap` par
   * `enforcedMapFromPlacements`, recalculé à la lecture (§4.2 du plan).
   */
  derived?: true;
}

/**
 * Tâche planifiée déposée manuellement dans la zone de neutralisation ("pioche").
 */
export interface ManuallyNeutralizedTask {
  taskId: string;
  code: string;
  name: string;
  type: string;
  duration: number;
  teachers: string[];
  groups: string[];
  rooms: string[];
}

/**
 * Tâche neutralisée placée manuellement sur le calendrier.
 * Contient les données complètes nécessaires à l'affichage.
 */
export interface PlacedNeutralizedTask {
  taskId: string;
  code: string;
  name: string;
  type: string;
  startTime: number; // minutes depuis lundi minuit
  duration: number;
  teachers: string[];
  groups: string[];
  rooms: string[];
  /** Violation de contrainte détectée au moment du placement. */
  constraintViolation?: 'red' | 'orange' | 'none';
  /**
   * Si ce placement est un morceau d'Autonomie réparti automatiquement, taskId du
   * cours Autonomie source (la carte pilote dans la pioche). Absent pour un placement
   * manuel ordinaire. Sert à retrouver/retirer tous les morceaux d'une même répartition.
   */
  sourceAutonomyId?: string;
}

/**
 * Suivi d'une répartition automatique d'un cours Autonomie neutralisé. Les morceaux
 * eux-mêmes sont désormais des `PlacedNeutralizedTask` de plein droit (déplaçables,
 * éditables, exportés en iCal), reliés à cette entrée par leur `sourceAutonomyId`.
 * Cette entrée ne sert plus qu'à piloter la carte d'origine dans la pioche :
 * `totalDuration`/`remainingDuration` alimentent l'affichage, `pieceIds` liste les
 * placements créés. "Annuler la répartition" retire ces morceaux et supprime l'entrée.
 */
export interface AutonomyDistribution {
  originalTaskId: string;
  totalDuration: number;
  remainingDuration: number;
  /** taskIds des `PlacedNeutralizedTask` créés pour cette répartition. */
  pieceIds: string[];
}

// ── Persistance de semaine (localStorage) ──────────────────────────────────

/**
 * BlockedZone sérialisée pour le localStorage (Date → ISO string).
 */
export interface SerializedBlockedZone {
  id: string;
  start: string;
  end: string;
  label?: string;
  source?: 'manual' | 'vacation' | 'public-holiday';
}
