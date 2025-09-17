import { Loader } from './lib/loader.js';

/**
 * Test de validation des conflits de planification
 */

console.log('🔍 === ANALYSE DES CONFLITS DE PLANIFICATION ===\n');

// Charger les données
console.log('📋 Chargement des données...');
console.log(`📅 Semaine courante: ${Loader.currentWeek}`);
console.log(`📋 Nombre de tâches: ${Loader.tasks.length}`);
console.log(`🏢 Nombre de ressources: ${Loader.resourcesManager.getResourceCount()}`);

// Analyser les premières tâches pour comprendre les ressources
console.log('\n🔍 Analyse des ressources des premières tâches:');
for (let i = 0; i < Math.min(5, Loader.tasks.length); i++) {
    const task = Loader.tasks[i];
    console.log(`Tâche ${i + 1}: ${task.name}`);
    console.log(`  - ID: ${task.id}`);
    console.log(`  - Durée: ${task.duration} minutes`);
    console.log(`  - Total ressources: ${task.resources.length}`);
    
    // Vérifier les ressources communes avec d'autres tâches
    const conflictingTasks = [];
    for (let j = i + 1; j < Math.min(10, Loader.tasks.length); j++) {
        const otherTask = Loader.tasks[j];
        const sharedResources = task.resources.filter(r => otherTask.resources.includes(r));
        if (sharedResources.length > 0) {
            conflictingTasks.push({
                taskName: otherTask.name,
                sharedCount: sharedResources.length,
                shared: sharedResources.map(r => r.id).join(', ')
            });
        }
    }
    
    if (conflictingTasks.length > 0) {
        console.log(`  ⚠️  Ressources partagées avec:`);
        conflictingTasks.slice(0, 3).forEach(conflict => {
            console.log(`    - ${conflict.taskName} (${conflict.sharedCount} ressources: ${conflict.shared})`);
        });
        if (conflictingTasks.length > 3) {
            console.log(`    - ... et ${conflictingTasks.length - 3} autres tâches`);
        }
    }
    console.log('');
}

// Analyser les ressources les plus partagées
console.log('📊 Analyse des ressources les plus utilisées:');
const resourceUsage = new Map();
for (const task of Loader.tasks) {
    for (const resource of task.resources) {
        const count = resourceUsage.get(resource.id) || 0;
        resourceUsage.set(resource.id, count + 1);
    }
}

const sortedResources = Array.from(resourceUsage.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

for (const [resourceId, count] of sortedResources) {
    console.log(`  ${resourceId}: utilisé dans ${count} tâches`);
}

console.log('\n🎯 Conclusion: Le problème vient probablement du fait que de nombreuses tâches');
console.log('partagent les mêmes ressources (salles, groupes, professeurs) et l\'algorithme');
console.log('n\'empêche pas correctement les conflits lors de l\'assignation.');