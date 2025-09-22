/**
 * Test spécifique pour ScheduleMR (Multi-Rooms) avec export iCal
 * Test la planification multi-rooms et génère les fichiers calendrier
 */

import { ScheduleMR } from '../scheduleMR.js';
import { Loader } from '../lib/loader.js';

/**
 * Analyse le potentiel multi-rooms des tâches chargées
 */
function analyzeMultiRoomPotential(): void {
    const tasks = Loader.tasks;
    
    const tasksWithMultipleRooms = tasks.filter(task => task.getAvailableRooms().length > 1);
    const totalAlternatives = tasks.reduce((sum, task) => sum + task.getAvailableRooms().length, 0);
    
    console.log(`📊 Analyse du potentiel Multi-Rooms:`);
    console.log(`   📋 Tâches totales: ${tasks.length}`);
    console.log(`   🏫 Tâches avec salles multiples: ${tasksWithMultipleRooms.length}/${tasks.length} (${(tasksWithMultipleRooms.length / tasks.length * 100).toFixed(1)}%)`);
    console.log(`   🎯 Total des alternatives de salles: ${totalAlternatives}`);
    console.log(`   📈 Moyenne de salles par tâche: ${(totalAlternatives / tasks.length).toFixed(2)}`);
    
    if (tasksWithMultipleRooms.length > 0) {
        console.log(`\n🏢 Exemples de tâches avec salles multiples:`);
        tasksWithMultipleRooms.slice(0, 5).forEach((task, index) => {
            const currentRoom = task.getCurrentRoom();
            const availableRooms = task.getAvailableRooms().map(r => r.id).join(', ');
            console.log(`   ${index + 1}. ${task.name} (${task.code})`);
            console.log(`      🎯 Salle actuelle: ${currentRoom?.id || 'aucune'}`);
            console.log(`      🏫 Salles possibles: ${availableRooms}`);
        });
    }
    
    console.log('');
}

/**
 * Affiche les statistiques détaillées de la solution
 */
function displaySolutionStats(result: { solutions: any[]; isComplete: boolean; conflictCount: number }): void {
    const solution = result.solutions;
    
    if (!solution || solution.length === 0) {
        console.log('❌ Aucune solution trouvée');
        return;
    }
    
    console.log(`\n📊 STATISTIQUES DE LA SOLUTION`);
    console.log(`===============================`);
    
    // Comptage par salle
    const roomUsage = new Map<string, number>();
    const roomTasks = new Map<string, string[]>();
    
    solution.forEach((taskSol: any) => {
        const room = taskSol.task.getCurrentRoom();
        if (room) {
            roomUsage.set(room.id, (roomUsage.get(room.id) || 0) + 1);
            
            if (!roomTasks.has(room.id)) {
                roomTasks.set(room.id, []);
            }
            roomTasks.get(room.id)!.push(`${taskSol.task.code} (${taskSol.task.name.substring(0, 20)}...)`);
        }
    });
    
    // Affichage des statistiques par salle
    const sortedRooms = Array.from(roomUsage.entries()).sort((a, b) => b[1] - a[1]);
    
    console.log(`🏫 Utilisation des salles:`);
    sortedRooms.forEach(([roomId, count], index) => {
        console.log(`   ${index + 1}. Salle ${roomId}: ${count} tâches`);
        // Afficher quelques exemples de tâches
        const tasks = roomTasks.get(roomId) || [];
        if (tasks.length > 0) {
            console.log(`      📋 Exemples: ${tasks.slice(0, 3).join(', ')}${tasks.length > 3 ? '...' : ''}`);
        }
    });
    
    // Statistiques générales
    const totalRooms = roomUsage.size;
    const avgTasksPerRoom = solution.length / totalRooms;
    const maxTasksInRoom = Math.max(...roomUsage.values());
    const minTasksInRoom = Math.min(...roomUsage.values());
    
    console.log(`\n📈 Statistiques générales:`);
    console.log(`   🏢 Salles utilisées: ${totalRooms}`);
    console.log(`   📊 Moyenne de tâches par salle: ${avgTasksPerRoom.toFixed(1)}`);
    console.log(`   📈 Maximum de tâches dans une salle: ${maxTasksInRoom}`);
    console.log(`   📉 Minimum de tâches dans une salle: ${minTasksInRoom}`);
    console.log(`   🎯 Équilibrage: ${(minTasksInRoom / maxTasksInRoom * 100).toFixed(1)}%`);
}

/**
 * Affiche un résumé des changements de salles effectués
 */
function displayRoomChangesSummary(): void {
    console.log(`\n🔄 CHANGEMENTS DE SALLES EFFECTUÉS`);
    console.log(`==================================`);
    console.log(`Les changements de salles sont appliqués silencieusement pour réduire la verbosité.`);
    console.log(`Pour voir les détails, décommentez le log dans task.ts ligne ~583.`);
}

/**
 * Test principal pour ScheduleMR avec export iCal
 */
async function testScheduleMRWithICal(): Promise<void> {
    console.log('🏫 TEST SCHEDULEMR AVEC EXPORT ICAL');
    console.log('===================================\n');
    
    try {
        // Forcer le rechargement des données pour un test propre
        Loader.reload();
        
        // Analyser le potentiel multi-rooms
        analyzeMultiRoomPotential();
        
        // Créer et configurer le planificateur Multi-Rooms
        const scheduler = new ScheduleMR();
        
        console.log('🚀 Lancement de la planification Multi-Rooms...\n');
        
        // Mesurer le temps d'exécution
        const startTime = Date.now();
        const result = scheduler.solve();
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        
        console.log(`\n⏱️ RÉSULTATS DE LA PLANIFICATION`);
        console.log(`===============================`);
        console.log(`⏱️ Temps d'exécution: ${executionTime}ms`);
        console.log(`📊 Tâches planifiées: ${result.solutions.length}`);
        console.log(`✅ Planification complète: ${result.isComplete ? 'Oui' : 'Non'}`);
        console.log(`🔍 Conflits détectés: ${result.conflictCount}`);
        
        // Vérification de la solution
        if (result.solutions.length > 0) {
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
            
            // Afficher les statistiques détaillées
            displaySolutionStats(result);
            
            // Afficher le résumé des changements de salles
            displayRoomChangesSummary();
            
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
                console.log(`   📅 planning_enseignants_S36_2025.ics - Calendriers par enseignant`);
                console.log(`   🏫 planning_salles_S36_2025.ics - Calendriers par salle`);
                console.log(`   👥 planning_groupes_S36_2025.ics - Calendriers par groupe`);
                
            } catch (exportError) {
                console.error('❌ Erreur lors de l\'export iCal:', exportError);
            }
            
        } else {
            console.log('❌ Aucune solution trouvée - Impossible d\'exporter en iCal');
        }
        
        console.log(`\n🎯 Test ScheduleMR terminé !`);
        
    } catch (error) {
        console.error('❌ Erreur lors du test ScheduleMR:', error);
        throw error;
    }
}

// Exécuter le test si ce fichier est lancé directement
testScheduleMRWithICal().catch(error => {
    console.error('💥 Échec du test:', error);
    process.exit(1);
});

// Exporter la fonction pour utilisation dans d'autres tests
export { testScheduleMRWithICal, analyzeMultiRoomPotential };