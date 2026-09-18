import JSZip from 'jszip';
import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';
import { getMondayOfISOWeek } from '@/lib/calendar/calendarUtils';
import { resolveCalendarYear, type SchoolYearConfig } from '@/lib/schoolHolidays';
import {
  sanitizeFileNamePart,
  groupTasksByResource,
  triggerBrowserDownload,
  buildExportBaseName,
  buildExportArchiveBaseName,
  EXPORT_RESOURCE_TYPE_LABELS,
  type ExportResourceType,
} from '@/lib/exportShared';

/** Formatage iCal YYYYMMDDTHHMMSS (sans Z → heure locale). */
function formatICalDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    date.getFullYear().toString() +
    p(date.getMonth() + 1) +
    p(date.getDate()) +
    'T' +
    p(date.getHours()) +
    p(date.getMinutes()) +
    '00'
  );
}

/** Formatage UTC pour DTSTAMP (RFC 5545 §3.8.7.2). */
function formatICalDateUTC(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    date.getUTCFullYear().toString() +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    'T' +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Échappe les caractères spéciaux dans les valeurs TEXT (RFC 5545 §3.3.11).
 * \ ; , et les sauts de ligne.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Recule `index` jusqu'au dernier octet qui n'est pas une continuation UTF-8 (`10xxxxxx`),
 * pour ne jamais couper un caractère multi-octets en deux — sinon chaque moitié se décode en
 * `�` (U+FFFD), perte définitive du caractère (ex. un « é » en fin de tranche pliée).
 */
function utf8SafeCutIndex(bytes: Uint8Array, index: number): number {
  let i = index;
  while (i > 0 && (bytes[i] & 0xc0) === 0x80) i--;
  return i;
}

/**
 * Replie les lignes à 75 octets (RFC 5545 §3.1).
 * Les lignes de continuation débutent par un espace.
 */
function foldLine(line: string): string {
  // Traitement octet-par-octet en UTF-8 pour un repli précis
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let cursor = 0;

  // Première tranche : jusqu'à 75 octets, sans trancher un caractère
  let cut = utf8SafeCutIndex(bytes, 75);
  chunks.push(decoder.decode(bytes.slice(0, cut)));
  cursor = cut;

  // Tranches suivantes : jusqu'à 74 octets (1 réservé pour l'espace de continuation)
  while (cursor < bytes.length) {
    cut = utf8SafeCutIndex(bytes, Math.min(cursor + 74, bytes.length));
    chunks.push('\r\n ' + decoder.decode(bytes.slice(cursor, cut)));
    cursor = cut;
  }

  return chunks.join('');
}

/** Construit un VEVENT au format iCal strict (RFC 5545). */
function buildVEvent(task: TaskSolutionJSON, monday: Date, dtstamp: string): string {
  const dayOffset = Math.floor(task.startTime / (24 * 60));
  const timeMinutes = task.startTime % (24 * 60);

  const startDate = new Date(monday);
  startDate.setDate(monday.getDate() + dayOffset);
  startDate.setHours(Math.floor(timeMinutes / 60), timeMinutes % 60, 0, 0);

  const endDate = new Date(startDate.getTime() + task.duration * 60_000);

  const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
  const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id);
  const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id);

  // SUMMARY : "R1.01 Algorithmique TD Dupont, BUT1-G1.BUT1-G2"
  const summaryParts: string[] = [task.code, task.name, task.type];
  if (teachers.length) summaryParts.push(teachers[0] + (groups.length ? ',' : ''));
  if (groups.length) summaryParts.push(groups.join('.'));
  const summary = summaryParts.join(' ');

  // DESCRIPTION : texte multi-lignes escapé
  const descLines: string[] = [
    `Code: ${task.code}`,
    `Nom: ${task.name}`,
    `Durée: ${task.duration} minutes`,
    teachers.length ? `Enseignant(s): ${teachers.join(', ')}` : '',
    rooms.length ? `Salle(s): ${rooms.join(', ')}` : '',
    groups.length ? `Groupe(s): ${groups.join(', ')}` : '',
    task.comment ? `Commentaire: ${task.comment}` : '',
  ].filter(Boolean);
  const description = descLines.map(escapeText).join('\\n');

  // UID unique par tâche (reproductible sur un même export, unique entre exports)
  const uid = `${escapeText(task.taskId)}_${task.startTime}_${dtstamp}@edt-ts.local`;

  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${formatICalDate(startDate)}`,
    `DTEND:${formatICalDate(endDate)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION;CHARSET=UTF-8:${description}`,
  ];

  if (rooms.length) lines.push(`LOCATION:${escapeText(rooms[0])}`);
  if (teachers.length) lines.push(`ORGANIZER;CN="${escapeText(teachers[0])}":INVALID:noreply`);
  if (groups.length) lines.push(`CATEGORIES:${groups.join(',')}`);

  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');

  return lines.map(foldLine).join('\r\n');
}

/**
 * Génère le contenu iCal complet (RFC 5545) pour une liste de tâches planifiées.
 *
 * @param tasks             Tâches de la solution active (TaskSolutionJSON[])
 * @param week              Numéro de semaine ISO (1–53)
 * @param schoolYearConfig  Année universitaire sélectionnée par l'utilisateur (pour dater les événements sur la bonne année civile)
 */
export function generateIcalContent(
  tasks: TaskSolutionJSON[],
  week: number,
  schoolYearConfig?: SchoolYearConfig | null,
): string {
  const monday = getMondayOfISOWeek(week, resolveCalendarYear(schoolYearConfig, week));
  monday.setHours(0, 0, 0, 0);
  const dtstamp = formatICalDateUTC(new Date());

  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EDT-TS//Planificateur de cours//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ].join('\r\n');

  const events = tasks.map((task) => buildVEvent(task, monday, dtstamp)).join('\r\n');

  return header + '\r\n' + events + '\r\nEND:VCALENDAR\r\n';
}

/**
 * Nom de fichier "{{Filtre}} S{{Week}} {{Year}}.ics" (le préfixe filtre est omis s'il est vide).
 */
function buildIcalFileName(week: number, monday: Date, schoolYearConfig: SchoolYearConfig | null | undefined, filter: string): string {
  return `${buildExportBaseName(week, monday, schoolYearConfig, filter)}.ics`;
}

/** Nom d'archive "{{Label}} S{{Week}} {{Year}}.zip" (ex: "Groupes S38 2026-2027.zip"). */
function buildIcalArchiveFileName(week: number, monday: Date, schoolYearConfig: SchoolYearConfig | null | undefined, label: string): string {
  return `${buildExportArchiveBaseName(week, monday, schoolYearConfig, label)}.zip`;
}

/**
 * Déclenche le téléchargement d'un fichier .ics dans le navigateur.
 *
 * @param tasks             Tâches de la solution active
 * @param week              Numéro de semaine ISO
 * @param schoolYearConfig  Année universitaire sélectionnée par l'utilisateur
 * @param filter            Filtre de recherche actif (utilisé dans le nom du fichier), vide si aucun
 */
export function downloadIcalSolution(
  tasks: TaskSolutionJSON[],
  week: number,
  schoolYearConfig?: SchoolYearConfig | null,
  filter = '',
): void {
  const monday = getMondayOfISOWeek(week, resolveCalendarYear(schoolYearConfig, week));
  const content = generateIcalContent(tasks, week, schoolYearConfig);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  triggerBrowserDownload(blob, buildIcalFileName(week, monday, schoolYearConfig, filter));
}

/** Type de ressource par lequel éclater l'export en une archive multi-ICS. */
export type IcalResourceType = ExportResourceType;

/** Libellés utilisateur des modes d'export par ressource (repris dans le nom de l'archive). */
export const ICAL_RESOURCE_TYPE_LABELS = EXPORT_RESOURCE_TYPE_LABELS;

/**
 * Déclenche le téléchargement d'une archive .zip contenant un .ics par ressource
 * (`{{id}}.ics`) du type demandé.
 *
 * @param tasks             Tâches de la solution active (non filtrées par la recherche)
 * @param week              Numéro de semaine ISO
 * @param schoolYearConfig  Année universitaire sélectionnée par l'utilisateur
 * @param resourceType      Type de ressource par lequel éclater l'export
 */
export async function downloadIcalArchive(
  tasks: TaskSolutionJSON[],
  week: number,
  schoolYearConfig: SchoolYearConfig | null | undefined,
  resourceType: IcalResourceType,
): Promise<void> {
  const monday = getMondayOfISOWeek(week, resolveCalendarYear(schoolYearConfig, week));
  const groups = groupTasksByResource(tasks, resourceType);

  const zip = new JSZip();
  for (const [id, resourceTasks] of groups) {
    zip.file(`${sanitizeFileNamePart(id)}.ics`, generateIcalContent(resourceTasks, week, schoolYearConfig));
  }
  const blob = await zip.generateAsync({ type: 'blob' });

  triggerBrowserDownload(blob, buildIcalArchiveFileName(week, monday, schoolYearConfig, ICAL_RESOURCE_TYPE_LABELS[resourceType]));
}
