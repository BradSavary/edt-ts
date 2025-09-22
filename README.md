# EDT-TS - Système de Gestion d'Emploi du Temps

Un système de planification et de gestion des ressources pour emplois du temps, développé en TypeScript pour Node.js.

## � Fonctionnalités

### 🎯 Gestion des Ressources
- **Types de ressources** : Enseignants, Salles, Groupes
- **Gestion des disponibilités** : Créneaux optimisés avec intervalles triés
- **Tracking de charge** : Workload et pressure pour analyser l'utilisation
- **Indexation optimisée** : Accès O(1) par identifiant

### ⏰ Planification de Tâches
- **Réservation de ressources** : Gestion automatique des conflits
- **Dépendances entre tâches** : Chaînage et validation des cycles
- **Recherche de créneaux** : Algorithmes optimisés pour trouver les disponibilités
- **Gestion d'état** : Statuts pending/scheduled/completed/cancelled

### 📊 Données
- **Chargement automatique** : Depuis fichiers JSON (teachers, rooms, groups)
- **Gestion centralisée** : ResourcesManager pour l'ensemble des ressources

## 🚀 Installation et Usage

### Prérequis
- Node.js 18+
- npm

### Installation
```bash
git clone https://github.com/edt-ts-maintainer/edt-ts.git
cd edt-ts
npm install
```

### Exécution
```bash
# Planificateur standard (recommandé)
npx tsx src/Claude/test-standard-schedule.ts

# Version expérimentale "chirurgicale"
npx tsx src/Claude/test-exp-scheduling.ts

# Version Multi-Rooms avec export iCal
npx tsx src/Claude/test-mr-ical.ts

# Vérification TypeScript (avec erreurs connues non-bloquantes)
npm run build
```

## 📋 Exemple d'utilisation

```typescript
import { Schedule } from './src/schedule';
import { Loader } from './src/lib/loader';

// Chargement automatique des données JSON
// Les tâches et ressources sont chargées depuis src/json/
const scheduler = new Schedule();

// 🔗 Les dépendances CM → TD → TP sont automatiquement déterminées
// Exemple : R3.16 CM doit être planifié avant R3.16 TD et TP

// Résolution du planning avec backtracking + propagation de contraintes
const solution = scheduler.solve();

// Vérification des résultats
console.log(`Tâches planifiées: ${solution.solutions.length}`);
console.log(`Planning complet: ${solution.isComplete}`);
console.log(`Conflits: ${solution.conflictCount}`);

// Export iCal des plannings par niveau (R1, R3, R5)
scheduler.export2ICal();
```

### Données et Configuration

Le système charge automatiquement :
- **src/json/cours.json** : Liste des cours (R1.01, R3.16, R5.08, etc.)
- **src/json/contraintes.json** : Contraintes horaires des ressources
- **Dépendances automatiques** : CM → TD → TP selon les codes cours

## 🔧 Scripts et Tests Disponibles

```bash
# Algorithmes de planification
npx tsx src/Claude/test-standard-schedule.ts  # Planificateur principal
npx tsx src/Claude/test-exp-scheduling.ts     # Version expérimentale
npx tsx src/Claude/test-mr-ical.ts           # Multi-Rooms + iCal export

# Autres tests et scripts (optionnels)
npx tsx src/Claude/test-dependencies.ts      # Test des dépendances
npx tsx src/Claude/test-task-compatibility.ts # Compatibilité des tâches

# Vérification TypeScript
npm run build                                # Validation du code
```

## 🏗️ Architecture

- **schedule.ts** : Planificateur principal avec backtracking et propagation de contraintes
- **scheduleExp.ts** : Version expérimentale "chirurgicale" avec optimisations avancées
- **scheduleMR.ts** : Version Multi-Rooms exploitant la flexibilité des salles
- **task.ts** : Classe Task enrichie avec propriétés cours complètes (type, week, semester, level)
- **resource.ts** : Gestion des ressources (enseignants, salles, groupes) avec disponibilités
- **bookable.ts** : Système de réservation et gestion des créneaux optimisés
- **lib/loader.ts** : Chargement JSON + détermination automatique des dépendances
- **resourcesManager.ts** : Gestionnaire centralisé avec indexation O(1)
- **constraintsManager.ts** : Application des contraintes temporelles par ressource

## 🔗 Système de Dépendances Automatique

Le système détermine automatiquement les dépendances entre cours selon les règles métier éducatives :

### 📋 **Règles de Dépendances**

1. **Hiérarchie pédagogique** : CM → TD → TP (même code de cours)
2. **Contraintes de groupes** : Les groupes de la tâche dépendante doivent être inclus dans ceux de la tâche prérequise
3. **Validation simultanée** : Toutes les conditions doivent être respectées

### 🔧 **Implémentation**

```typescript
// Algorithme dans Loader.determineDependencies() :
// 1. Regrouper les tâches par code de cours (ex: R3.16)
// 2. Filtrer par ordre de type : CM, puis TD, puis TP
// 3. Appliquer les contraintes de groupes
// 4. Créer les liens de dépendance

// Exemple de résolution automatique :
// R3.16 CM (BUT2-G1,G2,G3) → R3.16 TD (BUT2-G1) 
// R3.16 CM (BUT2-G1,G2,G3) → R3.16 TD (BUT2-G2)
// R3.16 TD (BUT2-G1) → R3.16 TP (BUT2-G11,G12)

// Résultat : Les CM doivent être planifiés avant les TD,
//            qui doivent être planifiés avant les TP
```

### ⚡ **Avantages**

- **Automatique** : Aucune configuration manuelle requise
- **Cohérent** : Respect des règles pédagogiques universitaires
- **Flexible** : Support des groupes multiples et sous-groupes
- **Performant** : Algorithme O(n²) avec optimisations

## ⚡ Algorithmes de Planification

**Tous les algorithmes supportent nativement :**
- ✅ Dépendances automatiques CM → TD → TP par code de cours
- ✅ Contraintes de groupes (inclusion obligatoire)
- ✅ Propagation de contraintes bidirectionnelle
- ✅ Détection de conflits en temps réel

### 1. **Schedule** (Standard)
- **Algorithme** : Backtracking avec propagation de contraintes
- **Heuristique** : Most Constrained Variable (MCV)
- **Optimisations** : Tri dynamique tous les 5 niveaux
- **Dépendances** : Support complet CM → TD → TP + contraintes groupes
- **Limite** : 1M itérations
- **Usage** : Planification robuste pour emplois du temps complexes

### 2. **ScheduleExp** (Expérimental)  
- **Algorithme** : Approche "chirurgicale" avec manipulation directe des schedulables
- **Optimisations** : Contraintes fines, exploration aggressive
- **Dépendances** : Même support que Schedule avec optimisations expérimentales
- **Usage** : Tests d'optimisations avancées

### 3. **ScheduleMR** (Multi-Rooms)
- **Algorithme** : Extension de Schedule avec flexibilité des salles alternatives
- **Spécialité** : Exploitation dynamique des salles multiples (36% des tâches)
- **Dépendances** : Support complet + optimisation des changements de salles
- **Export** : Génération automatique iCal par niveaux (R1, R3, R5)
- **Usage** : Planification avec contraintes de salles flexibles

## 📊 Performances

- Recherche binaire pour l'insertion et la recherche de créneaux : **O(log n)**
- Intersection des disponibilités optimisée : **O(n + m)**
- Détection des dépendances circulaires : **O(V + E)**

## 🛠️ Technologies

- **TypeScript** : Type safety et développement moderne
- **Node.js** : Runtime JavaScript/TypeScript 
- **tsx** : Exécution directe des fichiers TypeScript (remplace ts-node)
- **Algorithmes** : Backtracking, propagation de contraintes, heuristiques MCV

## 📝 License

MIT
