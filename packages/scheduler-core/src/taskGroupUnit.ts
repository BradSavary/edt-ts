import { Task, Resource } from '@edt-ts/scheduler-common';
import type { ISchedulingUnit, SchedulingResult, UnitSolution } from './schedulingUnit.js';

const SLOT_STEP = 30;

/**
 * Affectation d'une tâche membre lors du calcul earlySchedule.
 * Stockée en interne entre earlySchedule et book.
 */
interface TaskAssignment {
    task: Task;
    slotStart: number;
    slotEnd: number;
    resources: Resource[];
}

/**
 * Adaptateur entre TaskGroup (scheduler-common) et ISchedulingUnit (scheduler-core).
 *
 * Délègue earlySchedule à la stratégie correspondant au type du groupe :
 *  - parallel   : toutes les tâches démarrent au même instant.
 *  - sequential : les tâches s'enchaînent sans gap dans l'ordre du groupe.
 *
 * Le moteur (Scheduler) ne voit que ISchedulingUnit.
 */
export class TaskGroupUnit implements ISchedulingUnit {
    readonly id: string;
    private readonly _groupType: 'parallel' | 'sequential';
    private readonly _tasks: Task[];
    private _dependsOn: ISchedulingUnit | null = null;
    private _dependentUnits: ISchedulingUnit[] = [];
    /** Affectation calculée par earlySchedule, utilisée par book/unBook. */
    private _pendingAssignment: TaskAssignment[] | null = null;
    /** Pile LIFO de sauvegardes pour unBook. */
    private _savedAssignments: TaskAssignment[][] = [];

    constructor(id: string, groupType: 'parallel' | 'sequential', tasks: Task[]) {
        this.id = id;
        this._groupType = groupType;
        this._tasks = tasks;
    }

    get duration(): number {
        if (this._tasks.length === 0) return 0;
        if (this._groupType === 'parallel') {
            return Math.max(...this._tasks.map(t => t.duration));
        }
        return this._tasks.reduce((sum, t) => sum + t.duration, 0);
    }
    get isEnforced(): false { return false; }

    // ── Planification ──────────────────────────────────────────────────────

    earlySchedule(fromTime: number): SchedulingResult | null {
        const tasks = this._tasks;
        if (tasks.length === 0) return null;

        if (this._groupType === 'parallel') {
            return this._earlyScheduleParallel(tasks, fromTime);
        } else {
            return this._earlyScheduleSequential(tasks, fromTime);
        }
    }

    /**
     * Cherche le premier instant ≥ fromTime où TOUTES les tâches peuvent démarrer
     * simultanément, chacune avec au moins une combinaison de ressources disponible.
     */
    private _earlyScheduleParallel(tasks: Task[], fromTime: number): SchedulingResult | null {
        // Borne supérieure de recherche : 5 jours en minutes
        const MAX_TIME = 5 * 24 * 60;

        for (let t = fromTime; t < MAX_TIME; t += SLOT_STEP) {
            const assignment = this._tryParallelAt(tasks, t);
            if (assignment !== null) {
                this._pendingAssignment = assignment;
                const allResources = assignment.flatMap(a => a.resources);
                return { start: t, resources: allResources };
            }
        }
        return null;
    }

    /** Tente de placer toutes les tâches à l'instant t. Retourne null si impossible. */
    private _tryParallelAt(tasks: Task[], t: number): TaskAssignment[] | null {
        const assignment: TaskAssignment[] = [];
        for (const task of tasks) {
            const combo = this._findAvailableCombo(task, t, t + task.duration);
            if (combo === null) return null;
            assignment.push({ task, slotStart: t, slotEnd: t + task.duration, resources: combo });
        }
        return assignment;
    }

    /**
     * Cherche le premier instant anchor ≥ fromTime tel que :
     *  task[0] peut démarrer à anchor,
     *  task[1] peut démarrer à anchor + d0,
     *  task[i] peut démarrer à anchor + sum(d0..d(i-1)).
     */
    private _earlyScheduleSequential(tasks: Task[], fromTime: number): SchedulingResult | null {
        const MAX_TIME = 5 * 24 * 60;

        for (let anchor = fromTime; anchor < MAX_TIME; anchor += SLOT_STEP) {
            const assignment = this._trySequentialAt(tasks, anchor);
            if (assignment !== null) {
                this._pendingAssignment = assignment;
                const allResources = assignment.flatMap(a => a.resources);
                return { start: anchor, resources: allResources };
            }
        }
        return null;
    }

    /** Tente de placer la séquence à partir de anchor. Retourne null si impossible. */
    private _trySequentialAt(tasks: Task[], anchor: number): TaskAssignment[] | null {
        const assignment: TaskAssignment[] = [];
        let offset = 0;
        for (const task of tasks) {
            const slotStart = anchor + offset;
            const slotEnd = slotStart + task.duration;
            const combo = this._findAvailableCombo(task, slotStart, slotEnd);
            if (combo === null) return null;
            assignment.push({ task, slotStart, slotEnd, resources: combo });
            offset += task.duration;
        }
        return assignment;
    }

    /**
     * Cherche en lecture seule la première combinaison de ressources de `task`
     * dont toutes les ressources sont disponibles sur [slotStart, slotEnd].
     * Ne modifie pas l'état des ressources ni de la tâche.
     */
    private _findAvailableCombo(task: Task, slotStart: number, slotEnd: number): Resource[] | null {
        for (const combo of task.getApplicableResources()) {
            if (combo.every(r => r.availability.isAvailable(slotStart, slotEnd))) {
                return combo;
            }
        }
        return null;
    }

    book(_result: SchedulingResult): void {
        if (this._pendingAssignment === null) {
            throw new Error(`TaskGroupUnit "${this.id}" : book() appelé sans earlySchedule() préalable.`);
        }
        const assignment = this._pendingAssignment;
        this._savedAssignments.push(assignment);
        this._pendingAssignment = null;

        for (const { task, slotStart, slotEnd, resources } of assignment) {
            task.appliedResources = resources;
            for (const r of resources) {
                r.availability.removeAvailability(slotStart, slotEnd);
                for (const t of r.getTasks() as Task[]) {
                    t.invalidateSchedulable();
                }
            }
        }
    }

    unBook(_result: SchedulingResult): void {
        const assignment = this._savedAssignments.pop();
        if (!assignment) {
            throw new Error(`TaskGroupUnit "${this.id}" : unBook() sans book() correspondant.`);
        }
        for (const { task, slotStart, slotEnd, resources } of assignment) {
            for (const r of resources) {
                r.availability.addAvailability(slotStart, slotEnd);
                for (const t of r.getTasks() as Task[]) {
                    t.invalidateSchedulable();
                }
            }
            task.appliedResources = [];
        }
    }

    bookEnforced(): void {
        // Les groupes ne sont jamais enforced (option C).
        throw new Error(`TaskGroupUnit "${this.id}" : bookEnforced() ne s'applique pas à un groupe.`);
    }

    getEnforcedResult(): SchedulingResult {
        // Les groupes ne sont jamais enforced (option C).
        throw new Error(`TaskGroupUnit "${this.id}" : getEnforcedResult() ne s'applique pas à un groupe.`);
    }

    // ── Priorité MCV ───────────────────────────────────────────────────────

    /**
     * Score MCV du groupe : somme des priorités de chaque tâche membre.
     * Reflète l'état courant des ressources.
     */
    getSchedulingPriority(): number {
        if (this._tasks.length === 0) return 0;

        let score = 0;
        const MAX_WEEK_MINUTES = (10 * 4 + 4.5) * 60;

        for (const task of this._tasks) {
            // Vacataire boost
            const teacher = task.getTeacherResource();
            if (teacher?.status === 'VACATAIRE') score += 5 * 24 * 60;
            // Disponibilité résiduelle
            score += MAX_WEEK_MINUTES - task.schedulable.getTotalAvailableTime();
        }

        for (const dep of this._dependentUnits) {
            score += dep.getSchedulingPriority();
        }

        return score;
    }

    // ── Dépendances ────────────────────────────────────────────────────────

    getDependsOn(): ISchedulingUnit | null { return this._dependsOn; }
    getDependentUnits(): ISchedulingUnit[] { return [...this._dependentUnits]; }
    hasDependentUnits(): boolean { return this._dependentUnits.length > 0; }

    setDependsOn(unit: ISchedulingUnit): void {
        if (this._dependsOn) this._dependsOn._removeDependentUnit(this);
        this._dependsOn = unit;
        unit._addDependentUnit(this);
    }

    _addDependentUnit(unit: ISchedulingUnit): void {
        if (!this._dependentUnits.includes(unit)) this._dependentUnits.push(unit);
    }

    _removeDependentUnit(unit: ISchedulingUnit): void {
        const index = this._dependentUnits.indexOf(unit);
        if (index !== -1) this._dependentUnits.splice(index, 1);
    }

    // ── Sérialisation ──────────────────────────────────────────────────────

    toSolutions(result: SchedulingResult): UnitSolution[] {
        const tasks = this._tasks;
        if (this._groupType === 'parallel') {
            return tasks.map((task) => ({
                unit: this,
                start: result.start,
                resources: task.appliedResources,
                task,
            }));
        }
        // sequential : reconstituer les offsets à partir des durées
        const solutions: UnitSolution[] = [];
        let offset = 0;
        for (const task of tasks) {
            solutions.push({ unit: this, start: result.start + offset, resources: task.appliedResources, task });
            offset += task.duration;
        }
        return solutions;
    }
}
