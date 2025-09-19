import { Loader } from '../lib/loader.js';
import { ScheduleExp } from '../scheduleExp.js';
import { ScheduleMR } from '../scheduleMR.js';

console.log('🔬 COMPARAISON SCHEDULEEXP VS SCHEDULEMR');
console.log('========================================\n');

try {
  // Charger les données une seule fois
  console.log('📚 Chargement des données...');
  const tasks = Loader.tasks;
  console.log(`✅ ${tasks.length} tâches chargées\n`);

  // Analyser le potentiel Multi-Rooms avant les tests
  console.log('🔍 ANALYSE DU POTENTIEL MULTI-ROOMS');
  console.log('-----------------------------------');
  const tasksWithMultipleRooms = tasks.filter(task => task.getAvailableRooms().length > 1);
  const totalAlternatives = tasks.reduce((sum, task) => sum + task.getAvailableRooms().length, 0);
  const averageRoomsPerTask = totalAlternatives / tasks.length;
  
  console.log(`📊 Tâches avec salles multiples: ${tasksWithMultipleRooms.length}/${tasks.length} (${((tasksWithMultipleRooms.length / tasks.length) * 100).toFixed(1)}%)`);
  console.log(`🏫 Total des alternatives de salles: ${totalAlternatives}`);
  console.log(`📈 Moyenne de salles par tâche: ${averageRoomsPerTask.toFixed(2)}`);
  
  // Afficher quelques exemples de tâches avec multiples salles
  console.log(`\n🏢 Exemples de tâches avec salles multiples:`);
  tasksWithMultipleRooms.slice(0, 5).forEach((task, index) => {
    const rooms = task.getAvailableRooms().map(r => r.id).join(', ');
    const current = task.getCurrentRoom()?.id || 'aucune';
    console.log(`   ${index + 1}. ${task.name} (${task.code})`);
    console.log(`      🎯 Salle actuelle: ${current}`);
    console.log(`      🏫 Salles possibles: ${rooms}`);
  });
  
  console.log('\n🔬 TEST 1: Approche Expérimentale (ScheduleExp)');
  console.log('------------------------------------------------');
  
  // Recharger les données pour un test propre
  Loader.reload();
  const startTimeExp = performance.now();
  
  const schedulerExp = new ScheduleExp();
  const resultExp = schedulerExp.solve();
  
  const endTimeExp = performance.now();
  const durationExp = Math.round(endTimeExp - startTimeExp);

  console.log(`⏱️ Temps d'exécution ScheduleExp: ${durationExp}ms`);
  console.log(`📊 Tâches planifiées: ${resultExp.solutions.length}`);
  console.log(`✅ Planification complète: ${resultExp.isComplete ? 'Oui' : 'Non'}`);
  
  // Vérifier les conflits
  const verificationExp = schedulerExp.verifySolution(resultExp.solutions);
  console.log(`🔍 Conflits détectés: ${verificationExp.conflicts.length}`);
  
  console.log('\n🏢 TEST 2: Approche Multi-Rooms (ScheduleMR)');
  console.log('---------------------------------------------');
  
  // Recharger les données pour un test propre
  Loader.reload();
  const startTimeMR = performance.now();
  
  const schedulerMR = new ScheduleMR();
  const resultMR = schedulerMR.solve();
  
  const endTimeMR = performance.now();
  const durationMR = Math.round(endTimeMR - startTimeMR);

  console.log(`⏱️ Temps d'exécution ScheduleMR: ${durationMR}ms`);
  console.log(`📊 Tâches planifiées: ${resultMR.solutions.length}`);
  console.log(`✅ Planification complète: ${resultMR.isComplete ? 'Oui' : 'Non'}`);
  
  // Vérifier les conflits
  const verificationMR = schedulerMR.verifySolution(resultMR.solutions);
  console.log(`🔍 Conflits détectés: ${verificationMR.conflicts.length}`);
  
  console.log('\n📊 COMPARAISON DES RÉSULTATS');
  console.log('============================');
  
  const improvementTasks = resultMR.solutions.length - resultExp.solutions.length;
  const improvementTime = durationMR - durationExp;
  const improvementConflicts = verificationExp.conflicts.length - verificationMR.conflicts.length;
  
  console.log(`⏱️ Performance:`);
  console.log(`   ScheduleExp: ${durationExp}ms`);
  console.log(`   ScheduleMR:  ${durationMR}ms`);
  console.log(`   Différence:  ${improvementTime > 0 ? '+' : ''}${improvementTime}ms (${improvementTime > 0 ? 'plus lent' : 'plus rapide'})`);
  
  console.log(`\n📋 Tâches planifiées:`);
  console.log(`   ScheduleExp: ${resultExp.solutions.length}/${tasks.length}`);
  console.log(`   ScheduleMR:  ${resultMR.solutions.length}/${tasks.length}`);
  console.log(`   Amélioration: ${improvementTasks > 0 ? '+' : ''}${improvementTasks} tâches`);
  
  console.log(`\n🔍 Conflits:`);
  console.log(`   ScheduleExp: ${verificationExp.conflicts.length}`);
  console.log(`   ScheduleMR:  ${verificationMR.conflicts.length}`);
  console.log(`   Amélioration: ${improvementConflicts > 0 ? '-' : ''}${Math.abs(improvementConflicts)} conflits`);
  
  console.log(`\n✅ Complétude:`);
  console.log(`   ScheduleExp: ${resultExp.isComplete ? '100%' : `${((resultExp.solutions.length / tasks.length) * 100).toFixed(1)}%`}`);
  console.log(`   ScheduleMR:  ${resultMR.isComplete ? '100%' : `${((resultMR.solutions.length / tasks.length) * 100).toFixed(1)}%`}`);
  
  // Analyse des salles utilisées
  console.log('\n🏫 ANALYSE DES SALLES UTILISÉES');
  console.log('===============================');
  
  const analyzeRoomUsage = (solutions: any[], label: string) => {
    const roomUsage = new Map<string, number>();
    solutions.forEach(sol => {
      const room = sol.task.getCurrentRoom();
      if (room) {
        roomUsage.set(room.id, (roomUsage.get(room.id) || 0) + 1);
      }
    });
    
    console.log(`\n📊 ${label}:`);
    console.log(`   Salles utilisées: ${roomUsage.size}`);
    const sortedRooms = Array.from(roomUsage.entries()).sort((a, b) => b[1] - a[1]);
    console.log(`   Top 5 des salles les plus utilisées:`);
    sortedRooms.slice(0, 5).forEach(([room, count], index) => {
      console.log(`      ${index + 1}. ${room}: ${count} tâches`);
    });
    
    return roomUsage;
  };
  
  const roomUsageExp = analyzeRoomUsage(resultExp.solutions, 'ScheduleExp');
  const roomUsageMR = analyzeRoomUsage(resultMR.solutions, 'ScheduleMR');
  
  // Calculer la diversité des salles
  const diversityExp = roomUsageExp.size;
  const diversityMR = roomUsageMR.size;
  
  console.log(`\n🌈 Diversité des salles:`);
  console.log(`   ScheduleExp: ${diversityExp} salles différentes`);
  console.log(`   ScheduleMR:  ${diversityMR} salles différentes`);
  console.log(`   Amélioration: ${diversityMR - diversityExp > 0 ? '+' : ''}${diversityMR - diversityExp} salles`);
  
  // Verdict final
  console.log('\n🏆 VERDICT FINAL');
  console.log('================');
  
  let score = 0;
  if (improvementTasks > 0) score += 3;
  if (improvementConflicts > 0) score += 2;
  if (diversityMR > diversityExp) score += 1;
  if (resultMR.isComplete && !resultExp.isComplete) score += 3;
  
  if (score >= 5) {
    console.log('🥇 ScheduleMR est SIGNIFICATIVEMENT MEILLEUR que ScheduleExp');
  } else if (score >= 3) {
    console.log('🥈 ScheduleMR est MEILLEUR que ScheduleExp');
  } else if (score >= 1) {
    console.log('🥉 ScheduleMR montre des AMÉLIORATIONS par rapport à ScheduleExp');
  } else {
    console.log('⚖️ ScheduleMR et ScheduleExp ont des PERFORMANCES SIMILAIRES');
  }
  
  if (improvementTime > 1000) {
    console.log(`⚠️ Note: ScheduleMR est plus lent de ${improvementTime}ms (exploration plus exhaustive)`);
  }
  
  console.log('\n✅ Comparaison terminée avec succès !');
  
} catch (error) {
  console.error('❌ Erreur lors de la comparaison:', error);
  process.exit(1);
}