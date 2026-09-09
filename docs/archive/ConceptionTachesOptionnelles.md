# Conception — Recherche à tâches optionnelles (branch-and-bound sur les sauts)

*Document de conception rédigé par Fable, à valider par Frédéric avant tout plan d'implémentation. Branche : `feature/optional-tasks` (créée depuis `feature/backtracking`, qui contient le blâme exact et COS). Statut : PROPOSITION.*

## 1. Pourquoi ce chantier

`solveWithElimination` date du moteur approché historique (minimisation de coût sur graphe) : pour ce solveur, « je n'ai pas réussi à placer X » était un signal direct et fiable, et relancer après neutralisation de X une contre-mesure raisonnable. Avec le backtracking exact, ce mécanisme est devenu structurellement inadapté, et le chantier blâme/COS l'a démontré empiriquement :

- **Quatre interactions non-monotones documentées** (slotAware+dailyLimitAware ; COS sur instantané périmé ; COS seul vs blâme approximatif ; blâme exact × COS), toutes causées par le même maillon : un **choix gourmand irréversible** de la tâche à neutraliser, décidé sur des statistiques d'exploration, suivi d'un redémarrage complet.
- La preuve la plus nette (2026-07-17) : même un signal de blâme **parfait** (coupable minimal prouvé contrefactuellement 280 fois) conduit à une moins bonne issue globale que le vieux scan bruité — parce que « le coupable minimal le plus fréquent » n'est pas la bonne question. La bonne question est : *quel ensemble minimal de tâches faut-il sauter pour placer tout le reste ?* — et c'est une question de **recherche**, pas de comptage.
- Sous pression de budget, l'issue actuelle est une loterie (wall-clock ou point de troncature) parce que chaque round joue son va-tout sur un seul choix gourmand.

**Objectif** : remplacer (en coexistence, pas en substitution) le couple `solve()`/`solveWithElimination()` par **une seule recherche** qui maximise le nombre de tâches placées, où « sauter une tâche » est une décision de branchement révisable, explorée et bornée comme les autres.

**Cadrage métier (validé par Frédéric, 2026-07-17)** : la seule solution acceptable *in fine* est une solution **100%**. Une instance sans solution 100% signifie que des contraintes doivent être relâchées (élargir une disponibilité, changer une salle, subdiviser un cours…) jusqu'à ce que le 100% devienne atteignable. Le résultat partiel du moteur n'est donc **jamais une solution finale** : c'est le **diagnostic** qui pilote la boucle de réparation humaine (résoudre → lire les tâches non plaçables et leurs causes → relâcher → relancer). Formellement, c'est la dualité classique *maximal satisfiable subset* / *minimal correction set* : « placer le maximum » et « identifier le minimum à relâcher » sont le même calcul. Ce cadrage a deux conséquences directes : (a) le diagnostic doit être **minimal et si possible prouvé** — chaque tâche sautée en trop, c'est du travail de relaxation humain gaspillé ou mal dirigé (le gourmand actuel en produit régulièrement, cf. la loterie documentée) ; (b) **l'explication des sauts est un livrable de premier rang**, pas un bonus (§3.5).

## 2. Formulation et ancrage littérature

Le problème réel est un **MaxCSP** / ordonnancement sursouscrit : les semaines dures (ex. 40 : DUBOIS, 4×90 min dans 3 fenêtres de 2h) n'ont pas de solution complète, et l'objectif effectif de l'utilisateur est « placer le maximum de cours ».

- **Partial Constraint Satisfaction** (Freuder & Wallace, *Artificial Intelligence* 58, 1992) : le cadre fondateur — recherche par branch-and-bound sur le nombre de violations, avec borne = meilleure solution connue.
- **Tâches optionnelles** (Laborie & Rogerie, intervalles optionnels de CP Optimizer ; `OptionalIntervalVar` d'OR-Tools CP-SAT) : la formulation standard moderne — chaque tâche porte une variable de présence, l'objectif maximise les présences. Notre équivalent : une branche « sauter » par unité.
- **Théorie du diagnostic** (Reiter, 1987) : l'ensemble optimal de tâches à sauter est un *hitting set* minimal des conflits — ce que le gourmand actuel approxime en un coup ; le B&B l'explore systématiquement.
- Comportement **anytime** : standard dans les solveurs d'optimisation — toute descente complète produit une solution valide (incumbent) ; le budget épuisé, on rend la meilleure trouvée. Fini le « round brûlé sans rien rendre ».

## 3. Algorithme

### 3.1 Principe

DFS branch-and-bound greffé sur le backtracking chronologique existant. À chaque nœud, l'unité courante (choisie par le tri MCV/COS inchangé) est traitée ainsi :

1. **Branches de placement** : exactement la boucle actuelle (`earlySchedule` + filtres pause/quota, créneaux successifs par pas de 30 min).
2. **Branche de saut, en dernier recours** : quand tous les placements sont épuisés (là où `_backtrack` retourne `false` aujourd'hui), si la borne l'autorise, marquer l'unité « sautée » (coût +1, avec cascade — §3.3) et **continuer la descente** au lieu de remonter.

Feuille atteinte (toutes les unités placées ou sautées) = solution de coût `k` = nombre de sauts. Si `k < meilleurCoût`, elle devient l'incumbent ; la recherche continue (remontée normale) pour trouver mieux, jusqu'à budget épuisé ou optimalité prouvée (arbre épuisé).

### 3.2 Borne et élagage

- `coûtCourant + 1 > meilleurCoût − 1` ⟹ la branche de saut est interdite (élagage). V1 : borne triviale (pas de lower bound calculé) — suffisante pour commencer, le premier incumbent arrive vite et serre immédiatement la borne.
- Borne initiale : `maxEliminations` garde sa sémantique utilisateur actuelle — nombre maximal de sauts autorisés (borne = `maxEliminations + 1` avant le premier incumbent).
- Extension V2 (notée, non implémentée) : **lower bound par cliques infaisables**. Recette concrète issue du cas DUBOIS (semaine 40, analysé le 2026-07-17) : pour chaque ressource unaire (enseignant), compter combien de tâches tiennent réellement dans ses fenêtres — raisonnement **bin-packing / ensembles de Hall**, pas énergétique : DUBOIS a 4×90 min de demande pour 3×120 min de capacité, l'énergie dit « ça rentre » (360 = 360) mais chaque fenêtre de 120 min n'accueille qu'une tâche de 90 min ⟹ 3 max ⟹ **LB ≥ 1 saut, déductible à la racine sans une itération de recherche**. Élague toute branche prétendant à 0 saut et accélère la preuve d'optimalité. Le cas DUBOIS servira de test de référence. Le MCV ne peut pas voir cela (mesure par tâche, aucune agrégation inter-tâches) — c'est précisément le niveau de raisonnement « propagation » identifié comme la vraie distance à l'état de l'art dans `docs/AuditConformiteMCV.md`.

### 3.3 Sémantique des sauts

- **Unités enforced : jamais sautables** (comme aujourd'hui : jamais éliminables).
- **Cascade de dépendants** : sauter une unité saute aussi ses dépendants transitifs non-enforced — reprise exacte de la sémantique de `_collectDependents` (fix `041058f`). Le coût d'un saut = taille de la chaîne (sauter un CM avec 2 dépendants coûte 3) — la borne en tient compte, ce qui oriente naturellement la recherche vers le saut des feuilles plutôt que des racines de dépendance.
- **Pré-neutralisées (Autonomie)** : hors moteur, comme aujourd'hui.
- Une unité sautée reste sautée *dans cette branche* ; à la remontée, le saut est défait comme n'importe quelle décision (c'est toute la différence avec l'élimination irréversible actuelle).

### 3.4 Propriétés

- **Complétude/optimalité** : arbre fini ⟹ si le budget le permet, l'algorithme *prouve* l'optimum (ex. : « 1 saut est impossible sur la semaine 40, 2 est optimal » — question aujourd'hui sans réponse, le gourmand ne pouvant jamais prouver quoi que ce soit).

### 3.5 Diagnostic et explications (livrable de premier rang — cadrage métier §1)

Chaque tâche sautée de l'incumbent final doit porter un **pourquoi actionnable au niveau des contraintes**, pas seulement son identité :

- **Explication locale** : l'ensemble minimal de conflit de sa dernière impasse (le mécanisme `_computeExactConflictSet` livré en `d4dcc09` — c'est ici que le blâme exact trouve son vrai rôle) : « ne tient pas car X, Y occupent ses seuls créneaux compatibles ».
- **Explication structurelle** quand elle existe : le déficit de clique (§3.2) — « DUBOIS : 4 cours de 90 min, 3 fenêtres exploitables ⟹ il manque structurellement une fenêtre » — directement traduisible en action de relaxation par l'utilisateur.
- Support de sérialisation : `NeutralizedTaskInfoJSON` possède déjà `reason`, `requiredMinutes`/`schedulableMinutes` et `resourceSnapshots` — l'enrichissement se fait dans le format existant, le client affiche sans refonte.

V1 livre au minimum l'explication locale dans `reason` ; l'explication structurelle arrive avec la LB par cliques (V2) qui la calcule de toute façon.
- **Anytime** : la première descente (placements d'abord, sauts en dernier recours) équivaut grosso modo à la qualité du gourmand actuel, obtenue en une fraction du budget ; tout le reste du budget sert à l'améliorer au lieu de re-résoudre from scratch.
- **Déterminisme** : borné en itérations (leçon de session), timeout wall-clock en garde-fou seulement.
- MCV, COS, blâme exact, filtres : inchangés. Le blâme (`_failureCounts`) n'a **plus aucun rôle décisionnel** — il redevient ce qu'il aurait toujours dû être : de l'information (diagnostic utilisateur, tri d'affichage). V2 possible : utiliser le MUS d'une impasse pour ordonner les branches à la remontée (« conflict-directed skip ») — à n'envisager que si la V1 montre des manques mesurés.

## 4. Architecture logicielle

Motif éprouvé du chantier backjumping — **coexistence par classe sœur, code du driver séparé** :

- **`OptionalTasksScheduler extends Scheduler`** (nouveau fichier `optionalTasksScheduler.ts`) : ne redéfinit que le driver de recherche (`solveWithElimination()` surchargée pour lancer le B&B — même point d'entrée public, même type de retour `SchedulerSolution[]`, le reste de l'app ne voit pas la différence). Réutilise par héritage : `initSolver`, `earlySchedule`/`book`/`unBook` des unités, filtres, `_dynamicSort` (MCV+COS), `_computeExactConflictSet`, `_collectDependents`.
- **Sélection** : `SchedulerConfig.searchStrategy?: 'elimination' | 'maxPlacement'` (défaut `'elimination'` — comportement historique intact) + fabrique `createScheduler(config)` câblée dans les deux points d'entrée API (`scheduleController.ts`, `scheduler.worker.ts`). Motif identique au `algorithm` de la branche backjumping.
- **Résultat** : `neutralizedUnits` = les sautées de l'incumbent final, `reason` = « ne peut pas tenir sous les contraintes actuelles (k sauts au total, optimum prouvé/non prouvé) : [explication §3.5] — relâchement nécessaire pour atteindre 100% », `isComplete` = (k = 0). Le client existant affiche ça sans modification. Conséquence du cadrage métier (§1) : le libellé ne présente jamais le partiel comme une solution finale, toujours comme un maximum-sous-contraintes assorti d'un diagnostic.
- **UI** : sélecteur de stratégie dans `SchedulerConfigDialog` (dernière étape, après validation moteur).

Pourquoi ce point de coexistence est non négociable : tout l'historique du chantier montre qu'on ne valide rien sans A/B sur le projet réel, mêmes données, même process. L'app continue de tourner sur le moteur éprouvé pendant toute la maturation.

## 5. Risques et limites assumées

1. **Explosion combinatoire** : l'espace des sous-ensembles de sauts est exponentiel. Mitigations : borne (élagage dès le premier incumbent), budget d'itérations, anytime (on a toujours un résultat), et l'ordre des branches (placements d'abord, MCV en tête) qui met les bonnes solutions tôt dans l'arbre. Le moteur actuel explose déjà (rounds à 1M d'itérations) — la différence est qu'ici l'explosion dégrade la *preuve d'optimalité*, pas le résultat rendu.
2. **L'ordre des branches devient le facteur dominant sous budget** — c'est le pendant B&B des sensibilités déjà connues du moteur. Le protocole de validation doit donc comparer à budgets multiples, pas à un point unique.
3. **Double driver à maintenir** (accepté explicitement au chantier backjumping : la séparation du code protège le moteur éprouvé).
4. **Sémantique client** : `isComplete`/`neutralizedTasks` conservent leur forme ; seul le `reason` change. À vérifier dans la passe UI.

## 6. Protocole de validation (avant tout câblage API/UI)

- **Ré-exporter le projet réel avant la campagne** (leçon : un instantané se périme).
- A/B même process, semaines 37/38/39/40 (pipeline weekSaves complet pour 38/39), budgets **1000 / 3000 / 10000 / 30000** itérations, `timeoutSeconds` haut (garde-fou), pause flottante standard.
- Référence : moteur actuel dans sa meilleure config connue (**COS on, blâme exact off**) ET en config par défaut.
- Métriques : nombre de placements, itérations/temps jusqu'au premier incumbent, courbe qualité-vs-budget, optimalité prouvée (oui/non), identité des sautées (validation qualitative par Frédéric).
- **Critères** : jamais moins de placements que la référence à budget égal sur 37-39 (semaines faciles : doit trouver 0 saut immédiatement) ; sur la 40, objectif ≥ 105 placées de façon *robuste au budget* (la référence n'y arrive qu'avec COS et de la chance de troncature), et réponse à la question ouverte « 106/107 est-il faisable ? ». Tout écart dégradé = STOP et analyse avant d'aller plus loin.

## 7. Phasage proposé

- **P1 — prototype moteur** : `OptionalTasksScheduler` + B&B V1 (borne triviale, saut à l'impasse, cascade dépendants) + **explication locale des sauts** (§3.5, via `_computeExactConflictSet`) + tests unitaires + validation §6. Livré par plan d'implémentation pour Sonnet, comme d'habitude.
- **P2 — si P1 montre des manques** : améliorations d'ordre de branchement (conflict-directed skip via MUS, lower bounds par cliques). Uniquement sur mesures, pas préventivement.
- **P3 — câblage produit** : `searchStrategy` dans l'API + worker + sélecteur UI + doc utilisateur.

## 8. Questions ouvertes pour Frédéric (à trancher avant P1)

1. **Objectif pondéré ?** V1 = maximiser le *nombre* de tâches placées (toutes égales). Le cadrage métier (§1) donne à la pondération future sa sémantique naturelle : la **réparabilité** — sauter une tâche dont la contrainte est facilement négociable (ex. élargir la fenêtre d'un vacataire) « coûte » moins, en travail de relaxation humain, que sauter une tâche dont rien n'est négociable. Nécessiterait un signal métier (quelles contraintes sont négociables) qui n'existe pas encore dans le modèle — V1 reste au compte simple, la cascade de coût (§3.3) donnant déjà un effet proche.
2. **Devenir de `solveWithElimination`** : conservé indéfiniment comme stratégie par défaut, ou déprécié au profit de `maxPlacement` une fois la validation acquise ? (Ma préférence : décider après P1, sur chiffres.)
3. **Résultats intermédiaires** (anytime jusque dans l'UI — la barre de progression montrant l'incumbent courant) : hors périmètre P1-P3, à noter pour plus tard ?
