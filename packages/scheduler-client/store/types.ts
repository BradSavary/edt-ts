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
}

/**
 * État mutable par solution (overrides, placements, pioche).
 * Sauvegardé et restauré lors des changements de solution.
 */
export interface SolutionState {
  taskOverrides: Record<string, PlacedTaskOverride>;
  placedNeutralizedTasks: PlacedNeutralizedTask[];
  manuallyNeutralizedTasks: ManuallyNeutralizedTask[];
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
