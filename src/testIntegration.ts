import { Loader } from './lib/loader.js';
import { ConstraintsManager } from './constraintsManager.js';
import { Resource } from './resource.js';

console.log('=== Test d\'intégration Contraintes + ResourcesManager ===\n');

try {
  // Charger les ressources depuis les fichiers JSON
  const resourcesManager = Loader.loadResources();
  console.log(`📦 Ressources chargées: ${resourcesManager.getResourceCount()}`);

  // Afficher quelques statistiques avant application des contraintes
  console.log('\n📊 Avant application des contraintes:');
  const sampleResources = ['MEUNIER Sandrine', 'GIRARD Damien', '101'];
  for (const resourceId of sampleResources) {
    const resource = resourcesManager.getResource(resourceId);
    if (resource) {
      const availability = resource.getTotalAvailableTime();
      console.log(`   - ${resourceId}: ${availability} minutes`);
    }
  }

  // Appliquer les contraintes par défaut
  console.log('\n🔧 Application des contraintes par défaut...');
  resourcesManager.applyConstraints();

  // Afficher les statistiques après application des contraintes
  console.log('\n📊 Après application des contraintes:');
  for (const resourceId of sampleResources) {
    const resource = resourcesManager.getResource(resourceId);
    if (resource) {
      const availability = resource.getTotalAvailableTime();
      const pressure = resource.pressure();
      console.log(`   - ${resourceId}: ${availability} minutes (pression: ${pressure.toFixed(2)})`);
    }
  }

  // Test avec une semaine spécifique (semaine 38)
  console.log('\n📅 Application des contraintes pour la semaine 38...');
  resourcesManager.applyConstraintsForWeek(38);

  console.log('\n📊 Après contraintes semaine 38:');
  for (const resourceId of sampleResources) {
    const resource = resourcesManager.getResource(resourceId);
    if (resource) {
      const availability = resource.getTotalAvailableTime();
      const pressure = resource.pressure();
      const overrideWeeks = ConstraintsManager.getOverrideWeeks(resourceId);
      console.log(`   - ${resourceId}: ${availability} minutes (pression: ${pressure.toFixed(2)})`);
      if (overrideWeeks.includes(38)) {
        console.log(`     ⚠️  Override actif pour la semaine 38`);
      }
    }
  }

  // Statistiques globales des contraintes
  console.log('\n📈 Statistiques des contraintes:');
  const constraintsStats = resourcesManager.getConstraintsStats();
  console.log(`   - Ressources avec contraintes: ${constraintsStats.resourcesWithConstraints}`);
  console.log(`   - Ressources avec overrides: ${constraintsStats.resourcesWithOverrides}`);
  console.log(`   - Disponibilité moyenne: ${constraintsStats.averageAvailability.toFixed(0)} minutes`);

  // Test des ressources par type
  console.log('\n🏷️  Ressources par type:');
  const teachers = resourcesManager.findResources((r: Resource) => r.resourceType === 'teacher');
  const rooms = resourcesManager.findResources((r: Resource) => r.resourceType === 'room');
  const groups = resourcesManager.findResources((r: Resource) => r.resourceType === 'group');
  
  console.log(`   - Enseignants: ${teachers.length}`);
  console.log(`   - Salles: ${rooms.length}`);
  console.log(`   - Groupes: ${groups.length}`);

  // Exemples de recherche avec contraintes
  console.log('\n🔍 Ressources très disponibles (> 3000 minutes):');
  const highlyAvailable = resourcesManager.findResources((r: Resource) => r.getTotalAvailableTime() > 3000);
  for (const resource of highlyAvailable.slice(0, 5)) {
    console.log(`   - ${resource.id}: ${resource.getTotalAvailableTime()} minutes`);
  }

} catch (error) {
  console.error('❌ Erreur lors du test d\'intégration:', error);
}
