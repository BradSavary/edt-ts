import type { Resource } from './resource.ts';

/**
 * Tie-break déterministe entre combos de ressources à égalité de score (créneau identique,
 * ou faisabilité identique) — remplace un tirage aléatoire pour garantir un résultat
 * reproductible d'un run à l'autre sur un même payload (indispensable pour les tests/débogage).
 *
 * Critère principal : popularité de chaque ressource du combo, mesurée par le nombre total de
 * tâches (toutes confondues, pendantes ou déjà placées) qui la référencent (`resource.getTasks()`,
 * déjà disponible, aucune donnée nouvelle à calculer). On préfère consommer la ressource la MOINS
 * populaire, et préserver celle que le plus de tâches convoitent. Filet de sécurité final : ordre
 * lexicographique des identifiants, pour un déterminisme total en cas d'égalité stricte.
 *
 * Deux autres critères ont été essayés et écartés sur données réelles (payload semaine 38,
 * 109 unités, 3 runs par variante pour vérifier la reproductibilité) avant de retenir celui-ci :
 *  - Préférer la ressource la PLUS disponible (charge cumulée, "worst-fit") : bloque totalement
 *    le backtracking (0/109 solutions après 6 rounds d'élimination, chaque round épuisant son
 *    timeout) — vraisemblablement un effet de "ruée" où de nombreuses tâches convergent en même
 *    temps vers la ressource jugée "la plus libre à cet instant", créant une contention pire que
 *    le hasard qu'on cherchait à remplacer.
 *  - Préférer la ressource la MOINS disponible (charge cumulée, "best-fit") : fonctionnait
 *    (105-107/109) mais soulève un vrai risque signalé par Frédéric — consommer plus encore une
 *    ressource déjà rare peut l'épuiser au détriment d'une tâche plus tardive qui n'aurait aucune
 *    alternative vers elle. Le critère ne distingue pas "ressource abondante que personne d'autre
 *    ne réclame" de "ressource rare dont plusieurs tâches ont besoin".
 * Le critère de popularité retenu répond directement à ce risque (il préserve explicitement les
 * ressources contestées, indépendamment de leur charge instantanée) et donne un résultat encore
 * meilleur : 108/109 et 109/109 (100%) sur les deux payloads réels, stable sur 3 runs chacun.
 * Hypothèse sur l'écart de stabilité avec les deux critères de charge : la popularité est une
 * mesure STATIQUE (calculée une fois, ne varie pas pendant le backtracking), alors que la charge
 * cumulée fluctue à chaque réservation/annulation pendant la recherche — probable source de
 * l'instabilité/l'effet de ruée observé avec les critères dynamiques.
 */

/** Nombre total de tâches (toutes confondues) référençant chaque ressource du combo — plus bas = moins convoité. */
export function comboPopularityScore(combo: Resource[]): number {
  return combo.reduce((sum, r) => sum + r.getTasks().length, 0);
}

/** Clé de tri stable et unique pour un combo, utilisée comme dernier recours en cas d'égalité stricte. */
export function comboIdKey(combo: Resource[]): string {
  return combo.map((r) => r.id).sort().join('|');
}

/** true si `candidate` doit être préféré à `current` — popularité (préserver le plus convoité) puis id, jamais d'aléatoire. */
export function isPreferredCombo(candidate: Resource[], current: Resource[]): boolean {
  const candScore = comboPopularityScore(candidate);
  const currScore = comboPopularityScore(current);
  if (candScore !== currScore) return candScore < currScore;
  return comboIdKey(candidate) < comboIdKey(current);
}
