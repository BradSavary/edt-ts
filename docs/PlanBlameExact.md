# Plan d'implémentation — Blâme exact par ensemble minimal de conflit (deletion-MUS) derrière flag transitoire

*Plan rédigé par Fable pour implémentation par Sonnet. Branche cible : `feature/backtracking` (après le commit COS `040a9ef`). Toutes les décisions ci-dessous sont arbitrées avec Frédéric — ne pas les rouvrir. La mesure fondatrice (66,8% de faux positifs du blâme actuel, MUS moyen de taille 1,00, surcoût 5-11%) est documentée dans la mémoire de session `project_backtracking_thrashing_backjumping.md`, section « AUDIT DE L'EXACTITUDE DU BLÂME §5.7 ».*

## 1. Contexte et objectif

`_computeConflictSet` (scheduler.ts) reconstruit les coupables d'une impasse *a posteriori* par un scan approximatif : tout occupant d'une ressource candidate « quelque part après fromTime » est blâmé, même s'il occupe des moments où la tâche en échec n'aurait de toute façon pas pu se poser. Mesure sur la semaine 40 réelle : **66,8% des incréments de blâme sont des faux positifs**, ~15% des impasses sont structurelles (aucune entrée responsable) mais reçoivent quand même un blâme, et l'impact est décisionnel (au round 1, le leader du blâme livré — BERGER Julien G4, ensuite neutralisé à tort — est absent du top-5 exact).

L'état de l'art n'infère jamais les coupables après coup : soit il enregistre ce que l'échec a réellement heurté (dom/wdeg, LCG), soit il prouve la minimalité par contrefactuel (MUS, deletion-based — cf. QuickXplain, Junker 2004). Notre moteur a une particularité qui rend le gold standard abordable **en ligne** : une sonde de plaçabilité est un scan glouton (`earlySchedule`), pas une résolution. Le MUS mesuré vaut ~1 coupable par impasse pour un surcoût de 5-11%.

**Objectif** : remplacer (derrière flag) le calcul de l'ensemble de conflit par un **deletion-MUS contrefactuel** — dé-réserver les entrées candidates, vérifier que la tâche redevient plaçable, re-réserver une à une celles qui sont innocentes. Garanties : ensemble minimal (le retirer rend la tâche plaçable, aucun sous-ensemble strict ne suffit) ; impasse structurelle → ensemble vide → repli self-blame existant de `_blameConflictSet` (sémantique correcte pour l'élimination). Bonus structurel : le contrefactuel restaure aussi les quotas quotidiens, donc il capture les coupables par saturation de `maxDailyMinutes` — l'angle mort (A) de l'audit, corrigé gratuitement (le flag `conflictSetDailyLimitAware` de feature/backjumping devient sans objet ici).

**Invariant clé** : le blâme n'influence JAMAIS le chemin d'exploration de `_backtrack` (seulement les cibles de `solveWithElimination`). Donc, flag on ou off, `solve()` produit des placements et un compteur d'itérations **byte-identiques**. C'est un invariant fort et bon marché — à tester explicitement.

## 2. API

`packages/scheduler-common/src/types.ts` — ajouter à `SchedulerConfig` (+ `DEFAULT_SCHEDULER_CONFIG` + le `_config` par défaut de `Scheduler`, 3 emplacements comme d'habitude) :

```ts
/**
 * Paramètre transitoire : si true, l'ensemble de conflit d'une impasse est calculé par
 * contrefactuel (ensemble minimal de coupables, deletion-MUS) au lieu du scan d'occupation
 * approximatif — mesuré à 66,8% de faux positifs sur données réelles. N'influence que les
 * cibles d'élimination, jamais l'exploration. Défaut : false (comportement historique).
 */
conflictSetExact?: boolean;
```

## 3. Moteur (`packages/scheduler-core/src/scheduler.ts` — seules modifications)

### 3.1 Aiguillage dans `_incrementFailureBlame`

```ts
private _incrementFailureBlame(unit: ISchedulingUnit, fromTime: number): void {
    const occupants = this._config.conflictSetExact
        ? this._computeExactConflictSet(unit, fromTime)
        : this._computeConflictSet(unit, fromTime);
    this._blameConflictSet(unit, occupants);
}
```

`_computeConflictSet` et `_blameConflictSet` restent inchangés (le repli self-blame sur ensemble vide de `_blameConflictSet` est exactement la sémantique voulue pour les impasses structurelles).

### 3.2 Sonde de plaçabilité (réplique la boucle de `_backtrack`, sans réservation)

```ts
/** La tâche est-elle plaçable depuis fromTime dans l'état courant (filtres inclus) ? */
private _probePlaceable(unit: ISchedulingUnit, fromTime: number): boolean {
    let ft = fromTime;
    while (true) {
        const result = unit.earlySchedule(ft);
        if (result === null) return false;
        if (!this._floatingLBAllows(result, unit.duration)) { ft = result.start + SLOT_STEP; continue; }
        if (!this._dailyLimitAllows(result, unit.duration)) { ft = result.start + SLOT_STEP; continue; }
        return true;
    }
}
```

(`SLOT_STEP` est la constante de module existante de scheduler.ts — l'utiliser, ne pas redéclarer.)

### 3.3 Libération/restauration d'une entrée placée

Utiliser le **couple `unBook`/`book` de l'unité elle-même**, en miroir exact de ce que fait `_backtrack` à la réservation (y compris le quota quotidien) :

```ts
private _releaseEntry(e: { unit: ISchedulingUnit; result: SchedulingResult }): void {
    e.unit.unBook(e.result);
    this._subtractDailyUsage(e.result, e.unit.duration);
}
private _restoreEntry(e: { unit: ISchedulingUnit; result: SchedulingResult }): void {
    e.unit.book(e.result);
    this._addDailyUsage(e.result, e.unit.duration);
}
```

Pourquoi `unBook`/`book` et pas une manipulation directe des availabilities : les `TaskGroupUnit` réservent leurs membres sur des sous-intervalles différents (séquentiel !) — seuls leurs book/unBook savent le faire. Le round-trip `unBook(e); …; book(e)` est neutre pour la pile `_savedResources` de `TaskUnit` (pop puis push de la même valeur — vérifié) ; **vérifier la même symétrie pour `TaskGroupUnit`** (état `_memberAssignments`) avant de s'appuyer dessus, et la couvrir par le test 6.

### 3.4 Le deletion-MUS

```ts
/**
 * Ensemble MINIMAL de coupables par contrefactuel (deletion-based MUS) :
 * retirer l'ensemble rend `unit` plaçable ; aucun sous-ensemble strict ne suffit.
 * Ensemble vide = impasse structurelle (aucune entrée placée responsable) → le
 * repli self-blame de _blameConflictSet s'applique.
 */
protected _computeExactConflictSet(unit: ISchedulingUnit, fromTime: number): Set<ISchedulingUnit> {
    const candRes = new Set(unit.getCandidateResourceSlots().flat());
    const R = this._solution.filter(e => e.result.resources.some(r => candRes.has(r)));
    if (R.length === 0) return new Set();

    for (const e of R) this._releaseEntry(e);
    if (!this._probePlaceable(unit, fromTime)) {
        for (const e of R) this._restoreEntry(e);
        return new Set(); // structurelle
    }

    const mus: typeof R = [];
    for (const e of R) {                       // ordre chronologique de _solution (déterministe)
        this._restoreEntry(e);
        if (!this._probePlaceable(unit, fromTime)) { this._releaseEntry(e); mus.push(e); }
    }
    for (const e of mus) this._restoreEntry(e); // état exactement restauré

    return new Set(mus.map(e => e.unit));
}
```

Notes arbitrées : (a) le superset `R` filtré par partage de ressource candidate est suffisant — les quotas quotidiens ne concernent que les ressources candidates de `unit`, la pause flottante ne dépend pas des entrées ; (b) quand plusieurs ensembles minimaux existent, le deletion en choisit un selon l'ordre chronologique — déterministe, assumé (dom/wdeg vit avec le même arbitraire) ; (c) pas de micro-optimisation prématurée (surcoût mesuré 5-11%, acceptable).

**Ne toucher à rien d'autre** : ni COS (orthogonal — il stampe l'unité qui échoue, pas les coupables), ni `_dynamicSort`, ni `solveWithElimination`.

## 4. Tests (`packages/scheduler-core/__tests__/schedulerBlameExact.test.ts`, nouveau)

1. **Flag off = défaut inchangé** : rejouer un scénario de `schedulerFailureBlame.test.ts` avec `{}` et `{conflictSetExact:false}` — compteurs identiques.
2. **Invariant d'inexploration** : sur une instance quelconque (prendre une infaisable pour que le blâme tourne), `solve()` flag on vs off → placements ET itérations strictement identiques (le blâme ne touche pas la recherche).
3. **Faux positif éliminé** : U échoue ; A occupe réellement le seul créneau utilisable de U (la retirer rend U plaçable) ; B occupe une ressource candidate de U mais à un moment hors du profil de U (ex. vendredi soir quand U n'est dispo que lundi). Assertions : flag off → A **et** B blâmées ; flag on → A seule.
4. **Impasse structurelle → self-blame** : U inplaçable par son seul profil, avec des occupations sans rapport présentes ; flag on → `failureCounts[U] > 0`, occupants à 0 (flag off : vérifier le comportement actuel, probablement du faux blâme — le documenter dans l'assertion).
5. **Coupable par quota quotidien** (l'ancien angle mort (A)) : E consomme le quota `maxDailyMinutes` d'une ressource de U sur un intervalle SANS chevauchement temporel avec les créneaux de U ; U échoue à cause du quota. Flag off → E non blâmée (ou self-blame) ; flag on → E blâmée (le contrefactuel restaure le quota via `_subtractDailyUsage`).
6. **Round-trip TaskGroup** : une instance avec un groupe séquentiel placé + une unité qui impasse ; flag on → résultat final identique au flag off (prouve la restauration exacte via book/unBook des groupes).
7. **Jeu embarqué 80 tâches** (`Loader.reload()`) : 80/80 avec flag on, comme off.

Config des tests : [[feedback-scheduler-test-default-config]] sauf besoin spécifique du scénario.

## 5. Validation sur le projet réel

Script jetable `examples/*-tmp.ts` (supprimé après). Données : **l'export frais** `data/Planification MMI_2026-07-16_10-13.json` (gitignoré, ne jamais commiter — attention le nom inclut la date). Pièges connus du pipeline (tous documentés en mémoire) : normaliser `constraints.Default` (format `{default:[...]}` dans l'export, le fallback moteur attend un tableau plat) ; les entrées `null` de constraints se laissent telles quelles ; semaine 40 = filtre `week===40 && type!=='Autonomie'` (équivalent prouvé aux 3 preNeutralizedKeys) ; semaines 38/39 = pipeline weekSaves complet (préneutralisées, cours manuels, propagation des enforced par taskGroups puis remap par indices, cf. `usePlanningStore.runSchedule`).

**Protocole déterministe** (leçon de session : jamais de comparaison au wall-clock) : rounds bornés en itérations — budgets **1000, 3000, 10000**, `timeoutSeconds: 600` (jamais atteint), `maxSolutions:1, maxEliminations:6`, pause flottante 90min [12:00,14:00].

- **Semaine 40** : matrice 2×2 `conflictSetExact` × `conflictOrderingSearch`, aux 3 budgets. Références baseline actuelles (exact off) : COS off → 5/4/4 neutralisées ; COS on → 3/2/2.
- **Semaines 37/38/39** : exact off/on (COS off), budget 1M/timeout 10s (config historique). Références : 37 = 94/97 placées, 3 neutralisées (SAÉ « NON AFFECTE ») ; 38 = 110/110 ; 39 = 106/106.
- **Surcoût** : rapporter le temps par round on vs off (attendu ≤ ~15%).

**Critères de succès** : semaine 40 → neutralisées ≤ référence dans chaque cellule ; 37/38/39 → jamais pire. **Tout écart dégradé = STOP, rapporter à Frédéric sans commiter** (règle maison, trois précédents). Rapporter aussi l'identité des neutralisées : on s'attend à ne plus voir de neutralisation BERGER Julien quand le blâme exact est actif (c'était le faux leader du round 1).

## 6. UI (petit, en dernier)

Case à cocher dans `SchedulerConfigDialog.tsx`, section Général, motif exact de `conflictOrderingSearch` (champ `Draft`, `configToDraft`, `draftToConfig`, bloc checkbox). Libellé : « Analyse exacte des conflits (expérimental) » ; description courte : « À chaque échec, identifie précisément les tâches responsables au lieu d'une estimation — améliore le choix des tâches à neutraliser. »

## 7. Livraison

- `npm run typecheck` racine + suites complètes scheduler-core ET scheduler-client au vert.
- Deux commits sur `feature/backtracking` : (1) moteur + tests, (2) UI. Fichiers stagés par nom, messages en français (mentionner deletion-MUS et le chiffre 66,8%), signature `Co-Authored-By` habituelle. Commentaires en français.
- Ne pas supprimer `examples/diag-blame-exact-tmp.ts` sans vérifier qu'il existe encore : s'il est présent, le supprimer dans le commit (1) — c'est le script de mesure de Fable, remplacé par les tests permanents.

## 8. Definition of done

- [ ] Flag `conflictSetExact` (3 emplacements), défaut false ; aiguillage dans `_incrementFailureBlame` uniquement
- [ ] `_probePlaceable` + `_releaseEntry`/`_restoreEntry` (via book/unBook) + `_computeExactConflictSet` (deletion-MUS, ordre chronologique)
- [ ] 7 tests nouveaux verts (dont invariant d'inexploration, quota quotidien, round-trip TaskGroup) + suites existantes intactes
- [ ] Validation réelle : matrice semaine 40 (2×2 × 3 budgets) + 37/38/39, critères ci-dessus, surcoût rapporté — chiffres dans le compte rendu final
- [ ] Case UI (commit séparé) ; scripts tmp supprimés ; aucun fichier `data/` commité
