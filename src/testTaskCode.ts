#!/usr/bin/env tsx

import { Loader } from './lib/loader.js';

// Test pour vérifier que la propriété code est bien ajoutée aux tâches
console.log('🔄 Test de la propriété code des tâches...');

// Chargement des ressources et tâches
await Loader.loadResources();
await Loader.loadTasks(36);

console.log(`📋 ${Loader.tasks.length} tâches chargées`);

// Vérification que les premières tâches ont bien la propriété code
console.log('\n📝 Vérification des propriétés code des 5 premières tâches:');
for (let i = 0; i < Math.min(5, Loader.tasks.length); i++) {
    const task = Loader.tasks[i];
    console.log(`${i + 1}. ${task.name}`);
    console.log(`   📋 ID: ${task.id}`);
    console.log(`   🏷️ Code: ${task.code}`);
    console.log(`   ⏱️ Durée: ${task.duration} minutes`);
    console.log('');
}

// Vérification que toutes les tâches ont une propriété code non vide
const tasksWithoutCode = Loader.tasks.filter(task => !task.code || task.code.trim() === '');
if (tasksWithoutCode.length === 0) {
    console.log('✅ Toutes les tâches ont une propriété code valide !');
} else {
    console.log(`⚠️ ${tasksWithoutCode.length} tâches sans propriété code trouvées:`);
    tasksWithoutCode.forEach(task => {
        console.log(`   - ${task.name} (ID: ${task.id})`);
    });
}

// Test des codes uniques vs dupliqués
const codeCount = new Map<string, number>();
Loader.tasks.forEach(task => {
    codeCount.set(task.code, (codeCount.get(task.code) || 0) + 1);
});

const uniqueCodes = Array.from(codeCount.keys()).length;
const duplicatedCodes = Array.from(codeCount.entries()).filter(([, count]) => count > 1);

console.log(`\n📊 Statistiques des codes:`);
console.log(`   🎯 Codes uniques: ${uniqueCodes}`);
console.log(`   📋 Total des tâches: ${Loader.tasks.length}`);

if (duplicatedCodes.length > 0) {
    console.log(`   🔄 Codes dupliqués (${duplicatedCodes.length}):`);
    duplicatedCodes.forEach(([code, count]) => {
        console.log(`      - ${code}: ${count} fois`);
    });
} else {
    console.log(`   ✅ Aucun code dupliqué !`);
}