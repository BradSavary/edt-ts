# EDT-TS - Système de planification de tâches

Un système de gestion de planification de tâches avec contraintes de ressources et dépendances, écrit en TypeScript.

## 🚀 Fonctionnalités

### Gestion des disponibilités
- **AvailabilityManager** : Gestion optimisée des plages de disponibilité avec recherche binaire
- **TimeInterval** : Représentation d'intervalles de temps avec opérations de fusion et intersection

### Gestion des ressources
- **Resource** : Ressources abstraites (salles, équipements, personnes) avec disponibilités
- Intersection automatique des disponibilités de plusieurs ressources

### Planification de tâches
- **Task** : Tâches avec durée, ressources requises et dépendances
- Planification automatique avec contraintes de ressources
- Gestion des dépendances entre tâches (ordre d'exécution)
- Détection des dépendances circulaires

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
