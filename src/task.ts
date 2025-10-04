
import { Resource, ResourceType } from './resource';
import { AvailabilityManager } from './bookable';
import type { AvailableSlot } from './bookable';
import type { CourseTaskData } from './lib/loader';

// ...définitions TaskStatus, TaskScheduleResult, etc...

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
  public readonly code: string;
  public readonly name: string;
  public readonly duration: number;
  public readonly type: string;
  public readonly week: number;
  public readonly semester: number;
  public readonly level: number;
  public readonly groups: string[] = [];
  // Ressources actuellement appliquées à la tâche (une combinaison spécifique)
  private _appliedResources: Resource[] | null = null;
  // Ressources applicables à la tâche (ressources alternatives incluses)
  public readonly resources: { [K in ResourceType]: Resource[][] };
  public readonly availableRooms: Resource[]; // Toutes les salles possibles pour cette tâche
  private status: TaskStatus;
  private scheduledSlot?: AvailableSlot;
  private _schedulable: AvailabilityManager | null = null;
  private dependsOn: Task | null = null;
  private dependentTasks: Task[] = [];

  constructor(id: string, courseData: CourseTaskData, resources: Resource[] = [], availableRooms: Resource[] = []) {
    if (courseData.duration <= 0) {
      throw new Error('La durée de la tâche doit être positive');
    }
    this.id = id;
    this.code = courseData.code;
    this.name = courseData.name;
    this.duration = courseData.duration;
    this.type = courseData.type;
    this.week = courseData.week;
    this.semester = courseData.semester;
    this.level = courseData.level;
 
    // Initialisation de l'objet resources par type
    // Les resources sont indexées par type.
    // Chaque type de ressource est un tableau de tableaux de ressources alternatives.
    // Exemple: { TEACHER: [[ProfA], [ProfB, ProfC]], ROOM: [[R01, R02]], GROUP: [[G1]] }
    // Ici la task a besoin de ProfA et (ProfB ou ProfC) et (R01 ou R02) et G1
    // Les ressources applicales à la tâche seraient:
    //     - ProfA, ProfB, R01, G1
    //     - ProfA, ProfB, R02, G1
    //     - ProfA, ProfC, R01, G1
    //     - ProfA, ProfC, R02, G1
    this.resources = {
      [ResourceType.TEACHER]: [],
      [ResourceType.ROOM]: [],
      [ResourceType.GROUP]: []
    };
    // Répartition des ressources dans l'objet par type
    resources.forEach(resource => {
      this.resources[resource.type].push([resource]);
      resource.addTask(this);
    });

    this.availableRooms = [...availableRooms]; // Copie défensive de toutes les salles possibles
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
   * Tableau contenant l'union de toutes les ressources actuellement appliquée à la tâche
   */
  get appliedResources(): Resource[] {
    return (this._appliedResources || []) as Resource[];
  }


  /**
   * Définit les ressources appliquées à la tâche
   * @param resources - Les ressources à appliquer
   */
  set appliedResources(resources: Resource[] | null) {
    this._appliedResources = resources;
    this.invalidateSchedulable();
  }


  /**
   * Invalide le cache des disponibilités communes
   * À appeler quand les ressources ou leurs disponibilités changent
   */
  invalidateSchedulable(): void {
    this._schedulable = null;
  }

  /**
   * Retourne toutes les ressources de la tâche sous forme de tableau
   * Retourne les ressources actuellement appliquées (si définies)
   */
  getAllResources(): Resource[] {
    return this.appliedResources;
  }

 /**
   * Retourne toutes les combinaisons applicables de ressources pour la tâche.
   * Chaque combinaison est un tableau contenant une ressource de chaque groupe alternatif.
   * Exemple :
   *   { TEACHER: [[ProfA], [ProfB, ProfC]], ROOM: [[R01, R02]], GROUP: [[G1]] }
   *   => [ [ProfA, ProfB, R01, G1], [ProfA, ProfB, R02, G1], [ProfA, ProfC, R01, G1], [ProfA, ProfC, R02, G1] ]
   */
  getApplicableResources(): Resource[][] {
    // Récupère tous les groupes alternatifs de tous les types
    const allGroups: Resource[][] = [
      ...this.resources[ResourceType.TEACHER],
      ...this.resources[ResourceType.ROOM],
      ...this.resources[ResourceType.GROUP]
    ];
    
    // Si aucun groupe, rien à appliquer
    if (allGroups.length === 0) return [];

    // Produit cartésien : sélectionne une ressource de chaque groupe alternatif
    function cartesian(arrays: Resource[][]): Resource[][] {
      return arrays.reduce<Resource[][]>((acc, curr) => {
        if (acc.length === 0) {
          // Premier groupe : chaque ressource devient une combinaison
          return curr.map(resource => [resource]);
        }
        const result: Resource[][] = [];
        for (const combination of acc) {
          for (const resource of curr) {
            result.push([...combination, resource]);
          }
        }
        return result;
      }, []);
    }

    return cartesian(allGroups);
  }

  /**
   * Retourne une combinaison aléatoire de ressources applicables
   * Utile pour les algorithmes stochastiques
   */
  getRandomApplicableResources(): Resource[] | null {
    const allCombinations = this.getApplicableResources();
    if (allCombinations.length === 0) {
      return null;
    }
    // Retourne une combinaison aléatoire
    const randomIndex = Math.floor(Math.random() * allCombinations.length);
    return allCombinations[randomIndex];
  }

  /**
 * Vérifie que le schedulable de la tâche est inclus dans les disponibilités de chacune de ses ressources
 * Retourne true si le schedulable est inclus dans chaque ressource
 */
  isSchedulableConsistentWithResources(): boolean {
    const schedulable = this.schedulable;
    for (const resource of this.getAllResources()) {
      if (!schedulable.isFullyContainedIn(resource.availability)) {
        schedulable.displaySchedule();
        resource.availability.displaySchedule();
        console.log(`⚠️ Incohérence détectée pour la tâche '${this.name}' (${this.code}) avec la ressource '${resource.id}' (${resource.type})`);
        return false;
      }
    }
    return true;
  }


  /**
   * Calcule l'intersection des disponibilités de toutes les ressources
   */
  private _computeSchedulable(): AvailabilityManager {
    const allResources = this.getAllResources();
    if (allResources.length === 0) {
      // Aucune ressource requise, créer un gestionnaire vide
      return new AvailabilityManager();
    }

    // Commencer par une copie des disponibilités de la première ressource
    let result = allResources[0].availability.copy();
    // Calculer l'intersection avec chaque ressource suivante
    for (let i = 1; i < allResources.length; i++) {
      result = result.intersect(allResources[i].availability);
      if (result.isEmpty()) {
        break;
      }
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
   * Retourne les groupes d'étudiants pour cette tâche
   */
  getGroups(): string[] {
    return this.resources[ResourceType.GROUP]
      .map(arr => arr.join(', '));
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

  hasDependentTasks(): boolean {
    return this.dependentTasks.length > 0;
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
    
    return this.appliedResources.every(resource => 
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

    if (this.appliedResources.length === 0) {
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

    if (this.appliedResources.length === 0) {
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
      this.appliedResources.forEach(resource => {
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
      this.appliedResources.forEach(resource => {
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
    this.appliedResources.forEach(resource => {
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

    // Ajoute la ressource comme un nouveau groupe alternatif (tableau contenant la ressource)
    const arr = this.resources[resource.type];
    // Vérifie si la ressource existe déjà dans un groupe
    const exists = arr.some(group => group.includes(resource));
    if (!exists) {
      arr.push([resource]);
      resource.addTask(this);
      this.invalidateSchedulable();
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

    const arr = this.resources[resource.type];
    // Trouve le groupe contenant la ressource et la retire
    for (let i = 0; i < arr.length; i++) {
      const group = arr[i];
      const idx = group.indexOf(resource);
      if (idx !== -1) {
        group.splice(idx, 1);
        // Si le groupe est vide, on le retire complètement
        if (group.length === 0) {
          arr.splice(i, 1);
          i--;
        }
        resource.removeTask(this);
        this.invalidateSchedulable();
        break;
      }
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
   * Retourne toutes les salles disponibles pour cette tâche
   */
  getAvailableRooms(): Resource[] {
    return [...this.availableRooms]; // Copie défensive
  }

  /**
   * Retourne la salle actuellement assignée à cette tâche (depuis resources)
   */
  getCurrentRoom(): Resource | null {
    return this.appliedResources.find(r => r.type === ResourceType.ROOM) || null;
  }

  /**
   * Change la salle assignée à cette tâche
   * Possible uniquement si la tâche n'est pas encore planifiée et que la nouvelle salle est dans les salles disponibles
   */
  changeRoom(newRoom: Resource): boolean {
    if (this.status !== TaskStatus.PENDING) {
      console.warn('Impossible de changer la salle d\'une tâche déjà planifiée');
      return false;
    }

    // Vérifier que la nouvelle salle est dans les salles disponibles
    if (!this.availableRooms.some(room => room.id === newRoom.id)) {
      console.warn(`La salle '${newRoom.id}' n'est pas dans les salles disponibles pour cette tâche`);
      return false;
    }

    // Supprimer l'ancienne salle des ressources
    const currentRoom = this.getCurrentRoom();
    if (currentRoom) {
      this.removeResource(currentRoom);
    }

    // Ajouter la nouvelle salle
    this.addResource(newRoom);
    
    // Log commenté pour réduire la verbosité - décommentez si nécessaire pour debug
    // console.log(`✅ Salle changée de '${currentRoom?.id || 'aucune'}' vers '${newRoom.id}' pour la tâche ${this.id}`);
    return true;
  }

  /**
   * Retourne les salles alternatives (toutes sauf celle actuellement assignée)
   */
  getAlternativeRooms(): Resource[] {
    const currentRoom = this.getCurrentRoom();
    if (!currentRoom) {
      return this.getAvailableRooms();
    }
    return this.availableRooms.filter(room => room.id !== currentRoom.id);
  }

   /**
   * Retourne la première ressource de type TEACHER présente dans resources, ou null si aucune
   */
  getTeacherResource(): Resource | null {
    return this.appliedResources.find(r => r.type === ResourceType.TEACHER) || null;
  }


  /**
   * Retourne une représentation textuelle de la tâche
   */
  toString(): string {
    const resourceIds = this.appliedResources.map(r => r.id).join(', ');
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
