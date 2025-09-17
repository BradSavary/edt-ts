import { Loader } from './lib/loader.js';
import { Schedule } from './schedule.js';
import { formatInterval } from './bookable';

console.log('🎯 Test final de planification après standardisation des timestamps...\n');

// Charger les tâches
console.log('📚 Chargement des tâches pour la semaine 36');
const tasks = Loader.tasks;
console.log(`✅ ${tasks.length} tâches chargées pour la semaine 36\n`);

// Trouver la tâche MONDOLLOT
const mondollotTask = tasks.find(task => 
    task.name === 'Gestion de projet' && 
    task.resources.some(resource => resource.id === 'GILLET Anthony')
);

if (mondollotTask) {
    console.log('📋 Tâche MONDOLLOT trouvée:');
    console.log(`   📚 Nom: ${mondollotTask.name}`);
    console.log(`   👨‍🏫 Enseignant: GILLET Anthony`);
    console.log(`   ⏱️ Durée: ${mondollotTask.duration} minutes`);
    
    // Afficher les créneaux disponibles avec le bon formatage
    const intervals = mondollotTask.schedulable.getAvailableIntervals();
    console.log(`\n📅 Créneaux disponibles (${intervals.length}):`);
    intervals.forEach((interval, index) => {
        console.log(`   ${index + 1}. ${formatInterval(interval.start, interval.end)}`);
    });
    
    console.log(`\n🕒 Temps total disponible: ${mondollotTask.schedulable.getTotalAvailableTime()} minutes`);
    console.log(`⚖️ Score de contrainte: ${mondollotTask.schedulable.getTotalAvailableTime()}\n`);
}

// Lancer la planification complète
console.log('🚀 Lancement de la planification complète...');
const schedule = new Schedule();
const planification = schedule.solve();

console.log(`\n📊 Résultats de planification:`);
console.log(`✅ Tâches planifiées: ${planification.solutions.length}`);
console.log(`❌ Conflits détectés: ${planification.conflictCount}`);
console.log(`📈 Taux de réussite: ${((planification.solutions.length / tasks.length) * 100).toFixed(1)}%`);

// Vérifier si MONDOLLOT a été planifié
const mondollotPlanned = planification.solutions.find(solution => 
    solution.task.name === 'Gestion de projet' && 
    solution.task.resources.some(resource => resource.id === 'GILLET Anthony')
);

if (mondollotPlanned) {
    console.log(`\n🎉 MONDOLLOT PLANIFIÉ avec succès !`);
    const endTime = mondollotPlanned.startTime + mondollotPlanned.task.duration;
    console.log(`   📅 Créneau: ${formatInterval(mondollotPlanned.startTime, endTime)}`);
} else {
    console.log(`\n❌ MONDOLLOT NON PLANIFIÉ`);
    console.log(`   📝 Tâche non trouvée dans les solutions`);
}