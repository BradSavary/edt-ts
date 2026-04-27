import type { Availability } from './availability.ts';
import type { Resource } from './resource.ts';
import type { EnforcedData } from './types.ts';

/**
 * Interface représentant une unité planifiable.
 *
 * Une unité planifiable est soit une tâche atomique (`Task`),
 * soit un groupe de tâches simultanées (`TaskGroup`, implémenté ultérieurement).
 *
 * Le moteur de planification (`Schedule`) travaille exclusivement avec cette interface,
 * sans connaître le type concret sous-jacent.
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

  // --- Gestion des ressources ---

  /** Combinaison de ressources actuellement appliquée */
  appliedResources: Resource[];

  /** Retourne toutes les combinaisons applicables (produit cartésien) */
  getApplicableResources(): Resource[][];

  /** Retourne les ressources de la combinaison courante */
  getAllResources(): Resource[];

  /** Invalide le cache de disponibilité calculé (schedulable) */
  invalidateSchedulable(): void;

  /** Disponibilité résultante de l'intersection des ressources courantes */
  readonly schedulable: Availability;

  /** Vrai si le schedulable contient au moins un créneau de durée suffisante */
  hasSchedulableSlot(): boolean;

  // --- Heuristique vacataire (optionnelle, spécifique à Task) ---
  getTeacherResource?(): Resource | null;

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
