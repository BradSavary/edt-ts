import type { TaskSolutionJSON } from '@edt-ts/scheduler-common';
import type { PlacedTaskOverride, ManuallyNeutralizedTask, PlacedNeutralizedTask } from '@/store/types';

/**
 * Calcule la solution "réellement affichée" sur le calendrier : la solution du moteur
 * (`activeSolution`), moins les tâches retirées manuellement (`manuallyNeutralizedTasks`)
 * et celles replacées ailleurs (`placedNeutralizedTasks`, pour éviter le doublon puisqu'elles
 * sont réinjectées juste après), avec les déplacements manuels (`taskOverrides`) appliqués,
 * plus les `placedNeutralizedTasks` reconverties au format `TaskSolutionJSON`.
 *
 * Fonction pure extraite de app/planning/page.tsx (comportement strictement identique) pour
 * être réutilisable ailleurs (ex: calcul de l'occupation actuelle pour la répartition
 * automatique de l'Autonomie) sans dupliquer une 3e fois cette logique de merge.
 */
export function computeEffectiveSolution(params: {
  activeSolution: TaskSolutionJSON[];
  taskOverrides: Record<string, PlacedTaskOverride>;
  manuallyNeutralizedTasks: ManuallyNeutralizedTask[];
  placedNeutralizedTasks: PlacedNeutralizedTask[];
  week: number;
}): TaskSolutionJSON[] {
  const { activeSolution, taskOverrides, manuallyNeutralizedTasks, placedNeutralizedTasks, week } = params;

  const manuallyNeutralizedIds = new Set(manuallyNeutralizedTasks.map((t) => t.taskId));
  const placedNeutralizedIds = new Set(placedNeutralizedTasks.map((t) => t.taskId));

  const base = activeSolution
    .filter((task) => !manuallyNeutralizedIds.has(task.taskId) && !placedNeutralizedIds.has(task.taskId))
    .map((task) => {
      const ov = taskOverrides[task.taskId];
      if (!ov) return task;
      return {
        ...task,
        startTime: ov.startTime,
        duration: ov.duration ?? task.duration,
        resources: [
          ...ov.teachers.map((id) => ({ id, type: 'teacher' })),
          ...ov.groups.map((id) => ({ id, type: 'group' })),
          ...ov.rooms.map((id) => ({ id, type: 'room' })),
        ],
      };
    });

  const placed: TaskSolutionJSON[] = placedNeutralizedTasks.map((task) => ({
    taskId: task.taskId,
    code: task.code,
    name: task.name,
    type: task.type,
    week,
    duration: task.duration,
    startTime: task.startTime,
    resources: [
      ...task.teachers.map((id) => ({ id, type: 'teacher' })),
      ...task.groups.map((id) => ({ id, type: 'group' })),
      ...task.rooms.map((id) => ({ id, type: 'room' })),
    ],
  }));

  return [...base, ...placed];
}
