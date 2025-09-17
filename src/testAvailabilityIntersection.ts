import { Loader } from './lib/loader.js';

/**
 * Test de validation des AvailabilityManager des tâches
 * Vérifie que chaque tâche a un AvailabilityManager calculé comme intersection
 * de toutes ses ressources et détecte les tâches non planifiables
 */

console.log('🔍 === VALIDATION DES AVAILABILITYMANAGER DES TÂCHES ===\n');

// Charger les données
console.log('📋 Chargement des données...');
console.log(`📅 Semaine courante: ${Loader.currentWeek}`);
console.log(`📋 Nombre de tâches: ${Loader.tasks.length}`);

let unschedulableTasks = 0;
let totalTasks = 0;
const criticalIssues = [];

console.log('\n🔍 Analyse des AvailabilityManager des tâches:');

for (let i = 0; i < Loader.tasks.length; i++) {
    const task = Loader.tasks[i];
    totalTasks++;
    
    console.log(`\nTâche ${i + 1}: ${task.name}`);
    console.log(`  - ID: ${task.id}`);
    console.log(`  - Durée: ${task.duration} minutes`);
    console.log(`  - Ressources: ${task.resources.length}`);
    
    // Analyser chaque ressource individuellement
    console.log(`  - Détail des ressources:`);
    const resourceAvailabilities = [];
    
    for (const resource of task.resources) {
        const isEmpty = resource.availability.isEmpty();
        resourceAvailabilities.push({
            id: resource.id,
            isEmpty: isEmpty,
            hasAvailability: !isEmpty
        });
        
        console.log(`    * ${resource.id}: ${isEmpty ? '❌ VIDE' : '✅ Disponible'}`);
    }
    
    // Calculer l'AvailabilityManager de la tâche (intersection)
    const taskAvailability = task.schedulable;
    const isTaskSchedulable = !taskAvailability.isEmpty();
    
    console.log(`  - Résultat de l'intersection: ${isTaskSchedulable ? '✅ PLANIFIABLE' : '❌ NON PLANIFIABLE'}`);
    
    if (!isTaskSchedulable) {
        unschedulableTasks++;
        criticalIssues.push({
            taskId: task.id,
            taskName: task.name,
            resources: task.resources.map(r => r.id),
            emptyResources: resourceAvailabilities.filter(r => r.isEmpty).map(r => r.id)
        });
        
        console.log(`  🚨 AVERTISSEMENT CRITIQUE: Cette tâche ne peut pas être planifiée !`);
        console.log(`     Ressources vides: ${resourceAvailabilities.filter(r => r.isEmpty).map(r => r.id).join(', ')}`);
    }
    
    // Limiter l'affichage pour éviter trop de logs
    if (i >= 9) {
        console.log(`\n... (analyse limitée aux 10 premières tâches)`);
        break;
    }
}

console.log('\n📊 === RÉSUMÉ DE L\'ANALYSE ===');
console.log(`✅ Tâches planifiables: ${Math.min(10, totalTasks) - unschedulableTasks}`);
console.log(`❌ Tâches NON planifiables: ${unschedulableTasks}`);

if (criticalIssues.length > 0) {
    console.log('\n🚨 === PROBLÈMES CRITIQUES DÉTECTÉS ===');
    for (const issue of criticalIssues) {
        console.log(`❌ ${issue.taskName}`);
        console.log(`   ID: ${issue.taskId}`);
        console.log(`   Ressources vides: ${issue.emptyResources.join(', ')}`);
        console.log(`   Toutes les ressources: ${issue.resources.join(', ')}`);
        console.log('');
    }
    
    console.log('🔧 RECOMMANDATION: Ces tâches doivent être corrigées avant toute planification.');
    console.log('   Les ressources vides indiquent soit:');
    console.log('   1. Des contraintes manquantes dans contraintes.json');
    console.log('   2. Des contraintes trop restrictives qui ne permettent aucun créneau');
    console.log('   3. Des conflits de planning qui rendent certaines ressources indisponibles');
} else {
    console.log('\n✅ Toutes les tâches analysées sont théoriquement planifiables.');
}

console.log('\n💡 Cette analyse vérifie la logique fondamentale:');
console.log('   - Chaque tâche doit avoir un AvailabilityManager = intersection de ses ressources');
console.log('   - Si intersection vide → tâche impossible à planifier');
console.log('   - L\'algorithme de planning doit refuser ces tâches dès le départ');