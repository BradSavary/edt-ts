import type { ResourceConstraints, TimeSlot } from '@edt-ts/scheduler-common';
import type { ResourceDataWithStatus, ResourceGroupDataWithStatus } from '@/lib/csvMerge';
import { getWeekKeys, normalizeToRC } from '@/lib/constraintsUtils';

/**
 * Limite quotidienne effective d'une ressource pour une semaine donnée : l'override
 * hebdomadaire s'il existe, sinon le défaut de la ressource, sinon `undefined` (illimité).
 *
 * Règle unique partagée par les DEUX consommateurs de `maxDailyMinutes` côté client
 * (payload moteur `_buildPayload`, analyse de charge `resourceLoadAnalysis`) : s'ils
 * divergent, l'analyse affichée contredit silencieusement ce que le moteur applique.
 *
 * `??` et non `||` : une limite hebdo de valeur `0` n'est pas produite par l'UI (elle
 * efface l'override), mais la sémantique « présent ⇒ gagne » doit rester exacte.
 */
export function resolveMaxDailyMinutes(
  r: ResourceDataWithStatus,
  weekNumber: number,
): number | undefined {
  return r.weeklyMaxDailyMinutes?.[`S${weekNumber}`] ?? r.maxDailyMinutes;
}

/**
 * Réconcilie les limites hebdomadaires avec les semaines réellement cochées : toute limite
 * dont la semaine n'a plus d'override de disponibilité est supprimée.
 *
 * La limite d'une semaine suit sa case à cocher (arbitrage Frédéric, 2026-07-22). Décocher
 * via l'UI purge la limite au passage, mais TROIS autres chemins décochent sans passer par
 * la case — supprimer toutes les contraintes d'une ressource, `deleteConstraint`,
 * `importConstraints` — et laissaient derrière eux une limite toujours envoyée au moteur,
 * invisible et non modifiable puisque le tableau ne l'affiche plus. D'où une réconciliation
 * unique appliquée à CHAQUE écriture de `constraints`, plutôt que trois purges ad hoc à
 * retenir à chaque nouveau chemin.
 *
 * Stable par référence : retourne l'objet reçu si rien n'est orphelin. Indispensable —
 * `resources` est comparé par référence pour reconstruire `clientSchedulerData` et pour
 * décider d'une réécriture du localStorage.
 */
export function pruneOrphanWeeklyMaxDaily(
  resources: ResourceGroupDataWithStatus[],
  constraints: Record<string, ResourceConstraints | TimeSlot[] | null | undefined>,
): ResourceGroupDataWithStatus[] {
  let anyChange = false;

  const next = resources.map((group) => {
    let groupChanged = false;

    const groupResources = group.resources.map((r) => {
      if (r.weeklyMaxDailyMinutes === undefined) return r;

      // Contraintes absentes ou `null` (ressource héritant du Défaut) ⇒ aucune semaine
      // cochée pour elle ⇒ toutes ses limites hebdo sont orphelines.
      const rc = normalizeToRC(constraints[r.id]);
      const checked = new Set(rc ? getWeekKeys(rc) : []);
      const kept = Object.entries(r.weeklyMaxDailyMinutes).filter(([wk]) => checked.has(wk));
      if (kept.length === Object.keys(r.weeklyMaxDailyMinutes).length) return r;

      groupChanged = true;
      const { weeklyMaxDailyMinutes: _drop, ...rest } = r;
      return kept.length > 0 ? { ...rest, weeklyMaxDailyMinutes: Object.fromEntries(kept) } : rest;
    });

    if (!groupChanged) return group;
    anyChange = true;
    return { ...group, resources: groupResources };
  });

  return anyChange ? next : resources;
}
