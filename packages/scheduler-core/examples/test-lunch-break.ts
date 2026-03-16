/**
 * Test de la vérification de la pause méridienne pour les groupes
 * 
 * Règle : Si un créneau débute à 13:30, le créneau précédent doit se terminer au plus tard à 12:00
 */

import { Resource, ResourceType } from '../src/resource';

console.log('🧪 TEST DE LA PAUSE MÉRIDIENNE (90 minutes)');
console.log('='.repeat(50));

// Créer une ressource GROUP
const group = new Resource('BUT1-G1', ResourceType.GROUP);

// Ajouter des disponibilités pour une journée complète (lundi = jour 0)
const LUNDI_08H00 = 8 * 60;
const LUNDI_18H00 = 18 * 60;

group.addAvailability(LUNDI_08H00, LUNDI_18H00);

console.log('\n📋 Configuration initiale:');
console.log(`   Disponibilité: Lundi 08:00 → 18:00`);
console.log(`   Ressource: ${group.id} (${group.type})`);

// Test 1: Réserver un créneau qui se termine à 12:00, puis un créneau à 13:30
console.log('\n✅ Test 1: Créneau jusqu\'à 12:00, puis 13:30-15:00 (DOIT RÉUSSIR)');
try {
    // Réserver 10:00-12:00
    const LUNDI_10H00 = 10 * 60;
    const LUNDI_12H00 = 12 * 60;
    group.book(LUNDI_10H00, LUNDI_12H00);
    console.log('   ✓ Créneau 10:00-12:00 réservé');
    
    // Réserver 13:30-15:00
    const LUNDI_13H30 = 13 * 60 + 30;
    const LUNDI_15H00 = 15 * 60;
    group.book(LUNDI_13H30, LUNDI_15H00);
    console.log('   ✓ Créneau 13:30-15:00 réservé');
    console.log('   ✅ TEST RÉUSSI: Pause méridienne respectée (90 minutes)');
} catch (error) {
    console.log(`   ❌ ÉCHEC: ${(error as Error).message}`);
}

// Réinitialiser pour le prochain test
const group2 = new Resource('BUT1-G2', ResourceType.GROUP);
group2.addAvailability(LUNDI_08H00, LUNDI_18H00);

// Test 2: Réserver un créneau qui se termine à 12:30, puis essayer un créneau à 13:30
console.log('\n❌ Test 2: Créneau jusqu\'à 12:30, puis 13:30-15:00 (DOIT ÉCHOUER)');
try {
    // Réserver 10:30-12:30
    const LUNDI_10H30 = 10 * 60 + 30;
    const LUNDI_12H30 = 12 * 60 + 30;
    group2.book(LUNDI_10H30, LUNDI_12H30);
    console.log('   ✓ Créneau 10:30-12:30 réservé');
    
    // Essayer de réserver 13:30-15:00 (devrait échouer)
    const LUNDI_13H30 = 13 * 60 + 30;
    const LUNDI_15H00 = 15 * 60;
    group2.book(LUNDI_13H30, LUNDI_15H00);
    console.log('   ❌ ÉCHEC: La réservation aurait dû être refusée');
} catch (error) {
    console.log(`   ✅ TEST RÉUSSI: ${(error as Error).message}`);
}

// Réinitialiser pour le prochain test
const group3 = new Resource('BUT1-G3', ResourceType.GROUP);
group3.addAvailability(LUNDI_08H00, LUNDI_18H00);

// Test 3: Réserver un créneau qui se termine à 11:30, puis un créneau à 13:30
console.log('\n✅ Test 3: Créneau jusqu\'à 11:30, puis 13:30-15:00 (DOIT RÉUSSIR)');
try {
    // Réserver 10:00-11:30
    const LUNDI_10H00 = 10 * 60;
    const LUNDI_11H30 = 11 * 60 + 30;
    group3.book(LUNDI_10H00, LUNDI_11H30);
    console.log('   ✓ Créneau 10:00-11:30 réservé');
    
    // Réserver 13:30-15:00
    const LUNDI_13H30 = 13 * 60 + 30;
    const LUNDI_15H00 = 15 * 60;
    group3.book(LUNDI_13H30, LUNDI_15H00);
    console.log('   ✓ Créneau 13:30-15:00 réservé');
    console.log('   ✅ TEST RÉUSSI: Pause méridienne respectée (120 minutes)');
} catch (error) {
    console.log(`   ❌ ÉCHEC: ${(error as Error).message}`);
}

// Test 4: Vérifier que la règle ne s'applique pas aux autres types de ressources
const teacher = new Resource('MONDOLLOT', ResourceType.TEACHER);
teacher.addAvailability(LUNDI_08H00, LUNDI_18H00);

console.log('\n✅ Test 4: Enseignant - Pas de contrainte de pause (DOIT RÉUSSIR)');
try {
    // Réserver 10:30-12:30 (se termine après 12:00)
    const LUNDI_10H30 = 10 * 60 + 30;
    const LUNDI_12H30 = 12 * 60 + 30;
    teacher.book(LUNDI_10H30, LUNDI_12H30);
    console.log('   ✓ Créneau 10:30-12:30 réservé');
    
    // Réserver 13:30-15:00 (devrait réussir car pas de contrainte pour les enseignants)
    const LUNDI_13H30 = 13 * 60 + 30;
    const LUNDI_15H00 = 15 * 60;
    teacher.book(LUNDI_13H30, LUNDI_15H00);
    console.log('   ✓ Créneau 13:30-15:00 réservé');
    console.log('   ✅ TEST RÉUSSI: Pas de contrainte de pause pour les enseignants');
} catch (error) {
    console.log(`   ❌ ÉCHEC: ${(error as Error).message}`);
}

// Test 5: Réserver plusieurs créneaux dans la matinée, puis un créneau à 13:30
const group4 = new Resource('BUT2-G1', ResourceType.GROUP);
group4.addAvailability(LUNDI_08H00, LUNDI_18H00);

console.log('\n❌ Test 5: Créneaux 08:00-10:00 et 11:00-12:15, puis 13:30-15:00 (DOIT ÉCHOUER)');
try {
    // Réserver 08:00-10:00
    const LUNDI_08H00_START = 8 * 60;
    const LUNDI_10H00 = 10 * 60;
    group4.book(LUNDI_08H00_START, LUNDI_10H00);
    console.log('   ✓ Créneau 08:00-10:00 réservé');
    
    // Réserver 11:00-12:15
    const LUNDI_11H00 = 11 * 60;
    const LUNDI_12H15 = 12 * 60 + 15;
    group4.book(LUNDI_11H00, LUNDI_12H15);
    console.log('   ✓ Créneau 11:00-12:15 réservé');
    
    // Essayer de réserver 13:30-15:00 (devrait échouer car le dernier créneau finit à 12:15)
    const LUNDI_13H30 = 13 * 60 + 30;
    const LUNDI_15H00 = 15 * 60;
    group4.book(LUNDI_13H30, LUNDI_15H00);
    console.log('   ❌ ÉCHEC: La réservation aurait dû être refusée');
} catch (error) {
    console.log(`   ✅ TEST RÉUSSI: ${(error as Error).message}`);
}

// Test 6: Réserver un créneau qui se termine à 12:30, puis essayer un créneau à 13:30-14:00 (DOIT ÉCHOUER)
const group5 = new Resource('BUT2-G2', ResourceType.GROUP);
group5.addAvailability(LUNDI_08H00, LUNDI_18H00);

console.log('\n❌ Test 6: Créneau 10:00-12:30, puis 13:30-14:00 (DOIT ÉCHOUER)');
try {
    // Réserver 10:00-12:30
    const LUNDI_10H00 = 10 * 60;
    const LUNDI_12H30 = 12 * 60 + 30;
    group5.book(LUNDI_10H00, LUNDI_12H30);
    console.log('   ✓ Créneau 10:00-12:30 réservé');
    
    // Essayer de réserver 13:30-14:00 (devrait échouer car 12:00-12:30 est occupé)
    const LUNDI_13H30 = 13 * 60 + 30;
    const LUNDI_14H00 = 14 * 60;
    group5.book(LUNDI_13H30, LUNDI_14H00);
    console.log('   ❌ ÉCHEC: La réservation aurait dû être refusée');
} catch (error) {
    console.log(`   ✅ TEST RÉUSSI: ${(error as Error).message}`);
}

// Test 7: Réserver un créneau 12:00-12:30, puis 13:30-14:00 (DOIT RÉUSSIR - créneaux de transition)
const group6 = new Resource('BUT2-G3', ResourceType.GROUP);
group6.addAvailability(LUNDI_08H00, LUNDI_18H00);

console.log('\n✅ Test 7: Créneau 12:00-12:30, puis 13:30-14:00 (DOIT RÉUSSIR)');
try {
    // Réserver 12:00-12:30
    const LUNDI_12H00 = 12 * 60;
    const LUNDI_12H30 = 12 * 60 + 30;
    group6.book(LUNDI_12H00, LUNDI_12H30);
    console.log('   ✓ Créneau 12:00-12:30 réservé');
    
    // Réserver 13:30-14:00
    const LUNDI_13H30 = 13 * 60 + 30;
    const LUNDI_14H00 = 14 * 60;
    group6.book(LUNDI_13H30, LUNDI_14H00);
    console.log('   ✓ Créneau 13:30-14:00 réservé');
    console.log('   ✅ TEST RÉUSSI: Les deux créneaux de transition peuvent coexister');
} catch (error) {
    console.log(`   ❌ ÉCHEC: ${(error as Error).message}`);
}

// Test 8: Réserver un créneau à 13:30-14:30, puis essayer de réserver 10:00-12:30 (doit échouer)
const group7 = new Resource('BUT2-G4', ResourceType.GROUP);
group7.addAvailability(LUNDI_08H00, LUNDI_18H00);

console.log('\n❌ Test 8: Créneau 13:30-14:30, puis 10:00-12:30 (DOIT ÉCHOUER)');
try {
    // Réserver 13:30-14:30
    const LUNDI_13H30 = 13 * 60 + 30;
    const LUNDI_14H30 = 14 * 60 + 30;
    group7.book(LUNDI_13H30, LUNDI_14H30);
    console.log('   ✓ Créneau 13:30-14:30 réservé');
    
    // Essayer de réserver 10:00-12:30 (devrait échouer car 13:30-14:00 est occupé)
    const LUNDI_10H00 = 10 * 60;
    const LUNDI_12H30 = 12 * 60 + 30;
    group7.book(LUNDI_10H00, LUNDI_12H30);
    console.log('   ❌ ÉCHEC: La réservation aurait dû être refusée');
} catch (error) {
    console.log(`   ✅ TEST RÉUSSI: ${(error as Error).message}`);
}

// Test 9: Réserver un créneau à 13:30-13:45, puis essayer de réserver 10:00-12:30 (doit échouer)
const group8 = new Resource('BUT3-G1', ResourceType.GROUP);
group8.addAvailability(LUNDI_08H00, LUNDI_18H00);

console.log('\n❌ Test 9: Créneau 13:30-13:45, puis 10:00-12:30 (DOIT ÉCHOUER)');
try {
    // Réserver 13:30-13:45
    const LUNDI_13H30 = 13 * 60 + 30;
    const LUNDI_13H45 = 13 * 60 + 45;
    group8.book(LUNDI_13H30, LUNDI_13H45);
    console.log('   ✓ Créneau 13:30-13:45 réservé');
    
    // Essayer de réserver 10:00-12:30 (devrait échouer car 13:30-14:00 est partiellement occupé)
    const LUNDI_10H00 = 10 * 60;
    const LUNDI_12H30 = 12 * 60 + 30;
    group8.book(LUNDI_10H00, LUNDI_12H30);
    console.log('   ❌ ÉCHEC: La réservation aurait dû être refusée');
} catch (error) {
    console.log(`   ✅ TEST RÉUSSI: ${(error as Error).message}`);
}

console.log('\n' + '='.repeat(50));
console.log('🎯 Tests de la pause méridienne terminés');
