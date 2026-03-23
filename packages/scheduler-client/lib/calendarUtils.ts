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

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(date: Date): string {
  return `${DAY_LABELS[date.getDay()]} ${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
}
