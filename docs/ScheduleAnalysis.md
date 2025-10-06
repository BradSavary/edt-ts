# ScheduleAnalysis# ScheduleAnalysis# ScheduleAnalysis



Classe d'analyse statistique pour les solutions de planification générées par les schedulers (Schedule, ScheduleAR, ScheduleExp, ScheduleMR).



## Vue d'ensembleClasse d'analyse statistique pour les solutions de planification générées par les schedulers (Schedule, ScheduleAR, ScheduleExp, ScheduleMR).Classe d'analyse statistique pour les solutions de planification générées par les schedulers (Schedule, ScheduleAR, ScheduleExp, ScheduleMR).



`ScheduleAnalysis` fournit des outils complets pour analyser et évaluer la qualité d'une solution de planification. Elle calcule des statistiques détaillées sur l'utilisation des ressources, la distribution temporelle, la continuité des plannings et le regroupement par demi-journées.



**Affichage console** : Statistiques complètes avec tableaux formatés via `test-complete-stats.ts`.## Vue d'ensemble## Vue d'ensemble



## Installation



```typescript`ScheduleAnalysis` fournit des outils complets pour analyser et évaluer la qualité d'une solution de planification. Elle calcule des statistiques détaillées sur l'utilisation des ressources, la distribution temporelle, la continuité des plannings et le regroupement par demi-journées.`ScheduleAnalysis` fournit des outils complets pour analyser et évaluer la qualité d'une solution de planification. Elle calcule des statistiques détaillées sur l'utilisation des ressources, la distribution temporelle, et la continuité des plannings.

import { ScheduleAnalysis } from './scheduleAnalysis.js';

import { ScheduleAR } from './scheduleAR.js';



// Générer une solution**Affichage console** : Statistiques complètes avec tableaux formatés via `test-complete-stats.ts`.**Affichage console** : Statistiques complètes avec tableaux formatés via `test-complete-stats.ts`.

const scheduler = new ScheduleAR();

const result = scheduler.solve();



// Créer l'analyseur## Installation## Installation

const analysis = new ScheduleAnalysis(result.solutions);

```



## Interfaces TypeScript```typescript```typescript



### ResourceUsageStatsimport { ScheduleAnalysis } from './scheduleAnalysis.js';import { ScheduleAnalysis } from './scheduleAnalysis.js';



```typescriptimport { ScheduleAR } from './scheduleAR.js';import { ScheduleAR } from './scheduleAR.js';

interface ResourceUsageStats {

  resourceId: string;

  resourceType: ResourceType;

  taskCount: number;// Générer une solution// Générer une solution

  totalMinutes: number;

  totalHours: number;const scheduler = new ScheduleAR();const scheduler = new ScheduleAR();

  tasks: Array<{

    taskName: string;const result = scheduler.solve();const result = scheduler.solve();

    startTime: number;

    duration: number;

    day: number;

    dayOfWeek: string;// Créer l'analyseur// Créer l'analyseur

  }>;

}const analysis = new ScheduleAnalysis(result.solutions);const analysis = new ScheduleAnalysis(result.solutions);

```

``````

### DailyUsageStats



```typescript

interface DailyUsageStats {## Interfaces TypeScript## Interfaces

  day: number;

  dayOfWeek: string;

  taskCount: number;

  totalMinutes: number;### ResourceUsageStats### GlobalStats

  totalHours: number;

  resourcesUsed: Set<string>;```typescriptStatistiques globales de la planification :

}

```interface ResourceUsageStats {```typescript



### GlobalStats  resourceId: string;interface GlobalStats {



```typescript  resourceType: ResourceType;  totalTasks: number;           // Nombre total de tâches

interface GlobalStats {

  totalTasks: number;  taskCount: number;  scheduledTasks: number;       // Nombre de tâches planifiées

  plannedTasks: number;

  unplannedTasks: number;  totalMinutes: number;  completionRate: number;       // Taux de complétion (0-1)

  completionRate: number;

  totalResourcesUsed: number;  totalHours: number;  totalResources: number;       // Nombre total de ressources utilisées

  teachersUsed: number;

  roomsUsed: number;  tasks: Array<{  teachersCount: number;        // Nombre d'enseignants

  groupsUsed: number;

  timeSpan: {    taskName: string;  roomsCount: number;           // Nombre de salles

    firstTaskStart: number;

    lastTaskEnd: number;    startTime: number;  groupsCount: number;          // Nombre de groupes

    totalDays: number;

  };    duration: number;  totalDays: number;            // Nombre de jours

}

```    day: number;}



### ResourceDailyLoad    dayOfWeek: string;```



```typescript  }>;

interface ResourceDailyLoad {

  resourceId: string;}### ResourceUsageStats

  resourceType: ResourceType;

  dailyUsage: Map<number, number>;```Statistiques d'utilisation par ressource :

  maxDailyUsage: number;

  avgDailyUsage: number;```typescript

  totalUsage: number;

}### DailyUsageStatsinterface ResourceUsageStats {

```

```typescript  resourceId: string;           // Identifiant de la ressource

## Méthodes principales

interface DailyUsageStats {  resourceType: ResourceType;   // Type (TEACHER, ROOM, GROUP)

### 1. Statistiques globales

  day: number;  courseCount: number;          // Nombre de cours

#### `getGlobalStats(totalTasksExpected?: number): GlobalStats`

  dayOfWeek: string;  totalHours: number;           // Nombre d'heures total

**Exemple :**

  taskCount: number;  averageCourseDuration: number;// Durée moyenne des cours (heures)

```typescript

const stats = analysis.getGlobalStats(80);  totalMinutes: number;  courseDurations: number[];    // Liste des durées

console.log(`Taux: ${(stats.completionRate * 100).toFixed(1)}%`);

console.log(`Ressources: ${stats.totalResourcesUsed}`);  totalHours: number;}

```

  resourcesUsed: Set<string>;```

### 2. Analyse d'une ressource spécifique

}

#### `analyzeResourceUsage(resourceId: string): ResourceUsageStats | null`

```### DailyUsageStats

**Exemple :**

Statistiques par jour :

```typescript

const stats = analysis.analyzeResourceUsage('HUBERT Quentin');### GlobalStats```typescript

if (stats) {

  console.log(`${stats.resourceId}: ${stats.totalHours}h sur ${stats.taskCount} cours`);```typescriptinterface DailyUsageStats {

}

```interface GlobalStats {  day: number;                  // Numéro du jour (0-6)



### 3. Analyse par type  totalTasks: number;  dayOfWeek: string;            // Nom du jour



#### `analyzeResourcesByType(type: ResourceType): ResourceUsageStats[]`  plannedTasks: number;  courseCount: number;          // Nombre de cours



**Exemple :**  unplannedTasks: number;  totalHours: number;           // Nombre d'heures



```typescript  completionRate: number;  resourcesUsed: number;        // Nombre de ressources utilisées

const teachers = analysis.analyzeResourcesByType(ResourceType.TEACHER);

teachers.forEach(t => console.log(`${t.resourceId}: ${t.totalHours}h`));  totalResourcesUsed: number;}

```

  teachersUsed: number;```

### 4. Analyse temporelle

  roomsUsed: number;

#### `analyzeDailyUsage(): DailyUsageStats[]`

  groupsUsed: number;### ResourceDailyLoad

#### `analyzeResourceDailyLoad(resourceType?: ResourceType): ResourceDailyLoad[]`

  timeSpan: {Charge quotidienne d'une ressource :

#### `getBusiestDays(limit: number = 5): DailyUsageStats[]`

    firstTaskStart: number;```typescript

**Exemple :**

    lastTaskEnd: number;interface ResourceDailyLoad {

```typescript

const daily = analysis.analyzeDailyUsage();    totalDays: number;  resourceId: string;           // Identifiant de la ressource

const busiest = analysis.getBusiestDays(3);

```  };  resourceType: ResourceType;   // Type de ressource



### 5. Top ressources}  totalHours: number;           // Total d'heures sur la période



#### `getTopResourcesByLoad(type: ResourceType, limit: number = 10): ResourceUsageStats[]````  maxDailyHours: number;        // Maximum d'heures par jour



#### `findQuotaViolations(resourceType: ResourceType, maxMinutesPerDay: number): Array<{...}>`  averageDailyHours: number;    // Moyenne d'heures par jour



**Exemple :**### ResourceDailyLoad  dailyBreakdown: Map<number, number>; // Heures par jour



```typescript```typescript}

const top5 = analysis.getTopResourcesByLoad(ResourceType.TEACHER, 5);

const violations = analysis.findQuotaViolations(ResourceType.TEACHER, 360);interface ResourceDailyLoad {```

```

  resourceId: string;

### 6. Analyse des gaps

  resourceType: ResourceType;## Méthodes principales

#### `analyzeResourceGaps(resourceType?: ResourceType, lunchBreakMinutes: number = 120): Array<{...}>`

  dailyUsage: Map<number, number>;

Analyse les interruptions dans l'emploi du temps. La pause méridienne est automatiquement soustraite si :

- Premier cours se termine avant/à 13h00 (≤ 780 min)  maxDailyUsage: number;### 1. Statistiques globales

- **ET** dernier cours commence après 13h00 (> 780 min)

  avgDailyUsage: number;

**Exemple :**

  totalUsage: number;#### `getGlobalStats(totalTasksExpected?: number): GlobalStats`

```typescript

const gaps = analysis.analyzeResourceGaps(ResourceType.TEACHER);}Retourne les statistiques globales de la planification.

const sorted = gaps.sort((a, b) => b.totalGaps - a.totalGaps);

```

sorted.slice(0, 5).forEach(g => {

  console.log(`${g.resourceId}: ${(g.totalGaps / 60).toFixed(1)}h d'interruptions`);```typescript

});

```## Méthodes principales// Sans paramètre : taux de complétion basé sur les tâches planifiées uniquement



### 7. Regroupement par demi-journéeconst stats = analysis.getGlobalStats();



#### `analyzeHalfDayGrouping(resourceType?: ResourceType, maxCoursesPerHalfDay: number = 4): Array<{...}>`### 1. Statistiques globales



Évalue la qualité du regroupement des cours sur des demi-journées.// Avec paramètre : calcul du taux de complétion par rapport au total attendu



**Définition des demi-journées :**#### `getGlobalStats(totalTasksExpected?: number): GlobalStats`const statsWithTarget = analysis.getGlobalStats(80);

- **Matin** : Cours se terminant au plus tard à **13h00** (fin ≤ 780 minutes)

- **Après-midi** : Cours débutant après **13h00** (début > 780 minutes)console.log(`Taux de complétion: ${(statsWithTarget.completionRate * 100).toFixed(1)}%`);

- **13h00** est toujours inclus dans la pause méridienne

**Exemple :**console.log(`Ressources utilisées: ${statsWithTarget.totalResources}`);

**Métriques calculées :**

```typescript```

1. **Compacité (compactnessScore)** : 0-1, ratio entre minimum théorique et nombre réel de demi-journées

2. **Fragmentation (fragmentationIndex)** : Nombre de jours avec cours seulement matin OU après-midiconst stats = analysis.getGlobalStats(80);

3. **Densité (averageCoursesPerHalfDay)** : Nombre moyen de cours par demi-journée utilisée

4. **Distribution** : Histogramme du nombre de demi-journées ayant 1, 2, 3, ... coursconsole.log(`Taux: ${(stats.completionRate * 100).toFixed(1)}%`);### 2. Analyse d'une ressource spécifique



**Exemple :**console.log(`Ressources: ${stats.totalResourcesUsed}`);



```typescript```#### `analyzeResourceUsage(resourceId: string): ResourceUsageStats | null`

const grouping = analysis.analyzeHalfDayGrouping(ResourceType.TEACHER);

const sorted = grouping.sort((a, b) => b.compactnessScore - a.compactnessScore);Analyse l'utilisation d'une ressource spécifique par son identifiant.



sorted.forEach(teacher => {### 2. Analyse d'une ressource spécifique

  console.log(`${teacher.resourceId}: ${(teacher.compactnessScore * 100).toFixed(0)}% compacité`);

  console.log(`  ${teacher.totalCourses} cours sur ${teacher.halfDaysUsed} demi-journées`);```typescript

  console.log(`  Fragmentation: ${teacher.fragmentationIndex} jour(s)`);

});#### `analyzeResourceUsage(resourceId: string): ResourceUsageStats | null`// Analyser un enseignant spécifique

```

const teacherStats = analysis.analyzeResourceUsage('HUBERT Quentin');

### 8. Export et rapports

**Exemple :**if (teacherStats) {

#### `generateReport(totalTasksExpected?: number): string`

```typescript  console.log(`${teacherStats.resourceId}: ${teacherStats.totalHours}h sur ${teacherStats.taskCount} cours`);

#### `exportToJSON(): string`

const stats = analysis.analyzeResourceUsage('HUBERT Quentin');}

**Exemple :**

if (stats) {

```typescript

const report = analysis.generateReport(80);  console.log(`${stats.resourceId}: ${stats.totalHours}h sur ${stats.taskCount} cours`);// Analyser un groupe

console.log(report);

}const groupStats = analysis.analyzeResourceUsage('BUT1-G1');

import fs from 'fs';

fs.writeFileSync('analysis.json', analysis.exportToJSON());``````

```



## Affichage console complet

### 3. Analyse par type### 3. Analyse par type de ressource

### Script test-complete-stats.ts



Génère un rapport complet formaté avec tableaux UTF-8 et indicateurs visuels.

#### `analyzeResourcesByType(type: ResourceType): ResourceUsageStats[]`#### `analyzeResourcesByType(type: ResourceType): ResourceUsageStats[]`

```bash

npx tsx src/Claude/test-complete-stats.tsAnalyse toutes les ressources d'un type donné.

```

**Exemple :**

**Contenu :**

- Vue d'ensemble (tâches, ressources)```typescript```typescript

- Utilisation des ressources (heures, moyennes, cours)

- Qualité du regroupement (compacité, fragmentation, densité)const teachers = analysis.analyzeResourcesByType(ResourceType.TEACHER);// Tous les enseignants

- Détail par type de ressource (Enseignants, Groupes, Salles)

- Distribution par qualitéteachers.forEach(t => console.log(`${t.resourceId}: ${t.totalHours}h`));const teachers = analysis.analyzeResourcesByType(ResourceType.TEACHER);



**Indicateurs :**```teachers.forEach(t => {

- 🟢 **Excellent** (≥75% de compacité)

- 🟡 **Bon** (50-74%)  console.log(`${t.resourceId}: ${t.totalHours}h sur ${t.taskCount} cours`);

- 🟠 **Moyen** (40-49%)

- 🔴 **Faible** (<40%)### 4. Analyse temporelle});



## Tests



```bash#### `analyzeDailyUsage(): DailyUsageStats[]`// Toutes les salles

# Statistiques complètes console

npx tsx src/Claude/test-complete-stats.tsconst rooms = analysis.analyzeResourcesByType(ResourceType.ROOM);



# Regroupement par demi-journée#### `analyzeResourceDailyLoad(resourceType?: ResourceType): ResourceDailyLoad[]````

npx tsx src/Claude/test-halfday-grouping.ts

```



## Notes#### `getBusiestDays(limit: number = 5): DailyUsageStats[]`### 4. Analyse temporelle



- Durées en **heures** dans les statistiques

- Temps absolus en **minutes** depuis le début de la semaine

- Jours numérotés de 0 (Lundi) à 6 (Dimanche)**Exemple :**#### `analyzeDailyUsage(): DailyUsageStats[]`

- Pause méridienne soustraite automatiquement dans `analyzeResourceGaps()`

- Frontière 13h00 pour distinguer matin/après-midi```typescriptAnalyse l'utilisation par jour de la semaine.



## Voir aussiconst daily = analysis.analyzeDailyUsage();



- [Schedule.md](./Schedule.md) - Documentation des schedulersconst busiest = analysis.getBusiestDays(3);```typescript

- [ConstraintsManager.md](./ConstraintsManager.md) - Gestion des contraintes

- [test-complete-stats.ts](../src/Claude/test-complete-stats.ts) - Affichage complet```const daily = analysis.analyzeDailyUsage();

- [test-halfday-grouping.ts](../src/Claude/test-halfday-grouping.ts) - Exemples de regroupement

daily.forEach(day => {

### 5. Top ressources  console.log(`${day.dayOfWeek}: ${day.courseCount} cours, ${day.totalHours}h, ${day.resourcesUsed} ressources`);

});

#### `getTopResourcesByLoad(type: ResourceType, limit: number = 10): ResourceUsageStats[]````



#### `findQuotaViolations(resourceType: ResourceType, maxMinutesPerDay: number): Array<{...}>`#### `analyzeResourceDailyLoad(resourceType?: ResourceType): ResourceDailyLoad[]`

Analyse la charge quotidienne des ressources.

**Exemple :**

```typescript```typescript

const top5 = analysis.getTopResourcesByLoad(ResourceType.TEACHER, 5);// Charge de tous les enseignants

const violations = analysis.findQuotaViolations(ResourceType.TEACHER, 360);const teacherLoads = analysis.analyzeResourceDailyLoad(ResourceType.TEACHER);

```teacherLoads.forEach(load => {

  console.log(`${load.resourceId}: max ${load.maxDailyHours}h/jour, moyenne ${load.averageDailyHours.toFixed(1)}h`);

### 6. Analyse des gaps});



#### `analyzeResourceGaps(resourceType?: ResourceType, lunchBreakMinutes: number = 120): Array<{...}>`// Charge de toutes les ressources

const allLoads = analysis.analyzeResourceDailyLoad();

Analyse les interruptions dans l'emploi du temps. La pause méridienne est automatiquement soustraite si :```

- Premier cours se termine avant/à 13h00 (≤ 780 min)

- **ET** dernier cours commence après 13h00 (> 780 min)#### `getBusiestDays(limit: number = 5): DailyUsageStats[]`

Retourne les jours les plus chargés (triés par nombre de cours).

**Exemple :**

```typescript```typescript

const gaps = analysis.analyzeResourceGaps(ResourceType.TEACHER);const busiest = analysis.getBusiestDays(3);

const sorted = gaps.sort((a, b) => b.totalGaps - a.totalGaps);console.log(`Jour le plus chargé: ${busiest[0].dayOfWeek} avec ${busiest[0].courseCount} cours`);

```

sorted.slice(0, 5).forEach(g => {

  console.log(`${g.resourceId}: ${(g.totalGaps / 60).toFixed(1)}h d'interruptions`);### 5. Top ressources et quotas

});

```#### `getTopResourcesByLoad(type: ResourceType, limit: number = 10): ResourceUsageStats[]`

Retourne les ressources les plus sollicitées d'un type donné.

### 7. Regroupement par demi-journée

```typescript

#### `analyzeHalfDayGrouping(resourceType?: ResourceType, maxCoursesPerHalfDay: number = 4): Array<{...}>`const top5Teachers = analysis.getTopResourcesByLoad(ResourceType.TEACHER, 5);

const top10Rooms = analysis.getTopResourcesByLoad(ResourceType.ROOM, 10);

Évalue la qualité du regroupement des cours sur des demi-journées.```



**Définition des demi-journées :**#### `findQuotaViolations(resourceType: ResourceType, maxMinutesPerDay: number): Array<{...}>`

- **Matin** : Cours se terminant au plus tard à **13h00** (fin ≤ 780 minutes)Détecte les violations de quotas horaires quotidiens.

- **Après-midi** : Cours débutant après **13h00** (début > 780 minutes)

- **13h00** est toujours inclus dans la pause méridienne```typescript

// Trouver les enseignants avec plus de 6h/jour

**Métriques calculées :**const violations = analysis.findQuotaViolations(ResourceType.TEACHER, 360);

violations.forEach(v => {

1. **Compacité (compactnessScore)** : 0-1, ratio entre minimum théorique et nombre réel de demi-journées  console.log(`${v.resourceId}: ${v.violationDays.length} jour(s) en dépassement`);

2. **Fragmentation (fragmentationIndex)** : Nombre de jours avec cours seulement matin OU après-midi  v.violationDays.forEach(day => {

3. **Densité (averageCoursesPerHalfDay)** : Nombre moyen de cours par demi-journée utilisée    console.log(`  ${day.dayOfWeek}: ${(day.totalMinutes / 60).toFixed(1)}h`);

4. **Distribution** : Histogramme du nombre de demi-journées ayant 1, 2, 3, ... cours  });

});

**Exemple :**```

```typescript

const grouping = analysis.analyzeHalfDayGrouping(ResourceType.TEACHER);### 5. Charge quotidienne

const sorted = grouping.sort((a, b) => b.compactnessScore - a.compactnessScore);

#### `analyzeResourceDailyLoads(resourceType?: ResourceType): ResourceDailyLoad[]`

sorted.forEach(teacher => {Analyse la charge quotidienne des ressources.

  console.log(`${teacher.resourceId}: ${(teacher.compactnessScore * 100).toFixed(0)}% compacité`);

  console.log(`  ${teacher.totalCourses} cours sur ${teacher.halfDaysUsed} demi-journées`);```typescript

  console.log(`  Fragmentation: ${teacher.fragmentationIndex} jour(s)`);const groupLoads = analysis.analyzeResourceDailyLoads(ResourceType.GROUP);

});

```groupLoads.forEach(load => {

  console.log(`${load.resourceId}: max ${load.maxDailyHours}h/jour`);

### 8. Export et rapports});

```

#### `generateReport(totalTasksExpected?: number): string`

#### `findDailyQuotaViolations(resourceType: ResourceType, maxHoursPerDay: number): ResourceDailyLoad[]`

#### `exportToJSON(): string`Identifie les ressources qui dépassent un quota quotidien.



**Exemple :**```typescript

```typescript// Trouver les groupes qui ont plus de 7.5h par jour

const report = analysis.generateReport(80);const violations = analysis.findDailyQuotaViolations(ResourceType.GROUP, 7.5);

console.log(report);

violations.forEach(v => {

import fs from 'fs';  console.log(`${v.resourceId}: ${v.maxDailyHours}h (dépasse 7.5h)`);

fs.writeFileSync('analysis.json', analysis.exportToJSON());});

``````



## Affichage console complet### 6. Analyse des interruptions



### Script test-complete-stats.ts#### `analyzeResourceGaps(resourceType?: ResourceType, lunchBreakMinutes: number = 120): Array<ResourceGaps>`

Calcule les interruptions entre cours pour chaque ressource.

Génère un rapport complet formaté avec tableaux UTF-8 et indicateurs visuels.

**Points clés :**

```bash- Mesure les gaps (interruptions) entre cours consécutifs

npx tsx src/Claude/test-complete-stats.ts- Soustrait automatiquement la pause méridienne si :

```  - Le premier cours commence avant 12h00

  - Le dernier cours se termine après 14h00

**Contenu :**- Paramètre `lunchBreakMinutes` configurable (défaut : 120 min = 2h)

- Vue d'ensemble (tâches, ressources)

- Utilisation des ressources (heures, moyennes, cours)```typescript

- Qualité du regroupement (compacité, fragmentation, densité)interface ResourceGaps {

- Détail par type de ressource (Enseignants, Groupes, Salles)  resourceId: string;

- Distribution par qualité  resourceType: ResourceType;

  dailyGaps: Map<number, {

**Indicateurs :**    day: number;

- 🟢 **Excellent** (≥75% de compacité)    dayOfWeek: string;

- 🟡 **Bon** (50-74%)    firstCourseStart: number;    // Minutes absolues

- 🟠 **Moyen** (40-49%)    lastCourseEnd: number;        // Minutes absolues

- 🔴 **Faible** (<40%)    totalGapDuration: number;     // Minutes (pause méridienne soustraite)

    numberOfGaps: number;

## Tests    averageGap: number;           // Minutes

    courseCount: number;

```bash  }>;

# Statistiques complètes console  totalGaps: number;              // Total en minutes

npx tsx src/Claude/test-complete-stats.ts}

```

# Regroupement par demi-journée

npx tsx src/Claude/test-halfday-grouping.ts**Exemples :**

```

```typescript

## Notes// Analyser les gaps pour tous les enseignants (avec pause méridienne par défaut de 2h)

const teacherGaps = analysis.analyzeResourceGaps(ResourceType.TEACHER);

- Durées en **heures** dans les statistiques

- Temps absolus en **minutes** depuis le début de la semaine// Analyser les gaps pour les groupes avec pause méridienne de 90 minutes

- Jours numérotés de 0 (Lundi) à 6 (Dimanche)const groupGaps = analysis.analyzeResourceGaps(ResourceType.GROUP, 90);

- Pause méridienne soustraite automatiquement dans `analyzeResourceGaps()`

- Frontière 13h00 pour distinguer matin/après-midi// Trier par total d'interruptions

const sorted = teacherGaps.sort((a, b) => b.totalGaps - a.totalGaps);

## Voir aussi

// Afficher les 5 plus fragmentés

- [Schedule.md](./Schedule.md) - Documentation des schedulerssorted.slice(0, 5).forEach(resource => {

- [ConstraintsManager.md](./ConstraintsManager.md) - Gestion des contraintes  console.log(`${resource.resourceId}: ${(resource.totalGaps / 60).toFixed(1)}h d'interruptions`);

- [test-complete-stats.ts](../src/Claude/test-complete-stats.ts) - Affichage complet  

- [test-halfday-grouping.ts](../src/Claude/test-halfday-grouping.ts) - Exemples de regroupement  for (const [day, gaps] of resource.dailyGaps) {

    console.log(`  ${gaps.dayOfWeek}: ${gaps.courseCount} cours, ${gaps.numberOfGaps} gaps = ${(gaps.totalGapDuration / 60).toFixed(1)}h`);
  }
});
```

**Cas d'usage :**
- Identifier les plannings trop fragmentés (nombreuses interruptions)
- Comparer la continuité entre différentes ressources
- Optimiser les plannings pour réduire les temps morts
- Évaluer la qualité d'une solution de planification

### 7. Export et rapports

#### `generateReport(totalTasksExpected?: number): string`
Génère un rapport textuel complet avec statistiques globales.

```typescript
const report = analysis.generateReport(80);
console.log(report);
```

#### `exportToJSON(): string`
Exporte toutes les statistiques au format JSON.

```typescript
const jsonData = analysis.exportToJSON();
console.log(jsonData);
// Ou sauvegarder dans un fichier
import fs from 'fs';
fs.writeFileSync('analysis.json', jsonData);
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
