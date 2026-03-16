/**
 * Affichage complet des statistiques de planification dans la console
 */

import { ScheduleAR } from '../src/scheduleAR.js';
import { ScheduleAnalysis } from '../src/scheduleAnalysis.js';
import { ResourceType } from '../src/resource.js';

console.log('📊 STATISTIQUES COMPLÈTES DE PLANIFICATION');
console.log('==========================================\n');

// Chargement et planification
console.log('🔄 Chargement et planification...');
const scheduler = new ScheduleAR();
const solution = scheduler.solve();

if (solution.solutions.length === 0) {
  console.log('❌ Aucune solution trouvée');
  process.exit(1);
}

console.log(`✅ ${solution.solutions.length} tâches planifiées\n`);

// Création de l'analyse
const analysis = new ScheduleAnalysis(solution.solutions);

// ============================================
// SECTION 1: VUE D'ENSEMBLE
// ============================================
console.log('═'.repeat(80));
console.log('📋 VUE D\'ENSEMBLE DU PLANNING');
console.log('═'.repeat(80));

const teacherGrouping = analysis.analyzeHalfDayGrouping(ResourceType.TEACHER);
const groupGrouping = analysis.analyzeHalfDayGrouping(ResourceType.GROUP);
const roomGrouping = analysis.analyzeHalfDayGrouping(ResourceType.ROOM);

// Le nombre exact de tâches planifiées
const totalTasks = solution.solutions.length;

console.log(`\n📌 Statistiques générales:`);
console.log(`   • Tâches planifiées: ${totalTasks}`);
console.log(`   • Enseignants utilisés: ${teacherGrouping.length}`);
console.log(`   • Groupes utilisés: ${groupGrouping.length}`);
console.log(`   • Salles utilisées: ${roomGrouping.length}`);

// Calculer les heures et volumes
const calcStats = (grouping: any[]) => {
  let totalMinutes = 0;
  let totalCourses = 0;
  for (const res of grouping) {
    for (const hd of res.halfDayBreakdown.values()) {
      totalMinutes += hd.totalDuration;
      totalCourses += hd.courseCount;
    }
  }
  return {
    hours: totalMinutes / 60,
    avgHours: grouping.length > 0 ? (totalMinutes / 60) / grouping.length : 0,
    courses: totalCourses,
    count: grouping.length
  };
};

const teacherStats = calcStats(teacherGrouping);
const groupStats = calcStats(groupGrouping);
const roomStats = calcStats(roomGrouping);

console.log(`\n📊 Utilisation des ressources:`);
console.log('┌─────────────────┬────────┬──────────────┬───────────────────────┬─────────────┐');
console.log('│ Type            │ Nombre │ Total heures │ Moy. heures/ressource │ Total cours │');
console.log('├─────────────────┼────────┼──────────────┼───────────────────────┼─────────────┤');
console.log(`│ Enseignants     │ ${teacherStats.count.toString().padStart(6)} │ ${(teacherStats.hours.toFixed(1) + 'h').padStart(12)} │ ${(teacherStats.avgHours.toFixed(1) + 'h').padStart(21)} │ ${teacherStats.courses.toString().padStart(11)} │`);
console.log(`│ Groupes         │ ${groupStats.count.toString().padStart(6)} │ ${(groupStats.hours.toFixed(1) + 'h').padStart(12)} │ ${(groupStats.avgHours.toFixed(1) + 'h').padStart(21)} │ ${groupStats.courses.toString().padStart(11)} │`);
console.log(`│ Salles          │ ${roomStats.count.toString().padStart(6)} │ ${(roomStats.hours.toFixed(1) + 'h').padStart(12)} │ ${(roomStats.avgHours.toFixed(1) + 'h').padStart(21)} │ ${roomStats.courses.toString().padStart(11)} │`);
console.log('└─────────────────┴────────┴──────────────┴───────────────────────┴─────────────┘');

// Calculer les moyennes de qualité
const calcAvgQuality = (grouping: any[]) => {
  if (grouping.length === 0) return { compactness: 0, fragmentation: 0, density: 0 };
  const sum = grouping.reduce((acc, r) => ({
    compactness: acc.compactness + r.compactnessScore,
    fragmentation: acc.fragmentation + r.fragmentationIndex,
    density: acc.density + r.averageCoursesPerHalfDay
  }), { compactness: 0, fragmentation: 0, density: 0 });
  
  return {
    compactness: (sum.compactness / grouping.length) * 100,
    fragmentation: sum.fragmentation / grouping.length,
    density: sum.density / grouping.length
  };
};

const teacherQuality = calcAvgQuality(teacherGrouping);
const groupQuality = calcAvgQuality(groupGrouping);
const roomQuality = calcAvgQuality(roomGrouping);

console.log(`\n📈 Qualité du regroupement par demi-journées:`);
console.log('┌─────────────────┬───────────────────┬────────────────────────┬──────────────────────────┐');
console.log('│ Type            │ Compacité moy (%) │ Fragmentation moyenne  │ Densité moy (cours/dj)   │');
console.log('├─────────────────┼───────────────────┼────────────────────────┼──────────────────────────┤');
console.log(`│ Enseignants     │ ${(teacherQuality.compactness.toFixed(1) + '%').padStart(17)} │ ${teacherQuality.fragmentation.toFixed(2).padStart(22)} │ ${teacherQuality.density.toFixed(2).padStart(24)} │`);
console.log(`│ Groupes         │ ${(groupQuality.compactness.toFixed(1) + '%').padStart(17)} │ ${groupQuality.fragmentation.toFixed(2).padStart(22)} │ ${groupQuality.density.toFixed(2).padStart(24)} │`);
console.log(`│ Salles          │ ${(roomQuality.compactness.toFixed(1) + '%').padStart(17)} │ ${roomQuality.fragmentation.toFixed(2).padStart(22)} │ ${roomQuality.density.toFixed(2).padStart(24)} │`);
console.log('└─────────────────┴───────────────────┴────────────────────────┴──────────────────────────┘');

// ============================================
// SECTION 2: DÉTAIL PAR TYPE DE RESSOURCE
// ============================================
function displayResourceStats(resourceType: ResourceType, grouping: any[]): void {
  const typeNames = {
    [ResourceType.TEACHER]: 'ENSEIGNANTS',
    [ResourceType.GROUP]: 'GROUPES',
    [ResourceType.ROOM]: 'SALLES'
  };

  console.log('\n' + '═'.repeat(80));
  console.log(`👥 ${typeNames[resourceType]}`);
  console.log('═'.repeat(80));

  // Statistiques moyennes
  const avgCompactness = grouping.reduce((sum, r) => sum + r.compactnessScore, 0) / grouping.length;
  const avgFragmentation = grouping.reduce((sum, r) => sum + r.fragmentationIndex, 0) / grouping.length;
  const avgDensity = grouping.reduce((sum, r) => sum + r.averageCoursesPerHalfDay, 0) / grouping.length;

  console.log(`\n📊 Moyennes:`);
  console.log(`   • Compacité: ${(avgCompactness * 100).toFixed(1)}%`);
  console.log(`   • Fragmentation: ${avgFragmentation.toFixed(1)} jours incomplets`);
  console.log(`   • Densité: ${avgDensity.toFixed(1)} cours/demi-journée`);

  // Trier par compacité décroissante
  const sorted = [...grouping].sort((a, b) => b.compactnessScore - a.compactnessScore);

  console.log(`\n📋 Détail par ressource (${sorted.length} ressources):`);
  console.log('┌──────────────────────────┬────────────┬───────────────┬─────────┬────────────────┐');
  console.log('│ Ressource                │ Compacité  │ Cours/Demi-j  │ Densité │ Fragmentation  │');
  console.log('├──────────────────────────┼────────────┼───────────────┼─────────┼────────────────┤');

  sorted.forEach(r => {
    const compactness = (r.compactnessScore * 100).toFixed(0) + '%';
    const ratio = `${r.totalCourses}/${r.halfDaysUsed}`;
    const density = r.averageCoursesPerHalfDay.toFixed(1);
    const fragmentation = r.fragmentationIndex.toString();
    
    // Indicateur de qualité
    const indicator = r.compactnessScore >= 0.75 ? '🟢' : 
                     r.compactnessScore >= 0.50 ? '🟡' : 
                     r.compactnessScore >= 0.40 ? '🟠' : '🔴';

    // Tronquer le nom de la ressource si trop long (22 caractères max avec indicateur)
    let resourceName = indicator + ' ' + r.resourceId;
    if (resourceName.length > 24) {
      resourceName = resourceName.substring(0, 21) + '...';
    }

    console.log(`│ ${resourceName.padEnd(24)} │ ${compactness.padStart(10)} │ ${ratio.padStart(13)} │ ${density.padStart(7)} │ ${fragmentation.padStart(14)} │`);
  });

  console.log('└──────────────────────────┴────────────┴───────────────┴─────────┴────────────────┘');

  // Distribution par qualité
  const excellent = sorted.filter(r => r.compactnessScore >= 0.75).length;
  const good = sorted.filter(r => r.compactnessScore >= 0.5 && r.compactnessScore < 0.75).length;
  const fair = sorted.filter(r => r.compactnessScore >= 0.4 && r.compactnessScore < 0.5).length;
  const poor = sorted.filter(r => r.compactnessScore < 0.4).length;

  console.log(`\n📊 Distribution par qualité:`);
  console.log(`   🟢 Excellent (≥75%):     ${excellent.toString().padStart(3)} ressources (${((excellent / sorted.length) * 100).toFixed(1)}%)`);
  console.log(`   🟡 Bon (50-74%):         ${good.toString().padStart(3)} ressources (${((good / sorted.length) * 100).toFixed(1)}%)`);
  console.log(`   🟠 Moyen (40-49%):       ${fair.toString().padStart(3)} ressources (${((fair / sorted.length) * 100).toFixed(1)}%)`);
  console.log(`   🔴 Faible (<40%):        ${poor.toString().padStart(3)} ressources (${((poor / sorted.length) * 100).toFixed(1)}%)`);
}

// Afficher les détails pour chaque type de ressource
displayResourceStats(ResourceType.TEACHER, teacherGrouping);
displayResourceStats(ResourceType.GROUP, groupGrouping);
displayResourceStats(ResourceType.ROOM, roomGrouping);

// ============================================
// SECTION 3: CHARGE QUOTIDIENNE (ResourceDailyLoad)
// ============================================
console.log('\n' + '═'.repeat(80));
console.log('📅 CHARGE QUOTIDIENNE DES RESSOURCES');
console.log('═'.repeat(80));

function displayDailyLoad(resourceType: ResourceType): void {
  const typeNames = {
    [ResourceType.TEACHER]: 'Enseignants',
    [ResourceType.GROUP]: 'Groupes',
    [ResourceType.ROOM]: 'Salles'
  };

  const dailyLoads = analysis.analyzeResourceDailyLoad(resourceType);
  
  console.log(`\n👥 ${typeNames[resourceType]} (${dailyLoads.length} ressources):`);
  console.log('┌──────────────────────────┬────────────────┬────────────────┬──────────────┐');
  console.log('│ Ressource                │ Max/jour       │ Moyenne/jour   │ Total        │');
  console.log('├──────────────────────────┼────────────────┼────────────────┼──────────────┤');
  
  dailyLoads.forEach(load => {
    const maxHours = (load.maxDailyUsage / 60).toFixed(1) + 'h';
    const avgHours = (load.avgDailyUsage / 60).toFixed(1) + 'h';
    const totalHours = (load.totalUsage / 60).toFixed(1) + 'h';
    
    // Tronquer le nom si trop long
    let resourceName = load.resourceId;
    if (resourceName.length > 24) {
      resourceName = resourceName.substring(0, 21) + '...';
    }
    
    console.log(`│ ${resourceName.padEnd(24)} │ ${maxHours.padStart(14)} │ ${avgHours.padStart(14)} │ ${totalHours.padStart(12)} │`);
  });
  
  console.log('└──────────────────────────┴────────────────┴────────────────┴──────────────┘');
}

displayDailyLoad(ResourceType.TEACHER);
displayDailyLoad(ResourceType.GROUP);
displayDailyLoad(ResourceType.ROOM);

// ============================================
// SECTION 4: INTERRUPTIONS (ResourceGaps)
// ============================================
console.log('\n' + '═'.repeat(80));
console.log('⏱️  ANALYSE DES INTERRUPTIONS ENTRE COURS');
console.log('═'.repeat(80));

function displayGapsAnalysis(resourceType: ResourceType): void {
  const typeNames = {
    [ResourceType.TEACHER]: 'Enseignants',
    [ResourceType.GROUP]: 'Groupes',
    [ResourceType.ROOM]: 'Salles'
  };

  const gaps = analysis.analyzeResourceGaps(resourceType);
  
  console.log(`\n👥 ${typeNames[resourceType]} (${gaps.length} ressources):`);
  console.log('┌──────────────────────────┬────────────────┬────────────────┬──────────────┐');
  console.log('│ Ressource                │ Total gaps     │ Nb jours       │ Moy./jour    │');
  console.log('├──────────────────────────┼────────────────┼────────────────┼──────────────┤');
  
  gaps.forEach(gap => {
    const totalGapsHours = (gap.totalGaps / 60).toFixed(1) + 'h';
    const nbDays = gap.dailyGaps.size.toString();
    
    // Calculer la moyenne par jour
    let avgGapPerDay = 0;
    if (gap.dailyGaps.size > 0) {
      avgGapPerDay = gap.totalGaps / gap.dailyGaps.size / 60;
    }
    const avgGapStr = avgGapPerDay.toFixed(1) + 'h';
    
    // Tronquer le nom si trop long
    let resourceName = gap.resourceId;
    if (resourceName.length > 24) {
      resourceName = resourceName.substring(0, 21) + '...';
    }
    
    console.log(`│ ${resourceName.padEnd(24)} │ ${totalGapsHours.padStart(14)} │ ${nbDays.padStart(14)} │ ${avgGapStr.padStart(12)} │`);
  });
  
  console.log('└──────────────────────────┴────────────────┴────────────────┴──────────────┘');
}

displayGapsAnalysis(ResourceType.TEACHER);
displayGapsAnalysis(ResourceType.GROUP);
displayGapsAnalysis(ResourceType.ROOM);

// ============================================
// RÉSUMÉ FINAL
// ============================================
console.log('\n' + '═'.repeat(80));
console.log('✅ RÉSUMÉ');
console.log('═'.repeat(80));
console.log(`\n✓ ${totalTasks} tâches planifiées avec succès`);
console.log(`✓ ${teacherGrouping.length} enseignants, ${groupGrouping.length} groupes, ${roomGrouping.length} salles utilisés`);
console.log(`✓ Compacité moyenne globale: ${((teacherQuality.compactness + groupQuality.compactness + roomQuality.compactness) / 3).toFixed(1)}%`);
console.log(`✓ Statistiques exportées\n`);
