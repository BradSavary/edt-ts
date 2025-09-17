#!/usr/bin/env tsx

import { Loader } from './lib/loader.js';

// Test spécifique pour vérifier l'unicité des IDs
console.log('🔄 Test de l\'unicité des IDs des tâches...');

// Chargement des ressources et tâches
await Loader.loadResources();
await Loader.loadTasks(36);

console.log(`📋 ${Loader.tasks.length} tâches chargées`);

// Vérification de l'unicité des IDs
const idSet = new Set<string>();
const duplicateIds: string[] = [];

for (const task of Loader.tasks) {
    if (idSet.has(task.id)) {
        duplicateIds.push(task.id);
    } else {
        idSet.add(task.id);
    }
}

if (duplicateIds.length === 0) {
    console.log('✅ Tous les IDs des tâches sont uniques !');
} else {
    console.log(`❌ ${duplicateIds.length} IDs dupliqués trouvés:`);
    duplicateIds.forEach(id => {
        console.log(`   - ${id}`);
    });
}

// Afficher quelques exemples d'IDs pour vérifier le format
console.log('\n📝 Exemples d\'IDs générés (10 premiers):');
for (let i = 0; i < Math.min(10, Loader.tasks.length); i++) {
    const task = Loader.tasks[i];
    console.log(`${i + 1}. ${task.id}`);
}

// Vérifier que les IDs se terminent bien par des numéros croissants
console.log('\n🔢 Vérification de la numérotation séquentielle:');
let allSequential = true;
for (let i = 0; i < Loader.tasks.length; i++) {
    const task = Loader.tasks[i];
    const expectedNumber = i + 1;
    const actualNumber = parseInt(task.id.split('_').pop() || '0');
    
    if (actualNumber !== expectedNumber) {
        console.log(`❌ Tâche ${i}: attendu ${expectedNumber}, trouvé ${actualNumber}`);
        allSequential = false;
        break;
    }
}

if (allSequential) {
    console.log('✅ La numérotation séquentielle est correcte !');
} else {
    console.log('❌ Problème dans la numérotation séquentielle.');
}

console.log(`\n📊 Résumé:`);
console.log(`   🎯 Total des tâches: ${Loader.tasks.length}`);
console.log(`   🆔 IDs uniques: ${idSet.size}`);
console.log(`   ✅ Unicité: ${duplicateIds.length === 0 ? 'OUI' : 'NON'}`);
console.log(`   🔢 Numérotation: ${allSequential ? 'CORRECTE' : 'INCORRECTE'}`);