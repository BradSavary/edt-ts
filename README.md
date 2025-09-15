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
# Exécuter l'exemple de démonstration
npm start

# Ou utiliser directement
npm run example

# Vérification TypeScript
npm run build
```

## 📋 Exemple d'utilisation

```typescript
import { Resource } from './src/resource';
import { Task } from './src/task';

// Créer des ressources
const salle = new Resource('salle-A01');
const projecteur = new Resource('projecteur-1');

// Définir les disponibilités (en minutes depuis minuit)
salle.addAvailability(9 * 60, 17 * 60); // 9h à 17h
projecteur.addAvailability(8 * 60, 18 * 60); // 8h à 18h

// Créer une tâche nécessitant les deux ressources
const reunion = new Task('reunion-001', 'Réunion équipe', 120, [salle, projecteur]);

// Planifier automatiquement
const resultat = reunion.scheduleNext();
console.log(resultat.success ? 'Planifiée !' : 'Impossible à planifier');
```

## 🔧 Installation et utilisation

```bash
# Installer les dépendances
npm install

# Exécuter l'exemple
npm run example

# Développement avec Vite
npm run dev
```

## 🏗️ Architecture

- **bookable.ts** : Classes de base pour la gestion des disponibilités
- **resource.ts** : Gestion des ressources avec disponibilités
- **task.ts** : Planification de tâches avec contraintes et dépendances
- **example.ts** : Exemple d'utilisation complète

## 🔗 Dépendances entre tâches

Le système supporte les dépendances entre tâches :

```typescript
const tache1 = new Task('prep', 'Préparation', 60, [salle]);
const tache2 = new Task('exec', 'Exécution', 120, [salle, projecteur]);

// Tâche 2 dépend de tâche 1
tache2.setDependsOn(tache1);

// Planifier dans l'ordre
tache1.scheduleNext();
tache1.complete();
tache2.scheduleNext(); // Ne peut être planifiée qu'après tache1
```

## 📊 Performances

- Recherche binaire pour l'insertion et la recherche de créneaux : **O(log n)**
- Intersection des disponibilités optimisée : **O(n + m)**
- Détection des dépendances circulaires : **O(V + E)**

## 🛠️ Technologies

- **TypeScript** : Type safety et développement moderne
- **Vite** : Build tool rapide
- **tsx** : Exécution directe des fichiers TypeScript

## 📝 License

MIT
