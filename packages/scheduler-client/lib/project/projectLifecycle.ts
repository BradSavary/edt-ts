import { useProjectStore } from '@/store/useProjectStore';
import { usePlanningStore, DEFAULT_WEEK } from '@/store/usePlanningStore';
import type { SchoolYearConfig } from '@/lib/schoolHolidays';
import { parseProjectFile, clearAllWeekKeys } from './projectFile';
import { sanitizeConstraints } from '@/lib/constraintsUtils';

/**
 * Point d'entrée unique pour créer/charger/refermer un Projet.
 * Isolé de `useProjectStore.ts` pour éviter un import circulaire
 * (`usePlanningStore` importe déjà `useProjectStore`).
 * Réinitialise systématiquement la session de planification (`usePlanningStore.reset()`)
 * AVANT de muter le Projet, pour ne jamais laisser une semaine/solution d'un ancien
 * projet visible pendant la transition.
 *
 * `clearAllWeekKeys()` est appelé explicitement à chaque transition de projet : le storage
 * engine découpé par semaine (`createProjectStorage`) balaie déjà les clés orphelines de
 * lui-même dès que `weekSaves` change (voir `setItem`), donc c'est une ceinture-bretelles —
 * mais un chemin qui muterait l'état sans passer par une écriture persistée ne serait pas
 * couvert par cette seule garantie.
 */
export function createNewProject(name: string, schoolYearConfig: SchoolYearConfig): void {
  usePlanningStore.getState().reset();
  useProjectStore.getState().createProject(name, schoolYearConfig);
  clearAllWeekKeys();
  // Après reset() (semaine remise à DEFAULT_WEEK sans recalcul), reconstruit l'état dérivé
  // (zones bloquées vacances, etc.) maintenant que le Projet est en place.
  usePlanningStore.getState().setSelectedWeek(DEFAULT_WEEK);
}

/** Lit et valide un fichier de projet, puis remplace le projet actif par son contenu. */
export async function loadProjectFromFile(file: File): Promise<void> {
  const text = await file.text();
  const parsed = parseProjectFile(text); // lève une erreur explicite si invalide

  usePlanningStore.getState().reset();
  useProjectStore.getState().closeProject();
  useProjectStore.getState().createProject(parsed.name, parsed.schoolYearConfig);
  clearAllWeekKeys();
  useProjectStore.setState({
    coursesFileName: parsed.coursesFileName,
    allCourses: parsed.allCourses,
    resources: parsed.resources,
    constraints: sanitizeConstraints(parsed.constraints),
    weekSaves: parsed.weekSaves,
    yearColorConfig: parsed.yearColorConfig,
    tightThreshold: parsed.tightThreshold,
    criticalThreshold: parsed.criticalThreshold,
  });
  // Reconstruit l'état dérivé pour DEFAULT_WEEK maintenant que allCourses/weekSaves du
  // fichier importé sont en place — restaure au passage une éventuelle préparation
  // déjà sauvegardée pour cette semaine dans le fichier importé.
  usePlanningStore.getState().setSelectedWeek(DEFAULT_WEEK);
}

export function closeCurrentProject(): void {
  usePlanningStore.getState().reset();
  useProjectStore.getState().closeProject();
  clearAllWeekKeys();
}
