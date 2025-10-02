# Analyse et Correction du Bug Multi-Rooms

## 📋 Résumé
L'algorithme `solve` de la classe `ScheduleMR` présentait un bug critique qui permettait d'affecter une même salle à deux tâches distinctes programmées en parallèle. Ce problème n'apparaissait qu'avec la gestion alternative des salles.

## 🐛 Description du Bug

### Symptôme
Deux tâches différentes pouvaient être planifiées au même créneau horaire dans la même salle, violant la contrainte d'exclusivité des ressources.

Exemple de conflit détecté :
```
❌ CONFLIT entre "Économie, gestion et droit du numérique" (Mar 08:00-Mar 09:30) 
   et "Déploiement de services" (Mar 08:00-Mar 09:30) 
   sur la ressource: 101
```

### Cause Racine

Le bug était causé par **deux problèmes interdépendants** dans la gestion des salles alternatives pendant le backtracking :

#### 1. **Désynchronisation entre `applyConstraints` et `undoConstraints`**

Lorsqu'une tâche change de salle durant l'exploration des alternatives :
- `changeRoom(newRoom)` modifie `task.resources` en retirant l'ancienne salle et ajoutant la nouvelle
- `applyConstraints` réserve les ressources actuellement dans `task.resources`
- Si le backtracking échoue et qu'on change à nouveau de salle, `undoConstraints` ne libère que les ressources **actuellement** dans `task.resources`
- **Résultat** : L'ancienne salle conserve ses réservations fantômes !

```typescript
// Exemple du problème :
// 1. Task a la salle A, on réserve A avec applyConstraints
// 2. On change vers la salle B avec changeRoom (A est retirée de task.resources)
// 3. undoConstraints ne libère que B (car A n'est plus dans task.resources)
// 4. La salle A reste réservée à tort !
```

#### 2. **Mutation des tâches après sauvegarde de `bestSolution`**

Lorsqu'une solution valide est trouvée :
- `bestSolution = [...this.solution]` copie les références des `TaskSolution`
- Ces références pointent vers des objets `Task` qui **continuent à muter** pendant le backtracking
- Quand `changeRoom` est appelé après la sauvegarde, les tâches dans `bestSolution` pointent vers des ressources incorrectes
- **Résultat** : La vérification finale de `bestSolution` détecte des conflits car les tâches n'ont plus les bonnes salles

## 🔧 Solution Implémentée

### 1. Extension de `TaskSolution` pour ScheduleMR

Ajout d'une interface `TaskSolutionMR` qui sauvegarde un snapshot des ressources :

```typescript
interface TaskSolutionMR extends TaskSolution {
    appliedResources: Resource[]; // Snapshot des ressources au moment de l'application
}
```

### 2. Sauvegarde des ressources dans `tryTaskWithCurrentRoom`

Lors de la création d'une solution, on sauvegarde les ressources actuelles :

```typescript
const taskSolution: TaskSolutionMR = {
    task,
    startTime: slot.startTime,
    appliedResources: [...task.resources] // Copie des ressources actuelles
};
```

### 3. Utilisation du snapshot dans `applyConstraints` et `undoConstraints`

Les contraintes utilisent maintenant `appliedResources` au lieu de `task.resources` :

```typescript
protected applyConstraints(taskSolution: TaskSolution): void {
    const taskSolutionMR = taskSolution as TaskSolutionMR;
    const resourcesToBook = taskSolutionMR.appliedResources || task.resources;
    
    for (const resource of resourcesToBook) {
        resource.availability.book(startMinutes, endMinutes);
    }
}

protected undoConstraints(taskSolution: TaskSolution): void {
    const taskSolutionMR = taskSolution as TaskSolutionMR;
    const resourcesToFree = taskSolutionMR.appliedResources || task.resources;
    
    for (const resource of resourcesToFree) {
        resource.availability.addAvailability(startMinutes, endMinutes);
    }
}
```

### 4. Copie profonde de `bestSolution`

Lors de la sauvegarde de `bestSolution`, on fait une copie profonde avec les ressources :

```typescript
this.bestSolution = this.solution.map(sol => {
    const mrSol = sol as TaskSolutionMR;
    return {
        task: mrSol.task,
        startTime: mrSol.startTime,
        appliedResources: [...mrSol.appliedResources] // Copie profonde
    } as TaskSolutionMR;
});
```

### 5. Restauration des ressources avant vérification

Avant de vérifier `bestSolution`, on restaure les ressources correctes dans les tâches :

```typescript
private restoreTaskResourcesFromSolution(solution: TaskSolution[]): void {
    for (const sol of solution) {
        const mrSol = sol as TaskSolutionMR;
        if (mrSol.appliedResources) {
            const task = mrSol.task;
            const appliedRoom = mrSol.appliedResources.find(r => r.type === 'room');
            
            if (appliedRoom) {
                // Forcer le changement de salle pour correspondre à la solution
                const currentStatus = (task as any).status;
                (task as any).status = 'pending';
                task.changeRoom(appliedRoom);
                (task as any).status = currentStatus;
            }
        }
    }
}
```

### 6. Restauration immédiate en cas d'échec

Dans `tryWithAlternativeRoom`, on restaure la salle originale immédiatement en cas d'échec :

```typescript
const success = this.tryTaskWithCurrentRoom(task, taskIndex);

if (!success && currentRoom && currentRoom.id !== alternativeRoom.id) {
    task.changeRoom(currentRoom);
    task.invalidateSchedulable();
}

return success;
```

## ✅ Validation

### Tests effectués

1. **Test de détection de conflits** (`test-mr-conflict.ts`) :
   - Exécute ScheduleMR et vérifie l'absence de conflits de salles
   - ✅ Résultat : Aucun conflit détecté

2. **Test MR avec export iCal** (`test-mr-ical.ts`) :
   - Planification complète avec export des calendriers
   - ✅ Résultat : 79 tâches planifiées, 0 conflit

### Statistiques de la solution

- **Tâches planifiées** : 79/80
- **Conflits** : 0
- **Salles utilisées** : 8
- **Moyenne de tâches par salle** : 9.9
- **Temps d'exécution** : ~3.5-4 secondes

## 📊 Impact

### Avant la correction
- ❌ Conflits de salles fréquents
- ❌ Solution invalide détectée lors de la vérification finale
- ❌ Erreur critique lancée : "Conflit détecté dans une solution supposée valide"

### Après la correction
- ✅ Aucun conflit de salle
- ✅ Solution valide
- ✅ Cohérence garantie entre réservation et libération des ressources
- ✅ Intégrité de `bestSolution` préservée

## 🎯 Leçons apprises

1. **Snapshot vs Références** : Quand on travaille avec des objets mutables dans un algorithme de backtracking, il faut toujours sauvegarder des snapshots, pas des références.

2. **Cohérence Apply/Undo** : Les opérations `applyConstraints` et `undoConstraints` doivent travailler sur **exactement les mêmes ressources**, même si l'état de l'objet change entre les deux appels.

3. **Isolation des mutations** : Dans un contexte de backtracking avec exploration d'alternatives, les mutations d'état doivent être soigneusement isolées et réversibles.

4. **Tests de conflit** : Un test dédié à la détection de conflits est essentiel pour valider les algorithmes de planification.

## 🔍 Points d'attention futurs

1. **Performance** : La copie des ressources à chaque solution ajoute un surcoût. Si nécessaire, optimiser en utilisant des structures immuables.

2. **Généralisation** : Envisager d'appliquer la même logique à `Schedule` et `ScheduleExp` pour garantir la cohérence.

3. **Tests unitaires** : Ajouter des tests unitaires spécifiques pour `changeRoom`, `applyConstraints`, et `undoConstraints`.

## 📝 Fichiers modifiés

- `src/scheduleMR.ts` : Corrections principales (interface, méthodes apply/undo, restauration)
- `src/Claude/test-mr-conflict.ts` : Nouveau test de détection de conflits

---

**Date de correction** : 2 octobre 2025  
**Testé avec** : Node.js v22.19.0, TypeScript via tsx
