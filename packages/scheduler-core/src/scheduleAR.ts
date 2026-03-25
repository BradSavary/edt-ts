/**
 * ScheduleAR (Alternative Resources)
 * 
 * Algorithme de planification qui supporte les ressources alternatives
 * pour TOUS les types de ressources (enseignants, salles, groupes).
 * 
 * S'inspire de ScheduleMR mais généralise l'approche à tous les types de ressources.
 * 
 * Points clés :
 * - Explore toutes les combinaisons de ressources applicables pour chaque tâche
 * - Change les ressources EN COURS de backtracking
 * - Gère correctement la propagation et l'annulation des contraintes
 * - Utilise un snapshot des ressources appliquées pour garantir la cohérence
 */
import { Loader } from './loader.js';
import { Schedule } from './schedule.js';
import type { ScheduleSolution, TaskSolution } from './schedule.js';
import type { Task, Resource } from '@edt-ts/scheduler-common';

export class ScheduleAR extends Schedule {
    private solutionsFound: number = 0;
    private maxSolutions: number = 6;
    private startTime: number = 0;
    private maxTimeMs: number = 3 * 60 * 1000; // 3 minutes par défaut
    protected firstNonEnforcedIndex: number = 0;

    /**
     * Compteur d'échecs par tâche : nombre de fois où la tâche n'avait
     * aucun créneau disponible pour aucune combinaison de ressources.
     * Cumulatif sur toute l'exécution, sans reset pendant le backtracking.
     */
    private _taskFailureCount = new Map<string, number>();

    /** Indicateur interne utilisé par tryTaskWithCurrentResources → tryAllResourceCombinations */
    private _lastAttemptHadSlots = false;

    /** Toutes les solutions complètes trouvées, triées par score décroissant en fin d'exécution */
    private _allSolutions: ScheduleSolution[] = [];

    /** Retourne une copie du compteur d'échecs par tâche (taskId → count) */

    getTaskFailureCounts(): Map<string, number> {
        return new Map(this._taskFailureCount);
    }
    
    /**
     * Configure le nombre de solutions complètes à trouver avant d'arrêter
     * @param count Nombre de solutions (défaut: 6)
     */
    setMaxCompleteSolutions(count: number): void {
        this.maxSolutions = count;
    }
    
    /**
     * Configure le timeout en secondes
     * @param seconds Timeout en secondes (défaut: 180 = 3 minutes)
     */
    setTimeoutSeconds(seconds: number): void {
        this.maxTimeMs = seconds * 1000;
    }
    
    /**
     * Override initSolver pour garantir un comportement déterministe.
     * ScheduleAR explore TOUTES les combinaisons pendant le backtracking,
     * donc la sélection initiale est déterministe (première combinaison)
     * au lieu d'aléatoire comme dans Schedule.
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
        
        // SÉLECTION DÉTERMINISTE: Appliquer la PREMIÈRE combinaison de ressources à chaque tâche
        // Les tâches enforced obtiennent leurs ressources depuis enforced.* (déjà validées plates)
        // ScheduleAR explorera ensuite toutes les combinaisons pendant le backtracking
        console.log('🎯 Sélection déterministe des jeux de ressources (première combinaison)...');
        let tasksWithoutResources = 0;
        for (const task of this.tasks) {
            if (task.isEnforced) continue; // Les ressources enforced sont gérées plus bas
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
        console.log('✅ Jeux de ressources appliqués (déterministe)\n');
        
        // Trier: enforced en tête, puis par score de contrainte croissant
        console.log('🎯 Application de la priorisation par contraintes...');
        this.tasks.sort((a, b) => {
            if (a.isEnforced && !b.isEnforced) return -1;
            if (!a.isEnforced && b.isEnforced) return 1;
            return this.getTaskConstraintScore(a) - this.getTaskConstraintScore(b);
        });
        console.log('✅ Tâches triées par ordre de difficulté\n');

        // Calculer l'index de la première tâche non-enforced
        const idx = this.tasks.findIndex(t => !t.isEnforced);
        this.firstNonEnforcedIndex = idx === -1 ? this.tasks.length : idx;

        // Pré-booking des tâches enforced : résoudre leurs ressources et réserver les créneaux
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

                // Warning si une ressource n'est pas disponible au créneau imposé
                for (const resource of enforcedResources) {
                    if (!resource.availability.isAvailable(enforced.startTime, enforced.startTime + task.duration)) {
                        console.warn(`⚠️ Tâche enforced "${task.name}" (${task.code}): ressource "${resource.id}" non disponible au créneau imposé.`);
                    }
                }

                // Réserver les créneaux (booking direct, ne sera jamais undone)
                // On passe appliedResources pour que ScheduleAR.applyConstraints (qui cast en TaskSolutionAR) trouve le champ
                this.applyConstraints({ task, startTime: enforced.startTime, appliedResources: enforcedResources } as TaskSolution);
            }
            console.log('✅ Créneaux enforced réservés.\n');
        }

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
     * Résout le problème avec exploration des ressources alternatives
     */
    solve(): ScheduleSolution[] {
        if (!this._initialized) {
            throw new Error('Appelez initSolver() avant solve().');
        }
        console.log('🔄 ALTERNATIVE RESOURCES: Début de la résolution avec exploration des ressources alternatives...');
        
        // Initialisation
        this.solution = [];
        this.bestSolution = [];
        this.bestScore = -Infinity;
        this.currentIterations = 0;
        this.solutionsFound = 0;
        this.startTime = Date.now();
        this._taskFailureCount.clear();
        this._allSolutions = [];
        
        // Tri initial (en préservant les enforced en tête)
        this.tasks.sort((a, b) => {
            if (a.isEnforced && !b.isEnforced) return -1;
            if (!a.isEnforced && b.isEnforced) return 1;
            return this.getCurrentConstraintScore(b) - this.getCurrentConstraintScore(a);
        });

        // Pré-peupler la solution avec les tâches enforced (déjà bookées dans loadData)
        for (let i = 0; i < this.firstNonEnforcedIndex; i++) {
            const task = this.tasks[i];
            const enforcedSol: TaskSolution = {
                task,
                startTime: task.enforced!.startTime,
                appliedResources: [...task.appliedResources],
            };
            this.solution.push(enforcedSol);
        }
        
        console.log(`📋 ${this.tasks.length} tâches à planifier`);
        console.log(`🏢 ${this.resources.length} ressources disponibles`);
        console.log(`⏱️ Limite: ${this.maxIterations} itérations`);
        console.log(`🎯 Objectif: ${this.maxSolutions} solutions complètes`);
        console.log(`⏰ Timeout: ${this.maxTimeMs / 1000}s`);
        console.log(`🔄 Mode Alternative Resources: exploration de toutes les combinaisons\n`);
        
        // Lancement du backtracking (depuis la première tâche non-enforced)
        const startTime = Date.now();
        this.backtrack(this.firstNonEnforcedIndex);
        const endTime = Date.now();
        
        console.log(`\n⏱️ Résolution AR terminée en ${endTime - startTime}ms`);
        console.log(`🔄 Itérations effectuées: ${this.currentIterations}`);
        console.log(`🎯 Solutions complètes trouvées: ${this.solutionsFound}`);
        
        if (this._allSolutions.length > 0) {
            console.log(`✅ ${this._allSolutions.length} solution(s) complète(s) trouvée(s), meilleur score: ${this.bestScore}`);
        } else {
            console.log(`❌ Aucune solution complète trouvée`);
        }
        
        // Trier par score décroissant
        this._allSolutions.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

        // Restaurer les ressources de la meilleure solution et vérifier
        if (this._allSolutions.length > 0) {
            const best = this._allSolutions[0];
            this.restoreTaskResourcesFromSolution(best.solutions);
            const verification = this.verifySolution(best.solutions);
            if (!verification.isValid) {
                console.warn(`⚠️ ATTENTION: La solution contient ${verification.conflicts.length} conflit(s)`);
                verification.conflicts.forEach(conflict => console.warn(`   ${conflict}`));
            }
        }

        return this._allSolutions;
    }
    
    /**
     * Stratégie de réordonnancement : lance une première résolution normale, puis,
     * si aucune solution complète n'est trouvée, remonte les N tâches les plus
     * bloquantes en tête de la liste non-enforced et relance solve() une seconde fois.
     * @param n Nombre de tâches prioritaires à placer en tête
     */
    solveWithPriorityRetry(n: number): ScheduleSolution[] {
        this.initSolver();
        const firstResults = this.solve();

        if (firstResults.length > 0) {
            return firstResults;
        }

        // Identifier les N tâches non-enforced avec le plus d'échecs (aucun créneau)
        const failureCounts = this.getTaskFailureCounts();
        const topNIds = new Set(
            Array.from(failureCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, n)
                .map(([id]) => id)
        );

        // Re-trier les tâches non-enforced : prioritaires en tête, reste après
        const nonEnforced = this.tasks.slice(this.firstNonEnforcedIndex);
        const priority = nonEnforced.filter(t => topNIds.has(t.id));
        const rest = nonEnforced.filter(t => !topNIds.has(t.id));
        const reordered = [...priority, ...rest];
        for (let i = 0; i < reordered.length; i++) {
            this.tasks[this.firstNonEnforcedIndex + i] = reordered[i];
        }

        console.log(`🔁 PriorityRetry: ${priority.length} tâche(s) bloquante(s) remontées en tête`);

        // Relancer solve() sans réinitialiser (_initialized est toujours true)
        return this.solve();
    }

    /**
     * Stratégie d'élimination : relance solve() en supprimant progressivement
     * les tâches les plus bloquantes (sans aucun créneau disponible pour toutes
     * leurs combinaisons de ressources). Répète jusqu'à n fois ou jusqu'à trouver
     * au moins une solution complète.
     * @param n Nombre maximum de tâches à éliminer
     */
    solveWithTaskElimination(n: number): ScheduleSolution[] {
        this.initSolver();
        const neutralized: Task[] = [];
        let lastResults = this.solve();

        for (let i = 0; i < n && lastResults.length === 0; i++) {
            const failureCounts = this.getTaskFailureCounts();

            // Identifier la tâche non-enforced avec le plus d'échecs (aucun créneau)
            let maxFailures = 0;
            let targetIndex = -1;
            for (let j = this.firstNonEnforcedIndex; j < this.tasks.length; j++) {
                const count = failureCounts.get(this.tasks[j].id) ?? 0;
                if (count > maxFailures) {
                    maxFailures = count;
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

            // solve() réinitialise son état interne (solution, bestSolution, compteurs…)
            lastResults = this.solve();
        }

        // Injecter les tâches neutralisées dans chaque solution retournée
        // et pénaliser le score en conséquence (1 tâche neutralisée = -1000 pts,
        // cohérent avec le poids plannedTasks * 1000 dans evaluateSolution)
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
     * Restaure les ressources correctes dans les tâches depuis la solution sauvegardée
     */
    private restoreTaskResourcesFromSolution(solution: TaskSolution[]): void {
        for (const sol of solution) {
            sol.task.appliedResources = sol.appliedResources;
        }
    }
    
    /**
     * Algorithme de backtracking avec exploration des ressources alternatives
     */
    protected backtrack(taskIndex: number): boolean {
        // Vérifications de sécurité
        this.currentIterations++;
        
        // Vérifier le timeout
        const elapsedTime = Date.now() - this.startTime;
        if (elapsedTime > this.maxTimeMs) {
            if (!this.limitWarningShown) {
                console.log(`⏰ Timeout atteint (${(elapsedTime / 1000).toFixed(1)}s)`);
                this.limitWarningShown = true;
            }
            return false;
        }
        
        // Vérifier le nombre d'itérations
        if (this.currentIterations > this.maxIterations) {
            if (!this.limitWarningShown) {
                console.log('⚠️ Limite d\'itérations atteinte');
                this.limitWarningShown = true;
            }
            return false;
        }
        
        // Condition d'arrêt : toutes les tâches planifiées
        if (taskIndex >= this.tasks.length) {
            this.solutionsFound++;
            const score = Math.round(this.evaluateSolution(this.solution));

            // Copie profonde avec snapshot des ressources
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
            console.log(`✅ Solution COMPLÈTE ${this.solutionsFound}/${this.maxSolutions} (score: ${score}, meilleur: ${this.bestScore})`);

            // Vérifier si on a atteint l'objectif de solutions complètes
            if (this.solutionsFound >= this.maxSolutions) {
                console.log(`🎯 Objectif atteint: ${this.solutionsFound} solutions complètes trouvées`);
                return true; // Arrêter la recherche
            }

            // Continuer la recherche pour trouver d'autres solutions
            return false;
        }
        
        // Tri dynamique
       // if (taskIndex < this.tasks.length - 1 && taskIndex % 5 === 0) 
       {
            this.dynamicTaskSort(taskIndex);
        }
        
        const task = this.tasks[taskIndex];
        
        // Vérifier les dépendances
        if (!this.canTaskBeScheduledNow(task)) {
            throw new Error(`Erreur: La tâche '${task.name}' ne peut pas être planifiée (dépendances non satisfaites)`);
        }
        
        // Affichage de progression
        if (this.currentIterations % 10000 === 0) {
            console.log(`🔄 Itération ${this.currentIterations}, tâche ${taskIndex}/${this.tasks.length}: ${task.name}`);
        }
        
        // EXPLORER TOUTES LES COMBINAISONS DE RESSOURCES
        const success = this.tryAllResourceCombinations(task, taskIndex);
        
        if (success) {
            return true;
        }
        
        // Si aucune combinaison n'a fonctionné, retourner false pour forcer le backtracking
        // Cela permettra d'essayer d'autres combinaisons de ressources pour les tâches précédentes
        return false;
    }
    
    /**
     * Explore toutes les combinaisons de ressources pour une tâche
     */
    private tryAllResourceCombinations(task: Task, taskIndex: number): boolean {
        const allCombinations = task.getApplicableResources();
        
        if (allCombinations.length === 0) {
            console.warn(`⚠️ Aucune combinaison de ressources pour ${task.name}`);
            return false;
        }
        
        // Explorer chaque combinaison possible
        let someHadSlots = false;
        for (const resourceCombination of allCombinations) {
            if (this.tryWithResourceCombination(task, resourceCombination, taskIndex)) {
                return true;
            }
            someHadSlots ||= this._lastAttemptHadSlots;
        }

        // Aucune combinaison n'a produit de créneau disponible : tâche bloquée
        if (!someHadSlots) {
            const count = (this._taskFailureCount.get(task.id) ?? 0) + 1;
            this._taskFailureCount.set(task.id, count);
        }

        return false;
    }
    
    /**
     * Tente la planification avec une combinaison de ressources spécifique
     */
    private tryWithResourceCombination(task: Task, combination: Resource[], taskIndex: number): boolean {
        // Sauvegarder la combinaison actuelle
        const previousResources = task.appliedResources;
        
        // Appliquer la nouvelle combinaison
        task.appliedResources = combination;
        
        // Invalider le cache des disponibilités
        task.invalidateSchedulable();
        
        // Essayer la planification avec cette combinaison
        const success = this.tryTaskWithCurrentResources(task, taskIndex);
        
        // Si échec, restaurer les ressources précédentes
        if (!success) {
            task.appliedResources = previousResources;
            task.invalidateSchedulable();
        }
        
        return success;
    }
    
    /**
     * Tente la planification avec les ressources actuellement assignées
     */
    private tryTaskWithCurrentResources(task: Task, taskIndex: number): boolean {
        // Générer les créneaux possibles
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
            
            // Appliquer les contraintes
            try {
                this.applyConstraints(taskSolution);
            } catch (error) {
                // Si les contraintes ne peuvent pas être appliquées (ex: pause méridienne),
                // annuler l'ajout et essayer la combinaison de ressources suivante
                this.solution.pop();
                continue;
            }
            
            // Récursion
            const result = this.backtrack(taskIndex + 1);
            
            // Backtrack
            this.undoConstraints(taskSolution);
            this.solution.pop();
            
            // Si la récursion a réussi, propager le succès
            if (result) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Applique les contraintes avec le snapshot des ressources
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
    
    protected undoConstraints(taskSolution: TaskSolution): void {
        const { startTime, task, appliedResources } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        for (const resource of appliedResources) {
            resource.availability.addAvailability(startMinutes, endMinutes);
        }
        this.invalidateSchedulableForResources(appliedResources);
    }
}