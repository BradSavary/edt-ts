import { Loader } from './lib/loader.js';

/**
 * Test détaillé des créneaux disponibles pour analyser les intersections
 */

console.log('🔍 === ANALYSE DÉTAILLÉE DES CRÉNEAUX DISPONIBLES ===\n');

// Charger les données
console.log('📋 Chargement des données...');

// Analyser une tâche en détail
const task = Loader.tasks[0]; // Première tâche
console.log(`\n📝 Analyse détaillée de: ${task.name}`);
console.log(`ID: ${task.id}`);
console.log(`Ressources: ${task.resources.length}`);

console.log('\n🔍 Disponibilités individuelles des ressources:');
for (const resource of task.resources) {
    console.log(`\n--- ${resource.id} ---`);
    console.log(`Vide: ${resource.availability.isEmpty()}`);
    
    // Afficher les créneaux si pas vide
    if (!resource.availability.isEmpty()) {
        const slots = resource.availability.findAvailableSlots(90); // 90 minutes
        console.log(`Nombre de créneaux de 90min: ${slots.length}`);
        
        // Afficher les premiers créneaux
        slots.slice(0, 5).forEach((slot: any, index: number) => {
            const day = Math.floor(slot.start / (24 * 60));
            const hour = Math.floor((slot.start % (24 * 60)) / 60);
            const minute = (slot.start % (24 * 60)) % 60;
            
            const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
            console.log(`  ${index + 1}. ${dayNames[day]} ${hour}h${minute.toString().padStart(2, '0')} - ${Math.floor(slot.end / 60)}h${(slot.end % 60).toString().padStart(2, '0')}`);
        });
        
        if (slots.length > 5) {
            console.log(`  ... et ${slots.length - 5} autres créneaux`);
        }
    }
}

console.log('\n🎯 Intersection (AvailabilityManager de la tâche):');
const taskAvailability = task.schedulable;
console.log(`Vide: ${taskAvailability.isEmpty()}`);

if (!taskAvailability.isEmpty()) {
    const taskSlots = taskAvailability.findAvailableSlots(90);
    console.log(`Nombre de créneaux communs de 90min: ${taskSlots.length}`);
    
    console.log('\nCréneaux disponibles pour cette tâche:');
    taskSlots.slice(0, 10).forEach((slot: any, index: number) => {
        const day = Math.floor(slot.start / (24 * 60));
        const hour = Math.floor((slot.start % (24 * 60)) / 60);
        const minute = (slot.start % (24 * 60)) % 60;
        
        const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
        console.log(`  ${index + 1}. ${dayNames[day]} ${hour}h${minute.toString().padStart(2, '0')} - ${Math.floor(slot.end / 60)}h${(slot.end % 60).toString().padStart(2, '0')}`);
    });
    
    if (taskSlots.length > 10) {
        console.log(`  ... et ${taskSlots.length - 10} autres créneaux`);
    }
}

// Analyser plusieurs tâches pour voir les conflits potentiels
console.log('\n📊 === CONFLITS POTENTIELS ENTRE TÂCHES ===');
const tasksToAnalyze = Loader.tasks.slice(0, 5);

for (let i = 0; i < tasksToAnalyze.length; i++) {
    for (let j = i + 1; j < tasksToAnalyze.length; j++) {
        const task1 = tasksToAnalyze[i];
        const task2 = tasksToAnalyze[j];
        
        // Vérifier les ressources partagées
        const sharedResources = task1.resources.filter(r => task2.resources.includes(r));
        
        if (sharedResources.length > 0) {
            console.log(`\n⚠️  CONFLIT POTENTIEL:`);
            console.log(`Task 1: ${task1.name}`);
            console.log(`Task 2: ${task2.name}`);
            console.log(`Ressources partagées: ${sharedResources.map(r => r.id).join(', ')}`);
            
            // Calculer l'intersection des disponibilités
            const intersectionAvailability = task1.schedulable.intersect(task2.schedulable);
            const intersectionSlots = intersectionAvailability.findAvailableSlots(90);
            
            console.log(`Créneaux communs possibles: ${intersectionSlots.length}`);
            
            if (intersectionSlots.length === 0) {
                console.log(`🚨 CES DEUX TÂCHES NE PEUVENT PAS COEXISTER!`);
            } else if (intersectionSlots.length < 5) {
                console.log(`⚠️  Très peu de créneaux communs disponibles`);
            }
        }
    }
}