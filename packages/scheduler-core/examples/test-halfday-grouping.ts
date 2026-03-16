/**
 * Test de l'analyse de regroupement par demi-journée
 * Évalue la qualité du regroupement des cours pour chaque ressource
 */

import { ScheduleAR } from '../src/scheduleAR.js';
import { Loader } from '../src/lib/loader.js';
import { ScheduleAnalysis } from '../src/scheduleAnalysis.js';
import { ResourceType } from '../src/resource.js';

console.log('📊 TEST ANALYSE REGROUPEMENT PAR DEMI-JOURNÉE');
console.log('==============================================\n');

// Fonction pour formater les minutes en HH:MM
function formatTime(minutes: number): string {
    const totalMinutes = minutes % (24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}h${mins.toString().padStart(2, '0')}`;
}

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

console.log('═══════════════════════════════════════════════════════════════\n');

// Analyser les enseignants
console.log('👨‍🏫 ANALYSE DE REGROUPEMENT - ENSEIGNANTS');
console.log('==========================================\n');

const teacherGrouping = analysis.analyzeHalfDayGrouping(ResourceType.TEACHER);

console.log(`📊 Statistiques globales enseignants:`);
const avgCompactness = teacherGrouping.reduce((sum, t) => sum + t.compactnessScore, 0) / teacherGrouping.length;
const avgFragmentation = teacherGrouping.reduce((sum, t) => sum + t.fragmentationIndex, 0) / teacherGrouping.length;
const avgDensity = teacherGrouping.reduce((sum, t) => sum + t.averageCoursesPerHalfDay, 0) / teacherGrouping.length;

console.log(`   Compacité moyenne: ${(avgCompactness * 100).toFixed(1)}%`);
console.log(`   Fragmentation moyenne: ${avgFragmentation.toFixed(1)} jours incomplets/enseignant`);
console.log(`   Densité moyenne: ${avgDensity.toFixed(1)} cours/demi-journée\n`);

// Top 5 meilleurs regroupements
console.log('🏆 TOP 5 MEILLEURS REGROUPEMENTS (Enseignants):');
console.log('------------------------------------------------\n');

teacherGrouping.slice(0, 5).forEach((teacher, idx) => {
    console.log(`${idx + 1}. ${teacher.resourceId}`);
    console.log(`   📈 Compacité: ${(teacher.compactnessScore * 100).toFixed(0)}% (${teacher.minHalfDaysNeeded}/${teacher.halfDaysUsed} demi-journées)`);
    console.log(`   📚 ${teacher.totalCourses} cours sur ${teacher.halfDaysUsed} demi-journées`);
    console.log(`   📊 Densité: ${teacher.averageCoursesPerHalfDay.toFixed(1)} cours/demi-journée`);
    console.log(`   ⚠️  Fragmentation: ${teacher.fragmentationIndex} jour(s) incomplet(s)`);
    
    // Distribution
    const distArray = Array.from(teacher.distribution.entries()).sort((a, b) => b[0] - a[0]);
    const distStr = distArray.map(([count, nb]) => `${nb}×${count}cours`).join(', ');
    console.log(`   📋 Distribution: ${distStr}`);
    console.log();
});

// Top 5 pires regroupements
console.log('⚠️  TOP 5 REGROUPEMENTS À AMÉLIORER (Enseignants):');
console.log('--------------------------------------------------\n');

const worstTeachers = teacherGrouping.slice().sort((a, b) => a.compactnessScore - b.compactnessScore).slice(0, 5);

worstTeachers.forEach((teacher, idx) => {
    console.log(`${idx + 1}. ${teacher.resourceId}`);
    console.log(`   📉 Compacité: ${(teacher.compactnessScore * 100).toFixed(0)}% (${teacher.minHalfDaysNeeded}/${teacher.halfDaysUsed} demi-journées)`);
    console.log(`   📚 ${teacher.totalCourses} cours sur ${teacher.halfDaysUsed} demi-journées`);
    console.log(`   📊 Densité: ${teacher.averageCoursesPerHalfDay.toFixed(1)} cours/demi-journée`);
    console.log(`   ⚠️  Fragmentation: ${teacher.fragmentationIndex} jour(s) incomplet(s)`);
    
    // Détail des demi-journées
    console.log('   📅 Détail:');
    const sortedHalfDays = Array.from(teacher.halfDayBreakdown.values())
        .sort((a, b) => a.day - b.day || (a.period === 'morning' ? -1 : 1));
    
    sortedHalfDays.forEach(hd => {
        const periodLabel = hd.period === 'morning' ? '🌅 Matin' : '🌆 AM';
        console.log(`      ${hd.dayOfWeek} ${periodLabel}: ${hd.courseCount} cours (${(hd.totalDuration / 60).toFixed(1)}h)`);
    });
    console.log();
});

console.log('═══════════════════════════════════════════════════════════════\n');

// Analyser les groupes
console.log('📚 ANALYSE DE REGROUPEMENT - GROUPES');
console.log('=====================================\n');

const groupGrouping = analysis.analyzeHalfDayGrouping(ResourceType.GROUP);

console.log(`📊 Statistiques globales groupes:`);
const avgCompactnessG = groupGrouping.reduce((sum, g) => sum + g.compactnessScore, 0) / groupGrouping.length;
const avgFragmentationG = groupGrouping.reduce((sum, g) => sum + g.fragmentationIndex, 0) / groupGrouping.length;
const avgDensityG = groupGrouping.reduce((sum, g) => sum + g.averageCoursesPerHalfDay, 0) / groupGrouping.length;

console.log(`   Compacité moyenne: ${(avgCompactnessG * 100).toFixed(1)}%`);
console.log(`   Fragmentation moyenne: ${avgFragmentationG.toFixed(1)} jours incomplets/groupe`);
console.log(`   Densité moyenne: ${avgDensityG.toFixed(1)} cours/demi-journée\n`);

// Top 5 groupes
console.log('🏆 TOP 5 MEILLEURS REGROUPEMENTS (Groupes):');
console.log('--------------------------------------------\n');

groupGrouping.slice(0, 5).forEach((group, idx) => {
    console.log(`${idx + 1}. ${group.resourceId}`);
    console.log(`   📈 Compacité: ${(group.compactnessScore * 100).toFixed(0)}% (${group.minHalfDaysNeeded}/${group.halfDaysUsed} demi-journées)`);
    console.log(`   📚 ${group.totalCourses} cours sur ${group.halfDaysUsed} demi-journées`);
    console.log(`   📊 Densité: ${group.averageCoursesPerHalfDay.toFixed(1)} cours/demi-journée`);
    console.log(`   ⚠️  Fragmentation: ${group.fragmentationIndex} jour(s) incomplet(s)\n`);
});

console.log('═══════════════════════════════════════════════════════════════\n');

// Analyser les salles
console.log('🏫 ANALYSE DE REGROUPEMENT - SALLES');
console.log('====================================\n');

const roomGrouping = analysis.analyzeHalfDayGrouping(ResourceType.ROOM);

console.log(`📊 Statistiques globales salles:`);
const avgCompactnessR = roomGrouping.reduce((sum, r) => sum + r.compactnessScore, 0) / roomGrouping.length;
const avgFragmentationR = roomGrouping.reduce((sum, r) => sum + r.fragmentationIndex, 0) / roomGrouping.length;
const avgDensityR = roomGrouping.reduce((sum, r) => sum + r.averageCoursesPerHalfDay, 0) / roomGrouping.length;

console.log(`   Compacité moyenne: ${(avgCompactnessR * 100).toFixed(1)}%`);
console.log(`   Fragmentation moyenne: ${avgFragmentationR.toFixed(1)} jours incomplets/salle`);
console.log(`   Densité moyenne: ${avgDensityR.toFixed(1)} cours/demi-journée\n`);

// Top 5 salles
console.log('🏆 TOP 5 MEILLEURS REGROUPEMENTS (Salles):');
console.log('-------------------------------------------\n');

roomGrouping.slice(0, 5).forEach((room, idx) => {
    console.log(`${idx + 1}. ${room.resourceId}`);
    console.log(`   📈 Compacité: ${(room.compactnessScore * 100).toFixed(0)}% (${room.minHalfDaysNeeded}/${room.halfDaysUsed} demi-journées)`);
    console.log(`   📚 ${room.totalCourses} cours sur ${room.halfDaysUsed} demi-journées`);
    console.log(`   📊 Densité: ${room.averageCoursesPerHalfDay.toFixed(1)} cours/demi-journée`);
    console.log(`   ⚠️  Fragmentation: ${room.fragmentationIndex} jour(s) incomplet(s)\n`);
});

console.log('═══════════════════════════════════════════════════════════════\n');

// Afficher TOUS les enseignants
console.log('👨‍🏫 REGROUPEMENT - TOUS LES ENSEIGNANTS');
console.log('=========================================\n');

// Trier par compacité décroissante
const allTeachersSorted = teacherGrouping.slice().sort((a, b) => b.compactnessScore - a.compactnessScore);

console.log('Légende: Compacité | Cours/Demi-j | Densité | Fragmentation\n');

allTeachersSorted.forEach((teacher, idx) => {
    const compactPercent = (teacher.compactnessScore * 100).toFixed(0).padStart(3);
    const ratio = `${teacher.totalCourses}/${teacher.halfDaysUsed}`.padEnd(6);
    const density = teacher.averageCoursesPerHalfDay.toFixed(1).padStart(3);
    const frag = teacher.fragmentationIndex.toString().padStart(1);
    
    // Indicateur visuel de qualité
    let indicator = '🔴'; // Mauvais
    if (teacher.compactnessScore >= 0.75) indicator = '🟢'; // Excellent
    else if (teacher.compactnessScore >= 0.5) indicator = '🟡'; // Moyen
    else if (teacher.compactnessScore >= 0.4) indicator = '🟠'; // Passable
    
    console.log(`${(idx + 1).toString().padStart(2)}. ${indicator} ${teacher.resourceId.padEnd(25)} | ${compactPercent}% | ${ratio} | ${density} | ${frag} jour(s)`);
});

console.log('\n═══════════════════════════════════════════════════════════════\n');

// Analyse détaillée d'un enseignant (le pire)
const worstTeacher = worstTeachers[0];
console.log(`🔍 ANALYSE DÉTAILLÉE: ${worstTeacher.resourceId}`);
console.log(`${'='.repeat(30 + worstTeacher.resourceId.length)}\n`);

console.log(`Métriques:`);
console.log(`   Compacité: ${(worstTeacher.compactnessScore * 100).toFixed(0)}%`);
console.log(`   ${worstTeacher.totalCourses} cours répartis sur ${worstTeacher.halfDaysUsed} demi-journées`);
console.log(`   Minimum théorique: ${worstTeacher.minHalfDaysNeeded} demi-journées`);
console.log(`   Fragmentation: ${worstTeacher.fragmentationIndex} jour(s) avec cours seulement matin OU après-midi\n`);

console.log(`Planning détaillé:`);
const sortedHalfDays = Array.from(worstTeacher.halfDayBreakdown.values())
    .sort((a, b) => a.day - b.day || (a.period === 'morning' ? -1 : 1));

sortedHalfDays.forEach(hd => {
    const periodLabel = hd.period === 'morning' ? '🌅 Matin' : '🌆 Après-midi';
    console.log(`\n   ${hd.dayOfWeek} - ${periodLabel}:`);
    console.log(`   ${hd.courseCount} cours, ${(hd.totalDuration / 60).toFixed(1)}h total`);
    
    hd.courses.sort((a, b) => a.start - b.start).forEach(course => {
        console.log(`      • ${formatTime(course.start)} - ${formatTime(course.start + course.duration)}: ${course.name} (${course.duration}min)`);
    });
});

console.log('\n\n🏁 Test terminé');
