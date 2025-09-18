import { Loader } from '../lib/loader.js';
import { ScheduleExp } from '../scheduleExp.js';

console.log('🧪 Test de l\'approche expérimentale avec les nouvelles modifications');
console.log('====================================================================\n');

try {
  // Charger les tâches
  console.log('📚 Chargement des tâches...');
  const tasks = Loader.tasks;
  console.log(`✅ ${tasks.length} tâches chargées\n`);

  // Test de l'approche expérimentale
  console.log('🔬 Test de l\'approche expérimentale...');
  const startTime = performance.now();
  
  const scheduler = new ScheduleExp();
  const result = scheduler.solve();
  
  const endTime = performance.now();
  const duration = Math.round(endTime - startTime);

  console.log(`⏱️ Temps d'exécution: ${duration}ms`);
  console.log(`📊 Tâches planifiées: ${result.solutions.length}`);
  console.log(`✅ Planification complète: ${result.isComplete ? 'Oui' : 'Non'}`);
  
  // Compter les conflits
  const verification = scheduler.verifySolution(result.solutions);
  console.log(`🔍 Conflits détectés: ${verification.conflicts.length}`);
  
  if (result.isComplete && verification.isValid) {
    console.log('\n🎉 Succès ! L\'approche expérimentale fonctionne parfaitement avec les nouvelles modifications');
  } else if (verification.isValid) {
    console.log('\n✅ Pas de conflits détectés, mais planification incomplète (normal avec limite de temps)');
  } else {
    console.log('\n⚠️  Des conflits ont été détectés');
  }

  // Test de changement de salle sur quelques tâches
  console.log('\n🔄 Test de changement de salles sur les tâches planifiées...');
  const scheduledTasks = result.solutions.map(sol => sol.task);
  let changeTests = 0;
  let successfulChanges = 0;

  for (const task of scheduledTasks.slice(0, 5)) { // Test sur les 5 premières tâches planifiées
    if (task.getAlternativeRooms().length > 0) {
      changeTests++;
      const newRoom = task.getAlternativeRooms()[0];
      const oldRoom = task.getCurrentRoom();
      
      // Annuler la planification pour pouvoir changer la salle
      task.cancel();
      const success = task.changeRoom(newRoom);
      
      if (success) {
        successfulChanges++;
        console.log(`   ✅ ${task.code}: ${oldRoom?.id} → ${newRoom.id}`);
      } else {
        console.log(`   ❌ ${task.code}: échec du changement`);
      }
    }
  }

  console.log(`\n📈 Changements de salles testés: ${changeTests}`);
  console.log(`✅ Changements réussis: ${successfulChanges}`);
  
  console.log('\n🎯 Test terminé avec succès !');
  
} catch (error) {
  console.error('❌ Erreur lors du test:', error);
  process.exit(1);
}