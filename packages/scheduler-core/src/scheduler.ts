import { Resource, ResourceType } from '@edt-ts/scheduler-common';
import type { SchedulerConfig } from '@edt-ts/scheduler-common';
import { Task } from '@edt-ts/scheduler-common';
import { Loader } from './loader.js';
import type { ISchedulingUnit, SchedulingResult, UnitSolution } from './schedulingUnit.js';
import { TaskUnit } from './taskUnit.js';
import { TaskGroupUnit } from './taskGroupUnit.js';

const SLOT_STEP = 30; // minutes — granularité du backtracking

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
    private _scheduled = new Map<string, SchedulingResult>();                                         // index id→résultat des unités placées dans la branche courante (accès O(1) pour les dépendances)
    private _solution: Array<{ unit: ISchedulingUnit; result: SchedulingResult }> = [];               // pile ordonnée de la branche courante du backtrack
    private _allSolutions: SchedulerSolution[] = [];                                                  // solutions complètes accumulées
    private _bestScore = -Infinity;                                                                   // meilleur score parmi les solutions trouvées
    private _solutionsFound = 0;                                                                      // compteur de solutions complètes trouvées
    private _startTime = 0;                                                                           // horodatage du début de solve() — sert au timeout
    private _iterations = 0;                                                                          // compteur d'appels récursifs à _backtrack()
    private _limitWarning = false;                                                                    // évite de logger le timeout/maxIterations plusieurs fois
    private _initialized = false;                                                                     // verrou : solve() interdit avant initSolver()
    private _firstNonEnforcedIndex = 0;                                                               // index du premier élément non-enforced dans _units
    private _failureCounts = new Map<string, number>();                                               // nb d'échecs par unité — utilisé par solveWithElimination()
    private _floatingLB: { earliestMin: number; latestMin: number; duration: number } | null = null; // config pause flottante pré-calculée (null si inactive)

    protected _config: Required<SchedulerConfig> = {
        maxSolutions: 6,
        timeoutSeconds: 180,
        maxIterations: 1_000_000,
        maxEliminations: 3,
        resourceSelection: 'deterministic',
        lunchBreak: { type: 'none' },
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
            console.log(`🗑️  Élimination round ${round + 1} : unité "${eliminated.id}" (${maxCount} échec(s))`);
            neutralizedList.push({
                unit: eliminated,
                eliminationRound: round + 1,
                failureCount: maxCount,
                reason: `Unité la plus bloquante : ${maxCount} échec(s) au backtracking`,
            });
            this._units.splice(targetIdx, 1);
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
                `Unité '${unit.id}' : dépendance '${dep.id}' non encore planifiée — ` +
                `vérifiez que le graphe de dépendances est acyclique et cohérent avec le tri.`
            );
        }

        // fromTime contraint par la dépendance amont
        let fromTime = 0;
        if (dep) {
            const depResult = this._scheduled.get(dep.id)!;
            fromTime = depResult.start + dep.duration;
        }

        if (this._iterations % 10000 === 0) {
            console.log(`🔄 Itération ${this._iterations}, unité ${unitIndex}/${this._units.length} : ${unit.id}`);
        }

        // Exploration des créneaux via earlySchedule
        while (true) {
            const result = unit.earlySchedule(fromTime);
            if (result === null) {
                // Aucun créneau disponible → incrémente le compteur d'échecs et backtracke
                const cnt = (this._failureCounts.get(unit.id) ?? 0) + 1;
                this._failureCounts.set(unit.id, cnt);
                return false;
            }

            // Filtre pause méridienne flottante (centralisé ici, pas dans les unités)
            if (!this._floatingLBAllows(result, unit.duration)) {
                fromTime = result.start + SLOT_STEP;
                continue;
            }

            // Réserver et descendre dans le backtrack
            this._solution.push({ unit, result });
            this._scheduled.set(unit.id, result);
            unit.book(result);

            const subResult = this._backtrack(unitIndex + 1);

            // Toujours libérer (même en cas de succès — les snapshots sont pris avant)
            unit.unBook(result);
            this._solution.pop();
            this._scheduled.delete(unit.id);

            if (subResult) return true;

            // Avancer au créneau suivant (pas de 30 min)
            fromTime = result.start + SLOT_STEP;
        }
    }

    // ── Heuristiques ─────────────────────────────────────────────────────────

    protected _dynamicSort(startIndex: number): void {
        const remaining = this._units.slice(startIndex);
        remaining.sort((a, b) => b.getSchedulingPriority() - a.getSchedulingPriority());
        for (let i = 0; i < remaining.length; i++) {
            this._units[startIndex + i] = remaining[i];
        }
    }

    protected _computeScore(): number {
        // Score simple : nombre d'unités planifiées.
        // À enrichir avec ScheduleAnalysis une fois le moteur validé.
        return this._solution.length;
    }

    // ── Utilitaires internes ─────────────────────────────────────────────────

    private _resetBacktrackState(): void {
        this._solution = [];
        this._allSolutions = [];
        this._bestScore = -Infinity;
        this._solutionsFound = 0;
        this._iterations = 0;
        this._limitWarning = false;
        this._startTime = Date.now();
        this._failureCounts.clear();
        this._scheduled.clear();

        // Pré-remplir les enforced (déjà bookées dans initSolver, on trace juste leur position)
        for (let i = 0; i < this._firstNonEnforcedIndex; i++) {
            const unit = this._units[i];
            const result = unit.getEnforcedResult();
            this._scheduled.set(unit.id, result);
            this._solution.push({ unit, result });
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
    private _floatingLBAllows(result: SchedulingResult, duration: number): boolean {
        if (this._floatingLB === null) return true;
        const flb = this._floatingLB;
        const slotStart = result.start;
        const slotEnd   = slotStart + duration;
        const MINUTES_PER_DAY = 24 * 60;
        const dayIndex = Math.floor(slotStart / MINUTES_PER_DAY);
        const winStart = dayIndex * MINUTES_PER_DAY + flb.earliestMin;
        const winEnd   = dayIndex * MINUTES_PER_DAY + flb.latestMin;
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
        const intervals = resource.availability.getAvailableIntervals();
        for (const interval of intervals) {
            const clipStart = Math.max(interval.start, winStart);
            const clipEnd   = Math.min(interval.end,   winEnd);
            if (clipStart >= clipEnd) continue;

            // Sous-intervalle gauche (avant le slot)
            const leftEnd = Math.min(clipEnd, slotStart);
            if (leftEnd > clipStart && leftEnd - clipStart >= duration) return true;

            // Sous-intervalle droit (après le slot)
            const rightStart = Math.max(clipStart, slotEnd);
            if (rightStart < clipEnd && clipEnd - rightStart >= duration) return true;
        }
        return false;
    }

    private _limitsReached(): boolean {
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
