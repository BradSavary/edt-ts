# Task - Gestion des Tâches et Ressources Alternatives

## Vue d'ensemble

La classe `Task` représente une tâche à planifier dans le système EDT-TS. Elle intègre un système sophistiqué de gestion des ressources alternatives permettant de modéliser des contraintes de type ET/OU.

## Structure des Ressources

### Propriété `resources`

```typescript
resources: { [K in ResourceType]: Resource[][] }
```

Cette structure permet de définir des **groupes alternatifs** de ressources pour chaque type :
- `ResourceType.TEACHER` : Enseignants
- `ResourceType.ROOM` : Salles
- `ResourceType.GROUP` : Groupes d'étudiants

### Sémantique ET/OU

Chaque type de ressource contient un **tableau de groupes alternatifs**, où :
- Chaque **groupe alternatif** est un tableau de ressources
- La tâche nécessite **une ressource de chaque groupe alternatif**

#### Exemple

```typescript
{
  TEACHER: [[ProfA], [ProfB, ProfC]],
  ROOM: [[R01, R02]],
  GROUP: [[G1]]
}
```

**Interprétation** : La tâche a besoin de :
- ProfA **ET**
- (ProfB **OU** ProfC) **ET**
- (R01 **OU** R02) **ET**
- G1

**Combinaisons applicables** :
1. `[ProfA, ProfB, R01, G1]`
2. `[ProfA, ProfB, R02, G1]`
3. `[ProfA, ProfC, R01, G1]`
4. `[ProfA, ProfC, R02, G1]`

## Méthodes Principales

### `getApplicableResources(): Resource[][]`

Retourne toutes les combinaisons possibles de ressources pour la tâche.

**Algorithme** : Produit cartésien des groupes alternatifs
- Sélectionne une ressource de chaque groupe alternatif
- Génère toutes les combinaisons possibles

**Exemple d'utilisation** :

```typescript
const task = new Task(/* ... */);
const combinations = task.getApplicableResources();
// Retourne un tableau de tableaux de ressources
// Chaque sous-tableau est une combinaison valide
```

### `appliedResources` (getter/setter)

Propriété pour gérer les ressources actuellement appliquées à la tâche.

**Getter** :
```typescript
const currentResources = task.appliedResources;
// Retourne Resource[] ou []
```

**Setter** :
```typescript
task.appliedResources = [profA, profB, r01, g1];
// Définit les ressources appliquées et invalide le cache schedulable
```

### `addResource(resource: Resource): void`

Ajoute une ressource comme nouveau groupe alternatif.

**Comportement** :
- Vérifie que la tâche est en statut `PENDING`
- Crée un nouveau groupe alternatif contenant uniquement cette ressource
- Établit la relation bidirectionnelle avec la ressource
- Invalide le cache des disponibilités

**Exemple** :
```typescript
task.addResource(newRoom);
// Ajoute [[newRoom]] au tableau resources[ROOM]
```

### `removeResource(resource: Resource): void`

Retire une ressource d'un groupe alternatif.

**Comportement** :
- Vérifie que la tâche est en statut `PENDING`
- Recherche la ressource dans tous les groupes alternatifs de son type
- Retire la ressource du groupe
- Supprime le groupe s'il devient vide
- Rompt la relation bidirectionnelle
- Invalide le cache des disponibilités

**Exemple** :
```typescript
task.removeResource(oldRoom);
// Retire oldRoom de son groupe et supprime le groupe si vide
```

### `getAllResources(): Resource[]`

Retourne un tableau plat de toutes les ressources appliquées.

**Note** : Utilise `appliedResources`, pas la structure `resources` complète.

## Usage dans les Planificateurs

Les planificateurs (Schedule, ScheduleExp, ScheduleMR) doivent suivre ce workflow :

### 1. Obtenir les combinaisons

```typescript
const combinations = task.getApplicableResources();
```

### 2. Tester chaque combinaison

```typescript
for (const combination of combinations) {
  // Vérifier la disponibilité
  const available = combination.every(r => 
    r.isAvailable(start, end)
  );
  
  if (available) {
    // Combinaison valide trouvée
    break;
  }
}
```

### 3. Appliquer la combinaison choisie

```typescript
task.appliedResources = combination;
```

### 4. Réserver les ressources

```typescript
combination.forEach(resource => {
  resource.book(start, end);
});
```

## Propriétés Liées

### `availableRooms: Resource[]`

Tableau de toutes les salles possibles pour cette tâche.
- Utilisé pour valider les changements de salle
- Distinct de `resources[ROOM]` qui contient les groupes alternatifs

### `_schedulable: AvailabilityManager`

Cache de l'intersection des disponibilités des ressources appliquées.
- Calculé à la demande via `_computeSchedulable()`
- Invalidé par `invalidateSchedulable()`

## Cas d'Usage

### Cas 1 : Ressource unique par type

```typescript
{
  TEACHER: [[profA]],
  ROOM: [[r01]],
  GROUP: [[g1]]
}
// 1 seule combinaison : [profA, r01, g1]
```

### Cas 2 : Alternatives pour un type

```typescript
{
  TEACHER: [[profA]],
  ROOM: [[r01, r02, r03]],
  GROUP: [[g1]]
}
// 3 combinaisons : une par salle alternative
```

### Cas 3 : Multiples groupes alternatifs

```typescript
{
  TEACHER: [[profA], [profB]],
  ROOM: [[r01], [r02]],
  GROUP: [[g1]]
}
// 4 combinaisons : profA+r01+g1, profA+r02+g1, profB+r01+g1, profB+r02+g1
```

### Cas 4 : Ressources multiples obligatoires

```typescript
{
  TEACHER: [[profA, profB]],
  ROOM: [[r01]],
  GROUP: [[g1]]
}
// 1 combinaison : [profA, profB, r01, g1]
// Les deux enseignants sont requis simultanément
```

## Limitations et Contraintes

1. **Immutabilité après planification** : Les ressources ne peuvent être modifiées que si `status === PENDING`

2. **Cohérence bidirectionnelle** : Toute modification doit maintenir la relation `task ↔ resource`

3. **Cache de disponibilité** : Toute modification des ressources invalide le cache `_schedulable`

4. **Validation des combinaisons** : Les planificateurs doivent vérifier que toutes les ressources d'une combinaison sont disponibles simultanément

## Tests

Voir `src/Claude/test-applicable-resources.ts` pour des exemples complets de test du système de ressources alternatives.

## Références

- `src/task.ts` : Implémentation complète
- `src/resource.ts` : Définition des types de ressources
- `src/schedule.ts`, `src/scheduleExp.ts`, `src/scheduleMR.ts` : Usage dans les planificateurs
