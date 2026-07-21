import type { CourseTaskData, TaskSolutionJSON, ResourceEntry, NeutralizedTaskInfoJSON } from '@edt-ts/scheduler-common';
import type { TaskCardProps } from '@/components/planning/courses/TaskCard';
import type { ManuallyNeutralizedTask, Placement } from '@/store/types';

/**
 * Préfixe des taskId synthétiques des tâches pré-neutralisées avant planification (voir
 * `runSchedule`/`syntheticNeutralized`). Convention posée par notre propre code — un seul point
 * de construction, `pre-neutral-${course.id}` — donc la retirer pour retrouver le vrai
 * `course.id` est déterministe, à la différence d'une dérivation positionnelle sur une donnée
 * externe (cf. mémoire projet sur le piège des identifiants positionnels).
 *
 * Disparaîtra à l'étape 2 du modèle unifié, quand l'origine `user-pre` remplacera la convention
 * de préfixe.
 */
export const PRE_NEUTRAL_PREFIX = 'pre-neutral-';

/**
 * `course.id` réel derrière un taskId éventuellement préfixé. **Tout** rapprochement entre une
 * entrée de `activeNeutralizedTasks` (qui porte l'id préfixé) et un `Placement` (qui porte l'id
 * réel) doit passer par ici : sans ça la comparaison échoue silencieusement et la même tâche
 * peut être placée plusieurs fois.
 */
export function realTaskId(taskId: string): string {
  return taskId.startsWith(PRE_NEUTRAL_PREFIX) ? taskId.slice(PRE_NEUTRAL_PREFIX.length) : taskId;
}

/**
 * Tâches neutralisées qui ne sont pas (ou plus) posées sur le calendrier — c'est ce que la pioche
 * affiche. Extrait en fonction pure parce que la comparaison est piégeuse : côté neutralisées les
 * pré-neutralisées portent un id préfixé, côté placements l'id est toujours réel.
 */
export function selectUnplacedNeutralized(
  activeNeutralizedTasks: NeutralizedTaskInfoJSON[],
  placements: Placement[],
): NeutralizedTaskInfoJSON[] {
  const placedIds = new Set(placements.map((p) => p.taskId));
  return activeNeutralizedTasks.filter((t) => !placedIds.has(realTaskId(t.task.taskId)));
}

export type TaskCardBaseProps = Pick<
  TaskCardProps,
  'code' | 'type' | 'name' | 'duration' | 'teachers' | 'groups' | 'rooms'
>;

/** Convertit un ResourceEntry[] (string | string[]) en string[] lisible. */
export function normalizeResourceEntries(entries: ResourceEntry[]): string[] {
  return entries.map((e) => (Array.isArray(e) ? e.join(' | ') : e));
}

export function courseToBaseProps(course: CourseTaskData): TaskCardBaseProps {
  return {
    code: course.code,
    type: course.type,
    name: course.name,
    duration: course.duration,
    teachers: normalizeResourceEntries(course.teacher),
    groups: normalizeResourceEntries(course.groups),
    rooms: normalizeResourceEntries(course.rooms ?? []),
  };
}

export function solutionToBaseProps(task: TaskSolutionJSON): TaskCardBaseProps {
  return {
    code: task.code,
    type: task.type,
    name: task.name,
    duration: task.duration,
    teachers: task.resources.filter((r) => r.type === 'teacher').map((r) => r.id),
    groups: task.resources.filter((r) => r.type === 'group').map((r) => r.id),
    rooms: task.resources.filter((r) => r.type === 'room').map((r) => r.id),
  };
}

export function manuallyNeutralizedToBaseProps(task: ManuallyNeutralizedTask): TaskCardBaseProps {
  return {
    code: task.code,
    type: task.type,
    name: task.name,
    duration: task.duration,
    teachers: task.teachers,
    groups: task.groups,
    rooms: task.rooms,
  };
}

/**
 * Résout les infos d'un cours neutralisé par son taskId, quelle que soit la source :
 * neutralisé par le moteur / pré-neutralisé (activeNeutralizedTasks), ou retiré
 * manuellement du calendrier après coup (manuallyNeutralizedTasks). Retourne null si
 * le taskId ne correspond à aucun des deux (ex: déjà replacé sur le calendrier).
 */
export function resolveNeutralizedTaskById(
  taskId: string,
  activeNeutralizedTasks: NeutralizedTaskInfoJSON[],
  manuallyNeutralizedTasks: ManuallyNeutralizedTask[],
): (TaskCardBaseProps & { taskId: string }) | null {
  const fromSolution = activeNeutralizedTasks.find((t) => t.task.taskId === taskId);
  if (fromSolution) return { ...solutionToBaseProps(fromSolution.task), taskId };

  const fromManual = manuallyNeutralizedTasks.find((t) => t.taskId === taskId);
  if (fromManual) return { ...manuallyNeutralizedToBaseProps(fromManual), taskId };

  return null;
}
