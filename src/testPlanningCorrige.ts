#!/usr/bin/env tsx

import { Loader } from './lib/loader.js';
import { Schedule } from './schedule.js';

// Chargement des données
console.log('🔄 Chargement des données...');
await Loader.loadResources();
await Loader.loadTasks(36);

console.log(`📋 ${Loader.tasks.length} tâches chargées`);
console.log(`🏢 ${Loader.resourcesManager.getAllResources().length} ressources chargées`);

// Lancement de la résolution
console.log('\n🚀 Lancement de la résolution avec l\'algorithme corrigé...');
const schedule = new Schedule();
const solution = schedule.solve();

console.log('\n📊 Résultats de la planification:');
console.log(`✅ Planification complète: ${solution.isComplete ? 'OUI' : 'NON'}`);
console.log(`📋 Tâches planifiées: ${solution.solutions.length}/${Loader.tasks.length}`);
console.log(`⚠️ Nombre de conflits: ${solution.conflictCount}`);

if (solution.conflictCount > 0) {
    console.log('\n🚨 ATTENTION: Des conflits subsistent!');
} else {
    console.log('\n✅ Aucun conflit détecté!');
}

// Analyse détaillée des premières tâches planifiées
console.log('\n📋 Détail des 10 premières tâches planifiées:');
for (let i = 0; i < Math.min(10, solution.solutions.length); i++) {
    const sol = solution.solutions[i];
    const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
    const day = Math.floor(sol.startTime / 8);
    const timeSlot = sol.startTime % 8;
    const hour = 8 + timeSlot * 1.5;
    
    console.log(`${i + 1}. ${sol.task.name}`);
    console.log(`   📅 ${dayNames[day]} ${Math.floor(hour)}h${(hour % 1) * 60 || '00'}`);
    console.log(`   🏢 Ressources: ${sol.assignedResources.map(r => r.id).join(', ')}`);
    console.log('');
}

// Vérification spécifique des ressources partagées
console.log('\n🔍 Vérification des ressources les plus utilisées:');
const resourceUsage = new Map<string, number>();

for (const sol of solution.solutions) {
    for (const resource of sol.assignedResources) {
        resourceUsage.set(resource.id, (resourceUsage.get(resource.id) || 0) + 1);
    }
}

// Trier par usage décroissant
const sortedUsage = Array.from(resourceUsage.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

for (const [resourceId, count] of sortedUsage) {
    console.log(`📊 ${resourceId}: utilisé dans ${count} tâches`);
}