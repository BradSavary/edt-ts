import { Loader } from './lib/loader.js';
import { formatInterval } from './bookable';

console.log('🔍 Diagnostic de la planification de la tâche MONDOLLOT...\n');

// Charger les tâches
const tasks = Loader.tasks;

// Trouver la tâche de Gestion de projet
const mondollotTask = tasks.find(task => 
    task.name === 'Gestion de projet' && 
    task.resources.some(resource => resource.id === 'GILLET Anthony')
);

if (mondollotTask) {
    console.log(`📋 Test de planification pour: ${mondollotTask.name}`);
    console.log(`👨‍🏫 Enseignant: GILLET Anthony`);
    console.log(`⏱️ Durée: ${mondollotTask.duration} minutes`);
    
    // Générer les créneaux possibles pour cette tâche
    console.log('\n🔍 Génération des créneaux possibles...');
    
    // On va essayer d'accéder à la méthode generatePossibleSlots
    // Malheureusement, elle est privée, donc on va simuler ce qu'elle fait
    
    // D'abord, vérifier les créneaux du schedulable de la tâche
    const availableTime = mondollotTask.schedulable.getTotalAvailableTime();
    console.log(`🕒 Temps disponible total: ${availableTime} minutes`);
    
    if (availableTime >= mondollotTask.duration) {
        console.log('✅ Temps suffisant pour la durée de la tâche');
        
        // Essayer de trouver des créneaux de 90 minutes
        // On peut le faire en regardant les créneaux disponibles
        const intervals = mondollotTask.schedulable.getAvailableIntervals();
        console.log(`\n📅 Créneaux disponibles: ${intervals.length}`);
        
        intervals.forEach((interval, index) => {
            const duration = interval.end - interval.start;
            
            console.log(`   ${index + 1}. ${formatInterval(interval.start, interval.end)}`);
            
            if (duration >= mondollotTask.duration) {
                console.log(`      ✅ Créneau suffisant pour la tâche (${mondollotTask.duration} min nécessaires)`);
            } else {
                console.log(`      ❌ Créneau insuffisant (${mondollotTask.duration} min nécessaires)`);
            }
        });
        
    } else {
        console.log('❌ Temps insuffisant pour la durée de la tâche');
    }
    
} else {
    console.log('❌ Tâche non trouvée');
}