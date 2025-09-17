import { Loader } from './lib/loader.js';

console.log('🔍 Diagnostic détaillé GILLET Anthony S36...\n');

// Charger les ressources
const resourcesManager = Loader.resourcesManager;
const mondollotResource = resourcesManager.getResource('GILLET Anthony');

if (mondollotResource) {
    console.log(`👨‍🏫 Ressource GILLET Anthony trouvée`);
    
    // Vérifier la disponibilité totale
    const totalTime = mondollotResource.getTotalAvailableTime();
    console.log(`🕒 Temps total disponible: ${totalTime} minutes`);
    
    // Afficher les créneaux disponibles via la méthode publique
    console.log(`\n📅 Créneaux de GILLET Anthony:`);
    console.log('   (Utilisation de la méthode publique getAvailableSlots)');
    
    // Vérifier l'application des contraintes S36
    console.log('\n🔧 Vérification de l\'application des contraintes S36...');
    
    // Charger les contraintes directement
    const constraints = Loader.loadConstraints();
    const mondollotConstraints = constraints['GILLET Anthony'];
    console.log('📋 Contraintes MONDOLLOT:');
    console.log(JSON.stringify(mondollotConstraints, null, 2));
    
} else {
    console.log('❌ Ressource GILLET Anthony non trouvée');
}