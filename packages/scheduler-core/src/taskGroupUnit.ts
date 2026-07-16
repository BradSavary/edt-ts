import { Task, Resource } from '@edt-ts/scheduler-common';
import {
    type FloatingLunchWindow, type TimeRange,
    encodePriorityMeasure, countAnchorPositions, reduceToAnchors, shiftRanges, intersectRanges,
    computeDependentsDeadline,
} from './priorityMeasure.js';
import { getApplicableResources, getBestSchedulingProfile } from './taskScheduling.js';
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
    /** Ressources actuellement appliquées par tâche membre — état de recherche propre à cette unité. */
    private _appliedResources = new Map<Task, Resource[]>();
    /** Fenêtre de pause flottante pour le calcul du score (§5.5) — voir setFloatingLunchBreak. */
    private _floatingLunch: FloatingLunchWindow | null = null;

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
        const claimed = new Set<Resource>(); // ressources déjà attribuées aux tâches précédentes
        for (const task of tasks) {
            const combo = this._findAvailableCombo(task, t, t + task.duration, claimed);
            if (combo === null) return null;
            assignment.push({ task, slotStart: t, slotEnd: t + task.duration, resources: combo });
            for (const r of combo) claimed.add(r);
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
     * dont toutes les ressources sont disponibles sur [slotStart, slotEnd]
     * et n'appartiennent pas à l'ensemble `claimed` (ressources déjà attribuées
     * à d'autres tâches du même groupe pour ce créneau).
     * Ne modifie pas l'état des ressources ni de la tâche.
     */
    private _findAvailableCombo(task: Task, slotStart: number, slotEnd: number, claimed: Set<Resource> = new Set()): Resource[] | null {
        for (const combo of getApplicableResources(task)) {
            if (combo.every(r => !claimed.has(r) && r.availability.isAvailable(slotStart, slotEnd))) {
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
            this._appliedResources.set(task, resources);
            for (const r of resources) {
                r.availability.removeAvailability(slotStart, slotEnd);
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
            }
            this._appliedResources.set(task, []);
        }
        // Restaure _pendingAssignment : permet un book() immédiat (même `assignment`) sans
        // earlySchedule() préalable, pour un round-trip unBook/book symétrique — nécessaire
        // au calcul du blâme exact par contrefactuel (_computeExactConflictSet, scheduler.ts),
        // qui dé-réserve/re-réserve des entrées déjà placées en dehors du flux normal de
        // _backtrack. Sans effet sur le flux normal : après un unBook() dans _backtrack, le
        // prochain appel est toujours earlySchedule() (qui réécrit _pendingAssignment), jamais
        // book() directement.
        this._pendingAssignment = assignment;
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

    setFloatingLunchBreak(window: FloatingLunchWindow | null): void {
        this._floatingLunch = window;
    }

    /**
     * Profil de disponibilité "propre" du groupe : intersection des profils de
     * *débuts valides* de chaque membre (chaque membre réduit par sa propre durée —
     * §5.6 de docs/HeuristiquePriorite-Conception.md). Une intersection réelle, pas
     * un `min` de mesures indépendantes (approximation de la Phase 1, qui ne
     * capturait pas la validité *simultanée* requise par un groupe `parallel` —
     * contre-exemple : membre A libre à {8h,8h30,9h}, membre B à {10h,10h30} : un
     * `min` suggérait de la marge, l'intersection réelle est vide).
     *
     * `sequential` : chaque membre est en plus décalé de son offset cumulé dans la
     * séquence, pour capturer l'absence de trou (début du suivant = fin du précédent).
     *
     * `TimeRange[]`, pas `Availability` : un membre ajusté pile à sa durée produit un
     * intervalle de largeur 0 après réduction, que `Availability`/`TimeInterval`
     * (start < end strict) ne peuvent pas représenter.
     *
     * `deadlineGroupe`, si fourni (échéance imposée par les dépendants du groupe),
     * est convertie en échéance *par membre* (compte tenu de son offset et de sa
     * propre durée) et transmise à `getBestSchedulingProfile()` de CHAQUE membre —
     * pas appliquée après coup sur le résultat final. Comparer les combos d'un
     * membre sur leur profil brut puis tronquer peut sélectionner un combo
     * sous-optimal (vérifié à la main sur `TaskUnit`, même défaut ici) : le membre
     * doit finir (son propre début + sa durée) avant que le groupe entier ne doive
     * finir (`deadlineGroupe`), d'où `deadlineGroupe - this.duration + offset + task.duration`
     * (valable pour `parallel`, offset=0, `this.duration = max` des durées, comme
     * pour `sequential`, offset cumulé, `this.duration = somme` des durées).
     */
    private _computeOwnAnchors(deadlineGroupe: number = Infinity): TimeRange[] {
        if (this._tasks.length === 0) return [];

        const memberDeadline = (task: Task, offset: number): number =>
            deadlineGroupe === Infinity ? Infinity : deadlineGroupe - this.duration + offset + task.duration;

        if (this._groupType === 'parallel') {
            let anchors = reduceToAnchors(getBestSchedulingProfile(this._tasks[0], this._floatingLunch, memberDeadline(this._tasks[0], 0)), this._tasks[0].duration);
            for (let i = 1; i < this._tasks.length; i++) {
                const memberAnchors = reduceToAnchors(getBestSchedulingProfile(this._tasks[i], this._floatingLunch, memberDeadline(this._tasks[i], 0)), this._tasks[i].duration);
                anchors = intersectRanges(anchors, memberAnchors);
            }
            return anchors;
        }

        // sequential : chaque membre décalé de son offset cumulé (pas de trou, §5.6)
        let anchors: TimeRange[] | null = null;
        let offset = 0;
        for (const task of this._tasks) {
            const shifted = shiftRanges(reduceToAnchors(getBestSchedulingProfile(task, this._floatingLunch, memberDeadline(task, offset)), task.duration), offset);
            anchors = anchors === null ? shifted : intersectRanges(anchors, shifted);
            offset += task.duration;
        }
        return anchors ?? [];
    }

    /**
     * Profil effectif du groupe : l'échéance des dépendants est calculée d'abord
     * (elle ne dépend pas des combos des membres), puis transmise à
     * `_computeOwnAnchors` pour que chaque membre en tienne compte AVANT de choisir
     * son meilleur combo — voir `TaskUnit._computeEffectiveProfile` pour le même
     * principe et le contre-exemple qui l'a motivé.
     */
    private _computeEffectiveAnchors(): TimeRange[] {
        if (this._dependentUnits.length === 0) return this._computeOwnAnchors();

        const deps: { ls: number; duration: number }[] = [];
        for (const dep of this._dependentUnits) {
            const ls = dep.getEffectiveLatestStart();
            if (ls === null) return []; // dépendant infaisable → le groupe hérite l'infaisabilité
            deps.push({ ls, duration: dep.duration });
        }
        return this._computeOwnAnchors(computeDependentsDeadline(deps));
    }

    /**
     * Score MCV du groupe : mesure à deux niveaux (§5.1) sur le profil effectif du
     * groupe (ci-dessus), encodée en scalaire via `encodePriorityMeasure`.
     */
    getSchedulingPriority(): number {
        return encodePriorityMeasure(countAnchorPositions(this._computeEffectiveAnchors()));
    }

    /**
     * Voir ISchedulingUnit.getEffectiveLatestStart. Le dernier "anchor" du profil
     * effectif EST déjà le dernier début valide (les anchors sont des débuts, déjà
     * réduits par durée) — pas de soustraction supplémentaire, contrairement à
     * TaskUnit.getEffectiveLatestStart (qui part d'un profil brut).
     */
    getEffectiveLatestStart(): number | null {
        const anchors = this._computeEffectiveAnchors();
        return anchors.length === 0 ? null : anchors[anchors.length - 1].end;
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
                resources: this._appliedResources.get(task) ?? [],
                task,
            }));
        }
        // sequential : reconstituer les offsets à partir des durées
        const solutions: UnitSolution[] = [];
        let offset = 0;
        for (const task of tasks) {
            solutions.push({ unit: this, start: result.start + offset, resources: this._appliedResources.get(task) ?? [], task });
            offset += task.duration;
        }
        return solutions;
    }

    getCandidateResourceSlots(): Resource[][] {
        const slots: Resource[][] = [];
        for (const task of this._tasks) {
            for (const alternatives of Object.values(task.resources)) {
                for (const slot of alternatives as Resource[][]) {
                    slots.push(slot);
                }
            }
        }
        return slots;
    }

    getMemberTasks(): Task[] {
        return [...this._tasks];
    }
}
