import { Loader } from './loader.js';
import { Task, Resource, ResourceType } from '@edt-ts/scheduler-common';
import type { SchedulerConfig } from '@edt-ts/scheduler-common';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ScheduleAnalysis } from './scheduleAnalysis.js';

/**
 * Représente une solution de planification pour une tâche
 */
export interface TaskSolution {
    task: Task;
    startTime: number; // Créneau de début (0-119 pour 5 jours * 24 créneaux)
    appliedResources: Resource[];
}

/**
 * Représente l'état d'une planification complète
 */
export interface ScheduleSolution {
    solutions: TaskSolution[];
    isComplete: boolean;
    conflictCount: number;
    score?: number;
    neutralizedTasks?: Task[];
}

/**
 * Classe principale pour résoudre les problèmes de planification
 * Utilise un algorithme de programmation par contraintes avec backtracking
 */
export class Schedule {

    protected tasks: Task[] = [];
    protected resources: Resource[] = [];
    protected solution: TaskSolution[] = [];
    protected bestSolution: TaskSolution[] = [];
    protected bestScore: number = -Infinity;
    protected currentIterations: number = 0;
    protected limitWarningShown: boolean = false;
    protected firstNonEnforcedIndex: number = 0;
    protected _initialized: boolean = false;

    protected _config: Required<SchedulerConfig> = {
        maxSolutions: 6,
        timeoutSeconds: 180,
        maxIterations: 1_000_000,
        maxEliminations: 3,
        resourceSelection: 'deterministic',
        lunchBreak: { type: 'none' },
    };

    private _solutionsFound: number = 0;
    private _solveStartTime: number = 0;
    private _taskFailureCount = new Map<string, number>();
    private _lastAttemptHadSlots = false;
    private _allSolutions: ScheduleSolution[] = [];

    constructor() {
        // Les données seront chargées via Loader lors de la résolution
    }

    /**
     * Applique un objet de configuration au solver (chainable).
     * Les options non fournies conservent leur valeur par défaut.
     */
    configure(config: SchedulerConfig): this {
        Object.assign(this._config, config);
        return this;
    }

    /**
     * Résolution multi-solutions avec exploration des ressources alternatives.
     * Retourne jusqu'à _config.maxSolutions solutions complètes triées par score décroissant.
     */
    solve(): ScheduleSolution[] {
        if (!this._initialized) {
            throw new Error('Appelez initSolver() avant solve().');
        }
        console.log('🔄 Début de la résolution (multi-solutions, ressources alternatives)...');

        this.solution = [];
        this.bestSolution = [];
        this.bestScore = -Infinity;
        this.currentIterations = 0;
        this.limitWarningShown = false;
        this._solutionsFound = 0;
        this._solveStartTime = Date.now();
        this._taskFailureCount.clear();
        this._allSolutions = [];

        this.tasks.sort((a, b) => {
            if (a.isEnforced && !b.isEnforced) return -1;
            if (!a.isEnforced && b.isEnforced) return 1;
            return this.getCurrentConstraintScore(b) - this.getCurrentConstraintScore(a);
        });

        for (let i = 0; i < this.firstNonEnforcedIndex; i++) {
            const task = this.tasks[i];
            this.solution.push({
                task,
                startTime: task.enforced!.startTime,
                appliedResources: [...task.appliedResources],
            });
        }

        console.log(`📋 ${this.tasks.length} tâches à planifier`);
        console.log(`🏢 ${this.resources.length} ressources disponibles`);
        console.log(`⏱️ Limite: ${this._config.maxIterations} itérations`);
        console.log(`🎯 Objectif: ${this._config.maxSolutions} solutions complètes`);
        console.log(`⏰ Timeout: ${this._config.timeoutSeconds}s`);
        console.log(`🔄 Mode multi-solutions: exploration de toutes les combinaisons\n`);

        const startMs = Date.now();
        this.backtrack(this.firstNonEnforcedIndex);
        const endMs = Date.now();

        console.log(`\n⏱️ Résolution terminée en ${endMs - startMs}ms`);
        console.log(`🔄 Itérations effectuées: ${this.currentIterations}`);
        console.log(`🎯 Solutions complètes trouvées: ${this._solutionsFound}`);

        if (this._allSolutions.length > 0) {
            console.log(`✅ ${this._allSolutions.length} solution(s) complète(s) trouvée(s), meilleur score: ${this.bestScore}`);
        } else {
            console.log(`❌ Aucune solution complète trouvée`);
        }

        this._allSolutions.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

        if (this._allSolutions.length > 0) {
            const best = this._allSolutions[0];
            this._restoreTaskResourcesFromSolution(best.solutions);
            const verification = this.verifySolution(best.solutions);
            if (!verification.isValid) {
                console.warn(`⚠️ ATTENTION: La solution contient ${verification.conflicts.length} conflit(s)`);
                verification.conflicts.forEach(conflict => console.warn(`   ${conflict}`));
            }
        }

        return this._allSolutions;
    }

    /** Retourne une copie du compteur d'échecs par tâche (taskId → count) */
    getTaskFailureCounts(): Map<string, number> {
        return new Map(this._taskFailureCount);
    }

    /** Configure le nombre de solutions complètes à trouver avant d'arrêter (défaut: 6) */
    setMaxCompleteSolutions(count: number): void {
        this._config.maxSolutions = count;
    }

    /** Configure le timeout en secondes (défaut: 180) */
    setTimeoutSeconds(seconds: number): void {
        this._config.timeoutSeconds = seconds;
    }


    /**
     * Stratégie d'élimination : élimine progressivement les tâches les plus bloquantes
     * (jusqu'à N fois) jusqu'à trouver au moins une solution complète.
     * Nombre maximum de tâches à éliminer configurable via configure({ maxEliminations: N }).
     */
    solveWithTaskElimination(): ScheduleSolution[] {
        const count = this._config.maxEliminations;
        this.initSolver();
        const neutralized: Task[] = [];
        let lastResults = this.solve();

        for (let i = 0; i < count && lastResults.length === 0; i++) {
            const failureCounts = this.getTaskFailureCounts();
            let maxFailures = 0;
            let targetIndex = -1;
            for (let j = this.firstNonEnforcedIndex; j < this.tasks.length; j++) {
                const cnt = failureCounts.get(this.tasks[j].id) ?? 0;
                if (cnt > maxFailures) {
                    maxFailures = cnt;
                    targetIndex = j;
                }
            }

            if (targetIndex === -1) {
                console.log(`⚠️ Aucune tâche bloquante identifiable — arrêt de l'élimination.`);
                break;
            }

            const eliminated = this.tasks[targetIndex];
            neutralized.push(eliminated);
            console.log(`🗑️ Élimination #${i + 1}: "${eliminated.name}" (${maxFailures} échec(s) sans créneau)`);
            this.tasks.splice(targetIndex, 1);
            lastResults = this.solve();
        }

        if (neutralized.length > 0) {
            const penalty = neutralized.length * 1000;
            for (const result of lastResults) {
                result.neutralizedTasks = [...neutralized];
                if (result.score !== undefined) {
                    result.score = Math.round(result.score - penalty);
                }
            }
        }

        return lastResults;
    }

    /**
     * Applique la pause méridienne fixe en retirant la plage horaire des disponibilités
     * des ressources de type GROUP, sur chacun des 5 jours.
     * Sans effet si lunchBreak.type !== 'fixed'.
     */
    private _applyLunchBreakConstraint(): void {
        const lb = this._config.lunchBreak;
        if (lb.type !== 'fixed') return;

        const fromMinutes = this._parseTimeToMinutes(lb.from);
        const toMinutes = this._parseTimeToMinutes(lb.to);
        const MINUTES_PER_DAY = 24 * 60;

        for (const resource of this.resources) {
            if (resource.type !== ResourceType.GROUP) continue;
            for (let day = 0; day < 5; day++) {
                const start = day * MINUTES_PER_DAY + fromMinutes;
                const end   = day * MINUTES_PER_DAY + toMinutes;
                resource.availability.removeAvailability(start, end);
            }
        }

        for (const task of this.tasks) {
            task.invalidateSchedulable();
        }

        console.log(`🍽️ Pause méridienne fixe appliquée : ${lb.from} – ${lb.to} (groupes, 5 jours)`);
    }

    /** Convertit une chaîne "HH:MM" en nombre de minutes depuis minuit. */
    private _parseTimeToMinutes(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }

    private _restoreTaskResourcesFromSolution(solution: TaskSolution[]): void {
        for (const sol of solution) {
            sol.task.appliedResources = sol.appliedResources;
        }
    }

    /**
     * Initialise le solveur : chargement des données, sélection des ressources,
     * tri initial et booking des tâches enforced.
     * Doit être appelé avant solve().
     */
    initSolver(): void {
        this.tasks = Loader.tasksManager.getAllTasks();
        this.resources = Array.from(Loader.resourcesManager.getAllResources());

        if (this.tasks.length === 0) {
            throw new Error('Aucune tâche à planifier. Vérifiez que les données sont chargées.');
        }
        if (this.resources.length === 0) {
            throw new Error('Aucune ressource disponible. Vérifiez que les ressources sont chargées.');
        }

        // Initialisation des ressources : première combinaison disponible pour chaque tâche.
        // L'ordre d'exploration effectif est contrôlé par _config.resourceSelection
        // dans _tryAllResourceCombinations pendant le backtracking.
        let tasksWithoutResources = 0;
        for (const task of this.tasks) {
            if (task.isEnforced) continue;
            const allCombinations = task.getApplicableResources();
            if (allCombinations.length === 0) {
                console.warn(`⚠️  Aucune combinaison de ressources disponible pour ${task.name}`);
                tasksWithoutResources++;
            } else {
                task.appliedResources = allCombinations[0];
            }
        }
        if (tasksWithoutResources > 0) {
            console.warn(`⚠️  ${tasksWithoutResources} tâche(s) sans ressources disponibles`);
        }
        console.log('✅ Ressources initialisées\n');

        // Trier : enforced en tête uniquement.
        // L'ordre des tâches non-enforced est géré dynamiquement par dynamicTaskSort()
        // à chaque niveau du backtracking (heuristique MCV sur état courant).
        this.tasks.sort((a, b) => {
            if (a.isEnforced && !b.isEnforced) return -1;
            if (!a.isEnforced && b.isEnforced) return 1;
            return 0;
        });

        // Calculer l'index de la première tâche non-enforced
        const idx = this.tasks.findIndex(t => !t.isEnforced);
        this.firstNonEnforcedIndex = idx === -1 ? this.tasks.length : idx;

        // Pré-booking des tâches enforced
        if (this.firstNonEnforcedIndex > 0) {
            console.log(`⚓ ${this.firstNonEnforcedIndex} tâche(s) enforced — placement imposé en cours...`);
            const resourcesManager = Loader.resourcesManager;
            for (let i = 0; i < this.firstNonEnforcedIndex; i++) {
                const task = this.tasks[i];
                const enforced = task.enforced!;
                const enforcedResources = [
                    ...enforced.teacher,
                    ...enforced.groups,
                    ...enforced.rooms,
                ].map(id => resourcesManager.getResource(id))
                 .filter((r): r is NonNullable<ReturnType<typeof resourcesManager.getResource>> => r !== undefined);

                task.appliedResources = enforcedResources;

                for (const resource of enforcedResources) {
                    if (!resource.availability.isAvailable(enforced.startTime, enforced.startTime + task.duration)) {
                        console.warn(`⚠️ Tâche enforced "${task.name}" (${task.code}): ressource "${resource.id}" non disponible au créneau imposé.`);
                    }
                }

                this.applyConstraints({ task, startTime: enforced.startTime, appliedResources: enforcedResources });
            }
            console.log('✅ Créneaux enforced réservés.\n');
        }

        this._applyLunchBreakConstraint();

        // Vérification préalable : chaque tâche non-enforced doit avoir au moins 1 créneau schedulable
        for (const task of this.tasks) {
            if (task.isEnforced) continue;
            if (!task.hasSchedulableSlot()) {
                console.warn(`⚠️ Aucun créneau suffisant pour la tâche "${task.name}" (${task.code}, durée: ${task.duration} min) avec les ressources initiales.`);
            }
        }

        this._initialized = true;
    }

    /**
     * Algorithme de backtracking avec exploration de toutes les combinaisons de ressources.
     */
    protected backtrack(taskIndex: number): boolean {
        this.currentIterations++;

        const elapsedTime = Date.now() - this._solveStartTime;
        if (elapsedTime > this._config.timeoutSeconds * 1000) {
            if (!this.limitWarningShown) {
                console.log(`⏰ Timeout atteint (${(elapsedTime / 1000).toFixed(1)}s)`);
                this.limitWarningShown = true;
            }
            return false;
        }

        if (this.currentIterations > this._config.maxIterations) {
            if (!this.limitWarningShown) {
                console.log('⚠️ Limite d\'itérations atteinte');
                this.limitWarningShown = true;
            }
            return false;
        }

        if (taskIndex >= this.tasks.length) {
            this._solutionsFound++;
            const score = Math.round(this.evaluateSolution(this.solution));

            const solutionSnapshot: TaskSolution[] = this.solution.map(sol => ({
                task: sol.task,
                startTime: sol.startTime,
                appliedResources: [...sol.appliedResources],
            }));

            this._allSolutions.push({ solutions: solutionSnapshot, isComplete: true, conflictCount: 0, score });

            if (score > this.bestScore) {
                this.bestScore = score;
                this.bestSolution = solutionSnapshot;
            }
            console.log(`✅ Solution COMPLÈTE ${this._solutionsFound}/${this._config.maxSolutions} (score: ${score}, meilleur: ${this.bestScore})`);

            if (this._solutionsFound >= this._config.maxSolutions) {
                console.log(`🎯 Objectif atteint: ${this._solutionsFound} solutions complètes trouvées`);
                return true;
            }
            return false;
        }

        this.dynamicTaskSort(taskIndex);

        const task = this.tasks[taskIndex];

        if (!this.canTaskBeScheduledNow(task)) {
            throw new Error(`Erreur: La tâche '${task.name}' ne peut pas être planifiée (dépendances non satisfaites)`);
        }

        if (this.currentIterations % 10000 === 0) {
            console.log(`🔄 Itération ${this.currentIterations}, tâche ${taskIndex}/${this.tasks.length}: ${task.name}`);
        }

        return this._tryAllResourceCombinations(task, taskIndex);
    }

    private _tryAllResourceCombinations(task: Task, taskIndex: number): boolean {
        const raw = task.getApplicableResources();

        if (raw.length === 0) {
            console.warn(`⚠️ Aucune combinaison de ressources pour ${task.name}`);
            return false;
        }

        // resourceSelection contrôle l'ordre d'exploration des combinaisons :
        // - 'deterministic' : ordre stable (tel que retourné par getApplicableResources)
        // - 'random'        : ordre aléatoire à chaque nœud du backtracking
        const allCombinations = this._config.resourceSelection === 'random'
            ? [...raw].sort(() => Math.random() - 0.5)
            : raw;

        const previousResources = task.appliedResources;
        let someHadSlots = false;
        for (const resourceCombination of allCombinations) {
            task.appliedResources = resourceCombination;
            task.invalidateSchedulable();
            if (this._tryTaskWithCurrentResources(task, taskIndex)) {
                return true;
            }
            someHadSlots ||= this._lastAttemptHadSlots;
        }

        // Restaurer les ressources d'avant l'exploration après échec de toutes les combinaisons
        task.appliedResources = previousResources;
        task.invalidateSchedulable();

        if (!someHadSlots) {
            const cnt = (this._taskFailureCount.get(task.id) ?? 0) + 1;
            this._taskFailureCount.set(task.id, cnt);
        }

        return false;
    }

    private _tryTaskWithCurrentResources(task: Task, taskIndex: number): boolean {
        const possibleSlots = this.generatePossibleSlots(task);

        if (possibleSlots.length === 0) {
            this._lastAttemptHadSlots = false;
            return false;
        }
        this._lastAttemptHadSlots = true;

        for (const slot of possibleSlots) {
            const taskSolution: TaskSolution = {
                task,
                startTime: slot.startTime,
                appliedResources: [...task.getAllResources()],
            };

            this.solution.push(taskSolution);

            try {
                this.applyConstraints(taskSolution);
            } catch {
                this.solution.pop();
                continue;
            }

            const result = this.backtrack(taskIndex + 1);
            this.undoConstraints(taskSolution);
            this.solution.pop();

            if (result) {
                return true;
            }
        }

        return false;
    }

    /**
     * SUPPORT DES DÉPENDANCES: Génère tous les créneaux possibles pour une tâche donnée
     * MODIFIÉ: Utilise maintenant les vrais créneaux disponibles de task.schedulable
     * et intègre les contraintes de dépendances temporelles
     */
    protected generatePossibleSlots(task: Task): Array<{startTime: number}> {
        const slots: Array<{startTime: number}> = [];
        const SLOT_STEP = 30;
        const MINUTES_PER_DAY = 24 * 60;

        let earliestStartTime = 0;
        const dependency = task.getDependsOn();
        if (dependency) {
            const dependencyScheduled = this.solution.find(sol => sol.task === dependency);
            if (!dependencyScheduled) return [];
            earliestStartTime = dependencyScheduled.startTime + dependency.duration;
        }

        // Pré-calcul de la contrainte flottante (si active)
        const lb = this._config.lunchBreak;
        const floatingLB = lb.type === 'floating' ? lb : null;
        let floatingEarliestMin = 0, floatingLatestMin = 0;
        let groupResources: Resource[] = [];
        if (floatingLB) {
            floatingEarliestMin = this._parseTimeToMinutes(floatingLB.earliest);
            floatingLatestMin   = this._parseTimeToMinutes(floatingLB.latest);
            groupResources = task.appliedResources.filter(r => r.type === ResourceType.GROUP);
        }

        const availableIntervals = task.schedulable.getAvailableIntervals();

        for (const interval of availableIntervals) {
            const adjustedStart = Math.max(interval.start, earliestStartTime);
            if (adjustedStart >= interval.end) continue;

            if (interval.end - adjustedStart >= task.duration) {
                for (let startTime = adjustedStart;
                     startTime + task.duration <= interval.end;
                     startTime += SLOT_STEP) {

                    // Filtre pause méridienne flottante sur les ressources GROUP
                    if (floatingLB && groupResources.length > 0) {
                        const dayIndex = Math.floor(startTime / MINUTES_PER_DAY);
                        const winStart = dayIndex * MINUTES_PER_DAY + floatingEarliestMin;
                        const winEnd   = dayIndex * MINUTES_PER_DAY + floatingLatestMin;
                        const slotEnd  = startTime + task.duration;
                        if (groupResources.some(r =>
                            !this._resourceKeepsFloatingBreak(r, startTime, slotEnd, winStart, winEnd, floatingLB.duration)
                        )) continue;
                    }

                    slots.push({ startTime });
                }
            }
        }

        return slots;
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

    /**
     * Applique les contraintes après l'assignation d'une tâche
     */
    protected applyConstraints(taskSolution: TaskSolution): void {
        const { startTime, task, appliedResources } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        for (const resource of appliedResources) {
            resource.book(startMinutes, endMinutes);
        }
        this.invalidateSchedulableForResources(appliedResources);
    }

    /**
     * Annule les contraintes lors du backtrack
     */
    protected undoConstraints(taskSolution: TaskSolution): void {
        const { startTime, task, appliedResources } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        for (const resource of appliedResources) {
            resource.availability.addAvailability(startMinutes, endMinutes);
        }
        this.invalidateSchedulableForResources(appliedResources);
    }

    /**
     * Invalide le schedulable de toutes les tâches qui utilisent au moins une des ressources données
     * OPTIMISÉ: Utilise l'index bidirectionnel des ressources pour un accès direct
     */
    protected invalidateSchedulableForResources(resources: Resource[]): void {
        const tasksToInvalidate = new Set<Task>();
        
        // Utiliser l'index bidirectionnel pour collecter directement les tâches concernées
        for (const resource of resources) {
            const resourceTasks = resource.getTasks() as Task[];
            for (const task of resourceTasks) {
                tasksToInvalidate.add(task);
            }
        }
        
        // Invalider le schedulable de toutes les tâches concernées
        for (const task of tasksToInvalidate) {
            task.invalidateSchedulable();
        }
    }

    /**
     * Calcule un score de contrainte dynamique pour une tâche (état ACTUEL des ressources)
     * Prend en compte les réservations déjà effectuées pendant le backtracking
     */
    protected getCurrentConstraintScore(task: Task): number {
        // Recalculer la disponibilité avec l'état actuel des ressources
        // (après les réservations effectuées par les tâches déjà planifiées)
        let baseScore = 0;
        // Test : la tâche a-t-elle un enseignant vacataire ?
        const teacher = task.getTeacherResource?.();
        
        if (teacher && teacher.status === 'VACATAIRE') {
            // les vacataires sont ultra prioritaires
            baseScore += 5*24*60; // Bonus élevé pour les vacataires (5 jours en minutes)
        }
        
        // durée maximale planifiable pour une semaine (en minutes)
        let max = (10*4 + 4.5)*60; // 10 heures par jour, 4 jours + 4.5 heures le jeudi matin

        let currentAvailableTime = task.schedulable.getTotalAvailableTime();
        // moins il y a de créneau pour placer la tache, plus on augmente le score
        baseScore += (max - currentAvailableTime);

        // si la tache possède des dépendances, on lui ajoute le score de ses dépendances
        if (task.hasDependentTasks() ) {
         
            let deps = task.getDependentTasks();
            for (let dep of deps) {
                baseScore += this.getCurrentConstraintScore(dep);
            }

        }

        return baseScore;
    }

    /**
     * Trie dynamiquement les tâches restantes selon l'état actuel des ressources
     * Applique une heuristique Most Constrained Variable (MCV)
     */
    protected dynamicTaskSort(startIndex: number): void {
        // Ne trier que les tâches non encore traitées
        const remainingTasks = this.tasks.slice(startIndex);
        
        // Trier par score de contrainte actuel (plus contraint = plus prioritaire)
        remainingTasks.sort((a, b) => {
            const scoreA = this.getCurrentConstraintScore(a);
            const scoreB = this.getCurrentConstraintScore(b);
            return scoreB - scoreA;
        });
        
        // Remettre les tâches triées dans le tableau principal
        for (let i = 0; i < remainingTasks.length; i++) {
            this.tasks[startIndex + i] = remainingTasks[i];
        }
    }

    /**
     * Évalue la qualité d'une solution
     */
    protected  evaluateSolution(solution: TaskSolution[]): number {
        // Score composite pour différencier les solutions complètes :
        // 1. Nombre de tâches planifiées (critère principal)
        // 2. Compacité des enseignants vacataires et permanents
        // 3. Pénalité pour les interruptions (gaps) entre cours

        const analysis = new ScheduleAnalysis(solution);
        const scores = analysis.getSolutionScores();
        
        // Score principal : tâches planifiées + compacité
        let score = scores.plannedTasks * 1000 
                  + scores.vacataireCompactnessScore * 100 
                  + scores.permanentCompactnessScore;
        
        // Critère secondaire : pénaliser les interruptions (gaps) pour les enseignants
        const teacherGaps = analysis.analyzeResourceGaps(ResourceType.TEACHER);
        const totalGaps = teacherGaps.reduce((sum, gap) => sum + gap.totalGaps, 0);
        score -= totalGaps * 0.01; // Pénalité légère : 0.01 point par minute d'interruption
        
        return score;
    }

    /**
     * Vérifie l'absence de conflits dans une solution complète
     * Contrôle de validation final pour s'assurer qu'aucune ressource n'est double-réservée
     */
    public verifySolution(solution: TaskSolution[]): { isValid: boolean, conflicts: string[] } {
        const conflicts: string[] = [];
        
        console.log(`🔍 Vérification de la solution (${solution.length} tâches)...`);
        
        // Vérification de doublons d'instances de Task
        const seenTasks = new Set<Task>();
        const duplicateTasks: string[] = [];
        for (const sol of solution) {
            if (seenTasks.has(sol.task)) {
                duplicateTasks.push(sol.task.code);
            }
            seenTasks.add(sol.task);
        }
        if (duplicateTasks.length > 0) {
            console.error(`❌ Doublons d'instances de Task détectés dans la solution: ${duplicateTasks.join(', ')}`);
        }
        // Vérifier chaque paire de tâches pour détecter les conflits
        for (let i = 0; i < solution.length; i++) {
            const task1 = solution[i];
            const end1 = task1.startTime + task1.task.duration;
            
            for (let j = i + 1; j < solution.length; j++) {
                const task2 = solution[j];
                const end2 = task2.startTime + task2.task.duration;
                
                // Vérifier s'il y a chevauchement temporel
                const hasTimeOverlap = (task1.startTime < end2 && end1 > task2.startTime);
                
                if (hasTimeOverlap) {
                    // OPTIMISÉ: Utiliser des Sets pour des comparaisons plus rapides
                    const resSet1 = new Set(task1.task.getAllResources().map(r => r.id));
                    const sharedRes = task2.task.getAllResources().filter(r2 => resSet1.has(r2.id));
                    if (sharedRes.length > 0) {
                        const conflict = `CONFLIT détecté entre "${task1.task.name}" (${this.formatTime(task1.startTime)}-${this.formatTime(end1)}) et "${task2.task.name}" (${this.formatTime(task2.startTime)}-${this.formatTime(end2)}) sur les ressources: ${sharedRes.map(r => r.id).join(', ')}`;
                        conflicts.push(conflict);
                        console.error(`❌ ${conflict}`);
                        throw new Error('Erreur critique: Conflit détecté dans une solution supposée valide');
                    }
                }
            }
        }
        
        const isValid = conflicts.length === 0 && duplicateTasks.length === 0;

        if (isValid) {
            console.log(`✅ Solution valide - Aucun conflit détecté`);
        } else {
            console.error(`❌ Solution invalide - ${conflicts.length} conflit(s) détecté(s) et ${duplicateTasks.length} doublon(s) détecté(s)`);
        }


        return { isValid, conflicts };
    }
    
    /**
     * Formate un timestamp en heure lisible (ex: 480 -> "08:00")
     */
    private formatTime(timestamp: number): string {
        const { dayIndex, hour, minute } = this.fromTimestamp(timestamp);
        const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
        const dayName = days[dayIndex] || `J${dayIndex}`;
        return `${dayName} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }



    /**
     * Exporte la meilleure solution au format iCal
     * Crée trois fichiers séparés selon les codes de cours (R1, R3, R5)
     * Décale les timestamps pour correspondre à la semaine 36 de 2025
     */
    export2ICal(): string {
        if (this.bestSolution.length === 0) {
            console.warn('⚠️ Aucune solution à exporter');
            return '';
        }

        // Calculer la date du lundi de la semaine 3 de 2026
        const year = 2025;
        const weekNumber = 47; // Semaine 3 (à modifier si nécessaire)

        // Le 1er janvier 2026 est un jeudi
        // Calcul du premier lundi de l'année 2026 : 5 janvier 2026
        const firstMondayOfYear = new Date(year, 0, 6); // 5 janvier 2025

        // Calculer le lundi de la semaine 3
        const mondayWeek3 = new Date(firstMondayOfYear);
        mondayWeek3.setDate(firstMondayOfYear.getDate() + (weekNumber - 1) * 7);

        console.log(`📅 Export iCal pour la semaine ${weekNumber} de ${year}`);
        console.log(`📅 Lundi de la semaine 3: ${mondayWeek3.toLocaleDateString('fr-FR')}`);

        // Séparer les solutions par code de cours
        const r1Solutions = this.bestSolution.filter(s => s.task.code.startsWith('R1'));
        const r3Solutions = this.bestSolution.filter(s => s.task.code.startsWith('R3'));
        const r5Solutions = this.bestSolution.filter(s => s.task.code.startsWith('R5'));

        const exportedFiles: string[] = [];

        // Créer un fichier pour chaque catégorie
        const categories = [
            { prefix: 'R1', solutions: r1Solutions, name: 'R1-BUT1' },
            { prefix: 'R3', solutions: r3Solutions, name: 'R3-BUT2' },
            { prefix: 'R5', solutions: r5Solutions, name: 'R5-BUT3' }
        ];

        // Formater les dates au format iCal (YYYYMMDDTHHMMSS)
        const formatICalDate = (date: Date): string => {
            return date.getFullYear().toString() +
                   (date.getMonth() + 1).toString().padStart(2, '0') +
                   date.getDate().toString().padStart(2, '0') + 'T' +
                   date.getHours().toString().padStart(2, '0') +
                   date.getMinutes().toString().padStart(2, '0') +
                   date.getSeconds().toString().padStart(2, '0');
        };

        for (const category of categories) {
            // Trouver les tâches non planifiées pour cette catégorie
            // Correction : ne placer le dimanche que les tâches réellement non planifiées (absentes de la solution globale)
            const allTasksInCategory = this.tasks.filter(task => task.code.startsWith(category.prefix));
            const plannedTasksGlobal = this.bestSolution.map(sol => sol.task);
            const unplannedTasksInCategory = allTasksInCategory.filter(task => !plannedTasksGlobal.includes(task));
            if (unplannedTasksInCategory.length > 0) {
                console.log(`📋 Codes des tâches non planifiées pour ${category.prefix}:`);
                unplannedTasksInCategory.forEach(task => console.log(`   - ${task.code}`));
            }

            if (category.solutions.length === 0 && unplannedTasksInCategory.length === 0) {
                console.log(`⚠️ Aucun cours ${category.prefix} à exporter`);
                continue;
            }

            // Générer le contenu iCal pour cette catégorie
            let icalContent = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                `PRODID:-//EDT-TS//Planificateur de cours ${category.name}//FR`,
                'CALSCALE:GREGORIAN',
                'METHOD:PUBLISH',
                ''
            ].join('\r\n');

            // Ajouter chaque événement planifié de cette catégorie
            for (const solution of category.solutions) {
                const task = solution.task;
                
                // Convertir le timestamp en composants jour/heure
                const { dayIndex, hour, minute } = this.fromTimestamp(solution.startTime);
                
                // Calculer la date réelle de l'événement
                const eventDate = new Date(mondayWeek3);
                eventDate.setDate(mondayWeek3.getDate() + dayIndex);
                eventDate.setHours(hour, minute, 0, 0);
                
                // Date de fin (ajouter la durée en minutes)
                const endDate = new Date(eventDate);
                endDate.setMinutes(endDate.getMinutes() + task.duration);

                // Extraire les ressources
                const teachersExport = solution.task.getAllResources().filter(r => r.type === 'teacher').map(r => r.id);
                const roomsExport = solution.task.getAllResources().filter(r => r.type === 'room').map(r => r.id);
                const groupsExport = solution.task.getAllResources().filter(r => r.type === 'group').map(r => r.id);

                // Créer une description détaillée
                const description = [
                    `Code: ${task.code}`,
                    `Durée: ${task.duration} minutes`,
                    teachersExport.length > 0 ? `Enseignant(s): ${teachersExport.join(', ')}` : '',
                    roomsExport.length > 0 ? `Salle(s): ${roomsExport.join(', ')}` : '',
                    groupsExport.length > 0 ? `Groupe(s): ${groupsExport.join(', ')}` : ''
                ].filter(line => line).join('\r\n');

                // Créer le summary au format spécifié : "R3.16 GILLET Anthony, BUT2-G1.BUT2-G21.BUT2-G22.BUT2-G3"
                const summaryParts = [task.code, task.type];
                if (teachersExport.length > 0) {
                    summaryParts.push(teachersExport[0] + ','); // Premier enseignant avec virgule
                }
                if (groupsExport.length > 0) {
                    summaryParts.push(groupsExport.join('.')); // Groupes séparés par des points
                }
                const summary = summaryParts.join(' ');

                // Générer un UID unique avec identifiant d'export
                const exportId = Date.now();
                const uid = `${task.code}_${teachersExport.join('_')}_${groupsExport.join('_')}_${solution.startTime}_${exportId}@edt-ts.local`;

                // Timestamp de création (format UTC obligatoire pour DTSTAMP)
                const now = new Date();
                const dtstamp = now.getUTCFullYear().toString() +
                               (now.getUTCMonth() + 1).toString().padStart(2, '0') +
                               now.getUTCDate().toString().padStart(2, '0') + 'T' +
                               now.getUTCHours().toString().padStart(2, '0') +
                               now.getUTCMinutes().toString().padStart(2, '0') +
                               now.getUTCSeconds().toString().padStart(2, '0') + 'Z';

                // Définir la couleur Google Calendar
                // ...existing code...

                // Ajouter l'événement iCal
                icalContent += [
                    'BEGIN:VEVENT',
                    `UID:${uid}`,
                    `DTSTAMP:${dtstamp}`,
                    `DTSTART:${formatICalDate(eventDate)}`,
                    `DTEND:${formatICalDate(endDate)}`,
                    `SUMMARY:${summary}`,
                    `DESCRIPTION;CHARSET=UTF-8:${description}`,
                    roomsExport.length > 0 ? `LOCATION:${roomsExport[0]}` : '',
                    teachersExport.length > 0 ? `ORGANIZER:CN=${teachersExport[0]}` : '',
                    groupsExport.length > 0 ? `CATEGORIES:${groupsExport.join(',')}` : '',
                    `STATUS:CONFIRMED`,
                    `TRANSP:OPAQUE`,
                    'END:VEVENT'
                ].filter(line => line).join('\r\n') + '\r\n';
            }

            // Ajouter les tâches non planifiées le dimanche matin à 8:00
            if (unplannedTasksInCategory.length > 0) {
                console.log(`📋 Ajout de ${unplannedTasksInCategory.length} tâches non planifiées ${category.prefix} le dimanche matin`);
                
                let sundayTime = 8 * 60; // 8:00 du matin en minutes
                
                for (const unplannedTask of unplannedTasksInCategory) {
                    // Calculer la date du dimanche (jour 6, car lundi = 0)
                    const sundayDate = new Date(mondayWeek3);
                    sundayDate.setDate(mondayWeek3.getDate() + 6); // Dimanche = lundi + 6 jours
                    sundayDate.setHours(Math.floor(sundayTime / 60), sundayTime % 60, 0, 0);
                    
                    // Date de fin
                    const endDate = new Date(sundayDate);
                    endDate.setMinutes(endDate.getMinutes() + unplannedTask.duration);

                    // Extraire les ressources
                    const teachers = unplannedTask.getAllResources().filter(r => r.type === 'teacher').map(r => r.id);
                    const rooms = unplannedTask.getAllResources().filter(r => r.type === 'room').map(r => r.id);
                    const groups = unplannedTask.getAllResources().filter(r => r.type === 'group').map(r => r.id);

                    // Créer une description avec mention "NON PLANIFIÉE"
                    const description = [
                        `⚠️ TÂCHE NON PLANIFIÉE - Placée automatiquement le dimanche`,
                        `Code: ${unplannedTask.code}`,
                        `Durée: ${unplannedTask.duration} minutes`,
                        teachers.length > 0 ? `Enseignant(s): ${teachers.join(', ')}` : '',
                        rooms.length > 0 ? `Salle(s): ${rooms.join(', ')}` : '',
                        groups.length > 0 ? `Groupe(s): ${groups.join(', ')}` : ''
                    ].filter(line => line).join('\\n');

                    // Créer le summary avec indication "NON PLANIFIÉE"
                    const summaryParts = [`[NON PLANIFIÉE] ${unplannedTask.code}`];
                    if (teachers.length > 0) {
                        summaryParts.push(teachers[0] + ',');
                    }
                    if (groups.length > 0) {
                        summaryParts.push(groups.join('.'));
                    }
                    const summary = summaryParts.join(' ');

                    // Générer un UID unique
                    const uid = `UNPLANNED_${unplannedTask.code}_${teachers.join('_')}_${groups.join('_')}_${sundayTime}@edt-ts.local`;
                    
                    // Timestamp de création
                    const now = new Date();
                    const dtstamp = now.getUTCFullYear().toString() +
                                   (now.getUTCMonth() + 1).toString().padStart(2, '0') +
                                   now.getUTCDate().toString().padStart(2, '0') + 'T' +
                                   now.getUTCHours().toString().padStart(2, '0') +
                                   now.getUTCMinutes().toString().padStart(2, '0') +
                                   now.getUTCSeconds().toString().padStart(2, '0') + 'Z';

                    // Ajouter l'événement iCal avec statut spécial
                    icalContent += [
                        'BEGIN:VEVENT',
                        `UID:${uid}`,
                        `DTSTAMP:${dtstamp}`,
                        `DTSTART:${formatICalDate(sundayDate)}`,
                        `DTEND:${formatICalDate(endDate)}`,
                        `SUMMARY:${summary}`,
                        `DESCRIPTION:${description}`,
                        rooms.length > 0 ? `LOCATION:${rooms[0]}` : '',
                        teachers.length > 0 ? `ORGANIZER:CN=${teachers[0]}` : '',
                        groups.length > 0 ? `CATEGORIES:${groups.join(',')},NON-PLANIFIEE` : 'CATEGORIES:NON-PLANIFIEE',
                        `STATUS:TENTATIVE`, // Statut TENTATIVE pour indiquer que c'est non planifié
                        `TRANSP:TRANSPARENT`, // Transparent pour indiquer que ce n'est pas un vrai créneau
                        'END:VEVENT'
                    ].filter(line => line).join('\r\n') + '\r\n';
                    
                    // Décaler l'heure pour la prochaine tâche non planifiée (espacer de 30 minutes)
                    sundayTime += 30;
                }
            }

            // Fermer le calendrier
            icalContent += 'END:VCALENDAR\r\n';

            // Sauvegarder le fichier
            const filename = `planning-${category.name}-semaine${weekNumber}-${year}.ics`;
            const __icalDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ical');
            fs.mkdirSync(__icalDir, { recursive: true });
            const filepath = path.join(__icalDir, filename);
            
            try {
                fs.writeFileSync(filepath, icalContent, 'utf8');
                console.log(`✅ Fichier iCal exporté: ${filepath}`);
                const totalEventsInCategory = category.solutions.length + unplannedTasksInCategory.length;
                console.log(`📊 ${totalEventsInCategory} événements ${category.prefix} exportés (${category.solutions.length} planifiées + ${unplannedTasksInCategory.length} non planifiées)`);
                exportedFiles.push(filepath);
            } catch (error) {
                console.error(`❌ Erreur lors de l'export iCal ${category.prefix}:`, error);
            }
        }

        // Créer un fichier iCal global contenant TOUTES les tâches (union des 3 catégories)
        console.log('\n📦 Création du fichier iCal global (TOUTES les tâches)...');
        
        // Trouver toutes les tâches non planifiées (toutes catégories confondues)
        const plannedTasksGlobal = this.bestSolution.map(sol => sol.task);
        const allUnplannedTasks = this.tasks.filter(task => !plannedTasksGlobal.includes(task));
        
        // Générer le contenu iCal global
        let globalICalContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            `PRODID:-//EDT-TS//Planificateur de cours GLOBAL//FR`,
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            ''
        ].join('\r\n');

        // Ajouter TOUTES les tâches planifiées (toutes catégories)
        for (const solution of this.bestSolution) {
            const task = solution.task;
            
            // Convertir le timestamp en composants jour/heure
            const { dayIndex, hour, minute } = this.fromTimestamp(solution.startTime);
            
            // Calculer la date réelle de l'événement
            const eventDate = new Date(mondayWeek3);
            eventDate.setDate(mondayWeek3.getDate() + dayIndex);
            eventDate.setHours(hour, minute, 0, 0);
            
            // Date de fin (ajouter la durée en minutes)
            const endDate = new Date(eventDate);
            endDate.setMinutes(endDate.getMinutes() + task.duration);

            // Extraire les ressources
            const teachersExport = solution.task.getAllResources().filter(r => r.type === 'teacher').map(r => r.id);
            const roomsExport = solution.task.getAllResources().filter(r => r.type === 'room').map(r => r.id);
            const groupsExport = solution.task.getAllResources().filter(r => r.type === 'group').map(r => r.id);

            // Créer une description détaillée
            const description = [
                `Code: ${task.code}`,
                `Durée: ${task.duration} minutes`,
                teachersExport.length > 0 ? `Enseignant(s): ${teachersExport.join(', ')}` : '',
                roomsExport.length > 0 ? `Salle(s): ${roomsExport.join(', ')}` : '',
                groupsExport.length > 0 ? `Groupe(s): ${groupsExport.join(', ')}` : ''
            ].filter(line => line).join('\r\n');

            // Créer le summary
            const summaryParts = [task.code, task.type];
            if (teachersExport.length > 0) {
                summaryParts.push(teachersExport[0] + ',');
            }
            if (groupsExport.length > 0) {
                summaryParts.push(groupsExport.join('.'));
            }
            const summary = summaryParts.join(' ');

            // Générer un UID unique
            const exportId = Date.now();
            const uid = `${task.code}_${teachersExport.join('_')}_${groupsExport.join('_')}_${solution.startTime}_${exportId}@edt-ts.local`;

            // Timestamp de création
            const now = new Date();
            const dtstamp = now.getUTCFullYear().toString() +
                           (now.getUTCMonth() + 1).toString().padStart(2, '0') +
                           now.getUTCDate().toString().padStart(2, '0') + 'T' +
                           now.getUTCHours().toString().padStart(2, '0') +
                           now.getUTCMinutes().toString().padStart(2, '0') +
                           now.getUTCSeconds().toString().padStart(2, '0') + 'Z';

            // Ajouter l'événement iCal
            globalICalContent += [
                'BEGIN:VEVENT',
                `UID:${uid}`,
                `DTSTAMP:${dtstamp}`,
                `DTSTART:${formatICalDate(eventDate)}`,
                `DTEND:${formatICalDate(endDate)}`,
                `SUMMARY:${summary}`,
                `DESCRIPTION;CHARSET=UTF-8:${description}`,
                roomsExport.length > 0 ? `LOCATION:${roomsExport[0]}` : '',
                teachersExport.length > 0 ? `ORGANIZER:CN=${teachersExport[0]}` : '',
                groupsExport.length > 0 ? `CATEGORIES:${groupsExport.join(',')}` : '',
                `STATUS:CONFIRMED`,
                `TRANSP:OPAQUE`,
                'END:VEVENT'
            ].filter(line => line).join('\r\n') + '\r\n';
        }

        // Ajouter toutes les tâches non planifiées le dimanche matin
        if (allUnplannedTasks.length > 0) {
            console.log(`📋 Ajout de ${allUnplannedTasks.length} tâches non planifiées dans le fichier global`);
            
            let sundayTime = 8 * 60; // 8:00 du matin en minutes
            
            for (const unplannedTask of allUnplannedTasks) {
                // Calculer la date du dimanche (jour 6, car lundi = 0)
                const sundayDate = new Date(mondayWeek3);
                sundayDate.setDate(mondayWeek3.getDate() + 6); // Dimanche = lundi + 6 jours
                sundayDate.setHours(Math.floor(sundayTime / 60), sundayTime % 60, 0, 0);
                
                // Date de fin
                const endDate = new Date(sundayDate);
                endDate.setMinutes(endDate.getMinutes() + unplannedTask.duration);

                // Extraire les ressources
                const teachers = unplannedTask.getAllResources().filter(r => r.type === 'teacher').map(r => r.id);
                const rooms = unplannedTask.getAllResources().filter(r => r.type === 'room').map(r => r.id);
                const groups = unplannedTask.getAllResources().filter(r => r.type === 'group').map(r => r.id);

                // Créer une description avec mention "NON PLANIFIÉE"
                const description = [
                    `⚠️ TÂCHE NON PLANIFIÉE - Placée automatiquement le dimanche`,
                    `Code: ${unplannedTask.code}`,
                    `Durée: ${unplannedTask.duration} minutes`,
                    teachers.length > 0 ? `Enseignant(s): ${teachers.join(', ')}` : '',
                    rooms.length > 0 ? `Salle(s): ${rooms.join(', ')}` : '',
                    groups.length > 0 ? `Groupe(s): ${groups.join(', ')}` : ''
                ].filter(line => line).join('\\n');

                // Créer le summary avec indication "NON PLANIFIÉE"
                const summaryParts = [`[NON PLANIFIÉE] ${unplannedTask.code}`];
                if (teachers.length > 0) {
                    summaryParts.push(teachers[0] + ',');
                }
                if (groups.length > 0) {
                    summaryParts.push(groups.join('.'));
                }
                const summary = summaryParts.join(' ');

                // Générer un UID unique
                const uid = `UNPLANNED_${unplannedTask.code}_${teachers.join('_')}_${groups.join('_')}_${sundayTime}@edt-ts.local`;
                
                // Timestamp de création
                const now = new Date();
                const dtstamp = now.getUTCFullYear().toString() +
                               (now.getUTCMonth() + 1).toString().padStart(2, '0') +
                               now.getUTCDate().toString().padStart(2, '0') + 'T' +
                               now.getUTCHours().toString().padStart(2, '0') +
                               now.getUTCMinutes().toString().padStart(2, '0') +
                               now.getUTCSeconds().toString().padStart(2, '0') + 'Z';

                // Ajouter l'événement iCal avec statut spécial
                globalICalContent += [
                    'BEGIN:VEVENT',
                    `UID:${uid}`,
                    `DTSTAMP:${dtstamp}`,
                    `DTSTART:${formatICalDate(sundayDate)}`,
                    `DTEND:${formatICalDate(endDate)}`,
                    `SUMMARY:${summary}`,
                    `DESCRIPTION:${description}`,
                    rooms.length > 0 ? `LOCATION:${rooms[0]}` : '',
                    teachers.length > 0 ? `ORGANIZER:CN=${teachers[0]}` : '',
                    groups.length > 0 ? `CATEGORIES:${groups.join(',')},NON-PLANIFIEE` : 'CATEGORIES:NON-PLANIFIEE',
                    `STATUS:TENTATIVE`,
                    `TRANSP:TRANSPARENT`,
                    'END:VEVENT'
                ].filter(line => line).join('\r\n') + '\r\n';
                
                // Décaler l'heure pour la prochaine tâche non planifiée (espacer de 30 minutes)
                sundayTime += 30;
            }
        }

        // Fermer le calendrier
        globalICalContent += 'END:VCALENDAR\r\n';

        // Sauvegarder le fichier global
        const globalFilename = `planning-ALL-semaine${weekNumber}-${year}.ics`;
        const __icalDirGlobal = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ical');
        const globalFilepath = path.join(__icalDirGlobal, globalFilename);
        
        try {
            fs.writeFileSync(globalFilepath, globalICalContent, 'utf8');
            console.log(`✅ Fichier iCal global exporté: ${globalFilepath}`);
            const totalGlobalEvents = this.bestSolution.length + allUnplannedTasks.length;
            console.log(`📊 ${totalGlobalEvents} événements GLOBAUX exportés (${this.bestSolution.length} planifiées + ${allUnplannedTasks.length} non planifiées)`);
            exportedFiles.push(globalFilepath);
        } catch (error) {
            console.error(`❌ Erreur lors de l'export iCal global:`, error);
        }

        // Retourner le premier fichier créé ou un message de résumé
        const totalExported = exportedFiles.length;
        console.log(`🎯 ${totalExported} fichier(s) iCal créé(s) au total`);
        return exportedFiles.length > 0 ? exportedFiles[0] : '';
    }

    /**
     * SUPPORT DES DÉPENDANCES: Vérifie si une tâche peut être planifiée maintenant
     * en tenant compte de ses dépendances
     */
    protected canTaskBeScheduledNow(task: Task): boolean {
        const dependency = task.getDependsOn();
        
        if (!dependency) {
            return true; // Aucune dépendance, peut être planifiée
        }
        
        // Vérifier si la tâche dont elle dépend est déjà planifiée dans la solution actuelle
        const dependencyScheduled = this.solution.find(sol => sol.task === dependency);
        
        if (!dependencyScheduled) {
            // La dépendance n'est pas encore planifiée
            return false;
        }
        
        // La dépendance est planifiée, la tâche peut être tentée
        return true;
    }

    /**
     * Convertit un timestamp en composants jour/heure/minute
     * @param timestamp Minutes depuis lundi minuit
     */
    private fromTimestamp(timestamp: number): { dayIndex: number, hour: number, minute: number } {
        const MINUTES_PER_DAY = 24 * 60; // 1440 minutes
        const dayIndex = Math.floor(timestamp / MINUTES_PER_DAY);
        const timeInDay = timestamp % MINUTES_PER_DAY;
        const hour = Math.floor(timeInDay / 60);
        const minute = timeInDay % 60;
        
        return { dayIndex, hour, minute };
    }
}
