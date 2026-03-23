# ScheduleAR — Algorithme de backtracking avec ressources alternatives

## Vue d'ensemble

`ScheduleAR` étend `Schedule` pour explorer, au cours du backtracking, **toutes les combinaisons de ressources** applicables à chaque tâche. Là où `Schedule` choisit une combinaison aléatoire en amont puis ne revient jamais dessus, `ScheduleAR` traite le choix des ressources comme une variable de décision à part entière du problème.

---

## Structure des ressources alternatives dans `Task`

Chaque tâche possède un champ `resources` structuré par type :

```
task.resources = {
  TEACHER: Resource[][]   // ex. [[Dupont], [Martin]]        — un parmi deux profs
  ROOM:    Resource[][]   // ex. [[Salle101, Salle103]]      — une parmi deux salles
  GROUP:   Resource[][]   // ex. [[BUT1-G1], [BUT1-G2]]      — toujours TOUS les groupes (un seul choix par groupe)
}
```

Chaque sous-tableau `Resource[]` représente un groupe d'alternatives OU : **une seule ressource** de ce groupe sera choisie. L'intersection produit-cartésien de tous les groupes donne l'ensemble de toutes les combinaisons réalisables pour la tâche.

### `Task.getApplicableResources()` : produit cartésien

```
allGroups = [
  [Dupont],        // TEACHER groupe 1 (un seul prof possible)
  [Salle101, Salle103],  // ROOM groupe 1 (deux salles alternatives)
  [BUT1-G1],       // GROUP groupe 1
  [BUT1-G2],       // GROUP groupe 2
]

résultat = [
  [Dupont, Salle101, BUT1-G1, BUT1-G2],
  [Dupont, Salle103, BUT1-G1, BUT1-G2],
]
```

Le calcul est fait par réduction (fold) sur les groupes :

```typescript
function cartesian(arrays: Resource[][]): Resource[][] {
  return arrays.reduce<Resource[][]>((acc, curr) => {
    // Pour chaque combinaison partielle, on croise avec chaque élément du groupe courant
    for (const combination of acc) {
      for (const resource of curr) {
        result.push([...combination, resource]);
      }
    }
    return result;
  }, []);
}
```

Le nombre de combinaisons croît **multiplicativement** avec le nombre d'alternatives par type.

---

## Initialisation : sélection déterministe (phase `loadData`)

Avant le backtracking, `ScheduleAR.loadData()` affecte à chaque tâche la **première** combinaison retournée par `getApplicableResources()` :

```typescript
const allCombinations = task.getApplicableResources();
task.appliedResources = allCombinations[0]; // première combinaison = état initial
```

C'est une différence clé avec `Schedule` qui sélectionne une combinaison **aléatoire** (`getRandomApplicableResources()`). Le caractère déterministe de `ScheduleAR` garantit la reproductibilité de la recherche.

`task.appliedResources` est la combinaison **courante** exposée au moteur. C'est cette liste qui :
- entre dans le calcul de `task.schedulable` (créneau disponible = intersection des disponibilités des ressources)
- est bookée / débookée lors de `applyConstraints` / `undoConstraints`

---

## Nœuds de décision du backtracking

À chaque appel récursif `backtrack(taskIndex)`, le moteur doit résoudre **deux variables imbriquées** pour la tâche courante :

```
Pour chaque combinaison de ressources R ∈ getApplicableResources(task)
  task.appliedResources ← R
  Pour chaque créneau t ∈ generatePossibleSlots(task)
    applyConstraints(task, t, R)
    backtrack(taskIndex + 1)  ←  récursion
    undoConstraints(task, t, R)
```

L'exploration des ressources est la **boucle externe** ; l'exploration des créneaux est la boucle interne.

### `tryAllResourceCombinations` → `tryWithResourceCombination` → `tryTaskWithCurrentResources`

```
backtrack(taskIndex)
  └─ tryAllResourceCombinations(task, taskIndex)        ← boucle sur R
       └─ tryWithResourceCombination(task, R, taskIndex) ← valider une combinaison
            ├─ task.appliedResources = R
            ├─ task.invalidateSchedulable()              ← cache schedulable invalidé
            └─ tryTaskWithCurrentResources(task, taskIndex)
                 └─ boucle sur les créneaux t
                      ├─ applyConstraints(task, t, R)   ← book des ressources de R
                      ├─ backtrack(taskIndex + 1)        ← récursion
                      └─ undoConstraints(task, t, R)    ← unbook des ressources de R
```

Si aucun créneau ne fonctionne pour la combinaison R courante, `tryWithResourceCombination` restaure la combinaison précédente et passe à la suivante :

```typescript
if (!success) {
  task.appliedResources = previousResources;
  task.invalidateSchedulable();
}
```

---

## Le rôle de `task.schedulable` et de son cache

`task.schedulable` est l'`Availability` qui représente **quand la tâche peut commencer** étant donné ses ressources actuellement assignées : c'est l'**intersection** des disponibilités de toutes les ressources de `appliedResources`.

Ce calcul est **mis en cache** (`_schedulable`). Il est invalidé :
- quand `appliedResources` change (changement de combinaison de ressources)
- quand une ressource de la combinaison est bookée ou débookée (via `invalidateSchedulableForResources`)

Changer de combinaison de ressources sans invalider ce cache produirait des créneaux incorrects — c'est pourquoi `task.invalidateSchedulable()` est systématiquement appelé dans `tryWithResourceCombination`.

---

## Snapshot des ressources : `TaskSolutionAR.appliedResources`

`ScheduleAR` définit une extension de `TaskSolution` :

```typescript
interface TaskSolutionAR extends TaskSolution {
  appliedResources: Resource[]; // snapshot au moment du booking
}
```

Ce snapshot est indispensable car **la combinaison active de la tâche peut changer** lors du backtracking sur les tâches suivantes. Sans snapshot, `undoConstraints` ne saurait pas quelles ressources avaient été bookées et déboorerait les mauvaises.

Les méthodes `applyConstraints` et `undoConstraints` de `ScheduleAR` opèrent exclusivement sur `arSol.appliedResources` (le snapshot), et non sur `task.getAllResources()` comme le fait la classe mère :

```typescript
// ScheduleAR.applyConstraints
for (const resource of arSol.appliedResources) {
  resource.book(startMinutes, endMinutes);
}

// ScheduleAR.undoConstraints
for (const resource of arSol.appliedResources) {
  resource.availability.addAvailability(startMinutes, endMinutes);
}
```

---

## Propagation vers les autres tâches

Après chaque booking, `invalidateSchedulableForResources(appliedResources)` invalide le cache `schedulable` de **toutes les tâches qui partagent au moins une ressource** de la combinaison bookée. Ces tâches recalculeront leurs créneaux disponibles lors de leur prochain accès à `.schedulable`.

Ce mécanisme assure la **propagation des contraintes** sans maintenir un graphe de contraintes explicite.

---

## Heuristique : tri dynamique (MCV)

À chaque palier de récursion (tous les 5 niveaux), `ScheduleAR` retrie les tâches restantes selon `getCurrentConstraintScore` :

- les tâches avec le **moins de créneaux disponibles** obtiennent le score le plus élevé → elles sont traitées en premier (heuristique *Most Constrained Variable*)
- bonus pour les enseignants vacataires (très forte contrainte de disponibilité)

Ce tri opère **après** la propagation des bookings, donc il tient compte de l'effet de chaque combinaison de ressources sur la liberté des tâches suivantes.

---

## Tâches `enforced` : placement imposé

Les tâches marquées `enforced` ont un créneau **et** des ressources fixés à l'avance (ex. cours déjà programmés dans un autre système). Elles sont traitées **avant** le backtracking dans `loadData` :

1. Leur combinaison de ressources est construite depuis `enforced.teacher/groups/rooms`
2. Leur créneau est directement booké via `applyConstraints`
3. Elles sont pré-insérées en tête de `solution` avant le lancement de `backtrack`

Le backtracking démarre donc à `firstNonEnforcedIndex` et ne reviendra jamais sur les tâches enforced.

---

## Critère d'arrêt et sélection de la meilleure solution

`ScheduleAR` continue la recherche après avoir trouvé une première solution complète, jusqu'à :
- avoir trouvé `maxCompleteSolutions` solutions complètes (défaut : 6), **ou**
- avoir atteint la limite d'itérations (`maxIterations`), **ou**
- avoir atteint le timeout (`maxTimeMs`, défaut : 3 min)

À chaque solution complète, un score est calculé (`evaluateSolution`) basé sur la compacité des emplois du temps des enseignants. La meilleure solution (score maximal) est conservée dans `bestSolution` avec un snapshot complet des combinaisons de ressources choisies (`TaskSolutionAR.appliedResources`).

---

## Résumé : différences clés entre `Schedule` et `ScheduleAR`

| Aspect | `Schedule` | `ScheduleAR` |
|---|---|---|
| Choix des ressources | Aléatoire, une seule fois en amont | Déterministe (combo[0]) en amont, puis exhaustif pendant le backtracking |
| Variable de décision | Créneau horaire uniquement | Combinaison de ressources **ET** créneau horaire |
| Boucle externe du backtracking | Créneaux | Combinaisons de ressources |
| Snapshot dans `TaskSolutionAR` | Non | Oui — indispensable pour `undoConstraints` correct |
| Nombre de solutions cherchées | 1 (dès qu'une est trouvée) | `maxCompleteSolutions` (sélection de la meilleure) |
| Risque d'impasse | Élevé (combinaison initiale figée) | Réduit (toutes les combinaisons explorées) |
