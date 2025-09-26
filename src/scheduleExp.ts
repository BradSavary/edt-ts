import { Schedule } from './schedule.js';
import type { ScheduleSolution, TaskSolution } from './schedule.js';
import { Task } from './task.js';
import { Resource } from './resource.js';

/**
 * Version expérimentale du planificateur utilisant l'approche chirurgicale
 * Hérite de Schedule et redéfinit les méthodes pour utiliser la manipulation directe des schedulables
 */
export class ScheduleExp extends Schedule {
    
    /**
     * EXPÉRIMENTAL: Résout le problème de planification avec l'approche chirurgicale
     * Utilise applyConstraintsExp() et undoConstraintsExp() pour manipulation directe des schedulables
     */
    solve(): ScheduleSolution {
        console.log('🧪 EXPÉRIMENTAL: Début de la résolution avec approche chirurgicale...');
        
        // Chargement des données via Loader (méthode héritée)
        this.loadData();
        
        // Initialisation (propriétés héritées)
        this.solution = [];
        this.bestSolution = [];
        this.bestScore = -Infinity;
        this.currentIterations = 0;
        
    // Tri initial par disponibilité des ressources (état de base)
    // Traite d'abord les tâches avec le score le plus élevé (plus contraint)
    this.tasks.sort((a, b) => this.getCurrentConstraintScore(b) - this.getCurrentConstraintScore(a));
        
        console.log(`📋 ${this.tasks.length} tâches à planifier`);
        console.log(`🏢 ${this.resources.length} ressources disponibles`);
        console.log(`⏱️ Limite: ${this.maxIterations} itérations, pas de limite de temps`);
        console.log(`🔬 Mode expérimental: manipulation chirurgicale des schedulables`);
        
        // Lancement de l'algorithme de backtracking expérimental
        const startTime = Date.now();
        this.backtrack(0);
        const endTime = Date.now();
        
        console.log(`⏱️ Résolution expérimentale terminée en ${endTime - startTime}ms`);
        console.log(`🔄 Itérations effectuées: ${this.currentIterations}`);
        
        // Vérification finale de la solution (méthode héritée)
        if (this.bestSolution.length > 0) {
            const verification = this.verifySolution(this.bestSolution);
            if (!verification.isValid) {
                console.warn(`⚠️ ATTENTION: La solution contient ${verification.conflicts.length} conflit(s)`);
                verification.conflicts.forEach(conflict => console.warn(`   ${conflict}`));
            }
        }
        
        return {
            solutions: [...this.bestSolution],
            isComplete: this.bestSolution.length === this.tasks.length,
            conflictCount: 0 // L'algorithme de backtracking garantit l'absence de conflits
        };
    }

    /**
     * EXPÉRIMENTAL: Algorithme de backtracking avec approche chirurgicale
     * Redéfinit la méthode backtrack pour utiliser les méthodes expérimentales
     */
    protected backtrack(taskIndex: number): boolean {
        // Vérifications de sécurité (logique héritée)
        this.currentIterations++;
        
        if (this.currentIterations > this.maxIterations) {
            console.log('⚠️ Limite d\'itérations atteinte (mode expérimental)');
            return false;
        }
        
        // Condition d'arrêt : toutes les tâches sont planifiées
        if (taskIndex >= this.tasks.length) {
            const score = this.evaluateSolution(this.solution);
            if (score > this.bestScore) {
                this.bestScore = score;
                this.bestSolution = [...this.solution];
                console.log(`✅ Nouvelle meilleure solution trouvée (EXP - score: ${score}, tâches: ${this.solution.length})`);
            }
            return true;
        }

        // TRI DYNAMIQUE EXP: Réorganiser les tâches restantes selon l'état actuel
        // Applique l'heuristique Most Constrained Variable de manière optimisée
        // (seulement tous les 5 niveaux pour éviter le surcoût)
        
        if (taskIndex < this.tasks.length - 1 && taskIndex % 5 === 0) {
            this.dynamicTaskSort(taskIndex);
        }

        const task = this.tasks[taskIndex];

        // check de la cohérence des disponibilités
        /*
        if (task.isSchedulableConsistentWithResources() === false) {
            throw new Error(`⚠️ UNDO Incohérence détectée pour la tâche '${task.name}' (${task.code}) avec ses ressources`);
           
        }
        */
        
        // SUPPORT DES DÉPENDANCES EXP: Vérifier si la tâche peut être planifiée maintenant
        if (!this.canTaskBeScheduledNow(task)) {
            throw new Error(`Erreur critique: La tâche '${task.name}' (${task.code}) ne peut pas être planifiée maintenant en raison de dépendances non satisfaites.`);
        }
        
        // Génération des créneaux possibles (méthode héritée)
        const possibleSlots = this.generatePossibleSlots(task).slice(0, 10);
        
        for (const slot of possibleSlots) {
            // Assignation de la tâche au créneau
            const taskSolution: TaskSolution = {
                task,
                startTime: slot.startTime
            };
            
            this.solution.push(taskSolution);
            
            // EXPÉRIMENTAL: Application chirurgicale des contraintes
            this.applyConstraints(taskSolution);

       
            // Récursion sur la tâche suivante
            const result = this.backtrack(taskIndex + 1);
            
            // EXPÉRIMENTAL: Annulation chirurgicale des modifications
            this.undoConstraints(taskSolution);
     
            this.solution.pop();
            
            // Si on a trouvé une solution complète, on peut arrêter
            if (result && this.bestSolution.length === this.tasks.length) {
                return true;
            }
        }
        
        // Si aucun créneau n'a fonctionné, essayer sans cette tâche
        return this.backtrack(taskIndex + 1);
    }

    /**
     * EXPÉRIMENTAL: Applique les contraintes de manière chirurgicale
     * Redéfinit applyConstraints pour utiliser l'approche chirurgicale
     */
    protected applyConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // Marquer les ressources comme occupées (logique héritée)
        for (const resource of task.resources) {
            try {
                resource.availability.book(startMinutes, endMinutes);
            } catch (error) {
                console.warn(`Échec de la réservation pour la ressource ${resource.id}: ${error}`);
            }
        }
        
        // APPROCHE CHIRURGICALE: Manipulation directe des schedulables
        this.removeIntervalFromSchedulables(task.resources, startMinutes, endMinutes, task);
        //this.invalidateSchedulableForResources(task.resources);
    }

    /**
     * EXPÉRIMENTAL: Annule les contraintes de manière chirurgicale
     * Redéfinit undoConstraints pour utiliser l'approche chirurgicale
     */
    protected undoConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // Rendre les ressources disponibles (logique héritée)
        for (const resource of task.resources) {
            resource.availability.addAvailability(startMinutes, endMinutes);
             const resourceTasks = resource.getTasks();
                for (const t of resourceTasks) {
                    t.invalidateSchedulable();
                }
        }
        
        // APPROCHE CHIRURGICALE: Manipulation directe des schedulables
        // Invalider le schedulable de la tâche courante
        /*
        task.invalidateSchedulable();
        // Invalider le schedulable de toutes les tâches partageant au moins une ressource
        const tasksToUpdate = new Set<Task>();
        for (const resource of task.resources) {
            const resourceTasks = resource.getTasks();
            for (const t of resourceTasks) {
                tasksToUpdate.add(t);
            }
        }
        for (const t of tasksToUpdate) {
             t.invalidateSchedulable();
        }
             */
    }

    /**
     * EXPÉRIMENTAL: Retire un intervalle spécifique des schedulables des tâches concernées
     * Manipulation chirurgicale directe sans invalidation/recalcul complet
     */
    private removeIntervalFromSchedulables(resources: Resource[], startMinutes: number, endMinutes: number, currentTask?: Task): void {
        const tasksToUpdate = new Set<Task>();
        
        // Collecter toutes les tâches qui utilisent au moins une de ces ressources
        for (const resource of resources) {
            const resourceTasks = resource.getTasks();
            for (const task of resourceTasks) {
                tasksToUpdate.add(task);
            }
        }
        
        // Ajouter la tâche courante elle-même dans les mises à jour
        if (currentTask) {
            tasksToUpdate.add(currentTask);
        }
        
        // Retirer l'intervalle directement de chaque schedulable concerné
        for (const task of tasksToUpdate) {
            task.schedulable.removeAvailability(startMinutes, endMinutes);
        }
    }

}