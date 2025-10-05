/**
 * Test de la classe ScheduleAnalysis
 * Démontre l'utilisation des méthodes d'analyse statistique
 */

import { ScheduleAR } from '../scheduleAR.js';
import { Loader } from '../lib/loader.js';
import { ScheduleAnalysis } from '../scheduleAnalysis.js';
import { ResourceType } from '../resource.js';

console.log('📊 TEST SCHEDULE ANALYSIS');
console.log('=========================\n');

// Charger les données et planifier
console.log('🔄 Chargement et planification...');
Loader.reload();
const scheduler = new ScheduleAR();
const result = scheduler.solve();

console.log(`✅ Planification terminée: ${result.solutions.length} tâches planifiées\n`);

if (result.solutions.length === 0) {
    console.log('❌ Aucune tâche planifiée, test impossible');
    process.exit(1);
}

// Créer l'analyseur
const analysis = new ScheduleAnalysis(result.solutions);

// 1. Statistiques globales
console.log('📈 STATISTIQUES GLOBALES');
console.log('========================');
const globalStats = analysis.getGlobalStats(Loader.tasks.length);
console.log(`Tâches: ${globalStats.plannedTasks}/${globalStats.totalTasks} (${globalStats.completionRate.toFixed(1)}%)`);
console.log(`Ressources: ${globalStats.totalResourcesUsed} total`);
console.log(`  - Enseignants: ${globalStats.teachersUsed}`);
console.log(`  - Salles: ${globalStats.roomsUsed}`);
console.log(`  - Groupes: ${globalStats.groupsUsed}`);
console.log(`Période: ${globalStats.timeSpan.totalDays} jour(s)\n`);

// 2. Top enseignants
console.log('👨‍🏫 TOP 5 ENSEIGNANTS LES PLUS CHARGÉS');
console.log('======================================');
const topTeachers = analysis.getTopResourcesByLoad(ResourceType.TEACHER, 5);
for (let i = 0; i < topTeachers.length; i++) {
    const teacher = topTeachers[i];
    console.log(`${i + 1}. ${teacher.resourceId}: ${teacher.taskCount} cours, ${teacher.totalHours.toFixed(1)}h total`);
}
console.log();

// 3. Top salles
console.log('🏫 TOP 5 SALLES LES PLUS UTILISÉES');
console.log('==================================');
const topRooms = analysis.getTopResourcesByLoad(ResourceType.ROOM, 5);
for (let i = 0; i < topRooms.length; i++) {
    const room = topRooms[i];
    console.log(`${i + 1}. ${room.resourceId}: ${room.taskCount} cours, ${room.totalHours.toFixed(1)}h total`);
}
console.log();

// 4. Analyse par jour
console.log('📅 UTILISATION PAR JOUR');
console.log('=======================');
const dailyStats = analysis.analyzeDailyUsage();
for (const day of dailyStats) {
    console.log(`${day.dayOfWeek} (jour ${day.day}): ${day.taskCount} cours, ${day.totalHours.toFixed(1)}h, ${day.resourcesUsed.size} ressources`);
}
console.log();

// 5. Jours les plus chargés
console.log('📊 TOP 3 JOURS LES PLUS CHARGÉS');
console.log('================================');
const busiestDays = analysis.getBusiestDays(3);
for (let i = 0; i < busiestDays.length; i++) {
    const day = busiestDays[i];
    console.log(`${i + 1}. ${day.dayOfWeek} (jour ${day.day}): ${day.taskCount} cours`);
}
console.log();

// 6. Analyse de la charge quotidienne des groupes
console.log('📚 CHARGE QUOTIDIENNE DES GROUPES');
console.log('==================================');
const groupLoads = analysis.analyzeResourceDailyLoad(ResourceType.GROUP);
for (const load of groupLoads.slice(0, 5)) {
    console.log(`\n${load.resourceId}:`);
    console.log(`  Total: ${(load.totalUsage / 60).toFixed(1)}h`);
    console.log(`  Max/jour: ${(load.maxDailyUsage / 60).toFixed(1)}h`);
    console.log(`  Moyenne/jour: ${(load.avgDailyUsage / 60).toFixed(1)}h`);
    
    // Afficher détail par jour
    const days = Array.from(load.dailyUsage.entries()).sort((a, b) => a[0] - b[0]);
    for (const [day, usage] of days) {
        const dayName = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'][day % 7];
        console.log(`    ${dayName}: ${(usage / 60).toFixed(1)}h`);
    }
}
console.log();

// 7. Analyse d'un enseignant spécifique
console.log('🔍 ANALYSE DÉTAILLÉE D\'UN ENSEIGNANT');
console.log('=====================================');
const teacherId = topTeachers[0].resourceId;
const teacherDetail = analysis.analyzeResourceUsage(teacherId);
if (teacherDetail) {
    console.log(`Enseignant: ${teacherDetail.resourceId}`);
    console.log(`Total: ${teacherDetail.taskCount} cours, ${teacherDetail.totalHours.toFixed(1)}h`);
    console.log(`\nDétail des cours:`);
    for (const task of teacherDetail.tasks.slice(0, 5)) {
        const startHour = Math.floor((task.startTime % (24 * 60)) / 60);
        const startMin = (task.startTime % (24 * 60)) % 60;
        console.log(`  - ${task.taskName} (${task.dayOfWeek}, ${startHour}h${startMin.toString().padStart(2, '0')}, ${task.duration}min)`);
    }
    if (teacherDetail.tasks.length > 5) {
        console.log(`  ... et ${teacherDetail.tasks.length - 5} autres cours`);
    }
}
console.log();

// 9. Génération du rapport complet
console.log('📄 RAPPORT COMPLET');
console.log('==================\n');
const report = analysis.generateReport(Loader.tasks.length);
console.log(report);

// 10. Export JSON (optionnel)
console.log('\n💾 EXPORT JSON');
console.log('==============');
const jsonData = analysis.exportToJSON();
console.log(`Données exportées (${jsonData.length} caractères)`);
console.log('Structure:');
console.log('  - globalStats');
console.log('  - dailyUsage');
console.log('  - teacherStats');
console.log('  - roomStats');
console.log('  - groupStats');
console.log('  - resourceDailyLoads');

// 11. Analyse des interruptions (gaps) par ressource
console.log('\n⏸️  ANALYSE DES INTERRUPTIONS PAR RESSOURCE');
console.log('===========================================\n');

// Analyser les gaps pour les enseignants
console.log('👨‍🏫 TOP 5 ENSEIGNANTS AVEC LE PLUS D\'INTERRUPTIONS');
console.log('--------------------------------------------------');
const teacherGaps = analysis.analyzeResourceGaps(ResourceType.TEACHER);
for (const teacher of teacherGaps.slice(0, 5)) {
    console.log(`\n${teacher.resourceId}:`);
    console.log(`  Total interruptions: ${(teacher.totalGaps / 60).toFixed(1)}h`);
    
    const days = Array.from(teacher.dailyGaps.values()).sort((a, b) => a.day - b.day);
    for (const dayStats of days) {
        const firstHour = Math.floor((dayStats.firstCourseStart % (24 * 60)) / 60);
        const firstMin = (dayStats.firstCourseStart % (24 * 60)) % 60;
        const lastHour = Math.floor((dayStats.lastCourseEnd % (24 * 60)) / 60);
        const lastMin = (dayStats.lastCourseEnd % (24 * 60)) % 60;
        
        console.log(`  ${dayStats.dayOfWeek}: ${dayStats.courseCount} cours (${firstHour}h${firstMin.toString().padStart(2, '0')}-${lastHour}h${lastMin.toString().padStart(2, '0')}), ${dayStats.numberOfGaps} gaps = ${(dayStats.totalGapDuration / 60).toFixed(1)}h`);
    }
}

// Analyser les gaps pour les groupes
console.log('\n\n📚 TOP 5 GROUPES AVEC LE PLUS D\'INTERRUPTIONS');
console.log('---------------------------------------------');
const groupGaps = analysis.analyzeResourceGaps(ResourceType.GROUP);
for (const group of groupGaps.slice(0, 5)) {
    console.log(`\n${group.resourceId}:`);
    console.log(`  Total interruptions: ${(group.totalGaps / 60).toFixed(1)}h`);
    
    const days = Array.from(group.dailyGaps.values()).sort((a, b) => a.day - b.day);
    for (const dayStats of days) {
        const firstHour = Math.floor((dayStats.firstCourseStart % (24 * 60)) / 60);
        const firstMin = (dayStats.firstCourseStart % (24 * 60)) % 60;
        const lastHour = Math.floor((dayStats.lastCourseEnd % (24 * 60)) / 60);
        const lastMin = (dayStats.lastCourseEnd % (24 * 60)) % 60;
        
        console.log(`  ${dayStats.dayOfWeek}: ${dayStats.courseCount} cours (${firstHour}h${firstMin.toString().padStart(2, '0')}-${lastHour}h${lastMin.toString().padStart(2, '0')}), ${dayStats.numberOfGaps} gaps = ${(dayStats.totalGapDuration / 60).toFixed(1)}h`);
    }
}

// Analyser les gaps pour les salles
console.log('\n\n🏫 TOP 5 SALLES AVEC LE PLUS D\'INTERRUPTIONS');
console.log('---------------------------------------------');
const roomGaps = analysis.analyzeResourceGaps(ResourceType.ROOM);
for (const room of roomGaps.slice(0, 5)) {
    console.log(`\n${room.resourceId}:`);
    console.log(`  Total interruptions: ${(room.totalGaps / 60).toFixed(1)}h`);
    
    const days = Array.from(room.dailyGaps.values()).sort((a, b) => a.day - b.day);
    for (const dayStats of days) {
        const firstHour = Math.floor((dayStats.firstCourseStart % (24 * 60)) / 60);
        const firstMin = (dayStats.firstCourseStart % (24 * 60)) % 60;
        const lastHour = Math.floor((dayStats.lastCourseEnd % (24 * 60)) / 60);
        const lastMin = (dayStats.lastCourseEnd % (24 * 60)) % 60;
        
        console.log(`  ${dayStats.dayOfWeek}: ${dayStats.courseCount} cours (${firstHour}h${firstMin.toString().padStart(2, '0')}-${lastHour}h${lastMin.toString().padStart(2, '0')}), ${dayStats.numberOfGaps} gaps = ${(dayStats.totalGapDuration / 60).toFixed(1)}h`);
    }
}

console.log('\n🏁 Test terminé');
