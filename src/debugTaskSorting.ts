import { Loader } from './lib/loader.js';

console.log('🔍 Vérification du tri des tâches dans l\'algorithme...\n');

// Charger les tâches
const tasks = Loader.tasks;

// Simuler le même tri que dans Schedule.ts
console.log('📊 Tri des tâches par score de contrainte (temps disponible croissant):');

// Calculer les scores et trier comme dans l'algorithme
const tasksWithScores = tasks.map(task => ({
    task,
    score: task.schedulable.getTotalAvailableTime()
}));

// Tri identique à celui de l'algorithme : score croissant (plus contraintes en premier)
tasksWithScores.sort((a, b) => a.score - b.score);

console.log('\n🏆 Top 15 des tâches les plus contraintes (comme dans l\'algorithme):');
tasksWithScores.slice(0, 15).forEach((item, index) => {
    const teacherNames = item.task.resources
        .filter(r => r.type === 'teacher')
        .map(r => r.id)
        .join(', ');
    
    const isGestionProjet = item.task.name === 'Gestion de projet';
    const marker = isGestionProjet ? '👑' : '  ';
    
    console.log(`${marker} ${index + 1}. ${item.task.name} (${teacherNames}) - ${item.score} minutes`);
    
    if (isGestionProjet) {
        console.log(`     ✅ Cette tâche DEVRAIT être planifiée en premier !`);
    }
});

// Vérifier s'il y a d'autres tâches avec 90 minutes
const tasks90min = tasksWithScores.filter(item => item.score === 90);
console.log(`\n🔍 Tâches avec exactement 90 minutes disponibles: ${tasks90min.length}`);
tasks90min.forEach(item => {
    const teacherNames = item.task.resources
        .filter(r => r.type === 'teacher')
        .map(r => r.id)
        .join(', ');
    console.log(`   - ${item.task.name} (${teacherNames})`);
});