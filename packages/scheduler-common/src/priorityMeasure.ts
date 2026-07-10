import { Availability } from './availability.ts';

/** Granularité de recherche de créneau du moteur (scheduler-core/scheduler.ts). */
export const SLOT_STEP = 30;

/**
 * Mesure de priorité à deux niveaux (§5.1 du document de conception) :
 *  - usableWindowCount : nombre de fenêtres indépendantes (intervalles disjoints) pouvant accueillir la tâche.
 *  - slackTotal : nombre total de positions de départ valides (à pas SLOT_STEP), toutes fenêtres confondues.
 * Comparée comme une disponibilité brute généralisée : plus grand = plus disponible = moins prioritaire.
 * (0, 0) signale l'infaisabilité (aucune fenêtre utilisable) — voir §5.4.
 */
export interface PriorityMeasure {
  readonly usableWindowCount: number;
  readonly slackTotal: number;
}

export const INFEASIBLE_MEASURE: PriorityMeasure = { usableWindowCount: 0, slackTotal: 0 };

/** Calcule la mesure d'un profil de disponibilité pour une durée de tâche donnée. */
export function measureProfile(profile: Availability, duration: number, slotStep: number = SLOT_STEP): PriorityMeasure {
  let usableWindowCount = 0;
  let slackTotal = 0;
  for (const interval of profile.getAvailableIntervals()) {
    const width = interval.duration ?? (interval.end - interval.start);
    if (width >= duration) {
      usableWindowCount++;
      slackTotal += Math.floor((width - duration) / slotStep) + 1;
    }
  }
  return { usableWindowCount, slackTotal };
}

/** Compare deux mesures dans le sens "disponibilité brute" : négatif si a est MOINS disponible (donc plus prioritaire) que b. */
export function comparePriorityMeasure(a: PriorityMeasure, b: PriorityMeasure): number {
  if (a.usableWindowCount !== b.usableWindowCount) return a.usableWindowCount - b.usableWindowCount;
  return a.slackTotal - b.slackTotal;
}

/** La plus disponible des deux (utilisé pour choisir le meilleur combo d'une tâche — §5.3). */
export function maxPriorityMeasure(a: PriorityMeasure, b: PriorityMeasure): PriorityMeasure {
  return comparePriorityMeasure(a, b) >= 0 ? a : b;
}

/** La moins disponible des deux (utilisé pour l'agrégation de groupe — le membre le plus contraint gouverne, §5.3). */
export function minPriorityMeasure(a: PriorityMeasure, b: PriorityMeasure): PriorityMeasure {
  return comparePriorityMeasure(a, b) <= 0 ? a : b;
}

/**
 * Encode la mesure en un score numérique unique pour satisfaire l'interface ISchedulingUnit.getSchedulingPriority()
 * (scheduler-core), qui reste inchangée en Phase 1. Plus grand = plus prioritaire (convention existante).
 * ENCODING_SCALE choisi grand devant tout slackTotal plausible (semaine ≤ 10080min / 30 = 336 positions max
 * par fenêtre réaliste) pour garantir qu'usableWindowCount domine toujours slackTotal dans l'ordre — seul point
 * de négation de tout le module, à ne pas dupliquer ailleurs.
 */
const ENCODING_SCALE = 1_000_000;
export function encodePriorityMeasure(m: PriorityMeasure): number {
  return -(m.usableWindowCount * ENCODING_SCALE + m.slackTotal);
}

/** Fenêtre de pause méridienne flottante, en minutes depuis minuit (même forme que Scheduler._floatingLB). */
export interface FloatingLunchWindow {
  readonly earliestMin: number;
  readonly latestMin: number;
  readonly duration: number;
}

/**
 * Découpe une pause de `window.duration` minutes au milieu de la zone de chevauchement
 * avec [earliestMin, latestMin], pour chaque jour ouvré (lundi-vendredi) — §5.5 de
 * docs/HeuristiquePriorite-Conception.md. Position canonique assumée (le milieu), pas
 * une garantie de pire cas : la position réelle n'est connue qu'au moment du placement
 * (`Scheduler._floatingLBAllows`). Ne mute jamais le profil passé en entrée (retourne
 * une copie) — correctif de lecture pour le score uniquement.
 *
 * La boucle interne relit `result.getAvailableIntervals()` (un instantané) à chaque
 * itération de jour, donc voit bien les découpes des jours précédents ; à l'intérieur
 * d'un même jour, les intervalles de l'instantané sont disjoints par construction
 * d'Availability, donc les `removeAvailability` successifs ne peuvent pas interférer
 * entre eux — sûr d'itérer sur l'instantané tout en mutant `result`.
 */
export function splitFloatingLunchBreak(profile: Availability, window: FloatingLunchWindow): Availability {
  const DAY = 24 * 60;
  const result = profile.copy();
  for (let day = 0; day < 5; day++) {
    const dayEarliest = day * DAY + window.earliestMin;
    const dayLatest = day * DAY + window.latestMin;
    for (const interval of result.getAvailableIntervals()) {
      const overlapStart = Math.max(interval.start, dayEarliest);
      const overlapEnd = Math.min(interval.end, dayLatest);
      if (overlapStart >= overlapEnd) continue;
      const mid = (overlapStart + overlapEnd) / 2;
      result.removeAvailability(mid - window.duration / 2, mid + window.duration / 2);
    }
  }
  return result;
}

// ── §5.6 : troncature par échéance pour les dépendants ────────────────────────

/**
 * Tronque un profil à droite de `deadline` (§5.6 de docs/HeuristiquePriorite-Conception.md).
 * `deadline = -Infinity` produit un profil vide (propage l'infaisabilité héritée d'un
 * dépendant lui-même infaisable). Vue calculée, ne mute jamais le profil d'entrée.
 */
export function truncateProfile(profile: Availability, deadline: number): Availability {
  const result = new Availability();
  for (const interval of profile.getAvailableIntervals()) {
    const end = Math.min(interval.end, deadline);
    if (end > interval.start) result.addAvailability(interval.start, end);
  }
  return result;
}

/**
 * Dernier instant de départ valide dans le profil pour une durée donnée — symétrique
 * de `_findFirstSlot` (scheduler-core/taskUnit.ts), mais en partant de la fin du profil.
 * Retourne null si aucun intervalle n'est assez grand (infaisable).
 */
export function findLastSlot(profile: Availability, duration: number): number | null {
  const intervals = profile.getAvailableIntervals();
  for (let i = intervals.length - 1; i >= 0; i--) {
    const width = intervals[i].duration ?? (intervals[i].end - intervals[i].start);
    if (width >= duration) return intervals[i].end - duration;
  }
  return null;
}

/**
 * Échéance d'un nœud U compte tenu de ses dépendants directs — §5.6 de
 * docs/HeuristiquePriorite-Conception.md, section "Dépendants multiples (structure en
 * éventail) : correction de charge cumulée" (conception validée le 2026-07-10).
 *
 * Généralisation stricte de l'ancien `min(LS(D1),...,LS(Dk))` : celui-ci vérifiait que U
 * finit avant le plus pressé de ses dépendants, mais ignorait que TOUS les dépendants
 * doivent aussi tenir, cumulativement, dans le temps restant — indépendamment de quelle
 * ressource chacun utilise (les dépendances n'expriment qu'une contrainte de précédence
 * temporelle). Retranche donc la durée cumulée des AUTRES dépendants de la marge du plus
 * pressé (même principe que l'ajustement tête/queue de Carlier & Pinson sur ressource
 * disjonctive, appliqué ici directement à la structure de précédence).
 *
 * Dégénère exactement en `LS(D1)` quand il n'y a qu'un seul dépendant (k=1, cas chaîne
 * CM/TD/TP déjà en production) — aucune régression sur ce cas.
 */
export function computeDependentsDeadline(dependents: readonly { ls: number; duration: number }[]): number {
  if (dependents.length === 0) return Infinity;
  let m = 0;
  for (let i = 1; i < dependents.length; i++) {
    if (dependents[i].ls < dependents[m].ls) m = i;
  }
  let othersSum = 0;
  for (let i = 0; i < dependents.length; i++) {
    if (i !== m) othersSum += dependents[i].duration;
  }
  return dependents[m].ls - othersSum;
}

/**
 * Plage temporelle légère, `start <= end` autorisé (contrairement à `TimeInterval`/
 * `Availability`, qui exigent `start < end` strict) — nécessaire pour représenter un
 * ajustement pile à la bonne taille (largeur 0) après réduction par durée. Usage
 * interne à l'agrégation de groupe (`TaskGroupUnit`, §5.6) uniquement.
 */
export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Réduit un profil brut en profil des débuts valides (§5.6) : chaque intervalle
 * [a,b] assez large devient [a, b-duration]. Peut produire des plages de largeur 0
 * (ajustement pile à la bonne taille) — d'où `TimeRange`, pas `Availability`.
 */
export function reduceToAnchors(profile: Availability, duration: number): TimeRange[] {
  const ranges: TimeRange[] = [];
  for (const interval of profile.getAvailableIntervals()) {
    const width = interval.duration ?? (interval.end - interval.start);
    if (width >= duration) ranges.push({ start: interval.start, end: interval.end - duration });
  }
  return ranges;
}

/** Décale toutes les plages de `-offset` (utilisé pour l'offset cumulé d'un groupe sequential, §5.6). */
export function shiftRanges(ranges: readonly TimeRange[], offset: number): TimeRange[] {
  return ranges.map(r => ({ start: r.start - offset, end: r.end - offset }));
}

/**
 * Intersection de deux listes de plages triées et disjointes (algorithme à deux
 * pointeurs, même principe que `Availability.intersect`). `start <= end` autorisé
 * dans le résultat (intersection de deux plages ponctuelles identiques).
 */
export function intersectRanges(a: readonly TimeRange[], b: readonly TimeRange[]): TimeRange[] {
  const result: TimeRange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (start <= end) result.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else if (b[j].end < a[i].end) j++;
    else { i++; j++; }
  }
  return result;
}

/** Tronque une liste de plages à droite de `deadline` — équivalent `TimeRange` de `truncateProfile`. */
export function truncateRanges(ranges: readonly TimeRange[], deadline: number): TimeRange[] {
  const result: TimeRange[] = [];
  for (const r of ranges) {
    const end = Math.min(r.end, deadline);
    if (end >= r.start) result.push({ start: r.start, end });
  }
  return result;
}

/**
 * Mesure §5.1 sur un profil DÉJÀ réduit (anchors) — pas de nouvelle réduction par
 * durée, contrairement à `measureProfile` qui part d'un profil brut.
 */
export function countAnchorPositions(ranges: readonly TimeRange[], slotStep: number = SLOT_STEP): PriorityMeasure {
  let usableWindowCount = 0;
  let slackTotal = 0;
  for (const r of ranges) {
    usableWindowCount++;
    slackTotal += Math.floor((r.end - r.start) / slotStep) + 1;
  }
  return { usableWindowCount, slackTotal };
}
