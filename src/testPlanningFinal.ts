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

// Analyse des vrais conflits temporels
console.log('\n🔍 Vérification des conflits temporels réels...');

type ConflictInfo = {
    task1: string;
    task2: string;
    resource: string;
    timeSlot: number;
};

const realConflicts: ConflictInfo[] = [];

// Grouper les solutions par créneaux temporels
const solutionsByTimeSlot = new Map<number, Array<{ task: any, resources: any[] }>>();

for (const sol of solution.solutions) {
    if (!solutionsByTimeSlot.has(sol.startTime)) {
        solutionsByTimeSlot.set(sol.startTime, []);
    }
    solutionsByTimeSlot.get(sol.startTime)!.push({
        task: sol.task,
        resources: sol.assignedResources
    });
}

// Vérifier les conflits pour chaque créneau
for (const [timeSlot, tasksInSlot] of solutionsByTimeSlot) {
    if (tasksInSlot.length <= 1) continue;
    
    // Comparer toutes les paires de tâches dans ce créneau
    for (let i = 0; i < tasksInSlot.length; i++) {
        for (let j = i + 1; j < tasksInSlot.length; j++) {
            const task1 = tasksInSlot[i];
            const task2 = tasksInSlot[j];
            
            // Vérifier les ressources partagées
            const sharedResources = task1.resources.filter(r1 => 
                task2.resources.some(r2 => r1.id === r2.id)
            );
            
            for (const sharedResource of sharedResources) {
                realConflicts.push({
                    task1: task1.task.name,
                    task2: task2.task.name,
                    resource: sharedResource.id,
                    timeSlot: timeSlot
                });
            }
        }
    }
}

console.log(`⚠️ Conflits temporels réels détectés: ${realConflicts.length}`);

if (realConflicts.length > 0) {
    console.log('\n🚨 Liste des conflits réels:');
    for (let i = 0; i < Math.min(10, realConflicts.length); i++) {
        const conflict = realConflicts[i];
        const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
        const day = Math.floor(conflict.timeSlot / 8);
        const timeSlotInDay = conflict.timeSlot % 8;
        const hour = 8 + timeSlotInDay * 1.5;
        
        console.log(`${i + 1}. ${dayNames[day]} ${Math.floor(hour)}h${(hour % 1) * 60 || '00'}`);
        console.log(`   🚨 Ressource "${conflict.resource}" utilisée par:`);
        console.log(`   📋 ${conflict.task1}`);
        console.log(`   📋 ${conflict.task2}`);
        console.log('');
    }
} else {
    console.log('\n✅ Aucun conflit temporel réel détecté!');
}

// Statistiques par jour
console.log('\n📅 Répartition des tâches par jour:');
const tasksByDay = new Map<number, number>();

for (const sol of solution.solutions) {
    const day = Math.floor(sol.startTime / 8);
    tasksByDay.set(day, (tasksByDay.get(day) || 0) + 1);
}

const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
for (let day = 0; day < 5; day++) {
    const count = tasksByDay.get(day) || 0;
    console.log(`📊 ${dayNames[day]}: ${count} tâches`);
}

// Analyse des tâches non planifiées
const scheduledTaskIds = new Set(solution.solutions.map(sol => sol.task.id));
const unscheduledTasks = Loader.tasks.filter(task => !scheduledTaskIds.has(task.id));

if (unscheduledTasks.length > 0) {
    console.log(`\n⚠️ Tâches non planifiées (${unscheduledTasks.length}):`)
    for (const task of unscheduledTasks) {
        console.log(`📋 ${task.name}`);
    }
}

console.log('\n🎯 Résumé final:');
console.log(`✅ Taux de réussite: ${((solution.solutions.length / Loader.tasks.length) * 100).toFixed(1)}%`);
console.log(`✅ Conflits réels: ${realConflicts.length}`);
console.log(`✅ Algorithme fonctionnel: ${realConflicts.length === 0 ? 'OUI' : 'NON'}`);