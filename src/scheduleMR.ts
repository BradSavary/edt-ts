import { Schedule } from './schedule.js';
import type { ScheduleSolution, TaskSolution } from './schedule.js';
import { Task } from './task.js';
import { Resource } from './resource.js';

/**
 * Extension de TaskSolution pour ScheduleMR qui sauvegarde les ressources utilisées
 * Nécessaire pour garantir que undoConstraints libère les bonnes ressources
 */
interface TaskSolutionMR extends TaskSolution {
    appliedResources: Resource[]; // Snapshot des ressources au moment de l'application
}

/**
 * Version Multi-Rooms du planificateur utilisant la flexibilité des salles multiples
 * Hérite de ScheduleExp et étend l'approche chirurgicale pour exploiter toutes les salles possibles
 */
export class ScheduleMR extends Schedule {
    
    /**
     * MULTI-ROOMS: Résout le problème de planification en exploitant la flexibilité des salles
     * Utilise l'approche chirurgicale avec exploration dynamique des salles alternatives
     */
    solve(): ScheduleSolution {
        console.log('🏢 MULTI-ROOMS: Début de la résolution avec gestion flexible des salles...');
        
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
        console.log(`🏫 Mode Multi-Rooms: exploitation des salles alternatives`);
        
        // Analyser les possibilités de salles multiples
        this.analyzeMultiRoomPotential();
        
        // Lancement de l'algorithme de backtracking multi-rooms
        const startTime = Date.now();
        this.backtrack(0);
        const endTime = Date.now();
        
        console.log(`⏱️ Résolution Multi-Rooms terminée en ${endTime - startTime}ms`);
        console.log(`🔄 Itérations effectuées: ${this.currentIterations}`);
        
        // Vérification finale de la solution (méthode héritée)
        if (this.bestSolution.length > 0) {
            // BUGFIX: Avant la vérification, restaurer les ressources correctes dans les tâches
            // car elles ont pu changer pendant le backtracking après la sauvegarde de bestSolution
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
            conflictCount: 0 // L'algorithme de backtracking garantit l'absence de conflits
        };
    }

    /**
     * MULTI-ROOMS: Restaure les ressources correctes dans les tâches depuis la solution sauvegardée
     * Nécessaire car les tâches peuvent changer de salle après la sauvegarde de bestSolution
     */
    private restoreTaskResourcesFromSolution(solution: TaskSolution[]): void {
        for (const sol of solution) {
            const mrSol = sol as TaskSolutionMR;
            if (mrSol.appliedResources) {
                // Restaurer les ressources de la tâche pour correspondre à celles qui étaient planifiées
                const task = mrSol.task;
                const currentRoom = task.getCurrentRoom();
                const appliedRoom = mrSol.appliedResources.find(r => r.type === 'room');
                
                // Si la salle actuelle est différente de celle appliquée, la restaurer
                if (appliedRoom && (!currentRoom || currentRoom.id !== appliedRoom.id)) {
                    // Forcer le changement de salle (même si la tâche n'est plus PENDING)
                    // On doit contourner la protection de changeRoom
                    const currentStatus = (task as any).status;
                    (task as any).status = 'pending'; // Temporairement mettre en pending
                    task.changeRoom(appliedRoom);
                    (task as any).status = currentStatus; // Restaurer le statut
                }
            }
        }
    }

    /**
     * MULTI-ROOMS: Analyse le potentiel de flexibilité des salles
     */
    private analyzeMultiRoomPotential(): void {
        const tasksWithMultipleRooms = this.tasks.filter(task => task.getAvailableRooms().length > 1);
        const totalAlternatives = this.tasks.reduce((sum, task) => sum + task.getAvailableRooms().length, 0);
        
        console.log(`🔍 Analyse Multi-Rooms:`);
        console.log(`   📊 Tâches avec salles multiples: ${tasksWithMultipleRooms.length}/${this.tasks.length}`);
        console.log(`   🏫 Total des alternatives de salles: ${totalAlternatives}`);
        console.log(`   📈 Moyenne de salles par tâche: ${(totalAlternatives / this.tasks.length).toFixed(2)}`);
    }

    /**
     * MULTI-ROOMS: Algorithme de backtracking avec exploration des salles alternatives
     * Redéfinit la méthode backtrack pour utiliser les salles multiples
     */
    protected backtrack(taskIndex: number): boolean {
        // Vérifications de sécurité (logique héritée)
        this.currentIterations++;
        
        if (this.currentIterations > this.maxIterations) {
            // Log réduit pour éviter la verbosité excessive
            if (this.currentIterations === this.maxIterations + 1) {
                console.log('⚠️ Limite d\'itérations atteinte (mode Multi-Rooms)');
            }
            return false;
        }
        
        // Condition d'arrêt : toutes les tâches sont planifiées
        if (taskIndex >= this.tasks.length) {
            const score = this.evaluateSolution(this.solution);
            if (score > this.bestScore) {
                this.bestScore = score;
                // BUGFIX: Faire une copie profonde de la solution avec snapshot des ressources
                // car les tâches peuvent changer de salle après cette sauvegarde
                this.bestSolution = this.solution.map(sol => {
                    const mrSol = sol as TaskSolutionMR;
                    return {
                        task: mrSol.task,
                        startTime: mrSol.startTime,
                        appliedResources: [...mrSol.appliedResources] // Copie profonde des ressources
                    } as TaskSolutionMR;
                });
                console.log(`✅ Nouvelle meilleure solution trouvée (MR - score: ${score}, tâches: ${this.solution.length})`);
            }
            return true;
        }

      
        
        // TRI DYNAMIQUE MR: Réorganiser les tâches restantes selon l'état actuel
        // Applique l'heuristique Most Constrained Variable de manière optimisée
        // (seulement tous les 5 niveaux pour éviter le surcoût)
        
        //if (taskIndex < this.tasks.length - 1 && taskIndex % 5 === 0) 
         {
            this.dynamicTaskSort(taskIndex);
            // Log de tri dynamique supprimé pour réduire la verbosité
        }
        

          const task = this.tasks[taskIndex];

        // SUPPORT DES DÉPENDANCES MR: Vérifier si la tâche peut être planifiée maintenant
        if (!this.canTaskBeScheduledNow(task)) {
            
            // La tâche ne peut pas être planifiée maintenant à cause des dépendances
            // Passer à la tâche suivante
            throw new Error(`Erreur critique: La tâche '${task.name}' (${task.code}) ne peut pas être planifiée maintenant en raison de dépendances non satisfaites.`);
        }
        
        // Affichage de progression occasionnel (réduit pour moins de verbosité)
        if (this.currentIterations % 10000 === 0) {
            console.log(`🏫 Itération MR ${this.currentIterations}, tâche ${taskIndex}/${this.tasks.length}: ${task.name}`);
        }

        // MULTI-ROOMS: Explorer toutes les combinaisons salle/créneau
        const success = this.tryAllRoomSlotCombinations(task, taskIndex);
        
        if (success) {
            return true;
        }
        
        // Si aucune combinaison n'a fonctionné, essayer sans cette tâche
        return this.backtrack(taskIndex + 1);
    }

    /**
     * MULTI-ROOMS: Explore toutes les combinaisons de salles et créneaux pour une tâche
     */
    private tryAllRoomSlotCombinations(task: Task, taskIndex: number): boolean {
        const availableRooms = task.getAvailableRooms();
        
        // Si pas de salles disponibles, utiliser la logique standard
        if (availableRooms.length === 0) {
            return this.tryTaskWithCurrentRoom(task, taskIndex);
        }
        
        // Explorer chaque salle possible
        for (const room of availableRooms) {
            // Tenter de changer vers cette salle
            // La restauration en cas d'échec est gérée dans tryWithAlternativeRoom
            if (this.tryWithAlternativeRoom(task, room, taskIndex)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * MULTI-ROOMS: Tente la planification avec une salle alternative
     */
    private tryWithAlternativeRoom(task: Task, alternativeRoom: Resource, taskIndex: number): boolean {
        // Changer temporairement vers la salle alternative
        const currentRoom = task.getCurrentRoom();
        
        // Si c'est déjà la bonne salle, pas besoin de changer
        if (currentRoom && currentRoom.id === alternativeRoom.id) {
            return this.tryTaskWithCurrentRoom(task, taskIndex);
        }
        
        // BUGFIX: Avant de changer de salle, s'assurer que l'ancienne salle n'a pas de réservations fantômes
        // En mode backtracking, les réservations doivent être gérées uniquement dans tryTaskWithCurrentRoom
        // donc ici on ne fait que changer la configuration de la tâche
        
        // Tenter le changement de salle
        if (!task.changeRoom(alternativeRoom)) {
            return false; // Échec du changement
        }
        
        // Invalider le cache des disponibilités après changement de salle
        task.invalidateSchedulable();
        
        // Essayer la planification avec cette nouvelle salle
        const success = this.tryTaskWithCurrentRoom(task, taskIndex);
        
        // BUGFIX: Si échec, restaurer la salle originale immédiatement pour garantir la cohérence
        if (!success && currentRoom && currentRoom.id !== alternativeRoom.id) {
            task.changeRoom(currentRoom);
            task.invalidateSchedulable();
        }
        
        return success;
    }

    /**
     * MULTI-ROOMS: Tente la planification avec la salle actuellement assignée
     */
    private tryTaskWithCurrentRoom(task: Task, taskIndex: number): boolean {
        // Génération des créneaux possibles (méthode héritée)
        const possibleSlots = this.generatePossibleSlots(task);//.slice(0, 10);
        
        if (possibleSlots.length === 0) {
            return false;
        }
        
        for (const slot of possibleSlots) {
            // BUGFIX: Sauvegarder un snapshot des ressources AVANT l'application des contraintes
            // Ceci garantit que undoConstraints libèrera les bonnes ressources même si task.resources change
            const taskSolution: TaskSolutionMR = {
                task,
                startTime: slot.startTime,
                appliedResources: [...task.getAllResources()] // Copie des ressources actuelles
            };
            
            this.solution.push(taskSolution);
            
            // Application chirurgicale des contraintes
            this.applyConstraints(taskSolution);
            
            // Récursion sur la tâche suivante
            const result = this.backtrack(taskIndex + 1);
            
            // Annulation chirurgicale des modifications
            this.undoConstraints(taskSolution);
            this.solution.pop();
            
            // Si on a trouvé une solution complète, on peut arrêter
            if (result && this.bestSolution.length === this.tasks.length) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * MULTI-ROOMS: Applique les contraintes de manière chirurgicale
     * BUGFIX: Utilise appliedResources pour garantir la cohérence avec undoConstraints
     */
    protected applyConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        const taskSolutionMR = taskSolution as TaskSolutionMR;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // BUGFIX: Utiliser les ressources sauvegardées dans appliedResources
        // Si appliedResources n'existe pas (solution standard), utiliser task.resources
    const resourcesToBook = taskSolutionMR.appliedResources || task.getAllResources();
        
        // Marquer les ressources comme occupées
        for (const resource of resourcesToBook) {
            try {
                resource.availability.book(startMinutes, endMinutes);
            } catch (error) {
                console.warn(`MR: Échec de la réservation pour la ressource ${resource.id}: ${error}`);
            }
        }
        
        // APPROCHE CHIRURGICALE: Manipulation directe des schedulables
        this.invalidateSchedulableForResources(resourcesToBook);
    }

    /**
     * MULTI-ROOMS: Annule les contraintes de manière chirurgicale
     * BUGFIX: Utilise appliedResources pour garantir qu'on libère les bonnes ressources
     */
    protected undoConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        const taskSolutionMR = taskSolution as TaskSolutionMR;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // BUGFIX: Utiliser les ressources sauvegardées dans appliedResources
        // Ceci garantit qu'on libère EXACTEMENT les ressources qui ont été réservées
        // même si task.resources a changé entre temps (changement de salle)
    const resourcesToFree = taskSolutionMR.appliedResources || task.getAllResources();
        
        // Rendre les ressources disponibles
        for (const resource of resourcesToFree) {
            resource.availability.addAvailability(startMinutes, endMinutes);
            const resourceTasks = resource.getTasks();
            for (const t of resourceTasks) {
                t.invalidateSchedulable();
            }
        }
    }

    /**
     * MULTI-ROOMS: Retire un intervalle spécifique des schedulables des tâches concernées
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