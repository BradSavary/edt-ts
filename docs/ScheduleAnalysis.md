# ScheduleAnalysis

Classe d'analyse statistique pour les solutions de planification générées par les schedulers (Schedule, ScheduleAR, ScheduleExp, ScheduleMR).

## Vue d'ensemble

`ScheduleAnalysis` fournit des outils complets pour analyser et évaluer la qualité d'une solution de planification. Elle calcule des statistiques détaillées sur l'utilisation des ressources, la distribution temporelle, et la continuité des plannings.

**Affichage console** : Statistiques complètes avec tableaux formatés via `test-complete-stats.ts`.

## Installation

```typescript
import { ScheduleAnalysis } from './scheduleAnalysis.js';
import { ScheduleAR } from './scheduleAR.js';

// Générer une solution
const scheduler = new ScheduleAR();
const result = scheduler.solve();

// Créer l'analyseur
const analysis = new ScheduleAnalysis(result.solutions);
```

## Interfaces

### GlobalStats
Statistiques globales de la planification :
```typescript
interface GlobalStats {
  totalTasks: number;           // Nombre total de tâches
  scheduledTasks: number;       // Nombre de tâches planifiées
  completionRate: number;       // Taux de complétion (0-1)
  totalResources: number;       // Nombre total de ressources utilisées
  teachersCount: number;        // Nombre d'enseignants
  roomsCount: number;           // Nombre de salles
  groupsCount: number;          // Nombre de groupes
  totalDays: number;            // Nombre de jours
}
```

### ResourceUsageStats
Statistiques d'utilisation par ressource :
```typescript
interface ResourceUsageStats {
  resourceId: string;           // Identifiant de la ressource
  resourceType: ResourceType;   // Type (TEACHER, ROOM, GROUP)
  courseCount: number;          // Nombre de cours
  totalHours: number;           // Nombre d'heures total
  averageCourseDuration: number;// Durée moyenne des cours (heures)
  courseDurations: number[];    // Liste des durées
}
```

### DailyUsageStats
Statistiques par jour :
```typescript
interface DailyUsageStats {
  day: number;                  // Numéro du jour (0-6)
  dayOfWeek: string;            // Nom du jour
  courseCount: number;          // Nombre de cours
  totalHours: number;           // Nombre d'heures
  resourcesUsed: number;        // Nombre de ressources utilisées
}
```

### ResourceDailyLoad
Charge quotidienne d'une ressource :
```typescript
interface ResourceDailyLoad {
  resourceId: string;           // Identifiant de la ressource
  resourceType: ResourceType;   // Type de ressource
  totalHours: number;           // Total d'heures sur la période
  maxDailyHours: number;        // Maximum d'heures par jour
  averageDailyHours: number;    // Moyenne d'heures par jour
  dailyBreakdown: Map<number, number>; // Heures par jour
}
```

## Méthodes principales

### 1. Statistiques globales

#### `getGlobalStats(): GlobalStats`
Retourne les statistiques globales de la planification.

```typescript
const stats = analysis.getGlobalStats();
console.log(`Taux de complétion: ${(stats.completionRate * 100).toFixed(1)}%`);
console.log(`Ressources utilisées: ${stats.totalResources}`);
```

### 2. Analyse par type de ressource

#### `analyzeResourceUsage(resourceType?: ResourceType): ResourceUsageStats[]`
Analyse l'utilisation des ressources. Peut être filtrée par type.

```typescript
// Tous les enseignants
const teachers = analysis.analyzeResourceUsage(ResourceType.TEACHER);

// Toutes les ressources
const allResources = analysis.analyzeResourceUsage();
```

#### `analyzeResourcesByType(): Map<ResourceType, ResourceUsageStats[]>`
Retourne les statistiques groupées par type de ressource.

```typescript
const byType = analysis.analyzeResourcesByType();
const teachers = byType.get(ResourceType.TEACHER);
const rooms = byType.get(ResourceType.ROOM);
```

### 3. Analyse temporelle

#### `analyzeDailyUsage(): DailyUsageStats[]`
Analyse l'utilisation par jour.

```typescript
const daily = analysis.analyzeDailyUsage();
daily.forEach(day => {
  console.log(`${day.dayOfWeek}: ${day.courseCount} cours, ${day.totalHours}h`);
});
```

#### `getBusiestDays(limit: number = 5): DailyUsageStats[]`
Retourne les jours les plus chargés.

```typescript
const busiest = analysis.getBusiestDays(3);
console.log(`Jour le plus chargé: ${busiest[0].dayOfWeek}`);
```

### 4. Top ressources

#### `getTopResources(resourceType: ResourceType, limit: number = 10): ResourceUsageStats[]`
Retourne les ressources les plus sollicitées.

```typescript
const top5Teachers = analysis.getTopResources(ResourceType.TEACHER, 5);
const top10Rooms = analysis.getTopResources(ResourceType.ROOM, 10);
```

### 5. Charge quotidienne

#### `analyzeResourceDailyLoads(resourceType?: ResourceType): ResourceDailyLoad[]`
Analyse la charge quotidienne des ressources.

```typescript
const groupLoads = analysis.analyzeResourceDailyLoads(ResourceType.GROUP);

groupLoads.forEach(load => {
  console.log(`${load.resourceId}: max ${load.maxDailyHours}h/jour`);
});
```

#### `findDailyQuotaViolations(resourceType: ResourceType, maxHoursPerDay: number): ResourceDailyLoad[]`
Identifie les ressources qui dépassent un quota quotidien.

```typescript
// Trouver les groupes qui ont plus de 7.5h par jour
const violations = analysis.findDailyQuotaViolations(ResourceType.GROUP, 7.5);

violations.forEach(v => {
  console.log(`${v.resourceId}: ${v.maxDailyHours}h (dépasse 7.5h)`);
});
```

### 6. Analyse des interruptions

#### `analyzeResourceGaps(resourceType?: ResourceType, lunchBreakMinutes: number = 120): Array<ResourceGaps>`
Calcule les interruptions entre cours pour chaque ressource.

**Points clés :**
- Mesure les gaps (interruptions) entre cours consécutifs
- Soustrait automatiquement la pause méridienne si :
  - Le premier cours commence avant 12h00
  - Le dernier cours se termine après 14h00
- Paramètre `lunchBreakMinutes` configurable (défaut : 120 min = 2h)

```typescript
interface ResourceGaps {
  resourceId: string;
  resourceType: ResourceType;
  dailyGaps: Map<number, {
    day: number;
    dayOfWeek: string;
    firstCourseStart: number;    // Minutes absolues
    lastCourseEnd: number;        // Minutes absolues
    totalGapDuration: number;     // Minutes (pause méridienne soustraite)
    numberOfGaps: number;
    averageGap: number;           // Minutes
    courseCount: number;
  }>;
  totalGaps: number;              // Total en minutes
}
```

**Exemples :**

```typescript
// Analyser les gaps pour tous les enseignants (avec pause méridienne par défaut de 2h)
const teacherGaps = analysis.analyzeResourceGaps(ResourceType.TEACHER);

// Analyser les gaps pour les groupes avec pause méridienne de 90 minutes
const groupGaps = analysis.analyzeResourceGaps(ResourceType.GROUP, 90);

// Trier par total d'interruptions
const sorted = teacherGaps.sort((a, b) => b.totalGaps - a.totalGaps);

// Afficher les 5 plus fragmentés
sorted.slice(0, 5).forEach(resource => {
  console.log(`${resource.resourceId}: ${(resource.totalGaps / 60).toFixed(1)}h d'interruptions`);
  
  for (const [day, gaps] of resource.dailyGaps) {
    console.log(`  ${gaps.dayOfWeek}: ${gaps.courseCount} cours, ${gaps.numberOfGaps} gaps = ${(gaps.totalGapDuration / 60).toFixed(1)}h`);
  }
});
```

**Cas d'usage :**
- Identifier les plannings trop fragmentés (nombreuses interruptions)
- Comparer la continuité entre différentes ressources
- Optimiser les plannings pour réduire les temps morts
- Évaluer la qualité d'une solution de planification

### 7. Détails par ressource

#### `getResourceDetails(resourceId: string): any`
Retourne les détails complets d'une ressource.

```typescript
const details = analysis.getResourceDetails('HUBERT Quentin');
console.log(`Total: ${details.totalHours}h sur ${details.courseCount} cours`);

details.courses.forEach(course => {
  console.log(`- ${course.name} (${course.day}, ${course.startTime})`);
});
```

### 8. Export et rapports

#### `generateTextReport(): string`
Génère un rapport textuel complet.

```typescript
const report = analysis.generateTextReport();
console.log(report);
```

#### `exportToJSON(): string`
Exporte toutes les statistiques en JSON.

```typescript
const json = analysis.exportToJSON();
fs.writeFileSync('analysis.json', json);
```

## Exemples complets

### Exemple 1 : Analyse basique

```typescript
import { ScheduleAR } from './scheduleAR.js';
import { ScheduleAnalysis } from './scheduleAnalysis.js';
import { ResourceType } from './resource.js';

// Générer une solution
const scheduler = new ScheduleAR();
const result = scheduler.solve();

// Créer l'analyseur
const analysis = new ScheduleAnalysis(result.solutions);

// Statistiques globales
const stats = analysis.getGlobalStats();
console.log(`Tâches planifiées: ${stats.scheduledTasks}/${stats.totalTasks}`);
console.log(`Taux de complétion: ${(stats.completionRate * 100).toFixed(1)}%`);

// Top 5 enseignants
const topTeachers = analysis.getTopResources(ResourceType.TEACHER, 5);
topTeachers.forEach((teacher, i) => {
  console.log(`${i + 1}. ${teacher.resourceId}: ${teacher.courseCount} cours, ${teacher.totalHours}h`);
});
```

### Exemple 2 : Vérification du quota quotidien

```typescript
// Vérifier si des groupes dépassent 7.5h par jour
const violations = analysis.findDailyQuotaViolations(ResourceType.GROUP, 7.5);

if (violations.length > 0) {
  console.log('⚠️  Groupes dépassant 7.5h/jour:');
  violations.forEach(v => {
    console.log(`  ${v.resourceId}: ${v.maxDailyHours}h maximum`);
    
    for (const [day, hours] of v.dailyBreakdown) {
      if (hours > 7.5) {
        const dayName = analysis['getDayOfWeek'](day);
        console.log(`    ${dayName}: ${hours}h`);
      }
    }
  });
}
```

### Exemple 3 : Analyse des jours

```typescript
const daily = analysis.analyzeDailyUsage();

console.log('📅 Répartition par jour:');
daily.forEach(day => {
  console.log(`${day.dayOfWeek}: ${day.courseCount} cours, ${day.totalHours}h, ${day.resourcesUsed} ressources`);
});

const busiest = analysis.getBusiestDays(3);
console.log('\n📊 Top 3 jours les plus chargés:');
busiest.forEach((day, i) => {
  console.log(`${i + 1}. ${day.dayOfWeek}: ${day.courseCount} cours`);
});
```

### Exemple 4 : Export complet

```typescript
import fs from 'fs';

// Rapport texte
const report = analysis.generateTextReport();
fs.writeFileSync('planning-report.txt', report);

// Export JSON
const json = analysis.exportToJSON();
fs.writeFileSync('planning-data.json', json);

console.log('✅ Rapports générés');
```

### Exemple 5 : Analyse de continuité

```typescript
// Analyser les interruptions pour tous les enseignants
const gaps = analysis.analyzeResourceGaps(ResourceType.TEACHER);

// Trier par total d'interruptions (du plus fragmenté au plus continu)
const sorted = gaps.sort((a, b) => b.totalGaps - a.totalGaps);

console.log('👨‍🏫 Top 5 enseignants avec le plus d\'interruptions:');
sorted.slice(0, 5).forEach((resource, idx) => {
  const totalHours = resource.totalGaps / 60;
  console.log(`\n${idx + 1}. ${resource.resourceId}: ${totalHours.toFixed(1)}h d'interruptions`);
  
  for (const [day, gaps] of resource.dailyGaps) {
    if (gaps.courseCount > 0) {
      const gapHours = gaps.totalGapDuration / 60;
      const firstTime = formatTime(gaps.firstCourseStart % (24 * 60));
      const lastTime = formatTime(gaps.lastCourseEnd % (24 * 60));
      
      console.log(`  ${gaps.dayOfWeek}: ${gaps.courseCount} cours (${firstTime}-${lastTime}), ` +
                  `${gaps.numberOfGaps} gaps = ${gapHours.toFixed(1)}h`);
    }
  }
});

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins.toString().padStart(2, '0')}`;
}
```

## Méthodes utilitaires

### `formatTime(minutes: number): string`
Convertit des minutes en format HH:MM.

### `getDayOfWeek(day: number): string`
Retourne le nom du jour (Lundi, Mardi, etc.).

### `getDayFromMinutes(minutes: number): number`
Calcule le numéro du jour depuis des minutes absolues.

## Affichage des statistiques complètes

### Script d'affichage console

Le script `test-complete-stats.ts` génère un rapport complet formaté dans la console avec tableaux et indicateurs visuels.

#### Utilisation

```bash
npx tsx src/Claude/test-complete-stats.ts
```

#### Contenu du rapport

Le rapport affiché contient :

1. **Vue d'ensemble**
   - Statistiques générales (tâches, ressources utilisées)
   - Tableau d'utilisation des ressources (heures, moyennes, cours)
   - Tableau de qualité du regroupement (compacité, fragmentation, densité)

2. **Section Enseignants**
   - Moyennes : compacité, fragmentation, densité
   - Tableau détaillé de tous les enseignants avec indicateurs visuels
   - Distribution par qualité

3. **Section Groupes**
   - Mêmes analyses que pour les enseignants
   - Tableau détaillé avec indicateurs

4. **Section Salles**
   - Mêmes analyses que pour les enseignants
   - Tableau détaillé avec indicateurs

5. **Résumé final**
   - Récapitulatif global
   - Compacité moyenne globale

#### Indicateurs de qualité

Les tableaux utilisent un code couleur :
- 🟢 **Excellent** (≥75% de compacité)
- 🟡 **Bon** (50-74%)
- 🟠 **Moyen** (40-49%)
- 🔴 **Faible** (<40%)

## Analyse de regroupement par demi-journée

### Méthode `analyzeHalfDayGrouping()`

Cette méthode évalue la qualité du regroupement des cours sur des demi-journées pour répondre aux demandes des enseignants de regrouper leurs cours.

#### Définition des demi-journées

- **Matin** : Cours se terminant au plus tard à **13h00** (fin ≤ 780 minutes)
- **Après-midi** : Cours débutant après **13h00** (début > 780 minutes)
- **13h00** est toujours inclus dans la pause méridienne

#### Métriques calculées

1. **Compacité** (compactnessScore)
   - Ratio entre le nombre minimum théorique de demi-journées et le nombre réel
   - Valeur entre 0 et 1 (1 = parfait)
   - Exemple : 4 cours pourraient tenir en 1 demi-journée mais sont répartis sur 3 → compacité = 33%

2. **Fragmentation** (fragmentationIndex)
   - Nombre de jours où la ressource a des cours seulement le matin OU l'après-midi (pas les deux)
   - Plus bas = meilleur regroupement

3. **Densité** (averageCoursesPerHalfDay)
   - Nombre moyen de cours par demi-journée utilisée
   - Plus élevé = meilleur regroupement

4. **Distribution**
   - Histogramme du nombre de demi-journées ayant 1, 2, 3, ... cours

#### Exemple d'utilisation

```typescript
// Analyser le regroupement des enseignants
const teacherGrouping = analysis.analyzeHalfDayGrouping(ResourceType.TEACHER);

// Trier par compacité (meilleurs en premier)
const sorted = teacherGrouping.sort((a, b) => b.compactnessScore - a.compactnessScore);

// Afficher les résultats
sorted.forEach(teacher => {
  console.log(`${teacher.resourceId}: ${(teacher.compactnessScore * 100).toFixed(0)}% compacité`);
  console.log(`  ${teacher.totalCourses} cours sur ${teacher.halfDaysUsed} demi-journées`);
  console.log(`  Fragmentation: ${teacher.fragmentationIndex} jour(s)`);
});
```

#### Test de regroupement

```bash
npx tsx src/Claude/test-halfday-grouping.ts
```

Ce script affiche une analyse complète du regroupement pour tous les types de ressources avec indicateurs visuels.

## Tests

Scripts de test disponibles :

```bash
# Analyse complète avec toutes les statistiques (console formatée)
npx tsx src/Claude/test-complete-stats.ts

# Analyse de regroupement par demi-journée
npx tsx src/Claude/test-halfday-grouping.ts
```

## Notes

- Les durées sont exprimées en **heures** dans les statistiques (sauf indication contraire)
- Les temps absolus sont en **minutes** depuis le début de la semaine
- Les jours sont numérotés de 0 (Lundi) à 6 (Dimanche)
- L'analyse des gaps prend en compte la pause méridienne automatiquement
- La pause méridienne est soustraite si : premier cours se termine avant/à 13h00 ET dernier cours commence après 13h00
- Les métriques de regroupement utilisent la frontière 13h00 pour distinguer matin/après-midi

## Voir aussi

- [Schedule.md](./Schedule.md) - Documentation des schedulers
- [ConstraintsManager.md](./ConstraintsManager.md) - Gestion des contraintes
- [test-complete-stats.ts](../src/Claude/test-complete-stats.ts) - Affichage complet des statistiques
- [test-halfday-grouping.ts](../src/Claude/test-halfday-grouping.ts) - Exemples de regroupement
