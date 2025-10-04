/**
 * Script de test pour vérifier le chargement des Tasks avec la nouvelle structure Resource[][]
 */

import { Loader } from '../lib/loader.js';
import { ResourceType } from '../resource.js';

console.log('='.repeat(80));
console.log('TEST DU CHARGEMENT DES TASKS AVEC LA NOUVELLE STRUCTURE');
console.log('='.repeat(80));

try {
    // Charger les tâches
    console.log('\n📚 Chargement des tâches...\n');
    const tasks = Loader.tasks;
    
    console.log(`\n✅ ${tasks.length} tâches chargées avec succès`);
    console.log(`📅 Semaine: ${Loader.currentWeek}`);
    
    // Vérifier la structure des ressources pour quelques tâches
    console.log('\n' + '='.repeat(80));
    console.log('VÉRIFICATION DE LA STRUCTURE DES RESSOURCES');
    console.log('='.repeat(80));
    
    // Analyser les 5 premières tâches
    const samplesToCheck = Math.min(5, tasks.length);
    
    for (let i = 0; i < samplesToCheck; i++) {
        const task = tasks[i];
        console.log(`\n--- Tâche ${i + 1}: ${task.code} (${task.name}) ---`);
        console.log(`ID: ${task.id}`);
        console.log(`Type: ${task.type}`);
        console.log(`Durée: ${task.duration} minutes`);
        
        // Vérifier les ressources par type
        console.log('\nStructure des ressources (Resource[][]):');
        
        for (const type of [ResourceType.TEACHER, ResourceType.ROOM, ResourceType.GROUP]) {
            const resourceGroups = task.resources[type];
            console.log(`  ${type}:`);
            
            if (resourceGroups.length === 0) {
                console.log(`    (aucune ressource de ce type)`);
            } else {
                resourceGroups.forEach((group, groupIndex) => {
                    const resourceIds = group.map(r => r.id).join(' OU ');
                    console.log(`    Groupe ${groupIndex + 1}: [${resourceIds}]`);
                });
            }
        }
        
        // Vérifier les salles disponibles
        console.log(`\nSalles disponibles (availableRooms): ${task.availableRooms.length}`);
        if (task.availableRooms.length > 0) {
            console.log(`  ${task.availableRooms.map(r => r.id).join(', ')}`);
        }
        
        // Tester getApplicableResources()
        console.log('\nCombinaisons applicables:');
        try {
            const combinations = task.getApplicableResources();
            console.log(`  Nombre de combinaisons: ${combinations.length}`);
            
            if (combinations.length > 0 && combinations.length <= 3) {
                // Afficher toutes les combinaisons si peu nombreuses
                combinations.forEach((combo, idx) => {
                    const comboStr = combo.map(r => `${r.id}(${r.type})`).join(', ');
                    console.log(`  Combo ${idx + 1}: [${comboStr}]`);
                });
            } else if (combinations.length > 3) {
                // Afficher seulement la première si nombreuses
                const comboStr = combinations[0].map(r => `${r.id}(${r.type})`).join(', ');
                console.log(`  Exemple (combo 1): [${comboStr}]`);
            }
        } catch (error) {
            console.error(`  ❌ Erreur lors de getApplicableResources(): ${error}`);
        }
    }
    
    // Statistiques globales
    console.log('\n' + '='.repeat(80));
    console.log('STATISTIQUES GLOBALES');
    console.log('='.repeat(80));
    
    let totalTeacherGroups = 0;
    let totalRoomGroups = 0;
    let totalGroupGroups = 0;
    let tasksWithMultipleTeachers = 0;
    let tasksWithMultipleRooms = 0;
    
    for (const task of tasks) {
        const teacherGroups = task.resources[ResourceType.TEACHER];
        const roomGroups = task.resources[ResourceType.ROOM];
        const groupGroups = task.resources[ResourceType.GROUP];
        
        totalTeacherGroups += teacherGroups.length;
        totalRoomGroups += roomGroups.length;
        totalGroupGroups += groupGroups.length;
        
        // Compter les tâches avec plusieurs enseignants dans un groupe alternatif
        if (teacherGroups.some(group => group.length > 1)) {
            tasksWithMultipleTeachers++;
        }
        
        // Compter les tâches avec plusieurs salles dans un groupe alternatif
        if (roomGroups.some(group => group.length > 1)) {
            tasksWithMultipleRooms++;
        }
    }
    
    console.log(`\nNombre total de tâches: ${tasks.length}`);
    console.log(`\nGroupes de ressources:`);
    console.log(`  Groupes TEACHER: ${totalTeacherGroups}`);
    console.log(`  Groupes ROOM: ${totalRoomGroups}`);
    console.log(`  Groupes GROUP: ${totalGroupGroups}`);
    
    console.log(`\nTâches avec alternatives:`);
    console.log(`  Tâches avec plusieurs enseignants alternatifs: ${tasksWithMultipleTeachers}`);
    console.log(`  Tâches avec plusieurs salles alternatives: ${tasksWithMultipleRooms}`);
    
    // Vérifier si toutes les tâches ont au moins une combinaison applicable
    console.log('\n' + '='.repeat(80));
    console.log('VALIDATION DES COMBINAISONS');
    console.log('='.repeat(80));
    
    let tasksWithNoCombinations = 0;
    const problematicTasks: string[] = [];
    
    for (const task of tasks) {
        try {
            const combinations = task.getApplicableResources();
            if (combinations.length === 0) {
                tasksWithNoCombinations++;
                problematicTasks.push(`${task.id} (${task.code})`);
            }
        } catch (error) {
            tasksWithNoCombinations++;
            problematicTasks.push(`${task.id} (${task.code}) - ERREUR: ${error}`);
        }
    }
    
    if (tasksWithNoCombinations === 0) {
        console.log('\n✅ Toutes les tâches ont au moins une combinaison de ressources applicable');
    } else {
        console.log(`\n⚠️  ${tasksWithNoCombinations} tâche(s) sans combinaison applicable:`);
        problematicTasks.forEach(taskInfo => console.log(`  - ${taskInfo}`));
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('TEST TERMINÉ AVEC SUCCÈS ✅');
    console.log('='.repeat(80));
    
} catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ ERREUR LORS DU TEST');
    console.error('='.repeat(80));
    console.error(error);
    process.exit(1);
}
