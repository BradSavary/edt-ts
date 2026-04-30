# Scheduler — Documentation

## Vue d'ensemble

`Scheduler` (`packages/scheduler-core/src/scheduler.ts`) est le moteur de planification du projet. Il reçoit un ensemble de tâches et de ressources, et produit une ou plusieurs solutions de placement en utilisant un backtracking avec heuristique MCV (*Minimum Constraining Value*).

Le moteur est conçu autour d'une interface unique `ISchedulingUnit` : il ne distingue pas les tâches individuelles des groupes de tâches. Cette séparation permet d'étendre le moteur sans le modifier.

---

## Fonctionnalités supportées

### 1. Tâches individuelles

Une tâche (`Task`) possède une durée et des ressources requises (enseignant, salle, groupe d'étudiants). Elle peut avoir plusieurs **ressources alternatives** par type — le moteur choisit la combinaison permettant le placement le plus tôt.

**Exemple de payload `courses` :**
```json
{
  "code": "R101",
  "name": "Algorithmique",
  "type": "TD",
  "week": 47,
  "semester": 1,
  "level": 1,
  "duration": 90,
  "teacher": ["DUPONT Jean"],
  "rooms": [["Salle101", "Salle102"]],
  "groups": ["BUT1-G1"]
}
```

`rooms: [["Salle101", "Salle102"]]` signifie : une salle choisie parmi `Salle101` ou `Salle102`.

### 2. Ressources alternatives (ET/OU)

Les ressources suivent une sémantique ET/OU :
- Chaque **élément** du tableau est un groupe dont **une** ressource sera choisie (OU).
- L'ensemble des éléments doivent tous être satisfaits (ET).

```json
"teacher": ["ProfA", ["ProfB", "ProfC"]],
"rooms":   [["R01", "R02"]]
```

→ ProfA **ET** (ProfB **OU** ProfC) **ET** (R01 **OU** R02)

Le moteur génère toutes les combinaisons valides via produit cartésien et teste chacune.

### 3. Groupes de tâches

Plusieurs tâches peuvent être liées dans un groupe (`TaskGroupDeclaration`) pour être planifiées ensemble. Deux stratégies :

| Type | Comportement |
|------|-------------|
| `parallel` | Toutes les tâches démarrent au même instant (ressources différentes) |
| `sequential` | Les tâches s'enchaînent sans gap, dans l'ordre déclaré |

**Déclaration dans le payload :**
```json
"groups": [
  { "id": "groupe-CM-R201", "type": "parallel" }
],
"courses": [
  { ..., "taskGroupId": "groupe-CM-R201", "teacher": ["ProfA"], "groups": ["BUT1-G1"] },
  { ..., "taskGroupId": "groupe-CM-R201", "teacher": ["ProfB"], "groups": ["BUT1-G2"] }
]
```

Le moteur crée un `TaskGroupUnit` par groupe et le traite comme une unité unique dans le backtracking.

**Garantie anti-conflit pour les groupes parallèles** : le moteur maintient un ensemble des ressources déjà attribuées aux tâches précédentes dans le même créneau — une même ressource ne peut pas être assignée à deux tâches simultanées du groupe.

### 4. Dépendances entre tâches

Une tâche peut être contrainte à démarrer **après la fin** d'une autre. Le moteur construit le graphe de dépendances au chargement et garantit l'ordre lors du backtracking : une unité ne peut pas être planifiée tant que l'unité dont elle dépend n'est pas encore placée dans la branche courante.

```json
"courses": [
  { "code": "CM-R101", ... },
  { "code": "TD-R101", ..., "dependsOn": "CM-R101" }
]
```

> Les dépendances sont définies dans `CourseTaskData` au niveau des tâches. Si deux tâches dépendantes appartiennent au même groupe, la dépendance inter-groupe est ignorée (une unité ne peut pas dépendre d'elle-même).

### 5. Placements imposés (enforced)

Une tâche peut être placée à un créneau **fixe et non négociable**, indépendamment des disponibilités (un warning est émis si la ressource est occupée). Ces tâches sont pré-bookées avant le début du backtracking.

```json
{
  "code": "REUNION",
  "duration": 60,
  "enforced": {
    "startTime": 480,
    "teacher": ["DUPONT Jean"],
    "groups": ["BUT1-G1"],
    "rooms": ["SalleA"]
  }
}
```

`startTime` est en minutes depuis lundi minuit (voir `docs/TIMESTAMPS.md`).

### 6. Contraintes de disponibilité

Les ressources n'ont accès qu'à leurs créneaux définis dans `constraints`. Le moteur ne placera jamais une tâche en dehors de ces créneaux.

```json
"constraints": {
  "Default": [{ "days": "lundi, mardi, jeudi, vendredi", "from": "08:00", "to": "18:00" }],
  "DUPONT Jean": [{ "days": "lundi, mercredi", "from": "09:00", "to": "17:00" }],
  "BUT1-G1": {
    "default": [{ "days": "lundi, mardi, jeudi", "from": "08:00", "to": "18:00" }],
    "S48": [{ "days": "lundi", "from": "08:00", "to": "12:00" }]
  }
}
```

Les overrides `SXX` (ex: `S48`) remplacent le `default` pour la semaine donnée.

### 7. Pause méridienne

Trois modes configurables via `options.lunchBreak` :

#### Aucune contrainte (défaut)
```json
{ "type": "none" }
```

#### Pause fixe
Bloque une plage horaire dans les disponibilités de tous les **groupes d'étudiants**, pour chaque jour de la semaine, avant le début du backtracking.

```json
{ "type": "fixed", "from": "12:00", "to": "13:30" }
```

#### Pause flottante
Ne bloque rien à l'avance. Pendant le backtracking, chaque créneau candidat est rejeté si, après le placement hypothétique, il ne resterait plus aucun bloc libre d'au moins `duration` minutes dans la fenêtre `[earliest, latest]` pour un groupe impliqué.

```json
{ "type": "floating", "duration": 60, "earliest": "12:00", "latest": "14:00" }
```

### 8. Neutralisation (élimination)

Quand le backtracking échoue à trouver une solution complète, `solveWithElimination()` identifie l'unité la plus bloquante (celle avec le plus grand nombre d'échecs) et la neutralise. Elle est retirée du problème et la recherche repart. Le cycle se répète jusqu'à `maxEliminations` tours ou jusqu'à trouver une solution.

Les unités neutralisées sont incluses dans la réponse avec les métadonnées d'élimination (round, nb d'échecs, raison).

---

## Configuration (`SchedulerConfig`)

| Option | Type | Défaut | Description |
|--------|------|--------|-------------|
| `maxSolutions` | `number` | `6` | Nombre de solutions complètes à collecter |
| `timeoutSeconds` | `number` | `180` | Durée max du backtracking (secondes) |
| `maxIterations` | `number` | `1 000 000` | Nombre max d'appels récursifs |
| `maxEliminations` | `number` | `3` | Nombre max de neutralisations |
| `lunchBreak` | `LunchBreakConfig` | `{ type: 'none' }` | Mode de pause méridienne |

---

## Description algorithmique

### Vue globale

```
solveWithElimination()
  └─ initSolver()
  └─ solve()  ←── peut être répété avec une unité de moins (neutralisation)
       └─ _backtrack(index)  ←── récursif
```

### 1. `initSolver()` — Préparation

1. Charge toutes les tâches depuis `Loader.tasksManager`.
2. Pour chaque `TaskGroupDeclaration`, crée un `TaskGroupUnit` regroupant les tâches membres (identifiées par `taskGroupId`).
3. Pour les tâches sans groupe, crée un `TaskUnit`.
4. Reporte le graphe de dépendances : si `taskA.dependsOn = taskB` et qu'ils sont dans des unités différentes, `unitA.setDependsOn(unitB)` est appelé.
5. Tri initial : les unités **enforced** sont placées en tête de liste.
6. **Pré-booking** des enforced : leurs ressources sont consommées avant le backtracking. Elles n'entrent pas dans l'exploration.
7. Application de la pause méridienne (fixe : modification des `Availability` ; flottante : stockage de la config).

### 2. `solve()` — Orchestration

Réinitialise les compteurs, pré-remplit la pile de solution avec les enforced, puis lance `_backtrack(firstNonEnforcedIndex)`. Trie les solutions par score décroissant avant de les retourner.

### 3. `_backtrack(unitIndex)` — Cœur du moteur

```
_backtrack(i):
  si i == nb_unités → enregistrer la solution, return
  
  tri MCV dynamique sur les unités [i..n]
  
  unit = unités[i]
  fromTime = 0 (ou fin de la dépendance amont si présente)
  
  boucle:
    result = unit.earlySchedule(fromTime)
    si result == null → incrémenter failureCount[unit], return false
    
    si pause flottante et créneau invalide → fromTime += 30, continuer
    
    unit.book(result)
    subResult = _backtrack(i + 1)
    unit.unBook(result)
    
    si subResult == true → return true
    fromTime = result.start + 30
```

**Tri MCV** (`_dynamicSort`) : à chaque niveau de récursion, les unités restantes sont triées par `getSchedulingPriority()` décroissant — les plus contraintes (moins de créneaux disponibles, enseignant vacataire, beaucoup de dépendants) passent en premier.

**Granularité** : le pas entre deux créneaux testés est de 30 minutes (`SLOT_STEP`).

**Limites** : le backtracking s'arrête si `timeoutSeconds` est dépassé ou si `maxIterations` appels récursifs ont été effectués.

### 4. `earlySchedule()` — Placement anticipé

Chaque type d'unité implémente sa propre logique :

- **`TaskUnit`** : teste toutes les combinaisons de ressources alternatives et retourne le créneau le plus tôt parmi toutes les combinaisons. Opération en lecture seule (n'alloue rien).
- **`TaskGroupUnit` (parallel)** : cherche le premier instant `t` où *toutes* les tâches membres peuvent démarrer simultanément, en évitant les conflits de ressources entre membres (ensemble `claimed`).
- **`TaskGroupUnit` (sequential)** : cherche le premier ancrage `t` tel que la séquence complète est planifiable sans interruption à partir de `t`.

### 5. `book()` / `unBook()` — Réservation

- `book(result)` : sauvegarde l'état courant (pile LIFO), affecte les ressources à la tâche, consomme les créneaux dans les `Availability`, invalide les caches `schedulable` des tâches partageant une ressource.
- `unBook(result)` : inverse exactement `book()` — restitue les créneaux, restaure l'état précédent depuis la pile.

Cette pile LIFO garantit que le backtracking peut revenir à n'importe quel état antérieur sans corruption.

### 6. `solveWithElimination()` — Neutralisation

```
round = 0
tant que aucune solution et round < maxEliminations:
  lancer solve()
  si aucune solution:
    trouver l'unité avec failureCount maximal
    la retirer de _units
    l'ajouter à neutralizedList
    round++

attacher neutralizedList à toutes les solutions retournées
```

---

## Endpoint API

`POST /api/schedule/v2`

**Corps JSON** (`RawScheduleData`) :
```json
{
  "week": 47,
  "resources": [
    { "resourceType": "teacher", "resources": [{ "id": "DUPONT Jean", "info": "{\"status\":\"PERMANENT\"}" }] },
    { "resourceType": "room",    "resources": [{ "id": "Salle101" }] },
    { "resourceType": "group",   "resources": [{ "id": "BUT1-G1" }] }
  ],
  "courses": [ /* CourseTaskData[] */ ],
  "constraints": { /* ConstraintsData — optionnel */ },
  "groups": [ /* TaskGroupDeclaration[] — optionnel */ ],
  "options": {
    "maxSolutions": 6,
    "timeoutSeconds": 180,
    "maxEliminations": 3,
    "lunchBreak": { "type": "none" }
  }
}
```

**Réponse** : tableau de `ScheduleSolutionJSON`

```json
[
  {
    "isComplete": true,
    "score": 12,
    "solutions": [
      {
        "taskId": "47-R101-TD",
        "code": "R101",
        "name": "Algorithmique",
        "type": "TD",
        "week": 47,
        "duration": 90,
        "startTime": 480,
        "resources": [
          { "id": "DUPONT Jean", "type": "teacher" },
          { "id": "Salle101", "type": "room" },
          { "id": "BUT1-G1", "type": "group" }
        ]
      }
    ],
    "neutralizedTasks": []
  }
]
```

Si `maxEliminations = 0`, aucune neutralisation n'est tentée.

---

## Architecture des unités de planification

```
ISchedulingUnit (interface)
  ├── TaskUnit          — tâche atomique, délègue à Task
  └── TaskGroupUnit     — groupe de tâches (parallel ou sequential)
```

Le moteur `Scheduler` ne manipule que `ISchedulingUnit`. L'ajout d'un nouveau type d'unité ne nécessite aucune modification du moteur.

## Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `packages/scheduler-core/src/scheduler.ts` | Moteur, backtracking, neutralisation |
| `packages/scheduler-core/src/schedulingUnit.ts` | Interface `ISchedulingUnit`, types `UnitSolution`, `SchedulingResult` |
| `packages/scheduler-core/src/taskUnit.ts` | Adaptateur tâche atomique |
| `packages/scheduler-core/src/taskGroupUnit.ts` | Adaptateur groupe de tâches |
| `packages/scheduler-core/src/loader.ts` | Chargement des données dans le moteur |
| `packages/scheduler-common/src/types.ts` | `SchedulerConfig`, `RawScheduleData`, `CourseTaskData`, `TaskGroupDeclaration`, `EnforcedData` |
| `packages/scheduler-api/src/controllers/scheduleController.ts` | Handler HTTP, sérialisation JSON |
| `packages/scheduler-api/src/routes/schedule.ts` | Route `POST /api/schedule/v2` |
