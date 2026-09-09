import { Availability, AvailabilityManager } from '@edt-ts/scheduler-common';

/**
 * Répartition automatique des cours "Autonomie" neutralisés dans les créneaux libres
 * du/des groupe(s) requis. Fonctions pures — aucune dépendance au store, testables
 * avec de simples données en entrée/sortie.
 */

export const AUTONOMY_MIN_SLOT_MINUTES = 60;

// Pause déjeuner FIXE pour cette fonctionnalité — indépendante de schedulerConfig.lunchBreak
// (celle du moteur de planification peut être différente ou absente).
const LUNCH_BREAK_START_MIN = 12 * 60;
const LUNCH_BREAK_END_MIN = 13 * 60 + 30;

const DAYS_PER_WEEK = 7;
const MINUTES_PER_DAY = 24 * 60;

export interface OccupancyEntry {
  /** Minutes depuis lundi 00:00. */
  startTime: number;
  duration: number;
  groups: string[];
}

export interface AutonomyPieceResult {
  startTime: number;
  duration: number;
}

export interface AutonomyDistributionResult {
  pieces: AutonomyPieceResult[];
  remainingDuration: number;
}

/**
 * Répartition gloutonne chronologique : remplit chaque trou (dans l'ordre reçu)
 * avec min(taille du trou, reste à distribuer), jusqu'à épuisement de la durée ou des trous.
 * Un morceau final peut être plus petit que la taille du trou (voire < AUTONOMY_MIN_SLOT_MINUTES)
 * si c'est tout ce qu'il restait à distribuer — le seuil minimal ne filtre que les trous candidats
 * (voir computeAutonomyDistribution), pas la taille du morceau posé dedans.
 */
export function distributeChronologically(
  freeSlots: { startTime: number; duration: number }[],
  totalDuration: number,
): AutonomyDistributionResult {
  let remaining = totalDuration;
  const pieces: AutonomyPieceResult[] = [];

  for (const slot of freeSlots) {
    if (remaining <= 0) break;
    const pieceDuration = Math.min(slot.duration, remaining);
    pieces.push({ startTime: slot.startTime, duration: pieceDuration });
    remaining -= pieceDuration;
  }

  return { pieces, remainingDuration: Math.max(remaining, 0) };
}

/**
 * Calcule la répartition d'un cours Autonomie requérant `groupIds` (tous simultanément
 * libres — pas d'alternative) sur la semaine `week`, compte tenu de ce qui occupe déjà
 * le calendrier (`occupancy`) et des zones bloquées (`blockedZonesMinutes`).
 *
 * Ne s'appuie que sur la disponibilité RÉELLE des groupes (Default + surcharges de semaine,
 * via AvailabilityManager) — pas de fenêtre horaire fixe supplémentaire (type 7h-21h) : ce
 * serait redondant avec les contraintes réelles et risquerait de tronquer silencieusement
 * un cas légitime différent (samedi, horaires tardifs...).
 *
 * Ignore volontairement les limites quotidiennes (maxDailyMinutes) — Availability/
 * AvailabilityManager n'en ont de toute façon aucune notion (concept propre au moteur
 * de planification), donc rien de spécial à faire pour respecter cette consigne.
 */
export function computeAutonomyDistribution(params: {
  groupIds: string[];
  week: number;
  availabilityManager: AvailabilityManager;
  blockedZonesMinutes: { start: number; end: number }[];
  occupancy: OccupancyEntry[];
  totalDuration: number;
}): AutonomyDistributionResult {
  const { groupIds, week, availabilityManager, blockedZonesMinutes, occupancy, totalDuration } = params;

  if (groupIds.length === 0) {
    return { pieces: [], remainingDuration: totalDuration };
  }

  // getAvailability() retourne toujours une Availability réelle en pratique (fallback sur
  // Default si la ressource est inconnue) — le `| null` de sa signature n'est jamais atteint,
  // mais on le respecte quand même : un groupe introuvable est traité comme "aucune disponibilité"
  // (choix conservateur), plutôt que de planter ou de l'ignorer silencieusement.
  const getGroupAvailability = (groupId: string): Availability =>
    availabilityManager.getAvailability(groupId, week) ?? new Availability();

  // 1. Intersection ET entre tous les groupes requis simultanément.
  // getAvailability() retourne une RÉFÉRENCE vers l'instance en cache de l'AvailabilityManager —
  // jamais la muter directement. .copy() pour le premier groupe ; .intersect() retourne déjà
  // une nouvelle instance donc sûr pour les suivants.
  let combined = getGroupAvailability(groupIds[0]).copy();
  for (let i = 1; i < groupIds.length; i++) {
    combined = combined.intersect(getGroupAvailability(groupIds[i]));
  }

  // 2. Retirer les zones bloquées (vacances / manuel).
  for (const bz of blockedZonesMinutes) {
    if (bz.end > bz.start) combined.removeAvailability(bz.start, bz.end);
  }

  // 3. Retirer ce qui occupe déjà le calendrier pour CES groupes.
  for (const entry of occupancy) {
    if (entry.groups.some((g) => groupIds.includes(g))) {
      combined.removeAvailability(entry.startTime, entry.startTime + entry.duration);
    }
  }

  // 4. Retirer la pause déjeuner fixe 12:00-13:30 chaque jour de la semaine.
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    combined.removeAvailability(day * MINUTES_PER_DAY + LUNCH_BREAK_START_MIN, day * MINUTES_PER_DAY + LUNCH_BREAK_END_MIN);
  }

  // 5. Filtrer les trous candidats (≥60min) puis répartir chronologiquement.
  const eligible = combined
    .getAvailableIntervals()
    .map((iv) => ({ startTime: iv.start, duration: iv.duration ?? iv.end - iv.start }))
    .filter((slot) => slot.duration >= AUTONOMY_MIN_SLOT_MINUTES);

  return distributeChronologically(eligible, totalDuration);
}
