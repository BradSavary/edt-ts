import { Loader } from './lib/loader.js';
import { Task } from './task.js';
import { Resource } from './resource.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Représente une solution de planification pour une tâche
 */
export interface TaskSolution {
    task: Task;
    startTime: number; // Créneau de début (0-119 pour 5 jours * 24 créneaux)
    // assignedResources supprimé : utiliser directement task.resources
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
    
    protected tasks: Task[] = [];
    protected resources: Resource[] = [];
    protected solution: TaskSolution[] = [];
    protected bestSolution: TaskSolution[] = [];
    protected bestScore: number = -Infinity;
    protected maxIterations: number = 1000000; // Limite de sécurité augmentée
    protected currentIterations: number = 0;
    protected limitWarningShown: boolean = false;

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
        
    // Tri initial par disponibilité des ressources (état de base)
    // Traite d'abord les tâches avec le score le plus élevé (plus contraint)
    this.tasks.sort((a, b) => this.getCurrentConstraintScore(b) - this.getCurrentConstraintScore(a));
     
        console.log(`📋 ${this.tasks.length} tâches à planifier`);
        console.log(`🏢 ${this.resources.length} ressources disponibles`);
        console.log(`⏱️ Limite: ${this.maxIterations} itérations, pas de limite de temps`);
        
        // Lancement de l'algorithme de backtracking
        const startTime = Date.now();
        this.backtrack(0);
        const endTime = Date.now();
        
        console.log(`⏱️ Résolution terminée en ${endTime - startTime}ms`);
        console.log(`🔄 Itérations effectuées: ${this.currentIterations}`);
        
        // Vérification finale de la solution
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
     * Charge les données depuis le Loader
     */
    protected loadData(): void {
        this.tasks = Loader.tasks;
      //  this.resources = Array.from(Loader.resourcesManager.getAllResources());
        
        if (this.tasks.length === 0) {
            throw new Error('Aucune tâche à planifier. Vérifiez que les données sont chargées.');
        }
     /*   
        if (this.resources.length === 0) {
            throw new Error('Aucune ressource disponible. Vérifiez que les ressources sont chargées.');
        }
       */ 
        // SÉLECTION DES RESSOURCES: Appliquer un jeu de ressources aléatoire à chaque tâche
        // Ceci doit être fait UNE SEULE FOIS avant la planification
        console.log('🎲 Sélection des jeux de ressources pour chaque tâche...');
        let tasksWithoutResources = 0;
        for (const task of this.tasks) {
            const selectedResources = task.getRandomApplicableResources();
            if (!selectedResources) {
                console.warn(`⚠️  Aucune combinaison de ressources disponible pour ${task.name}`);
                tasksWithoutResources++;
            } else {
                task.appliedResources = selectedResources;
            }
        }
        if (tasksWithoutResources > 0) {
            console.warn(`⚠️  ${tasksWithoutResources} tâche(s) sans ressources disponibles`);
        }
        console.log('✅ Jeux de ressources appliqués\n');
        
        // STRATÉGIE SIMPLIFIÉE: Trier les tâches par contraintes croissantes uniquement
        // Le tri topologique est redondant car canTaskBeScheduledNow() et getCurrentConstraintScore() 
        // gèrent déjà les dépendances de manière dynamique
        console.log('🎯 Application de la priorisation par contraintes...');
        this.tasks.sort((a, b) => this.getTaskConstraintScore(a) - this.getTaskConstraintScore(b));
        console.log('✅ Tâches triées par ordre de difficulté (tri topologique supprimé car redondant)\n');
    }

    /**
     * Algorithme de backtracking principal
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
        
        // Pas de limite de temps - commenté
        // if (Date.now() - this.startTime > this.timeoutMs) {
        //     console.log('⚠️ Timeout atteint');
        //     return false;
        // }
        
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

        
        // TRI DYNAMIQUE: Réorganiser les tâches restantes selon l'état actuel
        // Applique l'heuristique Most Constrained Variable de manière optimisée
        // (seulement tous les 5 niveaux pour éviter le surcoût)
      
        if (taskIndex < this.tasks.length - 1 && taskIndex % 5 === 0) {
            this.dynamicTaskSort(taskIndex);
        }
        
        const task = this.tasks[taskIndex];
       
        // SUPPORT DES DÉPENDANCES: Vérifier si la tâche peut être planifiée maintenant
        if (!this.canTaskBeScheduledNow(task)) {
            // l'algorithme ne permet pas (normalement) le traitement d'une tâche avant celle dont elle dépend
            throw new Error(`Erreur logique: La tâche ${task.name} (index ${taskIndex}) ne peut pas être planifiée maintenant car elle dépend d'une tâche non encore planifiée.`);
            // La tâche ne peut pas être planifiée maintenant à cause des dépendances
            // Passer à la tâche suivante
            return this.backtrack(taskIndex + 1);
        }
        
        // Affichage de progression réduit (moins verbeux)
        if (this.currentIterations % 10000 === 0) {
            console.log(`🔍 Itération ${this.currentIterations}, tâche ${taskIndex}/${this.tasks.length}: ${task.name}`);
        }

        // Génération des créneaux possibles pour cette tâche (limité pour éviter l'explosion)
        const possibleSlots = this.generatePossibleSlots(task);//.slice(0, 10); // Limiter à 10 créneaux max
        
        if (possibleSlots.length === 0) {
            // Aucun créneau possible, passer à la tâche suivante (planification partielle)
            return this.backtrack(taskIndex + 1);
        }
        
        for (const slot of possibleSlots) {
            // Assignation de la tâche au créneau
            // Les slots sont déjà valides grâce à task.schedulable (intersection des ressources)
            const taskSolution: TaskSolution = {
                task,
                startTime: slot.startTime
                // Les ressources sont directement dans task.resources
            };

            this.solution.push(taskSolution);

            // Application des contraintes (propagation)
            try {
                this.applyConstraints(taskSolution);
            } catch (error) {
                // Si les contraintes ne peuvent pas être appliquées (ex: pause méridienne),
                // annuler l'ajout et essayer le créneau suivant
                this.solution.pop();
                continue;
            }

            // Récursion sur la tâche suivante
            const result = this.backtrack(taskIndex + 1);

            // Backtrack : annulation des modifications
            this.undoConstraints(taskSolution);
            this.solution.pop();

            // TRI DYNAMIQUE: Réorganiser les tâches restantes selon l'état actuel
            // Applique l'heuristique Most Constrained Variable après le pop
            // (seulement tous les 5 niveaux pour éviter le surcoût)
            // if (taskIndex < this.tasks.length - 1 && taskIndex % 5 === 0) {
            //    this.dynamicTaskSort(taskIndex);
            //}

            // Si on a trouvé une solution complète, on peut arrêter
            if (result && this.bestSolution.length === this.tasks.length) {
                return true;
            }
        }
        
        // Si aucun créneau n'a fonctionné, essayer sans cette tâche (planification partielle)
    
        return this.backtrack(taskIndex + 1);
    }

    /**
     * SUPPORT DES DÉPENDANCES: Génère tous les créneaux possibles pour une tâche donnée
     * MODIFIÉ: Utilise maintenant les vrais créneaux disponibles de task.schedulable
     * et intègre les contraintes de dépendances temporelles
     */
    protected generatePossibleSlots(task: Task): Array<{startTime: number}> {
        const slots: Array<{startTime: number}> = [];
        const SLOT_STEP = 30; // Pas de 30 minutes entre les slots
        
        // SUPPORT DES DÉPENDANCES: Calculer le moment le plus tôt possible
        let earliestStartTime = 0;
        const dependency = task.getDependsOn();
        
        if (dependency) {
            // Trouver quand la dépendance se termine dans la solution actuelle
            const dependencyScheduled = this.solution.find(sol => sol.task === dependency);
            
            if (!dependencyScheduled) {
                // La dépendance n'est pas planifiée, aucun créneau possible
                return [];
            }
            
            // La tâche ne peut commencer qu'après la fin de sa dépendance
            earliestStartTime = dependencyScheduled.startTime + dependency.duration;
        }
        
        // CORRECTION: Utiliser les vrais créneaux disponibles de la tâche
        const availableIntervals = task.schedulable.getAvailableIntervals();
        
        for (const interval of availableIntervals) {
            // Ajuster l'intervalle pour respecter la contrainte de dépendance
            const adjustedStart = Math.max(interval.start, earliestStartTime);
            
            if (adjustedStart >= interval.end) {
                continue; // L'intervalle est entièrement avant le moment autorisé
            }
            
            const intervalDuration = interval.end - adjustedStart;
            
            // Vérifier si l'intervalle ajusté est assez grand pour la tâche
            if (intervalDuration >= task.duration) {
                // Générer tous les slots possibles dans cet intervalle ajusté
                // avec un pas de SLOT_STEP minutes
                for (let startTime = adjustedStart; 
                     startTime + task.duration <= interval.end; 
                     startTime += SLOT_STEP) {
                    
                    const slot = {
                        startTime: startTime
                    };
                    
                    slots.push(slot);
                }
            }
        }
        
        return slots;
    }

    /**
     * Applique les contraintes après l'assignation d'une tâche
     */
    protected applyConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // Marquer les ressources comme occupées en utilisant la méthode book
        for (const resource of task.getAllResources()) {
            resource.book(startMinutes, endMinutes);
        }
        // Invalider le schedulable de toutes les tâches qui utilisent ces ressources
        this.invalidateSchedulableForResources(task.getAllResources());
    }

    /**
     * Annule les contraintes lors du backtrack
     */
    protected undoConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // Rendre les ressources disponibles en ajoutant la disponibilité
        for (const resource of task.getAllResources()) {
            resource.availability.addAvailability(startMinutes, endMinutes);
        }
        // Invalider le schedulable de toutes les tâches qui utilisent ces ressources
        this.invalidateSchedulableForResources(task.getAllResources());
    }

    /**
     * Invalide le schedulable de toutes les tâches qui utilisent au moins une des ressources données
     * OPTIMISÉ: Utilise l'index bidirectionnel des ressources pour un accès direct
     */
    protected invalidateSchedulableForResources(resources: Resource[]): void {
        const tasksToInvalidate = new Set<Task>();
        
        // Utiliser l'index bidirectionnel pour collecter directement les tâches concernées
        for (const resource of resources) {
            const resourceTasks = resource.getTasks();
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
     * Calcule un score de contrainte pour une tâche (état initial des ressources)
     * Le score est égal à la durée totale des créneaux où elle peut être planifiée
     */
    protected getTaskConstraintScore(task: Task): number {
        // Le score est basé sur la disponibilité totale initiale des ressources de la tâche
        // Si la tâche a une dépendance, ajouter le score de la dépendance
        const baseScore = task.schedulable.getTotalAvailableTime();
        const dependency = task.getDependsOn();
        if (dependency) {
            // Appel récursif pour la dépendance
            return baseScore + this.getTaskConstraintScore(dependency);
        }
        return baseScore;
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
    protected evaluateSolution(solution: TaskSolution[]): number {
        // Score simple : nombre de tâches planifiées
        // C'est le seul critère pertinent car l'algorithme de backtracking
        // garantit déjà qu'aucun conflit ne peut exister
        return solution.length * 100;
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
        const weekNumber = 43; // Semaine 3 (à modifier si nécessaire)

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
            const filepath = path.join('./src/ical', filename);
            
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
        const globalFilepath = path.join('./src/ical', globalFilename);
        
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
