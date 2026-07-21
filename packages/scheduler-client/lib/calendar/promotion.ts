import type { EnforcedData } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import { getCourseGroupInfo, type TaskGroupConfig } from '@/lib/taskGroupUtils';
import type { Placement } from '@/store/types';

export type PromotionBlocker = 'multi-placement' | 'task-group';

export interface PromotionCandidate {
  placementId: string;
  taskId: string;
  course: CourseTaskDataWithId;
  startTime: number;
  /** Absent = promouvable. Présent = proposé grisé, avec la raison. */
  blockedBy?: PromotionBlocker;
}

/**
 * Retouches (`post-enforced`) proposables à la promotion en impositions, au retour à la
 * préparation. Règles, dans cet ordre : cours introuvable → ignorée ; plusieurs placements
 * partageant le `taskId` → `multi-placement` ; membre d'un `taskGroup` → `task-group` ; sinon
 * promouvable. Ordre de sortie déterministe (`startTime` puis `taskId`) : la liste est cochée à
 * la main, elle ne doit pas se réordonner d'un rendu à l'autre.
 */
export function selectPromotionCandidates(
  placements: Placement[],
  taskGroups: TaskGroupConfig[],
  courseById: Map<string, CourseTaskDataWithId>,
): PromotionCandidate[] {
  const postEnforced = placements.filter((p) => p.origin === 'post-enforced');

  // Comptage sur TOUS les placements, pas seulement les retouches : une imposition ne porte qu'un
  // créneau, donc dès qu'une tâche est posée plusieurs fois — quelles que soient les origines —
  // aucun de ses placements n'est promouvable. Un mélange auto + post-enforced sur un même
  // `taskId` est inatteignable aujourd'hui (une tâche a soit un placement auto, soit des morceaux
  // d'Autonomie tous post-enforced), mais compter ici est gratuit et ferme un mode de défaillance
  // muet : sinon la retouche compterait 1, serait déclarée promouvable, et l'imposition figerait
  // la tâche à un créneau alors qu'un autre de ses placements vit ailleurs.
  const countByTaskId = new Map<string, number>();
  for (const p of placements) {
    countByTaskId.set(p.taskId, (countByTaskId.get(p.taskId) ?? 0) + 1);
  }

  const candidates: PromotionCandidate[] = [];
  for (const p of postEnforced) {
    const course = courseById.get(p.taskId);
    if (!course) continue;

    const blockedBy: PromotionBlocker | undefined =
      (countByTaskId.get(p.taskId) ?? 0) > 1
        ? 'multi-placement'
        : getCourseGroupInfo(taskGroups, p.taskId) !== null
          ? 'task-group'
          : undefined;

    candidates.push({
      placementId: p.placementId,
      taskId: p.taskId,
      course,
      startTime: p.startTime,
      ...(blockedBy ? { blockedBy } : {}),
    });
  }

  return candidates.sort((a, b) => a.startTime - b.startTime || a.taskId.localeCompare(b.taskId));
}

/** EnforcedData d'un placement promu — combo exact, sans alternatives (cf. EnforcedData). */
export function enforcedDataFromPlacement(placement: Placement): EnforcedData {
  return {
    startTime: placement.startTime,
    teacher: placement.resources.teachers,
    groups: placement.resources.groups,
    rooms: placement.resources.rooms,
  };
}
