/**
 * Utilitaires de calcul de dates/heures pour l'affichage du calendrier.
 */

/**
 * Calcule le lundi de la semaine ISO donnée.
 * Gestion de l'année universitaire : semaines >= 35 = année N-1 si on est en Jan-Août.
 */
export function getMondayOfISOWeek(isoWeek: number): Date {
  const now = new Date();
  const year = now.getMonth() < 8 && isoWeek >= 35 ? now.getFullYear() - 1 : now.getFullYear();
  // Le 4 janvier est toujours dans la semaine ISO 1
  const jan4 = new Date(year, 0, 4);
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

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/**
 * Formate un startTime (minutes depuis lundi minuit) en chaîne lisible.
 * Ex : 570 → "Lun 09:30"
 */
export function formatStartTime(startTime: number): string {
  const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const dayIndex = Math.floor(startTime / (24 * 60));
  const minutesInDay = startTime % (24 * 60);
  const h = Math.floor(minutesInDay / 60).toString().padStart(2, '0');
  const m = (minutesInDay % 60).toString().padStart(2, '0');
  return `${WEEKDAY_LABELS[dayIndex] ?? '?'} ${h}:${m}`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(date: Date): string {
  return `${DAY_LABELS[date.getDay()]} ${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
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

