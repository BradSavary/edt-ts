import { Loader } from './lib/loader.js';
import { ConstraintsManager } from './constraintsManager.js';

console.log('🔍 === ANALYSE DES RESSOURCES ===\n');

console.log(`📅 Semaine courante: ${Loader.currentWeek}`);
console.log(`🏢 Nombre de ressources: ${Loader.resourcesManager.getResourceCount()}`);

// Analyser quelques ressources
const resources = Array.from(Loader.resourcesManager.getAllResources());
console.log('\n📋 Premières ressources:');

resources.slice(0, 10).forEach(resource => {
    console.log(`\n  - ${resource.id} (type: ${resource.type})`);
    
    // Vérifier si la ressource a des contraintes
    const hasConstraints = ConstraintsManager.hasResource(resource.id);
    console.log(`    Contraintes définies: ${hasConstraints ? 'OUI' : 'NON'}`);
    
    if (hasConstraints) {
        const availabilityManager = ConstraintsManager.getAvailabilityManager(resource.id, Loader.currentWeek || undefined);
        console.log(`    AvailabilityManager: ${availabilityManager ? 'OUI' : 'NON'}`);
        
        if (availabilityManager) {
            // Tester la disponibilité sur quelques créneaux
            const availability = [];
            for (let i = 0; i < 10; i++) {
                const isAvailable = availabilityManager.isAvailable(i, i + 1);
                availability.push(isAvailable ? '✅' : '❌');
            }
            console.log(`    Créneaux 0-9: ${availability.join('')}`);
        }
    } else {
        console.log(`    ⚠️ Aucune contrainte définie pour cette ressource`);
    }
});

// Tester avec les contraintes par défaut
console.log('\n📋 Test des contraintes par défaut:');
const defaultAvailability = ConstraintsManager.getAvailabilityManager('Default');
if (defaultAvailability) {
    console.log('✅ Contraintes par défaut trouvées');
    const availability = [];
    for (let i = 0; i < 10; i++) {
        const isAvailable = defaultAvailability.isAvailable(i, i + 1);
        availability.push(isAvailable ? '✅' : '❌');
    }
    console.log(`Créneaux 0-9: ${availability.join('')}`);
} else {
    console.log('❌ Aucune contrainte par défaut trouvée');
}
