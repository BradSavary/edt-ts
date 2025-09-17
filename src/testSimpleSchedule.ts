import { Loader } from './lib/loader.js';

/**
 * Test simplifié de planification sans backtracking
 */
console.log('🧪 === TEST SIMPLIFIÉ DE PLANIFICATION ===\n');

console.log(`📅 Semaine courante: ${Loader.currentWeek}`);
console.log(`📋 Nombre de tâches: ${Loader.tasks.length}`);
console.log(`🏢 Nombre de ressources: ${Loader.resourcesManager.getResourceCount()}`);

// Fonction pour convertir créneau en minutes
function slotToMinutes(slot: number): number {
    const dayIndex = Math.floor(slot / 8); // 8 créneaux par jour
    const slotInDay = slot % 8;
    const hourStart = 8 + slotInDay * 1.5; // Début à 8h, créneaux de 1.5h
    
    return dayIndex * 24 * 60 + hourStart * 60;
}

// Planification séquentielle simple (sans backtracking)
const plannedTasks: Array<{task: any, slot: number, resources: any[]}> = [];
let totalAttempts = 0;
let successfulPlacements = 0;

console.log('\n🚀 Planification séquentielle simple...\n');

for (const task of Loader.tasks.slice(0, 10)) { // Tester sur les 10 premières tâches
    console.log(`🔍 Planification de: ${task.name} (durée: ${task.duration}min)`);
    totalAttempts++;
    
    let placed = false;
    
    // Essayer chaque créneau
    for (let slot = 0; slot < 40 && !placed; slot++) {
        const startMinutes = slotToMinutes(slot);
        const endMinutes = startMinutes + task.duration;
        
        // Vérifier si toutes les ressources de la tâche sont disponibles
        let allResourcesAvailable = true;
        const availableResources = [];
        
        for (const resource of task.resources) {
            if (resource.availability.isAvailable(startMinutes, endMinutes)) {
                availableResources.push(resource);
            } else {
                allResourcesAvailable = false;
                break;
            }
        }
        
        if (allResourcesAvailable && availableResources.length === task.resources.length) {
            // Placer la tâche
            plannedTasks.push({
                task,
                slot,
                resources: availableResources
            });
            
            // Marquer les ressources comme occupées
            for (const resource of availableResources) {
                resource.availability.book(startMinutes, endMinutes);
            }
            
            const dayIndex = Math.floor(slot / 8) + 1;
            const slotInDay = slot % 8;
            const hourStart = 8 + slotInDay * 1.5;
            const hourEnd = hourStart + (task.duration / 60);
            
            console.log(`  ✅ Placée au créneau ${slot} (Jour ${dayIndex}, ${hourStart}h-${hourEnd}h)`);
            console.log(`     Ressources: ${availableResources.map(r => r.id).join(', ')}`);
            
            placed = true;
            successfulPlacements++;
        }
    }
    
    if (!placed) {
        console.log(`  ❌ Impossible de placer cette tâche`);
    }
}

console.log('\n📊 === RÉSULTATS ===');
console.log(`✅ Tâches planifiées: ${successfulPlacements}/${totalAttempts}`);
console.log(`📈 Taux de réussite: ${Math.round((successfulPlacements/totalAttempts)*100)}%`);

if (plannedTasks.length > 0) {
    console.log('\n📅 === PLANNING FINAL ===');
    plannedTasks
        .sort((a, b) => a.slot - b.slot)
        .forEach(({task, slot, resources}) => {
            const dayIndex = Math.floor(slot / 8) + 1;
            const slotInDay = slot % 8;
            const hourStart = 8 + slotInDay * 1.5;
            const hourEnd = hourStart + (task.duration / 60);
            console.log(`📍 ${task.name} - Jour ${dayIndex}, ${hourStart}h-${hourEnd}h (${resources.map(r => r.id).slice(0, 3).join(', ')}${resources.length > 3 ? '...' : ''})`);
        });
}
