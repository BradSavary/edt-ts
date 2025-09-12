import { Resource } from './resource';
import { AvailabilityManager } from './bookable';
import type { AvailableSlot } from './bookable';

/**
 * Statut d'une tâche dans le processus de planification
 */
const TaskStatus = {
  PENDING: 'pending',      // En attente de planification
  SCHEDULED: 'scheduled',  // Planifiée avec créneaux assignés
  COMPLETED: 'completed',  // Terminée
  CANCELLED: 'cancelled',   // Annulée
  FAILED: 'failed'       // Échec de la planification
} as const;

type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

/**
 * Résultat de planification d'une tâche
 */
interface TaskScheduleResult {
  success: boolean;
  scheduledSlot?: AvailableSlot;
  message?: string;
}

/**
 * Classe représentant une tâche à planifier
 * Une tâche a une durée et peut nécessiter plusieurs ressources simultanément
 * Elle peut aussi dépendre d'autres tâches (ordre de planification)
 */
class Task {
  public readonly id: string;
  public readonly name: string;
  public readonly duration: number;
  public readonly resources: Resource[];
  private status: TaskStatus;
  private scheduledSlot?: AvailableSlot;
  private _schedulable: AvailabilityManager | null = null;
  private dependsOn: Task | null = null;
  private dependentTasks: Task[] = [];

  constructor(id: string, name: string, duration: number, resources: Resource[] = []) {
    if (duration <= 0) {
      throw new Error('La durée de la tâche doit être positive');
    }
    
    this.id = id;
    this.name = name;
    this.duration = duration;
    this.resources = [...resources]; // Copie défensive
    this.status = TaskStatus.PENDING;
  }

  /**
   * Retourne l'intersection des disponibilités de toutes les ressources requises
   * Cette propriété est calculée à la demande et mise en cache
   */
  get schedulable(): AvailabilityManager {
    if (this._schedulable === null) {
      this._schedulable = this._computeSchedulable();
    }
    return this._schedulable;
  }

  /**
   * Invalide le cache des disponibilités communes
   * À appeler quand les ressources ou leurs disponibilités changent
   */
  invalidateSchedulable(): void {
    this._schedulable = null;
  }

  /**
   * Calcule l'intersection des disponibilités de toutes les ressources
   */
  private _computeSchedulable(): AvailabilityManager {
    if (this.resources.length === 0) {
      // Aucune ressource requise, créer un gestionnaire vide
      return new AvailabilityManager();
    }

    // Commencer par les disponibilités de la première ressource
    let result = this.resources[0].availability;
    
    // Calculer l'intersection avec chaque ressource suivante
    for (let i = 1; i < this.resources.length; i++) {
      result = result.intersect(this.resources[i].availability);
    }

    return result;
  }

  /**
   * Retourne le statut actuel de la tâche
   */
  getStatus(): TaskStatus {
    return this.status;
  }

  /**
   * Retourne le créneau planifié (si la tâche est planifiée)
   */
  getScheduledSlot(): AvailableSlot | undefined {
    return this.scheduledSlot;
  }

  /**
   * Définit une dépendance : cette tâche ne peut pas être planifiée avant la tâche spécifiée
   */
  setDependsOn(task: Task): void {
    if (task === this) {
      throw new Error('Une tâche ne peut pas dépendre d\'elle-même');
    }

    // Vérifier qu'il n'y a pas de dépendance circulaire
    if (this.wouldCreateCircularDependency(task)) {
      throw new Error('Cette dépendance créerait une dépendance circulaire');
    }

    // Supprimer l'ancienne dépendance si elle existe
    if (this.dependsOn) {
      this.dependsOn.removeDependentTask(this);
    }

    // Définir la nouvelle dépendance
    this.dependsOn = task;
    task.addDependentTask(this);
  } 

  /**
   * Supprime la dépendance de cette tâche
   */
  removeDependency(): void {
    if (this.dependsOn) {
      this.dependsOn.removeDependentTask(this);
      this.dependsOn = null;
    }
  }

  /**
   * Retourne la tâche dont cette tâche dépend
   */
  getDependsOn(): Task | null {
    return this.dependsOn;
  }

  /**
   * Retourne les tâches qui dépendent de cette tâche
   */
  getDependentTasks(): Task[] {
    return [...this.dependentTasks]; // Copie défensive
  }

  /**
   * Ajoute une tâche dépendante (méthode interne)
   */
  private addDependentTask(task: Task): void {
    if (!this.dependentTasks.includes(task)) {
      this.dependentTasks.push(task);
    }
  }

  /**
   * Supprime une tâche dépendante (méthode interne)
   */
  private removeDependentTask(task: Task): void {
    const index = this.dependentTasks.indexOf(task);
    if (index !== -1) {
      this.dependentTasks.splice(index, 1);
    }
  }

  /**
   * Vérifie si définir une dépendance créerait une dépendance circulaire
   */
  private wouldCreateCircularDependency(task: Task): boolean {
    // Vérification récursive : si 'task' dépend directement ou indirectement de 'this'
    const visited = new Set<Task>();
    
    const checkDependency = (currentTask: Task): boolean => {
      if (visited.has(currentTask)) {
        return false; // Déjà visité, pas de cycle
      }
      
      if (currentTask === this) {
        return true; // Cycle détecté
      }
      
      visited.add(currentTask);
      
      // Vérifier récursivement toutes les dépendances
      for (const dependent of currentTask.dependentTasks) {
        if (checkDependency(dependent)) {
          return true;
        }
      }
      
      return false;
    };
    
    return checkDependency(task);
  }

  /**
   * Vérifie si la tâche peut être planifiée (toutes ses dépendances sont terminées)
   */
  canBeScheduled(): boolean {
    // Vérifier le statut de base
    if (this.status !== TaskStatus.PENDING) {
      return false;
    }

    // Vérifier que la tâche dont elle dépend est terminée
    if (this.dependsOn && this.dependsOn.status !== TaskStatus.COMPLETED) {
      return false;
    }

    return true;
  }

  /**
   * Trouve le moment le plus tôt où la tâche peut être planifiée
   * en tenant compte des dépendances
   */
  getEarliestStartTime(): number {
    if (!this.dependsOn) {
      return 0; // Aucune dépendance, peut commencer immédiatement
    }

    const dependencySlot = this.dependsOn.getScheduledSlot();
    if (!dependencySlot) {
      // La tâche dont elle dépend n'est pas encore planifiée
      throw new Error(`La tâche ${this.dependsOn.id} doit être planifiée avant ${this.id}`);
    }

    return dependencySlot.end; // Peut commencer après la fin de la tâche dont elle dépend
  }

  /**
   * Vérifie si la tâche peut être planifiée à un moment donné
   * Toutes les ressources requises doivent être disponibles simultanément
   */
  canBeScheduledAt(start: number): boolean {
    const end = start + this.duration;
    
    return this.resources.every(resource => 
      resource.isAvailable(start, end)
    );
  }

  /**
   * Trouve le prochain créneau où toutes les ressources requises sont disponibles
   * en tenant compte des dépendances
   */
  findNextAvailableSlot(afterTime: number = 0): AvailableSlot | null {
    // Vérifier que la tâche peut être planifiée
    if (!this.canBeScheduled()) {
      return null;
    }

    // Tenir compte du moment le plus tôt possible selon les dépendances
    const earliestStart = Math.max(afterTime, this.getEarliestStartTime());

    if (this.resources.length === 0) {
      // Aucune ressource requise, la tâche peut être planifiée immédiatement
      return {
        start: earliestStart,
        end: earliestStart + this.duration
      };
    }

    // Utiliser la propriété schedulable pour l'intersection des disponibilités
    return this.schedulable.findNextAvailableSlot(this.duration, earliestStart);
  }

  /**
   * Trouve tous les créneaux possibles où la tâche peut être planifiée
   * en tenant compte des dépendances
   */
  findAllAvailableSlots(): AvailableSlot[] {
    // Vérifier que la tâche peut être planifiée
    if (!this.canBeScheduled()) {
      return [];
    }

    const earliestStart = this.getEarliestStartTime();

    if (this.resources.length === 0) {
      // Aucune ressource requise, retourner un slot théorique après les dépendances
      return [{
        start: earliestStart,
        end: earliestStart + this.duration,
        duration: this.duration
      }];
    }

    // Utiliser la propriété schedulable et filtrer les créneaux avant l'heure la plus tôt
    const allSlots = this.schedulable.findAvailableSlots(this.duration);
    return allSlots.filter(slot => slot.start >= earliestStart);
  }

  /**
   * Planifie la tâche à un moment donné
   * Réserve automatiquement les ressources nécessaires
   */
  scheduleAt(start: number): TaskScheduleResult {
    // Vérifier que la tâche peut être planifiée (statut et dépendances)
    if (!this.canBeScheduled()) {
      return {
        success: false,
        message: `La tâche ne peut pas être planifiée (statut: ${this.status}, dépendances non satisfaites)`
      };
    }

    // Vérifier que le moment de planification respecte les dépendances
    const earliestStart = this.getEarliestStartTime();
    if (start < earliestStart) {
      return {
        success: false,
        message: `La tâche ne peut pas commencer avant ${earliestStart} (dépendance non terminée)`
      };
    }

    const end = start + this.duration;

    // Vérifier que toutes les ressources sont disponibles
    if (!this.canBeScheduledAt(start)) {
      return {
        success: false,
        message: 'Une ou plusieurs ressources ne sont pas disponibles à ce moment'
      };
    }

    try {
      // Réserver toutes les ressources
      this.resources.forEach(resource => {
        resource.book(start, end);
      });

      // Marquer la tâche comme planifiée
      this.scheduledSlot = { start, end };
      this.status = TaskStatus.SCHEDULED;

      return {
        success: true,
        scheduledSlot: this.scheduledSlot,
        message: 'Tâche planifiée avec succès'
      };

    } catch (error) {
      // En cas d'erreur, annuler les réservations déjà faites
      this.rollbackReservations(start, end);
      
      return {
        success: false,
        message: `Erreur lors de la planification: ${error instanceof Error ? error.message : 'Erreur inconnue'}`
      };
    }
  }

  /**
   * Planifie automatiquement la tâche au prochain créneau disponible
   */
  scheduleNext(afterTime: number = 0): TaskScheduleResult {
    const nextSlot = this.findNextAvailableSlot(afterTime);
    
    if (!nextSlot) {
      return {
        success: false,
        message: 'Aucun créneau disponible trouvé'
      };
    }

    return this.scheduleAt(nextSlot.start);
  }

  /**
   * Annule la planification de la tâche
   * Libère les ressources si elles étaient réservées
   */
  cancel(): void {
    if (this.status === TaskStatus.SCHEDULED && this.scheduledSlot) {
      // Libérer les ressources (ajouter les créneaux aux disponibilités)
      this.resources.forEach(resource => {
        resource.addAvailability(this.scheduledSlot!.start, this.scheduledSlot!.end);
      });
    }

    this.status = TaskStatus.CANCELLED;
    this.scheduledSlot = undefined;
  }

  /**
   * Marque la tâche comme terminée
   */
  complete(): void {
    if (this.status !== TaskStatus.SCHEDULED) {
      throw new Error('Seules les tâches planifiées peuvent être marquées comme terminées');
    }

    this.status = TaskStatus.COMPLETED;
  }

  /**
   * Annule les réservations en cas d'erreur lors de la planification
   */
  private rollbackReservations(start: number, end: number): void {
    this.resources.forEach(resource => {
      try {
        resource.addAvailability(start, end);
      } catch (error) {
        // Ignorer les erreurs de rollback pour éviter les erreurs en cascade
        console.warn(`Erreur lors du rollback pour la ressource ${resource.id}:`, error);
      }
    });
  }

  /**
   * Ajoute une ressource aux exigences de la tâche
   * Possible uniquement si la tâche n'est pas encore planifiée
   */
  addResource(resource: Resource): void {
    if (this.status !== TaskStatus.PENDING) {
      throw new Error('Impossible de modifier les ressources d\'une tâche déjà planifiée');
    }

    if (!this.resources.includes(resource)) {
      this.resources.push(resource);
    }
  }

  /**
   * Supprime une ressource des exigences de la tâche
   * Possible uniquement si la tâche n'est pas encore planifiée
   */
  removeResource(resource: Resource): void {
    if (this.status !== TaskStatus.PENDING) {
      throw new Error('Impossible de modifier les ressources d\'une tâche déjà planifiée');
    }

    const index = this.resources.indexOf(resource);
    if (index !== -1) {
      this.resources.splice(index, 1);
    }
  }

  /**
   * Retourne toutes les tâches qui dépendent directement ou indirectement de cette tâche
   */
  getAllDependentTasks(): Task[] {
    const allDependents = new Set<Task>();
    const visited = new Set<Task>();

    const collectDependents = (task: Task) => {
      if (visited.has(task)) return;
      visited.add(task);

      for (const dependent of task.dependentTasks) {
        allDependents.add(dependent);
        collectDependents(dependent);
      }
    };

    collectDependents(this);
    return Array.from(allDependents);
  }

  /**
   * Retourne la chaîne complète des dépendances (tâches dont cette tâche dépend)
   */
  getDependencyChain(): Task[] {
    const chain: Task[] = [];
    let current = this.dependsOn;

    while (current) {
      chain.unshift(current); // Ajouter au début pour avoir l'ordre correct
      current = current.dependsOn;
    }

    return chain;
  }

  /**
   * Vérifie si cette tâche bloque d'autres tâches
   */
  hasBlockedTasks(): boolean {
    return this.dependentTasks.length > 0 && this.status !== TaskStatus.COMPLETED;
  }

  /**
   * Retourne les tâches qui sont actuellement bloquées par cette tâche
   */
  getBlockedTasks(): Task[] {
    if (this.status === TaskStatus.COMPLETED) {
      return [];
    }
    return this.getAllDependentTasks().filter(task => task.status === TaskStatus.PENDING);
  }


  /**
   * Retourne une représentation textuelle de la tâche
   */
  toString(): string {
    const resourceIds = this.resources.map(r => r.id).join(', ');
    const scheduledInfo = this.scheduledSlot 
      ? ` [${this.scheduledSlot.start}-${this.scheduledSlot.end}]`
      : '';
    
    const dependsOnInfo = this.dependsOn ? ` dépend de: ${this.dependsOn.id}` : '';
    const dependentsInfo = this.dependentTasks.length > 0 
      ? ` bloque: [${this.dependentTasks.map(t => t.id).join(', ')}]` 
      : '';
    
    return `Task(${this.id}: ${this.name}, durée: ${this.duration}, ressources: [${resourceIds}], statut: ${this.status})${scheduledInfo}${dependsOnInfo}${dependentsInfo}`;
  }
}

export { Task, TaskStatus };
export type { TaskScheduleResult };
