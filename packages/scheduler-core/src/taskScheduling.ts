import { Task, Resource, ResourceType, Availability } from '@edt-ts/scheduler-common';
import {
  type PriorityMeasure, type FloatingLunchWindow,
  INFEASIBLE_MEASURE, measureProfile, comparePriorityMeasure, splitFloatingLunchBreak, truncateProfile,
} from './priorityMeasure.js';

/**
 * Logique de décision de placement propre à une `Task` (scheduler-common), déplacée
 * ici depuis `Task` — scheduler-common ne doit contenir que le modèle de domaine et
 * la construction du problème, pas les décisions de planification. Fonctions libres
 * (plutôt que méthodes) car utilisées à la fois par `TaskUnit` (une tâche) et
 * `TaskGroupUnit` (plusieurs tâches membres, sans wrapper individuel par tâche).
 */

/** Retourne toutes les combinaisons de ressources applicables à `task` (produit cartésien des alternatives par type). */
export function getApplicableResources(task: Task): Resource[][] {
  const allGroups: Resource[][] = [
    ...task.resources[ResourceType.TEACHER],
    ...task.resources[ResourceType.ROOM],
    ...task.resources[ResourceType.GROUP],
  ];

  if (allGroups.length === 0) return [];

  function cartesian(arrays: Resource[][]): Resource[][] {
    return arrays.reduce<Resource[][]>((acc, curr) => {
      if (acc.length === 0) {
        return curr.map(resource => [resource]);
      }
      const result: Resource[][] = [];
      for (const combination of acc) {
        for (const resource of curr) {
          result.push([...combination, resource]);
        }
      }
      return result;
    }, []);
  }

  return cartesian(allGroups);
}

/** Intersection réelle (sans correctif de score) des disponibilités des ressources d'un combo — placement réel. */
export function intersectResources(resources: Resource[]): Availability {
  if (resources.length === 0) {
    return new Availability();
  }

  let result = resources[0].availability.copy();
  for (let i = 1; i < resources.length; i++) {
    result = result.intersect(resources[i].availability);
    if (result.isEmpty()) {
      break;
    }
  }
  return result;
}

/**
 * Variante de `intersectResources` réservée au calcul du score (§5.1/§5.5) : applique
 * le découpage de pause flottante (`splitFloatingLunchBreak`) aux ressources GROUP
 * avant intersection. Délibérément dupliquée plutôt que de paramétrer
 * `intersectResources` : garde le chemin de placement réel totalement à l'écart de
 * cette logique — aucun risque qu'un appel futur y injecte accidentellement la
 * correction de score.
 */
function intersectResourcesForScoring(resources: Resource[], floatingLunch: FloatingLunchWindow | null): Availability {
  if (resources.length === 0) {
    return new Availability();
  }

  const profileFor = (r: Resource): Availability =>
    (floatingLunch && r.type === ResourceType.GROUP) ? splitFloatingLunchBreak(r.availability, floatingLunch) : r.availability;

  let result = profileFor(resources[0]).copy();
  for (let i = 1; i < resources.length; i++) {
    result = result.intersect(profileFor(resources[i]));
    if (result.isEmpty()) {
      break;
    }
  }
  return result;
}

/**
 * Meilleur profil de disponibilité (avant réduction par durée) parmi toutes les
 * combinaisons de ressources applicables de `task` (`getApplicableResources`), pas
 * seulement la combinaison actuellement décidée par l'unité qui l'utilise. La tâche
 * n'a besoin que d'une seule combinaison qui fonctionne : sa vraie marge de manœuvre
 * est bornée par sa meilleure option. Voir §5.1/§5.3 de docs/HeuristiquePriorite-Conception.md.
 *
 * Retourne le profil lui-même (pas juste sa mesure) pour permettre la troncature par
 * échéance des dépendants (§5.6, `TaskUnit`/`TaskGroupUnit`) — pas de cache (profondeur
 * d'arbre de dépendance faible en pratique, voir §5.6 du document).
 *
 * `floatingLunch`, si fourni, retranche une pause méridienne flottante des profils des
 * ressources de type GROUP avant la mesure (§5.5) — correctif de lecture pour le score
 * uniquement, voir `intersectResourcesForScoring`.
 *
 * `deadline`, si fourni (typiquement l'échéance imposée par les dépendants, §5.6),
 * tronque CHAQUE combo avant de le mesurer et de le comparer aux autres — pas
 * seulement le combo gagnant après coup. L'ordre importe : comparer des profils bruts
 * puis tronquer le gagnant peut sélectionner un combo sous-optimal (ex. un combo à 2
 * fenêtres étroites bat à tort un combo à 1 fenêtre large sur la comparaison brute,
 * alors qu'une fois tronqués par l'échéance, c'est l'inverse — vérifié à la main, voir
 * la mémoire de suivi du projet).
 */
export function getBestSchedulingProfile(task: Task, floatingLunch: FloatingLunchWindow | null = null, deadline: number = Infinity): Availability {
  let bestProfile: Availability = new Availability();
  let bestMeasure: PriorityMeasure = INFEASIBLE_MEASURE;
  for (const combo of getApplicableResources(task)) {
    const raw = intersectResourcesForScoring(combo, floatingLunch);
    const profile = deadline === Infinity ? raw : truncateProfile(raw, deadline);
    const measure = measureProfile(profile, task.duration);
    if (comparePriorityMeasure(measure, bestMeasure) > 0) {
      bestMeasure = measure;
      bestProfile = profile;
    }
  }
  return bestProfile;
}
