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
  /**
   * `pre-enforced` uniquement : imposition propagée automatiquement depuis un groupe de tâches
   * (jamais saisie à la main). Non persisté — exclu de `manualEnforcedMap` par
   * `enforcedMapFromPlacements`, recalculé à la lecture (§4.2 du plan).
   */
  derived?: true;
}

/** Origine d'un non-placement — qui a décidé, et à quel moment. */
export type UnplacedOrigin =
  | 'user-pre'   // exclue par l'utilisateur AVANT planification : jamais envoyée au moteur
  | 'engine'     // envoyée au moteur, qu'il n'a pas pu placer
  | 'user-post'; // placée par le moteur, retirée ensuite par l'utilisateur

export interface Unplaced {
  /** Tâche non placée — `CourseTaskDataWithId.id`, jamais préfixé. */
  taskId: string;
  origin: UnplacedOrigin;
  /**
   * Diagnostics du moteur. Présents si et seulement si `origin === 'engine'`.
   * Limités à ce que l'API produit réellement : CP-SAT n'émet que `reason`.
   */
  diagnostics?: { reason: string };
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
