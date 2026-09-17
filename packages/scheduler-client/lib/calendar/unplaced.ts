import type { NeutralizedTaskInfoJSON } from '@edt-ts/scheduler-common';
import type { CourseTaskDataWithId } from '@/lib/courseId';
import type { Placement, Unplaced } from '@/store/types';

/**
 * Diagnostics moteur d'une tâche non placée par le moteur. `taskId` est déjà le `course.id`
 * réel (acquis du chantier identifiants stables) : aucun préfixe à retirer.
 */
export function unplacedFromEngine(neutralized: NeutralizedTaskInfoJSON[]): Unplaced[] {
  return neutralized.map((n) => ({
    taskId: n.task.taskId,
    origin: 'engine',
    // `slug` omis plutôt que posé à `undefined` : `Unplaced` est persisté par semaine, et une
    // clé vide y resterait indéfiniment. Un moteur antérieur à ce chantier n'en émet pas.
    diagnostics: { reason: n.reason, ...(n.reasonSlug ? { slug: n.reasonSlug } : {}) },
  }));
}

/**
 * Ce non-placement relève-t-il d'un choix de l'utilisateur plutôt que d'un échec du moteur ?
 *
 * Règle unique du §6 de docs/PlanDiagnosticEchec.md, appliquée partout où la distinction compte
 * (sections de la sidebar, compteur du message de statut, `isComplete`). Trois cas la satisfont :
 * l'exclusion avant le run, le retrait après le run, et **le type hors périmètre du moteur** —
 * une `Autonomie` revient dans `neutralizedTasks` avec `origin: 'engine'` alors qu'elle n'a jamais
 * été soumise. La ranger parmi les non placés déplacerait le mélange au lieu de le supprimer.
 */
export function isUserChoice(entry: Unplaced): boolean {
  if (entry.origin === 'user-pre' || entry.origin === 'user-post') return true;
  return entry.diagnostics?.slug === 'excluded-type';
}

/** Cours exclus par l'utilisateur avant planification — jamais envoyés au moteur. */
export function unplacedFromPreNeutralized(taskIds: string[]): Unplaced[] {
  return taskIds.map((taskId) => ({ taskId, origin: 'user-pre' }));
}

/**
 * `resteÀPlacer(tâche) = durée(cours) − Σ durée(placements de cette tâche)`, jamais négatif.
 * Invariant unique derrière l'affichage de la pioche (§1.2 du plan) : une tâche ordinaire posée
 * disparaît (reste = 0), une Autonomie répartie partiellement y reste avec sa durée résiduelle —
 * même règle, pas un cas particulier. `course` absent (tâche introuvable) → 0, rien à placer.
 */
export function remainingDuration(
  taskId: string,
  placements: Placement[],
  course: CourseTaskDataWithId | undefined,
): number {
  if (!course) return 0;
  const placed = placements
    .filter((p) => p.taskId === taskId)
    .reduce((sum, p) => sum + (p.duration ?? course.duration), 0);
  return Math.max(0, course.duration - placed);
}

/**
 * Entrées à afficher dans la pioche : celles dont le reste est > 0. **Unique** point de décision
 * « affiché ou non » — une tâche entièrement posée ne doit jamais y réapparaître (c'est le bug
 * de l'étape 1, cf. docs/PlanUnifiedPlacements.md). Un `taskId` sans cours correspondant est
 * ignoré silencieusement plutôt que de jeter.
 */
export function selectPiocheEntries(
  unplaced: Unplaced[],
  placements: Placement[],
  courseById: Map<string, CourseTaskDataWithId>,
): Array<{ entry: Unplaced; course: CourseTaskDataWithId; remaining: number }> {
  const result: Array<{ entry: Unplaced; course: CourseTaskDataWithId; remaining: number }> = [];
  for (const entry of unplaced) {
    const course = courseById.get(entry.taskId);
    if (!course) continue;
    const remaining = remainingDuration(entry.taskId, placements, course);
    if (remaining > 0) result.push({ entry, course, remaining });
  }
  return result;
}
