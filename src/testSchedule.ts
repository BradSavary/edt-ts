import { Schedule } from './schedule.js';
import { Loader } from './lib/loader.js';

/**
 * Test de la classe Schedule avec l'algorithme de programmation par contraintes
 */

console.log('🧪 === TEST DE LA CLASSE SCHEDULE ===\n');

try {
    // Initialisation du planificateur
    const scheduler = new Schedule();
    
    console.log('📋 Chargement des données...');
    console.log(`📅 Semaine courante: ${Loader.currentWeek}`);
    console.log(`📋 Nombre de tâches: ${Loader.tasks.length}`);
    console.log(`🏢 Nombre de ressources: ${Loader.resourcesManager.getResourceCount()}`);
    
    if (Loader.tasks.length === 0) {
        console.log('⚠️ Aucune tâche à planifier. Vérifiez les données cours.json');
        process.exit(0);
    }
    
    console.log('\n🔍 Aperçu des tâches à planifier:');
    Loader.tasks.slice(0, 5).forEach(task => {
        console.log(`  - ${task.name} (durée: ${task.duration}, ressources: ${task.resources.length})`);
    });
    
    if (Loader.tasks.length > 5) {
        console.log(`  ... et ${Loader.tasks.length - 5} autres tâches`);
    }
    
    console.log('\n🚀 Lancement de la résolution...');
    console.log('⏳ Cela peut prendre quelques secondes...\n');
    
    // Résolution du problème de planification
    const startTime = Date.now();
    const solution = scheduler.solve();
    const endTime = Date.now();
    
    // Affichage des résultats
    console.log(`\n⚡ Résolution terminée en ${endTime - startTime}ms`);
    scheduler.displaySolutionStats(solution);
    
    // Analyse détaillée
    if (solution.isComplete) {
        console.log('\n🎉 SUCCÈS: Toutes les tâches ont été planifiées!');
    } else {
        const unscheduledCount = Loader.tasks.length - solution.solutions.length;
        console.log(`\n⚠️ PARTIEL: ${unscheduledCount} tâche(s) non planifiée(s)`);
        
        // Afficher quelques tâches non planifiées
        const scheduledTaskIds = new Set(solution.solutions.map(sol => sol.task.id));
        const unscheduledTasks = Loader.tasks.filter(task => !scheduledTaskIds.has(task.id));
        
        console.log('\n📝 Tâches non planifiées:');
        unscheduledTasks.slice(0, 5).forEach(task => {
            console.log(`  - ${task.name} (durée: ${task.duration}, ressources: ${task.resources.length})`);
        });
    }
    
    if (solution.conflictCount > 0) {
        console.log(`\n🔴 ATTENTION: ${solution.conflictCount} conflit(s) détecté(s)`);
        console.log('   -> Certaines ressources sont sur-réservées');
    } else {
        console.log('\n✅ Aucun conflit détecté dans la planification');
    }
    
    // Statistiques avancées
    console.log('\n📊 === STATISTIQUES AVANCÉES ===');
    
    if (solution.solutions.length > 0) {
        const resourceUsage = new Map<string, number>();
        solution.solutions.forEach(sol => {
            sol.assignedResources.forEach(resource => {
                const current = resourceUsage.get(resource.id) || 0;
                resourceUsage.set(resource.id, current + sol.task.duration);
            });
        });
        
        const totalUsage = Array.from(resourceUsage.values()).reduce((a, b) => a + b, 0);
        const avgUsage = totalUsage / resourceUsage.size;
        
        console.log(`📈 Utilisation moyenne des ressources: ${avgUsage.toFixed(1)} créneaux`);
        console.log(`🔝 Ressources les plus utilisées:`);
        
        const sortedUsage = Array.from(resourceUsage.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
            
        sortedUsage.forEach(([resourceId, usage], index) => {
            console.log(`   ${index + 1}. ${resourceId}: ${usage} créneaux`);
        });
        
        // Distribution temporelle
        const timeDistribution = new Array(5).fill(0); // 5 jours
        solution.solutions.forEach(sol => {
            const day = Math.floor(sol.startTime / 24);
            if (day >= 0 && day < 5) {
                timeDistribution[day]++;
            }
        });
        
        console.log('\n📅 Distribution par jour:');
        timeDistribution.forEach((count, day) => {
            const dayName = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'][day];
            console.log(`   ${dayName}: ${count} tâches`);
        });
    }
    
} catch (error) {
    console.error('❌ Erreur lors de l\'exécution:', error);
    process.exit(1);
}
