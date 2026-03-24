/**
 * Test pour ScheduleAR — Stratégie solveWithPriorityRetry(N=3)
 *
 * Lance une première résolution normale. Si aucune solution complète n'est trouvée,
 * remonte les 3 tâches les plus bloquantes en tête de liste et relance une seconde passe.
 */

import { ScheduleAR } from '../src/scheduleAR.js';
import { Loader } from '../src/loader.js';
import { exec } from 'child_process';
import { ScheduleAnalysis } from '../src/scheduleAnalysis.js';

if (process.platform === 'win32') {
    exec('chcp 65001', () => {});
}

function displayTopBlockingTasks(scheduler: ScheduleAR, tasks: ReturnType<typeof Loader.tasksManager.getAllTasks>): void {
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

async function testPriorityRetry(): Promise<void> {
    console.log('📋 TEST SCHEDULE AR — PRIORITY RETRY (N=3)');
    console.log('===========================================\n');

    try {
        Loader.reload();

        const tasks = Loader.tasksManager.getAllTasks();
        console.log(`📚 Données chargées: ${tasks.length} tâches, ${Loader.resourcesManager.getAllResources().length} ressources`);

        const scheduler = new ScheduleAR();
        scheduler.setMaxCompleteSolutions(10);
        scheduler.setTimeoutSeconds(180);

        console.log('\n🚀 Lancement de solveWithPriorityRetry(3)...\n');
        const startTime = Date.now();
        const results = scheduler.solveWithPriorityRetry(3);
        const executionTime = Date.now() - startTime;

        const result = results[0] ?? { solutions: [], isComplete: false, conflictCount: 0, score: undefined };

        console.log(`\n🏆 CLASSEMENT DES ${results.length} SOLUTION(S) COMPLÈTE(S)`);
        console.log(`================================================`);
        if (results.length === 0) {
            console.log(`   Aucune solution complète trouvée.`);
        } else {
            results.forEach((sol, i) => {
                console.log(`   ${i + 1}. score: ${sol.score ?? 'N/A'} — ${sol.solutions.length} tâches planifiées`);
            });
        }

        console.log(`\n⚡ MÉTRIQUES`);
        console.log(`============`);
        console.log(`⏱️  Temps total: ${executionTime}ms`);
        console.log(`📊 Tâches planifiées: ${result.solutions.length}/${tasks.length}`);
        console.log(`✅ Complète: ${result.isComplete ? 'Oui' : 'Non'}`);
        console.log(`🔢 Score: ${result.score ?? 'N/A'}`);
        console.log(`📈 Taux: ${(result.solutions.length / tasks.length * 100).toFixed(1)}%`);

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
            console.log('\n❌ Aucune solution — planification échouée même après retry.');
        }

        console.log(`\n🏁 Test PriorityRetry terminé !`);
    } catch (error) {
        console.error('❌ Erreur:', error);
        throw error;
    }
}

testPriorityRetry().catch(error => {
    console.error('💥 Échec du test:', error);
    process.exit(1);
});
