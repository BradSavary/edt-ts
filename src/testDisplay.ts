import { AvailabilityManager } from './bookable.js';

console.log('=== Test de la méthode displaySchedule ===\n');

// Créer un AvailabilityManager de test
const availability = new AvailabilityManager();

console.log('1. AvailabilityManager vide:');
availability.displaySchedule();

console.log('\n2. Ajout de quelques créneaux:');
// Lundi 9h-12h (jour 0, 9*60=540 à 12*60=720)
availability.addAvailability(540, 720);

// Lundi 14h-17h (jour 0, 14*60=840 à 17*60=1020)
availability.addAvailability(840, 1020);

// Mercredi 8h-18h (jour 2, 2*24*60+8*60=3360 à 2*24*60+18*60=3960)
availability.addAvailability(3360, 3960);

// Vendredi 10h30-16h45 (jour 4, 4*24*60+10*60+30=6390 à 4*24*60+16*60+45=6765)
availability.addAvailability(6390, 6765);

availability.displaySchedule();

console.log('\n3. Test avec le ConstraintsManager:');
import { ConstraintsManager } from './constraintsManager.js';

const resourceAvailability = ConstraintsManager.getAvailabilityManager('MEUNIER Sandrine');
if (resourceAvailability) {
  console.log('\nDisponibilités de MEUNIER Sandrine (par défaut):');
  resourceAvailability.displaySchedule();
}

const weekAvailability = ConstraintsManager.getAvailabilityManager('MEUNIER Sandrine', 38);
if (weekAvailability) {
  console.log('\nDisponibilités de MEUNIER Sandrine (semaine 38):');
  weekAvailability.displaySchedule();
}
