/**
 * Module de gestion des plages de disponibilités
 * Gère une liste triée d'intervalles de temps disponibles
 */

/**
 * Interface pour un slot disponible
 */
interface AvailableSlot {
  start: number;
  end: number;
  duration?: number;
}

/**
 * Classe représentant un intervalle de temps
 */
class TimeInterval {
  public readonly start: number;
  public readonly end: number;

  constructor(start: number, end: number) {
    if (start >= end) {
      throw new Error('L\'heure de début doit être strictement antérieure à l\'heure de fin');
    }
    this.start = start;
    this.end = end;
  }

  /**
   * Vérifie si cet intervalle chevauche avec un autre
   */
  overlaps(other: TimeInterval): boolean {
    return this.start < other.end && this.end > other.start;
  }

  /**
   * Vérifie si cet intervalle est adjacent à un autre
   */
  isAdjacent(other: TimeInterval): boolean {
    return this.end === other.start || this.start === other.end;
  }

  /**
   * Fusionne cet intervalle avec un autre
   */
  merge(other: TimeInterval): TimeInterval {
    if (!this.canMergeWith(other)) {
      throw new Error('Les intervalles ne peuvent pas être fusionnés');
    }
    return new TimeInterval(
      Math.min(this.start, other.start),
      Math.max(this.end, other.end)
    );
  }

  /**
   * Vérifie si cet intervalle peut être fusionné avec un autre
   * (chevauchement ou adjacence)
   */
  canMergeWith(other: TimeInterval): boolean {
    return this.overlaps(other) || this.isAdjacent(other);
  }

  /**
   * Vérifie si un moment donné est dans cet intervalle
   */
  contains(time: number): boolean {
    return time >= this.start && time < this.end;
  }

  /**
   * Calcule la durée de l'intervalle
   */
  duration(): number {
    return this.end - this.start;
  }

  /**
   * Clone l'intervalle
   */
  clone(): TimeInterval {
    return new TimeInterval(this.start, this.end);
  }

  toString(): string {
    return `[${this.start}, ${this.end})`;
  }
}

/**
 * Gestionnaire de plages de disponibilités
 * Maintient une liste triée d'intervalles non-chevauchants
 */
class AvailabilityManager {
  private intervals: TimeInterval[]; // Liste triée par heure de début

  constructor() {
    this.intervals = [];
  }

  /**
   * Ajoute une nouvelle plage de disponibilité
   * Maintient automatiquement le tri croissant des intervalles et fusionne les chevauchements
   */
  addAvailability(start: number, end: number): void {
    const newInterval = new TimeInterval(start, end);
    
    if (this.intervals.length === 0) {
      this.intervals.push(newInterval);
      return;
    }

    // Trouver la position d'insertion pour maintenir le tri
    const insertPosition = this._findInsertPosition(newInterval);
    
    // Insérer à la position correcte
    this.intervals.splice(insertPosition, 0, newInterval);
    
    // Fusionner les intervalles qui se chevauchent ou sont adjacents
    this._mergeFromPosition(insertPosition);
  }

  /**
   * Trouve la position d'insertion pour maintenir le tri croissant
   */
  private _findInsertPosition(newInterval: TimeInterval): number {
    let left = 0;
    let right = this.intervals.length;
    
    // Recherche binaire pour trouver la position d'insertion
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.intervals[mid].start < newInterval.start) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    
    return left;
  }

  /**
   * Fusionne les intervalles qui se chevauchent ou sont adjacents à partir d'une position donnée
   */
  private _mergeFromPosition(startPos: number): void {
    let i = startPos;
    
    // Fusionner vers la gauche si nécessaire
    while (i > 0 && this.intervals[i - 1].canMergeWith(this.intervals[i])) {
      this.intervals[i - 1] = this.intervals[i - 1].merge(this.intervals[i]);
      this.intervals.splice(i, 1);
      i--;
    }
    
    // Fusionner vers la droite si nécessaire
    while (i < this.intervals.length - 1 && this.intervals[i].canMergeWith(this.intervals[i + 1])) {
      this.intervals[i] = this.intervals[i].merge(this.intervals[i + 1]);
      this.intervals.splice(i + 1, 1);
    }
  }

  /**
   * Supprime une plage de temps des disponibilités
   * Version optimisée exploitant le tri croissant des intervalles
   */
  removeAvailability(start: number, end: number): void {
    if (start >= end) return;
    
    // Trouver le premier intervalle qui pourrait être affecté
    // Réutilise la méthode existante _findFirstIntervalAfter
    const firstAffectedIndex = this._findFirstIntervalAfter(start);
    
    // Si aucun intervalle n'est affecté, on peut sortir directement
    if (firstAffectedIndex >= this.intervals.length) return;
    
    // Construire la nouvelle liste d'intervalles
    const newIntervals: TimeInterval[] = [];
    
    // Copier tous les intervalles avant la zone de suppression (non affectés)
    for (let i = 0; i < firstAffectedIndex; i++) {
      newIntervals.push(this.intervals[i]);
    }
    
    // Traiter les intervalles potentiellement affectés
    for (let i = firstAffectedIndex; i < this.intervals.length; i++) {
      const interval = this.intervals[i];
      
      // Si l'intervalle commence après la fin de la suppression, 
      // tous les intervalles suivants sont non affectés (grâce au tri)
      if (interval.start >= end) {
        // Copier le reste des intervalles et sortir
        for (let j = i; j < this.intervals.length; j++) {
          newIntervals.push(this.intervals[j]);
        }
        break;
      }
      
      // Si l'intervalle se termine avant le début de la suppression, le garder intact
      if (interval.end <= start) {
        newIntervals.push(interval);
      } else {
        // Il y a chevauchement, diviser l'intervalle si nécessaire
        if (interval.start < start) {
          // Partie avant la suppression
          newIntervals.push(new TimeInterval(interval.start, start));
        }
        if (interval.end > end) {
          // Partie après la suppression
          newIntervals.push(new TimeInterval(end, interval.end));
        }
      }
    }

    this.intervals = newIntervals;
  }

  /**
   * Vérifie si une plage de temps est disponible
   * Utilise une recherche binaire optimisée grâce au tri des intervalles
   */
  isAvailable(start: number, end: number): boolean {
    if (start >= end) return false;
    
    // Recherche binaire pour trouver l'intervalle qui pourrait contenir start
    let left = 0;
    let right = this.intervals.length - 1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const interval = this.intervals[mid];
      
      if (interval.end <= start) {
        // L'intervalle se termine avant ou au moment du début recherché
        left = mid + 1;
      } else if (interval.start > start) {
        // L'intervalle commence après le début recherché
        right = mid - 1;
      } else {
        // L'intervalle contient le point de début, vérifier s'il contient toute la plage
        return interval.start <= start && interval.end >= end;
      }
    }
    
    return false;
  }

  /**
   * Trouve le prochain créneau disponible d'une durée donnée
   * Utilise une recherche optimisée grâce au tri des intervalles
   */
  findNextAvailableSlot(duration: number, afterTime: number = 0): AvailableSlot | null {
    // Recherche binaire pour trouver le premier intervalle qui commence >= afterTime
    const startIndex = this._findFirstIntervalAfter(afterTime);
    
    // Parcourir à partir de cet index
    for (let i = startIndex; i < this.intervals.length; i++) {
      const interval = this.intervals[i];
      const slotStart = Math.max(interval.start, afterTime);
      
      if (slotStart + duration <= interval.end) {
        return {
          start: slotStart,
          end: slotStart + duration
        };
      }
    }
    
    return null;
  }

  /**
   * Trouve l'index du premier intervalle qui pourrait contenir ou suivre afterTime
   */
  private _findFirstIntervalAfter(afterTime: number): number {
    let left = 0;
    let right = this.intervals.length - 1;
    let result = this.intervals.length; // Si aucun trouvé, commencer à la fin
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const interval = this.intervals[mid];
      
      if (interval.end > afterTime) {
        // Cet intervalle pourrait être utile
        result = mid;
        right = mid - 1;
      } else {
        // Cet intervalle se termine avant afterTime
        left = mid + 1;
      }
    }
    
    return result;
  }

  /**
   * Trouve tous les créneaux disponibles d'une durée minimale
   */
  findAvailableSlots(minDuration: number): AvailableSlot[] {
    const slots: AvailableSlot[] = [];
    
    for (const interval of this.intervals) {
      if (interval.duration() >= minDuration) {
        slots.push({
          start: interval.start,
          end: interval.end,
          duration: interval.duration()
        });
      }
    }
    
    return slots;
  }

  /**
   * Réserve un créneau (le supprime des disponibilités)
   */
  book(start: number, end: number): void {
    if (!this.isAvailable(start, end)) {
      throw new Error('Le créneau demandé n\'est pas disponible');
    }
    this.removeAvailability(start, end);
  }

  /**
   * Calcule le temps total disponible
   */
  getTotalAvailableTime(): number {
    return this.intervals.reduce((total, interval) => total + interval.duration(), 0);
  }

  /**
   * Retourne une copie des intervalles disponibles
   */
  getAvailableIntervals(): AvailableSlot[] {
    return this.intervals.map(interval => ({
      start: interval.start,
      end: interval.end,
      duration: interval.duration()
    }));
  }

  /**
   * Vérifie si aucune disponibilité n'est définie
   */
  isEmpty(): boolean {
    return this.intervals.length === 0;
  }

  /**
   * Calcule l'intersection avec un autre gestionnaire de disponibilités
   * Retourne une nouvelle instance contenant les créneaux communs
   * Utilise un algorithme optimisé à deux pointeurs exploitant le tri des intervalles
   */
  intersect(other: AvailabilityManager): AvailabilityManager {
    const result = new AvailabilityManager();
    
    // Algorithme à deux pointeurs pour parcourir les listes triées
    let i = 0; // Pointeur pour this.intervals
    let j = 0; // Pointeur pour other.intervals
    
    while (i < this.intervals.length && j < other.intervals.length) {
      const intervalA = this.intervals[i];
      const intervalB = other.intervals[j];
      
      // Calculer l'intersection entre les deux intervalles
      const intersectionStart = Math.max(intervalA.start, intervalB.start);
      const intersectionEnd = Math.min(intervalA.end, intervalB.end);
      
      // Si l'intersection est valide, l'ajouter au résultat
      if (intersectionStart < intersectionEnd) {
        result.addAvailability(intersectionStart, intersectionEnd);
      }
      
      // Avancer le pointeur de l'intervalle qui se termine en premier
      if (intervalA.end < intervalB.end) {
        i++;
      } else if (intervalB.end < intervalA.end) {
        j++;
      } else {
        // Les deux intervalles se terminent en même temps
        i++;
        j++;
      }
    }
    
    return result;
  }

  /**
   * Nettoie les intervalles vides ou invalides
   */
  cleanup(): void {
    this.intervals = this.intervals.filter(interval => interval.duration() > 0);
  }

  /**
   * Vide toutes les disponibilités
   */
  clear(): void {
    this.intervals = [];
  }

  /**
   * Affiche les créneaux de disponibilité de manière lisible dans la console
   * Convertit les timestamps en jours et heures pour une meilleure lisibilité
   */
  displaySchedule(): void {
    if (this.intervals.length === 0) {
      console.log('Aucun créneau de disponibilité');
      return;
    }

    console.log('📅 Créneaux de disponibilité:');
    
    const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    
    for (const interval of this.intervals) {
      const startDay = Math.floor(interval.start / (24 * 60));
      const startHour = Math.floor((interval.start % (24 * 60)) / 60);
      const startMinute = interval.start % 60;
      
      const endDay = Math.floor(interval.end / (24 * 60));
      const endHour = Math.floor((interval.end % (24 * 60)) / 60);
      const endMinute = interval.end % 60;
      
      const startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
      const endTime = `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`;
      
      if (startDay === endDay) {
        // Même jour
        const dayName = dayNames[startDay] || `Jour ${startDay}`;
        console.log(`   ${dayName}: ${startTime} - ${endTime}`);
      } else {
        // Créneau sur plusieurs jours
        const startDayName = dayNames[startDay] || `Jour ${startDay}`;
        const endDayName = dayNames[endDay] || `Jour ${endDay}`;
        console.log(`   ${startDayName} ${startTime} - ${endDayName} ${endTime}`);
      }
    }
    
    const totalMinutes = this.getTotalAvailableTime();
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    console.log(`   📊 Total: ${totalHours}h${remainingMinutes.toString().padStart(2, '0')} (${totalMinutes} minutes)`);
  }

  toString(): string {
    return this.intervals.map(interval => interval.toString()).join(', ');
  }
}

// Export des classes
export { TimeInterval, AvailabilityManager };
export type { AvailableSlot };
