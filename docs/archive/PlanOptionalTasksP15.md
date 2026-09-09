# Plan d'implémentation P1.5 — correctifs du B&B tâches optionnelles (élagage + warm start)

> **STATUT (2026-07-17, exécution par Sonnet) : LIVRÉ, prêt à committer.** Les deux correctifs sont implémentés conformes au plan, **+ 2 corrections nécessaires non anticipées par le plan** : (1) `isComplete` du résultat gourmand normalisé à `(greedyCost === 0)` — `Scheduler.solve()` le calcule relativement au jeu d'unités RÉDUIT post-élimination, pas à l'original, ce qui fuitait un faux "complet" dès qu'aucune amélioration B&B n'avait lieu (trouvé par test direct) ; (2) le court-circuit renvoie `[greedyBest]`, pas `greedyResults` (qui peut contenir jusqu'à `maxSolutions` entrées, violant le contrat "un seul incumbent" documenté de la classe).
>
> **Tests (§4)** : 8 tests existants adaptés (2 sous-cas de "cascade de dépendants" et "coût des groupes" attendaient `[]` en P1 pur-B&B, attendent désormais le résultat valide du gourmand — le gourmand compte en ROUNDS, le B&B en TÂCHES, et "jamais pire que le gourmand" a priorité sur la borne stricte du B&B) + 3 tests nouveaux écrits et calibrés empiriquement. **Piège méthodologique rencontré et résolu en calibrant le test "warm start = jamais pire"** : `maxIterations` est PARTAGÉ entre la passe gourmande et la passe B&B (même `_config`, pas de budget séparé par passe) — comparer le warm-start à budget minuscule contre un gourmand tourné à budget illimité produit une fausse alerte de violation (le gourmand lui-même, affamé au même budget minuscule, rend un résultat tout aussi dégradé). Le test final compare donc gourmand-seul et warm-start au MÊME budget partagé — invariant vérifié : identique au gourmand à budget égal. 11/11 tests verts.
>
> **Suites complètes** : typecheck monorepo clean, 92/92 scheduler-core, 257/257 scheduler-client.
>
> **Validation réelle (§5, export du 16/07, semaines 37-40, 4 colonnes × 4 budgets 1000/3000/10000/30000, pipeline weekSaves complet fidèlement reconstruit)** : **zéro violation de "jamais pire que le gourmand" sur les 64 combinaisons testées.**
> - **S37** : gourmand 94/97 (3 sautées) à tous budgets ; B&B P1.5 = 94/97 (3 sautées), **optimum PROUVÉ dès budget 1000**, aux deux réglages COS. Corrige entièrement la régression P1 (bloqué à 93/97, jamais prouvé même à 30000).
> - **S38/S39** : gourmand complet (110/110, 106/106) → court-circuit gourmand-complet, B&B jamais lancé, `_provenOptimal=true` trivialement. Conforme.
> - **S40** : gourmand COS off passe de 102/107 (5 sautées, budget 1000) à 103/107 (4 sautées, budget≥3000) ; COS on de 104/107 (3 sautées) à 105/107 (2 sautées, budget≥3000). **Le B&B P1.5 reproduit EXACTEMENT le résultat du gourmand à chaque budget/COS**, sans jamais l'améliorer ni le dégrader, et sans jamais prouver l'optimum dans la plage testée (jusqu'à 30000 itérations, 154s pour COS-on à budget max). Différence qualitative majeure avec P1 (qui ne produisait AUCUN incumbent sur S40) : le warm start règle le "défaut B" comme prévu — le résultat n'est plus jamais pire, seulement pas meilleur ici. **La question ouverte "106/107 faisable ?" reste NON RÉSOLUE** à ces budgets — P2 (LB par cliques + conflict-directed skip) resterait la piste si cette réponse devient nécessaire.
>
> **Reste avant commit** : mettre à jour le STATUT de `docs/PlanOptionalTasksP1.md` (pointer ici), supprimer le script temporaire `packages/scheduler-client/examples/validate-p15-real-data-tmp.ts`, commit unique.

*Plan rédigé par Fable pour implémentation par Sonnet, suite au STOP de P1 (voir STATUT de `docs/PlanOptionalTasksP1.md`). Branche : `feature/optional-tasks`. Les deux défauts ci-dessous ont été **confirmés et corrigés expérimentalement** par Fable (patch temporaire, reverté) — les chiffres cités sont mesurés, pas prédits. Ne pas rouvrir les décisions.*

## 1. Diagnostic validé — deux défauts structurels

**Défaut A — pas d'élagage à l'entrée de nœud.** La borne n'est vérifiée qu'au moment de prendre une décision de saut (`_bb`, «borne : élagage»), jamais à l'entrée de nœud. Après un incumbent de coût k, toute branche portant un coût déjà **égal** à k reste explorée exhaustivement : chaque feuille ré-enregistre un incumbent équivalent (les 4542 incumbents de coût 4 mesurés par Sonnet sur S37), et chaque ré-enregistrement **recalcule les explications MUS** de toutes les sautées (`_recordIncumbent` → `_explainSkip` → `_computeExactConflictSet`) — d'où aussi les 23s à budget 30000.

**Défaut B — pas d'incumbent du tout sur les semaines dures.** La première descente saute *la victime* de chaque impasse et continue sans replanifier l'amont : le vrai coupable reste en place, les victimes s'enchaînent, et sur S40 le coût dépasse la borne (maxEliminations+1 = 7 tâches) avant d'atteindre une feuille → la branche de saut est interdite, la recherche thrash dans les replacements, et **aucun incumbent n'est jamais produit** (mesuré : 0 placée à tous les budgets 1000→30000). Le gourmand, lui, élimine le *coupable* (blâme §5.7) et redémarre — qualitativement différent.

**Mesures avec le seul élagage A (patch expérimental de Fable)** :

| | S37 | S38 | S40 |
|---|---|---|---|
| Gourmand | 94/97, 3 sautées, 360ms | 110/110, 386ms | 103/107, 4 sautées |
| B&B P1 (committé) | 93/97, 4 sautées, identique à tous budgets | 109/110, 1 sautée | aucun incumbent |
| B&B + élagage | 94/97, 3 sautées, **optimum PROUVÉ**, 332ms (budget 10000) | 110/110, **optimum PROUVÉ**, 399ms (budget 1000) | aucun incumbent (défaut B) |

L'élagage règle S37/S38 (avec preuve d'optimalité en prime — on sait désormais que 3 est optimal sur S37) ; le warm start règle S40 et rend le critère « jamais pire que le moteur actuel » **structurel**.

## 2. Correctif A — élagage à l'entrée de nœud (1 ligne)

Dans `_bb`, juste après le contrôle de budget :

```ts
// Élagage B&B : un nœud dont le coût committé atteint déjà la borne ne peut plus
// produire d'amélioration STRICTE — inutile d'explorer (sans cette coupe, la recherche
// énumère exhaustivement des feuilles à coût égal après chaque incumbent, cf. STATUT P1).
if (this._skippedTaskCount >= this._bestTaskCount) return false;
```

Mettre à jour le commentaire de `_recordIncumbent` : « strictement meilleur » devient VRAI grâce à cette coupe (il était faux en P1). Ne rien changer d'autre à `_bb`.

## 3. Correctif B — warm start par la passe gourmande

`solveWithElimination()` devient deux passes :

```ts
override solveWithElimination(): SchedulerSolution[] {
    // ── Passe 1 : moteur gourmand hérité — amorce anytime + borne initiale ──
    const greedyResults = super.solveWithElimination();
    const greedyBest = greedyResults[0] ?? null;
    const greedyCost = greedyBest
        ? (greedyBest.neutralizedUnits ?? []).reduce((n, i) => n + i.unit.getMemberTasks().length, 0)
        : Infinity;

    // Gourmand complet (0 neutralisée) : indépassable, pas de passe 2.
    if (greedyBest && greedyCost === 0) { this._provenOptimal = true; return greedyResults; }

    // ── Passe 2 : B&B, ne cherche que STRICTEMENT mieux que la passe 1 ──
    this.initSolver(); // le gourmand a muté _units (retrait des éliminées) — reconstruire
    this._resetBacktrackState();
    // ... (réinitialisations existantes : _skippedSet, _skipStack, _skippedTaskCount, flags)
    this._bestSolution = greedyBest;                                                  // jamais pire que le gourmand, par construction
    this._bestTaskCount = Math.min(this._config.maxEliminations + 1, greedyCost);     // borne d'attaque
    this._bb(this._firstNonEnforcedIndex);
    this._provenOptimal = !this._budgetExceeded;
    // ... (logs et retour comme aujourd'hui — logguer clairement « passe gourmande : X sautées (coût Y) » puis le bilan B&B)
}
```

Points arbitrés :
- **Jamais pire que le gourmand, par construction** : c'est LA propriété livrée — le critère §6 de P1 devient structurel.
- Si la passe 2 n'améliore pas, le résultat retourné est celui du gourmand, avec **ses** `reason` (style « Unité la plus bloquante… ») — acceptable en P1.5, identique au produit actuel ; les explications MUS n'apparaissent que si le B&B améliore (ses incumbents passent par `_recordIncumbent`). Documenter dans le commentaire de classe.
- Si le gourmand ne trouve rien (`greedyResults` vide), seed classique (`_bestSolution=null`, borne `maxElim+1`) — comportement P1.
- **Double `initSolver()` sur le même Loader** : le re-`bookEnforced()` de la passe 2 re-retire des intervalles déjà retirés (no-op idempotent) mais logguera l'avertissement « booking forcé » pour chaque enforced — cosmétique, accepté, à mentionner en commentaire. La symétrie est couverte par le test 7 existant (enforced) qui doit rester vert.
- **Comptabilité du budget** : chaque passe consomme `maxIterations` pour son propre compte (le gourmand par round, comme aujourd'hui ; le B&B en un bloc). Le script de validation rapporte les deux.
- `_provenOptimal` avec warm start : vrai ssi la passe 2 épuise l'arbre sous budget (prouve alors que le coût du résultat rendu est optimal).

## 4. Tests (compléter `schedulerOptionalTasks.test.ts`)

Vérifier chaque scénario empiriquement avant de figer les assertions. Les 8 tests existants doivent rester verts, avec ces adaptations attendues : le test « anytime budget minuscule » change de sémantique (le warm start fournit désormais un incumbent gourmand même à budget B&B minuscule) ; le test « instance faisable → 0 saut » passe désormais par le court-circuit gourmand-complet (itérations ≈ celles du gourmand).

Nouveaux :
1. **Élagage prouvé** : instance faisable-sauf-une (une unité structurellement inplaçable + 4-5 unités à fenêtres très larges = beaucoup d'alternatives de placement). Avec un budget modeste (à calibrer empiriquement, ~500), `_provenOptimal === true` — sans la coupe, ce même budget était englouti par l'énumération à coût égal (signature P1).
2. **Warm start = jamais pire** : sur une instance adversariale où la première descente victim-skip est mauvaise (occupant gourmand placé tôt + victimes en chaîne, style OCCEND multiplié), asserter `sautées(B&B) ≤ sautées(gourmand seul)` à budget B&B minuscule (1-2 itérations) — le résultat doit être exactement celui du gourmand.
3. **Court-circuit gourmand-complet** : instance faisable → résultat complet, `_provenOptimal === true`, et la passe B&B n'a pas tourné (white-box : itérations après l'appel ≈ itérations de la passe gourmande, pas de reset supplémentaire — exposer ce qu'il faut via la sous-classe de test).

## 5. Validation réelle

Même protocole que P1 §6 (mêmes données, mêmes budgets 1000/3000/10000/30000, 4 colonnes, semaines 37/38/39/40 — pipeline weekSaves complet pour 38/39). Attendus :
- 37/38/39 : ≥ gourmand partout (structurel), optimum prouvé attendu sur 37/38/39 aux budgets moyens.
- 40 : résultat ≥ gourmand par construction ; rapporter si le B&B améliore le gourmand (COS off : gourmand 4 sautées ; COS on : 2) et si une preuve d'optimalité est obtenue — c'est la réponse à la question ouverte « 106/107 faisable ? ». Rapporter les itérations/temps de chaque passe.
- **Tout écart dégradé = STOP, rapporter sans commiter** (ne devrait plus être possible par construction — toute violation signalerait un bug du warm start).

## 6. Livraison

- Typecheck + suites complètes (core + client) au vert.
- Commit unique sur `feature/optional-tasks` : les 2 correctifs + tests + mise à jour du STATUT de `docs/PlanOptionalTasksP1.md` (« corrigé par P1.5, voir docs/PlanOptionalTasksP15.md ») + bilan chiffré dans un STATUT de CE document. Messages français, fichiers stagés par nom, signature habituelle, scripts tmp supprimés, aucun fichier `data/` commité.

## 7. Definition of done

- [ ] Élagage entrée de nœud (1 ligne) + commentaire `_recordIncumbent` corrigé
- [ ] Warm start : passe gourmande → seed borne/incumbent → passe B&B strictement-mieux ; court-circuit 0-saut ; cas gourmand-vide
- [ ] Tests existants adaptés + 3 nouveaux, tous verts ; suites complètes intactes
- [ ] Validation réelle : jamais pire que le gourmand sur les 4 semaines (vérifié), preuves d'optimalité rapportées, réponse S40 documentée
- [ ] STATUT des deux plans à jour, commit unique
