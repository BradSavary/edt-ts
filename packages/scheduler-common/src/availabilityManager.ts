import { Availability } from './availability.ts';
import type { TimeSlot, ConstraintsData } from './types.ts';

/**
 * Gestionnaire des contraintes de disponibilité.
 *
 * S'instancie directement avec les données de contraintes et expose
 * l'Availability de chaque ressource (par défaut ou par semaine).
 * L'état est entièrement local à l'instance — pas de singleton global.
 */
export class AvailabilityManager {
  private readonly constraintsData: ConstraintsData;
  private readonly availabilities = new Map<string, Availability>();
  private readonly weeklyOverrides = new Map<string, Map<number, Availability>>();

  constructor(data: ConstraintsData) {
    this.constraintsData = data;
    this._initializeAvailabilities();
  }

  /**
   * Initialise toutes les Availability pour chaque ressource
   */
  private _initializeAvailabilities(): void {
    const defaultSlots = this.constraintsData.Default || [];

    for (const [resourceId, constraints] of Object.entries(this.constraintsData)) {
      if (resourceId === 'Default') continue;

      let defaultAvailability: Availability;

      if (constraints === null) {
        defaultAvailability = this._createFromSlots(defaultSlots);
      } else if (Array.isArray(constraints)) {
        defaultAvailability = this._createFromSlots(constraints);
      } else if (typeof constraints === 'object' && constraints.default) {
        defaultAvailability = this._createFromSlots(constraints.default);
      } else {
        defaultAvailability = this._createFromSlots(defaultSlots);
      }

      this.availabilities.set(resourceId, defaultAvailability);

      if (typeof constraints === 'object' && constraints !== null && !Array.isArray(constraints)) {
        const weeklyMap = new Map<number, Availability>();
        
        for (const [key, slots] of Object.entries(constraints)) {
          if (key === 'default') continue;
          
          const weekMatch = key.match(/^S(\d+)$/);
          if (weekMatch && slots) {
            const weekNumber = parseInt(weekMatch[1], 10);
            weeklyMap.set(weekNumber, this._createFromSlots(slots));
          }
        }
        
        if (weeklyMap.size > 0) {
          this.weeklyOverrides.set(resourceId, weeklyMap);
        }
      }
    }
  }

  private _createFromSlots(slots: TimeSlot[]): Availability {
    const availability = new Availability();
    
    for (const slot of slots) {
      const days = this._parseDays(slot.days);
      
      for (const dayName of days) {
        const dayIndex = this._getDayIndex(dayName);
        const startTime = this._parseTime(slot.from);
        const endTime = this._parseTime(slot.to);
        
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
  private _parseDays(daysString: string): string[] {
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
  private _getDayIndex(dayName: string): number {
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
  private _parseTime(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + (minutes || 0);
  }

  /**
   * Retourne l'Availability pour une ressource donnée, avec support des overrides hebdomadaires.
   */
  public getAvailability(resourceId: string, weekNumber?: number): Availability | null {
    if (weekNumber !== undefined) {
      const weeklyOverrides = this.weeklyOverrides.get(resourceId);
      if (weeklyOverrides?.has(weekNumber)) {
        return weeklyOverrides.get(weekNumber)!;
      }
    }

    const specific = this.availabilities.get(resourceId);
    if (specific) {
      return specific;
    }

    console.warn(`⚠️  Ressource '${resourceId}' non trouvée dans les contraintes - utilisation des contraintes Default`);
    
    const defaultSlots = this.constraintsData.Default || [];
    return this._createFromSlots(defaultSlots);
  }

  public getAllResourceIds(): string[] {
    return Array.from(this.availabilities.keys());
  }

  public hasResource(resourceId: string): boolean {
    return this.availabilities.has(resourceId);
  }

  public getOverrideWeeks(resourceId: string): number[] {
    const weeklyOverrides = this.weeklyOverrides.get(resourceId);
    return weeklyOverrides ? Array.from(weeklyOverrides.keys()).sort((a, b) => a - b) : [];
  }

  public getStats(): {
    totalResources: number;
    resourcesWithOverrides: number;
    totalOverrides: number;
  } {
    let totalOverrides = 0;
    for (const weeklyMap of this.weeklyOverrides.values()) {
      totalOverrides += weeklyMap.size;
    }

    return {
      totalResources: this.availabilities.size,
      resourcesWithOverrides: this.weeklyOverrides.size,
      totalOverrides
    };
  }
}
