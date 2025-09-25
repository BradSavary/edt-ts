# Documentation de la classe Schedule

La classe `Schedule` est le planificateur principal du projet EDT-TS. Elle gère la planification des tâches (cours, TD, TP, etc.) en tenant compte des ressources (enseignants, salles, groupes) et des contraintes (dépendances, disponibilités, etc.). L'algorithme principal repose sur le backtracking et la propagation de contraintes.

## Propriétés principales

- `tasks: Task[]`  
  Liste des tâches à planifier.

- `resources: Resource[]`  
  Liste des ressources disponibles (enseignants, salles, groupes).

- `solution: TaskSolution[]`  
  Solution courante de planification (affectation des tâches).

- `bestSolution: TaskSolution[]`  
  Meilleure solution trouvée (optimisée selon le score).

- `bestScore: number`  
  Score de la meilleure solution.

- `maxIterations: number`  
  Limite de sécurité pour le nombre d'itérations du backtracking.

- `currentIterations: number`  
  Compteur d'itérations en cours.

- `limitWarningShown: boolean`  
  Indicateur d'affichage d'un avertissement si la limite est atteinte.

## Méthodes principales

- `constructor()`  
  Initialise le planificateur. Les données sont chargées via le `Loader` lors de la résolution.

- `loadData()`  
  Charge les tâches et ressources depuis les fichiers JSON. Initialise les structures internes.

- `solve(): ScheduleSolution`  
  Lance l'algorithme de planification.  
  - Trie initialement les tâches par score de contrainte (plus contraint d'abord).
  - Utilise le backtracking pour explorer les solutions possibles.
  - Vérifie l'absence de conflits et retourne la meilleure solution trouvée.

- `backtrack(taskIndex: number): boolean`  
  Fonction récursive de backtracking.  
  - Réorganise dynamiquement les tâches restantes selon l'état courant.
  - Applique l'heuristique "Most Constrained Variable".
  - Vérifie les dépendances et la faisabilité de chaque tâche.
  - Génère les créneaux possibles et tente de planifier chaque tâche.

## Algorithmes et stratégies

- **Propagation de contraintes** :  
  Les contraintes temporelles et de ressources sont appliquées dynamiquement à chaque étape du backtracking.

- **Gestion des dépendances** :  
  Les tâches sont planifiées en respectant l'ordre des dépendances (ex : CM → TD → TP).

- **Optimisation** :  
  Le score de chaque solution est calculé en fonction du respect des contraintes et de la complétude de la planification.

- **Robustesse** :  
  L'algorithme garantit l'absence de conflits dans la solution finale.

## Utilisation

```typescript
import { Schedule } from './src/schedule';
const scheduler = new Schedule();
const solution = scheduler.solve();
console.log(`Tâches planifiées: ${solution.solutions.length}`);
scheduler.export2ICal();
```

---

Pour plus de détails sur les méthodes ou l'API, se référer au fichier source ou à la documentation technique du projet.
