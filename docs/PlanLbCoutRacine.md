# Plan LB-Coût-Racine — ramener le coût de la borne inférieure racine à l'échelle de la recherche

*Plan rédigé par Opus pour implémentation par Sonnet. Branche : **`feature/lb-warmstart`** (déjà créée depuis `feature/p2-preuve` — ne PAS travailler sur `master` ni sur `feature/p2-preuve` ; le merge sera décidé par Frédéric après validation).*

**Déroulé imposé (règle de Frédéric)** : Sonnet implémente §2 + §3 (code complet, typecheck clean, suites existantes vertes), commit sur la branche, puis **S'ARRÊTE et demande le feu vert de Frédéric avant d'écrire les tests (§4) et de lancer la validation réelle (§5)**.

**Stratégie de merge actée par Frédéric (2026-07-19)** : `feature/p2-preuve` n'est PAS mergée dans `master` et ne le sera pas séparément — le correctif est appliqué d'abord, puis **l'ensemble est mergé en bloc** (P2-preuve + LB-coût-racine). Conséquence pour l'exécution : ne merger ni `feature/p2-preuve` ni `feature/lb-warmstart` à aucune étape de ce plan ; la livraison s'arrête à la branche validée. La régression de coût décrite en §0 n'a donc jamais atteint `master`.

## 0. Constat — la régression et ses mesures

P2-preuve (`0622df8`, `9b0bc82`, `37862dd`) livre une borne racine correcte, mais son coût de calcul est sans commune mesure avec la recherche qu'elle sert. Le plan P2-preuve l'avait noté comme « écart non bloquant » (§9 de son STATUT, 13,4 s sur S37) ; la mesure sur l'ensemble du projet réel montre que c'est bloquant.

**Mesure de référence** (export du 16/07, config Frédéric : `maxPlacement`, maxSolutions 1, maxEliminations 3, COS on, 10 s, 1 M itérations, pause flottante 90 min 12:00–14:00). Temps du calcul de la LB **seule**, et borne obtenue selon `clusterNodeLimit` :

| Semaine | 6M (défaut livré) | 1M | 200k | 50k |
|---|---|---|---|---|
| S3 (34)   | lb=7 · 4 ms       | lb=7 · 2 ms     | lb=7 · 1 ms     | lb=7 · 1 ms |
| S9 (29)   | lb=7 · 1 ms       | lb=7 · 1 ms     | lb=7 · 1 ms     | lb=7 · 1 ms |
| S36 (95)  | lb=6 · **24 483 ms** | lb=6 · 5 412 ms | lb=6 · 1 036 ms | lb=6 · 247 ms |
| S37 (97)  | lb=3 · **13 400 ms** | —             | lb=3 · 738 ms   | — |
| S38 (110) | lb=0 · 48 ms      | lb=0 · 43 ms    | lb=0 · 47 ms    | lb=0 · 44 ms |
| S39 (106) | lb=0 · 10 ms      | lb=0 · 8 ms     | lb=0 · 9 ms     | lb=0 · 8 ms |
| S40 (107) | lb=1 · 66 ms      | lb=1 · 67 ms    | lb=1 · 67 ms    | lb=1 · 69 ms |
| S45 (94)  | lb=0 · **13 935 ms** | lb=0 · 2 281 ms | lb=0 · 458 ms   | lb=0 · 117 ms |
| S48 (124) | lb=5 · **30 114 ms** | lb=5 · 5 911 ms | lb=5 · 1 171 ms | lb=5 · 298 ms |
| S49 (121) | lb=4 · **1 913 529 ms** | lb=4 · 2 045 295 ms | lb=4 · 2 278 ms | lb=4 · 574 ms |

**Faits qui pilotent ce plan :**

1. **Les 10 bornes sont identiques à tous les budgets.** Le budget de 6M n'a produit **aucune** borne supplémentaire nulle part, et coûte jusqu'à 32 minutes (S49). Sur S37, la recherche complète prend 0,4 s pour 13,4 s de borne : ×35.
2. **Le coût est dans les clusters, pas dans le mono.** Profilage S37 : mono = 5 ms cumulés (45 DFS), clusters = 13 540 ms (7 DFS). Le certificat qui **porte** la borne, `{BUT3-G1+G2+G3}`, converge en **31 nœuds / 0 ms** ; `{BUT1×4}` brûle 12,3 s pour saturer, être déclaré `exact=false` et **être jeté** (le cluster n'a pas de repli de comptage, contrairement au mono).
3. **Le nœud n'est pas une unité de coût constante.** S49 est plus lent à 1M (2 045 s) qu'à 6M (1 913 s). Cause suspectée, à confirmer en §3.4 : `stateKey` reconstruit une chaîne de |ressources|×5 entrées à **chaque nœud** et `seenState` croît sans borne ⟹ allocation + GC dominent. **Un seuil de nœuds ne borne donc pas le temps** : c'est l'argument central en faveur d'une deadline.
4. **Il n'existe aucun régime intermédiaire.** Soit un certificat est atteignable et le DFS le trouve quasi instantanément, soit il sature et son travail est perdu par construction. Aucun budget entre 50k et 6M n'a jamais révélé une borne que 50k ne donnait pas déjà.

**Warm start (idée de Frédéric), mesuré séparément** — amorcer chaque DFS avec le packing réalisable de la passe gourmande :

| | sans WS (6M) | avec WS (6M) | réf. 200k sans WS |
|---|---|---|---|
| S37 (gourmand OK, 3 sauts) | 13 400 ms | **4 ms** (×3350) | 738 ms |
| S45 (gourmand complet)     | 13 935 ms | **4 ms** | 432 ms |
| S48 (gourmand OK à cap=15) | 30 011 ms | 30 583 ms (**0 %**) | 1 180 ms |
| S49 (gourmand OK à cap=10) | 365 430 ms | 33 473 ms (**×11**) | 1 150 ms |

10 lb sur 10 inchangées. Le warm start accélère la *découverte* d'un bon packing, jamais la *preuve* de son optimalité : quand la borne primale est serrée il supprime tout le travail (S37), quand elle est lâche il ne supprime rien (S48). **Rendement entre 0 % et ×11 selon les données ⟹ il ne peut pas être le garde-fou**, mais il est gratuit et sûr, donc on le garde.

## 1. Principe de sûreté — inchangé, et un second sens à connaître

Le principe cardinal de `rootLowerBound.ts` reste : **`MaxPack` doit être SURESTIMÉ**, toute approximation va dans le sens « plus de tâches plaçables qu'en réalité ». Un repli sur dépassement retombe sur la borne de comptage (mono) ou abandonne le certificat (cluster), **jamais** sur le meilleur packing partiel.

Le warm start introduit un second sens, à documenter dans le code : `lb = |S| − best`, donc **surestimer `best` est sûr** (borne plus faible, jamais fausse). Un `bestInit` issu d'un packing réalisable est donc sans risque de correction — mais un `bestInit` fantaisiste **détruit silencieusement la borne**. Vérifié en session : en déduisant les tâches placées *par complémentaire des neutralisées* sur des semaines où le gourmand ne place rien, lb tombait de 7 à 3 sur S3/S9 et de 5 à 1 sur S48. Aucune preuve fausse n'a été produite, mais la borne était perdue. **D'où la règle §3.2 : les tâches placées se LISENT dans `solutions`, elles ne se déduisent jamais.**

## 2. Volet A — coût du DFS cluster (le correctif de la régression)

### 2.1 Défaut `clusterNodeLimit` : 6M → 200k
`DEFAULT_CLUSTER_NODE_LIMIT = 200_000`. Justifié par le tableau §0 : bornes identiques sur 10 semaines, pire cas 1,3 s au lieu de 32 min. `DEFAULT_MONO_NODE_LIMIT` **inchangé** (4M) — le mono coûte 5 ms cumulés, il n'y a rien à y gagner et le toucher risquerait une borne.

### 2.2 Deadline en millisecondes
Nouveau champ `deadlineMs?: number` dans `RootLowerBoundConfig`, **défaut 2000**, partagé par l'ensemble du calcul (mono puis clusters, un seul budget global, pas un par certificat).

- Échéance capturée une fois en entrée de `computeRootLowerBound` (`const deadline = Date.now() + (config.deadlineMs ?? 2000)`), passée aux deux DFS.
- Contrôle **tous les 4096 nœuds** (`if ((nodes & 0xFFF) === 0 && Date.now() > deadline)`) — surtout pas à chaque nœud, `Date.now()` coûterait plus cher que l'exploration.
- Dépassement ⟹ **exactement le même chemin que le dépassement de nœuds** : `exact = false`, puis repli comptage (mono) / abandon du certificat (cluster). Aucun nouveau chemin de sortie, aucun risque de borne non prouvée.

C'est le garde-fou : il borne le pire cas indépendamment de la machine et du projet, là où un seuil de nœuds ne le fait pas (§0 fait 3).

### 2.3 Petits clusters d'abord
Trier `candidateClusters` par `|S|` croissant avant la boucle d'évaluation. Sur S37 : `{BUT1-G1+G2}` est exact en 23 ms quand `{BUT1×4}` sature à 415 ms. Sous deadline, l'ordre actuel (promo entière d'abord) risque de consommer le budget sur les clusters condamnés et de perdre les certificats faciles ; l'ordre croissant garantit l'inverse. Sans deadline, l'ordre est neutre sur le résultat — la sélection disjointe §1.4 reste inchangée.

## 3. Volet B — ne pas payer la borne quand elle ne sert à rien

### 3.1 Calcul paresseux
Déplacer l'appel de `computeRootLowerBound` **après** la passe gourmande dans `solveWithElimination()`, et le **sauter entièrement si `greedyCost === 0`** : le court-circuit `greedyCost <= lb` est alors vrai quel que soit lb (lb ≥ 0 toujours). Dans ce cas, laisser `_rootBound = { lb: 0, certificates: [] }`.

**Vérifié en session, ne pas ré-instruire** : le déplacement est sûr. (a) La passe gourmande ne réduit pas le problème — `Loader.tasksManager.getAllUnits()` rend le même nombre de tâches avant et après (97→97 sur S37, 107→107 sur S40, 124→124 sur S48) : les éliminations opèrent sur `_units` du scheduler, pas sur le `TasksManager`. (b) Le double `bookEnforced()` que le commentaire actuel invoque pour justifier la position *avant* le gourmand n'affecte pas le résultat : `subtractIntervals` est idempotent, retirer un intervalle déjà absent ne change rien. lb mesuré identique avant/après sur S37, S40, S48. Le commentaire en place ne parlait que d'un log bruyant — remplacer ce commentaire par la justification du nouvel ordre.

Conséquence côté client à vérifier : `rootBound.lb = 0` sans certificats ne doit pas produire de message de preuve structurelle. `buildScheduleStatus` teste déjà `best.rootBound.lb > 0`, donc rien à changer — le confirmer, pas le modifier.

### 3.2 Warm start
`skippedTaskIds?: ReadonlySet<string>` dans `RootLowerBoundConfig` — **déjà implémenté sur la branche** (non commité) : `bestInit` dans `maxPackMono`, `best` initial dans le DFS cluster, justification de sûreté en docstring. Reste à le **câbler** dans `OptionalTasksScheduler`.

Construction de l'ensemble, à faire **exactement ainsi** :

1. `placedTaskIds` = tâches lues dans `greedyRaw.solutions` : pour chaque `UnitSolution`, `us.task?.id` s'il est défini (membre d'un `TaskGroupUnit`), sinon les `id` de `us.unit.getMemberTasks()`.
2. Y ajouter les tâches **enforced** (placées de fait, absentes de `solutions`) — sinon `bestInit` est sous-estimé et la borne s'affaiblit sans raison.
3. `skippedTaskIds` = toutes les tâches du Loader **moins** `placedTaskIds`.

**Aucune garde de type `gourmandOK` n'est nécessaire** : `bestInit = |S ∩ placed|` est réalisable par construction quel que soit l'état du gourmand. Si le gourmand n'a rien placé, `bestInit = 0` et le warm start est simplement neutre. C'est plus simple et plus robuste que la garde utilisée pendant la session de mesure.

Le warm start impose l'ordre de §3.1 (il a besoin du résultat gourmand) : les deux volets se posent ensemble.

### 3.3 Ce qu'il ne faut PAS faire
Ne pas amorcer `bestInit` par complémentaire des `neutralizedUnits` (§1). Ne pas utiliser `best` quand `exact === false`. Ne pas étendre le warm start aux nœuds internes du B&B (hors périmètre, §6).

### 3.4 Mémoïsation — investigation bornée, pas un engagement
Confirmer ou infirmer l'hypothèse §0 fait 3 (coût dominé par la construction de `stateKey` et la croissance de `seenState`). **Time-box : une mesure, pas une réécriture.** Si elle se confirme et qu'une clé numérique bon marché (ou un plafond sur la taille de `seenState`) rend le DFS exact ET rapide, le signaler à Frédéric comme chantier séparé — **ne pas l'implémenter dans ce plan**. Les volets A et B suffisent à corriger la régression ; réécrire la mémoïsation touche à l'exactitude du DFS et mérite son propre cycle.

## 4. Tests — resserrés (NE PAS commencer sans le feu vert, cf. déroulé)

3 tests, pas plus. Les 4 tests P2-preuve existants doivent rester verts sans modification : c'est eux qui protègent la correction de la borne.

1. **Deadline ⟹ repli sûr** : `deadlineMs` très bas sur un scénario à certificat connu ⟹ `lb` ≤ lb de référence (jamais supérieur), aucune exception. Assertion sur l'inégalité, pas sur une valeur exacte (le repli dépend du timing).
2. **Warm start neutre sur la borne** : même scénario avec et sans `skippedTaskIds` ⟹ `lb` **identique**. Réutiliser le pigeonhole DUBOIS existant.
3. **Paresseux** : instance faisable (`greedyCost === 0`) ⟹ `rootBound.lb === 0`, `certificates` vide, et **la LB n'a pas été calculée** (vérifier via un `deadlineMs: 0` qui, s'il était atteint, produirait un repli observable — ou par un compteur d'appels ; choisir le plus simple sans exposer d'API de test).

## 5. Validation réelle — un seul batch, une seule lecture

Export du 16/07 si le projet est inchangé, **sinon re-exporter** (les snapshots se périment). Config Frédéric §0. Script batch unique en arrière-plan, une ligne par semaine, lecture du log à la fin — **pas d'analyse entre les runs**.

**Bornes attendues, toute différence = STOP :**

| S3 | S9 | S36 | S37 | S38 | S39 | S40 | S45 | S48 | S49 |
|---|---|---|---|---|---|---|---|---|---|
| 7 | 7 | 6 | 3 | 0 | 0 | 1 | 0 | 5 | 4 |

- **STOP immédiat si une lb DÉPASSE ces valeurs** : bug de sûreté (borne surestimée ⟹ fausse preuve d'optimalité).
- Une lb **inférieure** n'est pas un crash mais un échec du plan : la deadline ou le seuil coupe trop tôt. Reporter, ne pas « ajuster jusqu'à ce que ça passe ».
- **Placements inchangés** : S37 94/97, S38 110/110, S39 106/106, S40 105/107. Une borne ne place rien — toute différence est un bug.
- **Objectif de coût** : LB < 2 s par semaine (deadline oblige), et S37 attendu à quelques ms grâce au warm start.

## 6. Hors périmètre

- Réécriture de la mémoïsation du DFS (§3.4 : mesure seulement).
- LB aux nœuds internes du B&B, et warm start à ces nœuds.
- Le comportement du gourmand qui ne place **rien** (`placees=0`, 1 itération) sur S3, S9, S36, S40, S48@cap≤10 — constaté en session, réel, mais c'est un sujet du moteur d'élimination, pas de la borne. À remonter séparément à Frédéric.
- Toute modification de `DEFAULT_MONO_NODE_LIMIT`.
- UI riche des certificats.

## 7. Definition of done

- [ ] Branche `feature/lb-warmstart` (créée)
- [ ] §2.1 `clusterNodeLimit` 200k, `monoNodeLimit` inchangé
- [ ] §2.2 deadline partagée, contrôle tous les 4096 nœuds, repli via le chemin existant
- [ ] §2.3 clusters triés par |S| croissant
- [ ] §3.1 calcul paresseux (après le gourmand, sauté si `greedyCost === 0`), commentaire justificatif remplacé
- [ ] §3.2 warm start câblé (tâches LUES dans `solutions` + enforced, sans garde)
- [ ] §3.4 mesure mémoïsation, reportée à Frédéric, non implémentée
- [ ] Typecheck monorepo clean + 109/109 scheduler-core + suites client vertes
- [ ] **CHECKPOINT : commit 1, feu vert de Frédéric demandé et obtenu**
- [ ] 3 tests §4 verts, 4 tests P2-preuve inchangés et verts
- [ ] Validation §5 : 10 semaines conformes, zéro STOP
- [ ] Scripts jetables supprimés : `packages/scheduler-client/examples/*-tmp.mts`
- [ ] STATUT rédigé en tête de ce plan, commit 2
