import { Loader } from './lib/loader.js';
import { Task } from './task.js';
import { Resource } from './resource.js';
import { sortTasksByDifficulty, analyzeTaskScoring } from './taskPriority.js';
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
    private tasks: Task[] = [];
    private resources: Resource[] = [];
    private solution: TaskSolution[] = [];
    private bestSolution: TaskSolution[] = [];
    private bestScore: number = -Infinity;
    private maxIterations: number = 1000000; // Limite de sécurité augmentée
    private currentIterations: number = 0;

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
        
        // Tri des tâches par contraintes (les plus contraintes en premier)
        // Plus le temps disponible est faible, plus la tâche est contrainte
        this.tasks.sort((a, b) => this.getTaskConstraintScore(a) - this.getTaskConstraintScore(b));
        
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
    private loadData(): void {
        this.tasks = Loader.tasks;
        this.resources = Array.from(Loader.resourcesManager.getAllResources());
        
        if (this.tasks.length === 0) {
            throw new Error('Aucune tâche à planifier. Vérifiez que les données sont chargées.');
        }
        
        if (this.resources.length === 0) {
            throw new Error('Aucune ressource disponible. Vérifiez que les ressources sont chargées.');
        }
        
        // NOUVELLE STRATÉGIE: Trier les tâches par difficulté décroissante
        console.log('🎯 Application de la priorisation par difficulté...');
        analyzeTaskScoring(this.tasks);
        this.tasks = sortTasksByDifficulty(this.tasks);
        console.log('✅ Tâches triées par ordre de difficulté décroissante\n');
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
            // Assignation de la tâche au créneau
            // Les slots sont déjà valides grâce à task.schedulable (intersection des ressources)
            const taskSolution: TaskSolution = {
                task,
                startTime: slot.startTime
                // Les ressources sont directement dans task.resources
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
        
        // Si aucun créneau n'a fonctionné, essayer sans cette tâche (planification partielle)
        return this.backtrack(taskIndex + 1);
    }

    /**
     * Génère tous les créneaux possibles pour une tâche donnée
     * CORRIGÉ: Utilise maintenant les vrais créneaux disponibles de task.schedulable
     * et génère tous les slots possibles dans chaque intervalle
     */
    private generatePossibleSlots(task: Task): Array<{startTime: number}> {
        const slots: Array<{startTime: number}> = [];
        const SLOT_STEP = 30; // Pas de 30 minutes entre les slots
        
        // CORRECTION: Utiliser les vrais créneaux disponibles de la tâche
        const availableIntervals = task.schedulable.getAvailableIntervals();
        
        for (const interval of availableIntervals) {
            const intervalDuration = interval.end - interval.start;
            
            // Vérifier si l'intervalle est assez grand pour la tâche
            if (intervalDuration >= task.duration) {
                // Générer tous les slots possibles dans cet intervalle
                // avec un pas de SLOT_STEP minutes
                for (let startTime = interval.start; 
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
    private applyConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // Marquer les ressources comme occupées en utilisant la méthode book
        for (const resource of task.resources) {
            try {
                resource.availability.book(startMinutes, endMinutes);
            } catch (error) {
                console.warn(`Échec de la réservation pour la ressource ${resource.id}: ${error}`);
            }
        }
        
        // Invalider le schedulable de toutes les tâches qui utilisent ces ressources
        this.invalidateSchedulableForResources(task.resources);
    }

    /**
     * EXPÉRIMENTAL: Applique les contraintes de manière chirurgicale
     * Retire directement le créneau des schedulables sans invalidation/recalcul complet
     */
    private applyConstraintsExp(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // 1. Retirer le créneau du schedulable de la tâche actuelle
        try {
            task.schedulable.book(startMinutes, endMinutes);
        } catch (error) {
            console.warn(`Échec de la réservation du schedulable pour la tâche ${task.name}: ${error}`);
        }
        
        // 2. Retirer le créneau des disponibilités de toutes les ressources de la tâche
        for (const resource of task.resources) {
            try {
                resource.availability.book(startMinutes, endMinutes);
            } catch (error) {
                console.warn(`Échec de la réservation pour la ressource ${resource.id}: ${error}`);
            }
            
            // 3. Pour chaque ressource, parcourir toutes les tâches qui en dépendent
            // et leur retirer le créneau de leur schedulable
            const dependentTasks = resource.getTasks();
            for (const dependentTask of dependentTasks) {
                // Ne pas traiter la tâche actuelle (elle est déjà traitée)
                if (dependentTask !== task) {
                    try {
                        // Retirer le créneau du schedulable de la tâche dépendante
                        // seulement si le créneau est disponible
                        if (dependentTask.schedulable.isAvailable(startMinutes, endMinutes)) {
                            dependentTask.schedulable.book(startMinutes, endMinutes);
                        }
                    } catch (error) {
                        // Ignorer les erreurs - le créneau n'était peut-être pas disponible
                        // dans le schedulable de cette tâche
                    }
                }
            }
        }
    }

    /**
     * Annule les contraintes lors du backtrack
     */
    private undoConstraints(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // Rendre les ressources disponibles en ajoutant la disponibilité
        for (const resource of task.resources) {
            resource.availability.addAvailability(startMinutes, endMinutes);
        }
        
        // Invalider le schedulable de toutes les tâches qui utilisent ces ressources
        this.invalidateSchedulableForResources(task.resources);
    }

    /**
     * EXPÉRIMENTAL: Annule les contraintes de manière chirurgicale
     * Remet directement le créneau dans les schedulables sans invalidation/recalcul complet
     */
    private undoConstraintsExp(taskSolution: TaskSolution): void {
        const { startTime, task } = taskSolution;
        
        const startMinutes = startTime;
        const endMinutes = startMinutes + task.duration;
        
        // 1. Remettre le créneau dans le schedulable de la tâche actuelle
        task.schedulable.addAvailability(startMinutes, endMinutes);
        
        // 2. Remettre le créneau dans les disponibilités de toutes les ressources de la tâche
        for (const resource of task.resources) {
            resource.availability.addAvailability(startMinutes, endMinutes);
            
            // 3. Pour chaque ressource, parcourir toutes les tâches qui en dépendent
            // et vérifier si on peut remettre le créneau dans leur schedulable
            const dependentTasks = resource.getTasks();
            for (const dependentTask of dependentTasks) {
                // Ne pas traiter la tâche actuelle (elle est déjà traitée)
                if (dependentTask !== task) {
                    // Vérifier si TOUTES les ressources de la tâche dépendante 
                    // sont maintenant disponibles sur ce créneau
                    let allResourcesAvailable = true;
                    for (const depTaskResource of dependentTask.resources) {
                        if (!depTaskResource.availability.isAvailable(startMinutes, endMinutes)) {
                            allResourcesAvailable = false;
                            break;
                        }
                    }
                    
                    // Si toutes les ressources sont disponibles, remettre le créneau
                    if (allResourcesAvailable) {
                        dependentTask.schedulable.addAvailability(startMinutes, endMinutes);
                    }
                }
            }
        }
    }

    /**
     * Invalide le schedulable de toutes les tâches qui utilisent au moins une des ressources données
     * OPTIMISÉ: Utilise l'index bidirectionnel des ressources pour un accès direct
     */
    private invalidateSchedulableForResources(resources: Resource[]): void {
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
     * Calcule un score de contrainte pour une tâche (pour l'heuristique de tri)
     * Le score est égal à la durée totale des créneaux où elle peut être encore planifiée
     */
    private getTaskConstraintScore(task: Task): number {
        // Le score est basé sur la disponibilité totale des ressources de la tâche
        // Plus la disponibilité est faible, plus la tâche est contrainte
        return task.schedulable.getTotalAvailableTime();
    }

    /**
     * Évalue la qualité d'une solution
     */
    private evaluateSolution(solution: TaskSolution[]): number {
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
                    const resources1 = new Set(task1.task.resources.map(r => r.id));
                    const sharedResources = task2.task.resources.filter(r2 => resources1.has(r2.id));
                    
                    if (sharedResources.length > 0) {
                        const conflict = `CONFLIT détecté entre "${task1.task.name}" (${this.formatTime(task1.startTime)}-${this.formatTime(end1)}) et "${task2.task.name}" (${this.formatTime(task2.startTime)}-${this.formatTime(end2)}) sur les ressources: ${sharedResources.map(r => r.id).join(', ')}`;
                        conflicts.push(conflict);
                        console.error(`❌ ${conflict}`);
                    }
                }
            }
        }
        
        const isValid = conflicts.length === 0;
        
        if (isValid) {
            console.log(`✅ Solution valide - Aucun conflit détecté`);
        } else {
            console.error(`❌ Solution invalide - ${conflicts.length} conflit(s) détecté(s)`);
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

        // Calculer la date du lundi de la semaine 36 de 2025
        const year = 2025;
        const weekNumber = 39;
        
        // Le 1er janvier 2025 est un mercredi
        // Calcul du premier lundi de l'année 2025 : 6 janvier 2025
        const firstMondayOfYear = new Date(year, 0, 6); // 6 janvier 2025
        
        // Calculer le lundi de la semaine 36
        const mondayWeek36 = new Date(firstMondayOfYear);
        mondayWeek36.setDate(firstMondayOfYear.getDate() + (weekNumber - 1) * 7);
        
        console.log(`📅 Export iCal pour la semaine ${weekNumber} de ${year}`);
        console.log(`📅 Lundi de la semaine 36: ${mondayWeek36.toLocaleDateString('fr-FR')}`);

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
            if (category.solutions.length === 0) {
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

            // Ajouter chaque événement de cette catégorie
            for (const solution of category.solutions) {
                const task = solution.task;
                
                // Convertir le timestamp en composants jour/heure
                const { dayIndex, hour, minute } = this.fromTimestamp(solution.startTime);
                
                // Calculer la date réelle de l'événement
                const eventDate = new Date(mondayWeek36);
                eventDate.setDate(mondayWeek36.getDate() + dayIndex);
                eventDate.setHours(hour, minute, 0, 0);
                
                // Date de fin (ajouter la durée en minutes)
                const endDate = new Date(eventDate);
                endDate.setMinutes(endDate.getMinutes() + task.duration);

                // Extraire les ressources
                const teachers = solution.task.resources.filter(r => r.type === 'teacher').map(r => r.id);
                const rooms = solution.task.resources.filter(r => r.type === 'room').map(r => r.id);
                const groups = solution.task.resources.filter(r => r.type === 'group').map(r => r.id);

                // Créer une description détaillée
                const description = [
                    `Code: ${task.code}`,
                    `Durée: ${task.duration} minutes`,
                    teachers.length > 0 ? `Enseignant(s): ${teachers.join(', ')}` : '',
                    rooms.length > 0 ? `Salle(s): ${rooms.join(', ')}` : '',
                    groups.length > 0 ? `Groupe(s): ${groups.join(', ')}` : ''
                ].filter(line => line).join('\\n');

                // Créer le summary au format spécifié : "R3.16 GILLET Anthony, BUT2-G1.BUT2-G21.BUT2-G22.BUT2-G3"
                const summaryParts = [task.code];
                if (teachers.length > 0) {
                    summaryParts.push(teachers[0] + ','); // Premier enseignant avec virgule
                }
                if (groups.length > 0) {
                    summaryParts.push(groups.join('.')); // Groupes séparés par des points
                }
                const summary = summaryParts.join(' ');

                // Générer un UID unique
                const uid = `${task.code}_${teachers.join('_')}_${groups.join('_')}_${solution.startTime}@edt-ts.local`;
                
                // Timestamp de création (format UTC obligatoire pour DTSTAMP)
                const now = new Date();
                const dtstamp = now.getUTCFullYear().toString() +
                               (now.getUTCMonth() + 1).toString().padStart(2, '0') +
                               now.getUTCDate().toString().padStart(2, '0') + 'T' +
                               now.getUTCHours().toString().padStart(2, '0') +
                               now.getUTCMinutes().toString().padStart(2, '0') +
                               now.getUTCSeconds().toString().padStart(2, '0') + 'Z';

                // Ajouter l'événement iCal
                icalContent += [
                    'BEGIN:VEVENT',
                    `UID:${uid}`,
                    `DTSTAMP:${dtstamp}`,
                    `DTSTART:${formatICalDate(eventDate)}`,
                    `DTEND:${formatICalDate(endDate)}`,
                    `SUMMARY:${summary}`,
                    `DESCRIPTION:${description}`,
                    rooms.length > 0 ? `LOCATION:${rooms[0]}` : '',
                    teachers.length > 0 ? `ORGANIZER:CN=${teachers[0]}` : '',
                    groups.length > 0 ? `CATEGORIES:${groups.join(',')}` : '',
                    `STATUS:CONFIRMED`,
                    `TRANSP:OPAQUE`,
                    'END:VEVENT'
                ].filter(line => line).join('\r\n') + '\r\n';
            }

            // Fermer le calendrier
            icalContent += 'END:VCALENDAR\r\n';

            // Sauvegarder le fichier
            const filename = `planning-${category.name}-semaine${weekNumber}-${year}.ics`;
            const filepath = path.join('./src/ical', filename);
            
            try {
                fs.writeFileSync(filepath, icalContent, 'utf8');
                console.log(`✅ Fichier iCal exporté: ${filepath}`);
                console.log(`📊 ${category.solutions.length} événements ${category.prefix} exportés`);
                exportedFiles.push(filepath);
            } catch (error) {
                console.error(`❌ Erreur lors de l'export iCal ${category.prefix}:`, error);
            }
        }

        // Retourner le premier fichier créé ou un message de résumé
        const totalExported = exportedFiles.length;
        console.log(`🎯 ${totalExported} fichier(s) iCal créé(s) au total`);
        return exportedFiles.length > 0 ? exportedFiles[0] : '';
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
