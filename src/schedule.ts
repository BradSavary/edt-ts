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
    private maxIterations: number = 1000000; // Limite de sécurité augmentée
    private currentIterations: number = 0;
    private timeoutMs: number = 0; // Pas de limite de temps
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
     * CORRIGÉ: Utilise maintenant les vrais créneaux disponibles de task.schedulable
     */
    private generatePossibleSlots(task: Task): Array<{startTime: number, resources: Resource[]}> {
        const slots: Array<{startTime: number, resources: Resource[]}> = [];
        
        // CORRECTION: Utiliser les vrais créneaux disponibles de la tâche
        const availableIntervals = task.schedulable.getAvailableIntervals();
        
        for (const interval of availableIntervals) {
            const intervalDuration = interval.end - interval.start;
            
            // Vérifier si l'intervalle est assez grand pour la tâche
            if (intervalDuration >= task.duration) {
                // Créer un créneau pour cet intervalle
                const slot = {
                    startTime: interval.start, // Utiliser directement le timestamp en minutes
                    resources: task.resources   // Toutes les ressources sont déjà validées dans schedulable
                };
                
                slots.push(slot);
            }
        }
        
        return slots;
    }

    /**
     * Trouve les ressources disponibles pour une tâche à un créneau donné
     */
    private findAvailableResources(task: Task, startTime: number): Resource[] {
        const availableResources: Resource[] = [];
        
        // Convertir le créneau en minutes depuis le début de la semaine
        const startMinutes = this.slotToMinutes(startTime);
        const endMinutes = startMinutes + task.duration; // task.duration est déjà en minutes
        
        // Vérifier chaque ressource requise par la tâche
        for (const requiredResource of task.resources) {
            // Trouver la ressource correspondante dans notre liste de ressources
            const resource = this.resources.find(r => r.id === requiredResource.id);
            
            if (resource) {
                // Vérification de la disponibilité sur la durée de la tâche
                // en utilisant l'état COURANT de la ressource (après réservations)
                if (resource.availability.isAvailable(startMinutes, endMinutes)) {
                    availableResources.push(resource);
                }
            }
        }
        
        // Ne retourner que si TOUTES les ressources requises sont disponibles
        if (availableResources.length === task.resources.length) {
            return availableResources;
        } else {
            return []; // Si une ressource manque, on ne peut pas faire cette affectation
        }
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
     * SIMPLIFIÉ: task.schedulable a déjà validé les contraintes, on vérifie juste les conflits
     */
    private isSlotValid(task: Task, slot: {startTime: number, resources: Resource[]}): boolean {
        // Calculer la fin du créneau
        const endTime = slot.startTime + task.duration;
        
        // Vérifier qu'aucune ressource n'est déjà occupée par une tâche planifiée
        for (const existingSolution of this.solution) {
            const existingEnd = existingSolution.startTime + existingSolution.task.duration;
            
            // Vérifier s'il y a chevauchement temporel
            const hasTimeOverlap = (slot.startTime < existingEnd && endTime > existingSolution.startTime);
            
            if (hasTimeOverlap) {
                // Vérifier s'il y a des ressources partagées
                const sharedResources = slot.resources.filter(r => 
                    existingSolution.assignedResources.some(er => er.id === r.id)
                );
                
                if (sharedResources.length > 0) {
                    return false;
                }
            }
        }
        
        return true;
        
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
            try {
                resource.availability.book(startMinutes, endMinutes);
            } catch (error) {
                // Si la réservation échoue, annuler les réservations déjà faites
                console.warn(`Échec de la réservation pour la ressource ${resource.id}: ${error}`);
                // On pourrait implémenter un rollback ici si nécessaire
            }
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
        
        // Rendre les ressources disponibles en ajoutant la disponibilité
        for (const resource of assignedResources) {
            resource.availability.addAvailability(startMinutes, endMinutes);
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
        const weekNumber = 36;
        
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
                const teachers = solution.assignedResources.filter(r => r.type === 'teacher').map(r => r.id);
                const rooms = solution.assignedResources.filter(r => r.type === 'room').map(r => r.id);
                const groups = solution.assignedResources.filter(r => r.type === 'group').map(r => r.id);

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
