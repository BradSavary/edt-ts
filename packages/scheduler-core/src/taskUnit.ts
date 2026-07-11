import { Task, Resource, Availability, encodePriorityMeasure, measureProfile, findLastSlot, computeDependentsDeadline, type FloatingLunchWindow } from '@edt-ts/scheduler-common';
import { Loader } from './loader.js';
import type { ISchedulingUnit, SchedulingResult, UnitSolution } from './schedulingUnit.js';

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
    /** Fenêtre de pause flottante pour le calcul du score (§5.5) — voir setFloatingLunchBreak. */
    private _floatingLunch: FloatingLunchWindow | null = null;

    constructor(task: Task) {
        this.task = task;
    }

    setFloatingLunchBreak(window: FloatingLunchWindow | null): void {
        this._floatingLunch = window;
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
     * Profil de disponibilité effectif : le meilleur profil de la tâche (§5.3),
     * chaque combo étant d'abord tronqué par l'échéance qu'imposent ses dépendants
     * (§5.6 de docs/HeuristiquePriorite-Conception.md — troncature par échéance,
     * remplace entièrement l'ancienne propagation par `max`/somme de scores ;
     * `computeDependentsDeadline` gère aussi bien un dépendant unique que plusieurs,
     * cf. "Dépendants multiples") AVANT la comparaison entre combos, pas seulement
     * le combo gagnant après coup — sinon la sélection du meilleur combo peut se
     * tromper (vérifié à la main, voir la mémoire de suivi du projet). Vue calculée,
     * ne mute jamais la disponibilité réelle des ressources — `earlySchedule()` reste
     * seul juge du placement réel. Pas de cache : profondeur d'arbre de dépendance
     * faible en pratique (voir §5.6).
     */
    private _computeEffectiveProfile(): Availability {
        if (this._dependentUnits.length === 0) {
            return this.task.getBestSchedulingProfile(this._floatingLunch);
        }

        const deps: { ls: number; duration: number }[] = [];
        for (const dep of this._dependentUnits) {
            const ls = dep.getEffectiveLatestStart();
            if (ls === null) return new Availability(); // dépendant infaisable → hérite l'infaisabilité
            deps.push({ ls, duration: dep.duration });
        }
        // L'échéance est calculée AVANT de choisir le combo — elle ne dépend pas du
        // combo de cette tâche — puis transmise à getBestSchedulingProfile pour que
        // CHAQUE combo soit tronqué avant comparaison, pas seulement le gagnant après
        // coup (sinon un combo à plusieurs fenêtres étroites peut battre à tort un
        // combo à une fenêtre large sur la comparaison brute — vérifié à la main).
        const deadline = computeDependentsDeadline(deps);
        return this.task.getBestSchedulingProfile(this._floatingLunch, deadline);
    }

    /**
     * Score MCV (Most Constrained Variable) : plus le score est élevé, plus la
     * tâche est prioritaire. Mesure à deux niveaux (§5.1) sur le profil effectif
     * (ci-dessus), encodée en scalaire via `encodePriorityMeasure` (seul point de
     * négation, voir priorityMeasure.ts).
     */
    getSchedulingPriority(): number {
        return encodePriorityMeasure(measureProfile(this._computeEffectiveProfile(), this.task.duration));
    }

    /** Voir ISchedulingUnit.getEffectiveLatestStart — utilisé par les ancêtres pour leur propre troncature. */
    getEffectiveLatestStart(): number | null {
        return findLastSlot(this._computeEffectiveProfile(), this.task.duration);
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
