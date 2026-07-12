import type { EnforcedData } from './types.ts';

/**
 * Interface représentant une unité planifiable.
 *
 * Une unité planifiable est soit une tâche atomique (`Task`),
 * soit un groupe de tâches simultanées (`TaskGroup`, implémenté ultérieurement).
 *
 * Modèle de domaine pur — la logique de décision de planification (combinaisons de
 * ressources, disponibilité calculée, état de recherche) vit exclusivement dans
 * scheduler-core (`ISchedulingUnit`, `TaskUnit`, `TaskGroupUnit`), pas ici.
 */
export interface ISchedulable {
  /** Identifiant unique de l'unité */
  readonly id: string;

  /** Durée en minutes */
  readonly duration: number;

  /** Vrai si l'unité a un placement imposé */
  readonly isEnforced: boolean;

  /** Données de placement imposé, si présentes */
  readonly enforced: EnforcedData | undefined;

  // --- Métadonnées de sortie (pour sérialisation JSON) ---
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly week: number;

  // --- Dépendances séquentielles ---

  getDependsOn(): ISchedulable | null;
  getDependentUnits(): ISchedulable[];
  hasDependentUnits(): boolean;
  setDependsOn(unit: ISchedulable): void;

  /**
   * @internal — appelé par setDependsOn pour maintenir le lien inverse.
   * À implémenter par chaque classe concrète.
   */
  _addDependentUnit(unit: ISchedulable): void;

  /**
   * @internal — appelé par setDependsOn pour supprimer le lien inverse.
   */
  _removeDependentUnit(unit: ISchedulable): void;
}
