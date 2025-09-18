/**
 * Test de planification avec l'approche expérimentale et export iCal
 * Utilise uniquement la méthode solveExp() et exporte la solution
 */

import { Loader } from '../lib/loader.js';
import { ScheduleExp } from '../scheduleExp.js';

function testExperimentalSchedulingWithICal() {
    console.log('🧪 TEST EXPÉRIMENTAL AVEC EXPORT ICAL');
    console.log('=====================================\n');

    try {
        // Chargement des données pour la semaine 36
        console.log('📚 Chargement des données pour la semaine 36...');
        Loader.loadTasksForWeek(36);
        console.log(`✅ ${Loader.tasks.length} tâches chargées pour la semaine 36\n`);

        // Création du planificateur expérimental
        const scheduler = new ScheduleExp();

        // Test avec l'approche expérimentale uniquement
        console.log('🔬 PLANIFICATION EXPÉRIMENTALE');
        console.log('------------------------------');
        
        const startTime = Date.now();
        const result = scheduler.solve();
        const endTime = Date.now();
        const executionTime = endTime - startTime;

        // Affichage des résultats
        console.log(`\n📊 RÉSULTATS DE LA PLANIFICATION EXPÉRIMENTALE`);
        console.log('===============================================');
        console.log(`⏱️ Temps d'exécution: ${executionTime}ms`);
        console.log(`📋 Tâches planifiées: ${result.solutions.length}`);
        console.log(`✅ Planification complète: ${result.isComplete ? 'Oui' : 'Non'}`);
        console.log(`🔍 Conflits détectés: ${result.conflictCount}`);

        if (result.solutions.length > 0) {
            // Analyse des tâches planifiées par niveau
            const r1Tasks = result.solutions.filter(s => s.task.code.startsWith('R1'));
            const r3Tasks = result.solutions.filter(s => s.task.code.startsWith('R3'));
            const r5Tasks = result.solutions.filter(s => s.task.code.startsWith('R5'));

            console.log(`\n📈 RÉPARTITION PAR NIVEAU`);
            console.log('-------------------------');
            console.log(`🔵 R1 (BUT1): ${r1Tasks.length} tâches`);
            console.log(`🟡 R3 (BUT2): ${r3Tasks.length} tâches`);
            console.log(`🟢 R5 (BUT3): ${r5Tasks.length} tâches`);

            // Export iCal
            console.log(`\n📅 EXPORT ICAL`);
            console.log('==============');
            
            const icalResult = scheduler.export2ICal();
            
            if (icalResult) {
                console.log(`✅ Export iCal réussi !`);
                console.log(`📁 Premier fichier créé: ${icalResult}`);
            } else {
                console.log(`❌ Échec de l'export iCal`);
            }

            // Affichage d'un échantillon de la planification
            console.log(`\n📋 ÉCHANTILLON DE LA PLANIFICATION (5 premières tâches)`);
            console.log('======================================================');
            
            for (let i = 0; i < Math.min(5, result.solutions.length); i++) {
                const sol = result.solutions[i];
                const startTime = formatTime(sol.startTime);
                const endTime = formatTime(sol.startTime + sol.task.duration);
                
                const teachers = sol.task.resources.filter(r => r.type === 'teacher').map(r => r.id);
                const rooms = sol.task.resources.filter(r => r.type === 'room').map(r => r.id);
                const groups = sol.task.resources.filter(r => r.type === 'group').map(r => r.id);
                
                console.log(`${i + 1}. ${sol.task.code} - ${sol.task.name}`);
                console.log(`   📅 ${startTime} → ${endTime} (${sol.task.duration}min)`);
                console.log(`   👨‍🏫 ${teachers.join(', ')} | 🏫 ${rooms.join(', ')} | 👥 ${groups.join(', ')}`);
                console.log('');
            }

        } else {
            console.log(`\n❌ Aucune tâche n'a pu être planifiée`);
        }

    } catch (error) {
        console.error('❌ Erreur durant le test:', error);
    }
}

/**
 * Formate un timestamp en heure lisible
 */
function formatTime(timestamp: number): string {
    const MINUTES_PER_DAY = 24 * 60;
    const dayIndex = Math.floor(timestamp / MINUTES_PER_DAY);
    const timeInDay = timestamp % MINUTES_PER_DAY;
    const hour = Math.floor(timeInDay / 60);
    const minute = timeInDay % 60;
    
    const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
    const dayName = days[dayIndex] || `J${dayIndex}`;
    return `${dayName} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

// Lancer le test
testExperimentalSchedulingWithICal();