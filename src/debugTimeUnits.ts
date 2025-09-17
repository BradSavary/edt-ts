import { ConstraintsManager } from './constraintsManager.js';

console.log('🔍 === ANALYSE DES UNITÉS DE TEMPS ===\n');

// Tester l'accès aux contraintes par défaut via une ressource avec default
console.log('Test de la ressource ROUSSEAU Camille:');
const managerAdamczyk = ConstraintsManager.getAvailabilityManager('ROUSSEAU Camille');

if (managerAdamczyk) {
    console.log('✅ AvailabilityManager trouvé');
    
    // Les contraintes d'ADAMCZYK: lundi, mardi, jeudi, vendredi de 8:30 à 17:00
    // Mercredi de 8:30 à 12:30
    
    // Calculer les timestamps corrects
    const mondayStart = 0 * 24 * 60 + 8 * 60 + 30; // Lundi 8h30 = 510 minutes
    const mondayEnd = 0 * 24 * 60 + 17 * 60; // Lundi 17h00 = 1020 minutes
    
    console.log(`Lundi 8h30 timestamp: ${mondayStart}`);
    console.log(`Lundi 17h00 timestamp: ${mondayEnd}`);
    
    // Test avec les bonnes unités
    const tests = [
        { start: mondayStart, end: mondayStart + 90, desc: 'Lundi 8h30-10h00 (90min)' },
        { start: mondayStart, end: mondayStart + 60, desc: 'Lundi 8h30-9h30 (60min)' },
        { start: 0, end: 90, desc: 'Lundi 0h00-1h30 (90min)' },
        { start: 600, end: 690, desc: 'Lundi 10h00-11h30 (90min)' },
        { start: 24 * 60, end: 24 * 60 + 90, desc: 'Mardi 0h00-1h30 (90min)' }
    ];
    
    tests.forEach(test => {
        const available = managerAdamczyk.isAvailable(test.start, test.end);
        console.log(`  ${test.desc}: ${available ? '✅' : '❌'}`);
    });
}

// Maintenant testons avec l'unité de créneaux de 90 minutes
console.log('\n🎯 === TEST AVEC CRÉNEAUX DE 90 MINUTES ===');
console.log('Mapping créneaux -> temps:');
for (let slot = 0; slot < 10; slot++) {
    const dayIndex = Math.floor(slot / 8); // 8 créneaux par jour
    const slotInDay = slot % 8;
    const hourStart = 8 + slotInDay * 1.5; // Début à 8h, créneaux de 1.5h
    const dayName = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'][dayIndex];
    
    console.log(`  Créneau ${slot} = ${dayName} ${hourStart}h-${hourStart + 1.5}h`);
    
    // Convertir en minutes depuis le début de la semaine
    const startMinutes = dayIndex * 24 * 60 + hourStart * 60;
    const endMinutes = startMinutes + 90;
    
    if (managerAdamczyk) {
        const available = managerAdamczyk.isAvailable(startMinutes, endMinutes);
        console.log(`    -> ${startMinutes}-${endMinutes} minutes: ${available ? '✅' : '❌'}`);
    }
}
