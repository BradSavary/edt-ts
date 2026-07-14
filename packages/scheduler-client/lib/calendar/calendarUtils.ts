/**
 * Utilitaires de calcul de dates/heures pour l'affichage du calendrier.
 */

import type { AvailabilityManager } from '@edt-ts/scheduler-common';

/**
 * Calcule la violation de contrainte pour un créneau donné.
 * - 'red'    : au moins un enseignant est indisponible sur ce créneau
 * - 'orange' : au moins une salle ou groupe est indisponible (mais pas d'enseignant)
 * - 'none'   : pas de violation détectée
 *
 * @param startTime   Minutes depuis lundi minuit
 * @param duration    Durée en minutes
 * @param teachers    IDs des enseignants
 * @param groups      IDs des groupes
 * @param rooms       IDs des salles
 * @param manager     AvailabilityManager instancié avec les contraintes courantes
 * @param week        Numéro de semaine ISO (pour les contraintes hebdomadaires)
 */
export function computeConstraintViolation(
  startTime: number,
  duration: number,
  teachers: string[],
  groups: string[],
  rooms: string[],
  manager: AvailabilityManager,
  week: number,
): 'red' | 'orange' | 'none' {
  const end = startTime + duration;
  for (const id of teachers) {
    const avail = manager.getAvailability(id, week);
    if (avail && !avail.isAvailable(startTime, end)) return 'red';
  }
  for (const id of [...groups, ...rooms]) {
    const avail = manager.getAvailability(id, week);
    if (avail && !avail.isAvailable(startTime, end)) return 'orange';
  }
  return 'none';
}

/**
 * Calcule le lundi de la semaine ISO donnée.
 * @param isoWeek Numéro de semaine ISO (1–53)
 * @param year Année cible. Si absent, déduit via heuristique académique (sept–juin).
 */
export function getMondayOfISOWeek(isoWeek: number, year?: number): Date {
  const resolvedYear = year ?? (() => {
    const now = new Date();
    return now.getMonth() < 8 && isoWeek >= 35 ? now.getFullYear() - 1 : now.getFullYear();
  })();
  // Le 4 janvier est toujours dans la semaine ISO 1
  const jan4 = new Date(resolvedYear, 0, 4);
  const jan4DayOfWeek = jan4.getDay() === 0 ? 7 : jan4.getDay(); // 1=Lun … 7=Dim
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - (jan4DayOfWeek - 1) + (isoWeek - 1) * 7);
  return monday;
}

/**
 * Convertit startTime (minutes depuis lundi minuit) en objet Date absolu.
 */
export function startTimeToDate(monday: Date, startTimeMinutes: number): Date {
  const dayOffset = Math.floor(startTimeMinutes / (24 * 60));
  const minutesInDay = startTimeMinutes % (24 * 60);
  const date = new Date(monday);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(Math.floor(minutesInDay / 60), minutesInDay % 60, 0, 0);
  return date;
}

/**
 * Convertit une Date absolue en startTime (minutes depuis lundi minuit) — inverse de startTimeToDate.
 */
export function dateToStartTime(monday: Date, date: Date): number {
  return Math.round((date.getTime() - monday.getTime()) / 60000);
}

// Indexed by startTime dayIndex (0=Lundi … 5=Samedi)
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/**
 * Formate un startTime (minutes depuis lundi minuit) en chaîne lisible.
 * Ex : 570 → "Lun 09:30"
 */
export function formatStartTime(startTime: number): string {
  const dayIndex = Math.floor(startTime / (24 * 60));
  const minutesInDay = startTime % (24 * 60);
  const h = Math.floor(minutesInDay / 60).toString().padStart(2, '0');
  const m = (minutesInDay % 60).toString().padStart(2, '0');
  return `${WEEKDAY_LABELS[dayIndex] ?? '?'} ${h}:${m}`;
}

// ─── Détection de conflits de ressources ─────────────────────────────────────

export type ResourceEventInfo = {
  id: string;
  start: Date;
  end: Date;
  teachers: string[];
  groups: string[];
  rooms: string[];
};

export type ConflictLevel = 'red' | 'orange';

/**
 * Calcule les conflits statiques entre tous les events (sans drag actif).
 * Rouge = enseignant ou groupe en double ; Orange = salle en double.
 */
export function computeStaticConflicts(events: ResourceEventInfo[]): Record<string, ConflictLevel> {
  const result: Record<string, ConflictLevel> = {};
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (a.start >= b.end || b.start >= a.end) continue;
      const setTeachers = new Set(a.teachers);
      const setGroups = new Set(a.groups);
      const setRooms = new Set(a.rooms);
      const sharedTeacher = b.teachers.some((t) => setTeachers.has(t));
      const sharedGroup = b.groups.some((g) => setGroups.has(g));
      const sharedRoom = b.rooms.some((r) => setRooms.has(r));
      if (sharedTeacher || sharedGroup) {
        result[a.id] = 'red';
        result[b.id] = 'red';
      } else if (sharedRoom) {
        if (result[a.id] !== 'red') result[a.id] = 'orange';
        if (result[b.id] !== 'red') result[b.id] = 'orange';
      }
    }
  }
  return result;
}

/**
 * Calcule les events en conflit avec la tâche en cours de drag.
 * Ignore les contraintes temporelles (le drag peut être n'importe où).
 */
export function computeDragHighlights(
  events: ResourceEventInfo[],
  drag: { id: string; teachers: string[]; groups: string[]; rooms: string[] },
): Record<string, ConflictLevel> {
  const result: Record<string, ConflictLevel> = {};
  const dragTeachers = new Set(drag.teachers);
  const dragGroups = new Set(drag.groups);
  const dragRooms = new Set(drag.rooms);
  for (const evt of events) {
    if (evt.id === drag.id) continue;
    const sharedTeacher = evt.teachers.some((t) => dragTeachers.has(t));
    const sharedGroup = evt.groups.some((g) => dragGroups.has(g));
    const sharedRoom = evt.rooms.some((r) => dragRooms.has(r));
    if (sharedTeacher || sharedGroup) result[evt.id] = 'red';
    else if (sharedRoom) result[evt.id] = 'orange';
  }
  return result;
}

/**
 * Sépare une requête en groupes "OR" de niveau supérieur, chacun subdivisé en termes "AND"
 * (AND prioritaire sur OR, comme la plupart des langages — "A AND B OR C" = "(A AND B) OR C").
 * Les opérateurs ne sont reconnus qu'en MAJUSCULES et entourés d'espace(s) — "AND"/"OR" collés
 * à un mot (ex: "GRAND", "ANDRE") ou en minuscules restent du texte de recherche normal.
 * Groupes/termes vides (opérateur en trop, espaces multiples) sont ignorés silencieusement.
 */
function parseSearchQuery(query: string): string[][] {
  return query
    .split(/\s+OR\s+/)
    .map((group) => group.split(/\s+AND\s+/).map((t) => t.trim()).filter((t) => t.length > 0))
    .filter((terms) => terms.length > 0);
}

/**
 * Vérifie si `fields` (valeurs recherchables d'un cours/tâche — code, nom, type, enseignants,
 * salles, groupes...) satisfait la requête `query`. Recherche par sous-chaîne, insensible à la
 * casse pour les termes eux-mêmes ; support des opérateurs AND/OR (voir `parseSearchQuery`).
 * Une requête vide (ou ne contenant que des opérateurs) satisfait toujours (aucune restriction).
 */
export function matchesSearchQuery(fields: string[], query: string): boolean {
  const orGroups = parseSearchQuery(query);
  if (orGroups.length === 0) return true;
  const lowerFields = fields.map((f) => f.toLowerCase());
  return orGroups.some((andTerms) =>
    andTerms.every((term) => {
      const t = term.toLowerCase();
      return lowerFields.some((f) => f.includes(t));
    }),
  );
}

/**
 * Filtre un tableau de tâches planifiées par une requête de recherche.
 * Cherche dans le code, le nom, le type (CM/TD/TP/Autonomie...), les enseignants, les salles
 * et les groupes — voir `matchesSearchQuery` pour la syntaxe (AND/OR).
 * Retourne le tableau original si la requête est vide.
 */
export function filterSolutionsByQuery<T extends { code: string; name: string; type: string; resources: { id: string; type: string }[] }>(
  tasks: T[],
  query: string,
): T[] {
  if (!query.trim()) return tasks;
  return tasks.filter((task) =>
    matchesSearchQuery([task.code, task.name, task.type, ...task.resources.map((r) => r.id)], query),
  );
}
