import { Loader } from './lib/loader.js';

console.log('=== Test des propriétés statiques du Loader ===\n');

function testLoaderProperties() {
  try {
    console.log('1. Test d\'accès aux propriétés statiques:');
    
    // Test du ResourcesManager
    console.log('   📦 Accès au ResourcesManager:');
    const manager = Loader.resourcesManager;
    console.log(`      - ${manager.getResourceCount()} ressources chargées`);
    console.log(`      - Type: ${manager.toString()}`);
    
    // Test des tâches
    console.log('\n   📋 Accès aux tâches:');
    const tasks = Loader.tasks;
    console.log(`      - ${tasks.length} tâches chargées`);
    console.log(`      - Semaine courante: ${Loader.currentWeek}`);
    
    // Afficher quelques exemples de tâches
    console.log('\n   📝 Exemples de tâches:');
    for (const task of tasks.slice(0, 3)) {
      console.log(`      - ${task.id}: "${task.name}"`);
      console.log(`        Durée: ${task.duration}min, Ressources: ${task.resources.length}`);
    }
    
    // Test de rechargement pour une semaine spécifique
    console.log('\n2. Test de chargement pour une semaine spécifique:');
    const week38Tasks = Loader.loadTasksForWeek(38);
    console.log(`   📅 ${week38Tasks.length} tâches chargées pour la semaine 38`);
    console.log(`   📅 Semaine courante mise à jour: ${Loader.currentWeek}`);
    
    // Vérifier que les propriétés statiques sont mises à jour
    console.log('\n3. Vérification de la mise à jour des propriétés:');
    const currentTasks = Loader.tasks;
    const isSameReference = currentTasks === week38Tasks;
    console.log(`   🔗 Les tâches courantes pointent vers la semaine 38: ${isSameReference}`);
    console.log(`   📊 Nombre de tâches identique: ${currentTasks.length === week38Tasks.length}`);
    
    // Test de reload
    console.log('\n4. Test de reload:');
    Loader.reload();
    console.log('   🔄 Reload effectué');
    
    // Les prochains accès vont recharger les données
    const reloadedTasks = Loader.tasks;
    console.log(`   📋 ${reloadedTasks.length} tâches rechargées`);
    console.log(`   📅 Semaine après reload: ${Loader.currentWeek}`);
    
    // Test d'accès multiple (doit utiliser le cache)
    console.log('\n5. Test de performance du cache:');
    const start = Date.now();
    
    for (let i = 0; i < 100; i++) {
      Loader.resourcesManager; // Accès pour tester le cache
      Loader.tasks; // Accès pour tester le cache
    }
    
    const end = Date.now();
    console.log(`   ⚡ 200 accès aux propriétés en ${end - start}ms (cache efficace)`);
    
    // Test d'utilisation pratique
    console.log('\n6. Exemple d\'utilisation pratique:');
    const teachers = Loader.resourcesManager.findResources(r => r.resourceType === 'teacher');
    const tasksWithManyResources = Loader.tasks.filter(t => t.resources.length > 4);
    
    console.log(`   👨‍🏫 Enseignants disponibles: ${teachers.length}`);
    console.log(`   📚 Tâches avec plus de 4 ressources: ${tasksWithManyResources.length}`);
    
    // Afficher une tâche complexe
    if (tasksWithManyResources.length > 0) {
      const complexTask = tasksWithManyResources[0];
      console.log(`   📖 Exemple de tâche complexe: "${complexTask.name}"`);
      console.log(`      Ressources: ${complexTask.resources.map(r => `${r.id}(${r.resourceType})`).join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ Erreur lors du test:', error);
  }
}

// Exécuter le test
testLoaderProperties();
