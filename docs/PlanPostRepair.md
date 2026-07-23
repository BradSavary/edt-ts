# Plan Post-Repair — réparation post-résolution des unités neutralisées

*Plan rédigé par Fable pour implémentation par Sonnet. Branche : `feature/post-repair`. Flag défaut `false` — généralisation = décision de Frédéric après le gate §5.*

> **STATUT (Sonnet, 2026-07-23) : implémenté, testé, DoD verte. Gate §5 (validation réelle) reste à faire par Frédéric avant fusion/généralisation.**
>
> Écarts par rapport au libellé initial :
> - **§4, méthode de construction des scénarios de test.** Le scénario de référence tel que
>   décrit (O flexible {A,B} vs U bloquée sur A seule) ne se reproduit PAS en pilotant
>   `solveWithElimination()` de bout en bout sur un cas à 2 tâches : le blâme (`_computeConflictSet`,
>   exact ou approximatif) identifie CORRECTEMENT O comme responsable réel du blocage de U (il
>   l'est) et élimine O, pas U — l'inverse de ce que le scénario réclame. Ce n'est pas un bug :
>   c'est précisément le point mort que `repairNeutralized` vise à corriger, mais il rend le
>   scénario a-h irreproductible via le seul `solveWithElimination()` naturel. Les tests
>   construisent donc l'état pré-réparation directement (sous-classe `InspectableScheduler`
>   exposant `_units`, exclusion explicite des unités à neutraliser puis `solve()`) — postcondition
>   engine identique (`_solution` = enforced uniquement) à ce que rendrait un vrai
>   `solveWithElimination()`, donc la précondition de `repairNeutralized` reste honnêtement
>   vérifiée. Voir le commentaire en tête de `packages/scheduler-core/__tests__/postRepair.test.ts`.
> - **§4d, cascade.** L'implémentation résout la cascade (U puis D) dans la MÊME passe quand
>   l'ordre du tableau le permet (D suit immédiatement U dans `neutralizedUnits`, donc son
>   `_scheduled.has(dep.id)` est déjà vrai) plutôt qu'à la passe suivante comme décrit
>   littéralement — la boucle à point fixe reste correcte (elle continue tant qu'une passe a
>   progressé), c'est seulement plus rapide que décrit. Le test vérifie l'invariant observable
>   (D placée avec `start = fin(U)`), pas un compte de passes.
> - **Résultat DoD** : `postRepair` dans les deux littéraux ✅, `repairNeutralized` +
>   `_probePlacement` + `_trySwapRepair` sur `Scheduler` ✅ (garde d'entrée, re-matérialisation
>   directe des ressources — jamais via `unit.book()`, pour ne pas casser `_pendingAssignment`
>   des groupes — et restauration miroir intégrale via une pile d'undo LIFO), sites d'appel
>   scheduler-api (controller + worker) ✅, checkbox client ✅, tests §4 a-h verts (11/11) ✅,
>   suites existantes intactes (148/148) ✅, typecheck 4 workspaces ✅.
>
> **Revue Fable (2026-07-23) : validée, avec un correctif.** Audité sur pièces : imbrication
> LIFO de la pile d'undo (tracée sur le cas « occupant swappé deux fois » — les inversions
> s'emboîtent exactement), pureté du résultat d'entrée (copies superficielles, remplacement
> plutôt que mutation), placement de U via `earlySchedule`→`book` (obligatoire pour
> `toSolutions` des groupes — l'écart « jamais `unit.book()` » du STATUT ne concerne que la
> re-matérialisation du snapshot, justification valable), discipline de swap conforme (§2.3 :
> start constant strict, comparaison par contenu, soustraction avant `_dailyLimitAllows`,
> retrait de `_solution` pendant les checks), gating des deux sites d'appel, écarts de test
> documentés acceptés (la construction forcée reste fidèle à la précondition ; le blâme qui
> élimine O et non U est cohérent avec le moteur et souligne que le sondage direct — l'unité
> éliminée re-sondée avec TOUS ses combos — sera le chemin le plus fréquent en réel).
> **Bug trouvé et corrigé (commit de revue)** : le résultat DÉGÉNÉRÉ de `solveWithElimination`
> (`solutions: []`, `isComplete: false`, aucun round abouti — ex. S37 pendant l'incident
> tie-break) passait la garde des sites d'appel (`neutralizedUnits` non vide) et aurait été
> « réparé » sur planning vide : seules les unités éliminées placées, la grande majorité des
> tâches silencieusement absentes — pseudo-résultat trompeur. Correctif : garde no-op
> `!result.isComplete` dans `repairNeutralized` (les résultats légitimes d'elimination portent
> toujours `true`) + builder de test aligné sur le contrat réel (`isComplete: true`) + test
> dédié « h. dégénéré ». 149/149, typecheck 4 workspaces clean.

## 0. Contexte

Symptôme visé : des unités neutralisées par `solveWithElimination` alors qu'un simple changement de combo (ex. de salle) d'une unité placée les rendrait plaçables. Cause structurelle : le moteur ne branche jamais sur les combos (`fromTime += 30` déplace le temps, pas l'affectation). Remède retenu (post-mortem `docs/PlanTieBreakContention.md` §9) : **réviser le combo uniquement là où un échec avéré le réclame, APRÈS la recherche** — jamais de biais a priori (famille tie-break morte), jamais de modification de `_backtrack`.

## 1. Principe et périmètre

Nouvelle méthode publique sur `Scheduler` (packages/scheduler-core/src/scheduler.ts) :

```ts
/** Tente de re-placer les unités neutralisées d'un résultat, par sondage direct puis
 *  swap de combo À START CONSTANT d'unités placées. Pure : retourne un NOUVEAU
 *  SchedulerSolution, restaure intégralement l'état moteur avant de rendre la main.
 *  Précondition : appelée immédiatement après solveWithElimination(), même instance. */
repairNeutralized(result: SchedulerSolution): SchedulerSolution
```

- **Flag** `SchedulerConfig.postRepair?: boolean`, défaut `false`. ⚠️ Ajouter aux DEUX littéraux `Required<SchedulerConfig>` (types.ts ~l.311 ET scheduler.ts ~l.60 — piège documenté).
- **Sites d'appel** (pas dans le moteur — pour ne PAS polluer la passe-1 gourmande du B&B qui appelle `super.solveWithElimination()`) : `scheduleController.ts` et `scheduler.worker.ts` (scheduler-api), juste après `solveWithElimination()`, uniquement si `postRepair` actif ET `searchStrategy !== 'maxPlacement'` ET `results[0]?.neutralizedUnits?.length > 0`. Remplacer `results[0]` par le résultat réparé.
- **Limites v1 (documentées dans la docstring)** : swap simple (un occupant à la fois), un seul niveau (pas de chaînes) ; occupants `TaskGroupUnit` jamais swappés (`book` couplé à `_pendingAssignment`) — le filtre `getComboCount() > 1` les exclut naturellement ; occupants enforced jamais touchés ; hors périmètre `maxPlacement` (un résultat « prouvé optimal » réparé contredirait la sémantique de la preuve).
- `_backtrack`, `_bb`, blâme, élimination, tri MCV : **intouchés**.

## 2. Design

### 2.1 État de base et re-matérialisation

Après le dernier `solve()`, l'état moteur est : `_solution`/`_scheduled`/`_dailyBookedMinutes` = entrées **enforced uniquement** (jamais dénouées), disponibilités = enforced bookées. **Garde d'entrée** : vérifier que `_solution` ne contient que des unités enforced, sinon `throw` (précondition violée).

Re-matérialiser la solution retenue à partir du snapshot `result.solutions` (`UnitSolution[]`) pour chaque entrée **non enforced** (`us.unit.isEnforced === false`) :

- Disponibilités : `r.availability.removeAvailability(start, start + dur)` pour chaque `r` de `us.resources`, avec `dur = us.task?.duration ?? us.unit.duration` (les groupes produisent une entrée PAR tâche membre, avec `task` renseigné).
- `_addDailyUsage({ start: us.start, resources: us.resources }, dur)` par entrée.
- `_solution`/`_scheduled` : reconstruire au **format moteur** (obligatoire pour que `_floatingLBAllows`, qui lit `_solution`, voie les cours placés) : une entrée par UNITÉ — TaskUnit : `{ unit, result: { start, resources } }` ; groupe : regrouper ses UnitSolutions → `{ unit, result: { start: min des starts, resources: flatMap } }` (même sur-approximation que pendant la recherche). Conserver la table `entréeMoteur → UnitSolution[] du snapshot` pour la mise à jour du résultat (§2.4).

À la fin (succès ou non) : **restauration miroir intégrale** — addAvailability/`_subtractDailyUsage`/retrait de `_solution`/`_scheduled` pour tout ce qui a été re-matérialisé ou placé par la réparation. L'instance revient à l'état exact post-`solve()` (testé, §4-g).

### 2.2 Boucle de réparation (point fixe)

Helper : `_probePlacement(unit, fromTime): SchedulingResult | null` — miroir de `_probePlaceable` (scheduler.ts l.408-417) qui **retourne le résultat** au lieu d'un booléen (boucle `earlySchedule` + `_floatingLBAllows` + `_dailyLimitAllows`, avance de `SLOT_STEP` sur rejet de filtre).

```
répéter jusqu'à passe blanche :
  pour chaque info de result.neutralizedUnits restante (ordre du tableau — déterminisme) :
    U = info.unit
    dep = U.getDependsOn()
    si dep non null et non présent dans _scheduled : passer (retenté à la passe suivante)
    fromTime = dep ? _scheduled[dep.id].start + dep.duration : 0
    r = _probePlacement(U, fromTime)                     // 1. sondage direct (l'état final ≠ état à l'élimination)
    si r === null : r = _trySwapRepair(U, fromTime)      // 2. swap dirigé (§2.3)
    si r !== null : placer U (§2.4), retirer de la liste
```

Terminaison : chaque passe place ≥ 1 unité ou s'arrête. Coût O(neutralisées² × occupants × combos), négligeable devant le solve.

### 2.3 `_trySwapRepair(U, fromTime)` — swap à start constant

Candidats occupants : entrées de `_solution` telles que `!unit.isEnforced && unit.getComboCount() > 1` et dont `result.resources` intersecte `new Set(U.getCandidateResourceSlots().flat())` (même filtre que `_computeExactConflictSet`, scheduler.ts l.442-443). Ordre de `_solution` (déterminisme).

Pour chaque occupant O (entrée `e`, `start = e.result.start`, `dur = e.unit.duration`) :

1. **Libérer O** : addAvailability de `e.result.resources` sur `[start, start+dur]`, `_subtractDailyUsage(e.result, dur)`, **retirer `e` de `_solution`** (sinon `_floatingLBAllows` compte l'ancien booking).
2. Pour chaque index de combo `c` de O : `cand = O.earlyScheduleForCombo(c, start)`. Rejeter si `cand === null`, si `cand.start !== start` (**start constant strict** — ne jamais déplacer O dans le temps : ses dépendants et le reste du planning n'en sont pas affectés), ou si `cand.resources` a le même contenu que `e.result.resources` (comparer par ensemble de Resources — les tableaux ne sont pas les mêmes objets). Vérifier `_dailyLimitAllows(cand, dur)` (l'usage de l'ancien combo est déjà soustrait — l'ordre compte) et `_floatingLBAllows(cand, dur)`.
3. **Booker le candidat** : removeAvailability + `_addDailyUsage(cand, dur)` + ré-insérer `e` dans `_solution` avec `result = cand` + `_scheduled.set(O.id, cand)`. Sonder : `r = _probePlacement(U, fromTime)`.
   - `r !== null` → **commit** : mettre à jour la/les UnitSolution de O dans le résultat (`resources = cand.resources`), retourner `r`.
   - sinon → **défaire** ce booking (miroir exact) et essayer le combo suivant.
4. Aucun combo ne débloque U → **restaurer O à l'identique** (re-booker `e.result` d'origine, ré-insérer dans `_solution`/`_scheduled`) et passer à l'occupant suivant. Un seul swap tenté à la fois — jamais deux occupants simultanément (limite v1).

### 2.4 Placement de U et résultat

- Placement : `U.book(r)` (flux normal `earlySchedule`→`book` — **obligatoire pour les groupes** : `book` consomme le `_pendingAssignment` écrit par le dernier `earlySchedule`, et `toSolutions` lit `_appliedResources`) + `_addDailyUsage(r, U.duration)` + entrée moteur dans `_solution`/`_scheduled`. Le unBook correspondant fait partie de la restauration finale (§2.1).
- Résultat retourné (ne jamais muter l'entrée) : nouveau `SchedulerSolution` avec `solutions` = copie du snapshot (entrées des occupants swappés mises à jour, `U.toSolutions(r)` ajoutées), `neutralizedUnits` = restantes, `score` = `solutions.length`, `isComplete` inchangé.
- Logs style moteur : `🔧 Réparation : « U » placée directement` / `placée via swap de « O » vers [ids du combo]` / bilan `🔧 Réparation post-résolution : k re-placée(s), m restante(s)`.

## 3. Plomberie config client

- `SchedulerConfigDialog.tsx` : checkbox « Réparation post-résolution des neutralisées (expérimental) », miroir du pattern des champs booléens existants (draft/save/default).
- `scheduleApi.ts` spreade déjà tout `schedulerConfig` (l.86) — rien à faire. Vérifier le flux `body.options` → `.configure()` dans les deux sites d'appel (§1) et y insérer l'appel à `repairNeutralized`.

## 4. Tests (`packages/scheduler-core/__tests__/postRepair.test.ts`)

Scénario de référence (à vérifier à la main avant de figer, méthode habituelle) : O (salles {A, B}, prof libre 8h-9h, durée 60, profil plus contraint → placée en premier, prend A par ordre de déclaration) ; U (salle A uniquement, prof libre 8h-10h, durée 90 → ne tient plus, blâme replié sur elle-même, éliminée). Résultat : O@A placée, U neutralisée.

- a. **Swap dirigé** : `repairNeutralized` → O re-bookée sur B au MÊME start, U placée 8h-9h30 en A ; `neutralizedUnits` vide ; les UnitSolutions de O portent B.
- b. **Start constant** : variante où B n'est libre qu'à partir de 8h30 → swap refusé (`cand.start !== start`), U reste neutralisée.
- c. **Filtres** : variante où le placement de U (ou le swap) violerait `maxDailyMinutes` ou la pause flottante → refusé.
- d. **Point fixe / cascade** : D dépend de U, neutralisée en cascade → après placement de U, D est placée à la passe suivante (`fromTime = start(U) + durée(U)`).
- e. **Groupe neutralisé** : un `TaskGroupUnit` neutralisé re-placé par sondage direct → `toSolutions` par membre dans le résultat.
- f. **Occupant groupe exclu** : la ressource bloquante est tenue par un groupe → aucun swap tenté, U reste neutralisée.
- g. **Restauration d'état** : après `repairNeutralized` (succès comme échec), disponibilités et usage quotidien identiques à l'état pré-appel (comparer les intervalles d'une ressource témoin).
- h. **Pureté + no-op** : l'objet résultat d'entrée n'est pas muté ; un résultat sans neutralisées est retourné tel quel ; deux appels sur les mêmes données → résultats identiques (déterminisme).

Suites existantes intactes, typecheck 4 workspaces.

## 5. Gate — validation réelle (Frédéric)

Sur le projet réel, semaines habituelles, `elimination`, flag on vs off : (1) nombre de neutralisées re-placées (LA métrique — le symptôme observé à l'usage), (2) surcoût wall-clock de la passe (attendu : négligeable), (3) aucun écart sur les runs sans neutralisée. Décision de généralisation (défaut `true` ?) : Frédéric uniquement.

## 6. Hors périmètre

Chaînes d'éjection (multi-swaps) ; swap d'occupants groupes ; intégration `maxPlacement` ; déplacement temporel des occupants ; toute modification de `_backtrack`/blâme/élimination.

## 7. Definition of done

- [x] `postRepair` dans les DEUX littéraux, défaut `false`
- [x] `repairNeutralized` + `_probePlacement` + `_trySwapRepair` sur `Scheduler` (garde d'entrée, re-matérialisation format moteur, restauration miroir intégrale)
- [x] Sites d'appel scheduler-api (controller + worker), checkbox client
- [x] Tests §4 a-h verts, suites existantes intactes, typecheck 4 workspaces
- [ ] Commit(s) sur `feature/post-repair`, STATUT mis à jour — gate §5 par Frédéric avant fusion/généralisation
