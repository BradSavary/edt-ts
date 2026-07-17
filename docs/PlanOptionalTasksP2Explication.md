# Plan P2-Explication — diagnostic MUS systématique + analyse de charge des tâches sautées

*Plan rédigé par Fable pour implémentation par Sonnet. Prérequis : P3 livré (`8b59e94`, `6390690`). Branche : `feature/optional-tasks`. Contexte : l'analyse manuelle de Frédéric sur S40 (voir mémoire de session et STATUT P3) a montré que le diagnostic utile est (a) l'ensemble de conflit exact de chaque sautée et (b) la table charge/capacité quotidienne des ressources impliquées — or (a) n'est actuellement produit que si le B&B améliore le gourmand (jamais observé sur données réelles), et (b) se fait à la main via le module statistique. Deux briques indépendantes. Le volet « P2-preuve » (LB bin-packing à la racine) est explicitement REPORTÉ.*

## 1. Brique 1 — explications MUS aussi pour le résultat hérité du gourmand

### 1.1 Problème

`OptionalTasksScheduler.solveWithElimination()` : quand la passe B&B n'améliore pas la passe gourmande (cas de TOUTES les semaines réelles testées), le résultat rendu est `greedyBest` avec les `reason` du gourmand (« Unité la plus bloquante (N échecs)… », « Dépend de… ») — les explications riches de `_explainSkip` (deletion-MUS, « créneaux nécessaires occupés par X, Y — relâchement nécessaire ») n'apparaissent que sur un incumbent trouvé PAR le B&B (`_recordIncumbent`). Arbitrage P1.5 assumé à l'époque, maintenant levé.

### 1.2 Contrainte technique et solution retenue : rejeu déterministe

`_explainSkip` → `_computeExactConflictSet` exige l'état de la feuille : pile `_solution` peuplée au niveau UNITÉ (le MUS libère/re-réserve des entrées via `unit.unBook`/`unit.book` — `_releaseEntry`/`_restoreEntry`), `_scheduled` et les compteurs d'usage quotidien reconstruits (le `_probePlaceable` du MUS applique les filtres pause/plafonds). Or après les deux passes, l'état est déroulé.

**On ne peut PAS re-réserver à froid** : `TaskGroupUnit.book()` jette sans `earlySchedule()` préalable (`_pendingAssignment`, taskGroupUnit.ts:158-160).

**Solution : rejouer le placement dans l'ordre de la pile d'origine.** `earlySchedule` est déterministe et, à préfixe d'état identique, retourne exactement le même résultat (même créneau, même combo — le tie-break « premier combo au créneau le plus tôt » est stable par élévation du `fromTime` au start enregistré : tout combo classé avant le gagnant rendait un créneau strictement plus tardif, et élever la borne ne peut que retarder). Donc : rejouer les unités DANS L'ORDRE de `greedyBest.solutions` en appelant `unit.earlySchedule(startEnregistré)` puis `unit.book(result)` reconstruit fidèlement l'état final du gourmand, membres de groupes et combos compris.

### 1.3 Implémentation (`optionalTasksScheduler.ts`)

Nouvelle méthode privée `_explainInheritedResult(greedyBest: SchedulerSolution): SchedulerSolution` :

1. `this.initSolver()` — état frais, enforced pré-réservés (re-log « booking forcé » cosmétique, même acceptation qu'en P1.5).
2. Reconstituer l'ordre de pile au niveau unité depuis `greedyBest.solutions` : dédupliquer les entrées consécutives partageant le même `unit` (un `TaskGroupUnit` produit N `UnitSolution` contigus ; son start de groupe = le start de la PREMIÈRE entrée). Ignorer les unités `isEnforced` (déjà réservées par `initSolver`).
3. Pour chaque unité dans cet ordre : `const r = unit.earlySchedule(startEnregistré)` ; **garde de fidélité** : si `r === null || r.start !== startEnregistré`, abandonner proprement (log warning + retourner `greedyBest` inchangé — les raisons gourmandes restent un repli correct, ne jamais produire une explication calculée dans un état divergent). Sinon `unit.book(r)`, `this._solution.push({unit, result: r})`, `this._scheduled.set(unit.id, r)`, `this._addDailyUsage(r, unit.duration)`.
4. Reconstruire `neutralizedUnits` : pour chaque entrée de `greedyBest.neutralizedUnits`, si `unit.getDependsOn()` est lui-même dans l'ensemble des sautées → raison style cascade (« Sautée par cascade : dépend de « <id> », elle-même non plaçable — relâchement nécessaire pour atteindre 100%. ») ; sinon `reason = this._explainSkip(unit)`. Nouveaux objets (ne pas muter les entrées d'origine), `eliminationRound`/`failureCount` conservés.
5. Retourner `{ ...greedyBest, neutralizedUnits: <reconstruits> }`. Ne pas dérouler l'état (fin de méthode ; tout appel ultérieur ré-init).

Appel : dans `solveWithElimination`, sur le chemin « B&B n'a pas amélioré » uniquement (`best === greedyBest` par référence, ou flag posé au seed). Le court-circuit gourmand-complet (0 sautée) n'a rien à expliquer — inchangé. Coût : ~1 `earlySchedule` par unité placée + 1 MUS par sautée (déjà le prix d'un incumbent B&B) — négligeable.

Mettre à jour la docstring de classe (le paragraphe « les explications MUS n'apparaissent que si le B&B améliore » devient obsolète) et celle de `solveWithElimination`.

### 1.4 Tests (brique 1)

Vérifier chaque assertion empiriquement avant de figer (méthode habituelle).

1. **MUS hérité — coupable désigné** : scénario où le gourmand saute une unité dont l'impasse est causée par des occupantes identifiables (réutiliser la famille « occupant + victime » : U0 240min saturant la fenêtre du prof + victime 30min) → la raison de la sautée doit contenir « créneaux nécessaires occupés par » et l'id du coupable, PLUS « Unité la plus bloquante ».
2. **Cascade héritée** : CM inplaçable + TD dépendant (scénario du test existant) → CM : raison MUS ou « structurellement insuffisantes » ; TD : « Sautée par cascade » avec l'id du CM.
3. **Groupes dans la solution** : un scénario avec un `TaskGroupUnit` PLACÉ et une unité sautée → le rejeu passe la garde de fidélité (pas de repli), l'explication est produite.
4. **Garde de fidélité** : difficile à déclencher naturellement (le rejeu est prouvé fidèle) — tester le repli par white-box si simple (sous-classe forçant un start faux), sinon s'assurer par revue que le repli retourne `greedyBest` intact et documenter.
5. **⚠️ Tests existants à ADAPTER (changement voulu, c'est l'objet de la brique)** : « cascade de dépendants » asserte aujourd'hui `cm.reason` ⊃ « Unité la plus bloquante » et `td.reason` ⊃ « Dépend de » — ces assertions basculent vers les nouveaux styles (MUS/« structurellement insuffisantes » pour le CM, « Sautée par cascade » pour le TD). Vérifier les 17 autres tests (le jeu 80-tâches et les faisables ne sont pas affectés : 0 sautée).

## 2. Brique 2 — analyse de charge/capacité pour chaque tâche sautée (client)

### 2.1 Principe

Automatiser la table que Frédéric construit à la main : pour chaque ressource candidate d'une tâche sautée, par jour de la semaine — capacité effective, charge placée, mou — plus les totaux hebdo, avec mise en évidence des jours où le mou est insuffisant pour la durée de la tâche. **Entièrement côté client** (aucun changement moteur/API) : la solution affichée, les contraintes, les zones bloquées et le catalogue de ressources sont déjà dans les stores.

### 2.2 Calcul — nouveau module pur `packages/scheduler-client/lib/neutralizedLoadAnalysis.ts`

Entrées : la tâche sautée (`NeutralizedTaskInfoJSON` — `task.resources` liste déjà TOUTES les ressources candidates, alternatives comprises, cf. `serializeNeutralizedUnit`), les tâches placées affichées (`activeSolution: TaskSolutionJSON[]`), les contraintes + zones bloquées + semaine (pour les contraintes EFFECTIVES, réutiliser `applyBlockedZonesToConstraints` — même fonction que le payload moteur, cohérence garantie), le catalogue `resources` (pour `maxDailyMinutes`).

Sortie par ressource candidate : `{ resourceId, resourceType, days: [{ day, capacityMin, loadMin, slackMin, fits }], weeklyCapacity, weeklyLoad, weeklySlack, anyDayFits }` où :
- `capacityMin` (jour) = minutes des `TimeSlot` du jour dans les contraintes effectives de la ressource (résolution `Default`/hebdo comprise, même logique que le moteur), plafonnées par `maxDailyMinutes` si défini ;
- `loadMin` (jour) = somme des durées des tâches placées utilisant cette ressource ce jour-là (réutiliser/étendre `SolutionAnalysis.dailyUsageMinutes` de scheduler-common plutôt que recoder) ;
- `fits` = `slackMin >= durée de la tâche sautée` (approximation volontairement grossière — le mou peut être fragmenté en intervalles < durée ; l'afficher comme « mou » et non « créneau disponible », le libellé compte).

Tests unitaires du module (nouveau fichier `__tests__/neutralizedLoadAnalysis.test.ts`) : cas nominal, ressource sans contrainte propre (fallback Default), `maxDailyMinutes` plafonnant, jour vide, et le cas d'école LAVEFVE reconstruit en miniature (volume hebdo qui passe, aucun jour avec mou suffisant → `anyDayFits === false` partout).

### 2.3 UI — panneau Analyse (`SidebarAnalysis.tsx` + nouveau composant)

Le tooltip actuel est trop étroit pour une table. Sur chaque `NeutralizedTaskCard` (tâches non placées uniquement, pas les pré-neutralisées) : un petit bouton/icône « Analyse de charge » ouvrant un **Popover** (composants ui existants) contenant, par ressource candidate :
- ligne d'en-tête : id de la ressource + « hebdo : charge X h / capacité Y h » ;
- mini-table 5 colonnes (lun→ven) : capacité / charge / mou, cellule de mou en rouge si `!fits` ;
- bandeau de synthèse si `anyDayFits === false` sur toutes les ressources d'un slot : « Aucun jour n'a assez de mou pour cette tâche (<durée>) — ressource(s) en tension sur la semaine. »

Optionnel si trivial (sinon reporter) : un lien « Ouvrir dans les statistiques » pré-filtrant `StatisticsDialog` sur ces ressources — vérifier d'abord si le dialogue accepte une présélection ; ne PAS refactorer le dialogue pour ça.

Le tooltip existant reste tel quel (la raison MUS de la brique 1 y apparaîtra naturellement via `reason`).

### 2.4 Tests (brique 2)

Module pur : couverts en 2.2. UI : test de rendu léger si l'infra existante le permet facilement (pattern `EnforceModal.test.tsx`) — ouverture du popover, présence de la table et du bandeau de synthèse sur un cas construit ; sinon vérification Playwright ad hoc en §3.

## 3. Validation

1. Typecheck racine + suites complètes core et client.
2. **Données réelles S40** (export du 16/07, pipeline habituel, `maxPlacement`, COS on) : les `reason` de DUBOIS et LAVEFVE doivent devenir MUS-style (rapporter leur texte exact — juger la lisibilité) ; la table de charge de LAVEFVE doit retrouver l'analyse manuelle de Frédéric (≈33,5h de charge pour ≈34,5h de capacité sur BUT2-G1/G2, aucun jour avec mou ≥ 1,5h). **C'est le critère d'acceptation métier de tout le chantier.**
3. Vérification UI Playwright ad hoc (script jetable) : import du projet réel, planification S40 en `maxPlacement`, ouverture du popover d'une sautée, capture du contenu. Zéro erreur console.
4. S37 : mêmes placements/sautées qu'avant (la brique 1 ne change QUE les `reason`), optimum toujours prouvé.

## 4. Livraison

- Commit unique sur `feature/optional-tasks` : briques 1+2 + tests + STATUT de CE document. Conventions habituelles (français, fichiers stagés par nom, signature, scripts tmp supprimés, aucun fichier `data/`).

## 5. Hors périmètre

- P2-preuve (LB bin-packing exact à la racine, sommée sur ensembles disjoints) — reporté, voir mémoire de session.
- Refactor de `StatisticsDialog` ; multi-solutions ; toute modification du moteur au-delà de `_explainInheritedResult`.

## 6. Definition of done

- [ ] Brique 1 : `_explainInheritedResult` (rejeu déterministe + garde de fidélité + repli sûr), appelée sur le chemin hérité uniquement ; docstrings à jour
- [ ] Brique 2 : module pur `neutralizedLoadAnalysis` + popover « Analyse de charge » dans le panneau Analyse
- [ ] Tests : 4 nouveaux core (MUS hérité, cascade, groupes, repli), tests existants adaptés (assertions de `reason`), tests unitaires du module client ; suites complètes vertes, typecheck clean
- [ ] Validation réelle S40 : raisons MUS lisibles pour DUBOIS/LAVEFVE, table de charge reproduisant l'analyse manuelle — textes/chiffres rapportés dans le STATUT
- [ ] Commit unique, conventions respectées
