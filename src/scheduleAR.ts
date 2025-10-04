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

import { Schedule } from './schedule.js';
import type { ScheduleSolution, TaskSolution } from './schedule.js';
import type { Task } from './task.js';
import type { Resource } from './resource.js';

/**
 * Extension de TaskSolution pour ScheduleAR qui sauvegarde les ressources utilisées
 * Nécessaire pour garantir que undoConstraints libère les bonnes ressources
 */
interface TaskSolutionAR extends TaskSolution {
    appliedResources: Resource[]; // Snapshot des ressources au moment de l'application
}

export class ScheduleAR extends Schedule {
    
    /**
     * Résout le problème avec exploration des ressources alternatives
     */
    solve(): ScheduleSolution {
        console.log('🔄 ALTERNATIVE RESOURCES: Début de la résolution avec exploration des ressources alternatives...');
        
        // Chargement des données
        this.loadData();
        
        // Initialisation
        this.solution = [];
        this.bestSolution = [];
        this.bestScore = -Infinity;
        this.currentIterations = 0;
        
        // Tri initial
        this.tasks.sort((a, b) => this.getCurrentConstraintScore(b) - this.getCurrentConstraintScore(a));
        
        console.log(`📋 ${this.tasks.length} tâches à planifier`);
        console.log(`🏢 ${this.resources.length} ressources disponibles`);
        console.log(`⏱️ Limite: ${this.maxIterations} itérations`);
        console.log(`🔄 Mode Alternative Resources: exploration de toutes les combinaisons\n`);
        
        // Analyser le potentiel de ressources alternatives
        this.analyzeAlternativesPotential();
        
        // Lancement du backtracking
        const startTime = Date.now();
        this.backtrack(0);
        const endTime = Date.now();
        
        console.log(`\n⏱️ Résolution AR terminée en ${endTime - startTime}ms`);
        console.log(`🔄 Itérations effectuées: ${this.currentIterations}`);
        
        // Vérification de la solution
        if (this.bestSolution.length > 0) {
            this.restoreTaskResourcesFromSolution(this.bestSolution);
            
            const verification = this.verifySolution(this.bestSolution);
            if (!verification.isValid) {
                console.warn(`⚠️ ATTENTION: La solution contient ${verification.conflicts.length} conflit(s)`);
                verification.conflicts.forEach(conflict => console.warn(`   ${conflict}`));
            }
        }
        
        return {
            solutions: [...this.bestSolution],
            isComplete: this.bestSolution.length === this.tasks.length,
            conflictCount: 0
        };
    }
    
    /**
     * Restaure les ressources correctes dans les tâches depuis la solution sauvegardée
     */
    private restoreTaskResourcesFromSolution(solution: TaskSolution[]): void {
        for (const sol of solution) {
            const arSol = sol as TaskSolutionAR;
            if (arSol.appliedResources) {
                arSol.task.appliedResources = arSol.appliedResources;
            }
        }
    }
    
    /**
     * Analyse le potentiel de flexibilité des ressources alternatives
     */
    private analyzeAlternativesPotential(): void {
        let tasksWithAlternatives = 0;
        let totalCombinations = 0;
        
        for (const task of this.tasks) {
            const combinations = task.getApplicableResources();
            if (combinations.length > 1) {
                tasksWithAlternatives++;
                totalCombinations += combinations.length;
            }
        }
        
        console.log(`🔍 Analyse des alternatives:`);
        console.log(`   📊 Tâches avec ressources alternatives: ${tasksWithAlternatives}/${this.tasks.length}`);
        if (tasksWithAlternatives > 0) {
            console.log(`   🔄 Moyenne de combinaisons: ${(totalCombinations / tasksWithAlternatives).toFixed(2)}`);
        }
    }
    
    /**
     * Algorithme de backtracking avec exploration des ressources alternatives
     */
    protected backtrack(taskIndex: number): boolean {
        // Vérifications de sécurité
        this.currentIterations++;
        
        if (this.currentIterations > this.maxIterations) {
            if (!this.limitWarningShown) {
                console.log('⚠️ Limite d\'itérations atteinte');
                this.limitWarningShown = true;
            }
            return false;
        }
        
        // Condition d'arrêt : toutes les tâches planifiées
        if (taskIndex >= this.tasks.length) {
            const score = this.evaluateSolution(this.solution);
            if (score > this.bestScore) {
                this.bestScore = score;
                // Copie profonde avec snapshot des ressources
                this.bestSolution = this.solution.map(sol => {
                    const arSol = sol as TaskSolutionAR;
                    return {
                        task: arSol.task,
                        startTime: arSol.startTime,
                        appliedResources: [...arSol.appliedResources]
                    } as TaskSolutionAR;
                });
                console.log(`✅ Nouvelle meilleure solution (AR - score: ${score}, tâches: ${this.solution.length})`);
            }
            return true;
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
        
        // Si aucune combinaison n'a fonctionné, passer à la tâche suivante
        return this.backtrack(taskIndex + 1);
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
        for (const resourceCombination of allCombinations) {
            if (this.tryWithResourceCombination(task, resourceCombination, taskIndex)) {
                return true;
            }
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
            return false;
        }
        
        for (const slot of possibleSlots) {
            // Snapshot des ressources AVANT l'application des contraintes
            const taskSolution: TaskSolutionAR = {
                task,
                startTime: slot.startTime,
                appliedResources: [...task.getAllResources()]
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
            
            // Si solution complète trouvée
            if (result && this.bestSolution.length === this.tasks.length) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Applique les contraintes avec le snapshot des ressources
     */
    protected applyConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        const arSol = taskSolution as TaskSolutionAR;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // Utiliser le snapshot des ressources pour garantir la cohérence
        for (const resource of arSol.appliedResources) {
            resource.book(startMinutes, endMinutes);
        }
        
        // Invalider le schedulable des tâches affectées
        this.invalidateSchedulableForResources(arSol.appliedResources);
    }
    
    /**
     * Annule les contraintes avec le snapshot des ressources
     */
    protected undoConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        const arSol = taskSolution as TaskSolutionAR;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // Utiliser le snapshot des ressources
        for (const resource of arSol.appliedResources) {
            resource.availability.addAvailability(startMinutes, endMinutes);
        }
        
        // Invalider le schedulable des tâches affectées
        this.invalidateSchedulableForResources(arSol.appliedResources);
    }
}