# Conception de l'heuristique de priorité MCV — v2

Document de conception. **Aucune implémentation n'a encore été entamée** sur les points décrits ici — ce document capture une réflexion menée à partir d'un cas réel observé en production, avant de trancher les points encore ouverts et d'écrire un plan d'implémentation.

## 1. Contexte et historique

Une première réécriture de `getSchedulingPriority()` (`TaskUnit`/`TaskGroupUnit`, `packages/scheduler-core`) a déjà corrigé un bug majeur : le score lisait `task.appliedResources` (vide avant réservation), donnant un score constant à toute tâche non encore placée. Le fix : `Task.getBestApplicableAvailableTime()` explore désormais `getApplicableResources()` (toutes les combinaisons candidates) et prend le max du total de disponibilité par combinaison. Agrégation `min` pour les groupes, propagation `max` (pas somme) vers les dépendants. Ce fix est en production et reste valide — voir la mémoire `project-scheduler-core-priority-rewrite` pour le détail des deux pièges rencontrés (ordre de dépendances, inversion de signe).

Ce document part d'un **second problème**, plus profond, découvert en testant ce fix sur des données réelles.

## 2. Cas d'étude : THARAUD Sébastien (semaine 36)

Un cours de 240min (`R5.DWeb-DI.06`, groupe `BUT3-G3`, salle `R01`) dont l'enseignant THARAUD Sébastien n'est disponible que le mercredi 8h-12h — soit très exactement la durée du cours, zéro marge. Malgré un score MCV individuellement le plus élevé de toutes les tâches non-enforced du jeu de données (`-240`, contre `-1110` et moins pour toute autre tâche BUT3-G3), ce cours s'est retrouvé neutralisé dans les solutions retournées par `solveWithElimination()` en production, alors qu'un rejeu du même payload avec un budget de recherche plus long (`timeoutSeconds: 180` au lieu de `10`) le place systématiquement sans problème.

Ce cas a révélé plusieurs limites indépendantes du modèle de score actuel, détaillées ci-dessous.

## 3. Limites identifiées du modèle actuel

### 3.1 La disponibilité ignore la contention des autres tâches

Exemple de référence (Frédéric) : une tâche A de 2h dépend d'une ressource R qui a 24h de disponibilité — a priori peu contrainte. Mais si 10 autres tâches de 2h dépendent aussi de R, la ressource est en réalité saturée (20h de demande sur 24h de capacité). Le score actuel, purement local à la tâche, ne voit jamais cette saturation : chaque tâche isolée semble avoir "plein de marge" alors que la ressource partagée est un goulot d'étranglement.

### 3.2 La disponibilité ignore la fragmentation

`Task.getTotalAvailableTime()` (via `Availability.getTotalAvailableTime()`) **somme** la durée de tous les intervalles libres, sans filtrer ceux trop petits pour accueillir la tâche. Exemple : une ressource a 2h de disponibilité totale (1h30 + 30min, deux intervalles disjoints) pour une tâche de 2h — la somme dit "ça passe", la réalité dit non (aucun intervalle unique ne fait 2h). Un score basé sur la somme brute ment sur la faisabilité.

### 3.3 La pause méridienne flottante fausse la disponibilité déclarée

Contrairement à la pause fixe (déduite des disponibilités dès le chargement), la pause flottante (`lunchBreak.type === 'floating'`) n'est vérifiée qu'au moment de tester un créneau précis (`_floatingLBAllows` dans `scheduler.ts`) — elle n'est jamais retranchée de l'`Availability` des ressources. Résultat : toute ressource de type GROUP affiche une disponibilité gonflée sur sa fenêtre de pause potentielle (`[earliest, latest]`), alors qu'en pratique une partie de cette fenêtre (`lunchDuration` minutes) sera immanquablement consommée, juste sans qu'on sache encore où précisément.

### 3.4 Sommer des durées continues entre intervalles disjoints n'a pas de sens univoque

Tentative de correction initiale : `slack = Σ max(0, intervalle.duration − taskDuration)` sur les intervalles utilisables. Ça règle 3.2 (fragmentation) mais introduit un nouveau problème : cette somme mélange deux notions différentes qui ne devraient pas être agrégées par une simple addition — la largeur de glissement *à l'intérieur* d'une fenêtre (flexibilité locale) et le nombre de fenêtres *indépendantes* disponibles (redondance / repli en cas de conflit). Une tâche avec un seul intervalle de 6h pour un besoin de 4h (slack=2h) et une tâche avec deux intervalles de 4h30 sur deux jours différents (slack=1h) obtiennent des scores qui suggèrent la première "plus disponible" — alors que la seconde a un vrai repli sur un second jour si le premier est pris par un concurrent, ce que la première n'a pas du tout.

### 3.5 (Corollaire découvert en cours de route) L'attribution des échecs dans `solveWithElimination()`

Non directement lié au calcul du score, mais observé sur le même cas réel : le compteur `_failureCounts` (`scheduler.ts`) incrémente l'unité *en cours de traitement* au moment où `earlySchedule()` échoue définitivement — mais dans un backtracking chronologique, l'unité qui "porte" l'échec final n'est pas forcément la cause réelle du blocage. THARAUD (zéro alternative) peut accumuler un nombre d'échecs disproportionné simplement parce qu'il est le premier à épuiser ses options quand *n'importe quelle* branche profonde échoue pour une tout autre raison (contention ailleurs, ex. AUBRY Bastien/BUT1). C'est une pathologie connue du backtracking chronologique — voir §4.

## 4. Concepts mobilisés de la littérature (CSP / RCPSP / CP scheduling)

- **MRV / fail-first** (Haralick & Elliott, 1980) : choisir en priorité la variable la plus susceptible d'échouer — le principe déjà visé par le score MCV actuel, mais mal implémenté (cf. §3).
- **Degree heuristic** (Brélaz) : départage par le nombre de contraintes actives — insuffisant seul, ne capture pas la charge réelle d'une ressource.
- **Règles de priorité RCPSP** (synthèse Kolisch & Hartmann, *Experimental investigation of heuristics for RCPSP*) : MSLK (minimum slack), GRPW (déjà proche de notre propagation par dépendants), règles à base de charge de ressource.
- **Edge-finding / raisonnement énergétique** (CP scheduling, contraintes cumulatives — ILOG CP Optimizer, CHIP) : détecter la sursouscription d'une ressource par propagation, avant de plonger dans la recherche combinatoire, plutôt que de la découvrir par échec de backtracking.
- **Backjumping / Conflict-Directed Backjumping** (Gaschnig 1979, Prosser 1993) et **no-good learning** : répondent directement à la pathologie du §3.5 — remonter à la véritable cause du conflit plutôt qu'à la décision la plus récente, et mémoriser les combinaisons prouvées infaisables pour ne pas les ré-explorer.

## 5. Modèle proposé

### 5.1 Unité de mesure : mesure à deux niveaux (nombre de fenêtres indépendantes, puis marge intra-fenêtre)

Un comptage brut de positions (`Σ_intervalles nbPositions`) règle la fragmentation (3.2) mais **ne règle pas 3.4** : il traite les positions comme interchangeables/indépendantes, alors que des positions à l'intérieur d'une même fenêtre sont **corrélées** (une seule tâche concurrente peut en faire disparaître plusieurs d'un coup) tandis que des positions dans des fenêtres disjointes sont **quasi indépendantes** (un conflit sur l'une n'affecte pas l'autre). Un comptage brut classerait par exemple une fenêtre unique de 6h pour une tâche de 4h (5 positions, corrélées) comme "plus disponible" que deux fenêtres disjointes de 4h pile chacune (2 positions, indépendantes) — alors que c'est l'inverse en termes de résilience réelle face à la contention.

Solution retenue : ne pas chercher un scalaire unique, mais **combiner deux signaux par ordre lexicographique** (pratique standard en CSP — le même principe que MRV primaire + degree en départage) :

```
nbPositions(intervalle, taskDuration) =
    floor((intervalle.duration − taskDuration) / SLOT_STEP) + 1   si intervalle.duration ≥ taskDuration
    0                                                              sinon

nbFenêtresUtilisables(t, profil) = nombre d'intervalles maximaux disjoints du profil offrant ≥1 position
slackTotal(t, profil)            = Σ_intervalles nbPositions(intervalle, duration(t))   [tiebreak uniquement]
```

Ordre de priorité : trier par `nbFenêtresUtilisables` **croissant** (peu de fenêtres indépendantes = très prioritaire — cas THARAUD : 1 fenêtre) ; en cas d'égalité, départager par `slackTotal` **croissant**. Vérifié sur les deux exemples : fenêtre unique 6h/tâche 4h → `(nbFenêtres=1, slack=5)` ; deux fenêtres disjointes 4h pile → `(nbFenêtres=2, slack=2)` — la première est correctement classée plus prioritaire (1 < 2 fenêtres), et à nombre de fenêtres égal, THARAUD (`nbFenêtres=1, slack=1` — un seul ajustement pile à la bonne taille offre exactement 1 position, `floor(0/30)+1=1`, pas 0) reste plus prioritaire qu'une tâche à une seule fenêtre plus large (`nbFenêtres=1, slack=5`). *(Précision apportée après implémentation et test de la Phase 1 — la formule donne toujours ≥1 pour un intervalle utilisable, jamais 0 ; seul `nbFenêtresUtilisables=0` signale l'infaisabilité, cf. §5.4.)*

**§6.2 (pondération des positions par emplacement) — clos, hors sujet ici** : ce point relève d'un mécanisme CSP différent — LCV (*Least Constraining Value*, ordonnancement des **valeurs** d'une variable déjà choisie), pas MRV (ordonnancement des **variables**, notre score). La qualité d'une position précise (bord de fenêtre, adjacence à une réservation) concerne le choix du créneau *pour la tâche déjà sélectionnée* — c'est-à-dire `earlySchedule`/`_findFirstSlot`, pas `getSchedulingPriority`. Les deux mécanismes restent volontairement séparés ; `slackTotal`/`nbFenêtresUtilisables` demeurent des comptages purs, non pondérés par position.

### 5.2 Criticité de ressource — décision : demande ferme uniquement, poids appris tenu en réserve

**Décision (Frédéric)** : tester d'abord le mécanisme le mieux fondé (demande ferme, ci-dessous), qui ne nécessite aucune formule devinée. Le "poids appris" façon `dom/wdeg` (dynamique, appris des échecs de recherche — voir discussion complète plus bas) est **explicitement réservé comme option de repli**, à n'implémenter que si les tests sur la demande ferme seule s'avèrent insuffisants — pas de complexité ajoutée par anticipation.

#### Mécanisme retenu : demande ferme, même famille que §5.5 (raisonnement énergétique)

Une tâche dont `r` est la **seule** ressource candidate de son type constitue une consommation *certaine* de `r`, juste pas encore positionnée dans le temps — exactement la même nature d'information que la pause méridienne flottante (§5.5). On applique donc le même principe : réserver virtuellement cette consommation dans le profil de `r`, avant de mesurer.

```
Pour une fenêtre [a,b] du profil de r, et une tâche t dont on calcule le score :
  autresDemandeFerme(r,[a,b]) = Σ duration(t')  pour toute tâche pendante t' ≠ t telle que
                                  r est la SEULE ressource candidate de son type pour t',
                                  et dont le profil chevauche [a,b]

  si autresDemandeFerme(r,[a,b]) ≥ (b−a) :
      → sursaturation prouvée par les AUTRES tâches seules, indépendamment de t
      → infaisabilité à signaler immédiatement (répond à §6.3 — pas besoin d'un mécanisme séparé,
        c'est le même test que la sursaturation par la pause flottante, juste sur une source
        de consommation différente)
  sinon :
      réserver virtuellement autresDemandeFerme(r,[a,b]) minutes dans [a,b]
      (même opération de découpage que §5.5, position canonique à définir de la même façon)
```

**Demande optionnelle (tâches ayant des ressources alternatives à `r`) : délibérément ignorée pour l'instant.** Pas de pondération `1/nbAlternatives` ni aucune autre formule devinée — on ne modélise que ce qui est prouvable. Si les tests montrent que c'est insuffisant (ex. des tâches à alternatives multiples créent quand même de la contention mal anticipée), la piste de repli est un poids par ressource **appris dynamiquement** (incrémenté à chaque échec de backtracking impliquant cette ressource, dans l'esprit de `dom/wdeg` — Boussemart, Hemery, Lecoutre, Sais, 2004), appliqué comme facteur multiplicatif sur `(nbFenêtresUtilisables, slackTotal)` une fois §5.1 calculé. **Nuance importante à ne pas perdre** : `dom/wdeg` est bien établi pour les solveurs CSP génériques, mais les moteurs de scheduling dédiés (CP Optimizer, OR-Tools CP-SAT) s'appuient surtout sur la propagation par contrainte cumulative (edge-finding/énergétique — déjà notre mécanisme pour la demande ferme) plutôt que sur `dom/wdeg` littéralement ; le principe *apprendre des échecs plutôt que deviner* reste solide, mais ce n'est pas une garantie de meilleur résultat ici, d'où la décision de le garder en réserve plutôt que de l'implémenter par défaut. Ce poids appris, s'il est un jour implémenté, servirait aussi directement §6.4 (attribution correcte du blâme dans `solveWithElimination`).

#### Ordre des corrections de profil (trois s'empilent désormais — à fixer explicitement)

Pour une ressource `r` candidate d'un combo, avant intersection avec les autres ressources du combo :
```
1. profil brut de r.availability
2. si r est de type GROUP et soumise à une pause flottante : découpage §5.5
3. correction de demande ferme §5.2 (ci-dessus)
   → profil corrigé pour r
```
Puis, pour le combo entier : intersection des profils corrigés de toutes les ressources du combo (§5.3) → `ownProfile(t, combo)`. Puis, entre combos : max lexicographique (§5.3) → `ownProfile(t)`. Puis, si `t` a des dépendants : troncature par échéance (§5.6) → `effectiveProfile(t)`. Enfin : mesure de §5.1 sur `effectiveProfile(t)`.

Logique de l'ordre : §5.5/§5.2 sont des propriétés de la ressource elle-même (indépendantes de la position de `t` dans un éventuel enchaînement de dépendances) et s'appliquent donc en amont, ressource par ressource ; §5.6 dépend de la position de `t` dans son propre arbre de dépendance et ne peut s'appliquer qu'après avoir déterminé le profil complet de la meilleure combinaison.

### 5.3 Agrégation combo / ressources — **correction** par rapport à la version précédente de ce document

Erreur trouvée en relisant l'implémentation v1 existante : contrairement à ce qu'affirmait une version antérieure de ce document, l'agrégation *à l'intérieur d'un combo* ne doit **pas** être un `min` sur des mesures calculées séparément par ressource. Un `min` de tailles de domaine indépendantes ne donne pas la taille du domaine des positions *simultanément* valides pour toutes les ressources du combo — contre-exemple : ressource A libre à {8h, 8h30, 9h} (3 positions), ressource B libre à {10h, 10h30} (2 positions) → `min(3,2)=2` suggère de la marge, alors que l'intersection réelle (positions valides pour A **et** B en même temps) est vide.

L'implémentation v1 fait déjà la bonne chose : `Task._intersectResources(combo)` intersecte les profils de disponibilité de toutes les ressources du combo **avant** tout calcul de mesure. C'est cette étape qu'il faut conserver et sur laquelle appliquer §5.1 :

- **Dans un combo** : intersecter d'abord les profils des ressources du combo (`_intersectResources`, déjà en place), puis calculer `(nbFenêtresUtilisables, slackTotal)` sur le profil **résultant de l'intersection** — pas de `min` séparé par ressource.
- **Entre combos alternatifs** : la tâche choisit son meilleur plan → **max lexicographique** sur les combos (préférer le combo offrant le plus de fenêtres indépendantes, puis le plus de marge) — même logique directionnelle que l'actuel `getBestApplicableAvailableTime()` (§1), juste appliquée à la paire au lieu d'un scalaire.
- **Agrégation de groupe** (`TaskGroupUnit`, plusieurs tâches membres) — **seconde correction, même défaut que ci-dessus** : un `min` lexicographique sur des mesures calculées *indépendamment* par membre souffre du même problème que le `min` inter-ressources d'un combo. Contre-exemple identique : membre 1 libre à {8h, 8h30, 9h} (3 positions), membre 2 libre à {10h, 10h30} (2 positions) — pour un groupe `parallel` (démarrage simultané obligatoire), `min(3,2)=2` suggère de la marge alors que l'intersection réelle (instants valides pour les deux membres **en même temps**) est vide. La v1 actuellement en production a ce même défaut (`Math.min(...tasks.map(t => t.getBestApplicableAvailableTime()))`, `taskGroupUnit.ts`). Remplacé par le calcul exact de §5.6.
- **Propagation aux dépendants** : ~~`max` lexicographique~~ — **remplacé** par la troncature de profil de §5.6, qui subsume et corrige à la fois le `max` (déjà en production) et la tentative de `somme` de l'engin antérieur (voir §5.6 pour la justification complète — aucun des deux ne donne la bonne valeur sur un cas chiffré).

*Note d'implémentation* : la comparaison lexicographique de paires `(nbFenêtres, slack)` n'est pas un simple `Math.min`/`Math.max` sur un nombre — nécessite soit un comparateur dédié, soit un encodage ordonné (ex. `nbFenêtres * GRANDE_CONSTANTE − slack`, en soignant le sens de chaque composante) pour rester compatible avec les agrégations `min`/`max` existantes.

### 5.4 Distinction infaisabilité vs simplement très contraint

`nbFenêtresUtilisables = 0` est le signal recherché : aucun intervalle utilisable du tout (impossible), à distinguer de `nbFenêtresUtilisables ≥ 1` (au moins un intervalle pile à la bonne taille, faisable, `slackTotal` minimal — cas THARAUD, `slackTotal=1`, jamais 0 pour un cas faisable). Contrairement au `domainSize` scalaire de la version précédente de ce document (qui rendait 0 ambigu entre "infaisable" et "faisable mais très serré"), la mesure à deux niveaux **distingue déjà nativement** les deux situations via `nbFenêtresUtilisables` — plus besoin d'un test binaire séparé. Le cas `nbFenêtresUtilisables = 0` doit remonter comme une contradiction à traiter immédiatement plutôt qu'un simple score.

### 5.5 Pause méridienne flottante : découpage conservateur en deux fenêtres

**Précision apportée après relecture** : la formulation initiale ("amputer `lunchDuration` minutes de la portion chevauchante") était ambiguë sur un point qui compte énormément pour §5.1 — rogner un bord de l'intervalle (le rétrécir en gardant un seul morceau) ne suffit pas. En pratique, une pause de midi coupera nécessairement une large plage (ex. `8h-17h`) en **deux** fenêtres distinctes (matin/après-midi), et c'est ce que `nbFenêtresUtilisables` (§5.1, signal *primaire* du modèle) doit refléter — un simple rognage d'un seul bord laisserait à tort un seul intervalle rétréci.

Algorithme précisé : pour tout intervalle `[a,b]` chevauchant `[earliest, latest]` (pause flottante de durée `lunchDuration`), sur une ressource de type GROUP :

```
overlapStart = max(a, earliest)
overlapEnd   = min(b, latest)
milieu       = (overlapStart + overlapEnd) / 2
cutStart     = milieu − lunchDuration/2
cutEnd       = milieu + lunchDuration/2

[a,b] devient { [a, cutStart], [cutEnd, b] }   (morceaux vides ou < SLOT_STEP retirés)
```

Exemple : `[8h,17h]` avec `[earliest,latest]=[11h30,14h30]`, `lunchDuration=90min` → coupure `[12h15,13h45]` → deux fenêtres `[8h,12h15]` (255min) et `[13h45,17h]` (195min) — total 450min = 540−90 (la durée de la pause est bien intégralement comptée), et surtout **deux fenêtres**, conforme à la réalité.

**Le choix du milieu de la zone de chevauchement comme point de coupure est une simplification assumée, pas une garantie de pire cas** : la position réelle de la pause n'est connue qu'au moment du placement (`_floatingLBAllows`), potentiellement différente chaque jour. Le milieu est une position canonique raisonnable pour une mesure heuristique de *score*, symétrique et simple — pas un calcul rigoureux de disponibilité garantie. Comme précédemment : correctif de *lecture* uniquement, la logique de placement réelle reste inchangée et gérée au moment du `book()`.

### 5.6 Propagation aux dépendants : troncature de profil par échéance (remplace le `max`/la `somme`)

**Origine** : sur un exemple à trois tâches liées `CM → TD → TP` avec des scores individuels identiques (200, 200, 200), ni la `somme` (utilisée par un moteur antérieur — donnerait 600, surestime, l'ancien moteur le faisait volontairement pour garantir un placement précoce du CM, mais sans base rigoureuse) ni le `max` actuellement en production (équivalent à un `min` des marges individuelles sur l'échelle positive) ne donnent la bonne réponse dans le cas général. Vérifié par un calcul complet (passe avant/arrière façon méthode du chemin critique — voir définitions ci-dessous) sur un exemple chiffré asymétrique : CM disponible sur `[0,1000]`, TD sur `[500,600]`, TP sur `[560,620]`, durées 60 chacune → la vraie marge de CM est **440 minutes**, alors que le `max` actuel donne **0** (sous-estimation sévère) et la somme des marges isolées donnerait 980 (sur-estimation sévère). Aucune combinaison simple (min/max/somme) de scores calculés indépendamment par tâche ne peut être correcte : il faut une vraie récursion sur les *dates*, pas sur des *scores* déjà agrégés.

**Principe retenu** : au lieu de combiner des scores, on **tronque le profil de disponibilité** de chaque tâche selon l'échéance imposée par ses dépendants, *avant* de lui appliquer §5.1. La passe avant (dates au plus tôt) n'a pas besoin d'être calculée séparément — elle est implicitement portée par ce qui reste du profil après troncature ; seule la passe arrière (dates au plus tard) est nécessaire.

```
Cas feuille (aucun dépendant) :
  effectiveProfile(U) = ownProfile(U)                    [profil de la meilleure combinaison, §5.3]

Cas U avec dépendants D1..Dk :
  Pour chaque Di :
    LS(Di) = fin du dernier intervalle utilisable de effectiveProfile(Di) − duration(Di)
             [recherche arrière — symétrique de _findFirstSlot, mais en partant de la fin du profil ;
              nouvelle fonction _findLastSlot]

  échéance(U) = min(LS(D1), ..., LS(Dk))
                [U doit finir avant CHAQUE dépendant → borné par le plus pressé]

  effectiveProfile(U) = ownProfile(U) tronqué à droite de échéance(U)
                        (chaque intervalle [a,b] devient [a, min(b, échéance(U))],
                         on retire les intervalles devenus vides ou < duration(U))

(nbFenêtresUtilisables(U), slackTotal(U)) = mesure de §5.1 appliquée à effectiveProfile(U)
```

Vérification sur l'exemple chiffré : `effectiveProfile(TP)=[560,620]` → `LS(TP)=560`. `effectiveProfile(TD)=[500,600]` tronqué à droite de 560 `=[500,560]` → `LS(TD)=500`. `effectiveProfile(CM)=[0,1000]` tronqué à droite de 500 `=[0,500]` → marge `500−60=440`. Conforme au calcul manuel.

**Invariant important** : `effectiveProfile` est une vue **calculée, éphémère, en lecture seule**, utilisée uniquement pour évaluer `getSchedulingPriority()`. Elle ne modifie jamais `Resource.availability` (l'objet réel muté par `book()`/`unBook()`). `earlySchedule()` continue de chercher un créneau sur la disponibilité **réelle, non tronquée** — si l'échéance estimée s'avère pessimiste dans un cas limite, on ne veut pas empêcher un placement qui reste en réalité possible. La troncature n'influence que l'**ordre** d'essai des tâches, jamais la **faisabilité réelle** testée au moment du placement.

#### Cas `TaskGroupUnit` comme dépendant (ou comme ayant lui-même des dépendants)

Il faut définir `ownProfile(groupe)` — le profil des instants d'ancrage valides pour le groupe entier — pour pouvoir lui appliquer exactement la même récursion (`LS`, troncature, §5.1) que pour une `TaskUnit`. Deux opérations de base :

```
reduce(profil, d) : transforme un profil BRUT de disponibilité en profil des DÉBUTS valides —
  chaque intervalle [a,b] devient [a, b−d] (retiré si b−d < a)
```

`§5.1 = countPositions(reduce(ownProfile, duration))` pour une `TaskUnit` — la même formule, juste décomposée en deux étapes pour réutiliser `reduce` ci-dessous.

**Groupe `parallel`** (tous les membres démarrent au même instant, durées potentiellement différentes) :
```
ownProfile(groupe) = ∩ᵢ reduce(profil_i, duration_i)
```
Un instant `t` n'est un début de groupe valide que si TOUS les membres peuvent y démarrer, chacun pour sa propre durée — l'intersection des profils de débuts *déjà réduits* capture ça même avec des durées différentes.

**Groupe `sequential`** (ordre fixe, **aucun trou** — début(suivant) = fin(précédent)) :
```
offset_i = somme des durées des membres AVANT i dans l'ordre du groupe
ownProfile(groupe) = ∩ᵢ [ reduce(profil_i, duration_i) décalé de −offset_i ]
```
Pour chaque membre, on calcule ses débuts valides propres puis on les décale vers la gauche de son offset dans la séquence — ça donne les instants d'ancrage du groupe qui placeraient *ce* membre pile à sa position. L'intersection sur tous les membres donne les seuls ancrages valides pour toute la séquence sans trou.

Dans les deux cas, `(nbFenêtresUtilisables, slackTotal)` du groupe `= countPositions(ownProfile(groupe))` directement (pas de réduction supplémentaire, déjà faite membre par membre) ; et si le groupe a lui-même des dépendants, `effectiveProfile(groupe)` se calcule par la même troncature que pour une `TaskUnit`, en utilisant `ownProfile(groupe)` comme point de départ. `LS(groupe) = fin du dernier intervalle de effectiveProfile(groupe)` — cohérent de bout en bout, qu'un dépendant soit une `TaskUnit` ou un `TaskGroupUnit`.

Ceci **corrige aussi** l'agrégation de groupe de §5.3 (`min` lexicographique sur les membres, présente en v1 production) — même défaut que le `min` inter-ressources d'un combo (§5.3) : `min` de mesures indépendantes ≠ mesure de l'intersection réelle.

#### Coût de calcul et piste d'optimisation future (non implémentée)

`getSchedulingPriority()` n'est aujourd'hui pas mis en cache — recalculé à chaque appel de `_dynamicSort`. La troncature ajoute un parcours récursif de l'arbre de dépendance à chaque calcul. Avec une profondeur typique ≤3 (cas `CM/TD/TP`), le surcoût reste négligeable et **aucune optimisation n'est proposée pour l'instant**.

Si la profondeur des arbres de dépendance venait à augmenter significativement, piste à envisager *alors seulement* (ne pas préimplémenter) : mémoïser `effectiveProfile(U)` par unité, invalidé exactement comme `_bestAvailableTime` l'est aujourd'hui (`invalidateSchedulable()`), mais en propageant l'invalidation **vers le haut** le long de `_dependsOn` — si le profil d'un dépendant change, l'échéance (et donc `effectiveProfile`) de tous ses ancêtres dans la chaîne doit être recalculée. C'est une invalidation en cascade, plus large que l'invalidation actuelle (qui ne touche que les tâches partageant une ressource), à concevoir spécifiquement si ce besoin se présente.

### 5.7 `solveWithElimination()` : attribution du blâme par occupation réelle, pas par tour de rôle (décidé)

**Constat (§3.5)** : `_failureCounts` incrémente l'unité *dont c'était le tour* au moment où `earlySchedule()` échoue définitivement — mais dans un backtracking chronologique, ce n'est pas forcément la cause réelle du blocage. Confirmé empiriquement sur le cas THARAUD (production) : 903 343 échecs comptabilisés contre THARAUD (zéro alternative), qui n'est pourtant pas la cause du blocage réel (contention AUBRY Bastien/BUT1 ailleurs dans le graphe).

**Niveau d'ambition retenu (le plus mesuré des trois envisagés)** : ne pas toucher au flux de contrôle de `_backtrack` (pas de vrai backjumping, pas de no-good learning pour l'instant — cohérent avec la discipline déjà appliquée en §5.2 : tester le mécanisme le moins invasif d'abord). On corrige uniquement **ce que `solveWithElimination` compte**, pas comment `_backtrack` explore.

**Mécanisme** : quand `unit.earlySchedule(fromTime)` échoue, au lieu de `failureCounts.get(unit.id)++`, identifier — pour les ressources candidates de `unit` — quelles réservations *actuellement actives* dans `_solution` occupent les créneaux qui auraient permis de placer `unit`, et incrémenter le compteur de **ces unités occupantes**, pas celui de `unit`. C'est une application ciblée du principe du *conflict set* (Gaschnig 1979, Prosser 1993 — CBJ) : identifier les décisions réellement en conflit, mais seulement pour éclairer le choix de la cible d'élimination, sans changer l'ordre d'exploration lui-même.

**Granularité et découplage (décidés)** :
- Blâme porté sur l'**unité occupante**, pas sur une ressource abstraite — plus simple, suffisant pour corriger le symptôme observé.
- Ce compteur reste **local à `solveWithElimination`** — délibérément **découplé** du poids appris réservé en §5.2 (`dom/wdeg`-style). Pas d'unification anticipée entre les deux mécanismes tant que chacun n'a pas été testé isolément.

**Portée** : concerne `packages/scheduler-core/src/scheduler.ts` (`_backtrack`, le point où `_failureCounts` est incrémenté ; `solveWithElimination`, la sélection de la cible). N'affecte pas `getSchedulingPriority`/le modèle de score des §5.1-§5.6.

## 6. Points ouverts (non tranchés)

Aucun. Tous les points précédemment listés sont désormais tranchés :

1. ~~Pondération de la demande optionnelle~~ — **tranché** (§5.2) : non modélisée pour l'instant, poids appris en réserve explicite.
2. ~~Pondération des positions selon leur emplacement~~ — **clos** (§5.1) : hors sujet, relève de LCV/`earlySchedule`.
3. ~~Court-circuit d'infaisabilité~~ — **résolu** comme sous-produit de §5.2 (sursaturation par demande ferme = test binaire immédiat).
4. ~~Évolution de `solveWithElimination()`~~ — **tranché** (§5.7) : attribution du blâme par occupation réelle, découplée de §5.2.

## 7. Implications sur le code existant (pour référence future — non implémenté)

- `packages/scheduler-common/src/task.ts` : `getBestApplicableAvailableTime()` à remplacer par une méthode retournant la paire `(nbFenêtresUtilisables, slackTotal)` (§5.1), calculée sur le résultat de `_intersectResources()` (conservé tel quel, §5.3) plutôt que sur `getTotalAvailableTime()`. Le type de retour change (paire, pas un `number`) — impacte tous les appelants. Nouvelle fonction `_findLastSlot` (§5.6), symétrique de `_findFirstSlot` existante.
- `packages/scheduler-core/src/taskUnit.ts`, `taskGroupUnit.ts` : `getSchedulingPriority()` à réécrire entièrement autour de la troncature de profil par échéance (§5.6) — remplace le `max` (`taskUnit.ts`) et le `min` sur les membres (`taskGroupUnit.ts`) actuellement en production. `TaskGroupUnit` a en plus besoin du calcul de `ownProfile(groupe)` par intersection de profils réduits (§5.6, parallel/sequential distincts).
- `packages/scheduler-core/src/scheduler.ts` : `_applyLunchBreak`/`_floatingLBAllows` concernés par §5.5 ; `_backtrack`/`solveWithElimination`/`_failureCounts` à modifier selon §5.7 (attribution du blâme par occupation réelle).
- Nécessite un index ressource → tâches pendantes à demande ferme (pour calculer `autresDemandeFerme`, §5.2) — structure nouvelle, à concevoir en s'appuyant sur l'existant (`Resource.getTasks()` déjà utilisé pour l'invalidation du cache de disponibilité). Plus simple que prévu initialement : demande optionnelle non modélisée, donc pas besoin de suivre `nbAlternatives` par tâche pour cet index.
- Cas réel THARAUD (semaine 36) disponible comme fixture de test potentielle : `packages/scheduler-core/data/payload.json` (payload exact envoyé par le client, avec `options.lunchBreak.type === 'fixed'`) — utile pour un test de non-régression une fois l'implémentation commencée, même si ce cas particulier n'est pas concerné par le raffinement floating-lunch (§5.5, cas fixed uniquement dans ce payload).
- Cas `CM/TD/TP` (§5.6) à couvrir par un test dédié, construit à la main (comme `schedulingPriority.test.ts` existant) : au minimum le cas chiffré asymétrique de §5.6 (marge attendue = 440) en régression, plus un cas groupe `sequential` (offset/pas-de-trou) et un cas groupe `parallel` (intersection, durées différentes).

## 8. Statut

**Conception terminée.** Tous les points sont tranchés : §5.1 (mesure à deux niveaux), §5.3 (agrégation combo/groupe corrigée), §5.4 (signal d'infaisabilité natif), §5.5 (pause flottante, découpage en deux fenêtres), §5.6 (troncature par échéance pour les dépendants, `TaskUnit` et `TaskGroupUnit`), §5.2 (criticité de ressource — demande ferme uniquement, poids appris en réserve), §5.7 (attribution du blâme par occupation réelle dans `solveWithElimination`). Prochaine étape : plan d'implémentation incrémental (voir suivi séparé).
