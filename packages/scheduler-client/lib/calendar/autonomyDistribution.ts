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
  rooms: string[];
}

export interface AutonomyPieceResult {
  startTime: number;
  duration: number;
  /** Salle effectivement retenue pour ce morceau — absent si aucune salle n'était proposée. */
  roomId?: string;
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
export function distributeChronologically<T extends { startTime: number; duration: number }>(
  freeSlots: T[],
  totalDuration: number,
): { pieces: T[]; remainingDuration: number } {
  let remaining = totalDuration;
  const pieces: T[] = [];

  for (const slot of freeSlots) {
    if (remaining <= 0) break;
    const pieceDuration = Math.min(slot.duration, remaining);
    pieces.push({ ...slot, duration: pieceDuration });
    remaining -= pieceDuration;
  }

  return { pieces, remainingDuration: Math.max(remaining, 0) };
}

/**
 * Calcule la répartition d'un cours Autonomie requérant `groupIds` (tous simultanément
 * libres — pas d'alternative) sur la semaine `week`, compte tenu de ce qui occupe déjà
 * le calendrier (`occupancy`) et des zones bloquées (`blockedZonesMinutes`).
 *
 * `roomIds` : salles proposées pour l'Autonomie, toutes en alternative (une seule doit être
 * libre, pas toutes) — liste vide = aucune salle proposée, les conflits de salle ne comptent
 * pas (comportement d'origine, consigne explicite). Quand elle n'est pas vide, chaque morceau
 * produit reste rattaché à UNE seule salle (`roomId`) continûment libre sur toute sa durée —
 * jamais de bascule de salle en cours de morceau, un morceau = un `Placement` unique.
 *
 * Ne s'appuie que sur la disponibilité RÉELLE des ressources (Default + surcharges de semaine,
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
  roomIds: string[];
  week: number;
  availabilityManager: AvailabilityManager;
  blockedZonesMinutes: { start: number; end: number }[];
  occupancy: OccupancyEntry[];
  totalDuration: number;
}): AutonomyDistributionResult {
  const { groupIds, roomIds, week, availabilityManager, blockedZonesMinutes, occupancy, totalDuration } = params;

  if (groupIds.length === 0) {
    return { pieces: [], remainingDuration: totalDuration };
  }

  // getAvailability() retourne toujours une Availability réelle en pratique (fallback sur
  // Default si la ressource est inconnue) — le `| null` de sa signature n'est jamais atteint,
  // mais on le respecte quand même : une ressource introuvable est traitée comme "aucune
  // disponibilité" (choix conservateur), plutôt que de planter ou de l'ignorer silencieusement.
  const getResourceAvailability = (id: string): Availability =>
    availabilityManager.getAvailability(id, week) ?? new Availability();

  // 1. Intersection ET entre tous les groupes requis simultanément.
  // getAvailability() retourne une RÉFÉRENCE vers l'instance en cache de l'AvailabilityManager —
  // jamais la muter directement. .copy() pour le premier groupe ; .intersect() retourne déjà
  // une nouvelle instance donc sûr pour les suivants.
  let combined = getResourceAvailability(groupIds[0]).copy();
  for (let i = 1; i < groupIds.length; i++) {
    combined = combined.intersect(getResourceAvailability(groupIds[i]));
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

  // 5. Aucune salle proposée : conflits de salle ignorés, comportement d'origine.
  if (roomIds.length === 0) {
    const eligible = combined
      .getAvailableIntervals()
      .map((iv) => ({ startTime: iv.start, duration: iv.duration ?? iv.end - iv.start }))
      .filter((slot) => slot.duration >= AUTONOMY_MIN_SLOT_MINUTES);
    return distributeChronologically(eligible, totalDuration);
  }

  // 6. Des salles sont proposées : pour chacune, sa disponibilité réelle une fois retiré ce qui
  // l'occupe déjà (zones bloquées + occupancy de CETTE salle), intersectée avec `combined` — donne
  // les créneaux où étudiants ET cette salle précise sont libres. On ne fusionne jamais les
  // créneaux de deux salles différentes entre eux (seulement ceux d'une même salle, via
  // Availability.intersect) : une fusion inter-salles impliquerait une bascule de salle au milieu
  // d'un même morceau, ce que le modèle de placement ne permet pas.
  const perRoomSlots: { startTime: number; duration: number; roomId: string }[] = [];
  for (const roomId of roomIds) {
    const roomAvailability = getResourceAvailability(roomId).copy();
    for (const bz of blockedZonesMinutes) {
      if (bz.end > bz.start) roomAvailability.removeAvailability(bz.start, bz.end);
    }
    for (const entry of occupancy) {
      if (entry.rooms.includes(roomId)) {
        roomAvailability.removeAvailability(entry.startTime, entry.startTime + entry.duration);
      }
    }
    const roomEligible = combined.intersect(roomAvailability);
    for (const iv of roomEligible.getAvailableIntervals()) {
      perRoomSlots.push({ startTime: iv.start, duration: iv.duration ?? iv.end - iv.start, roomId });
    }
  }
  perRoomSlots.sort((a, b) => a.startTime - b.startTime);

  // 7. Balayage chronologique : les créneaux se recouvrant entre salles différentes sont découpés
  // (jamais fusionnés) pour ne jamais compter deux fois le même instant — au premier arrivé
  // (tri croissant par début), la salle suivante ne récupère que la portion non encore couverte.
  const eligible: { startTime: number; duration: number; roomId: string }[] = [];
  let cursor = -Infinity;
  for (const slot of perRoomSlots) {
    const start = Math.max(slot.startTime, cursor);
    const end = slot.startTime + slot.duration;
    if (start < end) {
      eligible.push({ startTime: start, duration: end - start, roomId: slot.roomId });
      cursor = end;
    }
  }

  return distributeChronologically(
    eligible.filter((slot) => slot.duration >= AUTONOMY_MIN_SLOT_MINUTES),
    totalDuration,
  );
}
