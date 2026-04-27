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

function displayTopBlockingTasks(scheduler: Schedule, tasks: ReturnType<typeof Loader.tasksManager.getAllUnits>): void {
    const failureCounts = scheduler.getTaskFailureCounts();
    console.log(`\n🎯 TOP 10 DES TÂCHES BLOQUANTES`);
    console.log(`================================`);
    if (failureCounts.size === 0) {
        console.log(`   Aucune tâche bloquante détectée.`);
        return;
    }
    const taskById = new Map(tasks.map((t: import('@edt-ts/scheduler-common').ISchedulable) => [t.id, t]));
    Array.from(failureCounts.entries())
        .map(([id, count]) => ({ unit: taskById.get(id), id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .forEach(({ unit, id, count }, index) => {
            const label = unit ? `${unit.name} (${unit.code}) [${id}]` : id;
            console.log(`   ${index + 1}. ${label} — ${count} blocage(s)`);
        });
}

async function testTaskElimination(): Promise<void> {
    console.log('📋 TEST SCHEDULE AR — TASK ELIMINATION (N=3)');
    console.log('============================================\n');

    try {
        Loader.reload();

        const tasks = Loader.tasksManager.getAllUnits();
        console.log(`📚 Données chargées: ${tasks.length} tâches, ${Loader.resourcesManager.getAllResources().length} ressources`);

        const scheduler = new Schedule();
        scheduler.setMaxCompleteSolutions(10);
        scheduler.setTimeoutSeconds(180);
     //  scheduler.configure({ resourceSelection: 'random' });


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
                console.log(`   ${i + 1}. ${task.unit.name} (${task.unit.code})`);
            });
        }

        const completeCount = results.filter(s => (s.neutralizedTasks ?? []).length === 0).length;
        const partialCount  = results.length - completeCount;
        const heading = completeCount > 0
            ? `🏆 CLASSEMENT DES ${results.length} SOLUTION(S) (${completeCount} complète(s), ${partialCount} partielle(s))`
            : `🏆 CLASSEMENT DES ${results.length} SOLUTION(S) PARTIELLE(S)`;
        console.log(`\n${heading}`);
        console.log(`================================================`);
        if (results.length === 0) {
            console.log(`   Aucune solution trouvée.`);
        } else {
            results.forEach((sol, i) => {
                const neutralCount = (sol.neutralizedTasks ?? []).length;
                const status = neutralCount > 0 ? `⚠️  PARTIELLE [${neutralCount} tâche(s) neutralisée(s)]` : `✅ COMPLÈTE`;
                console.log(`   ${i + 1}. ${status} — score: ${sol.score ?? 'N/A'} — ${sol.solutions.length} tâches planifiées`);
            });
        }

        console.log(`\n⚡ MÉTRIQUES`);
        console.log(`============`);
        console.log(`⏱️  Temps total: ${executionTime}ms`);
        console.log(`📊 Tâches planifiées: ${result.solutions.length}/${tasks.length}`);
        console.log(`🗑️  Tâches neutralisées: ${neutralized.length}`);
        console.log(`✅ Statut: ${neutralized.length === 0 ? 'Complète' : 'Partielle'}`);
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

        // Comparaison des solutions par rapport à la solution de référence (S1)
        if (results.length > 1) {
            console.log(`\n🔀 COMPARAISON DES SOLUTIONS (référence : S1)`);
            console.log(`=============================================`);
            const ref = results[0].solutions;
            const refMap = new Map(ref.map(s => [s.unit.id, s.startTime]));
            for (let i = 1; i < results.length; i++) {
                const other = results[i].solutions;
                let diffCount = 0;
                for (const sol of other) {
                    const refStart = refMap.get(sol.unit.id);
                    if (refStart === undefined || refStart !== sol.startTime) diffCount++;
                }
                // Tâches présentes dans ref mais absentes de other (neutralisées différemment)
                const otherIds = new Set(other.map(s => s.unit.id));
                for (const id of refMap.keys()) {
                    if (!otherIds.has(id)) diffCount++;
                }
                console.log(`   S${i + 1} vs S1 : ${diffCount} tâche(s) placée(s) différemment`);
            }
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
