/**
 * Test de planification avec l'approche standard et export iCal
 * Utilise la méthode solve() standard et exporte la solution
 */

import { Loader } from '../src/lib/loader.js';
import { Schedule } from '../src/schedule.js';

async function testStandardSchedulingWithICal(): Promise<void> {
    console.log('📋 TEST STANDARD AVEC EXPORT ICAL');
    console.log('===================================\n');

    try {
        // Chargement des données pour la semaine 36
        console.log('📚 Chargement des données pour la semaine 36...');
        Loader.loadTasksForWeek(36);
        console.log(`✅ ${Loader.tasks.length} tâches chargées pour la semaine 36\n`);

        // Création du planificateur standard
        const scheduler = new Schedule();

        // Test avec l'approche standard
        console.log('📋 PLANIFICATION STANDARD');
        console.log('-------------------------');
        
        const startTime = Date.now();
        const result = scheduler.solve();
        const endTime = Date.now();
        const executionTime = endTime - startTime;

        console.log(`\n⚡ RÉSULTATS DE LA PLANIFICATION STANDARD`);
        console.log(`========================================`);
        console.log(`⏱️ Temps d'exécution: ${executionTime}ms`);
        console.log(`📊 Tâches planifiées: ${result.solutions.length}/${Loader.tasks.length}`);
        console.log(`✅ Planification complète: ${result.isComplete ? 'Oui' : 'Non'}`);
        console.log(`🔍 Conflits détectés: ${result.conflictCount}`);

        if (result.solutions.length > 0) {
            // Afficher la liste des tâches non planifiées
            const plannedTasks = new Set(result.solutions.map(sol => sol.task));
            const unplannedTasks = Loader.tasks.filter(task => !plannedTasks.has(task));
            console.log(`\n🔎 Tâches non planifiées (${unplannedTasks.length}):`);
            unplannedTasks.forEach(task => console.log(`   - ${task.code}`));
            // Vérification de la solution
            console.log(`\n🔍 Vérification de la solution (${result.solutions.length} tâches)...`);
            const verification = scheduler.verifySolution(result.solutions);
            
            if (verification.isValid) {
                console.log('✅ Solution valide - Aucun conflit détecté');
            } else {
                console.log(`❌ Solution invalide - ${verification.conflicts.length} conflits détectés`);
                verification.conflicts.forEach((conflict: string, index: number) => {
                    console.log(`   ${index + 1}. Conflit: ${conflict}`);
                });
            }

            // Statistiques de la solution
            console.log(`\n📊 STATISTIQUES DE LA SOLUTION`);
            console.log(`===============================`);
            
            // Comptage par type de cours
            const typeCount = new Map<string, number>();
            result.solutions.forEach(sol => {
                const type = sol.task.type || 'Inconnu';
                typeCount.set(type, (typeCount.get(type) || 0) + 1);
            });
            
            console.log(`📋 Répartition par type de cours:`);
            for (const [type, count] of typeCount.entries()) {
                console.log(`   ${type}: ${count} tâches`);
            }

            // Comptage par niveau
            const levelCount = new Map<number, number>();
            result.solutions.forEach(sol => {
                const level = sol.task.level;
                levelCount.set(level, (levelCount.get(level) || 0) + 1);
            });
            
            console.log(`\n🎓 Répartition par niveau:`);
            for (const [level, count] of Array.from(levelCount.entries()).sort((a, b) => a[0] - b[0])) {
                console.log(`   R${level}: ${count} tâches`);
            }

            // Export iCal
            console.log(`\n📅 EXPORT ICAL`);
            console.log(`==============`);
            
            try {
                const icalResult = scheduler.export2ICal();
                console.log('✅ Export iCal terminé avec succès !');
                console.log(`📁 Fichiers générés dans le dossier './src/ical/'`);
                
                // Afficher un résumé de ce qui a été exporté
                const lines = icalResult.split('\n');
                const eventLines = lines.filter(line => line.startsWith('BEGIN:VEVENT')).length;
                console.log(`📋 Événements exportés: ${eventLines}`);
                
                // Lister les fichiers qui devraient être créés
                console.log(`\n📂 Fichiers iCal attendus:`);
                console.log(`   📅 planning-R1-BUT1-semaine36-2025.ics - Plannings R1 (BUT1)`);
                console.log(`   📅 planning-R3-BUT2-semaine36-2025.ics - Plannings R3 (BUT2)`);
                console.log(`   📅 planning-R5-BUT3-semaine36-2025.ics - Plannings R5 (BUT3)`);
                
            } catch (exportError) {
                console.error('❌ Erreur lors de l\'export iCal:', exportError);
            }
            
        } else {
            console.log('❌ Aucune solution trouvée - Impossible d\'exporter en iCal');
        }

        console.log(`\n🎯 Test planification standard avec iCal terminé !`);
        
    } catch (error) {
        console.error('❌ Erreur lors du test standard avec iCal:', error);
        throw error;
    }
}

// Exécuter le test si ce fichier est lancé directement
testStandardSchedulingWithICal().catch((error: any) => {
    console.error('💥 Échec du test:', error);
    process.exit(1);
});

// Exporter la fonction pour utilisation dans d'autres tests
export { testStandardSchedulingWithICal };