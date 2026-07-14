import type { SchedulerConfig } from '@edt-ts/scheduler-common';
import { Scheduler, SLOT_STEP, type BacktrackOutcome } from './scheduler.js';
import type { ISchedulingUnit, UnitSolution } from './schedulingUnit.js';

/**
 * Moteur de planification par backjumping dirigé par les conflits (Conflict-Directed
 * Backjumping — Gaschnig 1979, Prosser 1993 ; voir docs/HeuristiquePriorite-Conception.md
 * §4.5 et §5.7). Ne redéfinit QUE `_backtrack()` — tout le reste (tri MCV, pause flottante,
 * limites quotidiennes, pré-booking des enforced, solveWithElimination) est hérité tel quel
 * de `Scheduler`, par construction jamais affecté par ce fichier.
 *
 * Différence avec le backtracking chronologique de `Scheduler` : sur un échec, au lieu de
 * ne remonter que d'un seul niveau, on identifie l'unité la plus récente réellement en
 * conflit (§4.5, `_computeConflictSet` hérité de `Scheduler`) et on saute directement à
 * elle, sans re-tester inutilement les unités intermédiaires — provablement innocentes.
 *
 * Pas d'ensemble de conflit à fusionner/mémoriser entre les nœuds (contrairement à Prosser
 * dans un CSP générique) : `_computeConflictSet` scanne l'état RÉEL et PARTAGÉ de `_solution`
 * à chaque échec, qui reste à jour tant que l'unité fautive n'est pas elle-même dépassée par
 * un saut — voir la discussion avec Frédéric, prouvé par les tests de ce module plutôt que
 * par le seul argument théorique. Aucune donnée d'instance supplémentaire n'est donc requise.
 */
export class BackjumpingScheduler extends Scheduler {
    override readonly algorithmName = 'backjumping';

    protected override _backtrack(unitIndex: number): BacktrackOutcome {
        this._iterations++;

        if (this._limitsReached()) return false;

        // Solution complète trouvée — identique à Scheduler._backtrack (rien ne diverge ici)
        if (unitIndex >= this._units.length) {
            this._solutionsFound++;
            const score = this._computeScore();
            const snapshot: UnitSolution[] = this._solution.flatMap(s =>
                s.unit.toSolutions(s.result)
            );
            this._allSolutions.push({ solutions: snapshot, isComplete: true, score });
            if (score > this._bestScore) this._bestScore = score;
            console.log(`✅ Solution ${this._solutionsFound}/${this._config.maxSolutions} (score: ${score})`);
            if (this._solutionsFound >= this._config.maxSolutions) return true;
            return false;
        }

        // Tri MCV dynamique — identique
        this._dynamicSort(unitIndex);
        const unit = this._units[unitIndex];

        // Vérification des dépendances — identique
        const dep = unit.getDependsOn();
        if (dep && !this._scheduled.has(dep.id)) {
            throw new Error(
                `Unité '${unit.id}' : dépendance '${dep.id}' non encore planifiée — ` +
                `vérifiez que le graphe de dépendances est acyclique et cohérent avec le tri.`
            );
        }

        let fromTime = 0;
        if (dep) {
            const depResult = this._scheduled.get(dep.id)!;
            fromTime = depResult.start + dep.duration;
        }

        // ── Exploration : c'est ici, et seulement ici, que le backjumping diverge ──
        while (true) {
            const result = unit.earlySchedule(fromTime);
            if (result === null) {
                // Aucun créneau disponible → identifier la véritable cause plutôt que
                // blâmer chronologiquement, et sauter directement à elle si possible.
                const occupants = this._computeConflictSet(unit, fromTime);
                this._blameConflictSet(unit, occupants); // conserve le comptage de §5.7 tel quel

                if (occupants.size === 0) return false; // rien à qui sauter — repli chronologique normal

                // Cible du saut : le membre le plus profond dans _solution (le plus récemment
                // réservé) — c'est lui qui, en changeant, a le plus de chances de résoudre le
                // conflit sans perturber les décisions plus anciennes et non impliquées.
                let target: ISchedulingUnit | null = null;
                for (let i = this._solution.length - 1; i >= 0; i--) {
                    if (occupants.has(this._solution[i].unit)) { target = this._solution[i].unit; break; }
                }
                return target!.id;
            }

            // Filtres pause flottante / limite quotidienne — identiques
            if (!this._floatingLBAllows(result, unit.duration)) {
                fromTime = result.start + SLOT_STEP;
                continue;
            }
            if (!this._dailyLimitAllows(result, unit.duration)) {
                fromTime = result.start + SLOT_STEP;
                continue;
            }

            this._solution.push({ unit, result });
            this._scheduled.set(unit.id, result);
            unit.book(result);
            this._addDailyUsage(result, unit.duration);

            const subResult = this._backtrack(unitIndex + 1);

            unit.unBook(result);
            this._subtractDailyUsage(result, unit.duration);
            this._solution.pop();
            this._scheduled.delete(unit.id);

            if (subResult === true) return true;

            if (subResult === false) {
                // Échec normal en dessous, sans cible spécifique — c'est notre tour de retenter.
                fromTime = result.start + SLOT_STEP;
                continue;
            }

            // subResult est une chaîne : une cible de saut a été désignée plus bas.
            if (subResult === unit.id) {
                // La cible, c'est nous — le saut s'arrête ici, on retente notre prochain créneau
                // exactement comme un échec normal (comportement identique à `false` à partir
                // de ce point).
                fromTime = result.start + SLOT_STEP;
                continue;
            }

            // La cible n'est pas nous : on ne retente RIEN (c'est tout le gain du backjumping —
            // on ne re-teste pas une unité provablement innocente), on propage tel quel.
            return subResult;
        }
    }
}

/**
 * Fabrique choisissant l'implémentation selon `config.algorithm` (défaut : backtracking
 * chronologique classique). Point d'entrée unique recommandé pour instancier un moteur —
 * utilisé par les deux contrôleurs de scheduler-api.
 */
export function createScheduler(config?: SchedulerConfig): Scheduler {
    return config?.algorithm === 'backjumping' ? new BackjumpingScheduler() : new Scheduler();
}
