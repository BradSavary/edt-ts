/**
 * Test pour ScheduleAR — Stratégie solveWithTaskElimination(N=3)
 *
 * Lance une première résolution normale. Si aucune solution complète n'est trouvée,
 * élimine itérativement (jusqu'à 3 fois) la tâche la plus bloquante et relance.
 * Les tâches éliminées sont reportées dans result.neutralizedTasks.
 */

import { Schedule } from '../src/schedule.js';
import { Loader } from '../src/loader.js';
import { exec } from 'child_process';
import { ScheduleAnalysis } from '../src/scheduleAnalysis.js';

if (process.platform === 'win32') {
    exec('chcp 65001', () => {});
}

function displayTopBlockingTasks(scheduler: Schedule, tasks: ReturnType<typeof Loader.tasksManager.getAllTasks>): void {
    const failureCounts = scheduler.getTaskFailureCounts();
    console.log(`\n🎯 TOP 10 DES TÂCHES BLOQUANTES`);
    console.log(`================================`);
    if (failureCounts.size === 0) {
        console.log(`   Aucune tâche bloquante détectée.`);
        return;
    }
    const taskById = new Map(tasks.map(t => [t.id, t]));
    Array.from(failureCounts.entries())
        .map(([id, count]) => ({ task: taskById.get(id), id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .forEach(({ task, id, count }, index) => {
            const label = task ? `${task.name} (${task.code})` : id;
            console.log(`   ${index + 1}. ${label} — ${count} blocage(s)`);
        });
}

async function testTaskElimination(): Promise<void> {
    console.log('📋 TEST SCHEDULE AR — TASK ELIMINATION (N=3)');
    console.log('============================================\n');

    try {
        Loader.reload();

        const tasks = Loader.tasksManager.getAllTasks();
        console.log(`📚 Données chargées: ${tasks.length} tâches, ${Loader.resourcesManager.getAllResources().length} ressources`);

        const scheduler = new Schedule();
        scheduler.setMaxCompleteSolutions(10);
        scheduler.setTimeoutSeconds(180);

        console.log('\n🚀 Lancement de solveWithTaskElimination(3)...\n');
        const startTime = Date.now();
        const results = scheduler.solveWithTaskElimination();
        const executionTime = Date.now() - startTime;

        const result = results[0] ?? { solutions: [], isComplete: false, conflictCount: 0, score: undefined, neutralizedTasks: [] };

        // Tâches neutralisées
        const neutralized = result.neutralizedTasks ?? [];
        console.log(`\n🗑️  TÂCHES NEUTRALISÉES (${neutralized.length})`);
        console.log(`==============================`);
        if (neutralized.length === 0) {
            console.log(`   Aucune — solution trouvée sans élimination.`);
        } else {
            neutralized.forEach((task, i) => {
                console.log(`   ${i + 1}. ${task.name} (${task.code})`);
            });
        }

        console.log(`\n🏆 CLASSEMENT DES ${results.length} SOLUTION(S) COMPLÈTE(S)`);
        console.log(`================================================`);
        if (results.length === 0) {
            console.log(`   Aucune solution complète trouvée.`);
        } else {
            results.forEach((sol, i) => {
                const neutralCount = (sol.neutralizedTasks ?? []).length;
                const neutralLabel = neutralCount > 0 ? ` [${neutralCount} tâche(s) neutralisée(s)]` : '';
                console.log(`   ${i + 1}. score: ${sol.score ?? 'N/A'} — ${sol.solutions.length} tâches planifiées${neutralLabel}`);
            });
        }

        console.log(`\n⚡ MÉTRIQUES`);
        console.log(`============`);
        console.log(`⏱️  Temps total: ${executionTime}ms`);
        console.log(`📊 Tâches planifiées: ${result.solutions.length}/${tasks.length}`);
        console.log(`🗑️  Tâches neutralisées: ${neutralized.length}`);
        console.log(`✅ Complète (hors neutralisées): ${result.isComplete ? 'Oui' : 'Non'}`);
        console.log(`🔢 Score: ${result.score ?? 'N/A'}`);
        console.log(`📈 Taux (toutes tâches): ${(result.solutions.length / tasks.length * 100).toFixed(1)}%`);

        if (result.solutions.length > 0) {
            const analysis = new ScheduleAnalysis(result.solutions);
            const scores = analysis.getSolutionScores();
            console.log(`\n📊 Scores analytiques`);
            console.log(`   Tâches planifiées: ${scores.plannedTasks}`);
            console.log(`   Score vacataires:  ${scores.vacataireCompactnessScore.toFixed(2)}`);
            console.log(`   Score permanents:  ${scores.permanentCompactnessScore.toFixed(2)}`);
        }

        displayTopBlockingTasks(scheduler, tasks);

        if (result.solutions.length > 0) {
            scheduler.verifySolution(result.solutions);
        } else {
            console.log('\n❌ Aucune solution — planification échouée même après éliminations.');
        }

        console.log(`\n🏁 Test TaskElimination terminé !`);
    } catch (error) {
        console.error('❌ Erreur:', error);
        throw error;
    }
}

testTaskElimination().catch(error => {
    console.error('💥 Échec du test:', error);
    process.exit(1);
});
