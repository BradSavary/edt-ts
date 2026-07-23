import { Resource, ResourceType } from '@edt-ts/scheduler-common';
import type { SchedulerConfig } from '@edt-ts/scheduler-common';
import { Task } from '@edt-ts/scheduler-common';
import { Loader } from './loader.js';
import type { ISchedulingUnit, SchedulingResult, UnitSolution } from './schedulingUnit.js';
import { TaskUnit } from './taskUnit.js';
import { TaskGroupUnit } from './taskGroupUnit.js';

export const SLOT_STEP = 30; // minutes — granularité du backtracking

// ── Types de sortie ──────────────────────────────────────────────────────────

export interface NeutralizedUnitInfo {
    unit: ISchedulingUnit;
    eliminationRound: number;
    failureCount: number;
    reason: string;
}

export interface SchedulerSolution {
    solutions: UnitSolution[];
    isComplete: boolean;
    score?: number;
    neutralizedUnits?: NeutralizedUnitInfo[];
}

// ── Classe principale ────────────────────────────────────────────────────────

/**
 * Nouveau moteur de planification basé sur ISchedulingUnit.
 *
 * Algorithme :
 *  1. initSolver() — charge les données, crée les TaskUnit, pré-book les enforced.
 *  2. solve()      — tri MCV dynamique + backtracking avec earlySchedule/book/unBook.
 *
 * Contrairement à Schedule (ancien moteur), Scheduler ne connaît que ISchedulingUnit.
 * La logique de placement (ressources alternatives, disponibilité) est déléguée
 * à chaque unité via earlySchedule(). Cela permet d'introduire TaskGroup sans
 * modifier le moteur.
 */
export class Scheduler {
    protected _units: ISchedulingUnit[] = [];                                                        // unités à planifier (enforced en tête)
    protected _resources: Resource[] = [];                                                            // toutes les ressources chargées (utilisé pour la pause fixe)
    protected _scheduled = new Map<string, SchedulingResult>();                                       // index id→résultat des unités placées dans la branche courante (accès O(1) pour les dépendances)
    protected _solution: Array<{ unit: ISchedulingUnit; result: SchedulingResult }> = [];             // pile ordonnée de la branche courante du backtrack
    protected _allSolutions: SchedulerSolution[] = [];                                                // solutions complètes accumulées
    protected _bestScore = -Infinity;                                                                 // meilleur score parmi les solutions trouvées
    protected _solutionsFound = 0;                                                                    // compteur de solutions complètes trouvées
    private _startTime = 0;                                                                           // horodatage du début de solve() — sert au timeout
    protected _iterations = 0;                                                                        // compteur d'appels récursifs à _backtrack()
    private _limitWarning = false;                                                                    // évite de logger le timeout/maxIterations plusieurs fois
    private _initialized = false;                                                                     // verrou : solve() interdit avant initSolver()
    protected _firstNonEnforcedIndex = 0;                                                             // index du premier élément non-enforced dans _units
    protected _failureCounts = new Map<string, number>();                                             // nb d'échecs par unité — utilisé par solveWithElimination()
    private _dailyBookedMinutes = new Map<string, Map<number, number>>();                             // durée bookée par jour par ressource — sert au filtre maxDailyMinutes
    private _floatingLB: { earliestMin: number; latestMin: number; duration: number } | null = null; // config pause flottante pré-calculée (null si inactive)
    private _conflictStamps = new Map<string, number>();                                              // id → horodatage du dernier échec (Conflict Ordering Search)
    private _stampCounter = 0;                                                                         // compteur croissant pour _conflictStamps

    protected _config: Required<SchedulerConfig> = {
        maxSolutions: 6,
        timeoutSeconds: 180,
        maxIterations: 1_000_000,
        maxEliminations: 3,
        lunchBreak: { type: 'none' },
        ignoreDailyLimits: false,
        conflictOrderingSearch: false,
        conflictSetExact: false,
        comboBranching: false,
        searchStrategy: 'elimination',
        postRepair: true,
    };

    configure(config: SchedulerConfig): this {
        Object.assign(this._config, config);
        return this;
    }

    setMaxCompleteSolutions(count: number): void { this._config.maxSolutions = count; }
    setTimeoutSeconds(seconds: number): void { this._config.timeoutSeconds = seconds; }

    getTaskFailureCounts(): Map<string, number> {
        return new Map(this._failureCounts);
    }

    // ── Initialisation ───────────────────────────────────────────────────────

    initSolver(): void {
        const allUnits = Loader.tasksManager.getAllUnits();
        const tasks = allUnits as Task[];
        this._resources = Array.from(Loader.resourcesManager.getAllResources());
        this._units = [];

        if (tasks.length === 0) throw new Error('Aucune tâche à planifier. Vérifiez que les données sont chargées.');
        if (this._resources.length === 0) throw new Error('Aucune ressource disponible.');

        // Map Task → ISchedulingUnit (TaskUnit ou TaskGroupUnit)
        const unitMap = new Map<Task, ISchedulingUnit>();

        // 1. Construire les TaskGroupUnit à partir des déclarations de groupes
        const groupDeclarations = Loader.groups;
        if (groupDeclarations.length > 0) {
            const groupAccumulator = new Map<string, { type: 'parallel' | 'sequential'; tasks: Task[] }>();
            for (const decl of groupDeclarations) {
                groupAccumulator.set(decl.id, { type: decl.type, tasks: [] });
            }
            for (const task of tasks) {
                if (task.taskGroupId) {
                    const entry = groupAccumulator.get(task.taskGroupId);
                    if (entry) entry.tasks.push(task);
                }
            }
            for (const [groupId, { type, tasks: groupTasks }] of groupAccumulator) {
                if (groupTasks.length === 0) continue;
                const groupUnit = new TaskGroupUnit(groupId, type, groupTasks);
                for (const t of groupTasks) unitMap.set(t, groupUnit);
                this._units.push(groupUnit);
            }
        }

        // 2. Construire les TaskUnit pour les tâches sans groupe
        for (const task of tasks) {
            if (!unitMap.has(task)) {
                const unit = new TaskUnit(task);
                unitMap.set(task, unit);
                this._units.push(unit);
            }
        }

        // 3. Reporter le graphe de dépendances Task → ISchedulingUnit
        for (const task of tasks) {
            const dep = task.getDependsOn() as Task | null;
            if (dep) {
                const unit = unitMap.get(task)!;
                const depUnit = unitMap.get(dep);
                // Éviter une auto-dépendance si les deux tâches sont dans le même groupe
                if (depUnit && unit !== depUnit) {
                    unit.setDependsOn(depUnit);
                }
            }
        }

        // Enforced en tête de liste
        this._units.sort((a, b) => {
            if (a.isEnforced && !b.isEnforced) return -1;
            if (!a.isEnforced && b.isEnforced) return 1;
            return 0;
        });

        const idx = this._units.findIndex(u => !u.isEnforced);
        this._firstNonEnforcedIndex = idx === -1 ? this._units.length : idx;

        // Pré-booking des enforced
        if (this._firstNonEnforcedIndex > 0) {
            console.log(`⚓ ${this._firstNonEnforcedIndex} tâche(s) enforced — pré-booking en cours...`);
            for (let i = 0; i < this._firstNonEnforcedIndex; i++) {
                this._units[i].bookEnforced();
            }
            console.log('✅ Créneaux enforced réservés.\n');
        }

        this._applyLunchBreak();
        for (const unit of this._units) {
            unit.setFloatingLunchBreak(this._floatingLB);
        }
        this._initialized = true;
        console.log(`✅ Scheduler initialisé : ${this._units.length} unités, ${this._resources.length} ressources\n`);
    }

    // ── Résolution ───────────────────────────────────────────────────────────

    solve(): SchedulerSolution[] {
        if (!this._initialized) throw new Error('Appelez initSolver() avant solve().');

        this._resetBacktrackState();

        console.log(`📋 ${this._units.length} unités à planifier`);
        console.log(`⏰ Timeout: ${this._config.timeoutSeconds}s`);
        console.log(`🎯 Objectif: ${this._config.maxSolutions} solutions complètes\n`);

        const startMs = Date.now();
        this._backtrack(this._firstNonEnforcedIndex);
        const endMs = Date.now();

        console.log(`\n⏱️  Résolution terminée en ${endMs - startMs}ms`);
        console.log(`🔄 Itérations: ${this._iterations}`);
        console.log(`🎯 Solutions complètes: ${this._solutionsFound}`);

        this._allSolutions.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
        return this._allSolutions;
    }

    /**
     * Stratégie d'élimination : élimine progressivement les unités les plus bloquantes
     * jusqu'à trouver au moins une solution complète (max maxEliminations tours).
     */
    solveWithElimination(): SchedulerSolution[] {
        const maxElim = this._config.maxEliminations;
        this.initSolver();
        const neutralizedList: NeutralizedUnitInfo[] = [];
        let results = this.solve();

        for (let round = 0; round < maxElim && results.length === 0; round++) {
            const counts = this.getTaskFailureCounts();
            let maxCount = 0;
            let targetIdx = -1;
            for (let j = this._firstNonEnforcedIndex; j < this._units.length; j++) {
                const cnt = counts.get(this._units[j].id) ?? 0;
                if (cnt > maxCount) { maxCount = cnt; targetIdx = j; }
            }
            if (targetIdx === -1) break;

            const eliminated = this._units[targetIdx];
            const dependents = this._collectDependents(eliminated);
            console.log(`🗑️  Élimination round ${round + 1} : unité "${eliminated.label}" (${maxCount} échec(s))${dependents.length > 0 ? ` + ${dependents.length} dépendant(s) neutralisé(s) en chaîne` : ''}`);
            neutralizedList.push({
                unit: eliminated,
                eliminationRound: round + 1,
                failureCount: maxCount,
                reason: `Unité la plus bloquante : ${maxCount} échec(s) au backtracking`,
            });
            for (const dep of dependents) {
                neutralizedList.push({
                    unit: dep,
                    eliminationRound: round + 1,
                    failureCount: counts.get(dep.id) ?? 0,
                    reason: `Dépend de « ${eliminated.label} », neutralisée ce round — chaîne CM/TD/TP incomplète`,
                });
            }
            const removed = new Set<string>([eliminated.id, ...dependents.map(d => d.id)]);
            this._units = this._units.filter(u => !removed.has(u.id));
            results = this.solve();
        }

        if (neutralizedList.length > 0) {
            if (results.length > 0) {
                results = results.map(r => ({ ...r, neutralizedUnits: [...neutralizedList] }));
            } else {
                // Retourner une solution partielle vide avec les infos de neutralisation
                results = [{ solutions: [], isComplete: false, score: 0, neutralizedUnits: [...neutralizedList] }];
            }
        }

        return results;
    }

    /**
     * Dépendants transitifs (non enforced) d'une unité — pour neutralisation en chaîne lors
     * d'une élimination (solveWithElimination). Éliminer une unité sans neutraliser aussi ses
     * dépendants les orphelinerait : au round suivant, _backtrack lèverait une exception dès
     * qu'il les atteindrait (leur dépendance n'est plus jamais planifiée). Les dépendants
     * enforced sont exclus : ils ne passent jamais par la vérification de dépendance de
     * _backtrack (aucune frame ne les concerne), donc ne causent pas le crash, et leur
     * placement relève de la responsabilité de l'utilisateur.
     */
    protected _collectDependents(root: ISchedulingUnit): ISchedulingUnit[] {
        const out: ISchedulingUnit[] = [];
        const stack = [...root.getDependentUnits()];
        while (stack.length > 0) {
            const u = stack.pop()!;
            if (u.isEnforced || out.includes(u)) continue;
            out.push(u);
            stack.push(...u.getDependentUnits());
        }
        return out;
    }

    // ── Backtracking ─────────────────────────────────────────────────────────

    protected _backtrack(unitIndex: number): boolean {
        this._iterations++;

        if ( this._limitsReached() ) return false;

        // Solution complète trouvée
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

        // Tri MCV dynamique sur les unités restantes
        this._dynamicSort(unitIndex);
        const unit = this._units[unitIndex];

        // Vérification des dépendances
        const dep = unit.getDependsOn();
        if (dep && !this._scheduled.has(dep.id)) {
            throw new Error(
                `Unité '${unit.label}' : dépendance '${dep.label}' non encore planifiée — ` +
                `vérifiez que le graphe de dépendances est acyclique et cohérent avec le tri.`
            );
        }

        // fromTime contraint par la dépendance amont
        let fromTime = 0;
        if (dep) {
            const depResult = this._scheduled.get(dep.id)!;
            fromTime = depResult.start + dep.duration;
        }
/*
        if (this._iterations % 10000 === 0) {
            console.log(`🔄 Itération ${this._iterations}, unité ${unitIndex}/${this._units.length} : ${unit.label}`);
        }
*/
        // Exploration des créneaux via earlySchedule
        while (true) {
            const result = unit.earlySchedule(fromTime);
            if (result === null) {
                // Aucun créneau disponible → attribue le blâme (§5.7) et backtracke
                this._incrementFailureBlame(unit, fromTime);
                this._stampConflict(unit);
                return false;
            }

            // Filtre pause méridienne flottante (centralisé ici, pas dans les unités)
            if (!this._floatingLBAllows(result, unit.duration)) {
                fromTime = result.start + SLOT_STEP;
                continue;
            }

            // Filtre durée quotidienne maximale par ressource
            if (!this._dailyLimitAllows(result, unit.duration)) {
                fromTime = result.start + SLOT_STEP;
                continue;
            }

            // Réserver et descendre dans le backtrack
            this._solution.push({ unit, result });
            this._scheduled.set(unit.id, result);
            unit.book(result);
            this._addDailyUsage(result, unit.duration);

            const subResult = this._backtrack(unitIndex + 1);

            // Toujours libérer (même en cas de succès — les snapshots sont pris avant)
            unit.unBook(result);
            this._subtractDailyUsage(result, unit.duration);
            this._solution.pop();
            this._scheduled.delete(unit.id);

            if (subResult) return true;

            // Avancer au créneau suivant (pas de 30 min)
            fromTime = result.start + SLOT_STEP;
        }
    }

    /**
     * Horodatage COS (Gay et al., CP 2015) d'une vraie impasse — jamais des rejets par
     * filtres (pause/quota), qui n'en sont pas — pour que `_dynamicSort` priorise cette
     * unité au prochain retour arrière. No-op si le flag est inactif.
     */
    protected _stampConflict(unit: ISchedulingUnit): void {
        if (this._config.conflictOrderingSearch) {
            this._conflictStamps.set(unit.id, ++this._stampCounter);
        }
    }

    /**
     * Incrémente le(s) compteur(s) d'échec responsables du blocage de `unit` — attribution
     * du blâme par occupation réelle (§5.7 de docs/HeuristiquePriorite-Conception.md),
     * plutôt que par tour de rôle chronologique. N'affecte que ce que `solveWithElimination`
     * compte, jamais le flux d'exploration de `_backtrack` lui-même.
     */
    private _incrementFailureBlame(unit: ISchedulingUnit, fromTime: number): void {
        const occupants = this._config.conflictSetExact
            ? this._computeExactConflictSet(unit, fromTime)
            : this._computeConflictSet(unit, fromTime);
        this._blameConflictSet(unit, occupants);
    }

    /**
     * Calcule l'ensemble de conflit réel (§4.5/§5.7) : pour chaque slot de ressources
     * candidates de `unit` (ex: le slot "prof", avec ses N alternatives), ne blâme les entrées
     * occupant ce slot que si TOUTES ses alternatives sont occupées à `fromTime` — un slot avec
     * au moins une alternative encore libre n'est, par définition, pas la cause de l'échec
     * (sinon `earlySchedule` aurait trouvé un combo valide via cette alternative).
     */
    protected _computeConflictSet(unit: ISchedulingUnit, fromTime: number): Set<ISchedulingUnit> {
        const occupants = new Set<ISchedulingUnit>();
        const isOccupiedAt = (r: Resource): boolean =>
            this._solution.some(entry =>
                entry.result.start + entry.unit.duration > fromTime &&
                entry.result.resources.includes(r)
            );

        for (const slot of unit.getCandidateResourceSlots()) {
            if (!slot.every(isOccupiedAt)) continue; // au moins une alternative libre : slot non saturé
            for (const r of slot) {
                for (const entry of this._solution) {
                    if (entry.result.start + entry.unit.duration <= fromTime) continue;
                    if (entry.result.resources.includes(r)) occupants.add(entry.unit);
                }
            }
        }

        return occupants;
    }

    /** La tâche est-elle plaçable depuis fromTime dans l'état courant (filtres inclus) ? */
    private _probePlaceable(unit: ISchedulingUnit, fromTime: number): boolean {
        let ft = fromTime;
        while (true) {
            const result = unit.earlySchedule(ft);
            if (result === null) return false;
            if (!this._floatingLBAllows(result, unit.duration)) { ft = result.start + SLOT_STEP; continue; }
            if (!this._dailyLimitAllows(result, unit.duration)) { ft = result.start + SLOT_STEP; continue; }
            return true;
        }
    }

    /** Dé-réserve une entrée déjà placée (miroir de la réservation faite par `_backtrack`). */
    private _releaseEntry(e: { unit: ISchedulingUnit; result: SchedulingResult }): void {
        e.unit.unBook(e.result);
        this._subtractDailyUsage(e.result, e.unit.duration);
    }

    /** Re-réserve une entrée précédemment libérée par `_releaseEntry`. */
    private _restoreEntry(e: { unit: ISchedulingUnit; result: SchedulingResult }): void {
        e.unit.book(e.result);
        this._addDailyUsage(e.result, e.unit.duration);
    }

    /**
     * Ensemble MINIMAL de coupables par contrefactuel (deletion-based MUS, cf. QuickXplain —
     * Junker 2004) : retirer l'ensemble rend `unit` plaçable ; aucun sous-ensemble strict ne
     * suffit. Ensemble vide = impasse structurelle (aucune entrée placée responsable) → le
     * repli self-blame de `_blameConflictSet` s'applique. Mesuré sur données réelles (semaine
     * 40) : `_computeConflictSet` produit 66,8% de faux positifs par rapport à cet ensemble ;
     * ce calcul-ci n'en a aucun, par construction. N'influence jamais l'exploration de
     * `_backtrack` (l'état est restauré à l'identique avant de retourner) — seulement les
     * cibles de `solveWithElimination`.
     */
    protected _computeExactConflictSet(unit: ISchedulingUnit, fromTime: number): Set<ISchedulingUnit> {
        const candRes = new Set(unit.getCandidateResourceSlots().flat());
        const R = this._solution.filter(e => e.result.resources.some(r => candRes.has(r)));
        if (R.length === 0) return new Set();

        for (const e of R) this._releaseEntry(e);
        if (!this._probePlaceable(unit, fromTime)) {
            for (const e of R) this._restoreEntry(e);
            return new Set(); // structurelle : même libres, aucune combinaison ne convient
        }

        const mus: typeof R = [];
        for (const e of R) { // ordre chronologique de _solution (déterministe)
            this._restoreEntry(e);
            if (!this._probePlaceable(unit, fromTime)) { this._releaseEntry(e); mus.push(e); }
        }
        for (const e of mus) this._restoreEntry(e); // état exactement restauré

        return new Set(mus.map(e => e.unit));
    }

    /**
     * Incrémente les compteurs de blâme à partir d'un ensemble de conflit déjà calculé —
     * repli sur `unit` elle-même si l'ensemble est vide (comportement inchangé depuis §5.7).
     */
    protected _blameConflictSet(unit: ISchedulingUnit, occupants: Set<ISchedulingUnit>): void {
        if (occupants.size > 0) {
            for (const occ of occupants) {
                this._failureCounts.set(occ.id, (this._failureCounts.get(occ.id) ?? 0) + 1);
            }
        } else {
            this._failureCounts.set(unit.id, (this._failureCounts.get(unit.id) ?? 0) + 1); // repli, comportement actuel
        }
    }

    // ── Réparation post-résolution (docs/PlanPostRepair.md) ──────────────────
    // Flag `postRepair` (défaut false, appelée par les sites d'appel scheduler-api, pas par
    // le moteur lui-même — ne pollue jamais la passe gourmande du B&B). Révise le combo d'une
    // unité déjà placée UNIQUEMENT là où un échec avéré (une unité neutralisée) le réclame,
    // APRÈS solveWithElimination() — jamais de biais a priori (la famille tie-break est morte,
    // cf. docs/PlanTieBreakContention.md §9), jamais de modification de `_backtrack`.

    /**
     * Tente de re-placer les unités neutralisées d'un résultat, par sondage direct puis
     * swap de combo À START CONSTANT d'unités placées. Pure : retourne un NOUVEAU
     * SchedulerSolution, restaure intégralement l'état moteur avant de rendre la main.
     * Précondition : appelée immédiatement après solveWithElimination(), même instance —
     * `_solution` ne doit contenir que des entrées enforced (vérifié, throw sinon).
     *
     * Limites v1 : un seul swap à la fois (pas de chaînes d'éjection) ; les occupants
     * TaskGroupUnit ne sont jamais swappés (`getComboCount() > 1` les exclut naturellement —
     * `book()` y est couplé à `_pendingAssignment`) ; les occupants enforced ne sont jamais
     * touchés ; hors périmètre `searchStrategy: 'maxPlacement'` (à l'appelant de ne pas
     * invoquer cette méthode dans ce cas — un résultat « prouvé optimal » réparé contredirait
     * la sémantique de la preuve).
     *
     * Refuse (no-op) le résultat DÉGÉNÉRÉ de solveWithElimination (`isComplete: false`,
     * `solutions: []` — aucun round n'a abouti, voir la branche « solution partielle vide ») :
     * ses `neutralizedUnits` ne listent qu'un sous-ensemble STRICT des tâches non placées, et
     * les « réparer » sur un planning vide produirait un pseudo-résultat trompeur (les seules
     * unités éliminées placées, la grande majorité des tâches silencieusement absentes). Les
     * résultats légitimes de la stratégie elimination portent toujours `isComplete: true`
     * (complétude relative à l'ensemble RÉDUIT — cf. la normalisation documentée dans
     * OptionalTasksScheduler.solveWithElimination).
     */
    repairNeutralized(result: SchedulerSolution): SchedulerSolution {
        if (this._solution.some(e => !e.unit.isEnforced)) {
            throw new Error(
                'repairNeutralized() : précondition violée — _solution contient une unité non ' +
                'enforced. À appeler immédiatement après solveWithElimination(), sur la même instance.'
            );
        }
        if (!result.neutralizedUnits || result.neutralizedUnits.length === 0) return result;
        if (!result.isComplete) {
            console.log('🔧 Réparation post-résolution : résultat de base dégénéré (aucun round abouti) — réparation sans objet.');
            return result;
        }

        const undo: Array<() => void> = [];
        const workingSolutions: UnitSolution[] = result.solutions.map(us => ({ ...us }));
        const indexByUnit = new Map<ISchedulingUnit, number[]>();
        for (let i = 0; i < workingSolutions.length; i++) {
            const u = workingSolutions[i].unit;
            const idxs = indexByUnit.get(u);
            if (idxs) idxs.push(i); else indexByUnit.set(u, [i]);
        }

        try {
            this._rematerialize(result.solutions, undo);

            let remaining = [...result.neutralizedUnits];
            let progress = true;
            while (progress) {
                progress = false;
                const stillRemaining: NeutralizedUnitInfo[] = [];
                for (const info of remaining) {
                    const placed = this._tryRepairOne(info.unit, workingSolutions, indexByUnit, undo);
                    if (placed) progress = true;
                    else stillRemaining.push(info);
                }
                remaining = stillRemaining;
            }

            const placedCount = result.neutralizedUnits.length - remaining.length;
            console.log(`🔧 Réparation post-résolution : ${placedCount} re-placée(s), ${remaining.length} restante(s)`);

            return {
                solutions: workingSolutions,
                isComplete: result.isComplete,
                score: workingSolutions.length,
                neutralizedUnits: remaining,
            };
        } finally {
            // Restauration miroir intégrale (§2.1) : succès ou échec, l'instance revient à
            // l'état exact d'avant l'appel — LIFO strict, symétrique de chaque mutation ci-dessus.
            for (let i = undo.length - 1; i >= 0; i--) undo[i]();
        }
    }

    /**
     * Re-matérialise les entrées non enforced du snapshot `solutions` sur l'état moteur
     * (disponibilités, usage quotidien, `_solution`/`_scheduled` au format moteur — §2.1).
     * Manipulation DIRECTE des ressources, jamais via `unit.book()` : pour un TaskGroupUnit,
     * `book()` exige un `_pendingAssignment` fraîchement écrit par `earlySchedule()`, que ce
     * snapshot n'a pas (il vient d'un round de résolution déjà terminé et intégralement
     * dénoué). Empile dans `undo` l'inverse de chaque mutation, dans l'ordre effectué.
     */
    private _rematerialize(solutions: UnitSolution[], undo: Array<() => void>): void {
        const byUnit = new Map<ISchedulingUnit, UnitSolution[]>();
        for (const us of solutions) {
            if (us.unit.isEnforced) continue;
            const arr = byUnit.get(us.unit);
            if (arr) arr.push(us); else byUnit.set(us.unit, [us]);
        }

        for (const [unit, sols] of byUnit) {
            for (const us of sols) {
                const dur = us.task?.duration ?? us.unit.duration;
                const r: SchedulingResult = { start: us.start, resources: us.resources };
                this._rawBook(r, dur);
                undo.push(() => this._rawRelease(r, dur));
            }
            const start = Math.min(...sols.map(s => s.start));
            const resources = sols.flatMap(s => s.resources);
            const engineResult: SchedulingResult = { start, resources };
            this._pushSolutionEntry(unit, engineResult);
            undo.push(() => this._removeSolutionEntry(unit));
        }
    }

    /**
     * Tente de replacer une unité neutralisée `U` : sondage direct (§2.2) puis, en dernier
     * recours, swap de combo d'un occupant (§2.3, `_trySwapRepair`). Sur succès, place `U`
     * via le flux normal earlySchedule→book (§2.4 — nécessaire pour les groupes, dont
     * `toSolutions()` lit `_appliedResources` écrit par `book()`) et met à jour
     * `workingSolutions`/`indexByUnit`. Retourne `false` sans effet si `U` ne peut pas encore
     * être tentée (dépendance non planifiée) ou si aucun placement n'a été trouvé.
     */
    private _tryRepairOne(
        U: ISchedulingUnit,
        workingSolutions: UnitSolution[],
        indexByUnit: Map<ISchedulingUnit, number[]>,
        undo: Array<() => void>,
    ): boolean {
        const dep = U.getDependsOn();
        if (dep && !this._scheduled.has(dep.id)) return false;
        const fromTime = dep ? this._scheduled.get(dep.id)!.start + dep.duration : 0;

        let r = this._probePlacement(U, fromTime);
        let swappedOccupant: ISchedulingUnit | null = null;
        let newOccupantResources: Resource[] | null = null;

        if (r === null) {
            const swap = this._trySwapRepair(U, fromTime, undo);
            if (swap) {
                r = swap.result;
                swappedOccupant = swap.occupant;
                newOccupantResources = swap.newResources;
            }
        }
        if (r === null) return false;
        const placedResult = r;

        U.book(placedResult);
        this._addDailyUsage(placedResult, U.duration);
        this._pushSolutionEntry(U, placedResult);
        undo.push(() => {
            U.unBook(placedResult);
            this._subtractDailyUsage(placedResult, U.duration);
            this._removeSolutionEntry(U);
        });

        if (swappedOccupant && newOccupantResources) {
            const idxs = indexByUnit.get(swappedOccupant) ?? [];
            for (const idx of idxs) workingSolutions[idx] = { ...workingSolutions[idx], resources: newOccupantResources };
            console.log(`🔧 Réparation : « ${U.label} » placée via swap de « ${swappedOccupant.label} » vers [${newOccupantResources.map(res => res.id).join(', ')}]`);
        } else {
            console.log(`🔧 Réparation : « ${U.label} » placée directement`);
        }

        const newSols = U.toSolutions(placedResult);
        const startIdx = workingSolutions.length;
        workingSolutions.push(...newSols);
        indexByUnit.set(U, newSols.map((_, k) => startIdx + k));

        return true;
    }

    /** Miroir de `_probePlaceable` (ci-dessus) qui retourne le résultat plutôt qu'un booléen. */
    private _probePlacement(unit: ISchedulingUnit, fromTime: number): SchedulingResult | null {
        let ft = fromTime;
        while (true) {
            const result = unit.earlySchedule(ft);
            if (result === null) return null;
            if (!this._floatingLBAllows(result, unit.duration)) { ft = result.start + SLOT_STEP; continue; }
            if (!this._dailyLimitAllows(result, unit.duration)) { ft = result.start + SLOT_STEP; continue; }
            return result;
        }
    }

    /**
     * Swap de combo à START CONSTANT (§2.3) : cherche, parmi les occupants non enforced
     * multi-combos dont une ressource intersecte les slots candidats de `U`, un combo
     * alternatif qui débloque `U` sans jamais déplacer l'occupant dans le temps (ses
     * dépendants et le reste du planning n'en sont pas affectés). Un seul swap à la fois —
     * jamais deux occupants simultanément (limite v1). Restaure intégralement chaque occupant
     * essayé sans succès avant de passer au suivant ; empile l'undo du swap gagnant dans
     * `undo` (miroir exact : release cand, restore combo d'origine).
     */
    private _trySwapRepair(
        U: ISchedulingUnit,
        fromTime: number,
        undo: Array<() => void>,
    ): { result: SchedulingResult; occupant: ISchedulingUnit; newResources: Resource[] } | null {
        const candRes = new Set(U.getCandidateResourceSlots().flat());
        const occupantEntries = this._solution.filter(e =>
            !e.unit.isEnforced &&
            e.unit.getComboCount() > 1 &&
            e.result.resources.some(r => candRes.has(r)),
        );

        for (const entry of occupantEntries) {
            const occupant = entry.unit;
            const origResult = entry.result;
            const dur = occupant.duration;

            this._rawRelease(origResult, dur);
            this._removeSolutionEntry(occupant);

            let committed = false;
            const comboCount = occupant.getComboCount();
            for (let c = 0; c < comboCount && !committed; c++) {
                const cand = occupant.earlyScheduleForCombo(c, origResult.start);
                if (cand === null) continue;
                if (cand.start !== origResult.start) continue; // start constant strict
                if (this._sameResourceSet(cand.resources, origResult.resources)) continue; // même combo, sans effet
                if (!this._dailyLimitAllows(cand, dur)) continue; // usage de l'ancien combo déjà soustrait — l'ordre compte
                if (!this._floatingLBAllows(cand, dur)) continue;

                this._rawBook(cand, dur);
                this._pushSolutionEntry(occupant, cand);

                const r = this._probePlacement(U, fromTime);
                if (r !== null) {
                    committed = true;
                    undo.push(() => {
                        this._rawRelease(cand, dur);
                        this._removeSolutionEntry(occupant);
                        this._rawBook(origResult, dur);
                        this._pushSolutionEntry(occupant, origResult);
                    });
                    return { result: r, occupant, newResources: cand.resources };
                }

                this._rawRelease(cand, dur);
                this._removeSolutionEntry(occupant);
            }

            // Aucun combo ne débloque U → restaurer l'occupant à l'identique, essayer le suivant.
            this._rawBook(origResult, dur);
            this._pushSolutionEntry(occupant, origResult);
        }

        return null;
    }

    /** Compare deux tableaux de ressources par CONTENU (pas par objets tableau) — §2.3 étape 2. */
    private _sameResourceSet(a: Resource[], b: Resource[]): boolean {
        if (a.length !== b.length) return false;
        const setB = new Set(b);
        return a.every(r => setB.has(r));
    }

    /** Réserve directement (disponibilités + usage quotidien), sans passer par `unit.book()`. */
    private _rawBook(result: SchedulingResult, duration: number): void {
        for (const r of result.resources) r.availability.removeAvailability(result.start, result.start + duration);
        this._addDailyUsage(result, duration);
    }

    /** Miroir exact de `_rawBook`. */
    private _rawRelease(result: SchedulingResult, duration: number): void {
        for (const r of result.resources) r.availability.addAvailability(result.start, result.start + duration);
        this._subtractDailyUsage(result, duration);
    }

    /** Insère l'entrée courante de `unit` au format moteur dans `_solution`/`_scheduled`. */
    private _pushSolutionEntry(unit: ISchedulingUnit, result: SchedulingResult): void {
        this._solution.push({ unit, result });
        this._scheduled.set(unit.id, result);
    }

    /** Retire l'entrée courante de `unit` de `_solution`/`_scheduled` (miroir de `_pushSolutionEntry`). */
    private _removeSolutionEntry(unit: ISchedulingUnit): void {
        const idx = this._solution.findIndex(e => e.unit === unit);
        if (idx !== -1) this._solution.splice(idx, 1);
        this._scheduled.delete(unit.id);
    }

    // ── Heuristiques ─────────────────────────────────────────────────────────

    /**
     * Trie les unités restantes par score MCV décroissant, puis fait remonter en tête
     * les unités "prêtes" (sans dépendance, ou dépendance déjà planifiée) : le score
     * mesure uniquement la contrainte réelle d'une unité, il ne garantit pas — et n'a
     * pas à garantir — qu'un dépendant score toujours moins qu'une dépendance non
     * encore planifiée. Sans cette partition, une unité très contrainte dont la
     * dépendance ne l'est pas pourrait se retrouver choisie avant elle par `_backtrack`.
     */
    protected _dynamicSort(startIndex: number): void {
        const remaining = this._units.slice(startIndex);
        remaining.sort((a, b) => b.getSchedulingPriority() - a.getSchedulingPriority());

        const ready: ISchedulingUnit[] = [];
        const notReady: ISchedulingUnit[] = [];
        for (const unit of remaining) {
            const dep = unit.getDependsOn();
            if (dep === null || this._scheduled.has(dep.id)) {
                ready.push(unit);
            } else {
                notReady.push(unit);
            }
        }

        // Conflict Ordering Search (§7-R2 de docs/AuditBackjumping.md) : les unités récemment
        // en échec passent devant le score MCV, uniquement parmi les "ready" (l'invariant de
        // dépendance reste intact). Tri stable : les unités sans horodatage gardent leur ordre
        // MCV entre elles — sans impasse, _conflictStamps est vide et ce bloc est inerte.
        if (this._config.conflictOrderingSearch && this._conflictStamps.size > 0) {
            ready.sort((a, b) => (this._conflictStamps.get(b.id) ?? 0) - (this._conflictStamps.get(a.id) ?? 0));
        }

        const sorted = ready.concat(notReady);
        for (let i = 0; i < sorted.length; i++) {
            this._units[startIndex + i] = sorted[i];
        }
    }

    protected _computeScore(): number {
        // Score simple : nombre d'unités planifiées.
        return this._solution.length;
    }

    // ── Utilitaires internes ─────────────────────────────────────────────────

    protected _resetBacktrackState(): void {
        this._solution = [];
        this._allSolutions = [];
        this._bestScore = -Infinity;
        this._solutionsFound = 0;
        this._iterations = 0;
        this._limitWarning = false;
        this._startTime = Date.now();
        this._failureCounts.clear();
        this._scheduled.clear();
        this._dailyBookedMinutes.clear();
        this._conflictStamps.clear(); // apprentissage COS remis à zéro à chaque solve() (donc chaque round d'élimination)
        this._stampCounter = 0;

        // Pré-remplir les enforced (déjà bookées dans initSolver, on trace juste leur position)
        for (let i = 0; i < this._firstNonEnforcedIndex; i++) {
            const unit = this._units[i];
            const result = unit.getEnforcedResult();
            this._scheduled.set(unit.id, result);
            this._solution.push({ unit, result });
            this._addDailyUsage(result, unit.duration);
        }
    }

    private _applyLunchBreak(): void {
        const lb = this._config.lunchBreak;
        this._floatingLB = null;

        if (lb.type === 'fixed') {
            const fromMin = this._parseTime(lb.from);
            const toMin = this._parseTime(lb.to);
            const DAY = 24 * 60;
            for (const resource of this._resources) {
                if (resource.type !== ResourceType.GROUP) continue;
                for (let day = 0; day < 5; day++) {
                    resource.availability.removeAvailability(day * DAY + fromMin, day * DAY + toMin);
                }
            }
            console.log(`🍽️  Pause méridienne fixe appliquée : ${lb.from} – ${lb.to}`);
        } else if (lb.type === 'floating') {
            this._floatingLB = {
                earliestMin: this._parseTime(lb.earliest),
                latestMin:   this._parseTime(lb.latest),
                duration:    lb.duration,
            };
            console.log(`🍽️  Pause méridienne flottante configurée : ${lb.earliest}–${lb.latest} (${lb.duration} min)`);
        }
    }

    /**
     * Retourne false si le slot contenu dans `result` viole la contrainte de pause
     * méridienne flottante pour au moins une ressource GROUP.
     * Retourne toujours true quand aucune contrainte flottante n'est configurée.
     */
    protected _floatingLBAllows(result: SchedulingResult, duration: number): boolean {
        if (this._floatingLB === null) return true;
        const flb = this._floatingLB;
        const slotStart = result.start;
        const slotEnd   = slotStart + duration;
        const MINUTES_PER_DAY = 24 * 60;
        const dayIndex = Math.floor(slotStart / MINUTES_PER_DAY);
        const winStart = dayIndex * MINUTES_PER_DAY + flb.earliestMin;
        const winEnd   = dayIndex * MINUTES_PER_DAY + flb.latestMin;
        // Le slot ne touche pas la fenêtre de pause → ne peut rien consommer de la pause.
        if (Math.max(slotStart, winStart) >= Math.min(slotEnd, winEnd)) return true;
        return result.resources
            .filter(r => r.type === ResourceType.GROUP)
            .every(r => this._resourceKeepsFloatingBreak(r, slotStart, slotEnd, winStart, winEnd, flb.duration));
    }

    /**
     * Vérifie qu'après booking hypothétique [slotStart, slotEnd], la ressource
     * conserve un bloc libre d'au moins `duration` minutes dans [winStart, winEnd].
     * Opération en lecture seule — ne modifie pas l'état de la ressource.
     */
    private _resourceKeepsFloatingBreak(
        resource: Resource,
        slotStart: number,
        slotEnd: number,
        winStart: number,
        winEnd: number,
        duration: number,
    ): boolean {
        // Garde-fou résiduel SAIN (fondé sur la fenêtre, pas sur la dispo) : si la fenêtre
        // est structurellement trop courte pour contenir la pause, la contrainte est
        // inapplicable — ne bloque pas tout le jour sur une config incohérente.
        if (winEnd - winStart < duration) return true;

        // Cours occupant ce groupe et chevauchant la fenêtre, clippés à [winStart,winEnd].
        // Le slot hypothétique n'est pas encore dans _solution (book() vient après le check)
        // → l'ajouter explicitement. Les tâches enforced sont déjà dans _solution.
        const busy: Array<[number, number]> = [];
        const pushClip = (start: number, end: number): void => {
            const cs = Math.max(start, winStart);
            const ce = Math.min(end, winEnd);
            if (cs < ce) busy.push([cs, ce]);
        };
        pushClip(slotStart, slotEnd);
        for (const { unit, result } of this._solution) {
            if (!result.resources.some(r => r.id === resource.id)) continue;
            pushClip(result.start, result.start + unit.duration);
            // (les cours d'un autre jour se clippent à vide → ignorés naturellement)
        }

        // Plus grand trou libre dans [winStart,winEnd] \ busy ≥ duration ?
        busy.sort((a, b) => a[0] - b[0]);
        let cursor = winStart;
        for (const [s, e] of busy) {
            if (s - cursor >= duration) return true; // trou libre avant ce cours
            if (e > cursor) cursor = e;              // fusion des chevauchements
        }
        return winEnd - cursor >= duration;          // trou libre après le dernier cours
    }

    protected _dailyLimitAllows(result: SchedulingResult, duration: number): boolean {
        if (this._config.ignoreDailyLimits) return true;
        const MINUTES_PER_DAY = 24 * 60;
        const dayIndex = Math.floor(result.start / MINUTES_PER_DAY);
        for (const r of result.resources) {
            if (r.maxDailyMinutes === undefined) continue;
            const byDay = this._dailyBookedMinutes.get(r.id);
            const alreadyBooked = byDay?.get(dayIndex) ?? 0;
            if (alreadyBooked + duration > r.maxDailyMinutes) return false;
        }
        return true;
    }

    protected _addDailyUsage(result: SchedulingResult, duration: number): void {
        const MINUTES_PER_DAY = 24 * 60;
        const dayIndex = Math.floor(result.start / MINUTES_PER_DAY);
        for (const r of result.resources) {
            if (r.maxDailyMinutes === undefined) continue;
            let byDay = this._dailyBookedMinutes.get(r.id);
            if (!byDay) { byDay = new Map(); this._dailyBookedMinutes.set(r.id, byDay); }
            byDay.set(dayIndex, (byDay.get(dayIndex) ?? 0) + duration);
        }
    }

    protected _subtractDailyUsage(result: SchedulingResult, duration: number): void {
        const MINUTES_PER_DAY = 24 * 60;
        const dayIndex = Math.floor(result.start / MINUTES_PER_DAY);
        for (const r of result.resources) {
            if (r.maxDailyMinutes === undefined) continue;
            const byDay = this._dailyBookedMinutes.get(r.id);
            if (!byDay) continue;
            byDay.set(dayIndex, Math.max(0, (byDay.get(dayIndex) ?? 0) - duration));
        }
    }

    protected _limitsReached(): boolean {
        const elapsed = Date.now() - this._startTime;
        if (elapsed > this._config.timeoutSeconds * 1000) {
            if (!this._limitWarning) {
                console.log(`⏰ Timeout atteint (${(elapsed / 1000).toFixed(1)}s)`);
                this._limitWarning = true;
            }
            return true;
        }
        if (this._iterations > this._config.maxIterations) {
            if (!this._limitWarning) {
                console.log('⚠️  Limite d\'itérations atteinte');
                this._limitWarning = true;
            }
            return true;
        }
        return false;
    }

    private _parseTime(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }
}
