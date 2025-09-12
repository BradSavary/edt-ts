import { Resource } from './resource';
import { Task } from './task';

// Exemple d'utilisation : planification d'une tâche avec 3 ressources

// Création de 3 ressources : une salle de réunion, un projecteur et une personne
const salleReunion = new Resource('salle-A01');
const projecteur = new Resource('projecteur-1');
const consultant = new Resource('jean-dupont');

// Définition des disponibilités pour chaque ressource
// Les heures sont représentées en minutes depuis minuit (ex: 8h = 480 minutes)

// Salle de réunion disponible de 8h à 18h (sauf pause déjeuner 12h-13h)
salleReunion.addAvailability(8 * 60, 12 * 60);     // 8h00 à 12h00
salleReunion.addAvailability(13 * 60, 18 * 60);    // 13h00 à 18h00

// Projecteur disponible de 9h à 17h (maintenance 14h-15h)
projecteur.addAvailability(9 * 60, 14 * 60);       // 9h00 à 14h00
projecteur.addAvailability(15 * 60, 17 * 60);      // 15h00 à 17h00

// Consultant disponible de 8h30 à 16h30 (pause 12h30-13h30)
consultant.addAvailability(8 * 60 + 30, 12 * 60 + 30);  // 8h30 à 12h30
consultant.addAvailability(13 * 60 + 30, 16 * 60 + 30); // 13h30 à 16h30

// Création d'une tâche nécessitant les 3 ressources simultanément
const tacheFormation = new Task(
  'formation-001',
  'Formation sur les nouveaux outils',
  120, // 2 heures (120 minutes)
  [salleReunion, projecteur, consultant]
);

console.log('=== EXEMPLE DE PLANIFICATION DE TÂCHE ===\n');

console.log(`Tâche: ${tacheFormation.name}`);
console.log(`Durée: ${tacheFormation.duration} minutes (${tacheFormation.duration / 60}h)`);
console.log(`Ressources requises: ${tacheFormation.resources.map(r => r.id).join(', ')}\n`);

// Affichage des disponibilités individuelles
console.log('--- Disponibilités individuelles ---');
console.log(`Salle de réunion: ${salleReunion.toString()}`);
console.log(`Projecteur: ${projecteur.toString()}`);
console.log(`Consultant: ${consultant.toString()}\n`);

// Utilisation de la propriété schedulable pour obtenir l'intersection
console.log('--- Créneaux où TOUTES les ressources sont disponibles ---');
const intersectionDisponibilites = tacheFormation.schedulable;
console.log(`Disponibilités communes: ${intersectionDisponibilites.toString()}\n`);

// Recherche de tous les créneaux possibles pour cette tâche
const creneauxPossibles = tacheFormation.findAllAvailableSlots();
console.log('--- Créneaux possibles pour planifier la tâche ---');

if (creneauxPossibles.length === 0) {
  console.log('❌ Aucun créneau disponible pour cette tâche !');
} else {
  creneauxPossibles.forEach((slot, index) => {
    const startHour = Math.floor(slot.start / 60);
    const startMin = slot.start % 60;
    const endHour = Math.floor(slot.end / 60);
    const endMin = slot.end % 60;
    
    console.log(`${index + 1}. ${startHour}h${startMin.toString().padStart(2, '0')} à ${endHour}h${endMin.toString().padStart(2, '0')} (durée: ${slot.duration}min)`);
  });
}

// Recherche du prochain créneau disponible
console.log('\n--- Planification automatique ---');
const prochainCreneau = tacheFormation.findNextAvailableSlot();

if (prochainCreneau) {
  const startHour = Math.floor(prochainCreneau.start / 60);
  const startMin = prochainCreneau.start % 60;
  const endHour = Math.floor(prochainCreneau.end / 60);
  const endMin = prochainCreneau.end % 60;
  
  console.log(`✅ Prochain créneau disponible: ${startHour}h${startMin.toString().padStart(2, '0')} à ${endHour}h${endMin.toString().padStart(2, '0')}`);
  
  // Planifier la tâche automatiquement
  const resultat = tacheFormation.scheduleNext();
  
  if (resultat.success) {
    console.log(`✅ Tâche planifiée avec succès !`);
    console.log(`📅 Statut: ${tacheFormation.getStatus()}`);
    console.log(`⏰ Créneau assigné: ${resultat.scheduledSlot?.start} à ${resultat.scheduledSlot?.end}`);
    
    // Vérifier que les ressources ont été réservées
    console.log('\n--- Vérification des réservations ---');
    const debut = resultat.scheduledSlot!.start;
    const fin = resultat.scheduledSlot!.end;
    
    tacheFormation.resources.forEach(resource => {
      const disponible = resource.isAvailable(debut, fin);
      console.log(`${resource.id}: ${disponible ? '❌ Plus disponible' : '✅ Correctement réservée'}`);
    });
  } else {
    console.log(`❌ Erreur de planification: ${resultat.message}`);
  }
} else {
  console.log('❌ Aucun créneau disponible trouvé');
}

// Exemple avec recherche après une heure spécifique
console.log('\n--- Recherche après 14h ---');
const creneauApres14h = tacheFormation.findNextAvailableSlot(14 * 60);

if (creneauApres14h) {
  const startHour = Math.floor(creneauApres14h.start / 60);
  const startMin = creneauApres14h.start % 60;
  console.log(`Prochain créneau après 14h: ${startHour}h${startMin.toString().padStart(2, '0')}`);
} else {
  console.log('Aucun créneau disponible après 14h');
}

// Démonstration de l'invalidation du cache
console.log('\n--- Modification des disponibilités ---');
console.log('Ajout d\'une disponibilité au projecteur de 17h à 19h...');
projecteur.addAvailability(17 * 60, 19 * 60);

// Important: invalider le cache après modification des ressources
tacheFormation.invalidateSchedulable();

// Rechercher à nouveau les créneaux
const nouveauxCreneaux = tacheFormation.findAllAvailableSlots();
console.log(`Nouveaux créneaux disponibles: ${nouveauxCreneaux.length}`);

console.log('\n=== FIN DE L\'EXEMPLE ===');
