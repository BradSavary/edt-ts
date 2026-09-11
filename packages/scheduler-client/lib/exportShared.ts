/**
 * Utilitaires communs aux exports de planning (ICS et PDF) : découpage par ressource,
 * nommage de fichier, déclenchement du téléchargement navigateur.
 */
import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';
import type { SchoolYearConfig } from '@/lib/schoolHolidays';

/** Type de ressource par lequel éclater un export en une archive multi-fichiers. */
export type ExportResourceType = 'group' | 'teacher' | 'room';

/** Libellés utilisateur des modes d'export par ressource (repris dans le nom de l'archive). */
export const EXPORT_RESOURCE_TYPE_LABELS: Record<ExportResourceType, string> = {
  group: 'Groupes',
  teacher: 'Enseignants',
  room: 'Salles',
};

/** Retire les caractères invalides dans un nom de fichier (toutes plateformes). */
export function sanitizeFileNamePart(value: string): string {
  return value.trim().replace(/[/\\:*?"<>|]/g, '');
}

/**
 * Libellé de l'année universitaire (ex: "2026-2027"), tel que sélectionné par l'utilisateur ;
 * à défaut de `schoolYearConfig`, reconstruit depuis l'année civile effectivement utilisée pour
 * dater les événements (voir `resolveCalendarYear`).
 */
export function resolveUniversityYearLabel(
  week: number,
  monday: Date,
  schoolYearConfig: SchoolYearConfig | null | undefined,
): string {
  return schoolYearConfig?.year ?? (
    week >= 35
      ? `${monday.getFullYear()}-${monday.getFullYear() + 1}`
      : `${monday.getFullYear() - 1}-${monday.getFullYear()}`
  );
}

/** Base commune "{{Filtre}} S{{Week}} {{Year}}" (sans extension), reprise par les deux formats
 *  d'export (ICS/PDF) pour le fichier "solution" (mode filtré). */
export function buildExportBaseName(
  week: number,
  monday: Date,
  schoolYearConfig: SchoolYearConfig | null | undefined,
  filter: string,
): string {
  const universityYear = resolveUniversityYearLabel(week, monday, schoolYearConfig);
  const filterPart = sanitizeFileNamePart(filter);
  return `${filterPart ? filterPart + ' ' : ''}S${week} ${universityYear}`;
}

/** Base commune "{{Label}} S{{Week}} {{Year}}" (sans extension) pour le nom de l'archive
 *  multi-fichiers (ex: "Groupes S38 2026-2027"). */
export function buildExportArchiveBaseName(
  week: number,
  monday: Date,
  schoolYearConfig: SchoolYearConfig | null | undefined,
  label: string,
): string {
  const universityYear = resolveUniversityYearLabel(week, monday, schoolYearConfig);
  return `${sanitizeFileNamePart(label)} S${week} ${universityYear}`;
}

/** Répartit les tâches par identifiant de ressource d'un type donné (une tâche multi-ressources
 *  apparaît dans le groupe de chacune de ses ressources de ce type). */
export function groupTasksByResource(
  tasks: TaskSolutionJSON[],
  resourceType: ExportResourceType,
): Map<string, TaskSolutionJSON[]> {
  const groups = new Map<string, TaskSolutionJSON[]>();
  for (const task of tasks) {
    for (const resource of task.resources) {
      if (resource.type !== resourceType) continue;
      const list = groups.get(resource.id);
      if (list) list.push(task);
      else groups.set(resource.id, [task]);
    }
  }
  return groups;
}

/** Déclenche le téléchargement d'un blob sous le nom de fichier donné (lien `<a>` éphémère). */
export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
