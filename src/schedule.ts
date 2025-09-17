import { Loader } from './lib/loader.js';
import { Task } from './task.js';
import { Resource } from './resource.js';

/**
 * Représente une solution de planification pour une tâche
 */
export interface TaskSolution {
    task: Task;
    startTime: number; // Créneau de début (0-119 pour 5 jours * 24 créneaux)
    assignedResources: Resource[];
}

/**
 * Représente l'état d'une planification complète
 */
export interface ScheduleSolution {
    solutions: TaskSolution[];
    isComplete: boolean;
    conflictCount: number;
}

/**
 * Classe principale pour résoudre les problèmes de planification
 * Utilise un algorithme de programmation par contraintes avec backtracking
 */
export class Schedule {
    private tasks: Task[] = [];
    private resources: Resource[] = [];
    private solution: TaskSolution[] = [];
    private bestSolution: TaskSolution[] = [];
    private bestScore: number = -Infinity;
    private maxIterations: number = 10000; // Limite de sécurité
    private currentIterations: number = 0;
    private timeoutMs: number = 30000; // 30 secondes max
    private startTime: number = 0;

    constructor() {
        // Les données seront chargées via Loader lors de la résolution
    }

    /**
     * Résout le problème de planification en utilisant un algorithme de backtracking
     * avec propagation de contraintes
     */
    solve(): ScheduleSolution {
        console.log('🚀 Début de la résolution du planning...');
        
        // Chargement des données via Loader
        this.loadData();
        
        // Initialisation
        this.solution = [];
        this.bestSolution = [];
        this.bestScore = -Infinity;
        this.currentIterations = 0;
        this.startTime = Date.now();
        
        // Tri des tâches par contraintes (les plus contraintes en premier)
        this.tasks.sort((a, b) => this.getTaskConstraintScore(b) - this.getTaskConstraintScore(a));
        
        console.log(`📋 ${this.tasks.length} tâches à planifier`);
        console.log(`🏢 ${this.resources.length} ressources disponibles`);
        console.log(`⏱️ Limite: ${this.maxIterations} itérations, ${this.timeoutMs/1000}s`);
        
        // Lancement de l'algorithme de backtracking
        const startTime = Date.now();
        this.backtrack(0);
        const endTime = Date.now();
        
        console.log(`⏱️ Résolution terminée en ${endTime - startTime}ms`);
        console.log(`🔄 Itérations effectuées: ${this.currentIterations}`);
        
        return {
            solutions: [...this.bestSolution],
            isComplete: this.bestSolution.length === this.tasks.length,
            conflictCount: this.calculateConflicts(this.bestSolution)
        };
    }

    /**
     * Charge les données depuis le Loader
     */
    private loadData(): void {
        this.tasks = Loader.tasks;
        this.resources = Array.from(Loader.resourcesManager.getAllResources());
        
        if (this.tasks.length === 0) {
            throw new Error('Aucune tâche à planifier. Vérifiez que les données sont chargées.');
        }
        
        if (this.resources.length === 0) {
            throw new Error('Aucune ressource disponible. Vérifiez que les ressources sont chargées.');
        }
    }

    /**
     * Algorithme de backtracking principal
     */
    private backtrack(taskIndex: number): boolean {
        // Vérifications de sécurité
        this.currentIterations++;
        
        if (this.currentIterations > this.maxIterations) {
            console.log('⚠️ Limite d\'itérations atteinte');
            return false;
        }
        
        if (Date.now() - this.startTime > this.timeoutMs) {
            console.log('⚠️ Timeout atteint');
            return false;
        }
        
        // Condition d'arrêt : toutes les tâches sont planifiées
        if (taskIndex >= this.tasks.length) {
            const score = this.evaluateSolution(this.solution);
            if (score > this.bestScore) {
                this.bestScore = score;
                this.bestSolution = [...this.solution];
                console.log(`✅ Nouvelle meilleure solution trouvée (score: ${score}, tâches: ${this.solution.length})`);
            }
            return true;
        }

        const task = this.tasks[taskIndex];
        
        // Affichage de progression occasionnel
        if (this.currentIterations % 1000 === 0) {
            console.log(`🔍 Itération ${this.currentIterations}, tâche ${taskIndex}/${this.tasks.length}: ${task.name}`);
        }

        // Génération des créneaux possibles pour cette tâche (limité pour éviter l'explosion)
        const possibleSlots = this.generatePossibleSlots(task).slice(0, 10); // Limiter à 10 créneaux max
        
        if (possibleSlots.length === 0) {
            // Aucun créneau possible, passer à la tâche suivante (planification partielle)
            return this.backtrack(taskIndex + 1);
        }
        
        for (const slot of possibleSlots) {
            // Vérification de la faisabilité
            if (this.isSlotValid(task, slot)) {
                // Assignation de la tâche au créneau
                const taskSolution: TaskSolution = {
                    task,
                    startTime: slot.startTime,
                    assignedResources: slot.resources
                };
                
                this.solution.push(taskSolution);
                
                // Application des contraintes (propagation)
                this.applyConstraints(taskSolution);
                
                // Récursion sur la tâche suivante
                const result = this.backtrack(taskIndex + 1);
                
                // Backtrack : annulation des modifications
                this.undoConstraints(taskSolution);
                this.solution.pop();
                
                // Si on a trouvé une solution complète, on peut arrêter
                if (result && this.bestSolution.length === this.tasks.length) {
                    return true;
                }
            }
        }
        
        // Si aucun créneau n'a fonctionné, essayer sans cette tâche (planification partielle)
        return this.backtrack(taskIndex + 1);
    }

    /**
     * Génère tous les créneaux possibles pour une tâche donnée
     */
    private generatePossibleSlots(task: Task): Array<{startTime: number, resources: Resource[]}> {
        const slots: Array<{startTime: number, resources: Resource[]}> = [];
        
        // Calculer le nombre de créneaux nécessaires pour cette tâche
        const slotsNeeded = Math.ceil(task.duration / 90); // 90 minutes par créneau
        
        // Créer une liste des créneaux possibles et les mélanger pour éviter
        // de toujours prendre les premiers créneaux
        const timeSlots: number[] = [];
        for (let startTime = 0; startTime < 40; startTime++) {
            if (startTime + slotsNeeded <= 40) {
                timeSlots.push(startTime);
            }
        }
        
        // Mélanger les créneaux pour une meilleure distribution
        this.shuffleArray(timeSlots);
        
        // Pour chaque créneau possible
        for (const startTime of timeSlots) {
            // Recherche des ressources disponibles pour ce créneau
            const availableResources = this.findAvailableResources(task, startTime);
            
            if (availableResources.length > 0) {
                slots.push({
                    startTime,
                    resources: availableResources
                });
            }
        }
        
        // Trier les créneaux pour favoriser une distribution équilibrée
        return this.sortSlotsByPreference(slots);
    }

    /**
     * Trouve les ressources disponibles pour une tâche à un créneau donné
     */
    private findAvailableResources(task: Task, startTime: number): Resource[] {
        const availableResources: Resource[] = [];
        
        for (const resource of this.resources) {
            // Pour cette version simplifiée, on prend toutes les ressources de la tâche
            // qui sont disponibles sur la période
            if (task.resources.includes(resource)) {
                // Convertir le créneau en minutes depuis le début de la semaine
                const startMinutes = this.slotToMinutes(startTime);
                const endMinutes = startMinutes + task.duration; // task.duration est déjà en minutes
                
                // Vérification de la disponibilité sur la durée de la tâche
                if (resource.availability.isAvailable(startMinutes, endMinutes)) {
                    availableResources.push(resource);
                }
            }
        }
        
        return availableResources;
    }

    /**
     * Convertit un numéro de créneau en minutes depuis le début de la semaine
     * Créneau 0 = Lundi 8h00, Créneau 1 = Lundi 9h30, etc.
     * 8 créneaux par jour (8h-19h30)
     */
    private slotToMinutes(slot: number): number {
        const dayIndex = Math.floor(slot / 8); // 8 créneaux par jour
        const slotInDay = slot % 8;
        const hourStart = 8 + slotInDay * 1.5; // Début à 8h, créneaux de 1.5h
        
        return dayIndex * 24 * 60 + hourStart * 60;
    }

    /**
     * Vérifie si un créneau est valide pour une tâche
     */
    private isSlotValid(task: Task, slot: {startTime: number, resources: Resource[]}): boolean {
        // Calculer le nombre de créneaux nécessaires
        const slotsNeeded = Math.ceil(task.duration / 90);
        
        // Vérification des contraintes de base
        if (slot.startTime + slotsNeeded > 40) return false; // 40 créneaux par semaine
        if (slot.resources.length === 0) return false;
        
        // Vérification des conflits avec les tâches déjà planifiées
        for (const existingSolution of this.solution) {
            if (this.hasTimeConflict(existingSolution, slot.startTime, slotsNeeded)) {
                // Vérification des ressources partagées
                const sharedResources = slot.resources.filter(r => 
                    existingSolution.assignedResources.includes(r)
                );
                if (sharedResources.length > 0) {
                    return false;
                }
            }
        }
        
        return true;
    }

    /**
     * Vérifie s'il y a un conflit temporel entre deux tâches
     */
    private hasTimeConflict(solution: TaskSolution, startTime: number, duration: number): boolean {
        const endTime = startTime + duration;
        const solutionDuration = Math.ceil(solution.task.duration / 90);
        const solutionEndTime = solution.startTime + solutionDuration;
        
        return !(endTime <= solution.startTime || startTime >= solutionEndTime);
    }

    /**
     * Applique les contraintes après l'assignation d'une tâche
     */
    private applyConstraints(taskSolution: TaskSolution): void {
        const { startTime, assignedResources, task } = taskSolution;
        
        // Convertir en minutes
        const startMinutes = this.slotToMinutes(startTime);
        const endMinutes = startMinutes + task.duration;
        
        // Marquer les ressources comme occupées en utilisant la méthode book
        for (const resource of assignedResources) {
            resource.availability.book(startMinutes, endMinutes);
        }
    }

    /**
     * Annule les contraintes lors du backtrack
     */
    private undoConstraints(taskSolution: TaskSolution): void {
        const { startTime, assignedResources, task } = taskSolution;
        
        // Convertir en minutes
        const startMinutes = this.slotToMinutes(startTime);
        const endMinutes = startMinutes + task.duration;
        
        // Remarquer les ressources comme disponibles
        // Note: AvailabilityManager n'a pas de méthode unbook, 
        // donc on recrée la disponibilité
        for (const resource of assignedResources) {
            resource.availability.addAvailability(startMinutes, endMinutes);
        }
    }

    /**
     * Calcule un score de contrainte pour une tâche (pour l'heuristique de tri)
     */
    private getTaskConstraintScore(task: Task): number {
        let score = 0;
        
        // Plus la durée est longue, plus c'est contraignant
        score += task.duration * 10;
        
        // Plus le nombre de ressources requises est élevé, plus c'est contraignant
        score += task.resources.length * 5;
        
        // Ajouter d'autres heuristiques selon les besoins
        
        return score;
    }

    /**
     * Évalue la qualité d'une solution
     */
    private evaluateSolution(solution: TaskSolution[]): number {
        let score = 0;
        
        // Points pour chaque tâche planifiée
        score += solution.length * 100;
        
        // Pénalité pour les conflits
        score -= this.calculateConflicts(solution) * 50;
        
        // Bonus pour l'équilibrage des ressources
        score += this.calculateResourceBalance(solution) * 10;
        
        return score;
    }

    /**
     * Calcule le nombre de conflits dans une solution
     */
    private calculateConflicts(solution: TaskSolution[]): number {
        let conflicts = 0;
        
        for (let i = 0; i < solution.length; i++) {
            for (let j = i + 1; j < solution.length; j++) {
                const sol1 = solution[i];
                const sol2 = solution[j];
                
                if (this.hasTimeConflict(sol1, sol2.startTime, sol2.task.duration)) {
                    const sharedResources = sol1.assignedResources.filter(r => 
                        sol2.assignedResources.includes(r)
                    );
                    conflicts += sharedResources.length;
                }
            }
        }
        
        return conflicts;
    }

    /**
     * Calcule l'équilibrage des ressources
     */
    private calculateResourceBalance(solution: TaskSolution[]): number {
        const resourceUsage = new Map<Resource, number>();
        
        for (const sol of solution) {
            for (const resource of sol.assignedResources) {
                resourceUsage.set(resource, (resourceUsage.get(resource) || 0) + sol.task.duration);
            }
        }
        
        const usages = Array.from(resourceUsage.values());
        if (usages.length === 0) return 0;
        
        const mean = usages.reduce((a, b) => a + b, 0) / usages.length;
        const variance = usages.reduce((acc, usage) => acc + Math.pow(usage - mean, 2), 0) / usages.length;
        
        // Plus la variance est faible, meilleur est l'équilibrage
        return Math.max(0, 100 - Math.sqrt(variance));
    }

    /**
     * Affiche les statistiques de la solution
     */
    displaySolutionStats(solution: ScheduleSolution): void {
        console.log('\n📊 === STATISTIQUES DE LA SOLUTION ===');
        console.log(`✅ Tâches planifiées: ${solution.solutions.length}/${this.tasks.length}`);
        console.log(`⚠️ Conflits détectés: ${solution.conflictCount}`);
        console.log(`🎯 Solution complète: ${solution.isComplete ? 'OUI' : 'NON'}`);
        console.log(`📈 Score final: ${this.bestScore}`);
        
        if (solution.solutions.length > 0) {
            console.log('\n📅 === PLANNING DÉTAILLÉ ===');
            solution.solutions
                .sort((a, b) => a.startTime - b.startTime)
                .forEach(sol => {
                    const day = Math.floor(sol.startTime / 8) + 1; // 8 créneaux par jour
                    const slotInDay = sol.startTime % 8;
                    const hourStart = 8 + slotInDay * 1.5; // Début à 8h, créneaux de 1.5h
                    const hourEnd = hourStart + (sol.task.duration / 60); // Conversion minutes -> heures
                    const resources = sol.assignedResources.map(r => r.id).join(', ');
                    console.log(`📍 ${sol.task.name} - Jour ${day}, ${hourStart}h-${hourEnd}h (${resources})`);
                });
        }
    }

    /**
     * Mélange un tableau en place (algorithme Fisher-Yates)
     */
    private shuffleArray<T>(array: T[]): void {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    /**
     * Trie les créneaux par préférence pour favoriser une distribution équilibrée
     */
    private sortSlotsByPreference(slots: Array<{startTime: number, resources: Resource[]}>): Array<{startTime: number, resources: Resource[]}> {
        // Compter les tâches déjà planifiées par jour
        const dayCount = new Array(5).fill(0); // 5 jours
        for (const sol of this.solution) {
            const day = Math.floor(sol.startTime / 8);
            if (day >= 0 && day < 5) {
                dayCount[day]++;
            }
        }

        // Trier en privilégiant les jours moins chargés
        return slots.sort((a, b) => {
            const dayA = Math.floor(a.startTime / 8);
            const dayB = Math.floor(b.startTime / 8);
            
            // Privilégier les jours moins chargés
            const loadDiff = dayCount[dayA] - dayCount[dayB];
            if (loadDiff !== 0) return loadDiff;
            
            // En cas d'égalité, privilégier les heures de début de journée
            const hourA = a.startTime % 8;
            const hourB = b.startTime % 8;
            return hourA - hourB;
        });
    }
}
