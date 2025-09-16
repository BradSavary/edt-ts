import { ConstraintsManager } from './constraintsManager.js';

console.log('=== Test du ConstraintsManager ===\n');

try {
  // Obtenir les statistiques générales
  const stats = ConstraintsManager.getStats();
  console.log('📊 Statistiques des contraintes:');
  console.log(`   - Total des ressources: ${stats.totalResources}`);
  console.log(`   - Ressources avec overrides: ${stats.resourcesWithOverrides}`);
  console.log(`   - Total des overrides: ${stats.totalOverrides}\n`);

  // Tester quelques ressources spécifiques
  const testResources = ['MEUNIER Sandrine', 'GIRARD Damien', '101', '102'];
  
  for (const resourceId of testResources) {
    console.log(`🔍 Resource: ${resourceId}`);
    
    if (ConstraintsManager.hasResource(resourceId)) {
      // Disponibilités par défaut
      const defaultAvailability = ConstraintsManager.getAvailabilityManager(resourceId);
      if (defaultAvailability) {
        const totalTime = defaultAvailability.getTotalAvailableTime();
        console.log(`   ✅ Disponibilité par défaut: ${totalTime} minutes`);
      }
      
      // Semaines avec overrides
      const overrideWeeks = ConstraintsManager.getOverrideWeeks(resourceId);
      if (overrideWeeks.length > 0) {
        console.log(`   📅 Semaines avec overrides: ${overrideWeeks.join(', ')}`);
        
        // Tester une semaine spécifique
        const firstWeek = overrideWeeks[0];
        const weeklyAvailability = ConstraintsManager.getAvailabilityManager(resourceId, firstWeek);
        if (weeklyAvailability) {
          const weeklyTime = weeklyAvailability.getTotalAvailableTime();
          console.log(`   📝 Disponibilité semaine ${firstWeek}: ${weeklyTime} minutes`);
        }
      } else {
        console.log(`   📅 Aucun override hebdomadaire`);
      }
    } else {
      console.log(`   ❌ Ressource non trouvée`);
    }
    console.log('');
  }

  // Test de l'accès à toutes les ressources
  console.log('📋 Liste de toutes les ressources:');
  const allResources = ConstraintsManager.getAllResourceIds();
  console.log(`   Total: ${allResources.length} ressources`);
  
  // Afficher quelques exemples
  const sampleResources = allResources.slice(0, 10);
  for (const resourceId of sampleResources) {
    const availability = ConstraintsManager.getAvailabilityManager(resourceId);
    const time = availability ? availability.getTotalAvailableTime() : 0;
    console.log(`   - ${resourceId}: ${time} minutes`);
  }
  
  if (allResources.length > 10) {
    console.log(`   ... et ${allResources.length - 10} autres`);
  }

} catch (error) {
  console.error('❌ Erreur lors du test:', error);
}
