import { Loader } from './lib/loader.js';
import { ConstraintsManager } from './constraintsManager.js';

console.log('=== Test des disponibilités ConstraintsManager - Semaine 36 ===\n');

function testConstraintsManagerWeek36() {
  try {
    // Charger toutes les tâches
    console.log('📚 Chargement de toutes les tâches...');
    const tasks = Loader.tasks;
    const resourcesManager = Loader.resourcesManager;
    const currentWeek = Loader.currentWeek;
    
    console.log(`✅ ${tasks.length} tâches chargées pour la semaine ${currentWeek}`);
    console.log(`📋 ${resourcesManager.getResourceCount()} ressources disponibles\n`);

    // Collecter toutes les ressources uniques utilisées dans les tâches
    const usedResources = new Set<string>();
    for (const task of tasks) {
      for (const resource of task.resources) {
        usedResources.add(resource.id);
      }
    }

    console.log(`🎯 ${usedResources.size} ressources distinctes utilisées dans les tâches\n`);
    console.log('=' .repeat(80));
    console.log(`📊 CRÉNEAUX DÉTAILLÉS POUR LA SEMAINE ${currentWeek}`);
    console.log('='.repeat(80));

    // Afficher TOUS les créneaux pour chaque ressource
    const sortedResources = Array.from(usedResources).sort();
    
    for (const resourceId of sortedResources) {
      console.log(`\n� ${resourceId}:`);
      console.log('-'.repeat(50));
      
      const availabilityManager = ConstraintsManager.getAvailabilityManager(resourceId, currentWeek!);
      
      if (availabilityManager) {
        // Afficher tous les créneaux détaillés
        availabilityManager.displaySchedule();
      } else {
        console.log('❌ Aucun AvailabilityManager retourné');
      }
    }

  } catch (error) {
    console.error('❌ Erreur lors du test:', error);
  }
}

// Exécuter le test
testConstraintsManagerWeek36();