# Audit du backjumping (`BackjumpingScheduler`) — pourquoi il ne fait pas mieux que le backtracking

*Audit réalisé le 15/07/2026 sur la branche `feature/backjumping` (commit `5cbb657`). Périmètre : analyse ligne à ligne de l'implémentation confrontée à l'état de l'art, hypothèses vérifiées empiriquement une à une (scénarios construits + projet réel semaine 40). Aucune modification de code — les recommandations sont en §7, à arbitrer séparément.*

---

## 1. Résumé exécutif

Le backjumping implémenté ne fait pas mieux que le backtracking chronologique pour **quatre raisons indépendantes et cumulées**, chacune vérifiée par une expérience dédiée :

| # | Verdict | Preuve |
|---|---|---|
| **V1** | Ce n'est pas un CBJ mais un backjumping *à la Gaschnig* (saut au premier échec seulement) : faute de fusion des ensembles de conflit, il **dégénère en chronologique dès l'épuisement de la première cible** | H1 (§4.1) : 92 itérations = 92 itérations, strictement identique au backtracking sur un cas taillé pour le backjumping |
| **V2** | L'ensemble de conflit réutilisé (§5.7 du doc de conception) **n'est pas exhaustif** — condition pourtant nécessaire à la validité d'un saut : pause flottante muette, cap quotidien invisible (par défaut), fenêtre de scan rétrécie par `fromTime` | H2 (§4.2) : conflit vide au `fromTime` réel vs coupable visible au `fromTime` initial |
| **V3** | Conséquence directe de V2 + cible enforced inatteignable : le backjumping est **incorrect** — il peut avorter toute la recherche et perdre une solution que le backtracking trouve | H3 (§4.3) : backtracking = solution en 5 itérations, backjumping = **0 solution** en 2 itérations |
| **V4** | Même un CBJ parfait gagnerait peu ici : le tri MCV dynamique localise les conflits, il ne reste presque rien à sauter — résultat **conforme à la littérature** (Bacchus & van Run 1995 ; Chen & van Beek 2001) | H4 (§4.4) : sous MCV, 3 sauts en tout sur l'instance faisable ; 62–78 % des sauts à distance 0 en conditions réelles |

La phrase qui résume tout : **le backjumping implémenté ne peut pas aider quand l'ordre d'exploration est bon (il n'y a rien à sauter) et n'aide pas quand l'ordre est mauvais (sauts myopes à distance ~0, puis dégénérescence) — il n'a aucun régime de fonctionnement utile, et il est en prime incorrect.**

La cause racine est architecturale, pas un bug ponctuel : le mécanisme de blâme §5.7 a été conçu comme un **compteur heuristique** pour orienter `solveWithElimination` — usage pour lequel ses approximations sont sans danger, puisque le backtracking n'en fait jamais dépendre son parcours. En le réutilisant comme **justification de saut**, on a silencieusement élevé son exigence de correction de « indicatif » à « exhaustif ». Il ne l'est pas, et ne peut pas le devenir à coût raisonnable (§3.2).

L'audit a aussi mis au jour un **bug latent indépendant du backjumping** dans `solveWithElimination` (§5) et débouche sur une recommandation principale issue de l'état de l'art récent : remplacer le look-back par du **réordonnancement piloté par les conflits** (Last-Conflict / Conflict Ordering Search, §7-R2), qui est la voie prise par les moteurs de scheduling modernes et qui s'intègre naturellement à notre `_dynamicSort`.

---

## 2. Rappel : ce que fait l'implémentation auditée

Correspondance avec le vocabulaire CSP, nécessaire pour comparer à la littérature :

| Notion CSP | Équivalent dans ce moteur |
|---|---|
| Variable | Unité (`ISchedulingUnit`), **choisie dynamiquement** à chaque nœud par `_dynamicSort` (MCV §5.1) |
| Valeur | Créneau de départ, énuméré par `earlySchedule(fromTime)` **de façon monotone croissante** (pas de 30 min) |
| Contrainte binaire | Partage de ressource (disponibilité physique mutée par `book`/`unBook`) |
| Contraintes **non binaires, invisibles au blâme** | Pause méridienne flottante (`_floatingLBAllows`) et plafond quotidien (`_dailyLimitAllows`) — appliquées comme *filtres* qui rejettent un créneau en avançant `fromTime`, sans trace |
| Ensemble de conflit | `_computeConflictSet` : scan des occupants *actuels* de `_solution` sur les ressources candidates de l'unité en échec, fenêtré par `end > fromTime` |
| Saut | `_backtrack` retourne l'`id` de l'occupant **le plus profond** ; chaque frame ancêtre propage la chaîne sans retenter, sauf si c'est sa propre unité |

Décision de conception d'origine (validée ensemble à l'époque) : **pas de fusion des ensembles de conflit à la Prosser** — remplacée par un « rescan à chaud » de l'état physique réel à chaque échec. L'audit montre que cet argument couvrait le mauvais cas : le rescan retrouve bien les conflits entre unités *réservées*, mais l'information à préserver lors d'un saut est celle héritée de l'échec d'une unité **future** (jamais réservée), que le rescan de la cible ne peut pas redécouvrir — ses ressources candidates n'ont rien à voir (§4.1).

---

## 3. Écarts au CBJ canonique (Prosser 1993)

### 3.1 Absence de fusion → backjumping de Gaschnig, pas CBJ

Dans le CBJ de Prosser, quand la variable `v_i` épuise ses valeurs, on saute vers `h = max(conf(i))` **et l'on fusionne** : `conf(h) ← conf(h) ∪ conf(i) \ {h}`. C'est cette fusion qui fait la différence entre Gaschnig (1979) — saut au premier échec, puis comportement chronologique — et le CBJ complet : quand la cible `h` épuise à son tour ses valeurs, elle sait *pourquoi on était venu à elle* et saute vers le co-coupable suivant, aussi haut soit-il.

Notre implémentation ne conserve rien : à l'épuisement de la cible, `_computeConflictSet` est recalculé sur les **ressources de la cible elle-même** — les co-coupables de l'échec d'origine (qui concernaient les ressources de l'unité *future* en échec) sont invisibles, l'ensemble revient souvent vide, et l'on retombe en `false` = remontée chronologique d'un niveau. Dechter avait déjà établi que le backjumping de Gaschnig ne saute qu'aux impasses *feuilles* ; aux impasses *internes* (épuisement d'une cible), seul le CBJ (ou le graph-based) continue de sauter.

### 3.2 L'ensemble de conflit n'est pas exhaustif — condition de validité violée

La justification formelle du saut (explicite chez Ginsberg 1993 pour le dynamic backtracking) : on ne peut sauter par-dessus une variable intermédiaire **que si l'ensemble de conflit explique la totalité de l'échec** — c.-à-d. qu'aucun changement d'une variable hors ensemble ne pourrait le lever. Sur-inclure est inefficace mais sûr (sauts trop courts) ; **sous-inclure est incorrect** (on saute par-dessus un vrai responsable → perte de solutions). Notre ensemble sous-inclut par trois canaux :

1. **Pause méridienne flottante** : `_floatingLBAllows` rejette un créneau en fonction des réservations du jour sur les ressources GROUP — donc en fonction d'unités déjà placées — mais ce rejet n'alimente jamais l'ensemble de conflit. *(Précision de Frédéric, intégrée : la pause **fixe** est hors de cause — soustraite des disponibilités à l'initialisation, elle est une contrainte statique. Seule la flottante, cas le plus courant en pratique, est concernée.)*
2. **Plafond quotidien** (`maxDailyMinutes`) : même structure — `_dailyLimitAllows` dépend de `_dailyBookedMinutes`, invisible au scan. Corrigé derrière le flag `conflictSetDailyLimitAware` (défaut `false` sur cette branche).
3. **Rétrécissement de la fenêtre de scan** : chaque rejet par filtre avance `fromTime` ; le scan final (`end ≤ fromTime` → exclu) utilise ce `fromTime` *avancé*, excluant les occupants qui bloquaient le début de la fenêtre — y compris ceux dont les réservations ont précisément causé les rejets. H2 en donne la preuve directe (§4.2).

### 3.3 Cible enforced inatteignable + valeur de retour jetée → avortement silencieux

Les unités enforced sont pré-remplies dans `_solution` mais n'ont **aucune frame** dans la récursion. Si l'ensemble de conflit ne contient que des enforced, la chaîne de saut retournée ne correspond à aucune frame, remonte intacte jusqu'à `solve()` — qui **jette la valeur de retour** (`scheduler.ts:191`) : la recherche se termine immédiatement, toutes les alternatives inexplorées sont perdues. H3 transforme ce mécanisme en perte de solution démontrée (§4.3).

Sur le fond (précision de Frédéric) : les tâches enforced sont placées par l'utilisateur et relèvent de sa responsabilité — mais l'algorithme devrait au moins savoir *identifier* qu'une enforced est la cause d'un blocage. C'est déjà le cas côté blâme (§5.7 sait la désigner, cf. tests `schedulerFailureBlame`) ; c'est le *saut* qui ne peut pas la viser — la distinction est importante pour le correctif (§7-R1).

### 3.4 Ce qui est conforme

Pour être complet : le choix de la cible (« l'occupant le plus profond » = `max(conf)`), la propagation par valeur de retour sans exception, et l'arrêt du saut à la frame cible (« the buck stops here ») sont conformes au schéma canonique. Le problème n'est pas la mécanique de propagation, c'est ce qu'on propage et ce qu'on sait des causes.

---

## 4. Preuves empiriques

Quatre expériences, une par verdict. Les scénarios construits contrôlent l'ordre d'exploration (override de `_dynamicSort`) quand il faut isoler le mécanisme testé de l'effet de l'ordre — l'effet de l'ordre étant lui-même l'objet de H4.

### 4.1 H1 — Dégénérescence Gaschnig (ordre figé [A, Y, X, F])

Scénario : F (30 min) a besoin du prof P **et** de la salle S ; X occupe P (cible du saut, 3 valeurs toutes hostiles tant que A est mal placée) ; A occupe S (co-coupable « haut », 2 valeurs) ; Y est **innocente** (ressources disjointes, ~21 valeurs) et placée entre A et X. Fenêtres : P lundi 8h-11h (X = 120 min), S lundi 8h30-10h (A = 60 min), Y lundi 8h-19h.

| Moteur | Itérations | `earlySchedule` sur Y (innocente) | Solution |
|---|---|---|---|
| Backtracking (ordre figé) | 92 | 23 | A@9h, X@9h, F@8h30 ✓ |
| **Backjumping (ordre figé)** | **92** | **23** | idem ✓ |
| CBJ canonique (déroulé à la main) | ≈ 17 | 2 | idem |

Lecture : le premier saut F→X est à **distance 0** (X est la frame immédiatement supérieure — aucun gain), et à l'épuisement de X, `conf(X) = ∅` → `false` → remontée chronologique qui re-teste l'innocente Y 23 fois avec re-descente complète à chaque fois. La fusion de Prosser (`conf(X) ← {A}`) aurait sauté par-dessus Y directement vers A. **Sur un cas construit *pour* le backjumping, l'implémentation est indiscernable du backtracking, à l'itération près.**

### 4.2 H2 — Pause flottante muette + fenêtre rétrécie

Scénario (pause flottante 60 min dans [12h,14h]) : L occupe le groupe GF 12h-13h (placement légal) ; F (60 min, fenêtre 12h30-14h) voit son seul créneau possible (13h) rejeté par le filtre lunch (L+F détruiraient la pause), `fromTime` avance à 13h30, impasse.

| Scan de l'ensemble de conflit | Résultat |
|---|---|
| au `fromTime` réel de l'impasse (13h30, avancé par les rejets lunch) | **∅ — coupable masquée** |
| au `fromTime` initial (0) | **{L} — coupable visible** |

Lecture : la vraie coupable (L) est masquée par le rétrécissement, l'ensemble revient vide → aucun saut possible, et le blâme §5.7 (repli) désigne la victime. Aucun flag existant ne corrige le canal « pause flottante » (contrairement au cap quotidien). Honnêteté du protocole : dans ce mini-scénario, le MCV réel place F en premier et esquive l'impasse — le mécanisme est prouvé par reconstruction directe de l'état ; sa fréquence en conditions réelles n'a pas été mesurée.

### 4.3 H3 — Incomplétude démontrée (perte de solution réelle)

Scénario : G (groupe partagé A/F) plafonné à 120 min/jour ; A (120 min, la plus contrainte → placée en premier) consomme tout le cap du lundi ; E (enforced) occupe la salle de F tout le mardi ; F (60 min) meurt : lundi rejeté par cap (invisible), mardi bloqué par E. À l'impasse, A est exclue du scan (sa réservation finit avant le `fromTime` avancé) → conflit = {E} → cible enforced → chaîne inattrapable → `solve()` la jette.

| Moteur | Itérations | Résultat |
|---|---|---|
| Backtracking | 5 | **Solution** : A@mardi, F@lundi ✓ |
| **Backjumping (défauts de la branche)** | **2** | **AUCUNE solution — recherche avortée** |
| Backjumping + `conflictSetDailyLimitAware` | 5 | Solution ✓ (A redevient visible → cible plus profonde que E → pas d'avortement) |

Lecture : **le backjumping actuel n'est pas un algorithme de recherche systématique correct.** Une solution parfaitement atteignable est perdue. Le contraste avec le flag montre que chaque canal de sous-inclusion (§3.2) est une source potentielle d'avortement ou de saut par-dessus un vrai responsable. Conséquence pratique silencieuse : dans `solveWithElimination`, un avortement précoce se déguise en « aucune solution » et déclenche une élimination injustifiée.

### 4.4 H4 — L'ordre dynamique absorbe le bénéfice du saut (test de subsomption)

Protocole canonique « temps jusqu'à la première solution » : semaine 40 réelle rendue faisable (Autonomie neutralisée + retrait des 2 cours R3.04 dont l'éliminabilité était prouvée), `solve()` pur, timeout 60 s, plafond 1 M d'itérations. Carré 2×2 : {ordre statique topologique+priorité initiale, MCV dynamique} × {backtracking, backjumping}.

| | Backtracking | Backjumping |
|---|---|---|
| **MCV dynamique** | 110 itérations, solution (105 placées) | 112 itérations, solution — **3 sauts en tout** (tous d=1) |
| **Ordre statique** | 1 000 090 itérations, **échec** | 1 000 033 itérations, **échec** — 740 600 sauts, **93,8 % à d=0**, moyenne 0,06 |

Trois enseignements :

1. **L'essentiel de la puissance du moteur est dans le MCV dynamique** : facteur ≥ 9 000 en itérations entre les deux lignes. C'est exactement le résultat théorique de Chen & van Beek (2001) — il existe toujours un ordre dynamique rendant le CBJ redondant — et le constat empirique de Bacchus & van Run (1995) : un bon fail-first place les unités en compétition côte à côte, les conflits deviennent locaux, les sauts tendent vers la distance 0.
2. **Sous MCV, il ne reste littéralement rien à sauter** : 3 sauts sur toute la résolution. Mesures antérieures en conditions réelles (avec élimination) : 62,4 % de sauts à d=0 sur la semaine 40 (2 580 sauts, moyenne 1,17), 77,6 % sur les semaines 37-39.
3. **Là où le backjumping devrait briller — mauvais ordre statique, le terrain d'origine de Gaschnig/Prosser — notre variante saute sur place** : 740 600 sauts à distance moyenne 0,06. La sur-inclusion du scan plat désigne presque toujours l'unité placée juste avant (partage de groupe/salle omniprésent dans un emploi du temps), et sans fusion, les rares vrais sauts dégénèrent aussitôt (H1). Un CBJ canonique ferait ici des sauts massifs.

Nuance de littérature à conserver : Chen & van Beek montrent aussi que le CBJ **bien implémenté** reste quasi gratuit et gagne parfois gros sur les instances exceptionnellement dures (GAC-CBJ). Le verdict n'est donc pas « le backjumping est inutile en général » mais « *cette* variante-ci n'a aucun régime utile, et un CBJ complet n'aurait qu'un potentiel marginal ici, la contention étant déjà absorbée par le MCV ».

---

## 5. Trouvaille annexe (hors backjumping) : bug latent dans `solveWithElimination`

Découvert en préparant H4 : l'élimination retire l'unité la plus blâmée par `_units.splice(...)` **sans détacher ses dépendants**. Si l'unité éliminée a des enfants (un TD dont dépend un TP, un CM dont dépend un TD), le round suivant plante : `Unité '…' : dépendance '…' non encore planifiée` — l'exception de garde de `_backtrack` (le dépendant orphelin reste « notReady » jusqu'au bout, puis est atteint sans que sa dépendance soit dans `_scheduled`).

La configuration standard n'y a jamais été confrontée **par chance** : sur nos données, le blâme n'a jamais désigné en premier une unité ayant des dépendants. Le crash est apparu dès que l'ordre statique de H4 a déplacé la distribution du blâme (élimination de `R3.Crea.09 KABAB TD` → son TP orphelin → throw). N'importe quelle évolution du blâme (dom/wdeg, slotAware…) peut y exposer les vraies semaines. À corriger indépendamment du sort du backjumping (§7-R4).

---

## 6. Synthèse : pourquoi « ça ne marche pas beaucoup mieux »

La question d'origine était : *pourquoi le backjumping ne fonctionne-t-il pas beaucoup mieux que le backtracking ?* Réponse en trois couches, de la plus structurelle à la plus accidentelle :

1. **Structurelle (V4)** : notre MCV dynamique recalculé à chaque nœud est déjà l'optimisation dominante ; dans son régime nominal, les conflits sont locaux et le look-back n'a presque rien à récupérer. C'est un résultat de littérature vieux de 30 ans que nos mesures reproduisent fidèlement.
2. **Algorithmique (V1)** : le peu que le look-back pourrait récupérer (impasses internes, co-coupables lointains — le cas des queues lourdes de la semaine 40) exige la fusion de Prosser, absente. L'implémentation retombe en chronologique précisément dans les situations où elle aurait pu payer.
3. **De correction (V2, V3)** : les ensembles de conflit héritées du blâme §5.7 ne satisfont pas l'exigence d'exhaustivité d'un saut. Résultat : sauts myopes (sur-inclusion → d=0) *et* pertes de solutions (sous-inclusion → avortement H3). Le gain mesuré du backjumping sur la semaine 40 en conditions réelles (moins d'itérations par round sous timeout) est réel mais fragile : il repose sur un parcours qui n'est plus garanti complet.

---

## 7. Recommandations (à arbitrer — aucune implémentée)

**R1 — Garde-fous de correction si la branche backjumping reste utilisable** (coût : quelques lignes) :
1. Ne jamais retourner une cible enforced — la traiter comme `false` (remontée chronologique). Supprime l'avortement H3 sans rien perdre : le blâme, lui, continue de désigner l'enforced à l'utilisateur.
2. Ne pas sauter (retourner `false`) dès qu'au moins un créneau du scan échoué a été rejeté par un filtre (pause flottante / cap) : l'ensemble de conflit ne peut alors pas être exhaustif.
3. Scanner le blâme sur la fenêtre *initiale* (le `fromTime` de dépendance), pas sur la fenêtre rétrécie par les rejets.
Avec ces gardes, le backjumping redevient correct — mais ne sautera presque plus (la plupart des impasses réelles impliquent les filtres) : c'est le prix de la correction, et un argument de plus pour R2.

**R2 — Recommandation principale : remplacer le look-back par du réordonnancement piloté par les conflits.** C'est la voie de l'état de l'art scheduling depuis dix ans : Last-Conflict reasoning (Lecoutre et al. 2009), Conflict Ordering Search (Gay, Hartert, Lecoutre, Schaus, CP 2015 — conçu précisément pour les problèmes de scheduling), Failure-Directed Search (Vilím, Laborie, Shaw, CPAIOR 2015 — cœur de CP Optimizer). Principe LC/COS : quand une unité échoue, au lieu de sauter en arrière (look-back), on la **priorise dans le tri** au retour arrière suivant, jusqu'à ce qu'elle soit placée — la « variable coupable » remonte l'arbre *par l'ordre*, pas par le contrôle de flux. Avantages décisifs pour nous : (a) s'implémente en quelques lignes dans le `_dynamicSort` existant (boost de priorité des unités récemment en échec) ; (b) **sûr par construction** — pure heuristique d'ordre, aucune exigence d'exhaustivité, aucune perte de complétude possible ; (c) coopère avec le MCV au lieu de le concurrencer ; (d) attaque directement le thrashing type semaine 40 (la tâche problématique est retentée tôt au lieu d'être redécouverte après re-exploration). Compléments plus lourds à garder en réserve : redémarrages + enregistrement de nogoods (Lecoutre et al. 2007), FDS complet.

**R3 — Si l'on tient à un vrai CBJ** (non recommandé au vu de V4) : implémenter la fusion de Prosser. L'argument « pas d'allocation dans la boucle chaude » ne tient pas : seuls les échecs ont besoin d'allouer un ensemble, pas les 1 M d'appels. Mais R1 resterait nécessaire (exhaustivité), et le plafond de gain est celui mesuré en H4.

**R4 — Corriger le bug latent de `solveWithElimination`** (§5) : à l'élimination d'une unité, neutraliser aussi ses dépendants (ou les détacher explicitement) — avec le même soin de reporting côté client que les neutralisations actuelles.

**R5 — Généraliser la détection du blâme aux filtres** (canal pause flottante, analogue au `conflictSetDailyLimitAware` existant ; et fenêtre initiale plutôt que rétrécie). Bénéficie d'abord au **backtracking** (éliminations mieux ciblées sous timeout — le vrai goulot mesuré sur la semaine 40), indépendamment du sort du backjumping. La réserve dom/wdeg (§4.6 du doc de conception) reste la piste d'*agrégation* une fois la *détection* réparée.

---

## 8. Références

- J. Gaschnig, *Performance measurement and analysis of certain search algorithms*, thèse CMU, 1979 — backjumping d'origine (saut aux impasses feuilles).
- P. Prosser, *Hybrid algorithms for the constraint satisfaction problem*, Computational Intelligence 9(3), 1993 — CBJ, fusion des ensembles de conflit.
- R. Dechter, *Enhancement schemes for constraint processing: backjumping, learning, and cutset decomposition*, AIJ 41, 1990 — graph-based backjumping, limites de Gaschnig.
- M. Ginsberg, *Dynamic backtracking*, JAIR 1, 1993 — condition d'exhaustivité des ensembles d'élimination.
- F. Bacchus, P. van Run, *Dynamic variable ordering in CSPs*, CP 1995 — l'ordre dynamique absorbe l'essentiel du bénéfice du backjumping.
- C. Bessière, J.-C. Régin, *MAC and combined heuristics: two reasons to forsake FC (and CBJ?)*, CP 1996.
- X. Chen, P. van Beek, *Conflict-Directed Backjumping Revisited*, JAIR 14, 2001 — il existe un ordre dynamique rendant CBJ redondant ; nuance : GAC-CBJ gagne encore sur instances dures.
- F. Boussemart, F. Hemery, C. Lecoutre, L. Saïs, *Boosting systematic search by weighting constraints*, ECAI 2004 — dom/wdeg (déjà §4.6 du doc de conception).
- C. Lecoutre, L. Saïs, S. Tabary, V. Vidal, *Recording and minimizing nogoods from restarts*, JSAT 1, 2007.
- C. Lecoutre, L. Saïs, S. Tabary, V. Vidal, *Reasoning from last conflict(s) in constraint programming*, AIJ 173, 2009 — Last-Conflict.
- S. Gay, R. Hartert, C. Lecoutre, P. Schaus, *Conflict Ordering Search for Scheduling Problems*, CP 2015 — COS, spécifique scheduling.
- P. Vilím, P. Laborie, P. Shaw, *Failure-Directed Search for Constraint-Based Scheduling*, CPAIOR 2015 — moteur de recherche de CP Optimizer.

## Annexe — Reproductibilité

Les quatre expériences ont été menées par scripts jetables (`packages/scheduler-core/examples/audit-h{1,2,3,4}-*-tmp.ts`, supprimés après audit conformément à la convention du dépôt) ; les scénarios sont intégralement décrits en §4 (ressources, fenêtres, durées) et reconstructibles à l'identique. Config des runs réels : `maxSolutions:1, timeoutSeconds:10→60, maxIterations:1M, lunchBreak flottante 90min [12h,14h]` (config de test standard du projet). Si les correctifs R1/R2 sont retenus, convertir H1 et H3 en tests de régression permanents dans `__tests__/`.
