/**
 * Export PDF du planning sous forme de grille hebdomadaire visuelle (jours en colonnes,
 * heures en lignes), en alternative à l'export ICS (lib/icalExport.ts). Mêmes modes de
 * portée (filtré / groupes / enseignants / salles) et même découpage en archive .zip.
 */
import { jsPDF } from 'jspdf';
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

/** Jours affichés en colonnes (Lun→Sam), alignés sur le découpage de startTime en dayOffset. */
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/** Plage horaire de la grille (7h-21h), alignée sur slotMinTime/slotMaxTime du calendrier écran
 *  (ScheduleCalendar.tsx) et sur DAY_START_MIN/DAY_END_MIN (blockedZones.ts). */
const GRID_START_MIN = 7 * 60;
const GRID_END_MIN = 21 * 60;

function formatHourLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:00`;
}

/**
 * Construit un document PDF (A4 paysage) représentant la grille hebdomadaire pour la liste
 * de tâches donnée. `title` est affiché en en-tête de page.
 */
export function generateWeeklyGridPdf(tasks: TaskSolutionJSON[], title: string): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const margin = 24;
  const timeColWidth = 32;
  const titleHeight = 20;
  const dayHeaderHeight = 16;

  const gridTop = margin + titleHeight + dayHeaderHeight;
  const gridBottom = pageHeight - margin;
  const gridLeft = margin + timeColWidth;
  const gridRight = pageWidth - margin;
  const gridHeight = gridBottom - gridTop;
  const gridWidth = gridRight - gridLeft;
  const numDays = WEEKDAY_LABELS.length;
  const dayColWidth = gridWidth / numDays;
  const totalMin = GRID_END_MIN - GRID_START_MIN;

  // Titre
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(title, margin, margin + 12);

  // En-têtes de jours
  doc.setFontSize(9);
  for (let d = 0; d < numDays; d++) {
    const x = gridLeft + d * dayColWidth;
    doc.text(WEEKDAY_LABELS[d], x + dayColWidth / 2, gridTop - 4, { align: 'center' });
  }

  // Grille : lignes horaires (avec libellé) + colonnes de jours
  doc.setDrawColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += 60) {
    const y = gridTop + ((m - GRID_START_MIN) / totalMin) * gridHeight;
    doc.line(gridLeft, y, gridRight, y);
    doc.text(formatHourLabel(m), margin, y + 3);
  }
  for (let d = 0; d <= numDays; d++) {
    const x = gridLeft + d * dayColWidth;
    doc.line(x, gridTop, x, gridBottom);
  }
  doc.setDrawColor(100, 116, 139);
  doc.rect(gridLeft, gridTop, gridWidth, gridHeight);

  // Tâches : un bloc par tâche, positionné par jour/heure, clippé à la plage 7h-21h.
  for (const task of tasks) {
    const dayOffset = Math.floor(task.startTime / (24 * 60));
    if (dayOffset < 0 || dayOffset >= numDays) continue;
    const minutesInDay = task.startTime % (24 * 60);
    const startMin = Math.max(minutesInDay, GRID_START_MIN);
    const endMin = Math.min(minutesInDay + task.duration, GRID_END_MIN);
    if (endMin <= startMin) continue;

    const x = gridLeft + dayOffset * dayColWidth + 1;
    const y = gridTop + ((startMin - GRID_START_MIN) / totalMin) * gridHeight;
    const w = dayColWidth - 2;
    const h = ((endMin - startMin) / totalMin) * gridHeight;

    doc.setFillColor(219, 234, 254);
    doc.setDrawColor(59, 130, 246);
    doc.rect(x, y, w, h, 'FD');

    const teachers = task.resources.filter((r) => r.type === 'teacher').map((r) => r.id);
    const rooms = task.resources.filter((r) => r.type === 'room').map((r) => r.id);
    const groups = task.resources.filter((r) => r.type === 'group').map((r) => r.id);
    const lines = [
      `${task.code} ${task.type}`,
      teachers.join(', '),
      rooms.join(', '),
      groups.join(', '),
    ].filter(Boolean);

    doc.setTextColor(30, 41, 59);
    const lineHeight = 7.5;
    const maxLines = Math.max(1, Math.floor((h - 2) / lineHeight));
    doc.setFontSize(6.5);
    lines.slice(0, maxLines).forEach((line, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      const wrapped = doc.splitTextToSize(line, w - 3) as string[];
      doc.text(wrapped[0] ?? '', x + 1.5, y + 7 + i * lineHeight);
    });
  }

  return doc;
}

/**
 * Déclenche le téléchargement d'un PDF représentant la grille hebdomadaire pour l'ensemble
 * de tâches donné (mode "filtré").
 *
 * @param tasks             Tâches de la solution active
 * @param week              Numéro de semaine ISO
 * @param schoolYearConfig  Année universitaire sélectionnée par l'utilisateur
 * @param filter            Filtre de recherche actif (utilisé dans le titre/nom du fichier), vide si aucun
 */
export function downloadPdfSolution(
  tasks: TaskSolutionJSON[],
  week: number,
  schoolYearConfig?: SchoolYearConfig | null,
  filter = '',
): void {
  const monday = getMondayOfISOWeek(week, resolveCalendarYear(schoolYearConfig, week));
  const baseName = buildExportBaseName(week, monday, schoolYearConfig, filter);
  const doc = generateWeeklyGridPdf(tasks, baseName);
  triggerBrowserDownload(doc.output('blob'), `${baseName}.pdf`);
}

/** Type de ressource par lequel éclater l'export en une archive multi-PDF (identique à l'ICS). */
export type PdfResourceType = ExportResourceType;

/** Libellés utilisateur des modes d'export par ressource (repris dans le nom de l'archive). */
export const PDF_RESOURCE_TYPE_LABELS = EXPORT_RESOURCE_TYPE_LABELS;

/**
 * Déclenche le téléchargement d'une archive .zip contenant un .pdf par ressource
 * (`{{id}}.pdf`) du type demandé.
 *
 * @param tasks             Tâches de la solution active (non filtrées par la recherche)
 * @param week              Numéro de semaine ISO
 * @param schoolYearConfig  Année universitaire sélectionnée par l'utilisateur
 * @param resourceType      Type de ressource par lequel éclater l'export
 */
export async function downloadPdfArchive(
  tasks: TaskSolutionJSON[],
  week: number,
  schoolYearConfig: SchoolYearConfig | null | undefined,
  resourceType: PdfResourceType,
): Promise<void> {
  const monday = getMondayOfISOWeek(week, resolveCalendarYear(schoolYearConfig, week));
  const groups = groupTasksByResource(tasks, resourceType);

  const zip = new JSZip();
  for (const [id, resourceTasks] of groups) {
    const doc = generateWeeklyGridPdf(resourceTasks, id);
    zip.file(`${sanitizeFileNamePart(id)}.pdf`, doc.output('arraybuffer'));
  }
  const blob = await zip.generateAsync({ type: 'blob' });

  const archiveBaseName = buildExportArchiveBaseName(week, monday, schoolYearConfig, PDF_RESOURCE_TYPE_LABELS[resourceType]);
  triggerBrowserDownload(blob, `${archiveBaseName}.zip`);
}
