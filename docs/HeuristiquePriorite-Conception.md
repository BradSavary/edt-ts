# Conception de l'heuristique de priorité MCV — v2

Ce document a une double vocation. **Historiquement**, c'est un document de conception : il part d'un cas réel observé en production (§2) pour identifier les limites du modèle de score existant (§3), les repositionner par rapport à la littérature CSP/RCPSP/CP-scheduling (§4), puis proposer et justifier un nouveau modèle (§5). **Aujourd'hui**, la majeure partie de ce modèle est implémentée et en production — ce document sert donc aussi de **référence** pour comprendre le fonctionnement réel du moteur de planification, section par section, avec des exemples et le pseudocode des méthodes effectivement en place.

**État d'implémentation** (détail en §8) : §5.1 (mesure à deux niveaux), §5.3 (agrégation combo/groupe), §5.4 (signal d'infaisabilité), §5.5 (pause flottante), §5.6 (troncature par échéance, chaîne et dépendants multiples) et §5.7 (attribution du blâme dans `solveWithElimination`) sont **implémentés, testés et en production**. Seul §5.2 (criticité de ressource par demande ferme) reste une **proposition non implémentée** — signalée comme telle à chaque fois qu'elle apparaît ci-dessous.

## 1. Contexte et historique

Une première réécriture de `getSchedulingPriority()` (`TaskUnit`/`TaskGroupUnit`, `packages/scheduler-core`) a déjà corrigé un bug majeur : le score lisait `task.appliedResources` (vide avant réservation), donnant un score constant à toute tâche non encore placée. Le fix : `Task.getBestApplicableAvailableTime()` explore désormais `getApplicableResources()` (toutes les combinaisons candidates) et prend le max du total de disponibilité par combinaison. Agrégation `min` pour les groupes, propagation `max` (pas somme) vers les dépendants. Ce fix est en production et reste valide, sous réserve de deux pièges rencontrés à l'implémentation, à garder en tête pour toute évolution future de ce code :

1. **Ordre de dépendances** : la propagation vers les dépendants suppose que le score du dépendant est déjà à jour au moment où on calcule celui de la tâche qui en dépend — un mauvais ordre de parcours de l'arbre de dépendances peut propager une valeur périmée.
2. **Inversion de signe** : le score combine des grandeurs qui doivent toutes pointer dans le même sens (plus grand = plus urgent) avant d'être comparées ou combinées — une seule négation oubliée ou dupliquée quelque part dans la chaîne suffit à inverser silencieusement l'ordre de priorité sans qu'aucun test simple ne le révèle.

**Exemple simpliste du bug corrigé.** Imaginez une todo-list dont chaque tâche affiche « ressources utilisées : ___ » — un champ qui ne se remplit qu'une fois la tâche cochée. Trier par « nombre de ressources utilisées » donnerait 0 pour absolument toutes les tâches non cochées, quelle que soit leur difficulté réelle : le tri serait inopérant avant même de commencer. C'est exactement ce que faisait `task.appliedResources` — vide pour toute tâche pas encore placée, donc un score MCV constant pour l'écrasante majorité des tâches au moment précis où ce tri compte le plus.

Ce document part d'un **second problème**, plus profond, découvert en testant ce fix sur des données réelles.

## 2. Cas d'étude : THARAUD Sébastien (semaine 36)

Un cours de 240min (`R5.DWeb-DI.06`, groupe `BUT3-G3`, salle `R01`) dont l'enseignant THARAUD Sébastien n'est disponible que le mercredi 8h-12h — soit très exactement la durée du cours, zéro marge :

```
Mercredi   8h        9h        10h       11h       12h
           |---------------------------------------|
           |            cours (240 min)             |
           |---------------------------------------|
           ←   disponibilité THARAUD (240 min)   →
```

Un seul créneau possible, zéro degré de liberté — c'est exactement le profil qu'un score MCV bien conçu doit reconnaître comme le plus prioritaire de tous.

Pourtant, malgré un score MCV individuellement le plus élevé de toutes les tâches non-enforced du jeu de données (`-240`, contre `-1110` et moins pour toute autre tâche BUT3-G3), ce cours s'est retrouvé neutralisé dans les solutions retournées par `solveWithElimination()` en production, alors qu'un rejeu du même payload avec un budget de recherche plus long (`timeoutSeconds: 180` au lieu de `10`) le place systématiquement sans problème.

Ce cas a révélé plusieurs limites indépendantes du modèle de score actuel, détaillées ci-dessous.

## 3. Limites identifiées du modèle actuel

### 3.1 La disponibilité ignore la contention des autres tâches

**Problème.** Le score d'une tâche ne doit pas seulement refléter *sa propre* disponibilité, mais sa disponibilité **compte tenu de la concurrence** des autres tâches qui visent la même ressource. Le modèle actuel calcule chaque score indépendamment, sans jamais regarder ce que demandent les autres tâches pendantes sur la même ressource.

**Exemple** (Frédéric) : une tâche A de 2h dépend d'une ressource R qui a 24h de disponibilité — a priori peu contrainte. Mais si 10 autres tâches de 2h dépendent aussi de R, la ressource est en réalité saturée (20h de demande sur 24h de capacité). Le score actuel, purement local à la tâche, ne voit jamais cette saturation : chaque tâche isolée semble avoir « plein de marge » alors que la ressource partagée est un goulot d'étranglement.

```
score_actuel(A) = disponibilité(R) = 24h     // ne regarde que R, jamais les 10 concurrentes
```

**Où c'est traité dans ce document** : partiellement, par le mécanisme de demande ferme (§5.2 — **non implémenté à ce jour**) ; le raisonnement énergétique complet (§4.4), qui couvrirait aussi la demande *optionnelle*, reste hors scope (décision explicite en §5.2 de ne pas le modéliser pour l'instant).

### 3.2 La disponibilité ignore la fragmentation

**Problème.** Une mesure de disponibilité par simple somme des durées libres ignore qu'une tâche a besoin d'un **seul intervalle continu** suffisamment large, pas d'un total fragmenté sur plusieurs intervalles trop petits pris isolément.

**Exemple** : une ressource a 2h de disponibilité totale (1h30 + 30min, deux intervalles disjoints) pour une tâche de 2h — la somme dit « ça passe », la réalité dit non (aucun intervalle unique ne fait 2h).

```
// Mécanisme réel critiqué ici (Availability.getTotalAvailableTime()) :
getTotalAvailableTime(profil) = Σ_intervalles (intervalle.end - intervalle.start)
// 1h30 + 30min = 2h → "disponible", alors qu'aucun intervalle ne fait 2h d'un seul tenant
```

**Où c'est corrigé** : §5.1 (**implémenté**) — comptage par positions réellement plaçables (`nbPositions`), pas par somme brute.

### 3.3 La pause méridienne flottante fausse la disponibilité déclarée

**Problème.** Contrairement à la pause fixe (déduite des disponibilités dès le chargement), la pause flottante (`lunchBreak.type === 'floating'`) n'est vérifiée qu'au moment de tester un créneau précis — elle n'est jamais retranchée de l'`Availability` des ressources en amont.

```
// Mécanisme réel (scheduler.ts, _floatingLBAllows) — vérifie qu'un créneau CANDIDAT
// laisse structurellement la place à la pause, mais seulement au moment de tester
// CE créneau précis, jamais en amont :
_floatingLBAllows(candidat, duration):
    reste-t-il, dans [earliest,latest] une fois `candidat` réservé, au moins
    `lunchDuration` minutes libres pour chaque ressource GROUP concernée ?
```

Résultat : toute ressource de type GROUP affiche une disponibilité gonflée sur sa fenêtre de pause potentielle (`[earliest, latest]`), alors qu'en pratique une partie de cette fenêtre (`lunchDuration` minutes) sera immanquablement consommée, juste sans qu'on sache encore où précisément.

**Où c'est corrigé** : §5.5 (**implémenté**) — le score intègre désormais un découpage anticipé de cette fenêtre. `_floatingLBAllows` reste la vérité de placement au moment du `book()`, inchangée ; les deux mécanismes coexistent délibérément (voir l'invariant lecture/écriture rappelé en §5.6).

### 3.4 Sommer des durées continues entre intervalles disjoints n'a pas de sens univoque

**Formule envisagée, puis écartée** (jamais mergée en production, discutée pendant la conception) :

```
slack(t, profil) = Σ_intervalles max(0, intervalle.duration − duration(t))
```

Ça règle 3.2 (fragmentation) mais introduit un nouveau problème : cette somme mélange deux notions différentes qui ne devraient pas être agrégées par une simple addition — la largeur de glissement *à l'intérieur* d'une fenêtre (flexibilité locale) et le nombre de fenêtres *indépendantes* disponibles (redondance / repli en cas de conflit).

**Exemple** : une tâche avec un seul intervalle de 6h pour un besoin de 4h (`slack=2h`) et une tâche avec deux intervalles de 4h30 sur deux jours différents (`slack=1h`) obtiennent des scores qui suggèrent la première « plus disponible » — alors que c'est l'inverse en termes de résilience réelle : la seconde a un vrai repli sur un second jour si le premier est pris par un concurrent, ce que la première n'a pas du tout.

**Où c'est corrigé** : §5.1 (**implémenté**) — mesure à deux niveaux, qui sépare explicitement les deux notions au lieu de les additionner.

### 3.5 (Corollaire découvert en cours de route) L'attribution des échecs dans `solveWithElimination()`

**Problème**, non directement lié au calcul du score mais observé sur le même cas réel :

```
// Mécanisme réel actuel, toujours en production (scheduler.ts, _backtrack) :
si earlySchedule(unit) échoue définitivement:
    failureCounts[unit.id]++     // incrémente l'unité SUR LE POINT D'ÉCHOUER,
                                  // pas forcément la cause réelle du blocage
```

Dans un backtracking chronologique, l'unité qui « porte » l'échec final n'est pas forcément la cause réelle du blocage. THARAUD (zéro alternative) peut accumuler un nombre d'échecs disproportionné simplement parce qu'il est le premier à épuiser ses options quand *n'importe quelle* branche profonde échoue pour une tout autre raison (contention ailleurs, ex. AUBRY Bastien/BUT1). C'est une pathologie connue du backtracking chronologique — voir §4.5.

**Où c'est traité** : §5.7 (**non implémenté à ce jour**) — proposition d'attribution du blâme par occupation réelle.

## 4. Concepts mobilisés de la littérature (CSP / RCPSP / CP scheduling)

Aucune des idées ci-dessous n'est inventée pour ce projet : ce sont des résultats établis en recherche opérationnelle et en programmation par contraintes, chacun répondant à un problème précis rencontré par *tout* moteur de planification par backtracking, pas seulement le nôtre. Cette section explique, pour chaque concept, **quel problème concret** son article de référence cherche à résoudre, **comment** il le résout, et donne un **exemple volontairement simpliste** (hors du domaine « emploi du temps ») pour rendre le principe intuitif avant de le retrouver appliqué à notre cas au §5.

### 4.1 MRV / fail-first (Haralick & Elliott, 1980)

**Problématique visée.** Dans un CSP résolu par backtracking, l'ordre dans lequel les variables sont assignées change radicalement la taille de l'arbre de recherche exploré. Haralick & Elliott (*Increasing tree search efficiency for constraint satisfaction problems*, 1980) montrent qu'un ordre naïf (par exemple l'ordre d'apparition dans les données d'entrée) peut faire exploser ce nombre de nœuds par rapport à un ordre bien choisi, alors que le problème résolu est strictement le même.

**Principe.** MRV signifie *Minimum Remaining Values* — on choisit en priorité la variable dont il reste le **moins** de valeurs possibles dans son domaine. D'où le surnom "fail-first" : si cette variable est de toute façon condamnée à échouer, autant le découvrir tout de suite, avec peu de décisions encore empilées à défaire, plutôt que de le découvrir tard, après avoir construit une longue branche qui devra de toute façon être abandonnée.

**Exemple simpliste.** Un sudoku partiellement rempli. Une case où un seul chiffre reste possible doit être traitée avant une case où 5 chiffres restent possibles : la remplir ne coûte rien, et peut immédiatement révéler une contradiction (si ce chiffre est déjà présent ailleurs sur la même ligne) — bien avant qu'on ait perdu du temps à explorer les 5 branches d'une case ambiguë.

**Lien avec cette conception.** C'est le principe que `getSchedulingPriority()` vise depuis l'origine : trier les tâches par "nombre de façons de les placer" et traiter en premier celle qui en a le moins (cf. §1). Tout le §5 de ce document consiste à définir *correctement* ce "nombre de façons de placer une tâche" dans un contexte bien plus riche qu'un sudoku — ressources partagées entre tâches, groupes de tâches simultanées, pauses qui grignotent la disponibilité, dépendances entre tâches.

### 4.2 Degree heuristic (Brélaz, 1979)

**Problématique visée.** MRV départage bien les variables tant que leurs domaines résiduels diffèrent. Mais à *égalité* de domaine résiduel, quel critère utiliser ? Brélaz (*New methods to color the vertices of a graph*, 1979 — l'algorithme DSATUR de coloration de graphe) propose un critère de repli pour ce cas.

**Principe.** À égalité de domaine résiduel, préférer la variable impliquée dans le plus grand nombre de contraintes *actives* (le plus haut degré dans le graphe de contraintes). C'est celle dont l'assignation réduira le domaine du plus grand nombre d'autres variables d'un coup — donc celle dont retarder le traitement coûte le plus cher en opportunités de propagation perdues.

**Exemple simpliste.** Coloration de carte géographique : deux régions non encore coloriées ont chacune exactement 2 couleurs possibles (égalité MRV). L'une ne touche qu'1 voisine, l'autre en touche 4. Colorier la seconde en premier a plus de chances de contraindre immédiatement ses 4 voisines — et donc de révéler vite un éventuel blocage — que de colorier la première, dont l'effet reste isolé.

**Limite pour ce projet.** Le "degré" (nombre de contraintes actives) ne capture pas la charge *réelle* imposée sur une ressource partagée : deux tâches liées à la même salle comptent chacune pour "1 contrainte", que cette salle soit occupée à 10 % ou à 95 % par ailleurs. §3.1 identifie précisément cette limite pour notre cas ; §5.2 la corrige non pas avec un degré générique, mais avec un test spécifique au scheduling (saturation par demande ferme), plus proche en esprit du raisonnement énergétique (§4.4) que du degree heuristic générique.

### 4.3 Règles de priorité RCPSP (synthèse Kolisch & Hartmann)

**Problématique visée.** Le RCPSP (*Resource-Constrained Project Scheduling Problem*) est le problème NP-difficile qui généralise exactement notre situation : des tâches liées par des relations de précédence, consommant des ressources en capacité limitée, à ordonnancer pour respecter les contraintes. Kolisch & Hartmann (*Experimental investigation of heuristics for the resource-constrained project scheduling problem*, 1999, mis à jour en 2006) comparent empiriquement des dizaines de règles de priorité utilisées par les heuristiques de construction de planning (SGS — *Schedule Generation Scheme* — un algorithme glouton à passe unique, différent d'un backtracking mais confronté au même besoin d'ordonner les tâches).

**Règles pertinentes ici** :
- **MSLK (Minimum Slack)** — priorité à la tâche dont la marge totale (date au plus tard − date au plus tôt, calculée par la méthode du chemin critique) est la plus faible. C'est l'ancêtre conceptuel direct de la mesure retenue en §5.1 et §5.6 : mesurer la marge *réellement* disponible compte tenu de tout le graphe de dépendances, pas une approximation purement locale à la tâche.
- **GRPW (Greatest Rank Positional Weight)** — priorité à la tâche dont la durée propre, **plus** la somme des durées de tous ses successeurs, est la plus grande : celle qui "porte" la plus longue chaîne de travail en aval. Intuition : la retarder retarde potentiellement toute une chaîne. Ancêtre conceptuel de la propagation aux dépendants (§5.6) — mais GRPW agrège les durées par une simple **somme**, une approximation ; §5.6 montre au contraire, sur un exemple chiffré, que sommer les durées donne une réponse fausse, et calcule la vraie marge par récursion sur les dates plutôt que par combinaison de scores.
- **Règles à base de charge de ressource** (par ex. WRUP — *Weighted Resource Utilization Ratio*) — priorité aux tâches qui consomment les ressources les plus demandées ailleurs dans le planning. Ancêtre conceptuel direct de la demande ferme (§5.2) et du raisonnement énergétique (§4.4).

**Exemple simpliste (MSLK).** Trois tâches en chaîne A → B → C, chacune de 1h, le projet devant finir à H+10 : la marge totale à répartir est de 7h. Si un aléa impose que B ne peut en réalité démarrer qu'à partir de H+5, la marge réelle de A n'est plus 7h mais 4h (les 5h de marge de B, moins l'heure que B lui-même consomme). MSLK recalcule cette marge en tenant compte de toute la chaîne, pas seulement de A isolément — c'est très exactement le calcul en passe arrière détaillé au §5.6.

**Lien avec cette conception.** Ce document ne reprend aucune de ces formules telle quelle — elles datent d'une époque de solveurs gloutons à une seule passe (SGS), pas d'un backtracking avec retour arrière comme le nôtre. Mais le *problème* qu'elles posent (mesurer une vraie marge tenant compte des dépendances, pas un score local) est exactement celui résolu au §5.6 ; la solution retenue (recalcul par les dates plutôt que par combinaison de scores déjà agrégés) est un raffinement de l'esprit MSLK plutôt qu'une réinvention.

### 4.4 Edge-finding / raisonnement énergétique (contraintes cumulatives)

**Problématique visée.** Dans les moteurs de programmation par contraintes dédiés au scheduling (ILOG CP Optimizer, CHIP, et aujourd'hui OR-Tools CP-SAT), une ressource à capacité limitée (une machine qui ne traite qu'une tâche à la fois, une salle de capacité N) est modélisée par une "contrainte cumulative". Le problème central : prouver le plus tôt possible — par **propagation**, avant même de commencer à assigner des dates précises — qu'un sous-ensemble de tâches candidates pour cette ressource ne peut structurellement pas tenir dans la fenêtre de temps disponible, plutôt que de le découvrir des milliers d'itérations plus tard par un échec de backtracking.

**Principe.** Assimiler chaque tâche à une quantité d'"énergie" (durée × capacité requise) à faire tenir dans une fenêtre de temps. Si la somme des énergies des tâches qui **doivent** s'exécuter dans une fenêtre donnée dépasse la capacité de cette fenêtre (durée de la fenêtre × capacité de la ressource), il y a preuve mathématique d'infaisabilité — indépendamment de l'ordre dans lequel les tâches seraient assignées. L'edge-finding raffine cette idée : au-delà de détecter l'infaisabilité, il peut déduire des bornes plus serrées (par ex. "telle tâche doit obligatoirement commencer après telle date").

**Exemple simpliste.** Une salle de réunion libre de 9h à 12h (3h de capacité). Trois réunions de 1h30 chacune doivent impérativement s'y tenir ce matin-là, sans aucune alternative de salle. Somme des énergies requises = 4h30 > 3h disponibles → infaisabilité prouvée immédiatement, sans avoir eu à essayer le moindre horaire précis pour aucune des trois réunions.

**Lien avec cette conception.** C'est le principe directement repris au §5.2 (demande ferme) : une tâche dont la ressource `r` est la **seule** candidate constitue une consommation certaine ("une énergie garantie") de `r`, qu'on peut retrancher de son profil par avance — exactement comme l'edge-finding retranche une réservation certaine avant de chercher où la placer précisément. §5.2 est une version volontairement simplifiée et ciblée (une seule ressource candidate = demande "ferme") de ce principe plus général ; la demande "optionnelle" (tâches ayant plusieurs ressources candidates), qui est la partie la plus délicate du raisonnement énergétique complet, est explicitement laissée non modélisée pour l'instant (§5.2).

### 4.5 Backjumping / Conflict-Directed Backjumping et no-good learning

**Problématique visée.** Dans un backtracking chronologique standard, quand une branche échoue, on revient systématiquement à la décision la **plus récente** (la dernière variable assignée) — même si cette décision n'a strictement rien à voir avec la cause réelle de l'échec. Gaschnig (*Performance measurement and analysis of certain search algorithms*, thèse, 1979) puis Prosser (*Hybrid algorithms for the constraint satisfaction problem*, 1993) montrent que ce comportement gaspille énormément de travail : si la vraie cause du conflit remonte à une décision bien plus ancienne, le backtracking chronologique va re-explorer en boucle des variantes des décisions récentes — non fautives — avant de remonter, pas à pas, jusqu'à la vraie cause.

**Principe.** Maintenir, pour chaque échec, un "ensemble de conflit" — l'ensemble des décisions antérieures réellement impliquées dans la contradiction, pas seulement la plus récente. Le *backjumping* saute directement à la plus récente des décisions de cet ensemble, sans re-tester inutilement les décisions intermédiaires non fautives. Le *no-good learning* va plus loin : il mémorise la combinaison de décisions prouvée infaisable (un "no-good") pour ne plus jamais la reconsidérer, même dans une autre branche de l'arbre.

**Exemple simpliste.** Cinq réunions A, B, C, D, E assignées dans cet ordre. E échoue parce que la salle dont elle a besoin est déjà prise par... A, assignée en tout premier. Un backtracking chronologique reviendrait d'abord sur D, essaierait toutes ses variantes (inutilement — D n'est pour rien dans l'échec), puis sur C, puis sur B, avant d'enfin remonter jusqu'à A. Le backjumping identifie immédiatement que le conflit implique A et E, et saute directement en arrière jusqu'à A, sans perdre de temps sur B, C, D.

**Lien avec cette conception.** Ce principe motive directement le §5.7 (`solveWithElimination`) — mais dans une version délibérément moins ambitieuse (voir §5.7 : *"niveau d'ambition le plus mesuré des trois envisagés"*). Ce document n'implémente ni vrai backjumping (le flux de contrôle de `_backtrack` n'est pas modifié) ni no-good learning — seule l'idée d'"ensemble de conflit" est reprise, appliquée uniquement au comptage utilisé par `solveWithElimination` pour choisir quelle unité éliminer : attribuer l'échec à l'unité réellement occupante d'un créneau contesté, pas à l'unité dont c'était chronologiquement le tour. Un emprunt ciblé du concept, pas une implémentation du mécanisme complet.

### 4.6 dom/wdeg (Boussemart, Hemery, Lecoutre, Sais, 2004) — piste de repli, non implémentée

**Problématique visée.** Boussemart et al. (*Boosting Systematic Search by Weighting Constraints*, 2004) s'attaquent à un angle mort de MRV (§4.1) : le domaine résiduel mesure la difficulté *a priori* d'une variable, mais ne dit rien sur les variables qui, **empiriquement**, causent le plus d'échecs pendant la recherche en cours — deux variables au même domaine résiduel ne sont pas forcément aussi difficiles en pratique.

**Principe.** Chaque contrainte porte un poids, initialisé à 1, incrémenté à chaque fois qu'elle est directement responsable d'un échec (domaine vidé) pendant la recherche. La variable choisie en priorité est celle dont le poids cumulé des contraintes qui la concernent, rapporté à la taille de son domaine (`wdeg/dom`), est le plus élevé — combinant MRV (le domaine, théorique) avec un signal *appris* de la difficulté réelle rencontrée jusque-là.

**Exemple simpliste.** Dans un planning, une salle sur-demandée génère échec après échec au fil de la recherche, à chaque fois qu'une tâche tente de s'y placer et se heurte à une réservation déjà prise. Après quelques dizaines d'échecs, la contrainte "capacité de cette salle" porte un poids élevé — toute tâche qui en dépend hérite d'une priorité plus élevée, même si son domaine résiduel semblait correct au départ. Le système "apprend" en cours de recherche quelle ressource est le vrai goulot d'étranglement, sans qu'on ait eu à le deviner à l'avance.

**Lien avec cette conception.** Cité au §5.2 comme piste de repli explicitement mise en réserve, à n'implémenter que si la demande ferme (§5.2, dérivée du raisonnement énergétique §4.4) s'avère insuffisante en pratique — non implémenté à ce stade. Nuance déjà documentée au §5.2 : dom/wdeg est bien établi pour les solveurs CSP génériques, mais les moteurs de scheduling dédiés s'appuient davantage sur la propagation cumulative (§4.4) que sur dom/wdeg littéralement — ce n'est donc pas une garantie de meilleur résultat ici, d'où le choix de le garder en réserve plutôt que de l'implémenter par anticipation.

### 4.7 Repères rapides

| Concept | Répond à quel problème | Utilisé dans ce document |
|---|---|---|
| MRV / fail-first (§4.1) | Ordre d'exploration : quelle variable traiter en premier | Principe fondateur de `getSchedulingPriority()` tout entier (§1, §5) |
| Degree heuristic (§4.2) | Départager à égalité de domaine résiduel | Limite identifiée (§3.1), remplacée par un mécanisme scheduling-spécifique (§5.2) |
| Règles RCPSP MSLK/GRPW (§4.3) | Mesurer la marge réelle d'une tâche dans un graphe de dépendances | Ancêtre conceptuel de la troncature par échéance (§5.6) |
| Edge-finding / énergétique (§4.4) | Prouver une sursaturation de ressource par propagation, avant la recherche | Base du mécanisme de demande ferme (§5.2) |
| Backjumping / CBJ / no-good (§4.5) | Remonter à la vraie cause d'un échec, pas à la décision la plus récente | Base (emprunt ciblé) de l'attribution du blâme dans `solveWithElimination` (§5.7) |
| dom/wdeg (§4.6) | Apprendre dynamiquement quelles contraintes sont réellement difficiles | Piste de repli réservée, non implémentée (§5.2) |

## 5. Modèle proposé

### 5.1 Unité de mesure : mesure à deux niveaux (nombre de fenêtres indépendantes, puis marge intra-fenêtre)

**Implémenté** — `packages/scheduler-common/src/priorityMeasure.ts`.

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

**Pseudocode** (fidèle à `priorityMeasure.ts`) :

```
const SLOT_STEP = 30   // pas de grille, en minutes

function nbPositions(intervalle, duration):
    largeur = intervalle.end - intervalle.start
    si largeur < duration: retourner 0
    retourner floor((largeur - duration) / SLOT_STEP) + 1

function measureProfile(profil, duration):
    usableWindowCount = 0
    slackTotal = 0
    pour chaque intervalle de profil:
        positions = nbPositions(intervalle, duration)
        si positions > 0:
            usableWindowCount += 1
            slackTotal += positions
    retourner { usableWindowCount, slackTotal }

// Comparateur "brut" : plus grand = plus de fenêtres (ou, à égalité, plus de marge) = MOINS urgent.
// Utilisé pour choisir le MEILLEUR combo/profil (§5.3), pas encore pour trier les tâches.
function comparePriorityMeasure(a, b):
    si a.usableWindowCount != b.usableWindowCount:
        retourner a.usableWindowCount - b.usableWindowCount
    retourner a.slackTotal - b.slackTotal

// Seul et unique point d'inversion de signe vers le scalaire attendu par
// ISchedulingUnit.getSchedulingPriority() (plus grand = plus URGENT, convention historique) :
function encodePriorityMeasure(m):
    retourner -(m.usableWindowCount * 1_000_000 + m.slackTotal)
```

**Remarque d'implémentation.** `comparePriorityMeasure` (et `maxPriorityMeasure`/`minPriorityMeasure`, non détaillées ici) raisonnent tous dans le sens "brut" — plus grand = plus disponible = moins urgent. `encodePriorityMeasure` est le seul endroit où le signe est inversé pour produire le scalaire "plus grand = plus urgent" attendu par le reste du moteur. Centraliser l'inversion à cet unique endroit évite de la reproduire — et donc risquer de l'inverser deux fois, ou de l'oublier — dans chacune des méthodes qui produisent une `PriorityMeasure` (combo, groupe, troncature, §5.3/§5.6) : c'est directement la leçon du second piège documenté en §1.

**§6.2 historique (pondération des positions par emplacement) — clos, hors sujet ici** : ce point relève d'un mécanisme CSP différent — LCV (*Least Constraining Value*, ordonnancement des **valeurs** d'une variable déjà choisie), pas MRV (ordonnancement des **variables**, notre score). La qualité d'une position précise (bord de fenêtre, adjacence à une réservation) concerne le choix du créneau *pour la tâche déjà sélectionnée* — c'est-à-dire `earlySchedule`/`_findFirstSlot`, pas `getSchedulingPriority`. Les deux mécanismes restent volontairement séparés ; `slackTotal`/`nbFenêtresUtilisables` demeurent des comptages purs, non pondérés par position.

### 5.2 Criticité de ressource — décision : demande ferme uniquement, poids appris tenu en réserve

**Non implémenté à ce jour** (Phase 4, voir §8).

**Décision (Frédéric)** : tester d'abord le mécanisme le mieux fondé (demande ferme, ci-dessous), qui ne nécessite aucune formule devinée. Le "poids appris" façon `dom/wdeg` (§4.6) est **explicitement réservé comme option de repli**, à n'implémenter que si les tests sur la demande ferme seule s'avèrent insuffisants — pas de complexité ajoutée par anticipation.

#### Mécanisme retenu : demande ferme, même famille que §5.5 (raisonnement énergétique, §4.4)

Une tâche dont `r` est la **seule** ressource candidate de son type constitue une consommation *certaine* de `r`, juste pas encore positionnée dans le temps — exactement la même nature d'information que la pause méridienne flottante (§5.5). On applique donc le même principe : réserver virtuellement cette consommation dans le profil de `r`, avant de mesurer.

**Exemple simpliste.** Deux tâches pendantes, T1 (1h) et T2 (1h). T1 n'a qu'une seule salle possible, `SalleA` (demande ferme). T2 peut utiliser `SalleA` OU `SalleB` (demande optionnelle, délibérément ignorée par ce mécanisme). Si `SalleA` n'a que 2h de disponibilité ce jour-là, le score de T2 doit tenir compte du fait qu'1h de `SalleA` est déjà virtuellement "prise" par T1 — même si T1 n'est pas encore concrètement réservée, puisque T1 n'a nulle part ailleurs où aller. Sans ce mécanisme, T2 verrait `SalleA` comme ayant 2h pleines de marge : une illusion.

**Pseudocode de la proposition — non implémentée** :

```
function demandeFermeAutres(r, [a,b], tacheExclue):
    total = 0
    pour chaque tache pendante t' != tacheExclue :
        si r est la SEULE ressource candidate de son type pour t' ET profil(t') chevauche [a,b]:
            total += duration(t')
    retourner total

function corrigerProfilDemandeFerme(r, profil, tacheExclue):
    pour chaque fenêtre [a,b] de profil:
        demande = demandeFermeAutres(r, [a,b], tacheExclue)
        si demande >= (b - a):
            retourner INFAISABLE          // sursaturation prouvée par les AUTRES tâches seules
        sinon:
            réserver virtuellement `demande` minutes dans [a,b]   // même découpage que §5.5
```

Si `autresDemandeFerme(r,[a,b]) ≥ (b−a)` : sursaturation prouvée par les AUTRES tâches seules, indépendamment de la tâche dont on calcule le score → infaisabilité à signaler immédiatement (même test que la sursaturation par la pause flottante, juste sur une source de consommation différente).

**Demande optionnelle (tâches ayant des ressources alternatives à `r`) : délibérément ignorée pour l'instant.** Pas de pondération `1/nbAlternatives` ni aucune autre formule devinée — on ne modélise que ce qui est prouvable. Si les tests montrent que c'est insuffisant, la piste de repli est un poids par ressource **appris dynamiquement** dans l'esprit de `dom/wdeg` (§4.6), appliqué comme facteur multiplicatif sur `(nbFenêtresUtilisables, slackTotal)` une fois §5.1 calculé. Ce poids appris, s'il est un jour implémenté, servirait aussi directement §5.7 (attribution correcte du blâme dans `solveWithElimination`).

#### Ordre des corrections de profil (trois s'empilent — à fixer explicitement)

Pour une ressource `r` candidate d'un combo, avant intersection avec les autres ressources du combo :

```
1. profil brut de r.availability
2. si r est de type GROUP et soumise à une pause flottante : découpage §5.5   [implémenté]
3. correction de demande ferme §5.2 (ci-dessus)                              [non implémenté]
   → profil corrigé pour r
```

Puis, pour le combo entier : intersection des profils corrigés de toutes les ressources du combo (§5.3) → `ownProfile(t, combo)`. Puis, entre combos : max lexicographique (§5.3) → `ownProfile(t)`. Puis, si `t` a des dépendants : troncature par échéance (§5.6) → `effectiveProfile(t)`. Enfin : mesure de §5.1 sur `effectiveProfile(t)`.

Logique de l'ordre : §5.5/§5.2 sont des propriétés de la ressource elle-même (indépendantes de la position de `t` dans un éventuel enchaînement de dépendances) et s'appliquent donc en amont, ressource par ressource ; §5.6 dépend de la position de `t` dans son propre arbre de dépendance et ne peut s'appliquer qu'après avoir déterminé le profil complet de la meilleure combinaison.

### 5.3 Agrégation combo / ressources

**Implémenté** — `packages/scheduler-common/src/task.ts` (`getBestSchedulingProfile()`), agrégation de groupe déléguée à §5.6.

Un `min` de mesures calculées séparément par ressource ne donne pas la taille du domaine des positions *simultanément* valides pour toutes les ressources du combo — contre-exemple : ressource A libre à {8h, 8h30, 9h} (3 positions), ressource B libre à {10h, 10h30} (2 positions) → `min(3,2)=2` suggère de la marge, alors que l'intersection réelle (positions valides pour A **et** B en même temps) est vide.

La bonne approche : `Task._intersectResources(combo)` intersecte les profils de disponibilité de toutes les ressources du combo **avant** tout calcul de mesure. C'est sur le résultat de cette intersection qu'on applique §5.1 :

- **Dans un combo** : intersecter d'abord les profils des ressources du combo, puis calculer `(nbFenêtresUtilisables, slackTotal)` sur le profil **résultant de l'intersection** — pas de `min` séparé par ressource.
- **Entre combos alternatifs** : la tâche choisit son meilleur plan → **max lexicographique** sur les combos (préférer le combo offrant le plus de fenêtres indépendantes, puis le plus de marge).
- **Agrégation de groupe** (`TaskGroupUnit`, plusieurs tâches membres) — même défaut que ci-dessus si on utilisait un `min` de mesures indépendantes par membre ; remplacé par le calcul exact de §5.6 (intersection réelle des profils réduits par durée).
- **Propagation aux dépendants** : ni `max` ni `somme` de scores déjà agrégés — remplacé par la troncature de profil de §5.6.

**Pseudocode** (fidèle à `task.ts`) :

```
function ownProfile(tache, pauseFlottante):
    meilleurProfil = vide
    meilleureMesure = INFAISABLE
    pour chaque combo de tache.getApplicableResources():
        profil = intersection des profils corrigés (§5.2, §5.5) de toutes les ressources du combo
        mesure = measureProfile(profil, tache.duration)
        si comparePriorityMeasure(mesure, meilleureMesure) > 0:   // §5.1 — plus de marge brute
            meilleureMesure = mesure
            meilleurProfil = profil
    retourner meilleurProfil
```

*Note d'implémentation* : la comparaison lexicographique de paires `(nbFenêtres, slack)` n'est pas un simple `Math.min`/`Math.max` sur un nombre — nécessite un comparateur dédié (`comparePriorityMeasure`, §5.1), pas un encodage scalaire prématuré (qui ne serait de toute façon valide qu'après passage par `encodePriorityMeasure`, seul point de conversion — voir la remarque d'implémentation en §5.1).

### 5.4 Distinction infaisabilité vs simplement très contraint

**Implémenté** — sous-produit direct de §5.1, pas de mécanisme séparé.

`nbFenêtresUtilisables = 0` est le signal recherché : aucun intervalle utilisable du tout (impossible), à distinguer de `nbFenêtresUtilisables ≥ 1` (au moins un intervalle pile à la bonne taille, faisable, `slackTotal` minimal — cas THARAUD, `slackTotal=1`, jamais 0 pour un cas faisable). La mesure à deux niveaux **distingue nativement** les deux situations via `nbFenêtresUtilisables`, sans test binaire séparé :

```
si mesure.usableWindowCount == 0:
    // infaisabilité prouvée — à remonter/propager immédiatement, pas juste "un mauvais score"
```

### 5.5 Pause méridienne flottante : découpage conservateur en deux fenêtres

**Implémenté** — `splitFloatingLunchBreak()`, `priorityMeasure.ts`.

Rogner un bord de l'intervalle (le rétrécir en gardant un seul morceau) ne suffit pas : en pratique, une pause de midi coupe nécessairement une large plage (ex. `8h-17h`) en **deux** fenêtres distinctes (matin/après-midi), et c'est ce que `nbFenêtresUtilisables` (§5.1, signal *primaire* du modèle) doit refléter — un simple rognage d'un seul bord laisserait à tort un seul intervalle rétréci.

```
overlapStart = max(a, earliest)
overlapEnd   = min(b, latest)
milieu       = (overlapStart + overlapEnd) / 2
cutStart     = milieu − lunchDuration/2
cutEnd       = milieu + lunchDuration/2

[a,b] devient { [a, cutStart], [cutEnd, b] }   (morceaux vides ou < SLOT_STEP retirés)
```

Exemple : `[8h,17h]` avec `[earliest,latest]=[11h30,14h30]`, `lunchDuration=90min` → coupure `[12h15,13h45]` → deux fenêtres `[8h,12h15]` (255min) et `[13h45,17h]` (195min) — total 450min = 540−90 (la durée de la pause est bien intégralement comptée), et surtout **deux fenêtres**, conforme à la réalité.

**Pseudocode** (fidèle à `splitFloatingLunchBreak()` — le découpage est appliqué séparément **par jour** du profil) :

```
function splitFloatingLunchBreak(profil, fenetre):   // fenetre = {earliestMin, latestMin, duration}
    resultat = vide
    pour chaque jour représenté dans profil:
        pour chaque intervalle [a,b] de ce jour:
            si [a,b] ne chevauche pas [fenetre.earliestMin, fenetre.latestMin]:
                resultat.ajouter([a,b])              // rien à découper ce jour-là
                continuer
            overlapStart = max(a, fenetre.earliestMin)
            overlapEnd   = min(b, fenetre.latestMin)
            milieu       = (overlapStart + overlapEnd) / 2
            cutStart     = milieu - fenetre.duration / 2
            cutEnd       = milieu + fenetre.duration / 2
            si cutStart > a: resultat.ajouter([a, cutStart])
            si b > cutEnd:   resultat.ajouter([cutEnd, b])
    retourner resultat
```

**Le choix du milieu de la zone de chevauchement comme point de coupure est une simplification assumée, pas une garantie de pire cas** : la position réelle de la pause n'est connue qu'au moment du placement (`_floatingLBAllows`), potentiellement différente chaque jour. Le milieu est une position canonique raisonnable pour une mesure heuristique de *score*, symétrique et simple — pas un calcul rigoureux de disponibilité garantie. Correctif de *lecture* uniquement : la logique de placement réelle reste inchangée et gérée au moment du `book()`.

### 5.6 Propagation aux dépendants : troncature de profil par échéance (remplace le `max`/la `somme`)

**Implémenté** — `TaskUnit`/`TaskGroupUnit` (`packages/scheduler-core`), fonctions support dans `priorityMeasure.ts`.

**Origine** : sur un exemple à trois tâches liées `CM → TD → TP` avec des scores individuels identiques (200, 200, 200), ni la `somme` (utilisée par un moteur antérieur — donnerait 600, surestime) ni le `max` d'une version antérieure de ce moteur (équivalent à un `min` des marges individuelles sur l'échelle positive) ne donnent la bonne réponse dans le cas général. Vérifié par un calcul complet (passe avant/arrière façon méthode du chemin critique) sur un exemple chiffré asymétrique : CM disponible sur `[0,1000]`, TD sur `[500,600]`, TP sur `[560,620]`, durées 60 chacune → la vraie marge de CM est **440 minutes**, alors que le `max` donne **0** (sous-estimation sévère) et la somme des marges isolées donnerait 980 (sur-estimation sévère). Aucune combinaison simple (min/max/somme) de scores calculés indépendamment par tâche ne peut être correcte : il faut une vraie récursion sur les *dates*, pas sur des *scores* déjà agrégés.

**Principe retenu** : au lieu de combiner des scores, on **tronque le profil de disponibilité** de chaque tâche selon l'échéance imposée par ses dépendants, *avant* de lui appliquer §5.1. La passe avant (dates au plus tôt) n'a pas besoin d'être calculée séparément — elle est implicitement portée par ce qui reste du profil après troncature ; seule la passe arrière (dates au plus tard) est nécessaire.

#### Cas `TaskUnit`

```
function computeEffectiveProfile(U):
    ownProfile = getBestSchedulingProfile(U.task, U.floatingLunch)    // §5.3
    si U.dependents est vide:
        retourner ownProfile
    echeance = +infini
    pour chaque D dans U.dependents:
        ls = D.getEffectiveLatestStart()
        si ls == null:                     // D lui-même infaisable
            retourner profil vide           // → U hérite l'infaisabilité
        echeance = min(echeance, ls)        // U doit finir avant CHAQUE dépendant
    retourner truncateProfile(ownProfile, echeance)

function getSchedulingPriority(U):
    retourner encodePriorityMeasure(measureProfile(computeEffectiveProfile(U), U.duration))

function getEffectiveLatestStart(U):
    retourner findLastSlot(computeEffectiveProfile(U), U.duration)

// --- fonctions support (priorityMeasure.ts) ---

function truncateProfile(profil, echeance):
    resultat = vide
    pour chaque [a,b] de profil:
        fin = min(b, echeance)
        si fin > a: resultat.ajouter([a, fin])
    retourner resultat

function findLastSlot(profil, duration):    // symétrique de _findFirstSlot, en partant de la fin
    pour chaque intervalle [a,b] de profil, du DERNIER au premier:
        si (b - a) >= duration:
            retourner b - duration
    retourner null                          // aucun créneau assez large
```

Vérification sur l'exemple chiffré : `effectiveProfile(TP)=[560,620]` → `LS(TP)=560`. `effectiveProfile(TD)=[500,600]` tronqué à droite de 560 `=[500,560]` → `LS(TD)=500`. `effectiveProfile(CM)=[0,1000]` tronqué à droite de 500 `=[0,500]` → marge `500−60=440`. Conforme au calcul manuel.

**Invariant important** : `effectiveProfile` est une vue **calculée, éphémère, en lecture seule**, utilisée uniquement pour évaluer `getSchedulingPriority()`. Elle ne modifie jamais `Resource.availability` (l'objet réel muté par `book()`/`unBook()`). `earlySchedule()` continue de chercher un créneau sur la disponibilité **réelle, non tronquée** — si l'échéance estimée s'avère pessimiste dans un cas limite, on ne veut pas empêcher un placement qui reste en réalité possible. La troncature n'influence que l'**ordre** d'essai des tâches, jamais la **faisabilité réelle** testée au moment du placement.

#### Dépendants multiples (structure en éventail) : correction de charge cumulée

**Conception validée (2026-07-10), non implémentée à ce jour** (voir §8).

Le cas CM/TD/TP ci-dessus n'a qu'un seul dépendant à chaque niveau (`k=1`). La formule `échéance(U) = min(LS(D1),...,LS(Dk))` reste correcte quand `k=1`, mais devient insuffisante dès que U a **plusieurs** dépendants directs (`k>1`) : elle vérifie bien que U finit avant le plus pressé des `Di`, mais ignore que TOUS les `Di` doivent aussi tenir, cumulativement, dans le temps restant — indépendamment de quelle ressource précise chacun utilise (aucune hypothèse de ressource partagée n'est nécessaire ni souhaitable ici : les dépendances n'expriment qu'une contrainte de précédence temporelle, "tel cours ne doit pas débuter avant la fin de tel autre").

**Origine** : observé sur un cas réel (un CM avec 4 TD en dépendance directe, tous devant démarrer après la fin du CM) — le CM se voyait accorder une échéance bien trop lâche, parce que chaque TD, évalué isolément de ses 3 frères, affichait individuellement une semaine largement ouverte. Le `min` ne voit que le plus lâche des cas isolés, jamais leur charge combinée.

**Correction — généralisation stricte de la formule existante**, dans le même esprit que l'ajustement tête/queue sur ressource disjonctive (Carlier & Pinson, *An algorithm for solving the job-shop problem*, 1989 ; *Adjustment of heads and tails for the job-shop scheduling problem*, 1994 — cf. §4.5), mais appliqué ici directement à la structure de précédence de l'arbre de dépendances, sans condition de ressource partagée entre les `Di` :

```
Pour un nœud U avec dépendants directs D1..Dk (k≥1) :

  m = argmin_i LS(Di)                          (le dépendant le plus pressé)

  échéance(U) = LS(Dm) − Σ_{i≠m} duration(Di)  (retranche la charge cumulée de TOUS LES AUTRES)
```

Quand `k=1`, la somme porte sur un ensemble vide → `échéance(U) = LS(D1)`, exactement la formule existante — pure généralisation, **aucune régression sur le cas chaîne** (CM/TD/TP ci-dessus, déjà vérifié).

**Exemple chiffré** — CM durée 90, profil propre `[0,1000]` ; TD1 durée 60, profil propre `[0,700]` ; TD2 durée 200, profil propre `[0,500]` :

```
LS(TD1) = 700 − 60  = 640
LS(TD2) = 500 − 200 = 300
```

*Mécanisme actuel* : `échéance(CM) = min(640,300) = 300` → `LS(CM) = 300−90 = 210`.
Vérification manuelle (pire cas, TD1 avant TD2) : CM finit à 300 → TD1 `[300,360]` → TD2 démarre à 360, mais `LS(TD2)=300` → **contrainte de TD2 violée**. Le mécanisme actuel est donc réellement en défaut ici, pas seulement imprécis.

*Mécanisme proposé* : `m = TD2` (300 < 640) → `échéance(CM) = LS(TD2) − duration(TD1) = 300 − 60 = 240` → `LS(CM) = 240−90 = 150`.
Vérification manuelle : CM finit à 240 → TD1 `[240,300]` → TD2 démarre à 300, exactement `LS(TD2)` → tangent, correct.

| | échéance(CM) | LS(CM) | Vérifié par calcul manuel |
|---|---|---|---|
| Mécanisme actuel | 300 | 210 | ❌ viole la contrainte de TD2 dans le pire cas |
| Mécanisme proposé | 240 | 150 | ✅ tangent, exactement la limite sûre |

**Limite assumée** : la formule suppose le pire ordonnancement possible en aval (le dépendant le plus pressé placé en dernier) — un parti pris conservateur, pas une garantie de nécessité stricte dans tous les cas asymétriques (une analyse par sous-ensembles, plus proche de l'algorithme complet de Carlier-Pinson, donnerait une borne plus fine mais plus coûteuse). Cohérent avec l'invariant ci-dessus : ce signal n'influence que l'ordre d'essai des tâches, jamais la faisabilité réelle testée au moment du placement — un excès de prudence ici est donc sans risque, seulement potentiellement sous-optimal.

**Portée** : s'applique uniformément à `TaskUnit._computeEffectiveProfile()` et `TaskGroupUnit._computeEffectiveAnchors()` (même formule `échéance(U) = min(LS(Di))` dans les deux, remplacée par la version ci-dessus) — aucune distinction nécessaire entre les deux, la correction porte sur la façon d'agréger les dépendants, pas sur la représentation interne du profil (`Availability` vs `TimeRange`).

#### Cas `TaskGroupUnit` — une asymétrie cruciale (bug réel rencontré à l'implémentation)

`ownProfile(groupe)` n'est pas un profil de disponibilité brut comme celui d'une `TaskUnit` — c'est déjà un profil de **débuts valides** (chaque instant `t` du profil signifie « le groupe peut démarrer en `t` »), construit en intersectant les profils bruts *déjà réduits par la durée de chaque membre*. Cette réduction peut produire un intervalle de largeur **zéro** — un ajustement pile à la bonne taille pour un membre — que le type `Availability`/intervalle classique (invariant `start < end`) ne peut pas représenter. D'où un type dédié, `TimeRange {start,end}`, autorisant `start = end`, utilisé uniquement pour ce calcul interne à `TaskGroupUnit`.

```
function reduce(profilBrut, d):     // transforme un profil de disponibilité en profil de DÉBUTS valides
    resultat = vide
    pour chaque [a,b] de profilBrut:
        si (b - a) >= d: resultat.ajouter([a, b - d])   // largeur 0 possible (a = b-d)
    retourner resultat
```

**Groupe `parallel`** (tous les membres démarrent au même instant, durées potentiellement différentes) :
```
ownAnchors(groupe) = ∩ᵢ reduce(profil_i, duration_i)
```
Un instant `t` n'est un début de groupe valide que si TOUS les membres peuvent y démarrer, chacun pour sa propre durée.

**Groupe `sequential`** (ordre fixe, **aucun trou** — début(suivant) = fin(précédent)) :
```
offset_i = somme des durées des membres AVANT i dans l'ordre du groupe
ownAnchors(groupe) = ∩ᵢ décaler(reduce(profil_i, duration_i), -offset_i)
```
Pour chaque membre, on calcule ses débuts valides propres puis on les décale vers la gauche de son offset dans la séquence — ça donne les instants d'ancrage du groupe qui placeraient *ce* membre pile à sa position. L'intersection sur tous les membres donne les seuls ancrages valides pour toute la séquence sans trou.

```
function computeEffectiveAnchors(groupe):
    own = ownAnchors(groupe)
    si groupe.dependents est vide:
        retourner own
    echeance = +infini
    pour chaque D dans groupe.dependents:
        ls = D.getEffectiveLatestStart()
        si ls == null: retourner vide
        echeance = min(echeance, ls)
    // ⚠ `own` contient des DÉBUTS, `echeance` borne une FIN — l'ajustement -duration(groupe)
    // est nécessaire ici précisément parce qu'il ne l'était PAS pour TaskUnit (qui tronque le
    // profil BRUT avant de le réduire par la durée, dans findLastSlot — l'ordre des opérations
    // fait toute la différence). Voir l'encadré ci-dessous.
    retourner truncateRanges(own, echeance - groupe.duration)

function getSchedulingPriority(groupe):
    retourner encodePriorityMeasure(countAnchorPositions(computeEffectiveAnchors(groupe)))

function getEffectiveLatestStart(groupe):
    anchors = computeEffectiveAnchors(groupe)
    si anchors est vide: retourner null
    retourner dernier(anchors).end

// --- fonctions support, TimeRange (start <= end autorisé) ---

function intersectRanges(A, B):
    // deux pointeurs sur des listes triées/disjointes, comme pour Availability, mais
    // [max(a.start,b.start), min(a.end,b.end)] conservé dès que start <= end (largeur 0 OK)

function truncateRanges(ranges, echeance):
    // comme truncateProfile, mais sur des TimeRange

function countAnchorPositions(ranges):
    // comme measureProfile, mais SANS nouvelle réduction par durée (déjà faite via `reduce`) :
    // nbPositions(plage) = floor((plage.end - plage.start) / SLOT_STEP) + 1
```

**Encadré — pourquoi cette asymétrie a produit un bug réel.** `TaskUnit.computeEffectiveProfile` tronque le profil **brut** (avant réduction par durée) — la réduction par durée n'intervient qu'ensuite, à l'intérieur de `findLastSlot`, qui fait implicitement `b − duration`. `TaskGroupUnit`, lui, construit `ownAnchors` **déjà réduit** (c'est la seule façon d'intersecter correctement des membres de durées différentes, ci-dessus) — donc tronquer `own` directement par `echeance`, en supposant à tort « même chose que pour `TaskUnit` », tronque une date de *début* par une borne de *fin* : trop permissif d'exactement `duration(groupe)` minutes. Trouvé uniquement parce qu'un test combinant pause flottante et dépendants pour `TaskGroupUnit` donnait une valeur différente de celle calculée à la main ; le correctif est la soustraction `- duration(groupe)` ci-dessus, désormais en place. **Leçon générale** : quand deux implémentations partagent un même principe (ici, la troncature par échéance) mais des représentations internes différentes, tester chaque variante concrètement plutôt que de supposer qu'elles se comportent pareil.

Dans les deux cas (`parallel`/`sequential`), `(nbFenêtresUtilisables, slackTotal)` du groupe s'obtient directement via `countAnchorPositions(ownAnchors(groupe))` — pas de réduction supplémentaire, déjà faite membre par membre. `LS(groupe)` se calcule de façon cohérente qu'un dépendant soit une `TaskUnit` ou un `TaskGroupUnit`, puisque les deux exposent `getEffectiveLatestStart()`.

#### Coût de calcul et piste d'optimisation future (non implémentée)

`getSchedulingPriority()` n'est aujourd'hui pas mis en cache — recalculé à chaque appel de `_dynamicSort`. La troncature ajoute un parcours récursif de l'arbre de dépendance à chaque calcul. Avec une profondeur typique ≤3 (cas `CM/TD/TP`), le surcoût reste négligeable et **aucune optimisation n'est proposée pour l'instant**.

Si la profondeur des arbres de dépendance venait à augmenter significativement, piste à envisager *alors seulement* (ne pas préimplémenter) : mémoïser `effectiveProfile(U)` par unité, invalidé exactement comme `_bestAvailableTime` l'est aujourd'hui (`invalidateSchedulable()`), mais en propageant l'invalidation **vers le haut** le long de `_dependsOn` — si le profil d'un dépendant change, l'échéance (et donc `effectiveProfile`) de tous ses ancêtres dans la chaîne doit être recalculée. C'est une invalidation en cascade, plus large que l'invalidation actuelle (qui ne touche que les tâches partageant une ressource), à concevoir spécifiquement si ce besoin se présente.

### 5.7 `solveWithElimination()` : attribution du blâme par occupation réelle, pas par tour de rôle

**Implémenté et vérifié sur données réelles (2026-07-10)** — `Scheduler._incrementFailureBlame()`, `scheduler.ts`. Rejoué sur le payload réel THARAUD (semaine 36) qui a motivé ce point : THARAUD n'est plus blâmé du tout (`undefined`, contre 903 343 échecs comptabilisés à tort auparavant) ; l'unité effectivement éliminée est `AUBRY Bastien/BUT1-G1` — exactement la contention identifiée comme cause réelle du blocage ci-dessous. La résolution réussit désormais en un seul round d'élimination, dans le budget de recherche initial de 10s.

**Constat (§3.5)** : `_failureCounts` incrémente l'unité *dont c'était le tour* au moment où `earlySchedule()` échoue définitivement — mais dans un backtracking chronologique, ce n'est pas forcément la cause réelle du blocage. Confirmé empiriquement sur le cas THARAUD (production) : 903 343 échecs comptabilisés contre THARAUD (zéro alternative), qui n'est pourtant pas la cause du blocage réel (contention AUBRY Bastien/BUT1 ailleurs dans le graphe).

**Exemple simpliste** (avant le cas réel) : trois unités A, B, C traitées dans cet ordre ; C échoue parce que la ressource dont elle a besoin est occupée par A. Le compteur actuel incrémente C — qui n'a pourtant rien fait de mal, elle a juste eu la malchance d'être évaluée après que A a pris la place. Le vrai responsable du conflit, c'est A (ou plus précisément, le choix d'y avoir placé A à cet endroit).

**Niveau d'ambition retenu (le plus mesuré des trois envisagés)** : ne pas toucher au flux de contrôle de `_backtrack` (pas de vrai backjumping, pas de no-good learning pour l'instant — cohérent avec la discipline déjà appliquée en §5.2 : tester le mécanisme le moins invasif d'abord). On corrige uniquement **ce que `solveWithElimination` compte**, pas comment `_backtrack` explore.

**Mécanisme** : quand `unit.earlySchedule(fromTime)` échoue, au lieu de `failureCounts.get(unit.id)++`, identifier — pour les ressources candidates de `unit` — quelles réservations *actuellement actives* dans `_solution` occupent les créneaux qui auraient permis de placer `unit`, et incrémenter le compteur de **ces unités occupantes**, pas celui de `unit`. C'est une application ciblée du principe du *conflict set* (§4.5) : identifier les décisions réellement en conflit, mais seulement pour éclairer le choix de la cible d'élimination, sans changer l'ordre d'exploration lui-même.

**Pseudocode — implémenté** (`Scheduler._incrementFailureBlame()`, `scheduler.ts`) :

```
quand unit.earlySchedule(fromTime) échoue définitivement:
    candidats = unit.getCandidateResources()   // déjà existant, réutilisé tel quel
    occupants = unités de _solution dont une ressource réservée apparaît dans `candidats`
                ET dont la réservation se termine APRÈS fromTime
                // condition de fin ajoutée à la conception initiale : une réservation
                // entièrement avant fromTime ne peut structurellement pas être la cause
                // d'un échec de recherche qui démarre à fromTime (book() ne fait qu'un
                // retrait d'intervalle, sans effet sur ce qui précède son propre début)
    si occupants non vide:
        pour chaque O dans occupants: failureCounts[O.id]++
    sinon:
        failureCounts[unit.id]++    // repli : aucun occupant identifié, comportement actuel
```

**Granularité et découplage (décidés)** :
- Blâme porté sur l'**unité occupante**, pas sur une ressource abstraite — plus simple, suffisant pour corriger le symptôme observé.
- Ce compteur reste **local à `solveWithElimination`** — délibérément **découplé** du poids appris réservé en §5.2 (`dom/wdeg`-style, §4.6). Pas d'unification anticipée entre les deux mécanismes tant que chacun n'a pas été testé isolément.

**Portée** : concerne `packages/scheduler-core/src/scheduler.ts` (`_backtrack`, le point où `_failureCounts` est incrémenté ; `solveWithElimination`, la sélection de la cible). N'affecte pas `getSchedulingPriority`/le modèle de score des §5.1-§5.6.

## 6. Points ouverts (non tranchés)

Aucun. Tous les points précédemment listés sont désormais tranchés :

1. ~~Pondération de la demande optionnelle~~ — **tranché** (§5.2) : non modélisée pour l'instant, poids appris en réserve explicite.
2. ~~Pondération des positions selon leur emplacement~~ — **clos** (§5.1) : hors sujet, relève de LCV/`earlySchedule`.
3. ~~Court-circuit d'infaisabilité~~ — **résolu** comme sous-produit de §5.2 (sursaturation par demande ferme = test binaire immédiat).
4. ~~Évolution de `solveWithElimination()`~~ — **tranché** (§5.7) : attribution du blâme par occupation réelle, découplée de §5.2.

## 7. Fichiers et méthodes concernés

**Réalisé (Phases 1-3 et 5 : §5.1, §5.3, §5.4, §5.5, §5.6, §5.7)** :
- `packages/scheduler-common/src/priorityMeasure.ts` — module entier : `PriorityMeasure`, `measureProfile`, `comparePriorityMeasure`/`maxPriorityMeasure`/`minPriorityMeasure`, `encodePriorityMeasure`, `splitFloatingLunchBreak`, `truncateProfile`/`findLastSlot`, `computeDependentsDeadline` (dépendants multiples), `TimeRange`/`reduceToAnchors`/`shiftRanges`/`intersectRanges`/`truncateRanges`/`countAnchorPositions`.
- `packages/scheduler-common/src/task.ts` — `getBestSchedulingProfile()` (§5.3), remplace l'ancien `getBestApplicableAvailableTime()`/`getSchedulingMeasure()` (supprimés).
- `packages/scheduler-core/src/schedulingUnit.ts` — `ISchedulingUnit` : `setFloatingLunchBreak()` (§5.5), `getEffectiveLatestStart()` (§5.6).
- `packages/scheduler-core/src/taskUnit.ts`, `taskGroupUnit.ts` — `getSchedulingPriority()`/`getEffectiveLatestStart()` réécrits autour de la troncature de profil par échéance (§5.6, y compris dépendants multiples).
- `packages/scheduler-core/src/scheduler.ts` — propagation de la config de pause flottante aux unités, dans `initSolver()` (§5.5) ; `_incrementFailureBlame()`, attribution du blâme par occupation réelle (§5.7).
- `packages/scheduler-core/src/schedulingHeuristics.ts` — **supprimé** : l'ancien mécanisme `DEPENDENTS_WEIGHT` qu'il portait n'a plus d'appelant, remplacé intégralement par §5.6.

**Restant — conception tranchée, non implémentée (Phase 4 : §5.2)** :
- §5.2 nécessiterait un index ressource → tâches pendantes à demande ferme, à construire en s'appuyant sur `Resource.getTasks()` (déjà utilisé pour l'invalidation du cache de disponibilité). Plus simple que prévu initialement : la demande optionnelle n'étant pas modélisée, pas besoin de suivre `nbAlternatives` par tâche pour cet index.

**Fixtures de test disponibles** : cas réel THARAUD (semaine 36) dans `packages/scheduler-core/data/payload.json` (données réelles, non versionnées — voir `.gitignore`) ; cas synthétique `CM/TD/TP` (§5.6) couvert par `packages/scheduler-core/__tests__/schedulerDependentTruncation.test.ts` et `schedulingPriority.test.ts`.

## 8. Statut

**Conception terminée** (tous les points de §5 sont tranchés) et **majoritairement implémentée** :

| Section | Sujet | État |
|---|---|---|
| §5.1 | Mesure à deux niveaux | ✅ Implémenté, testé, en production |
| §5.3 | Agrégation combo/groupe | ✅ Implémenté (agrégation de groupe : voir §5.6) |
| §5.4 | Signal d'infaisabilité natif | ✅ Implémenté (sous-produit de §5.1) |
| §5.5 | Pause flottante, découpage en deux fenêtres | ✅ Implémenté, testé |
| §5.6 | Troncature par échéance (`TaskUnit` et `TaskGroupUnit`), cas chaîne (`k=1`) | ✅ Implémenté, testé |
| §5.6 | Dépendants multiples (structure en éventail, `k>1`), correction de charge cumulée | ✅ Implémenté, testé (2026-07-10) |
| §5.7 | Attribution du blâme (`solveWithElimination`) | ✅ Implémenté, testé (2026-07-10) |
| §5.2 | Criticité de ressource (demande ferme) | ⏳ Conception tranchée, non implémentée |

Seul §5.2 reste non implémenté. Il n'affecte que le calcul de profil en amont de §5.1 — indépendant du reste, peut être engagé à tout moment.
