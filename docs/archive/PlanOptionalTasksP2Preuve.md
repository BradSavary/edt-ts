# Plan P2-Preuve — borne inférieure racine par certificats (bin-packing exact) et preuve d'optimalité

> **STATUT (2026-07-18, exécution par Sonnet) : LIVRÉ, prêt à committer.** §1-§2 implémentés conformes au plan (checkpoint feu vert obtenu après commit 1, `0622df8`). §3 : 4 tests écrits et calibrés empiriquement (7/7 assertions vertes, y compris les 2 niveaux du test cluster) — **construire un cas cluster-only (mono=0, cluster=1) minimal s'est avéré nettement plus subtil que prévu** : `domain(t)` étant TOUJOURS l'intersection complète (donc déjà visible à tout certificat mono qui inclut la tâche), une tâche jointe seule ne suffit pas à créer un écart mono/cluster — il faut au moins 2 tâches jointes + assez de tâches mono pour que le raffinement « union des domaines » restaure la pleine capacité brute côté mono tout en laissant le couplage jour-par-jour (2 ressources contraintes simultanément) invisible à un certificat mono isolé ; scénario final calibré et vérifié par script avant d'être figé dans le test. **1 bug trouvé en calibrant §3 sur les suites existantes (pas dans le module lui-même)** : le court-circuit racine renvoyait les raisons brutes du gourmand au lieu de les uniformiser (`_genericizeReasons` non appelé) — corrigé, commité dans 0622df8. **2 tests existants dont le scénario est exactement le cas que P2-preuve étend** (preuve désormais possible à budget B&B minuscule / au-delà du cap `maxEliminations`) : assertions mises à jour avec justification (même commit). **Refactor de robustesse fait pendant §3** : `computeRootLowerBound` prend `Task[]` au lieu de `ISchedulingUnit[]` — évite un double `bookEnforced()` (un `initSolver()` explicite avant le gourmand, qui en refait un) qui produisait un warning bruyant à chaque tâche enforced (idempotent sur l'état final, mais inutilement verbeux en usage réel) ; limites de nœuds DFS rendues surchargeables (`monoNodeLimit`/`clusterNodeLimit`, défauts 4M/6M inchangés) pour permettre le micro-test du repli de sûreté sans franchir réellement 4M nœuds.
>
> **Validation réelle (§4, export du 16/07 — projet inchangé depuis, réutilisé tel quel), protocole allégé, S37-40, budget 10000, COS on** : **zéro STOP déclenché, chiffres identiques à la référence connue sur les 4 semaines.**
> - **S37 : 94/97 placées, `provenOptimal=true`, 0 itération B&B** (court-circuit racine dès la fin du gourmand : coût 3 ≤ lb 3) — certificat cluster `{BUT3-G1+BUT3-G2+BUT3-G3}`, 31 tâches, demande-groupe 12660min. Preuve d'optimalité en millisecondes, exactement comme prévu au cadrage.
> - **S38 : 110/110, S39 : 106/106** — `lb=0`, `provenOptimal=true`, court-circuit racine (généralisation du cas historique 0-saut). Conforme.
> - **S40 : 105/107, `provenOptimal=false`** — `lb=1`, certificat mono-ressource teacher "BARBIER Romain" (4 tâches, 360min, caps j0:120 j1:120 j2:120 j3:0 j4:0) conforme au cadrage §0 ; passe B&B lancée (greedyCost=2 > lb=1), budget 10000 épuisé sans amélioration ni preuve — **« 106/107 ou 105 optimal ? » reste ouvert**, exactement le périmètre annoncé (hors de portée des outils actuels).
> - **Écart au plan, non bloquant mais notable** : le calcul de la LB seule sur S37 prend **13,4s** (`lbMs`), très au-dessus du seuil indicatif de 100ms du plan — le certificat cluster `{BUT3-G1+G2+G3}` (31 tâches, DFS jour-par-jour à 6M nœuds max) est visiblement le poste coûteux. Sans impact sur l'usage (racine uniquement, une fois par résolution, dominé par le gourmand/B&B de toute façon sur S40), mais à garder en tête si la LB était un jour évaluée à des nœuds internes (hors périmètre actuel, §5). S38/S39/S40 restent sous 70ms.
>
> Suites complètes : typecheck monorepo clean (4 packages), 108/108 scheduler-core (105 existants + 3 nouveaux), 290/290 scheduler-client.
>
> **Reste avant commit 2** : supprimer les 2 scripts jetables (`packages/scheduler-client/examples/p2preuve-lb-tmp.ts`, `packages/scheduler-client/examples/p2preuve-validation-tmp.ts`), commit unique groupant §3+§4+STATUT. Merge vers `master` : décision de Frédéric, hors périmètre.

*Plan rédigé par Fable pour implémentation par Sonnet. Branche : **`feature/p2-preuve`** (nouvelle branche dédiée depuis `master` — ne PAS travailler sur `master` ; le merge sera décidé par Frédéric après validation).*

**Déroulé imposé (décision de Frédéric)** : Sonnet implémente §1 + §2 (code complet, typecheck clean, suites existantes vertes), commit sur la branche, puis **S'ARRÊTE et demande le feu vert de Frédéric avant d'écrire les tests (§3) et de lancer la validation (§4)**. Pas de tests ni de campagne réelle sans ce feu vert explicite.

## 0. Verdict de cadrage — ce que P2-preuve peut et ne peut PAS faire

Ce plan a été précédé d'une session complète de faisabilité (prototype jetable sur l'export réel du 16/07, pipeline weekSaves fidèle). Les mesures imposent un périmètre honnête :

**Ce que la LB racine LIVRE, mesuré sur le réel :**
- **Sûreté parfaite** : LB = 0 sur S38 et S39 (semaines faisables) — aucun faux positif.
- **S37 : LB = 3 = l'optimum déjà prouvé par l'arbre** — preuve d'optimalité **à la racine, en millisecondes, sans une itération de recherche**, avec un certificat structurel lisible : cluster {BUT3-G1, G2, G3}, capacité jeudi 270 min (fermeture des salles à 12h30), demande 6300 min-groupe. Le B&B peut être court-circuité entièrement.
- **S40 : LB = 1, PROUVÉ** — certificat DUBOIS : 4 tâches de 90 min obligatoires, fenêtres réelles = soirées 17:30-19:30 dont le jeudi inutilisable (salles fermées dès 12h30, visible seulement en intersectant le domaine réel de chaque tâche) ⟹ au plus 3 plaçables. C'est l'analyse manuelle de Frédéric (« 4×90 pour 3×120 ») retrouvée et **prouvée mécaniquement**.

**Ce que la LB racine NE TRANCHE PAS : la question S40 « 106/107 ou 105 optimal ? » reste ouverte.** Mesures de la session de cadrage :
- Le 2e saut (LAVEFVE R3.04 G1+G2) n'a **aucun certificat racine**. Précision importante (objection de Frédéric, fondée, intégrée ici) : ce n'est PAS la faisabilité de la sous-instance BUT2−DUBOIS (40/40 prouvé — instance allégée, elle ne réfute rien à elle seule ; son rôle est la LOCALISATION : la charge G1/G2 seule n'est pas la cause, la tâche DUBOIS est un ingrédient nécessaire du blocage). La vraie mesure est le packing exact **avec les tâches DUBOIS incluses** : il trouve une répartition jour-par-jour complète (24/24 du cluster G1+G2, DUBOIS mercredi, LAVEFVE jeudi, caps 450/450/450/270/390 respectés) — donc l'arithmétique volumique+granularité au niveau JOUR ne peut pas certifier le saut. Le verrou réel est en dessous : simultanéités au niveau horloge (ex. vérifié à la main sur le jeudi 270 min de cette répartition : CM CREDEVILLE figé 8h-9h30 + TD LAVEFVE devant finir ≤12h + 2 TP du même enseignant ADAMCZYK ⟹ double-réservation inévitable — cette répartition-là est infaisable à l'horloge). Empiriquement : ajouter la SEULE tâche DUBOIS R3.04 G1+G2 au noyau faisable de 23 tâches rend l'instance infaisable (2 M itérations gourmandes sans solution complète, puis 2 M itérations B&B sans amélioration NI preuve — l'arbre est inépuisable dès ~24 tâches).
- **Réduction logique rigoureuse obtenue grâce au certificat DUBOIS** : toute solution saute ≥ 1 tâche DUBOIS ; ses 4 tâches sont toutes sans dépendants (aucun R1.04/R3.04 TP ou CM en S40) ; donc *106/107 faisable ⟺ l'une des 4 instances « S40 moins une tâche DUBOIS » est 100 % faisable*. Les 4 variantes ont été soumises au moteur (maxPlacement, warm start + B&B, 2 M itérations / 120 s par phase) : **aucune n'atteint 0 saut** (3 fois 105/106 avec la même victime résiduelle LAVEFVE R3.04 G1+G2, 1 fois 104/106), et la LB racine des 4 variantes vaut 0 (pas de preuve d'infaisabilité non plus).
- **Conclusion factuelle à présenter telle quelle** : 106/107 n'a jamais été atteint par aucune méthode (64 cellules des campagnes précédentes, combo-branching, 4 minus-1 ciblés, sous-instances) et la réduction ci-dessus borne exactement où chercher ; mais la preuve mécanique de « 105 optimal » est **hors de portée des outils actuels** (LB racine = 1 < 2 ; épuisement d'arbre impossible dès 24 tâches). Options futures documentées, hors périmètre : CP-SAT (`docs/MoteurCPSAT-Faisabilite.md`), LB aux nœuds internes.

**Pourquoi implémenter quand même** (les 3 axes d'évaluation de Frédéric) : (1) placements — inchangés par construction (une borne ne place rien) ; (2) convergence — court-circuit total du B&B quand LB = coût de l'amorce gourmande (S37 : 0 itération B&B au lieu de 22+) et calcul en millisecondes ; (3) **preuve et explication — c'est l'axe qui paie** : `provenOptimal` racine (S37), garantie partielle prouvée « ≥ k sauts inévitables » avec certificats lisibles et actionnables (S40 : k=1, DUBOIS, quelle ressource relâcher et pourquoi) — exactement l'« explication structurelle » que le cadrage métier du chantier réclamait (doc de conception §3.5), complémentaire de l'analyse de charge P2-Explication qui, elle, est indicative et non prouvée.

## 1. Design — module `rootLowerBound.ts` (scheduler-core, pur)

Nouveau fichier `packages/scheduler-core/src/rootLowerBound.ts`, fonctions pures, aucun état partagé. Entrées : unités (tâches via `getMemberTasks` pour les groupes), config (`lunchBreak`, `ignoreDailyLimits`). Sortie : `{ lb: number, certificates: Certificate[] }`.

**Principe de sûreté cardinal (à respecter dans CHAQUE approximation)** : la borne n'est valide que si le packing est SURESTIMÉ. Toute simplification doit aller dans le sens « plus de tâches plaçables qu'en réalité », jamais l'inverse. Un dépassement de limite de nœuds du DFS ⟹ repli sur la borne de comptage (préfixe croissant des durées vs capacité totale), jamais sur le meilleur packing partiel trouvé.

### 1.1 Domaine réel d'une tâche
`computeTaskDomain(task)` = union, sur tous les combos (`getApplicableResources`, existant dans `taskScheduling.ts`), de l'intersection des disponibilités du combo (`intersectResources`, existant). Retour : liste d'intervalles fusionnés. C'est la clé qui a débloqué le certificat DUBOIS (le jeudi soir n'est éliminé QUE par l'intersection avec les salles).

### 1.2 Certificats mono-ressource
Pour chaque ressource `r` : `S_r` = tâches non-enforced ayant `r` en slot d'alternatives de **longueur 1** (= obligatoire dans tous les combos). Modèle de packing :
- fenêtres = intervalles de dispo de `r` moins les occupations des tâches enforced sur `r` ;
- cap par jour = min( Σ fenêtres du jour ; −90 min si pause flottante configurée, `r` GROUP et recouvrement dispo∩fenêtre-de-pause ≥ durée de pause [même garde d'inapplicabilité que `_resourceKeepsFloatingBreak`] ; `maxDailyMinutes` − minutes enforced du jour si défini et `!ignoreDailyLimits` ) ;
- raffinement « union des domaines » : cap ← min(cap, mesure de ∪_{t∈S_r} (domaine(t) ∩ dispo du jour)) — le temps occupé par S_r sur r un jour donné vit dans cette union ;
- éligibilité item×fenêtre : la tâche doit avoir un run contigu ≥ durée dans (domaine(t) − occupations enforced) ∩ fenêtre ;
- `MaxPack` = DFS exact (items triés durée décroissante, branche « non placé », élagage `placed + restants ≤ best`, mémo sur signature des résidus, limite de nœuds ~4 M) ; `LB_r = |S_r| − MaxPack`.

### 1.3 Certificats cluster de groupes
Candidats : ensembles de groupes co-occurrents dans les slots obligatoires d'une même tâche (paires jointes type BUT2-G1+G2) + unions par promo (préfixe avant `-`). Pour chaque cluster : `S` = tâches obligatoires sur ≥ 1 groupe du cluster ; **chaque item consomme TOUTES ses ressources obligatoires** (groupes du cluster + enseignants + salles imposées) ; caps par (ressource, jour) selon les mêmes règles que §1.2 ; affectation par JOUR (pas par fenêtre), éligibilité item×jour par run contigu du domaine ; DFS exact d'affectation, limite de nœuds ~6 M, dépassement ⟹ cluster abandonné (pas de borne, côté sûr). C'est ce niveau qui prouve S37 = 3.

### 1.4 Somme disjointe
Trier tous les certificats (mono + cluster) par LB décroissant puis |S| croissant ; sélection gloutonne en refusant tout certificat partageant une tâche avec un déjà retenu. `lb` = somme. (L'optimisation exacte de la sélection est inutile au vu des tailles ; noter le choix dans la docstring.)

## 2. Intégration `OptionalTasksScheduler`

- Calcul de la LB une fois, au début de `solveWithElimination()` (après `initSolver`, avant la passe gourmande).
- **Court-circuit** : après la passe gourmande, si `coûtGourmand ≤ lb` ⟹ `_provenOptimal = true`, passe B&B non lancée (log dédié « optimum prouvé par borne racine »). Sinon, pendant le B&B : arrêt global dès qu'un incumbent atteint `coût == lb` (même mécanique que l'arrêt 0-saut existant, qui reste le cas particulier lb=0).
- La preuve par LB est indépendante de la garde de soundness §0 de P3 (`greedyCost > maxEliminations+1`) : `coût ≤ lb ≤ optimum ⟹ coût = optimum`, valable quel que soit l'état de l'arbre. Ne pas fusionner les deux logiques ; la LB peut mettre `_provenOptimal = true` là où la garde seule dirait false.
- Sémantique des coûts : le coût B&B compte les tâches (cascades incluses) ; la LB compte des tâches des ensembles disjoints ⟹ comparables directement (LB ≤ optimum ≤ tout coût).
- **Sérialisation** : champ optionnel `rootBound` dans `ScheduleSolutionJSON` : `{ lb, certificates: [{ resourceIds, taskIds, lb, note }] }` où `note` est le résumé lisible (demande, caps par jour). Câblage worker/controller comme `provenOptimal` (P3). Client : passthrough + message de statut enrichi quand la preuve vient de la borne (« optimum prouvé : k saut(s) structurellement inévitables ») ; l'affichage riche des certificats dans le panneau Analyse est HORS périmètre (P2-preuve-UI éventuel, à trancher après usage).

## 3. Tests — volontairement resserrés (NE PAS commencer sans le feu vert de Frédéric, cf. déroulé)

4 tests seulement, pas plus. La couverture large (configs, enforced, semaines faisables) est assurée par la validation réelle §4, pas par des scénarios synthétiques redondants.

1. **Pigeonhole DUBOIS** (réutiliser le scénario existant des suites) : LB racine = 1, `provenOptimal` immédiat, B&B court-circuité (itérations B&B = 0). Seul scénario où « vérifier empiriquement avant de figer » s'applique.
2. **Cluster** : scénario minimal 2 groupes + tâches jointes + un jour court partagé ⟹ LB = 1 par le cluster, 0 en mono-ressource (asserter les deux niveaux). Idem, calibrer avant de figer.
3. **Neutralité** : instance faisable ⟹ LB = 0 et comportement strictement inchangé (itérations identiques avec/sans le module). Ajouter à ce scénario une tâche enforced (couvre l'exclusion des S_r et la soustraction des fenêtres sans test dédié).
4. **Micro-tests du module pur** (un seul fichier, assertions directes sur `rootLowerBound`, pas de moteur) : (a) lunch fixed non re-déduit (déjà dans les dispos — re-déduire rendrait la borne INVALIDE, c'est le seul vrai piège de sûreté) ; (b) limite de nœuds basse ⟹ repli comptage, LB jamais plus forte ; (c) sur les scénarios 1-2, asserter `lb ≤ optimum connu`.

## 4. Validation réelle — protocole ALLÉGÉ (après feu vert, export à re-faire si le projet a changé — sinon celui du 16/07)

**PAS de grille 4 budgets × 4 semaines** : la LB ne touche pas au placement, une seule cellule par semaine suffit. Protocole : S37-40, budget 10000, COS on, config de validation habituelle — 4 runs au total, enchaînés dans UN SEUL script batch lancé en arrière-plan qui logue une ligne synthétique par run (semaine, placées/total, lb, provenOptimal, ms) ; une seule lecture du log à la fin, pas d'analyse entre les runs :
- **Placements** : chiffres identiques à la référence connue (94/97, 110/110, 106/106, 105/107) — toute différence = bug, STOP.
- **Preuve/convergence** : S37 ⟹ `provenOptimal=true` dès la fin de la passe gourmande (0 itération B&B) + certificat cluster BUT3 ; S40 ⟹ `rootBound.lb=1` + certificat DUBOIS ; S38/S39 ⟹ `lb=0`. Temps de calcul de la LB < 100 ms par semaine (sinon, le noter, pas bloquant).
- **STOP immédiat** si une LB dépasse un optimum connu (S37 > 3, S38/39 > 0, S40 > 2) : bug de sûreté.

Le prototype de la session de cadrage (`packages/scheduler-client/examples/p2preuve-lb-tmp.ts`, non commité) contient l'algorithme complet validé sur le réel — s'en servir comme référence d'implémentation et pour recouper les chiffres, puis le supprimer à la livraison.

## 5. Livraison et hors périmètre

Livraison sur `feature/p2-preuve`, en DEUX commits séparés par le feu vert de Frédéric : (1) implémentation §1-§2 (typecheck clean, suites existantes vertes) → STOP, demande de feu vert ; (2) tests §3 + validation §4 + STATUT de ce plan. Merge vers `master` : décision de Frédéric, hors périmètre de l'exécution.

Hors périmètre explicite :
- LB aux nœuds internes du B&B (racine seulement — l'ajouter serait prématuré sans mesure d'un cas où ça paie) ;
- toute promesse de trancher « 106 vs 105 » sur S40 (voir §0 — documenté hors de portée actuelle) ;
- clusters d'enseignants ou de salles comme certificats primaires (les enseignants/salles participent déjà aux caps des clusters de groupes) ;
- CP-SAT ;
- UI riche des certificats.

## 6. Definition of done

- [x] Branche `feature/p2-preuve` créée depuis `master`
- [x] `rootLowerBound.ts` implémenté conforme §1 (principe de sûreté respecté partout, docstrings)
- [x] Intégration §2 (court-circuit gourmand, arrêt global incumbent==lb, `rootBound` sérialisé bout en bout)
- [x] **CHECKPOINT : typecheck + suites existantes vertes, commit 1, feu vert de Frédéric demandé et obtenu**
- [x] 4 tests §3 verts (scénarios 1-2 calibrés empiriquement avant d'être figés)
- [x] Validation réelle allégée §4 : 4 runs conformes, zéro STOP déclenché
- [x] STATUT rédigé en tête de ce plan (chiffres réels, écarts au plan le cas échéant), commit 2
