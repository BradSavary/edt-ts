import { AvailabilityManager } from './bookable.ts';
import type { TimeSlot, ConstraintsData } from './types.ts';

/**
 * Gestionnaire statique des contraintes de disponibilité.
 * 
 * Doit être initialisé explicitement via `ConstraintsManager.initialize(data)`
 * avant tout appel à `getAvailabilityManager()`.
 * 
 * Dans scheduler-core, l'initialisation est assurée automatiquement par Loader.
 * Dans une application browser, appellez `ConstraintsManager.initialize(data)`
 * avec les données récupérées depuis l'API.
 */
export class ConstraintsManager {
  private static constraintsData: ConstraintsData | null = null;
  private static availabilityManagers = new Map<string, AvailabilityManager>();
  private static weeklyOverrides = new Map<string, Map<number, AvailabilityManager>>();

  /**
   * Initialise le gestionnaire avec les données de contraintes.
   * Idempotent : n'a aucun effet si déjà initialisé (appeler reset() d'abord si nécessaire).
   */
  static initialize(data: ConstraintsData): void {
    if (this.constraintsData !== null) {
      return; // Déjà initialisé
    }
    this.constraintsData = data;
    this.initializeAvailabilityManagers();
  }

  /**
   * Indique si le gestionnaire a été initialisé.
   */
  static isInitialized(): boolean {
    return this.constraintsData !== null;
  }

  /**
   * Réinitialise toutes les données de contraintes (utile entre requêtes API)
   */
  static reset(): void {
    this.constraintsData = null;
    this.availabilityManagers.clear();
    this.weeklyOverrides.clear();
  }

  /**
   * Initialise tous les AvailabilityManager pour chaque ressource
   */
  private static initializeAvailabilityManagers(): void {
    if (!this.constraintsData) return;

    const defaultSlots = this.constraintsData.Default || [];

    for (const [resourceId, constraints] of Object.entries(this.constraintsData)) {
      if (resourceId === 'Default') continue;

      let defaultAvailability: AvailabilityManager;

      if (constraints === null) {
        defaultAvailability = this.createAvailabilityManagerFromSlots(defaultSlots);
      } else if (Array.isArray(constraints)) {
        defaultAvailability = this.createAvailabilityManagerFromSlots(constraints);
      } else if (typeof constraints === 'object' && constraints.default) {
        defaultAvailability = this.createAvailabilityManagerFromSlots(constraints.default);
      } else {
        defaultAvailability = this.createAvailabilityManagerFromSlots(defaultSlots);
      }

      this.availabilityManagers.set(resourceId, defaultAvailability);

      if (typeof constraints === 'object' && constraints !== null && !Array.isArray(constraints)) {
        const weeklyMap = new Map<number, AvailabilityManager>();
        
        for (const [key, slots] of Object.entries(constraints)) {
          if (key === 'default') continue;
          
          const weekMatch = key.match(/^S(\d+)$/);
          if (weekMatch && slots) {
            const weekNumber = parseInt(weekMatch[1], 10);
            const weeklyAvailability = this.createAvailabilityManagerFromSlots(slots);
            weeklyMap.set(weekNumber, weeklyAvailability);
          }
        }
        
        if (weeklyMap.size > 0) {
          this.weeklyOverrides.set(resourceId, weeklyMap);
        }
      }
    }
  }

  /**
   * Crée un AvailabilityManager à partir de créneaux de temps
   */
  private static createAvailabilityManagerFromSlots(slots: TimeSlot[]): AvailabilityManager {
    const availability = new AvailabilityManager();
    
    for (const slot of slots) {
      const days = this.parseDays(slot.days);
      
      for (const dayName of days) {
        const dayIndex = this.getDayIndex(dayName);
        const startTime = this.parseTime(slot.from);
        const endTime = this.parseTime(slot.to);
        
        const startTimestamp = dayIndex * 24 * 60 + startTime;
        const endTimestamp = dayIndex * 24 * 60 + endTime;
        
        availability.addAvailability(startTimestamp, endTimestamp);
      }
    }
    
    return availability;
  }

  /**
   * Parse une chaîne de jours en tableau de jours
   */
  private static parseDays(daysString: string): string[] {
    const dayMapping: { [key: string]: string } = {
      'lundi': 'monday',
      'mardi': 'tuesday', 
      'mercredi': 'wednesday',
      'jeudi': 'thursday',
      'jeeudi': 'thursday', // Gestion des typos
      'vendredi': 'friday',
      'samedi': 'saturday',
      'dimanche': 'sunday'
    };

    return daysString
      .split(/[,\s]+/)
      .map(day => day.trim().toLowerCase())
      .filter(day => day.length > 0)
      .map(day => dayMapping[day] || day)
      .filter(day => Object.values(dayMapping).includes(day));
  }

  /**
   * Convertit un nom de jour en index numérique
   */
  private static getDayIndex(dayName: string): number {
    const dayIndices: { [key: string]: number } = {
      'monday': 0,
      'tuesday': 1,   
      'wednesday': 2, 
      'thursday': 3,  
      'friday': 4,    
      'saturday': 5,  
      'sunday': 6     
    };
    
    return dayIndices[dayName] || 0;
  }

  /**
   * Parse une heure au format "HH:MM" en minutes depuis minuit
   */
  private static parseTime(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + (minutes || 0);
  }

  /**
   * Obtient l'AvailabilityManager pour une ressource et une semaine données.
   * Lève une erreur si initialize() n'a pas été appelé.
   */
  public static getAvailabilityManager(resourceId: string, weekNumber?: number): AvailabilityManager | null {
    if (!this.constraintsData) {
      throw new Error('ConstraintsManager non initialisé. Appelez ConstraintsManager.initialize(data) d\'abord.');
    }

    if (weekNumber !== undefined) {
      const weeklyOverrides = this.weeklyOverrides.get(resourceId);
      if (weeklyOverrides?.has(weekNumber)) {
        return weeklyOverrides.get(weekNumber)!;
      }
    }

    const specificAvailability = this.availabilityManagers.get(resourceId);
    if (specificAvailability) {
      return specificAvailability;
    }

    console.warn(`⚠️  Ressource '${resourceId}' non trouvée dans contraintes.json - utilisation des contraintes Default`);
    
    const defaultSlots = this.constraintsData?.Default || [];
    return this.createAvailabilityManagerFromSlots(defaultSlots);
  }

  /**
   * Obtient toutes les ressources disponibles
   */
  public static getAllResourceIds(): string[] {
    if (!this.constraintsData) {
      throw new Error('ConstraintsManager non initialisé.');
    }
    return Array.from(this.availabilityManagers.keys());
  }

  /**
   * Vérifie si une ressource existe
   */
  public static hasResource(resourceId: string): boolean {
    if (!this.constraintsData) {
      throw new Error('ConstraintsManager non initialisé.');
    }
    return this.availabilityManagers.has(resourceId);
  }

  /**
   * Obtient les semaines avec des overrides pour une ressource
   */
  public static getOverrideWeeks(resourceId: string): number[] {
    if (!this.constraintsData) {
      throw new Error('ConstraintsManager non initialisé.');
    }
    const weeklyOverrides = this.weeklyOverrides.get(resourceId);
    return weeklyOverrides ? Array.from(weeklyOverrides.keys()).sort((a, b) => a - b) : [];
  }

  /**
   * Obtient des statistiques sur les contraintes chargées
   */
  public static getStats(): {
    totalResources: number;
    resourcesWithOverrides: number;
    totalOverrides: number;
  } {
    if (!this.constraintsData) {
      throw new Error('ConstraintsManager non initialisé.');
    }
    
    let totalOverrides = 0;
    for (const weeklyMap of this.weeklyOverrides.values()) {
      totalOverrides += weeklyMap.size;
    }

    return {
      totalResources: this.availabilityManagers.size,
      resourcesWithOverrides: this.weeklyOverrides.size,
      totalOverrides
    };
  }
}
