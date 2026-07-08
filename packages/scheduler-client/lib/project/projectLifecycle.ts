import { useProjectStore } from '@/store/useProjectStore';
import { usePlanningStore } from '@/store/usePlanningStore';
import type { SchoolYearConfig } from '@/lib/schoolHolidays';
import { parseProjectFile } from './projectFile';

/**
 * Point d'entrée unique pour créer/charger/refermer un Projet.
 * Isolé de `useProjectStore.ts` pour éviter un import circulaire
 * (`usePlanningStore` importe déjà `useProjectStore`).
 * Réinitialise systématiquement la session de planification (`usePlanningStore.reset()`)
 * AVANT de muter le Projet, pour ne jamais laisser une semaine/solution d'un ancien
 * projet visible pendant la transition.
 */
export function createNewProject(name: string, schoolYearConfig: SchoolYearConfig): void {
  usePlanningStore.getState().reset();
  useProjectStore.getState().createProject(name, schoolYearConfig);
}

/** Lit et valide un fichier de projet, puis remplace le projet actif par son contenu. */
export async function loadProjectFromFile(file: File): Promise<void> {
  const text = await file.text();
  const parsed = parseProjectFile(text); // lève une erreur explicite si invalide

  usePlanningStore.getState().reset();
  useProjectStore.getState().closeProject();
  useProjectStore.getState().createProject(parsed.name, parsed.schoolYearConfig);
  useProjectStore.setState({
    coursesFileName: parsed.coursesFileName,
    allCourses: parsed.allCourses,
    resources: parsed.resources,
    constraints: parsed.constraints,
    weekSaves: parsed.weekSaves,
    yearColorConfig: parsed.yearColorConfig,
    tightThreshold: parsed.tightThreshold,
    criticalThreshold: parsed.criticalThreshold,
  });
}

export function closeCurrentProject(): void {
  usePlanningStore.getState().reset();
  useProjectStore.getState().closeProject();
}
