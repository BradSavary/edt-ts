# `@edt-ts/scheduler-common`

Bibliothèque de logique métier partagée entre `scheduler-api` (Express) et `scheduler-client` (Next.js).  
100 % framework-agnostic — utilisable aussi bien côté serveur que dans un navigateur.

---

## Table des matières

- [Rôle du package](#rôle-du-package)
- [Arborescence des dépendances depuis `SchedulerData`](#arborescence-des-dépendances-depuis-schedulerdata)
- [Classe par classe](#classe-par-classe)
  - [SchedulerData](#schedulerdata)
  - [AvailabilityManager](#availabilitymanager)
  - [ResourcesManager](#resourcesmanager)
  - [TasksManager](#tasksmanager)
  - [Resource](#resource)
  - [Task](#task)
  - [Availability](#availability)
  - [TimeInterval](#timeinterval)
  - [TimestampUtils](#timestamputils)
- [Types de données](#types-de-données)
  - [ResourceEntry](#resourceentry)
  - [ResourceData / ResourceGroupData](#resourcedata--resourcegroupdata)
  - [CourseTaskData / CoursesData](#coursetaskdata--coursesdata)
  - [ConstraintsData / ResourceConstraints / TimeSlot](#constraintsdata--resourceconstraints--timeslot)

---

## Rôle du package

`scheduler-common` contient les **modèles, algorithmes et interfaces** nécessaires à la planification.  
Il ne dépend d'aucun module Node.js (`fs`, `path`, etc.) : aucun accès disque, les données transitent par le payload HTTP.

Ce package expose :
- Le **conteneur de session** (`SchedulerData`) qui orchestre les trois étapes d'initialisation
- Les **gestionnaires** de ressources, de tâches et de contraintes de disponibilité
- Les **modèles** de bas niveau (`Resource`, `Task`, `Availability`, `TimeInterval`)
- L'ensemble des **types TypeScript** partagés avec l'API et les clients

---

## Arborescence des dépendances depuis `SchedulerData`

```
SchedulerData
├── ResourcesManager          (possède et indexe les ressources)
│   └── Resource[]
│       └── Availability      (plages de disponibilité de la ressource)
│           └── TimeInterval[]
├── AvailabilityManager       (construit à partir de ConstraintsData)
│   └── Availability          (une par ressource, + overrides hebdomadaires)
│       └── TimeInterval[]
└── TasksManager              (possède et indexe les tâches)
    └── Task[]
        ├── Resource[][]      (groupes d'alternatives par type : TEACHER/ROOM/GROUP)
        ├── Availability      (intersection calculée des disponibilités des ressources appliquées)
        └── Task?             (dépendance : CM → TD → TP)
```

**Flux d'initialisation :**

```
ResourceGroupData[]  ──► initResources()   ──► ResourcesManager
ConstraintsData      ──► initConstraints() ──► AvailabilityManager
                                               └─► applyConstraintsForWeek()
                                                   └─► Resource.availability ← Availability
CoursesData          ──► initTasks()       ──► TasksManager
                                               └─► Task (avec dépendances CM→TD→TP)
```

---

## Classe par classe

### `SchedulerData`

**Fichier :** `schedulerData.ts`

Point d'entrée unique pour constituer une session de planification complète.  
Construit vide, il s'initialise en trois étapes indépendantes et ordonnées :

| Méthode | Rôle |
|---|---|
| `initResources(data)` | Construit le `ResourcesManager` à partir des groupes de ressources JSON |
| `initConstraints(data)` | Instancie un `AvailabilityManager` à partir des contraintes JSON |
| `initTasks(data)` | Construit les `Task`, applique les contraintes aux ressources, établit les dépendances CM→TD→TP |

**Getters :** `resourcesManager`, `tasksManager`, `availabilityManager`, `isReady`

`isReady` passe à `true` uniquement quand les trois initialisations sont complètes.  
Chaque appel à `initConstraints()` crée une **nouvelle instance** d'`AvailabilityManager` — il n'y a pas d'état global partagé.

---

### `AvailabilityManager`

**Fichier :** `availabilityManager.ts`

Interprète un `ConstraintsData` et calcule à la construction l'`Availability` de chaque ressource identifiée.  
Supporte les **overrides hebdomadaires** (`S36`, `S47`, etc.) : si une contrainte spécifique à la semaine $n$ est définie pour une ressource, elle prime sur la contrainte par défaut.

Cette classe est **instanciable** (pas de singleton statique) — deux sessions de planification peuvent coexister sans interférence.

| Méthode | Rôle |
|---|---|
| `getAvailability(id, week?)` | Retourne l'`Availability` d'une ressource, avec override si la semaine est fournie |
| `hasResource(id)` | Vérifie si une ressource est déclarée dans les contraintes |
| `getOverrideWeeks(id)` | Liste les semaines où la ressource a un override explicite |
| `getAllResourceIds()` | Retourne tous les identifiants chargés |
| `getStats()` | Nombre de ressources, d'overrides, etc. |

---

### `ResourcesManager`

**Fichier :** `resourcesManager.ts`

Collection indexée de `Resource` avec accès O(1) par identifiant.  
Responsable d'appliquer les contraintes de disponibilité aux ressources qu'il gère.

| Méthode | Rôle |
|---|---|
| `addResource(r)` / `removeResource(id)` | Mutation de la collection |
| `getResource(id)` / `hasResource(id)` | Accès O(1) |
| `getAllResources()` / `getAllResourceIds()` | Itération |
| `findResources(predicate)` / `findResource(predicate)` | Filtrage |
| `applyConstraints(am)` | Applique l'`Availability` par défaut de chaque ressource |
| `applyConstraintsForWeek(week, am)` | Applique l'`Availability` propre à la semaine donnée |
| `getConstraintsStats(am)` | Statistiques de couverture des contraintes |

---

### `TasksManager`

**Fichier :** `tasksManager.ts`

Collection ordonnée de `Task`. Analogue à `ResourcesManager` mais sans indexation par Map (l'ordre d'insertion est significatif pour le planificateur).

| Méthode | Rôle |
|---|---|
| `addTask(t)` / `removeTask(id)` | Mutation de la collection |
| `getTask(id)` / `hasTask(id)` | Accès par identifiant |
| `getAllTasks()` | Copie de la liste complète |
| `getByCode(code)` / `getByType(type)` | Filtrage par code de cours ou type (CM/TD/TP) |
| `findTasks(predicate)` / `findTask(predicate)` | Filtrage générique |
| `getTaskCount()` / `isEmpty()` | Métriques |

---

### `Resource`

**Fichier :** `resource.ts`

Représente une ressource physique ou humaine : enseignant, salle ou groupe d'étudiants, identifiée par un `id` unique et un `ResourceType`.

Chaque ressource embarque une instance d'`Availability` qui encode ses créneaux horaires libres.  
La ressource est **bidirectionnellement liée** aux `Task` qui l'utilisent (via `addTask` / `getTasks`).

| Accessor | Rôle |
|---|---|
| `id`, `type`, `status` | Identité de la ressource (`status` = `PERMANENT`/`VACATAIRE` pour les enseignants) |
| `availability` (get/set) | Plages de disponibilité courantes |
| `workload` | Charge totale prévisionnelle en minutes |
| `addAvailability(s, e)` / `removeAvailability(s, e)` | Mutation des créneaux |
| `isAvailable(s, e)` | Vérifie la disponibilité d'une plage |
| `book(s, e)` | Reserve un créneau (le retire des disponibilités) |
| `intersectWith(other)` | Calcule les créneaux communs avec une autre ressource |

---

### `Task`

**Fichier :** `task.ts`

Représente un cours à planifier (CM, TD ou TP). Une tâche possède :

- Ses **métadonnées** : `code`, `name`, `type`, `duration`, `week`, `semester`, `level`
- Ses **ressources candidates** en trois catégories `TEACHER`, `ROOM`, `GROUP`, chacune structurée en groupes d'alternatives : `Resource[][]` — ex. `[[P1], [P2, P3]]` signifie P1 ET (P2 OU P3)
- Ses **ressources appliquées** (`appliedResources`) : la combinaison retenue lors du backtracking
- Son **créneaux planifiables** (`schedulable`) : intersection des `Availability` des ressources appliquées, calculé paresseusement et invalidé à chaque changement de ressources appliquées
- Sa **dépendance** (`dependsOn`) : une tâche TD dépend d'un CM de même code et mêmes groupes ; un TP dépend d'un TD

| Méthode | Rôle |
|---|---|
| `getApplicableResources()` | Produit cartésien de toutes les combinaisons possibles |
| `getRandomApplicableResources()` | Combinaison aléatoire (pour heuristiques) |
| `schedulable` | `Availability` commune à toutes les ressources appliquées |
| `isSchedulableConsistentWithResources()` | Vérifie qu'aucune ressource ne déborde hors du créneau planifiable |
| `setDependsOn(task)` | Établit la dépendance (avec détection de cycle) |
| `getDependsOn()` / `getDependentTasks()` | Navigation dans le graphe de dépendances |

---

### `Availability`

**Fichier :** `availability.ts`

Ensemble de créneaux horaires disponibles, représentés comme une **liste triée d'intervalles non-chevauchants**.  
Toutes les opérations exploitent le tri pour des performances en $O(\log n)$ ou $O(n)$.

| Méthode | Rôle |
|---|---|
| `addAvailability(s, e)` | Ajoute un créneau (avec fusion automatique si adjacent/chevauchant) |
| `removeAvailability(s, e)` | Découpe ou supprime les intervalles concernés |
| `isAvailable(s, e)` | Recherche binaire : vérifie si la plage entière est couverte |
| `findNextAvailableSlot(dur, after)` | Prochain créneau libre d'une durée donnée |
| `findAvailableSlots(minDur)` | Tous les créneaux d'une durée minimale |
| `book(s, e)` | Réserve un créneau (lève une erreur si indisponible) |
| `intersect(other)` | Algorithme à deux pointeurs : créneaux communs avec un autre `Availability` |
| `copy()` | Clone profond |
| `isFullyContainedIn(other)` | Vérifie l'inclusion dans un autre ensemble |
| `getTotalAvailableTime()` | Durée totale disponible en minutes |

**Système de timestamps :** les temps sont en **minutes écoulées depuis lundi minuit** d'une semaine type.  
Lundi = jour 0, Vendredi = jour 4. Ex. : vendredi 13h30 = $4 \times 1440 + 810 = 6570$.

---

### `TimeInterval`

**Fichier :** `availability.ts`

Intervalle de temps immuable `[start, end)`. Brique de base d'`Availability`.  
Opérations : `overlaps`, `isAdjacent`, `canMergeWith`, `merge`, `contains`, `duration`, `clone`.

---

### `TimestampUtils`

**Fichier :** `availability.ts`

Utilitaires de conversion entre timestamps (minutes depuis lundi minuit) et représentations lisibles.

| Méthode | Rôle |
|---|---|
| `toTimestamp(dayIndex, hour, minute)` | Construit un timestamp |
| `fromTimestamp(ts)` | Décompose en `{ dayIndex, hour, minute, dayName }` |
| `parseTime("HH:MM")` | Minutes depuis minuit |
| `format(ts)` | Format lisible `"Vendredi 13:30"` |

---

## Types de données

### `ResourceEntry`

```typescript
type ResourceEntry = string | string[];
```

Convention pour les champs `teacher`, `groups`, `rooms` dans `CourseTaskData`.  
Un `string` simple désigne une ressource unique. Un `string[]` désigne un groupe alternatif dont **une seule** ressource sera choisie.

**Exemple :** `["Prof A", ["Salle 101", "Salle 102"]]` = Prof A ET (Salle 101 OU Salle 102).

---

### `ResourceData` / `ResourceGroupData`

```typescript
interface ResourceData {
  id: string;
  info?: string; // JSON string, ex: '{"status":"PERMANENT"}'
}

interface ResourceGroupData {
  resourceType: 'teacher' | 'room' | 'group';
  resources: ResourceData[];
}
```

Format du fichier `resources.json`. Les trois types sont regroupés dans un tableau de `ResourceGroupData`.  
Le champ `info` est un JSON stringifié pour transporter des métadonnées arbitraires (ex. statut enseignant).

---

### `CourseTaskData` / `CoursesData`

```typescript
interface CourseTaskData {
  week: number;       // Numéro de semaine ISO
  semester: number;
  level: number;
  code: string;       // Code matière partagé par CM/TD/TP liés
  type: string;       // 'CM' | 'TD' | 'TP'
  name: string;
  duration: number;   // En minutes
  teacher: ResourceEntry[];
  groups: ResourceEntry[];
  rooms: ResourceEntry[];
}

interface CoursesData {
  weeks: number;           // Semaine de planification
  courses: CourseTaskData[];
}
```

Format du fichier `cours.json`. Le champ `code` est la clé de regroupement pour établir les dépendances CM→TD→TP.

---

### `ConstraintsData` / `ResourceConstraints` / `TimeSlot`

```typescript
interface TimeSlot {
  days: string;  // Ex: "lundi, mercredi"
  from: string;  // Ex: "08:00"
  to:   string;  // Ex: "18:00"
}

interface ResourceConstraints {
  default?: TimeSlot[];
  [weekKey: string]: TimeSlot[] | undefined; // Ex: S36, S47
}

interface ConstraintsData {
  Default?: TimeSlot[];  // Créneaux appliqués à toute ressource sans contrainte propre
  [resourceId: string]: TimeSlot[] | ResourceConstraints | undefined;
}
```

Format du fichier `contraintes.json`. Chaque entrée peut être :

| Valeur | Signification |
|---|---|
| `TimeSlot[]` | Contrainte fixe pour toutes les semaines |
| `{ default: TimeSlot[], S36: TimeSlot[], ... }` | Contrainte de base + overrides hebdomadaires |
| absent / `undefined` | Utilise la contrainte `Default` |
