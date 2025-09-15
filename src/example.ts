import { Loader } from './lib/loader';
import { ResourceType } from './resource';

// Exemple d'utilisation : test de loadResources pour charger toutes les ressources

function testLoadResources() {
  try {
    console.log('🔄 Chargement des ressources depuis les fichiers JSON...');
    
    // Charger toutes les ressources via loadResources
    const manager = Loader.loadResources();
    
    // Afficher les statistiques générales
    console.log('\n📊 Statistiques générales:');
    console.log(manager.toString());
    console.log(`Total des ressources: ${manager.getResourceCount()}`);
    
    // Afficher les ressources par type
    console.log('\n🏫 Salles:');
    const rooms = manager.findResources(resource => resource.resourceType === ResourceType.ROOM);
    rooms.forEach(room => {
      console.log(`  - ${room.id} (${room.resourceType})`);
    });
    
    console.log('\n👥 Groupes:');
    const groups = manager.findResources(resource => resource.resourceType === ResourceType.GROUP);
    groups.forEach(group => {
      console.log(`  - ${group.id} (${group.resourceType})`);
    });
    
    console.log('\n👨‍🏫 Enseignants:');
    const teachers = manager.findResources(resource => resource.resourceType === ResourceType.TEACHER);
    teachers.forEach(teacher => {
      console.log(`  - ${teacher.id} (${teacher.resourceType})`);
    });
    
    // Test des fonctionnalités du ResourcesManager
    console.log('\n🔍 Tests d\'accès aux ressources:');
    
    // Test d'accès direct par ID
    if (rooms.length > 0) {
      const firstRoom = rooms[0];
      const foundRoom = manager.getResource(firstRoom.id);
      console.log(`Accès direct à ${firstRoom.id}: ${foundRoom ? '✅ Trouvé' : '❌ Non trouvé'}`);
    }
    
    // Test de vérification d'existence
    console.log(`Ressource 'inexistante' existe: ${manager.hasResource('inexistante') ? '❌ Oui' : '✅ Non'}`);
    
    // Test de recherche par prédicat
    const sallesStartingWithS = manager.findResources(resource => 
      resource.resourceType === ResourceType.ROOM && resource.id.toLowerCase().startsWith('s')
    );
    console.log(`Salles commençant par 'S': ${sallesStartingWithS.length} trouvée(s)`);
    
    // Afficher quelques exemples de workload et pressure
    console.log('\n⚖️ Tests de workload et pressure:');
    if (teachers.length > 0) {
      const teacher = teachers[0];
      console.log(`${teacher.id}:`);
      console.log(`  - Workload initial: ${teacher.workload} minutes`);
      console.log(`  - Pressure initiale: ${teacher.pressure()}`);
      
      // Ajouter du workload et voir l'effet
      teacher.addWorkload(240); // 4 heures
      console.log(`  - Après ajout de 4h de workload: ${teacher.workload} minutes`);
      console.log(`  - Nouvelle pressure: ${teacher.pressure()}`);
    }
    
    console.log('\n✅ Test de loadResources terminé avec succès!');
    
  } catch (error) {
    console.error('❌ Erreur lors du test de loadResources:', error);
  }
}

// Exécuter le test
testLoadResources();
