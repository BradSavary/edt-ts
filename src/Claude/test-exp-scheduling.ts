/**
 * Test de comparaison entre l'approche standard et l'approche expérimentale chirurgicale
 */

import { Schedule } from '../schedule.js';
import { Loader } from '../lib/loader.js';

async function compareSchedulingApproaches() {
    console.log('🔬 COMPARAISON DES APPROCHES DE SCHEDULING');
    console.log('==========================================\n');

    // Charger les données une seule fois
    Loader.loadTasks();
    Loader.loadResources();
    
    // Test 1: Approche standard
    console.log('🔵 TEST 1: Approche Standard (invalidation complète)');
    console.log('----------------------------------------------------');
    
    const schedule1 = new Schedule();
    const startTime1 = Date.now();
    const result1 = schedule1.solve();
    const endTime1 = Date.now();
    const duration1 = endTime1 - startTime1;
    
    console.log(`⏱️ Temps d'exécution standard: ${duration1}ms`);
    console.log(`📊 Tâches planifiées: ${result1.solutions.length}`);
    console.log(`✅ Planification complète: ${result1.isComplete ? 'Oui' : 'Non'}`);
    console.log(`🔍 Conflits détectés: ${result1.conflictCount}\n`);

    // Test 2: Approche expérimentale
    console.log('🔬 TEST 2: Approche Expérimentale (chirurgicale)');
    console.log('-------------------------------------------------');
    
    const schedule2 = new Schedule();
    const startTime2 = Date.now();
    const result2 = schedule2.solveExp();
    const endTime2 = Date.now();
    const duration2 = endTime2 - startTime2;
    
    console.log(`⏱️ Temps d'exécution expérimental: ${duration2}ms`);
    console.log(`📊 Tâches planifiées: ${result2.solutions.length}`);
    console.log(`✅ Planification complète: ${result2.isComplete ? 'Oui' : 'Non'}`);
    console.log(`🔍 Conflits détectés: ${result2.conflictCount}\n`);

    // Comparaison des performances
    console.log('📈 COMPARAISON DES PERFORMANCES');
    console.log('==============================');
    
    const speedupPercent = ((duration1 - duration2) / duration1 * 100).toFixed(1);
    const speedupFactor = (duration1 / duration2).toFixed(2);
    
    console.log(`🕐 Temps standard:     ${duration1}ms`);
    console.log(`🕐 Temps expérimental: ${duration2}ms`);
    console.log(`⚡ Différence:         ${duration1 - duration2}ms`);
    console.log(`📊 Amélioration:       ${speedupPercent}% (facteur ${speedupFactor}x)`);
    
    if (duration2 < duration1) {
        console.log(`🎯 L'approche expérimentale est ${speedupPercent}% plus rapide !`);
    } else if (duration2 > duration1) {
        const slowdownPercent = ((duration2 - duration1) / duration1 * 100).toFixed(1);
        console.log(`⚠️ L'approche expérimentale est ${slowdownPercent}% plus lente`);
    } else {
        console.log(`🤝 Les deux approches ont des performances équivalentes`);
    }

    // Comparaison de la qualité des solutions
    console.log('\n🎯 COMPARAISON DE LA QUALITÉ');
    console.log('============================');
    
    console.log(`📋 Tâches planifiées (standard):     ${result1.solutions.length}`);
    console.log(`📋 Tâches planifiées (expérimental): ${result2.solutions.length}`);
    
    if (result1.solutions.length === result2.solutions.length) {
        console.log(`✅ Même nombre de tâches planifiées: ${result1.solutions.length}`);
        console.log(`🏆 Les deux approches donnent des résultats équivalents en qualité`);
    } else {
        const better = result1.solutions.length > result2.solutions.length ? 'standard' : 'expérimentale';
        const diff = Math.abs(result1.solutions.length - result2.solutions.length);
        console.log(`⚖️ L'approche ${better} planifie ${diff} tâche(s) de plus`);
    }

    // Vérification de la cohérence
    console.log('\n🔍 VÉRIFICATION DE COHÉRENCE');
    console.log('============================');
    
    const verification1 = schedule1.verifySolution(result1.solutions);
    const verification2 = schedule2.verifySolution(result2.solutions);
    
    console.log(`✅ Solution standard valide:     ${verification1.isValid ? 'Oui' : 'Non'}`);
    console.log(`✅ Solution expérimentale valide: ${verification2.isValid ? 'Oui' : 'Non'}`);
    
    if (verification1.isValid && verification2.isValid) {
        console.log(`🎉 Les deux approches produisent des solutions valides !`);
    } else {
        console.log(`⚠️ Des problèmes de validité ont été détectés`);
        if (!verification1.isValid) {
            console.log(`   - Solution standard: ${verification1.conflicts.length} conflit(s)`);
        }
        if (!verification2.isValid) {
            console.log(`   - Solution expérimentale: ${verification2.conflicts.length} conflit(s)`);
        }
    }

    console.log('\n🏁 CONCLUSION');
    console.log('=============');
    
    if (duration2 < duration1 && result1.solutions.length === result2.solutions.length && verification2.isValid) {
        console.log('🌟 L\'approche expérimentale est supérieure : plus rapide et même qualité !');
    } else if (duration2 > duration1 && result1.solutions.length === result2.solutions.length && verification2.isValid) {
        console.log('📊 L\'approche standard reste meilleure : plus rapide avec même qualité');
    } else {
        console.log('🤔 Les résultats sont mitigés, analyse plus approfondie nécessaire');
    }
}

// Lancement du test
compareSchedulingApproaches().catch(console.error);