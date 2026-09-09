# Audit de conformité — l'heuristique MCV face à l'état de l'art

*Analyse rédigée par Fable (2026-07-17) à la demande de Frédéric, en complément de `docs/AuditBackjumping.md` (qui avait déjà établi la conformité de COS). Objet : comparer l'heuristique de choix de variable du moteur (`_dynamicSort` / `getSchedulingPriority`) aux recommandations de la littérature CSP et ordonnancement. Code audité : `packages/scheduler-core/src/priorityMeasure.ts`, `taskScheduling.ts`, `taskUnit.ts`, `taskGroupUnit.ts`, `scheduler.ts` (état au commit `659bde5`).*

## 1. Ce que notre MCV est, précisément

À **chaque nœud** du backtracking (re-tri intégral, pas un tri initial), chaque unité restante est mesurée par un couple lexicographique (`priorityMeasure.ts`) :

- **`usableWindowCount`** : nombre de fenêtres de disponibilité pouvant accueillir la durée de la tâche ;
- **`slackTotal`** : nombre total de positions de départ valides (pas de 30 min), toutes fenêtres confondues.

La mesure est calculée sur le **profil effectif** de l'unité : intersection des disponibilités du **meilleur combo** de ressources (`getBestSchedulingProfile`, §5.3 — max sur le produit cartésien des alternatives), tenant compte des **réservations courantes** (les disponibilités mutent au `book`), de la **pause méridienne flottante** en position canonique (§5.5, correctif de score uniquement) et de l'**échéance imposée par les dépendants** (§5.6, troncature avec correction de charge cumulée en éventail). L'unité la **moins** disponible passe en premier ; les unités dont la dépendance n'est pas encore placée sont reléguées derrière (partition ready/notReady) ; COS réordonne ensuite les « ready » par récence d'échec si le flag est actif. Ordre des **valeurs** : créneau le plus tôt (`earlySchedule`), par pas de 30 min.

## 2. Correspondance avec la littérature

| Notre mécanisme | Référence | Verdict |
|---|---|---|
| Variable la plus contrainte d'abord (`slackTotal` = taille du domaine des débuts valides) | *Fail-first principle*, MRV/dom — Haralick & Elliott 1980 | **Conforme** : c'est exactement MRV, appliqué au domaine réel des débuts |
| Re-tri **dynamique à chaque nœud** | DVO dynamique ≫ statique — Bacchus & van Run 1995 ; Chen & van Beek 2001 (JAIR 14) | **Conforme et fort** — quantifié par notre audit H4 : 110 vs 1 000 000 itérations sur la semaine 40 faisable |
| Domaine mesuré **après** les réservations courantes | Équivalent d'un MRV post-*forward checking* | **Conforme** — c'est ce qui rend le tri adaptatif |
| Troncature par échéance des dépendants, correction de charge cumulée (éventail) | Ajustements têtes/queues de Carlier & Pinson (cité dans `computeDependentsDeadline`) ; propagation temporelle standard (LST) | **Conforme**, au-dessus du MRV naïf |
| Valeur = créneau le plus tôt | Ordre chronologique / *left-shift*, standard en ordonnancement (SGS du RCPSP) | **Conforme** |
| COS sur la partition « ready » | Gay, Hartert, Lecoutre, Schaus — CP 2015 | **Conforme** (vérifié dans `docs/AuditBackjumping.md` et lors du chantier COS) |
| Égalités de score : ordre stable (insertion) | La littérature suggère tie-break lexicographique ou aléatoire | **Acceptable** — déterministe ; le tie-break « popularité » a été testé et reverté après régression réelle (semaine 37) |

## 3. Les trois écarts, leur justification, leur statut

### 3.1 `usableWindowCount` en premier critère — non standard, validé empiriquement

Le MRV textbook trierait par **taille** de domaine (`slackTotal`) d'abord. Nous trions d'abord par **nombre de fenêtres** — un critère de *forme* du domaine : une tâche à 1 fenêtre de 10 positions est traitée comme plus fragile qu'une tâche à 5 fenêtres de 2 positions (un seul conflit tue la première ; la seconde a des replis indépendants). Apparenté en esprit aux heuristiques de *texture/contention* de l'ordonnancement (Sadeh 1991) plus qu'au MRV générique ; pas de référence connue classant par nombre de composantes connexes d'abord. **Écart réel, assumé, validé** : toute la refonte §5.1 (`docs/HeuristiquePriorite-Conception.md`) a été éprouvée sur le projet réel, et H4 confirme l'efficacité du tri résultant.

### 3.2 Domaine = meilleur combo, pas l'union des combos — le seul écart théoriquement discutable

Le vrai domaine d'une tâche est l'**union** des débuts valides sur tous ses combos d'alternatives ; nous mesurons le **meilleur combo seul** (justification de `getBestSchedulingProfile` : « sa vraie marge est bornée par sa meilleure option »). Pour le fail-first, c'est l'union qui compte : une tâche à dix combos médiocres mais complémentaires a plus d'options réelles qu'une tâche à un seul bon combo, et notre mesure peut inverser leur rang. Circonstances atténuantes : l'union coûterait plus cher (union d'Availability sur tout le produit cartésien), l'approximation va dans le sens prudent (surestimer la contrainte), et aucune mesure réelle ne l'a incriminée à ce jour. **Statut : candidat à un A/B un jour, pas un chantier** — l'historique du projet (DailyUsageReader reverté, tie-break popularité reverté) montre que « améliorer » un tri qui marche est le meilleur moyen de le casser.

### 3.3 Ni dom/wdeg, ni restarts randomisés — délibéré et étayé

Le défaut moderne des solveurs CP **génériques** est dom/wdeg (Boussemart et al. 2004, précédé de dom/deg — Bessière & Régin 1996) et les restarts randomisés contre les queues lourdes (Gomes, Selman, Kautz). Écarts délibérés chez nous : dom/wdeg explicitement réservé (`HeuristiquePriorite-Conception.md` §4.6) ; le tie-break « popularité » (cousin d'un terme de contention) testé puis **reverté** après régression réelle ; le déterminisme est devenu une exigence du projet (leçon de la « loterie wall-clock », cf. chantier COS). Nuance qui rend l'écart moins hérétique : en ordonnancement **spécifiquement**, dom/wdeg n'est pas dominant — l'état de l'art y emploie plutôt textures (Sadeh), slack (Smith & Cheng 1993), *impact-based search* (Refalo 2004), *activity-based search* (Michel & Van Hentenryck 2012) ou *failure-directed search* (Vilím, Laborie, Shaw 2015).

## 4. Conclusion

Notre MCV est un **MRV dynamique post-propagation légère avec ordre de valeurs chronologique** — le squelette que la littérature recommande pour ce type de moteur — enrichi de deux raffinements maison (fenêtres-d'abord §3.1 ; échéances de dépendants façon Carlier & Pinson) et amputé volontairement de deux mécanismes standard (wdeg, restarts) pour des raisons documentées et vérifiées sur le projet réel. Le seul point que la théorie regarderait de travers est l'approximation « meilleur combo vs union » (§3.2) — à garder en tête, pas à toucher.

La vraie distance du moteur à l'état de l'art n'est pas dans le MCV : elle est dans l'**absence de propagation de contraintes** (edge-finding, timetabling sur ressources cumulatives/disjonctives) dont les solveurs CP tirent leur puissance d'élagage — notre mesure de priorité en réintègre une petite partie « en lecture » (réservations, échéances, pause), mais rien n'élague les domaines pendant la descente. C'est une considération pour après le chantier tâches optionnelles (`docs/ConceptionTachesOptionnelles.md`), pas avant : le B&B sur les sauts corrige d'abord l'objectif de la recherche ; la propagation en accélérerait ensuite l'exploration.

## 5. Références

- Haralick & Elliott, *Increasing tree search efficiency for constraint satisfaction problems*, Artificial Intelligence 14, 1980 (fail-first, MRV).
- Bacchus & van Run, *Dynamic variable ordering in CSPs*, CP 1995 ; Chen & van Beek, *Conflict-directed backjumping revisited*, JAIR 14, 2001 (valeur du DVO dynamique).
- Bessière & Régin, *MAC and combined heuristics…*, CP 1996 (dom/deg).
- Boussemart, Hemery, Lecoutre, Saïs, *Boosting systematic search by weighting constraints*, ECAI 2004 (dom/wdeg).
- Smith & Cheng, *Slack-based heuristics for constraint satisfaction scheduling*, AAAI 1993.
- Sadeh, *Look-ahead techniques for micro-opportunistic job shop scheduling*, CMU 1991 (textures/contention).
- Refalo, *Impact-based search strategies for constraint programming*, CP 2004.
- Michel & Van Hentenryck, *Activity-based search for black-box constraint programming solvers*, CPAIOR 2012.
- Vilím, Laborie, Shaw, *Failure-directed search for constraint-based scheduling*, CPAIOR 2015.
- Gomes, Selman, Kautz, *Boosting combinatorial search through randomization*, AAAI 1998 (restarts, queues lourdes).
- Carlier & Pinson, *An algorithm for solving the job-shop problem*, Management Science 1989 (ajustements têtes/queues — base de la correction §5.6).
- Gay, Hartert, Lecoutre, Schaus, *Conflict ordering search for scheduling problems*, CP 2015.
