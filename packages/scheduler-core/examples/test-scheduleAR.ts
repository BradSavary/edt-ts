/**
 * Test pour ScheduleAR - Algorithme avec ressources alternatives
 * Explore toutes les combinaisons de ressources en cours de backtracking
 */

import { ScheduleAR } from '../src/scheduleAR.js';
import { Loader } from '../src/lib/loader.js';
import { exec } from 'child_process';
import { ScheduleAnalysis } from '../src/scheduleAnalysis.js';

// Fixer l'encodage de la console pour Windows
if (process.platform === 'win32') {
    exec('chcp 65001', () => {});
}

/**
 * Analyse les statistiques de la solution
 */
function analyzeSolution(result: any): void {
    if (!result.solutions || result.solutions.length === 0) {
        console.log('❌ Aucune solution trouvée');
        return;
    }
    
    console.log(`\n📊 ANALYSE DE LA SOLUTION`);
    console.log(`=========================`);
    
    // Comptage par salle
    const roomUsage = new Map<string, number>();
    const teacherUsage = new Map<string, number>();
    
    result.solutions.forEach((taskSol: any) => {
        // Utiliser getAllResources() qui retourne appliedResources
        const allResources = taskSol.task.getAllResources();
        
        // Compter les salles
        const rooms = allResources.filter((r: any) => r.type === 'room');
        rooms.forEach((room: any) => {
            roomUsage.set(room.id, (roomUsage.get(room.id) || 0) + 1);
        });
        
        // Compter les enseignants
        const teachers = allResources.filter((r: any) => r.type === 'teacher');
        teachers.forEach((teacher: any) => {
            teacherUsage.set(teacher.id, (teacherUsage.get(teacher.id) || 0) + 1);
        });
    });
    
    // Affichage des statistiques par salle
    const sortedRooms = Array.from(roomUsage.entries()).sort((a, b) => b[1] - a[1]);
    
    console.log(`🏫 Utilisation des salles:`);
    console.log(`   Salles utilisées: ${roomUsage.size}`);
    sortedRooms.slice(0, 5).forEach(([roomId, count], index) => {
        console.log(`   ${index + 1}. Salle ${roomId}: ${count} tâches`);
    });
    
    // Statistiques générales
    const totalRooms = roomUsage.size;
    const avgTasksPerRoom = result.solutions.length / totalRooms;
    const maxTasksInRoom = Math.max(...roomUsage.values());
    const minTasksInRoom = Math.min(...roomUsage.values());
    
    console.log(`\n📈 Statistiques générales:`);
    console.log(`   🏢 Salles utilisées: ${totalRooms}`);
    console.log(`   📊 Moyenne de tâches par salle: ${avgTasksPerRoom.toFixed(1)}`);
    console.log(`   📈 Maximum de tâches dans une salle: ${maxTasksInRoom}`);
    console.log(`   📉 Minimum de tâches dans une salle: ${minTasksInRoom}`);
    console.log(`   🎯 Équilibrage: ${(minTasksInRoom / maxTasksInRoom * 100).toFixed(1)}%`);
    
    // Statistiques enseignants
    console.log(`\n👨‍🏫 Enseignants actifs: ${teacherUsage.size}`);
    const sortedTeachers = Array.from(teacherUsage.entries()).sort((a, b) => b[1] - a[1]);
    console.log(`   Top 3 enseignants les plus chargés:`);
    sortedTeachers.slice(0, 3).forEach(([teacherId, count], index) => {
        console.log(`   ${index + 1}. ${teacherId}: ${count} cours`);
    });
}

/**
 * Affiche les métriques de performance
 */
function displayPerformanceMetrics(executionTime: number, result: any): void {
    console.log(`\n⚡ MÉTRIQUES DE PERFORMANCE`);
    console.log(`==========================`);
    console.log(`⏱️ Temps d'exécution: ${executionTime}ms`);
    console.log(`📊 Tâches planifiées: ${result.solutions.length}`);
    console.log(`✅ Planification complète: ${result.isComplete ? 'Oui' : 'Non'}`);
    console.log(`🔍 Conflits détectés: ${result.conflictCount || 0}`);
    
    // Calcul du taux de réussite
    const tasks = Loader.tasks;
    const successRate = (result.solutions.length / tasks.length * 100).toFixed(1);
    console.log(`📈 Taux de réussite: ${successRate}%`);
}

/**
 * Test principal pour ScheduleAR
 */
async function testScheduleAR(): Promise<any> {
    console.log('📋 TEST SCHEDULE AR (Alternative Resources)');
    console.log('===========================================\n');
    
    try {
        // Forcer le rechargement des données pour un test propre
        Loader.reload();
        
        // Analyser les données chargées
        const tasks = Loader.tasks;
        console.log(`📚 Données chargées:`);
        console.log(`   📋 Tâches totales: ${tasks.length}`);
        console.log(`   🏢 Ressources disponibles: ${Loader.resourcesManager.getAllResources().length}`);
        
        // Analyser les tâches avec ressources alternatives
        let tasksWithAlternatives = 0;
        let totalAlternativeCombinations = 0;
        
        for (const task of tasks) {
            const combinations = task.getApplicableResources();
            if (combinations.length > 1) {
                tasksWithAlternatives++;
                totalAlternativeCombinations += combinations.length;
            }
        }
        
        console.log(`   🔄 Tâches avec ressources alternatives: ${tasksWithAlternatives}/${tasks.length}`);
        if (tasksWithAlternatives > 0) {
            console.log(`   🎲 Moyenne de combinaisons par tâche alternative: ${(totalAlternativeCombinations / tasksWithAlternatives).toFixed(1)}`);
        }
        
        console.log('\n🚀 Lancement de la planification avec ScheduleAR...\n');
        
        // Créer et configurer le planificateur AR
        const scheduler = new ScheduleAR();
        
        // Configuration : chercher 26 solutions complètes avec timeout de 3 minutes
        scheduler.setMaxCompleteSolutions(10);
        scheduler.setTimeoutSeconds(180); // 3 minutes = 180 secondes
        
        // Mesurer le temps d'exécution
        const startTime = Date.now();
        const result = scheduler.solve();
        const endTime = Date.now();
        const executionTime = endTime - startTime;

        const analysis = new ScheduleAnalysis(result.solutions);
        const scores = analysis.getSolutionScores();

        console.log(`Tâches planifiées: ${scores.plannedTasks}`);
        console.log(`Score vacataires: ${scores.vacataireCompactnessScore.toFixed(2)}`);
        console.log(`Score permanents: ${scores.permanentCompactnessScore.toFixed(2)}`);
        
        // Afficher les métriques de performance
        displayPerformanceMetrics(executionTime, result);
        
        // Vérification de la solution
        if (result.solutions.length > 0) {
            console.log(`\n🔍 Vérification de la solution (${result.solutions.length} tâches)...`);
            const verification = scheduler.verifySolution(result.solutions);
            
            if (verification.isValid) {
                console.log('✅ Solution valide - Aucun conflit détecté');
            } else {
                console.log(`❌ Solution invalide - ${verification.conflicts.length} conflits détectés`);
                verification.conflicts.forEach((conflict: string, index: number) => {
                    console.log(`   ${index + 1}. ${conflict}`);
                });
            }
            
            // Analyser la solution
            analyzeSolution(result);
            
            // Test d'export iCal (optionnel)
            console.log(`\n📅 TEST EXPORT ICAL`);
            console.log(`===================`);
            
            try {
                const icalResult = scheduler.export2ICal();
                console.log('✅ Export iCal réussi');
                
                // Compter les événements
                const lines = icalResult.split('\n');
                const eventLines = lines.filter(line => line.startsWith('BEGIN:VEVENT')).length;
                console.log(`📋 Événements exportés: ${eventLines}`);
                
            } catch (exportError) {
                console.error('❌ Erreur lors de l\'export iCal:', exportError);
            }
            
        } else {
            console.log('❌ Aucune solution trouvée - Planification échouée');
            
            // Analyser pourquoi la planification a échoué
            console.log(`\n🔍 ANALYSE D'ÉCHEC`);
            console.log(`==================`);
            
            // Vérifier les tâches les plus contraintes
            console.log('🎯 Analyse des contraintes par tâche:');
            const constraintScores = tasks.map(task => ({
                task: task,
                score: (scheduler as any).getTaskConstraintScore(task),
                availableSlots: (scheduler as any).generatePossibleSlots(task).length
            })).sort((a, b) => a.score - b.score);
            
            console.log('   Top 5 des tâches les plus contraintes:');
            constraintScores.slice(0, 5).forEach((item, index) => {
                console.log(`   ${index + 1}. ${item.task.name} (${item.task.code})`);
                console.log(`      Score contrainte: ${item.score}`);
                console.log(`      Créneaux disponibles: ${item.availableSlots}`);
            });
        }
        
        console.log(`\n🏁 Test ScheduleAR terminé !`);
        
        return result;
        
    } catch (error) {
        console.error('❌ Erreur lors du test ScheduleAR:', error);
        throw error;
    }

   
}

// Exécuter le test si ce fichier est lancé directement
testScheduleAR().catch(error => {
    console.error('💥 Échec du test:', error);
    process.exit(1);
});

// Exporter la fonction pour utilisation dans d'autres tests
export { testScheduleAR, analyzeSolution, displayPerformanceMetrics };