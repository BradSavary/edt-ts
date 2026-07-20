// ── Types de session planning (non persistés) ──────────────────────────────

/**
 * Override de position et/ou de ressources pour une tâche placée manuellement
 * via drag-and-drop ou édition dans le calendrier.
 */
export interface PlacedTaskOverride {
  startTime: number;
  teachers: string[];
  groups: string[];
  rooms: string[];
  /** Durée surchargée (minutes). Si absent, utilise la durée du cours original. */
  duration?: number;
  /** Violation de contrainte détectée au moment du placement. */
  constraintViolation?: 'red' | 'orange' | 'none';
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

/**
 * État mutable par solution (overrides, placements, pioche).
 * Sauvegardé et restauré lors des changements de solution.
 */
export interface SolutionState {
  taskOverrides: Record<string, PlacedTaskOverride>;
  placedNeutralizedTasks: PlacedNeutralizedTask[];
  manuallyNeutralizedTasks: ManuallyNeutralizedTask[];
  autonomyDistributions: Record<string, AutonomyDistribution>;
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
