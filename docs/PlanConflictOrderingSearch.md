# Plan d'implémentation — Conflict Ordering Search (COS) derrière flag transitoire

*Plan rédigé par Fable (suite de l'audit `docs/AuditBackjumping.md`, recommandation R2) pour implémentation par Sonnet. Branche cible : `feature/backtracking`. Prérequis : le correctif `docs/PlanFixEliminationDependants.md` doit être mergé d'abord (COS déplace la distribution du blâme et peut exposer le bug d'élimination sinon). Décisions déjà arbitrées par Frédéric — ne pas les rouvrir.*

> **STATUT (2026-07-16, exécution par Sonnet) : STOP, rien commité.** Implémentation fidèle au plan, 5 tests verts, non-régression parfaite sur les semaines réelles 37/38/39 (off/on identiques au ms près). Mais la semaine 40 (le seul cas différenciant du panel) **régresse** avec `conflictOrderingSearch:true` : 42 872ms / 5 neutralisées, contre 14 510ms / 2 neutralisées en baseline (`false`, avec le fix élimination déjà appliqué + `conflictSetSlotAware` permanent sur cette branche). C'est le critère STOP explicite du §5 de ce document — code laissé dans l'arbre de travail (non commité), en attente de décision de Frédéric. Hypothèse non vérifiée : COS change quelles unités échouent en premier, donc la distribution de `_failureCounts`, donc la cible choisie par `solveWithElimination` — à l'image de l'interaction négative slotAware+dailyLimitAware trouvée par Fable sur ce même projet. Détail complet dans la mémoire de session (`project_backtracking_thrashing_backjumping.md`). Note de calibration : construire un scénario synthétique où COS gagne nettement (le ×2 suggéré au §4.7) s'est avéré très difficile en pratique — COS ne reprioritise que ce qui échoue *personnellement*, jamais une unité innocente qui trouve toujours un créneau mais de façon globalement incompatible ; le test 3 final vérifie donc le mécanisme directement (white-box) plutôt qu'un gain combinatoire.

## 1. Contexte et objectif

L'audit du backjumping (`docs/AuditBackjumping.md`) a conclu que le look-back n'a aucun régime utile dans ce moteur : le tri MCV dynamique localise déjà les conflits (110 itérations vs 1 000 000 en ordre statique sur la semaine 40 faisable). En revanche, le moteur reste exposé au **thrashing en queue lourde** quand une unité tardive échoue pour une cause lointaine : le backtracking chronologique re-explore tout l'intervalle avant de retoucher la cause (cas réel : semaine 40, rounds d'élimination brûlant intégralement leur timeout de 10 s, éliminations sous-optimales sous contrainte de temps).

**Conflict Ordering Search** (Gay, Hartert, Lecoutre, Schaus, *Conflict Ordering Search for Scheduling Problems*, CP 2015 — généralisation du *Last-Conflict reasoning*, Lecoutre et al., AIJ 2009) attaque exactement ce problème **par l'ordre au lieu du contrôle de flux** : chaque unité qui échoue reçoit un horodatage de conflit ; au choix de la variable suivante, les unités récemment en échec passent devant l'heuristique par défaut. Effet : en remontant chronologiquement, l'unité problématique est *retentée immédiatement* à chaque niveau — elle « remonte l'arbre par l'ordre », ce qui produit l'équivalent d'un backjump vers son vrai niveau de blocage, **sans aucune exigence d'exhaustivité des causes ni aucun risque de complétude** (pure heuristique d'ordre : on ne saute jamais par-dessus quoi que ce soit).

Propriété clé à préserver et tester : **sans aucune impasse, COS est inerte** — aucune unité horodatée → l'ordre reste exactement le MCV → exploration byte-identique au moteur actuel.

## 2. API

`packages/scheduler-common/src/types.ts` — ajouter à `SchedulerConfig` (et `DEFAULT_SCHEDULER_CONFIG`, et au `_config` par défaut de `Scheduler`) :

```ts
/**
 * Paramètre transitoire : si true, active le Conflict Ordering Search (Gay et al., CP 2015) —
 * les unités récemment en échec sont priorisées dans le tri dynamique, devant le score MCV.
 * Sans impasse, strictement sans effet (ordre MCV inchangé). Défaut : false (comportement
 * historique) — à activer explicitement pour comparer avec/sans sur le projet réel avant
 * toute généralisation (cf. incidents DailyUsageReader et tie-break popularité, revertés).
 */
conflictOrderingSearch?: boolean;
```

Pas de changement API scheduler-api ni client : le flag transite par `options` comme les autres.

## 3. Moteur (`packages/scheduler-core/src/scheduler.ts` — seules modifications)

### 3.1 État

Deux champs privés + remise à zéro dans `_resetBacktrackState()` (ligne ~407) :

```ts
private _conflictStamps = new Map<string, number>(); // id → horodatage du dernier échec (COS)
private _stampCounter = 0;
```

Remise à zéro **à chaque `solve()`** (donc à chaque round d'élimination) : apprentissage frais par round. La persistance inter-rounds est explicitement **hors périmètre v1**.

### 3.2 Horodatage à l'impasse

Dans `_backtrack`, branche d'impasse (là où `earlySchedule` retourne `null` et où `_incrementFailureBlame(unit, fromTime)` est appelé — lignes ~264-268) :

```ts
if (this._config.conflictOrderingSearch) {
    this._conflictStamps.set(unit.id, ++this._stampCounter);
}
```

**Uniquement à la vraie impasse** (`result === null`) — surtout PAS dans les rejets par filtres (pause flottante / plafond quotidien), qui ne sont pas des impasses. Choix COS (vs Last-Conflict) : l'horodatage **persiste après un placement réussi** de l'unité et n'est **mis à jour qu'à un nouvel échec** — ne jamais l'effacer en cours de `solve()` (c'est ce qui distingue COS de LC dans l'article ; la variante LC « effacement au succès » est hors périmètre v1).

### 3.3 Tri (`_dynamicSort`, lignes ~379-398)

Après la construction de `ready` (déjà triée MCV, partition ready/notReady inchangée — l'invariant de dépendance est préservé puisque COS ne réordonne que `ready`) :

```ts
if (this._config.conflictOrderingSearch && this._conflictStamps.size > 0) {
    ready.sort((a, b) => (this._conflictStamps.get(b.id) ?? 0) - (this._conflictStamps.get(a.id) ?? 0));
}
```

`Array.prototype.sort` est **stable** (garanti ES2019+/Node ≥ 11) : les unités sans horodatage (comparateur 0) conservent leur ordre MCV entre elles — c'est ce qui rend COS inerte sans conflit. Le garde `size > 0` évite le tri superflu.

**Ne toucher à rien d'autre** : ni `_computeConflictSet`/blâme (§5.7, orthogonal), ni les filtres, ni `solveWithElimination`.

## 4. Tests (`packages/scheduler-core/__tests__/schedulerConflictOrdering.test.ts`, nouveau)

Conventions des suites existantes (scénarios `RawScheduleData` construits ; sous-classe exposant `_iterations` si besoin, cf. pattern `InspectableScheduler`).

1. **Flag off = défaut inchangé** : un scénario existant simple (reprendre celui de `schedulerFailureBlame`), placements identiques avec `{}` et `{conflictOrderingSearch:false}`.
2. **Invariant d'inertie** : instance faisable sans aucune impasse (quelques cours sans contention) → flag on vs off : placements **et compteur d'itérations strictement identiques**.
3. **Scénario de thrashing — le test central.** Reprendre le scénario H1 de l'audit (`docs/AuditBackjumping.md` §4.1) : F (30 min) a besoin du prof P (fenêtre lundi 8h-11h) et de la salle S (lundi 8h30-10h) ; X (120 min, prof P, 3 valeurs toutes hostiles tant que A est mal placée) ; A (60 min, salle S, 2 valeurs, la 2ᵉ libère) ; Y innocente (~21 valeurs, ressources disjointes, lundi 8h-19h). En ordre figé [A,Y,X,F], le chronologique met 92 itérations en re-testant Y 23 fois. Pour ce test : **ne pas figer l'ordre** (COS vit dans `_dynamicSort`) — vérifier d'abord (log des `getSchedulingPriority()`) que l'ordre MCV naturel intercale bien Y entre A et X/F ; sinon ajuster la largeur de fenêtre de Y (elle ne contraint que son propre rang) jusqu'à obtenir l'intercalage. Assertions : mêmes placements finaux flag on/off ; `itérations(on) < itérations(off) / 2` ; et si mesurable, nombre d'appels `earlySchedule` sur Y fortement réduit (pattern d'instrumentation : wrapper sur `earlySchedule`, cf. suites existantes).
4. **Jeu embarqué 80 tâches** (`Loader.reload()`) : 80/80 placées avec flag on, comme off.

## 5. Validation sur le projet réel (avant toute discussion de généralisation)

Script jetable `examples/*-tmp.ts` (supprimé après), données `data/Planification MMI.json` (**gitignoré, ne jamais commiter**). Config standard : `maxSolutions:1, maxEliminations:6, timeoutSeconds:10, maxIterations:1_000_000, lunchBreak flottante 90min [12:00,14:00]`, `solveWithElimination()` comme l'app.

- **Semaines** : 37 (filtre simple), 38 et 39 (**pipeline weekSaves complet obligatoire** — preNeutralizedKeys, manualEnforcedMap propagé par groupes, taskGroups → cf. mémoire `feedback_validate_on_full_real_project`, l'erreur a déjà été commise deux fois), 40 (filtre simple, sans les cours type `Autonomie`).
- **Matrice** : flag off vs on (les flags `conflictSet*` restent à leur défaut). Métriques par run : durée totale, itérations par round (visibles dans les logs), nombre et identité des neutralisées.
- **Critères de succès** : 37/38/39 → résultats **identiques** off/on (pas de thrashing là-bas, COS doit être quasi inerte) ; 40 → neutralisées ≤ baseline (baseline off : 5 neutralisées / ~37 s) et durée ≤ baseline. Tout écart dégradé = STOP, rapporter à Frédéric sans merger (historique du projet : deux « améliorations » revertées après régression réelle).

## 6. Livraison

- `npm run typecheck` racine + suites complètes scheduler-core ET scheduler-client au vert.
- Commit unique sur `feature/backtracking` (après celui du fix élimination), fichiers stagés par nom, message français décrivant le mécanisme + la référence CP 2015 + le flag transitoire, signature `Co-Authored-By` habituelle. Commentaires en français.
- **Ne pas** modifier `docs/HeuristiquePriorite-Conception.md` ni généraliser le flag : ces décisions se prennent avec Frédéric après lecture des résultats de validation.

## 7. Definition of done

- [ ] Flag `conflictOrderingSearch` (3 emplacements : types, DEFAULT, `_config`), défaut false
- [ ] Horodatage à la vraie impasse uniquement ; tri stable dans `_dynamicSort` sur `ready` seulement
- [ ] 4 tests nouveaux verts (dont invariant d'inertie ET thrashing ≥ ×2) + suites existantes intactes
- [ ] Validation réelle 37/38/39 identiques, 40 ≥ baseline — résultats chiffrés rapportés dans le compte rendu final
- [ ] Scripts tmp supprimés, aucun fichier `data/` commité, commit unique en français
