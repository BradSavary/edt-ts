import { Task, Resource } from '@edt-ts/scheduler-common';
import { Loader } from './loader.js';
import type { ISchedulingUnit, SchedulingResult, UnitSolution } from './schedulingUnit.js';
import { DEPENDENTS_WEIGHT } from './schedulingHeuristics.js';

/**
 * Adaptateur entre Task (scheduler-common) et ISchedulingUnit (scheduler-core).
 *
 * Encapsule toute la logique de planification propre à une tâche atomique :
 *  - earlySchedule : explore toutes les combinaisons de ressources et retourne
 *    le créneau le plus tôt possible, toutes combinaisons confondues.
 *  - book / unBook : réservation/libération des ressources avec pile de sauvegarde.
 *  - getSchedulingPriority : heuristique MCV basée sur l'état courant des ressources.
 *
 * Le moteur (Scheduler) ne voit que ISchedulingUnit — il ignore que c'est un TaskUnit.
 */
export class TaskUnit implements ISchedulingUnit {
    readonly task: Task;
    private _dependsOn: ISchedulingUnit | null = null;
    private _dependentUnits: ISchedulingUnit[] = [];
    /** Pile LIFO pour restaurer appliedResources lors des unBook. */
    private _savedResources: Resource[][] = [];

    constructor(task: Task) {
        this.task = task;
    }

    get id(): string { return this.task.id; }
    get duration(): number { return this.task.duration; }
    get isEnforced(): boolean { return this.task.isEnforced; }

    // ── Planification ──────────────────────────────────────────────────────

    earlySchedule(fromTime: number): SchedulingResult | null {
        const allCombinations = this.task.getApplicableResources();
        if (allCombinations.length === 0) return null;

        const savedResources = [...this.task.appliedResources];
        let best: SchedulingResult | null = null;

        for (const combo of allCombinations) {
            this.task.appliedResources = combo;
            const slot = this._findFirstSlot(fromTime);
            if (slot !== null && (best === null || slot < best.start)) {
                best = { start: slot, resources: combo };
            }
        }

        // Restauration : earlySchedule est en lecture seule vis-à-vis de l'état externe
        this.task.appliedResources = savedResources;
        return best;
    }

    private _findFirstSlot(fromTime: number): number | null {
        for (const interval of this.task.schedulable.getAvailableIntervals()) {
            const effectiveStart = Math.max(interval.start, fromTime);
            if (interval.end - effectiveStart >= this.task.duration) {
                return effectiveStart;
            }
        }
        return null;
    }

    book(result: SchedulingResult): void {
        this._savedResources.push([...this.task.appliedResources]);
        this.task.appliedResources = result.resources;
        for (const r of result.resources) {
            r.availability.removeAvailability(result.start, result.start + this.task.duration);
            // Invalider le schedulable de toutes les tâches partageant cette ressource
            for (const t of r.getTasks() as Task[]) {
                t.invalidateSchedulable();
            }
        }
    }

    unBook(result: SchedulingResult): void {
        for (const r of result.resources) {
            r.availability.addAvailability(result.start, result.start + this.task.duration);
            for (const t of r.getTasks() as Task[]) {
                t.invalidateSchedulable();
            }
        }
        this.task.appliedResources = this._savedResources.pop() ?? [];
    }

    bookEnforced(): void {
        const enforced = this.task.enforced!;
        const rm = Loader.resourcesManager;
        const resources = [
            ...enforced.teacher,
            ...enforced.groups,
            ...enforced.rooms,
        ].map(id => rm.getResource(id))
         .filter((r): r is Resource => r !== undefined);

        this.task.appliedResources = resources;
        for (const r of resources) {
            if (!r.availability.isAvailable(enforced.startTime, enforced.startTime + this.task.duration)) {
                console.warn(
                    `⚠️ Tâche enforced "${this.task.name}" (${this.task.code}) : ` +
                    `ressource "${r.id}" non disponible au créneau imposé — booking forcé.`
                );
            }
            r.availability.removeAvailability(enforced.startTime, enforced.startTime + this.task.duration);
            for (const t of r.getTasks() as Task[]) {
                t.invalidateSchedulable();
            }
        }
    }

    getEnforcedResult(): SchedulingResult {
        const enforced = this.task.enforced!;
        return {
            start: enforced.startTime,
            resources: [...this.task.appliedResources],
        };
    }

    // ── Priorité MCV ───────────────────────────────────────────────────────

    /**
     * Score MCV (Most Constrained Variable) : plus le score est élevé, plus la
     * tâche est prioritaire. Basé sur la meilleure disponibilité résiduelle
     * parmi toutes les combinaisons de ressources applicables (pas seulement
     * la combinaison actuellement décidée — voir `getBestApplicableAvailableTime`).
     *
     * Propagation aux dépendants par **max**, pas par somme : un dépendant très
     * contraint doit rendre son bloqueur au moins aussi urgent que lui (le retarder
     * retarde d'autant le dépendant), jamais moins urgent. Une somme de deux scores
     * négatifs (l'échelle utilisée ici : moins de disponibilité ⇒ score moins négatif)
     * ferait l'inverse — elle pénaliserait toute tâche ayant des dépendants par
     * rapport à une tâche isolée, indépendamment de sa propre disponibilité.
     */
    getSchedulingPriority(): number {
        const ownScore = -this.task.getBestApplicableAvailableTime();

        let bestDependentScore = -Infinity;
        for (const dep of this._dependentUnits) {
            const score = DEPENDENTS_WEIGHT * dep.getSchedulingPriority();
            if (score > bestDependentScore) bestDependentScore = score;
        }

        return Math.max(ownScore, bestDependentScore);
    }

    // ── Dépendances ────────────────────────────────────────────────────────

    getDependsOn(): ISchedulingUnit | null { return this._dependsOn; }
    getDependentUnits(): ISchedulingUnit[] { return [...this._dependentUnits]; }
    hasDependentUnits(): boolean { return this._dependentUnits.length > 0; }

    setDependsOn(unit: ISchedulingUnit): void {
        if (this._dependsOn) {
            this._dependsOn._removeDependentUnit(this);
        }
        this._dependsOn = unit;
        unit._addDependentUnit(this);
    }

    _addDependentUnit(unit: ISchedulingUnit): void {
        if (!this._dependentUnits.includes(unit)) {
            this._dependentUnits.push(unit);
        }
    }

    _removeDependentUnit(unit: ISchedulingUnit): void {
        const index = this._dependentUnits.indexOf(unit);
        if (index !== -1) this._dependentUnits.splice(index, 1);
    }

    // ── Sérialisation ──────────────────────────────────────────────────────

    toSolutions(result: SchedulingResult): UnitSolution[] {
        return [{ unit: this, start: result.start, resources: result.resources }];
    }

    getCandidateResources(): Resource[] {
        const seen = new Set<Resource>();
        const out: Resource[] = [];
        for (const alternatives of Object.values(this.task.resources)) {
            for (const combo of alternatives as Resource[][]) {
                for (const r of combo) {
                    if (!seen.has(r)) { seen.add(r); out.push(r); }
                }
            }
        }
        return out;
    }

    getMemberTasks(): Task[] {
        return [this.task];
    }
}
