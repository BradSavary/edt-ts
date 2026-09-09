# Plan d'implémentation P1 — `OptionalTasksScheduler` (branch-and-bound sur les sauts)

*Plan rédigé par Fable pour implémentation par Sonnet, en application de `docs/ConceptionTachesOptionnelles.md` (LIRE d'abord — le cadrage métier §1 et l'algorithme §3 y sont arbitrés avec Frédéric, ne pas les rouvrir). Branche cible : `feature/optional-tasks`. Périmètre P1 strict : moteur + tests + validation réelle. PAS de champ `SchedulerConfig`, PAS de fabrique, PAS de câblage API/worker, PAS d'UI — tout ça est P3.*

> **STATUT (2026-07-16, exécution par Sonnet) : STOP, rien commité.** Implémentation fidèle au plan (un correctif nécessaire apporté : la formule `_provenOptimal = !aborted` du plan était fausse — un arrêt global sur incumbent 0-saut retourne aussi `aborted=true`, ce qui l'aurait classé à tort « non prouvé » ; corrigé avec un flag dédié `_budgetExceeded`, seul déterminant de `_provenOptimal`). 8 tests écrits et vérifiés empiriquement avant d'être figés, tous verts — dont le cas de référence pigeonhole DUBOIS (§3.2) : 3 placées, 1 sautée, **optimum PROUVÉ**, confirmant le raisonnement bin-packing du doc de conception. Suites complètes : 89/89 scheduler-core (81+8) + 257/257 scheduler-client, typecheck clean.
>
> **Validation réelle (§6, export du 16/07 — Frédéric a choisi de ne pas en refaire un, pas de changement connu) : RÉGRESSION sur S37/S38, critère du plan non rempli.** S39 : identique au gourmand à tous les budgets, optimum prouvé dès 1000 itérations — conforme. Mais S37 (B&B 93/97 sautées=4 vs gourmand 94/97 sautées=3) et S38 (B&B 109/110 vs gourmand 110/110) régressent, et de façon frappante : **le résultat B&B est strictement identique à tous les budgets testés (1000 à 30000 itérations)**, optimum jamais prouvé même à 30000/23s — signe d'un problème structurel, pas d'un simple manque de budget.
>
> *Cause racine, établie par instrumentation temporaire (compteurs skip push/pop, log des coûts successifs — retirée avant commit, le code livré est strictement conforme au plan) :* sur S37, le premier incumbent tombe à l'itération 98 (une descente propre) avec un coût de 4 sauts. Sur les ~4900 itérations suivantes, le compteur de décisions de saut ne bouge quasiment pas (4 au total) alors que **4542 incumbents sont enregistrés, tous à coût 4 identique**. Le mécanisme : `_recordIncumbent` s'exécute à chaque feuille sans vérifier une amélioration stricte, et l'élagage (§4.2) ne s'applique qu'aux décisions de saut — jamais aux retries de placement. Une fois la vraie décision de saut fixée en profondeur dans l'arbre, le backtracking continue de retenter *toutes* les alternatives de créneaux pour les unités déjà placées en amont ; chaque combinaison atteint une feuille à coût identique (le saut ne change pas), enregistrée pour rien. Cette combinatoire croît avec le nombre d'alternatives de créneaux disponibles — sur des instances réelles à 97-110 unités (bien plus riches que les scénarios de test, tous petits/à faible branchement, d'où l'angle mort des 8 tests), elle noie le budget avant qu'aucune variation de la vraie décision de saut ne soit jamais retestée.
>
> *C'est exactement le « manque mesuré » que le plan lui-même prévoyait comme déclencheur de P2* (§7) — structurellement apparenté au phénomène de `docs/AuditBackjumping.md` (backtracking chronologique qui rejoue des choix sans rapport avec la vraie cause), mais réintroduit ici côté retry de placement plutôt que côté blâme : le B&B V1 n'a rien d'équivalent à COS ou au backjumping à ce niveau de l'arbre. Le mécanisme de saut lui-même (cascade, coût, borne, explications, arrêt sur 0-saut) n'est pas en cause — le cas DUBOIS le prouve, il est juste trop petit en alternatives de placement pour révéler ce trou.
>
> *Piste de correctif minimal envisageable (non implémentée, à trancher avec Fable/Frédéric)* : couper les retries de placement dès qu'un incumbent à coût égal au meilleur connu a déjà été trouvé dans la même branche (« stop-at-no-improvement » local) — plus simple qu'un vrai conflict-directed skip, mais pourrait suffire ; sinon, passer directement à la conception P2 (LB par cliques §3.2 + conflict-directed skip via MUS) qui règle le problème plus fondamentalement.
>
> *Statut* : rien commité — moteur (`optionalTasksScheduler.ts`), retouches `scheduler.ts` §3, `index.ts`, tests, tout dans l'arbre de travail sur `feature/optional-tasks`, en attente de décision.
>
> **Suite (2026-07-17) : régression CORRIGÉE par `docs/PlanOptionalTasksP15.md`** (élagage à l'entrée de nœud + warm start par la passe gourmande). Validation réelle P1.5 sur les mêmes semaines : S37 = 94/97 comme le gourmand, **optimum PROUVÉ dès budget 1000** (vs 93/97 jamais prouvé ici) ; S38/S39 court-circuit gourmand-complet ; S40 = résultat B&B identique au gourmand à tous budgets/COS, zéro violation de "jamais pire", mais optimum toujours non prouvé (P2 resterait la piste si cette preuve devient nécessaire). Voir STATUT de P1.5 pour le détail complet.

## 1. Objet

Nouvelle classe `OptionalTasksScheduler extends Scheduler` (nouveau fichier `packages/scheduler-core/src/optionalTasksScheduler.ts`, exportée depuis `index.ts`) qui remplace la stratégie gourmande solve+éliminations par **une seule recherche DFS branch-and-bound** : branches de placement d'abord (logique existante inchangée), branche « sauter l'unité » en dernier recours à l'impasse si la borne l'autorise. Résultat = **meilleur incumbent** (max de tâches placées), anytime, avec optimalité prouvée si l'arbre est épuisé sous le budget. Principe « code séparé » du chantier backjumping : le driver est une réimplémentation autonome ; `Scheduler` reste byte-identique en comportement (deux retouches de visibilité/extraction near-neutres, §3).

## 2. État et cycle de vie de la classe

```ts
interface SkipDecision {
    units: ISchedulingUnit[];   // l'unité sautée + sa cascade de dépendants (§4.3)
    taskCount: number;          // somme des getMemberTasks().length — l'unité de coût
}

export class OptionalTasksScheduler extends Scheduler {
    private _skippedSet = new Set<string>();        // ids des unités sautées dans la branche courante
    private _skipStack: SkipDecision[] = [];        // pile des décisions de saut (pour défaire)
    private _skippedTaskCount = 0;                  // coût courant, en TÂCHES (membres de groupes comptés)
    private _bestTaskCount = 0;                     // borne : coût du meilleur incumbent
    private _bestSolution: SchedulerSolution | null = null;
    private _provenOptimal = false;                 // arbre épuisé sans coupe budget

    override solveWithElimination(): SchedulerSolution[] { /* §4.1 */ }
}
```

**Unité de coût = la tâche (le cours), pas l'unité moteur** : sauter un `TaskGroupUnit` de 3 membres coûte 3 ; sauter un CM dont dépendent 2 TD coûte 3 (cascade). C'est cohérent avec l'objectif « maximiser les cours placés » et avec la sémantique conservée de `maxEliminations` = nombre maximal de tâches sautées (légèrement plus strict que les « rounds » actuels — assumé, documenté dans le commentaire de classe).

## 3. Retouches minimales dans `Scheduler` (comportement strictement inchangé)

1. **Visibilités** : `_resetBacktrackState` et `_collectDependents` passent `private` → `protected`. Aucun autre changement de ces méthodes.
2. **Extraction `_stampConflict`** : le bloc COS de `_backtrack` (lignes ~315-320) devient un appel à une nouvelle méthode protégée, pour que le driver B&B stampe identiquement :

```ts
/** Horodatage COS d'une vraie impasse (no-op si le flag est inactif). */
protected _stampConflict(unit: ISchedulingUnit): void {
    if (this._config.conflictOrderingSearch) {
        this._conflictStamps.set(unit.id, ++this._stampCounter);
    }
}
```

(`_conflictStamps`/`_stampCounter` restent privés ; seul ce point d'accès est exposé.) La suite de tests existante doit rester 100% verte après ces retouches, AVANT d'écrire la nouvelle classe.

## 4. Le driver B&B

### 4.1 Point d'entrée

```ts
override solveWithElimination(): SchedulerSolution[] {
    this.initSolver();
    this._resetBacktrackState();
    this._skippedSet.clear(); this._skipStack = []; this._skippedTaskCount = 0;
    this._bestTaskCount = this._config.maxEliminations + 1; // borne initiale : au plus maxEliminations tâches sautées
    this._bestSolution = null;
    this._provenOptimal = false;

    const aborted = this._bb(this._firstNonEnforcedIndex);
    this._provenOptimal = !aborted; // arbre épuisé (ni timeout ni budget) = optimum prouvé

    // logs : itérations, meilleur coût, optimum prouvé ou non
    return this._bestSolution ? [this._bestSolution] : [];
}
```

`solve()` hérité reste tel quel (documenté dans le commentaire de classe : sur cette classe, l'entrée officielle est `solveWithElimination`). `maxSolutions` est ignoré (on garde le meilleur incumbent) — documenté.

### 4.2 La récursion

```ts
/** Retourne true si l'exploration doit s'arrêter GLOBALEMENT (budget/timeout ou optimum 0-saut). */
private _bb(unitIndex: number): boolean {
    this._iterations++;
    if (this._limitsReached()) return true;

    // ── Feuille : toutes les unités placées ou sautées ──
    if (unitIndex >= this._units.length) {
        this._recordIncumbent();                       // §4.4 — _skippedTaskCount < _bestTaskCount garanti par la borne
        return this._bestTaskCount === 0;              // 0 saut = indépassable : arrêt global
    }

    this._dynamicSort(unitIndex);
    const unit = this._units[unitIndex];

    // Unité déjà sautée par une cascade en amont : traverser sans décision
    if (this._skippedSet.has(unit.id)) return this._bb(unitIndex + 1);

    // Garde de dépendance (miroir de _backtrack ; une dépendance sautée aurait cascadé)
    const dep = unit.getDependsOn();
    if (dep && !this._scheduled.has(dep.id) && !this._skippedSet.has(dep.id)) {
        throw new Error(`OptionalTasksScheduler : unité '${unit.id}' atteinte avant sa dépendance '${dep.id}'.`);
    }

    let fromTime = 0;
    if (dep && this._scheduled.has(dep.id)) {
        const depResult = this._scheduled.get(dep.id)!;
        fromTime = depResult.start + dep.duration;
    }

    // ── Branches de placement (copie fidèle de la boucle de _backtrack) ──
    while (true) {
        const result = unit.earlySchedule(fromTime);
        if (result === null) break;                                     // épuisement → branche de saut
        if (!this._floatingLBAllows(result, unit.duration)) { fromTime = result.start + SLOT_STEP; continue; }
        if (!this._dailyLimitAllows(result, unit.duration))  { fromTime = result.start + SLOT_STEP; continue; }

        this._solution.push({ unit, result });
        this._scheduled.set(unit.id, result);
        unit.book(result);
        this._addDailyUsage(result, unit.duration);

        const abort = this._bb(unitIndex + 1);

        unit.unBook(result);
        this._subtractDailyUsage(result, unit.duration);
        this._solution.pop();
        this._scheduled.delete(unit.id);

        if (abort) return true;
        fromTime = result.start + SLOT_STEP;
    }

    // ── Impasse de placement : COS + branche de saut en dernier recours ──
    this._stampConflict(unit);

    const cascade = [unit, ...this._collectDependents(unit)].filter(u => !this._skippedSet.has(u.id));
    const taskCount = cascade.reduce((n, u) => n + u.getMemberTasks().length, 0);
    if (this._skippedTaskCount + taskCount >= this._bestTaskCount) return false; // borne : élagage

    for (const u of cascade) this._skippedSet.add(u.id);
    this._skipStack.push({ units: cascade, taskCount });
    this._skippedTaskCount += taskCount;

    const abort = this._bb(unitIndex + 1);

    this._skippedTaskCount -= taskCount;
    this._skipStack.pop();
    for (const u of cascade) this._skippedSet.delete(u.id);

    return abort;
}
```

Points arbitrés : (a) le saut n'est offert **qu'à l'épuisement des placements** (« dernier recours », conception §3.1) ; (b) les enforced ne passent jamais ici (pré-placés avant `_firstNonEnforcedIndex`) et `_collectDependents` exclut déjà les dépendants enforced (sémantique du fix `041058f`) ; (c) **pas d'appel au blâme pendant la recherche** (`_incrementFailureBlame` n'a plus de rôle décisionnel — conception §3.4) : l'explication est calculée sur l'incumbent final seulement (§4.4) ; (d) pas de mémoïsation/no-good V1.

### 4.3 Cascade et unités déjà sautées

La cascade est **immédiate** (au moment du saut, pas à l'arrivée sur le dépendant) pour que la borne voie le vrai coût. Les membres de la cascade rencontrés plus tard dans la descente traversent par le raccourci `_skippedSet` (ils sont en fin d'ordre : leur dépendance n'étant pas dans `_scheduled`, `_dynamicSort` les classe notReady — c'est attendu et sans effet).

### 4.4 Enregistrement de l'incumbent (avec explications, conception §3.5)

```ts
private _recordIncumbent(): void {
    this._bestTaskCount = this._skippedTaskCount;
    const solutions = this._solution.flatMap(e => e.unit.toSolutions(e.result));
    const skippedUnits = this._skipStack.flatMap(d => d.units);
    const neutralizedUnits: NeutralizedUnitInfo[] = skippedUnits.map(u => ({
        unit: u,
        eliminationRound: 0,
        failureCount: this._failureCounts.get(u.id) ?? 0,
        reason: this._explainSkip(u),
    }));
    this._bestSolution = {
        solutions,
        isComplete: this._skippedTaskCount === 0,
        score: this._computeScore(),
        neutralizedUnits,
    };
}
```

`_explainSkip(u)` : calcule `this._computeExactConflictSet(u, fromTime)` **dans l'état de la feuille** (tout l'incumbent placé), avec `fromTime` = fin de la dépendance placée si elle existe, sinon 0. MUS non vide → « Ne peut pas tenir sous les contraintes actuelles : créneaux nécessaires occupés par [ids du MUS] — relâchement nécessaire pour atteindre 100%. » ; MUS vide → « Ne peut pas tenir sous les contraintes actuelles (aucune tâche placée en cause : disponibilités structurellement insuffisantes) — relâchement nécessaire pour atteindre 100%. » Cas particulier : si la dépendance de `u` est elle-même sautée → « Sautée par cascade : dépend de '<id>', elle-même non plaçable. » (pas de MUS à calculer). Le coût du MUS n'est payé qu'aux nouveaux incumbents (rares) — négligeable.

**Piège connu** (hérité de PlanBlameExact, test 5) : le MUS calculé ici partage la limitation « fenêtre rétrécie » pour les causes quota/pause. Acceptable en P1 — l'explication reste correcte quand elle est non vide ; la formulation « structurellement insuffisantes » couvre le reste. Ne pas tenter de corriger ça dans ce chantier.

## 5. Tests (`packages/scheduler-core/__tests__/schedulerOptionalTasks.test.ts`, nouveau)

Conventions des suites existantes (`InspectableScheduler` exposant `_iterations` si besoin ; config [[feedback-scheduler-test-default-config]] sauf mention). Vérifier chaque scénario empiriquement avant de figer les assertions (méthode Sonnet éprouvée).

1. **Instance faisable → 0 saut + arrêt anticipé** : quelques cours sans contention ; `isComplete=true`, 0 neutralisée, mêmes placements que `Scheduler.solve()` sur la même instance ; itérations ≈ une descente (l'arrêt global au 1er incumbent 0-saut fonctionne).
2. **Pigeonhole (cas de référence DUBOIS, conception §3.2)** : 1 prof, 3 fenêtres de 120 min (lundi/mardi/mercredi 8h-10h), 4 cours de 90 min (groupes distincts très larges). Attendu : 3 placées, **1 sautée, optimum PROUVÉ** (`_provenOptimal` exposé via sous-classe de test ; budget confortable). Comparer au `Scheduler` de base : neutralisées(B&B) ≤ neutralisées(gourmand).
3. **Borne `maxEliminations`** : même instance pigeonhole avec `maxEliminations: 0` → borne initiale 1 → aucun saut autorisé → aucun incumbent → retour `[]`.
4. **Cascade de dépendants** : CM inplaçable (fenêtre trop étroite) avec un TD dépendant placés ailleurs ; vérifier que sauter le CM marque aussi le TD (2 neutralisées, coût 2, reasons distinctes : MUS/structurel pour le CM, « par cascade » pour le TD).
5. **Coût des groupes** : un `TaskGroupUnit` séquentiel de 2 membres inplaçable → son saut coûte 2 (vérifier via `maxEliminations: 1` → `[]`, puis `maxEliminations: 2` → solution avec le groupe sauté).
6. **Anytime sous budget minuscule** : instance du test 2 avec `maxIterations` juste au-dessus de la première descente → un incumbent existe (retour non vide), `_provenOptimal === false`.
7. **Enforced jamais sautés** : instance avec enforced + une unité inplaçable ; l'enforced est dans `solutions`, jamais dans `neutralizedUnits`.
8. **Jeu embarqué 80 tâches** (`Loader.reload()`) : 80/80 placées, 0 sautée, optimum prouvé.

Plus : suites existantes 100% vertes (en particulier après les retouches §3 — c'est le garde-fou de non-régression du moteur de production).

## 6. Validation sur le projet réel

Script jetable `examples/*-tmp.ts` (supprimé après). **Données : demander à Frédéric un export frais avant la campagne** (leçon : un instantané se périme) ; à défaut, utiliser le plus récent de `data/` (`Planification MMI_2026-07-16_10-13.json` à l'heure d'écrire — attention le nom porte la date). Pièges du pipeline : tous documentés dans `docs/PlanBlameExact.md` §5 (normalisation `constraints.Default`, semaine 40 = filtre Autonomie, 38/39 = pipeline weekSaves complet avec propagation des enforced).

**Protocole déterministe** : budgets **1000 / 3000 / 10000 / 30000** itérations, `timeoutSeconds: 600` (garde-fou jamais atteint), `maxEliminations: 6`, pause flottante 90 min [12:00, 14:00].

- **Moteurs comparés** (même process, mêmes données) : `OptionalTasksScheduler` × {COS off, COS on} vs `Scheduler` × {défaut, COS on} — 4 colonnes.
- **Semaines** : 37, 38, 39 (attendu : 0 saut trouvé immédiatement, placements identiques au moteur actuel, coût ≈ une descente) et 40 (le cas différenciant).
- **Métriques par run** : placées/sautées (et identité des sautées), itérations jusqu'au premier incumbent, incumbent final, optimum prouvé (o/n), durée.
- **Critères (conception §6)** : 37-39 → jamais pire que le moteur actuel à budget égal ; 40 → **≥ 105 placées de façon robuste au budget** (le moteur actuel n'y arrive qu'avec COS et de la chance de troncature), et répondre à la question ouverte : **106/107 est-il faisable, ou 2 sauts est-il optimal (prouvé) ?** Rapporter aussi la qualité des `reason` (lisibles ? actionnables ?) pour jugement de Frédéric.
- **Tout écart dégradé = STOP, rapporter sans commiter** (règle maison).

## 7. Livraison

- `npm run typecheck` racine + suites complètes scheduler-core ET scheduler-client au vert.
- **Commit unique** sur `feature/optional-tasks` : retouches Scheduler (§3) + nouvelle classe + export index.ts + tests. Fichiers stagés par nom, message français (mentionner B&B, anytime, optimum prouvé, cadrage diagnostic-vers-100%), signature `Co-Authored-By` habituelle. Commentaires en français.
- Aucun fichier `data/` commité ; scripts tmp supprimés ; ne PAS toucher à l'API, au worker, au client (P3).

## 8. Definition of done

- [ ] Retouches §3 (2 visibilités + extraction `_stampConflict`) avec suites existantes vertes AVANT la nouvelle classe
- [ ] `OptionalTasksScheduler` : B&B complet (§4.2), cascade immédiate avec coût en tâches, borne `maxEliminations`, arrêt global sur 0-saut, anytime, `_provenOptimal`
- [ ] Explications des sauts sur l'incumbent final (§4.4) : MUS / structurel / cascade
- [ ] 8 tests nouveaux verts + suites existantes intactes
- [ ] Validation réelle §6 : 4 colonnes × 4 budgets × semaines 37-40, critères remplis, réponse à « 106/107 ? » — chiffres complets dans le compte rendu final
- [ ] Commit unique, conventions respectées
