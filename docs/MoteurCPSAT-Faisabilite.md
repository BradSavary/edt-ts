# Étude de faisabilité — Second moteur de planification basé sur CP-SAT (OR-Tools)

**Statut : étude de faisabilité, aucune décision d'implémentation prise.** Ce document consigne l'analyse menée pour évaluer la possibilité d'ajouter un second moteur de planification, basé sur Google OR-Tools CP-SAT, à côté de `scheduler-core`, dans deux buts :

1. Permettre à l'utilisateur (`scheduler-client`) de choisir entre les deux moteurs.
2. Disposer d'un moteur « de référence » pour comparer/valider les heuristiques MCV développées dans [`HeuristiquePriorite-Conception.md`](./HeuristiquePriorite-Conception.md).

**Verdict résumé** : faisable, mais ce n'est pas « un nouveau package qui traduit les règles existantes » — c'est un projet à part entière. Le point dur n'est pas la traduction des règles métier (assez naturelle en CP-SAT, voir §5) mais l'absence de binding Node.js officiel pour OR-Tools et l'absence totale, dans ce repo, de précédent pour intégrer un runtime non-Node (§3, §4).

---

## 1. Contexte

Le moteur actuel (`scheduler-core`) résout le problème par backtracking CSP avec une heuristique de priorité MCV (voir `HeuristiquePriorite-Conception.md`). CP-SAT est le solveur de programmation par contraintes de Google OR-Tools — une alternative construite sur des principes différents (propagation de contraintes cumulatives, edge-finding, recherche exacte avec preuve d'optimalité) plutôt que sur une heuristique de tri + backtracking artisanal. L'intérêt de l'avoir en parallèle est double : proposer un choix à l'utilisateur, et disposer d'une vérité terrain indépendante pour juger si les heuristiques de `scheduler-core` sont réellement proches de l'optimal sur des cas réels.

## 2. Architecture actuelle du monorepo (rappel factuel)

npm workspaces (`packages/*`), quatre paquets :

| Paquet | Rôle |
|---|---|
| `scheduler-common` | Types partagés, `Availability`, `Resource`, `Task`, `SchedulerConfig`, format JSON du contrat de service. Aucune dépendance. |
| `scheduler-core` | Le moteur CSP/backtracking (`Scheduler`). Dépend uniquement de `scheduler-common`. |
| `scheduler-api` | API HTTP (Express 4, ESM, exécuté via `tsx`, bundlé en CJS via esbuild pour `dist/server.cjs` + `dist/scheduler.worker.cjs`). |
| `scheduler-client` | Frontend Next.js 16 / React 19. |

**Déploiement actuel** : pas de Dockerfile, pas de CI pour `scheduler-api` (seul `scheduler-client-pr.yml` existe). D'après un commentaire dans `scheduler-client/lib/api/scheduleApi.ts`, la production fait tourner `scheduler-api` comme process Node nu, derrière un reverse-proxy Apache (`.htaccess` sur `/edtts/api/*`). Pas de conteneurs.

**Aucun précédent d'intégration d'un runtime non-Node** dans le repo : ni Python, ni WASM, ni addon natif, ni subprocess. Le mécanisme le plus proche est le système de jobs asynchrones de `scheduler-api` (`worker_threads.Worker`, toujours en Node) — voir `AsyncJobQueue.md`.

## 3. Le contrat d'interface actuel — bonne nouvelle pour ce projet

Route : `POST /api/schedule/v2` (et sa variante asynchrone `POST /api/schedule/v2/async` + `GET /api/schedule/jobs/:id`).

**Entrée** — `RawScheduleData & { options?: SchedulerConfig }` (`scheduler-common/src/types.ts`) :
```ts
interface RawScheduleData {
  week: number;
  resources: ResourceGroupData[];
  courses: CourseTaskData[];
  constraints?: ConstraintsData;
  groups?: TaskGroupDeclaration[];
}
interface SchedulerConfig {
  maxSolutions?: number; timeoutSeconds?: number; maxIterations?: number;
  maxEliminations?: number; resourceSelection?: 'random' | 'deterministic';
  lunchBreak?: LunchBreakConfig; ignoreDailyLimits?: boolean;
}
```

**Sortie** — `ScheduleSolutionJSON[]` :
```ts
interface TaskSolutionJSON {
  taskId, code, name, type, week, duration, startTime,
  resources: { id, type }[], taskGroupId?
}
interface ScheduleSolutionJSON {
  solutions: TaskSolutionJSON[];
  isComplete: boolean;
  score?: number;
  neutralizedTasks?: NeutralizedTaskInfoJSON[];
}
```

Point important : cette sortie n'est **pas** un `JSON.stringify` des objets internes du moteur. `packages/scheduler-api/src/serializeScheduler.ts` fait explicitement le pont entre les types internes (`SchedulerSolution`/`UnitSolution`, qui portent des instances de classes — `Resource[]`, `Task`, `ISchedulingUnit`) et ce format plat. **C'est exactement la frontière dont un second moteur a besoin** : consommer `RawScheduleData`/`SchedulerConfig`, produire `ScheduleSolutionJSON[]`, sans jamais exposer ses structures internes. Aucun schéma OpenAPI/JSON-Schema formel n'existe — le contrat est porté de facto par les interfaces TypeScript partagées de `scheduler-common`, importées à la fois par `scheduler-api` et `scheduler-client`.

Autre atout : le système de jobs asynchrones existant (voir `AsyncJobQueue.md`) est un point d'accroche naturel pour un sélecteur de moteur — un champ `engine: 'core' | 'cpsat'` dans la requête, routé côté serveur, ne demanderait aucun changement de contrat côté `scheduler-client` au-delà d'un contrôle d'UI.

## 4. L'obstacle principal : pas de binding Node.js officiel pour CP-SAT

Confirmé auprès de la documentation Google (developers.google.com/optimization/install, juillet 2026) : OR-Tools est écrit en C++, avec des wrappers **officiels** uniquement pour **Python, Java, .NET et Go**. Aucun binding JavaScript/Node officiel. Une demande en ce sens est ouverte depuis 2015 ([google/or-tools#94](https://github.com/google/or-tools/issues/94)) sans suite officielle à ce jour.

### 4.1 Options d'intégration envisagées

| Option | Principe | Avantages | Inconvénients |
|---|---|---|---|
| **A. Microservice Python** (`pip install ortools`, officiel) | `scheduler-api` appelle un service HTTP/gRPC séparé écrit en Python | Le plus mature, le plus documenté, celui que Google maintient réellement — le bon choix pour un rôle de **référence fiable** | Aucune infra de ce type n'existe dans le repo aujourd'hui — il faut créer un nouveau composant déployé, versionné, supervisé (premier Dockerfile / premier service non-Node du projet) |
| **B. Subprocess** (binaire C++ ou script Python invoqué via `spawn`, JSON sur stdin/stdout) | Depuis `scheduler-api`, à la manière du `worker_threads.Worker` déjà utilisé pour les jobs async | Pas de nouveau service réseau à opérer, s'insère dans le pattern async existant | Gestion de process/timeouts/isolation à réinventer ; pas de scalabilité horizontale native ; cumule une partie des inconvénients des deux autres options sans en avoir tous les avantages |
| **C. `or-tools-wasm`** (npm, WASM exécuté dans Node) | Package tiers vendorisant OR-Tools, exposé en TS : `import { CpModel, CpSolver } from 'or-tools-wasm/cp-sat'` | Zéro nouvelle infra — reste 100 % Node, packageable comme un workspace `packages/scheduler-cpsat` classique | Projet **communautaire, jeune** ([Axelwickm/or-tools-wasm](https://github.com/Axelwickm/or-tools-wasm) : 45 ★, dernière release juin 2026, pas Google) — pas la garantie de pérennité attendue d'un moteur censé servir de référence ; un bug du portage WASM fausserait précisément la comparaison recherchée |

### 4.2 Recommandation

**Option A** pour l'usage « moteur de référence » : on veut que CP-SAT soit la vérité terrain, donc autant s'appuyer sur l'implémentation que Google maintient réellement, plutôt que sur un portage tiers non officiel. **Option C** reste séduisante pour la vélocité (aucune infra à créer) si le besoin évolue vers « juste proposer un second moteur à l'utilisateur » sans exigence de fiabilité-référence aussi forte — mais elle est déconseillée pour la fonction de validation des heuristiques, l'objectif premier de ce projet. **Option B** n'est recommandée que si A s'avère trop coûteuse à opérer en pratique.

## 5. Traduire les règles : une remodélisation, pas un portage

Point important pour cadrer l'effort : on ne porte **pas** `getSchedulingPriority()` vers CP-SAT. CP-SAT n'a pas besoin d'heuristique MCV artisanale — c'est un solveur à contraintes qui fait déjà, nativement, la propagation cumulative et l'edge-finding (exactement les concepts du §4.4 de `HeuristiquePriorite-Conception.md`). Le travail de traduction porte sur les **contraintes du problème métier**, pas sur la réplique du score :

| Concept métier (`scheduler-core`) | Équivalent CP-SAT |
|---|---|
| Disponibilité d'une ressource / réservation | `NewOptionalIntervalVar` par tâche candidate + `AddNoOverlap` par ressource |
| `maxDailyMinutes` (plafond quotidien) | Contrainte cumulative standard (`AddCumulative`) par jour — plus direct que le compteur runtime actuel de `scheduler-core` |
| Groupe `parallel` | Égalité des variables de début entre membres |
| Groupe `sequential` | Contrainte de décalage fixe (`début(suivant) == fin(précédent)`) |
| Dépendances (`dependsOn`) | Contrainte linéaire de précédence entre fin du dépendant et début de l'unité |
| Pause méridienne flottante | Réservation optionnelle positionnée par le solveur lui-même — potentiellement **plus juste** que le découpage heuristique au milieu de fenêtre (§5.5 du document de conception), puisque CP-SAT peut chercher la vraie meilleure position au lieu de l'approximer |
| Criticité de ressource / demande ferme (§5.2, non implémenté côté `scheduler-core`) | Non nécessaire comme mécanisme séparé — la sursaturation est détectée nativement par la propagation `NoOverlap`/`Cumulative` |
| `solveWithElimination()` / neutralisation de tâches | Pas d'équivalent direct — à reformuler avec une variable booléenne `scheduled[t]` par tâche et un objectif de maximisation du nombre de tâches placées (formulation standard de soft-CSP), pas un portage de la boucle d'élimination actuelle |

## 6. Bénéfice indépendant de l'exposition côté client

Même sans jamais exposer le choix du moteur dans `scheduler-client`, un harnais de test qui envoie les mêmes payloads réels (THARAUD semaine 36, cas synthétique CM/TD/TP, etc.) aux deux moteurs et compare les résultats (nombre de solutions complètes, tâches neutralisées, temps de résolution) donnerait une vérité terrain pour valider les heuristiques du document de conception. C'est potentiellement plus utile à court terme que le sélecteur dans l'UI, et constitue un jalon intermédiaire naturel avant d'envisager l'intégration complète.

## 7. Effort et risques estimés

Ce n'est pas un projet de quelques jours : nouveau runtime à intégrer, remodélisation des contraintes métier (pas une transcription mécanique du code existant), infra de déploiement à créer de zéro (premier composant non-Node du repo), plus un travail de non-régression sérieux sur des payloads réels pour valider que les deux moteurs produisent des résultats cohérents. À l'échelle de plusieurs semaines, pas de quelques jours.

## 8. Prochaine étape suggérée

Avant tout engagement sur l'intégration dans `scheduler-api`/`scheduler-client` : un **spike isolé**, indépendant du reste du repo — prendre le cas CM/TD/TP (§5.6 de `HeuristiquePriorite-Conception.md`), le modéliser en CP-SAT via un service Python autonome (option A), et comparer le résultat à `scheduler-core`. Ça validerait la faisabilité de la modélisation et donnerait une mesure d'effort réaliste avant de statuer sur l'architecture d'intégration définitive (§4).

## Sources

- [Is there any plans for Javascript bindings for or-tools? · Issue #94, google/or-tools](https://github.com/google/or-tools/issues/94)
- [Install OR-Tools | Google for Developers](https://developers.google.com/optimization/install)
- [Axelwickm/or-tools-wasm](https://github.com/Axelwickm/or-tools-wasm)
