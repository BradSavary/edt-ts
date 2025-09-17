import { AvailabilityManager } from './bookable.js';
import { Loader } from './lib/loader.js';
import type { TimeSlot, ConstraintsData } from './lib/types.js';

/**
 * Gestionnaire statique des contraintes de disponibilité
 * Charge et indexe les contraintes depuis contraintes.json
 */
export class ConstraintsManager {
  private static constraintsData: ConstraintsData | null = null;
  private static availabilityManagers = new Map<string, AvailabilityManager>();
  private static weeklyOverrides = new Map<string, Map<number, AvailabilityManager>>();

  /**
   * Charge les données de contraintes depuis le fichier JSON
   */
  private static loadConstraints(): ConstraintsData {
    if (this.constraintsData !== null) {
      return this.constraintsData;
    }

    try {
      this.constraintsData = Loader.loadConstraints();
      
      // Initialiser les gestionnaires de disponibilité
      this.initializeAvailabilityManagers();
      
      return this.constraintsData;
    } catch (error) {
      console.error('Erreur lors du chargement des contraintes:', error);
      throw new Error('Impossible de charger le fichier contraintes.json');
    }
  }

  /**
   * Initialise tous les AvailabilityManager pour chaque ressource
   */
  private static initializeAvailabilityManagers(): void {
    if (!this.constraintsData) return;

    const defaultSlots = this.constraintsData.Default || [];

    for (const [resourceId, constraints] of Object.entries(this.constraintsData)) {
      if (resourceId === 'Default') continue;

      // Créer l'AvailabilityManager par défaut
      let defaultAvailability: AvailabilityManager;

      if (constraints === null) {
        // Utiliser les disponibilités Default
        defaultAvailability = this.createAvailabilityManagerFromSlots(defaultSlots);
      } else if (Array.isArray(constraints)) {
        // Contraintes directes (cas legacy)
        defaultAvailability = this.createAvailabilityManagerFromSlots(constraints);
      } else if (typeof constraints === 'object' && constraints.default) {
        // Contraintes avec propriété default
        defaultAvailability = this.createAvailabilityManagerFromSlots(constraints.default);
      } else {
        // Fallback vers Default
        defaultAvailability = this.createAvailabilityManagerFromSlots(defaultSlots);
      }

      this.availabilityManagers.set(resourceId, defaultAvailability);

      // Traiter les overrides hebdomadaires
      if (typeof constraints === 'object' && constraints !== null && !Array.isArray(constraints)) {
        const weeklyMap = new Map<number, AvailabilityManager>();
        
        for (const [key, slots] of Object.entries(constraints)) {
          if (key === 'default') continue;
          
          // Extraire le numéro de semaine (S38 -> 38)
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
        
        // Convertir en timestamp pour une semaine type
        // Formule : dayIndex * 1440 + minutes_depuis_minuit
        // où dayIndex : 0=Lundi, 1=Mardi, 2=Mercredi, 3=Jeudi, 4=Vendredi, 5=Samedi, 6=Dimanche
        // Exemple : Vendredi 13:30 = 4 * 1440 + 810 = 6570 minutes depuis lundi minuit
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
   * Convertit un nom de jour en index numérique pour le système de timestamps
   * 
   * SYSTÈME DE TIMESTAMPS :
   * Les timestamps représentent des minutes écoulées depuis LUNDI MINUIT d'une semaine type
   * 
   * @param dayName Nom du jour (monday, tuesday, etc.)
   * @returns Index du jour dans la semaine type :
   *   - 0 = Lundi (0 à 1439 minutes)
   *   - 1 = Mardi (1440 à 2879 minutes)
   *   - 2 = Mercredi (2880 à 4319 minutes)
   *   - 3 = Jeudi (4320 à 5759 minutes)
   *   - 4 = Vendredi (5760 à 7199 minutes)
   *   - 5 = Samedi (7200 à 8639 minutes)
   *   - 6 = Dimanche (8640 à 10079 minutes)
   */
  private static getDayIndex(dayName: string): number {
    const dayIndices: { [key: string]: number } = {
      'monday': 0,    // Lundi = base de la semaine type
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
   * Obtient l'AvailabilityManager pour une ressource et une semaine données
   */
  public static getAvailabilityManager(resourceId: string, weekNumber?: number): AvailabilityManager | null {
    // Charger les contraintes si nécessaire
    this.loadConstraints();

    // Si une semaine spécifique est demandée, vérifier les overrides
    if (weekNumber !== undefined) {
      const weeklyOverrides = this.weeklyOverrides.get(resourceId);
      if (weeklyOverrides?.has(weekNumber)) {
        return weeklyOverrides.get(weekNumber)!;
      }
    }

    // Vérifier si la ressource a des contraintes spécifiques
    const specificAvailability = this.availabilityManagers.get(resourceId);
    if (specificAvailability) {
      return specificAvailability;
    }

    // Ressource non trouvée : émettre un warning et retourner une copie des contraintes Default
    console.warn(`⚠️  Ressource '${resourceId}' non trouvée dans contraintes.json - utilisation des contraintes Default`);
    
    // Créer une copie des contraintes Default pour cette ressource
    const defaultSlots = this.constraintsData?.Default || [];
    return this.createAvailabilityManagerFromSlots(defaultSlots);
  }

  /**
   * Obtient toutes les ressources disponibles
   */
  public static getAllResourceIds(): string[] {
    this.loadConstraints();
    return Array.from(this.availabilityManagers.keys());
  }

  /**
   * Vérifie si une ressource existe
   */
  public static hasResource(resourceId: string): boolean {
    this.loadConstraints();
    return this.availabilityManagers.has(resourceId);
  }

  /**
   * Obtient les semaines avec des overrides pour une ressource
   */
  public static getOverrideWeeks(resourceId: string): number[] {
    this.loadConstraints();
    const weeklyOverrides = this.weeklyOverrides.get(resourceId);
    return weeklyOverrides ? Array.from(weeklyOverrides.keys()).sort((a, b) => a - b) : [];
  }

  /**
   * Recharge les contraintes depuis le fichier
   */
  public static reload(): void {
    this.constraintsData = null;
    this.availabilityManagers.clear();
    this.weeklyOverrides.clear();
    this.loadConstraints();
  }

  /**
   * Obtient des statistiques sur les contraintes chargées
   */
  public static getStats(): {
    totalResources: number;
    resourcesWithOverrides: number;
    totalOverrides: number;
  } {
    this.loadConstraints();
    
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
