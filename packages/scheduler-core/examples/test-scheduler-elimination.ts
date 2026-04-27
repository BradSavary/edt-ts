/**
 * Test pour Scheduler — Stratégie solveWithElimination (N=3)
 *
 * Utilise la nouvelle architecture (Scheduler / ISchedulingUnit).
 *
 * Lance une première résolution normale. Si aucune solution complète n'est trouvée,
 * élimine itérativement (jusqu'à 3 fois) l'unité la plus bloquante et relance.
 * Les unités éliminées sont reportées dans result.neutralizedUnits.
 */

import { Scheduler } from '../src/scheduler.js';
import { Loader } from '../src/loader.js';
import { exec } from 'child_process';
import type { SchedulerSolution } from '../src/scheduler.js';

if (process.platform === 'win32') {
    exec('chcp 65001', () => {});
}

function displayTopBlockingUnits(scheduler: Scheduler): void {
    const failureCounts = scheduler.getTaskFailureCounts();
    console.log(`\n🎯 TOP 10 DES UNITÉS BLOQUANTES`);
    console.log(`================================`);
    if (failureCounts.size === 0) {
        console.log(`   Aucune unité bloquante détectée.`);
        return;
    }
    Array.from(failureCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([id, count], index) => {
            console.log(`   ${index + 1}. ${id} — ${count} blocage(s)`);
        });
}

function displaySolutionComparison(results: SchedulerSolution[]): void {
    if (results.length <= 1) return;
    console.log(`\n🔀 COMPARAISON DES SOLUTIONS (référence : S1)`);
    console.log(`=============================================`);
    const ref = results[0].solutions;
    const refMap = new Map(ref.map(s => [s.unit.id, s.start]));
    for (let i = 1; i < results.length; i++) {
        const other = results[i].solutions;
        let diffCount = 0;
        for (const sol of other) {
            const refStart = refMap.get(sol.unit.id);
            if (refStart === undefined || refStart !== sol.start) diffCount++;
        }
        const otherIds = new Set(other.map(s => s.unit.id));
        for (const id of refMap.keys()) {
            if (!otherIds.has(id)) diffCount++;
        }
        console.log(`   S${i + 1} vs S1 : ${diffCount} unité(s) placée(s) différemment`);
    }
}

async function testSchedulerElimination(): Promise<void> {
    console.log('📋 TEST SCHEDULER — UNIT ELIMINATION (N=3)');
    console.log('==========================================\n');

    try {
        Loader.reload();

        const tasks = Loader.tasksManager.getAllUnits();
        const resources = Array.from(Loader.resourcesManager.getAllResources());
        console.log(`📚 Données chargées: ${tasks.length} tâches, ${resources.length} ressources`);

        const scheduler = new Scheduler();
        scheduler.configure({
            maxSolutions: 10,
            timeoutSeconds: 180,
            maxEliminations: 3,
        });

        console.log('\n🚀 Lancement de solveWithElimination()...\n');
        const startTime = Date.now();
        const results = scheduler.solveWithElimination();
        const executionTime = Date.now() - startTime;

        const result = results[0] ?? { solutions: [], isComplete: false, score: undefined, neutralizedUnits: [] };

        // Unités neutralisées
        const neutralized = result.neutralizedUnits ?? [];
        console.log(`\n🗑️  UNITÉS NEUTRALISÉES (${neutralized.length})`);
        console.log(`================================`);
        if (neutralized.length === 0) {
            console.log(`   Aucune — solution trouvée sans élimination.`);
        } else {
            neutralized.forEach((info, i) => {
                console.log(`   ${i + 1}. ${info.unit.id} [round ${info.eliminationRound}] — ${info.failureCount} échec(s)`);
                console.log(`      ${info.reason}`);
            });
        }

        // Classement des solutions
        const completeCount = results.filter(s => (s.neutralizedUnits ?? []).length === 0 && s.isComplete).length;
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
                const neutralCount = (sol.neutralizedUnits ?? []).length;
                const status = neutralCount > 0 ? `⚠️  PARTIELLE [${neutralCount} unité(s) neutralisée(s)]` : `✅ COMPLÈTE`;
                console.log(`   ${i + 1}. ${status} — score: ${sol.score ?? 'N/A'} — ${sol.solutions.length} unité(s) planifiée(s)`);
            });
        }

        // Métriques
        console.log(`\n⚡ MÉTRIQUES`);
        console.log(`============`);
        console.log(`⏱️  Temps total: ${executionTime}ms`);
        console.log(`📊 Unités planifiées: ${result.solutions.length}/${tasks.length}`);
        console.log(`🗑️  Unités neutralisées: ${neutralized.length}`);
        console.log(`✅ Statut: ${result.isComplete ? 'Complète' : 'Partielle'}`);
        console.log(`🔢 Score: ${result.score ?? 'N/A'}`);
        console.log(`📈 Taux: ${(result.solutions.length / tasks.length * 100).toFixed(1)}%`);

        displaySolutionComparison(results);
        displayTopBlockingUnits(scheduler);

        if (result.solutions.length === 0) {
            console.log('\n❌ Aucune solution — planification échouée même après éliminations.');
        }

        console.log(`\n🏁 Test Scheduler Elimination terminé !`);
    } catch (error) {
        console.error('❌ Erreur:', error);
        throw error;
    }
}

testSchedulerElimination().catch(error => {
    console.error('💥 Échec du test:', error);
    process.exit(1);
});
