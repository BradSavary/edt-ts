/**
 * Script de test pour la planification des tâch    console.log(`✅ Tâches planifiées: ${scheduledTasks}/${tasks.length}`);
    console.log(`📈 Taux de réussite: ${successRate.toFixed(1)}%`);
    console.log(`⏱️  Temps d'exécution: ${executionTime.toFixed(2)}ms`);
    console.log(`🔢 Conflits détectés: ${solution.conflictCount}`);
    console.log(`✔️  Planification complète: ${solution.isComplete ? 'Oui' : 'Non'}`);

    // Export iCal si des tâches ont été planifiées
    if (scheduledTasks > 0) {
      console.log('\n📅 EXPORT iCAL');
      console.log('=' .repeat(60));
      
      try {
        schedule.export2ICal();
        console.log('✅ Export iCal terminé avec succès!');
      } catch (error) {
        console.error('❌ Erreur lors de l\'export iCal:', error);
      }
    } else {
      console.log('\n⚠️ Aucune tâche planifiée - Export iCal ignoré');
    } fichier cours.json
 * Teste l'algorithme de planification sur les données réelles
 */

import { Loader } from '../lib/loader.js';
import { Schedule } from '../schedule.js';

async function testScheduling() {
  console.log('🧪 Test de planification des tâches depuis cours.json\n');
  console.log('=' .repeat(60));

  try {
    // Chargement des données
    console.log('📚 Chargement des données...');
    const tasks = Loader.tasks;
    const currentWeek = Loader.currentWeek;
    
    console.log(`✅ ${tasks.length} tâches chargées pour la semaine ${currentWeek}`);
    
    // Afficher quelques informations sur les tâches
    console.log('\n📋 Aperçu des tâches:');
    tasks.slice(0, 5).forEach((task, index) => {
      const teachers = task.resources.filter(r => r.type === 'teacher');
      const groups = task.resources.filter(r => r.type === 'group');
      const rooms = task.resources.filter(r => r.type === 'room');
      
      console.log(`   ${index + 1}. ${task.code} - ${task.name} (${task.duration}h)`);
      console.log(`      Enseignant: ${teachers.map(t => t.id).join(', ')}`);
      console.log(`      Groupes: ${groups.map(g => g.id).join(', ')}`);
      console.log(`      Salles: ${rooms.map(r => r.id).join(', ')}`);
    });
    if (tasks.length > 5) {
      console.log(`   ... et ${tasks.length - 5} autres tâches`);
    }

    // Lancement de la planification
    console.log('\n🚀 Lancement de la planification...');
    const startTime = performance.now();
    
    const schedule = new Schedule();
    const solution = schedule.solve();
    
    const endTime = performance.now();
    const executionTime = endTime - startTime;

    // Analyse des résultats
    console.log('\n📊 RÉSULTATS DE LA PLANIFICATION');
    console.log('=' .repeat(60));
    
    const scheduledTasks = solution.solutions.length;
    const successRate = (scheduledTasks / tasks.length) * 100;
    
    console.log(`✅ Tâches planifiées: ${scheduledTasks}/${tasks.length}`);
    console.log(`📈 Taux de réussite: ${successRate.toFixed(1)}%`);
    console.log(`⏱️  Temps d'exécution: ${executionTime.toFixed(2)}ms`);
    console.log(`🔢 Conflits détectés: ${solution.conflictCount}`);
    console.log(`✔️  Planification complète: ${solution.isComplete ? 'Oui' : 'Non'}`);

    // Détails des tâches non planifiées
    const unscheduledTasks = tasks.filter(task => 
      !solution.solutions.some(sol => sol.task.id === task.id)
    );

    if (unscheduledTasks.length > 0) {
      console.log(`\n⚠️  TÂCHES NON PLANIFIÉES (${unscheduledTasks.length}):`);
      unscheduledTasks.forEach((task, index) => {
        console.log(`   ${index + 1}. ${task.code} - ${task.name}`);
        console.log(`      Durée: ${task.duration}h | Ressources: ${task.resources.length}`);
      });
    }

    // Analyse par créneaux horaires
    console.log('\n📅 RÉPARTITION PAR CRÉNEAUX:');
    const slotUsage = new Array(120).fill(0); // 5 jours * 24 créneaux
    
    solution.solutions.forEach(sol => {
      for (let i = 0; i < sol.task.duration; i++) {
        if (sol.startTime + i < 120) {
          slotUsage[sol.startTime + i]++;
        }
      }
    });

    const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
    for (let day = 0; day < 5; day++) {
      const daySlots = slotUsage.slice(day * 24, (day + 1) * 24);
      const usedSlots = daySlots.filter(usage => usage > 0).length;
      const totalUsage = daySlots.reduce((sum, usage) => sum + usage, 0);
      
      console.log(`   ${days[day]}: ${usedSlots}/24 créneaux utilisés (${totalUsage} cours)`);
    }

    // Analyse des ressources
    console.log('\n🏢 UTILISATION DES RESSOURCES:');
    const resourceManager = Loader.resourcesManager;
    const allResources = resourceManager.getAllResources();
    const teachers = allResources.filter(r => r.type === 'teacher');
    const rooms = allResources.filter(r => r.type === 'room');
    const groups = allResources.filter(r => r.type === 'group');

    // Compter l'utilisation des enseignants
    const teacherUsage = new Map<string, number>();
    solution.solutions.forEach(sol => {
      sol.assignedResources.forEach(res => {
        if (res.type === 'teacher') {
          teacherUsage.set(res.id, (teacherUsage.get(res.id) || 0) + 1);
        }
      });
    });

    console.log(`   👨‍🏫 Enseignants utilisés: ${teacherUsage.size}/${teachers.length}`);
    console.log(`   🏫 Salles disponibles: ${rooms.length}`);
    console.log(`   👥 Groupes disponibles: ${groups.length}`);

    // Top 5 enseignants les plus utilisés
    const topTeachers = Array.from(teacherUsage.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    if (topTeachers.length > 0) {
      console.log('\n🏆 Top 5 enseignants les plus utilisés:');
      topTeachers.forEach(([teacher, count], index) => {
        console.log(`   ${index + 1}. ${teacher}: ${count} cours`);
      });
    }

    // Export iCal si des tâches ont été planifiées
    if (scheduledTasks > 0) {
      console.log('\n📅 EXPORT ICAL');
      console.log('=' .repeat(60));
      try {
        const icalPath = schedule.export2ICal();
        console.log(`✅ Fichier iCal exporté: ${icalPath}`);
        console.log(`📊 ${scheduledTasks} événements exportés`);
      } catch (icalError) {
        console.error('❌ Erreur lors de l\'export iCal:', icalError);
      }
    } else {
      console.log('\n⚠️ Aucune tâche planifiée - pas d\'export iCal');
    }

    console.log('\n🎯 Test terminé avec succès!');

  } catch (error) {
    console.error('\n❌ Erreur lors du test de planification:', error);
    process.exit(1);
  }
}

// Exécuter le test
testScheduling();