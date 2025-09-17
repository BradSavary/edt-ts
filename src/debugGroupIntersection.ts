import { Loader } from './lib/loader.js';

console.log('🔍 Diagnostic intersection des ressources pour Gestion de projet...\n');

// Charger les tâches
const tasks = Loader.tasks;
const resourcesManager = Loader.resourcesManager;

// Trouver la tâche de Gestion de projet
const mondollotTask = tasks.find(task => 
    task.name === 'Gestion de projet' && 
    task.resources.some(resource => resource.id === 'GILLET Anthony')
);

if (mondollotTask) {
    console.log(`📋 Tâche: ${mondollotTask.name}`);
    console.log(`🏢 Ressources: ${mondollotTask.resources.map(r => r.id).join(', ')}\n`);
    
    // Examiner chaque ressource individuellement
    mondollotTask.resources.forEach((resource, index) => {
        console.log(`${index + 1}. Ressource: ${resource.id} (${resource.type})`);
        const totalTime = resource.getTotalAvailableTime();
        console.log(`   Temps total disponible: ${totalTime} minutes`);
        
        if (totalTime === 0) {
            console.log(`   ❌ PROBLÈME: Cette ressource n'a aucun temps disponible !`);
        }
        console.log('');
    });
    
    // Vérifier spécifiquement les groupes BUT2-G21 et BUT2-G22
    const problematicGroups = ['BUT2-G21', 'BUT2-G22'];
    problematicGroups.forEach(groupId => {
        const group = resourcesManager.getResource(groupId);
        if (group) {
            console.log(`🔍 Groupe ${groupId}:`);
            const totalTime = group.getTotalAvailableTime();
            console.log(`   Temps disponible: ${totalTime} minutes`);
            if (totalTime === 0) {
                console.log(`   ❌ Ce groupe utilise les contraintes Default car il n'est pas dans contraintes.json`);
                console.log(`   📋 Default: lundi-vendredi 8:00-19:30`);
                console.log(`   🔍 Problème: Il faut vérifier pourquoi Default ne fonctionne pas`);
            }
        }
    });
    
} else {
    console.log('❌ Tâche non trouvée');
}