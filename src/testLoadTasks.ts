import { Loader } from './lib/loader.js';

console.log('=== Test de loadTasks ===\n');

function testLoadTasks() {
  try {
    // Test 1: Charger les tâches avec la semaine par défaut du JSON
    console.log('1. Chargement des tâches avec semaine par défaut:');
    const defaultTasks = Loader.loadTasks();
    
    console.log(`   📋 ${defaultTasks.length} tâches chargées`);
    
    // Afficher quelques exemples
    const sampleTasks = defaultTasks.slice(0, 5);
    for (const task of sampleTasks) {
      console.log(`   - ${task.id}: "${task.name}"`);
      console.log(`     Durée: ${task.duration} minutes`);
      console.log(`     Ressources: ${task.resources.length}`);
      
      // Afficher les types de ressources
      const resourceTypes = task.resources.map(r => `${r.id}(${r.resourceType})`);
      console.log(`     → ${resourceTypes.join(', ')}`);
      console.log('');
    }

    // Test 2: Charger les tâches pour une semaine spécifique
    console.log('\n2. Chargement des tâches pour la semaine 38:');
    const week38Tasks = Loader.loadTasks(38);
    
    console.log(`   📋 ${week38Tasks.length} tâches chargées pour la semaine 38`);
    
    if (week38Tasks.length > 0) {
      const firstTask = week38Tasks[0];
      console.log(`   Exemple: ${firstTask.name}`);
      console.log(`   Ressources avec contraintes semaine 38:`);
      
      for (const resource of firstTask.resources.slice(0, 3)) {
        console.log(`   - ${resource.id} (${resource.resourceType}):`);
        console.log(`     Disponibilité: ${resource.getTotalAvailableTime()} minutes`);
        
        if (resource.getTotalAvailableTime() > 0) {
          console.log(`     Créneaux:`);
          resource.availability.displaySchedule();
        }
      }
    }

    // Test 3: Statistiques globales
    console.log('\n3. Statistiques globales:');
    
    const teacherTasks = defaultTasks.filter(task => 
      task.resources.some(r => r.resourceType === 'teacher')
    );
    
    const roomTasks = defaultTasks.filter(task => 
      task.resources.some(r => r.resourceType === 'room')
    );
    
    const groupTasks = defaultTasks.filter(task => 
      task.resources.some(r => r.resourceType === 'group')
    );

    console.log(`   📊 Tâches avec enseignants: ${teacherTasks.length}`);
    console.log(`   📊 Tâches avec salles: ${roomTasks.length}`);
    console.log(`   📊 Tâches avec groupes: ${groupTasks.length}`);
    
    // Calculer la durée totale
    const totalDuration = defaultTasks.reduce((sum, task) => sum + task.duration, 0);
    const totalHours = Math.floor(totalDuration / 60);
    const totalMinutes = totalDuration % 60;
    
    console.log(`   ⏱️  Durée totale: ${totalHours}h${totalMinutes.toString().padStart(2, '0')} (${totalDuration} minutes)`);

  } catch (error) {
    console.error('❌ Erreur lors du test:', error);
  }
}

// Exécuter le test
testLoadTasks();
