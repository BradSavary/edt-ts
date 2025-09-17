#!/usr/bin/env tsx

import { Loader } from './lib/loader.js';
import { Schedule } from './schedule.js';

// Chargement des données
console.log('🔄 Chargement des données...');
await Loader.loadResources();
await Loader.loadTasks(36);

// Lancement de la résolution
console.log('\n🚀 Lancement de la résolution...');
const schedule = new Schedule();
const solution = schedule.solve();

console.log('\n📊 Résultats de la planification:');
console.log(`✅ Planification complète: ${solution.isComplete ? 'OUI' : 'NON'}`);
console.log(`📋 Tâches planifiées: ${solution.solutions.length}/${Loader.tasks.length}`);
console.log(`⚠️ Nombre de conflits: ${solution.conflictCount}`);

// Analyse détaillée des conflits RÉELS
console.log('\n🔍 Analyse détaillée des conflits réels:');

const realConflicts: Array<{
    task1: string,
    task2: string,
    sharedResources: string[],
    time1: string,
    time2: string
}> = [];

const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

function getTimeString(startTime: number): string {
    const day = Math.floor(startTime / 8);
    const timeSlot = startTime % 8;
    const hour = 8 + timeSlot * 1.5;
    return `${dayNames[day]} ${Math.floor(hour)}h${(hour % 1) * 60 || '00'}`;
}

function hasTimeConflict(sol1: any, sol2: any): boolean {
    const duration1 = Math.ceil(sol1.task.duration / 90);
    const duration2 = Math.ceil(sol2.task.duration / 90);
    const end1 = sol1.startTime + duration1;
    const end2 = sol2.startTime + duration2;
    
    return !(end1 <= sol2.startTime || sol1.startTime >= end2);
}

// Vérifier les conflits entre toutes les paires de tâches planifiées
for (let i = 0; i < solution.solutions.length; i++) {
    for (let j = i + 1; j < solution.solutions.length; j++) {
        const sol1 = solution.solutions[i];
        const sol2 = solution.solutions[j];
        
        // Vérifier s'il y a un conflit temporel
        if (hasTimeConflict(sol1, sol2)) {
            // Vérifier s'il y a des ressources partagées
            const sharedResources = sol1.assignedResources.filter(r1 => 
                sol2.assignedResources.some(r2 => r2.id === r1.id)
            );
            
            if (sharedResources.length > 0) {
                realConflicts.push({
                    task1: sol1.task.name,
                    task2: sol2.task.name,
                    sharedResources: sharedResources.map(r => r.id),
                    time1: getTimeString(sol1.startTime),
                    time2: getTimeString(sol2.startTime)
                });
            }
        }
    }
}

console.log(`🚨 Conflits RÉELS détectés: ${realConflicts.length}`);

if (realConflicts.length > 0) {
    console.log('\n📋 Détail des 10 premiers conflits réels:');
    for (let i = 0; i < Math.min(10, realConflicts.length); i++) {
        const conflict = realConflicts[i];
        console.log(`${i + 1}. Conflit entre:`);
        console.log(`   📚 "${conflict.task1}" (${conflict.time1})`);
        console.log(`   📚 "${conflict.task2}" (${conflict.time2})`);
        console.log(`   🏢 Ressources partagées: ${conflict.sharedResources.join(', ')}`);
        console.log('');
    }
    
    // Analyser les ressources les plus en conflit
    const conflictResourceCount = new Map<string, number>();
    for (const conflict of realConflicts) {
        for (const resource of conflict.sharedResources) {
            conflictResourceCount.set(resource, (conflictResourceCount.get(resource) || 0) + 1);
        }
    }
    
    const sortedConflictResources = Array.from(conflictResourceCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    console.log('\n🚨 Ressources les plus en conflit:');
    for (const [resource, count] of sortedConflictResources) {
        console.log(`📊 ${resource}: ${count} conflits`);
    }
} else {
    console.log('✅ Aucun conflit réel détecté !');
}