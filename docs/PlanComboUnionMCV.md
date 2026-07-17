# Plan Combo-Union — mesurer le score MCV sur l'union des combos (A/B derrière flag)

> **STATUT (2026-07-17) : NON LANCÉ — gate du plan frère fermé négatif (décision de Frédéric).** Le branchement combo (`bb4e98e`) n'a apporté aucun gain de placements ni de preuve sur le projet réel (S37-40, 64 cellules) pour un surcoût ×1,95 en itérations ; l'axe convergence — le seul où ce plan pourrait payer — est donc déjà mesuré négatif, et cette zone (tri dynamique du gourmand) reste la plus accidentogène du moteur (2 reverts). Le plan reste en réserve tel quel ; ne l'exécuter que sur nouvelle décision explicite de Frédéric, avec re-mesures préalables.

**Préconditions (VERROUILLÉ — ne PAS exécuter avant)** : (1) `docs/PlanComboBranchementBB.md` livré ET son gate franchi (analyse des mesures de validation réelle par Fable/Frédéric — les résultats du branchement peuvent réviser l'intérêt ou le design de ce plan) ; (2) `docs/PlanOptionalTasksP2Explication.md` implémenté et conservé (précondition héritée du plan frère) ; (3) validation explicite de Frédéric au moment de lancer.

**AVANT TOUT CODE** : lire la mémoire `project_scheduler_core_priority_rewrite` (deux pièges signe/propagation documentés dans cette zone) et relire l'historique des deux reverts (DailyUsageReader, tie-break popularité — semaine 37 en échec total) : le tri dynamique est la zone la plus accidentogène du moteur, et l'audit (`docs/AuditConformiteMCV.md` §3.2) concluait « candidat à un A/B un jour, pas un chantier — à garder en tête, pas à toucher » sans mesure préalable.

## 1. Contexte

Second volet de l'écart « meilleur combo vs union » (le premier — complétude de la recherche — est traité par le plan frère) : **la fidélité de la mesure fail-first**. Le score MCV mesure la marge du meilleur combo seul (`getBestSchedulingProfile`, taskScheduling.ts:108, justification historique « sa vraie marge est bornée par sa meilleure option ») au lieu de l'union des combos. Pour le fail-first c'est l'union qui compte : une tâche à dix combos médiocres mais complémentaires a plus d'options réelles qu'une tâche à un seul bon combo, et la mesure actuelle peut inverser leur rang. Mesures du projet réel (voir plan frère §1) : 58-74% de cours multi-combos, moyenne 2,2-2,7 combos — l'approximation concerne la majorité des tâches.

## 2. Flag et périmètre

`SchedulerConfig.mcvUnionDomain?: boolean`, défaut `false`. Touche UNIQUEMENT la mesure de flexibilité du tri dynamique (`getSchedulingPriority` → variante union de `getBestSchedulingProfile`) — aucun changement d'exploration. Affecte les DEUX moteurs quand le flag est actif (c'est le but : le tri du gourmand est le produit de production — d'où le flag et le protocole A/B strict).

## 3. Design

Variante `getUnionSchedulingProfile` : au lieu du max sur le produit cartésien des alternatives, l'union des intervalles des profils de tous les combos — avec les mêmes traitements pause flottante (§5.5) et échéance de dépendants (§5.6) que la variante actuelle (attention aux pièges mémorisés : signes et propagation). Le score n'a besoin que d'une mesure agrégée (minutes totales / nombre de créneaux) : la calculer par balayage des listes d'intervalles sans matérialiser une `Availability` complète si le coût par tri devient sensible — à mesurer d'abord, pas d'optimisation préventive.

## 4. Tests

1. **Inversion de rang corrigée** : tâche à N combos médiocres complémentaires vs tâche à 1 bon combo — flag off : rang inversé (comportement actuel documenté) ; flag on : l'union classe correctement la tâche mono-combo comme plus contrainte. Vérifier empiriquement avant de figer.
2. **Suites complètes intactes flag off** (aucun changement de comportement par défaut).
3. **Déterminisme flag on** (deux runs identiques).

## 5. Validation réelle et règle de décision

A/B 4 semaines (S37-40) × budgets standard (1000/3000/10000/30000), sur le gourmand ET le B&B (flag `comboBranching` dans l'état décidé au gate du plan frère). Re-export à demander si le projet a bougé. Rapporter placées/sautées/prouvé/itérations par colonne.

**Règle de décision** (à acter avec Frédéric, pas unilatéralement) :
- Jamais-pire partout ET gain mesurable quelque part → proposer le passage du défaut à `true` ;
- Résultats mixtes → le flag reste off par défaut, verdict documenté (précédent COS : flag conservé, config pratique documentée) ;
- Dégradation quelque part → STOP habituel, rapporter sans changer le défaut.

## 6. Livraison et hors périmètre

- Commit unique, STATUT de CE document mis à jour, conventions habituelles.
- Hors périmètre : toute modification de l'exploration (plan frère) ; tout changement de défaut sans décision explicite de Frédéric ; wdeg/restarts (exclus par l'audit).

## 7. Definition of done

- [ ] `mcvUnionDomain` (défaut off), variante union du profil avec pause flottante + échéances, pièges mémorisés relus et respectés
- [ ] Test d'inversion de rang + déterminisme + suites complètes intactes ; typecheck clean
- [ ] Validation A/B rapportée dans le STATUT, décision de défaut actée par Frédéric
- [ ] Commit unique, conventions respectées
