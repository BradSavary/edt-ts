import { Loader } from './lib/loader.js';
import { formatInterval } from './bookable';

console.log('🔍 Diagnostic des scores de contrainte...\n');

// Charger les tâches
const tasks = Loader.tasks;

// Trouver la tâche de Gestion de projet avec GILLET Anthony
const mondollotTask = tasks.find(task => 
    task.name === 'Gestion de projet' && 
    task.resources.some(resource => resource.id === 'GILLET Anthony')
);

if (mondollotTask) {
    console.log(`📋 Tâche trouvée: ${mondollotTask.name}`);
    console.log(`👨‍🏫 Enseignant: ${mondollotTask.resources.find(r => r.id === 'GILLET Anthony')?.id}`);
    console.log(`⏱️ Durée: ${mondollotTask.duration} minutes`);
    console.log(`🏢 Ressources: ${mondollotTask.resources.map(r => r.id).join(', ')}`);
    
    // Calculer le temps total disponible
    const totalAvailableTime = mondollotTask.schedulable.getTotalAvailableTime();
    console.log(`🕒 Temps total disponible: ${totalAvailableTime} minutes`);
    
    if (totalAvailableTime === 0) {
        console.log('❌ PROBLÈME: Aucun temps disponible pour cette tâche !');
    } else if (totalAvailableTime < mondollotTask.duration) {
        console.log('⚠️  PROBLÈME: Temps disponible insuffisant pour la durée de la tâche !');
    } else {
        console.log('✅ Temps disponible suffisant');
    }
    
    // Afficher les créneaux disponibles
    const availableSlots = mondollotTask.schedulable.getAvailableIntervals();
    console.log(`\n📅 Créneaux disponibles (${availableSlots.length}):`);
    availableSlots.forEach((slot, index) => {
        console.log(`   ${index + 1}. ${formatInterval(slot.start, slot.end)}`);
    });
} else {
    console.log('❌ Tâche "Gestion de projet" avec GILLET Anthony non trouvée');
}

// Calculer et afficher les scores de toutes les tâches pour comparaison
console.log('\n📊 Top 10 des tâches les plus contraintes (temps disponible le plus faible):');
const tasksWithScores = tasks.map(task => ({
    task,
    score: task.schedulable.getTotalAvailableTime()
})).sort((a, b) => a.score - b.score);

tasksWithScores.slice(0, 10).forEach((item, index) => {
    const teacherNames = item.task.resources
        .filter(r => r.type === 'teacher')
        .map(r => r.id)
        .join(', ');
    
    console.log(`   ${index + 1}. ${item.task.name} (${teacherNames}) - ${item.score} minutes`);
});