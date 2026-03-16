import { Loader } from '../src/lib/loader.js';

console.log('🧪 Test de compatibilité des modifications Task avec salles multiples');
console.log('===================================================================\n');

try {
  // Charger les tâches avec les nouvelles modifications
  console.log('📚 Chargement des tâches...');
  const tasks = Loader.tasks;
  
  console.log(`✅ ${tasks.length} tâches chargées avec succès\n`);
  
  // Test des nouvelles fonctionnalités
  console.log('🔍 Test des nouvelles fonctionnalités:');
  
  // Prendre les 5 premières tâches pour les tests
  for (let i = 0; i < Math.min(5, tasks.length); i++) {
    const task = tasks[i];
    console.log(`\n📋 Tâche ${i + 1}: ${task.name} (${task.id})`);
    
    // Tester les nouvelles méthodes
    const availableRooms = task.getAvailableRooms();
    const currentRoom = task.getCurrentRoom();
    const alternativeRooms = task.getAlternativeRooms();
    
    console.log(`   🏫 Salles disponibles: ${availableRooms.length} (${availableRooms.map(r => r.id).join(', ')})`);
    console.log(`   🎯 Salle actuelle: ${currentRoom?.id || 'aucune'}`);
    console.log(`   🔄 Salles alternatives: ${alternativeRooms.length} (${alternativeRooms.map(r => r.id).join(', ')})`);
    
    // Test de changement de salle si possible
    if (alternativeRooms.length > 0) {
      const newRoom = alternativeRooms[0];
      console.log(`   ⚡ Test changement vers: ${newRoom.id}`);
      const success = task.changeRoom(newRoom);
      console.log(`   ${success ? '✅' : '❌'} Changement de salle: ${success ? 'réussi' : 'échoué'}`);
      
      if (success) {
        console.log(`   🎯 Nouvelle salle actuelle: ${task.getCurrentRoom()?.id}`);
      }
    }
  }
  
  console.log('\n📊 Statistiques:');
  const tasksWithMultipleRooms = tasks.filter(task => task.getAvailableRooms().length > 1);
  console.log(`   📈 Tâches avec plusieurs salles possibles: ${tasksWithMultipleRooms.length}/${tasks.length}`);
  
  const averageRoomsPerTask = tasks.reduce((sum, task) => sum + task.getAvailableRooms().length, 0) / tasks.length;
  console.log(`   🔢 Nombre moyen de salles par tâche: ${averageRoomsPerTask.toFixed(2)}`);
  
  console.log('\n✅ Test de compatibilité terminé avec succès!');
  
} catch (error) {
  console.error('❌ Erreur lors du test:', error);
  process.exit(1);
}