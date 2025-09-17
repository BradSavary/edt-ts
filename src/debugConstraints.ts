import { ConstraintsManager } from './constraintsManager.js';

console.log('🔍 === ANALYSE DES CONTRAINTES ===\n');

// Tester l'accès aux contraintes par défaut
console.log('Test des contraintes Default:');
const hasDefault = ConstraintsManager.hasResource('Default');
console.log(`hasResource('Default'): ${hasDefault}`);

if (hasDefault) {
    const defaultManager = ConstraintsManager.getAvailabilityManager('Default');
    console.log(`getAvailabilityManager('Default'): ${defaultManager ? 'OUI' : 'NON'}`);
    
    if (defaultManager) {
        console.log('Test de quelques créneaux:');
        // Tester des créneaux en heures de cours (8h-19h30)
        // Créneau 0 = lundi 8h00-9h30
        const tests = [
            { slot: 0, desc: 'Lundi 8h00-9h30' },
            { slot: 8, desc: 'Lundi 20h00-21h30' }, // En dehors
            { slot: 24, desc: 'Mardi 8h00-9h30' },
            { slot: 96, desc: 'Vendredi 8h00-9h30' },
            { slot: 107, desc: 'Vendredi 19h30-21h00' } // En dehors
        ];
        
        tests.forEach(test => {
            const available = defaultManager.isAvailable(test.slot, test.slot + 1);
            console.log(`  ${test.desc} (créneau ${test.slot}): ${available ? '✅' : '❌'}`);
        });
    }
}

// Tester une ressource avec contraintes null
console.log('\nTest de la ressource 101 (null):');
const has101 = ConstraintsManager.hasResource('101');
console.log(`hasResource('101'): ${has101}`);

if (has101) {
    const manager101 = ConstraintsManager.getAvailabilityManager('101');
    console.log(`getAvailabilityManager('101'): ${manager101 ? 'OUI' : 'NON'}`);
    
    if (manager101) {
        const available = manager101.isAvailable(0, 1);
        console.log(`  Créneau 0 disponible: ${available ? '✅' : '❌'}`);
    }
}

// Tester une ressource avec contraintes définies
console.log('\nTest de la ressource ROUSSEAU Camille:');
const hasAdamczyk = ConstraintsManager.hasResource('ROUSSEAU Camille');
console.log(`hasResource('ROUSSEAU Camille'): ${hasAdamczyk}`);

if (hasAdamczyk) {
    const managerAdamczyk = ConstraintsManager.getAvailabilityManager('ROUSSEAU Camille');
    console.log(`getAvailabilityManager('ROUSSEAU Camille'): ${managerAdamczyk ? 'OUI' : 'NON'}`);
    
    if (managerAdamczyk) {
        const available = managerAdamczyk.isAvailable(0, 1);
        console.log(`  Créneau 0 disponible: ${available ? '✅' : '❌'}`);
    }
}
