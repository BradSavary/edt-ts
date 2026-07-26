# Plan — Option CP-SAT « Minimiser les changements de salle enseignant » (préférence douce `minimizeTeacherRoomChanges`)

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant. Il ajoute une **5ème
> préférence douce opt-in** au panneau CP-SAT, combinable avec les 4 existantes
> (`compactTeacherHalfDays`, `minimizeTeacherDays`, `balanceTeacherDailyLoad`, `crossNoonGap`).
> But : pour un enseignant, **garder la même salle d'un cours au suivant dans une même demi-journée**
> quand une salle commune existe. C'est une optimisation de **grand confort**, volontairement placée
> **tout en bas** de la hiérarchie : elle ne doit JAMAIS dégrader le placement ni l'efficacité des
> 4 autres douces.

## 0. Décisions verrouillées (ne pas rouvrir — validées avec Frédéric)

- **Nature différente des 4 douces existantes.** Celles-ci ne dépendent que des `start[]` (dimension
  temporelle). Minimiser les changements de salle couple **deux dimensions** : l'affectation de salle
  (littéraux `used_literals[li]` de type `ROOM`, déjà là via l'`exactly-one` des alternatives,
  [cpsat_engine.py:437-448](../packages/scheduler-cpsat/cpsat_engine.py#L437-L448)) **et** l'ordre
  temporel (« consécutif » n'est connu qu'une fois le placement fixé).

- **Décision structurante : passe finale à PLACEMENT GELÉ (quasi post-traitement).** Frédéric l'a
  tranché explicitement : cette douce est du confort, elle **ne doit pas réduire l'efficacité des
  autres**. On ne se contente donc PAS de la mettre après elles dans l'ordre lexico avec un verrou
  agrégé (comme la passe 3). On **fige la solution variable par variable** — `scheduled[]`, `start[]`
  et **tous les littéraux non-salle** — et on ne laisse libre QUE le choix parmi les salles
  alternatives. Conséquence : toutes les douces antérieures ne dépendent que de grandeurs gelées →
  elles sont **strictement préservées** (pas seulement « non dégradées en agrégat »). Aucun verrou dur
  supplémentaire type `day_used_by`
  ([cpsat_engine.py:742-744](../packages/scheduler-cpsat/cpsat_engine.py#L742-L744)) n'est nécessaire :
  rien d'autre que la salle ne peut bouger.

- **Le gel rend la formulation FIDÈLE et triviale.** La difficulté (« consécutif » indéterminé) n'existe
  que tant que `start[]` est variable. À `start[]` gelé, l'ordre des cours de chaque prof est **connu** :
  on lit l'adjacence directement et on pénalise les **vraies transitions entre cours consécutifs** d'une
  même demi-journée — pas une borne « nb de salles distinctes − 1 ». `same[i,j]` = les deux cours
  consécutifs partagent au moins une salle **choisie** ; changement = `1 − same`.

- **« Salle commune si possible » géré nativement, pas de gate.** Si deux cours consécutifs n'ont
  aucune salle candidate commune → `same` impossible → changement incompressible (constant, **omis de
  l'objectif** car il n'influence pas l'`argmin`). La minimisation ne tente jamais l'impossible.

- **La pause méridienne est un reset gratuit, par construction.** On segmente les séquences
  consécutives à la frontière `half_cut` ([cpsat_engine.py:365](../packages/scheduler-cpsat/cpsat_engine.py#L365)) :
  deux cours de part et d'autre de midi ne forment JAMAIS une paire pénalisée. C'est la demande de
  Frédéric (« partir et revenir à midi, changer de salle à cette occasion n'est pas un souci »).
  **Pas de gate `lunch is not None`** (contrairement à `crossNoonGap`) : ici pas de problème de
  positivité, `half_cut` retombe sur 13:00 sans pause fixe et la segmentation reste bien définie.

- **Où dans l'ordre lexico : PASSE 4 (nouvelle, dernière).** Après la passe 3 (`balanceTeacherDailyLoad`)
  et avant l'extraction. Ordre complet : (1) nb placés → (2) Σ`penalty_terms` → (3) Σ`peak_terms` →
  **(4) Σ changements de salle, tout gelé sauf la salle**.

- **Levier = uniquement les cours à salles ALTERNATIVES.** Un cours à salle fixe n'offre aucun choix.
  Si aucun cours de la semaine n'a d'alternative de salle → la passe est un **no-op** (aucune variable
  libre créée, coût nul). C'est voulu : on ne bouge jamais le planning pour la salle.

- **Pourquoi CP-SAT et pas un glouton Python.** Une même salle ne peut héberger deux cours (même de
  profs différents) au même créneau : c'est le `AddNoOverlap` par ressource
  ([cpsat_engine.py:451-453](../packages/scheduler-cpsat/cpsat_engine.py#L451-L453)) déjà en place. Un
  glouton par-prof pourrait violer cette contrainte globale. CP-SAT sur les seuls littéraux de salle la
  respecte et donne l'optimum, pour un coût négligeable (peu de variables libres).

- **Jamais INFEASIBLE.** Le gel part d'une solution faisable → la même affectation de salle reste
  faisable → la passe a toujours au moins la solution précédente comme repli. Garde `if status4 in
  (OPTIMAL, FEASIBLE)` comme aux passes 2/3.

- **Portée = enseignants (`teacher`) uniquement**, comme les 4 autres. `provenOptimal` reste basé sur
  la passe 1, inchangé. Zéro impact quand l'option est off (tout le bloc derrière le flag).

## 1. Contrat & plomberie config (faire en premier)

### 1.1 `packages/scheduler-common/src/types.ts`
- Ajouter à `SchedulerConfig` (grep `crossNoonGap` pour l'emplacement exact), **à côté** de
  `crossNoonGap`, un champ optionnel `minimizeTeacherRoomChanges?: boolean`. Commentaire : « Préférence
  DOUCE (CP-SAT), grand confort : pour un enseignant, garder la même salle d'un cours au suivant dans
  une même demi-journée quand une salle commune existe. Appliquée en dernier, à placement figé — ne
  modifie jamais l'emploi du temps ni les autres préférences. »
- Si `DEFAULT_SCHEDULER_CONFIG` liste les autres flags, y ajouter `minimizeTeacherRoomChanges: false`.
- Règle archi : `scheduler-common` = modèle + contrat only, **aucune logique moteur**.

### 1.2 `packages/scheduler-api/src/cpsatGateway.ts`
- Vérifier par grep : si le gateway sérialise `config` tel quel (cas constaté pour `crossNoonGap`, cf.
  `PlanCrossNoonGap.md` §8), **rien à faire**. Sinon copier le pattern du flag `crossNoonGap`.

### 1.3 `packages/scheduler-cpsat/cpsat_runner.py` — liste blanche `_map_config` (NE PAS OUBLIER)
- `_map_config()` est une **liste blanche explicite** ([cpsat_runner.py:33-40](../packages/scheduler-cpsat/cpsat_runner.py#L33-L40)) :
  tout champ absent est **filtré en silence** avant d'atteindre `solve()`. C'est le piège qui a mordu
  le chantier `crossNoonGap` (cf. `PlanCrossNoonGap.md` §8). Ajouter, après le bloc `crossNoonGap`
  ([ligne 39-40](../packages/scheduler-cpsat/cpsat_runner.py#L39-L40)) :
  ```python
  if "minimizeTeacherRoomChanges" in config:
      mapped["minimizeTeacherRoomChanges"] = config["minimizeTeacherRoomChanges"]
  ```
- Étendre le test existant `test_runner_map_config_passes_*_flag` (grep) pour couvrir le nouveau flag.

### 1.4 `packages/scheduler-cpsat/cpsat_engine.py` — lecture du flag
- Après [ligne 341](../packages/scheduler-cpsat/cpsat_engine.py#L341)
  (`cross_noon = bool(config.get("crossNoonGap", False))`), ajouter :
  `minimize_rooms = bool(config.get("minimizeTeacherRoomChanges", False))`.
- Compléter le docstring de `solve()` (bloc ~L282-330) sur le modèle des options existantes : douce,
  passe 4 à placement gelé, fidèle (vraies transitions), no-op sans salle alternative, coût négligeable.

## 2. Cœur moteur — la passe 4 (le seul vrai point technique)

Insérer **après** le bloc de la passe 3 `balance_load`
([se termine ~L756](../packages/scheduler-cpsat/cpsat_engine.py#L756)) et **avant** l'extraction de la
solution ([L758](../packages/scheduler-cpsat/cpsat_engine.py#L758)). Réutilise `used_literals`
([L383](../packages/scheduler-cpsat/cpsat_engine.py#L383)), `start[li]`, `scheduled[li]`,
`half_cut` ([L365](../packages/scheduler-cpsat/cpsat_engine.py#L365)), `total_timeout`, les constantes
`TEACHER`/`ROOM` ([L56](../packages/scheduler-cpsat/cpsat_engine.py#L56)). **N'utilise PAS** `teacher_lits`
ni le bloc doux L549 : la passe 4 est autonome, elle relit tout depuis `solver` (solution figée).

```python
# ── Passe 4 : à placement ET affectations non-salle FIGÉS, minimiser les changements de salle. ──
# Post-traitement pur (préférence de grand confort, tout en bas de la hiérarchie). On GÈLE en dur
# scheduled[], start[] et TOUS les littéraux non-salle aux valeurs de la passe précédente ; seul le
# choix parmi les salles ALTERNATIVES reste libre. Toutes les douces antérieures ne dépendent que de
# grandeurs gelées → strictement préservées (aucun verrou agrégé/dur nécessaire). À placement gelé,
# l'ORDRE des cours de chaque prof est connu : on pénalise les VRAIES transitions entre cours
# consécutifs d'une même demi-journée (fidèle, pas une borne). No-op si aucun cours n'a de salle
# alternative influençable. provenOptimal reste basé sur placement_proven (passe 1).
if minimize_rooms:
    def _room_lits(li):                       # {rid: littéral} des salles candidates du cours li
        return {rid: lit for (rid, rtype, lit) in used_literals[li] if rtype == ROOM}

    def _has_alt_room(li):                     # au moins une salle candidate ≠ salle fixe (lit ≠ scheduled)
        return any(lit is not scheduled[li]
                   for (_, rtype, lit) in used_literals[li] if rtype == ROOM)

    # 1) Séquences consécutives par (prof effectif, jour, demi-journée), lues sur la solution GELÉE.
    seq = defaultdict(list)                    # (tid, d, h) -> [(start_val, li)]
    for li in range(len(courses)):
        if not solver.Value(scheduled[li]):
            continue
        sv = solver.Value(start[li])
        d = sv // 1440
        h = 0 if (sv - d * 1440) < half_cut else 1
        for (rid, rtype, lit) in used_literals[li]:
            if rtype == TEACHER and solver.Value(lit):
                seq[(rid, d, h)].append((sv, li))   # un cours multi-profs alimente chaque prof

    # 2) Paires consécutives INFLUENÇABLES → un booléen "au moins une salle commune choisie".
    same_vars = []
    for key, items in seq.items():
        items.sort()                            # ordre temporel = ordre réel (placement figé)
        for (_, i), (_, j) in zip(items, items[1:]):
            if not (_has_alt_room(i) or _has_alt_room(j)):
                continue                        # deux salles fixes → issue constante, rien à optimiser
            ri, rj = _room_lits(i), _room_lits(j)
            shared = set(ri) & set(rj)
            if not shared:
                continue                        # aucune salle commune → changement forcé (constant, omis)
            prods = []
            for r in shared:
                b = model.NewBoolVar(f"rprod{i}_{j}_{r}")
                model.AddBoolAnd([ri[r], rj[r]]).OnlyEnforceIf(b)          # b = (i choisit r) ∧ (j choisit r)
                model.AddBoolOr([ri[r].Not(), rj[r].Not()]).OnlyEnforceIf(b.Not())
                prods.append(b)
            same = model.NewBoolVar(f"rsame{i}_{j}")
            model.AddMaxEquality(same, prods)   # OR : au moins une salle commune choisie des deux côtés
            same_vars.append(same)

    if same_vars:                               # sinon rien d'influençable → passe entièrement sautée
        # 3) Gel DUR de tout SAUF les littéraux de salle.
        for li in range(len(courses)):
            model.Add(scheduled[li] == solver.Value(scheduled[li]))
            model.Add(start[li] == solver.Value(start[li]))
            for (rid, rtype, lit) in used_literals[li]:
                if rtype != ROOM:
                    model.Add(lit == solver.Value(lit))
        # 4) Amorce (warm start) + minimisation du NB de changements = Σ (1 − même salle).
        model.ClearHints()
        for li in range(len(courses)):
            for (rid, rtype, lit) in used_literals[li]:
                if rtype == ROOM:
                    model.AddHint(lit, solver.Value(lit))
        model.Minimize(len(same_vars) - sum(same_vars))
        remaining = max(1.0, total_timeout - solver.WallTime())
        solver4 = cp_model.CpSolver()
        solver4.parameters.max_time_in_seconds = remaining
        status4 = solver4.Solve(model)
        if status4 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            solver = solver4                    # extraire la solution ré-affectée en salle
```

**Points de vigilance pour l'implémenteur (ne pas improviser) :**
- **`_has_alt_room` via `is`** : la salle fixe a pour littéral l'objet `scheduled[li]` lui-même
  ([L431](../packages/scheduler-cpsat/cpsat_engine.py#L431)) ; une alternative a un `NewBoolVar`
  distinct ([L440](../packages/scheduler-cpsat/cpsat_engine.py#L440)). L'identité `lit is not
  scheduled[li]` distingue donc fixe/alternative sans ambiguïté. Ne pas remplacer par `==`.
- **Segmentation demi-journée** : `h` calculé depuis le `start` GELÉ, frontière `half_cut` (cohérent
  avec `on_half`, [L513-528](../packages/scheduler-cpsat/cpsat_engine.py#L513-L528) : la moitié 1
  commence À `half_cut`). Une paire à cheval sur midi tombe dans deux `(tid,d,h)` différents → jamais
  appariée. C'est le mécanisme du « reset gratuit ». Ne PAS regrouper par jour seul.
- **Gel DUR (`model.Add(... == valeur)`)**, pas `AddHint` : c'est une passe FINALE, aucune passe
  ultérieure ne s'en trouve contrainte. C'est ce gel dur qui garantit l'invariant « les autres douces
  ne bougent pas », plus fort que le verrou agrégé de la passe 3.
- **Réaffectation automatiquement licite** : le littéral d'une salle alternative porte déjà
  `AddLinearExpressionInDomain(start).OnlyEnforceIf(lit)` (dispo,
  [L443](../packages/scheduler-cpsat/cpsat_engine.py#L443)) et son intervalle dans le `NoOverlap` de la
  salle. À `start` gelé, une salle candidate indisponible au créneau voit son `lit` forcé à 0 ; une
  salle occupée par un autre cours est exclue par `NoOverlap`. **Aucune réaffectation infaisable ne
  peut être choisie** — rien à coder de plus.
- **Objectif `len(same_vars) - sum(same_vars)`** = nombre de changements sur les paires influençables
  (chaque paire : `1 - same`). Les changements incompressibles (pas de salle commune) et les paires
  fixe-fixe sont hors somme : constantes, sans effet sur l'`argmin`. Ne PAS tenter d'y inclure un
  `max(0,…)` ou une pondération.
- **Un cours multi-profs** alimente la séquence de chaque prof choisi (boucle sur les littéraux
  `TEACHER` à 1). Correct : chaque prof a sa propre continuité de salle.
- **Un cours multi-salles simultanées** (plusieurs entrées `rooms`) : `_room_lits` renvoie plusieurs
  rid ; `shared`/`same` gardent la sémantique « partagent au moins une salle ». Cas dégénéré (un prof
  physiquement dans 2 salles), non spécialement traité — le noter, ne pas s'y attarder en v1.

## 3. Passes lexico placement — vérifs (rien à toucher)

- La passe 4 lit `solver` = la solution de la dernière passe ayant tourné (1, 2 ou 3). Le gel dur
  la fige. Rien à modifier aux passes 1-3.
- Aucune interaction de poids : la passe 4 est lexicographiquement **en dessous** de tout, et
  géométriquement isolée (seule la salle bouge). Pas de `DAY_PRESENCE_PENALTY`-like à régler.
- `provenOptimal` = passe 1, inchangé.

## 4. Cas limites & interactions (à connaître, rien à coder de spécial)

- **Tous rooms fixes** → `same_vars` vide → passe entièrement sautée (no-op, coût nul).
- **Enforced** : salle figée (littéral = `scheduled`, gelé) ; le cours ancre la séquence, ne fournit
  aucun levier. Correct, aucun traitement spécial.
- **Aucune salle commune sur une paire** → changement incompressible, omis de l'objectif ; la solution
  reste faisable, aucune tentative vaine.
- **Combinaison avec les 4 autres douces** : par construction la passe 4 ne peut pas les toucher (tout
  gelé sauf salle). C'est l'invariant à mettre en avant en revue.

## 5. Tests de non-régression (`packages/scheduler-cpsat/test_solve.py`)

> Rappel de rôle : l'implémenteur écrit les tests + faits bruts, **n'écrit pas** « validé/corrigé »
> dans le STATUT — conclusions au relecteur.

Config de test par défaut (cf. mémoire `scheduler test default config`) : `timeoutSeconds:10`.
Chaque cours a besoin d'un `teacher`, éventuellement d'un `groups`, et surtout d'entrées `rooms`
(fixe = `"R1"`, alternatives = `["R1","R2"]`).

1. **`test_room_change_picks_common_room`** (test central + preuve de non-trivialité) — construire
   **5 enseignants indépendants**, chacun avec **2 cours consécutifs le même matin**, dont les salles
   forcent une unique salle commune (ex. cours A `rooms=[["R1","R2"]]`, cours B `rooms=[["R2","R3"]]`
   → seule commune = R2). Avec le flag : les 2 cours de chaque prof doivent partager R2. Assert : le
   **nombre total de changements de salle** (paires consécutives même-demi-journée à salles
   différentes) sur les 5 profs == **0**.
   - **Preuve « casse-si-retiré »** : commenter `model.Minimize(...)` de la passe 4 (ou le
     `if same_vars:`) doit faire **remonter le total à ≥1** (attention au faux positif de
     tie-breaking rencontré sur `crossNoonGap`, cf. mémoire `project_cross_noon_gap` : le solveur peut
     tomber par hasard sur l'optimum sans objectif). Les **5 paires indépendantes** rendent la
     coïncidence improbable ; **vérifier l'ablation explicitement en revue**, et si le total reste 0
     sans objectif, durcir (plus de paires, ou construction à optimum unique encore plus contraint).
2. **`test_room_change_keeps_within_half_only`** (segmentation midi) — un prof : matin `m1
   rooms=["R1"]` (fixe R1) puis `m2 rooms=[["R1","R2"]]` consécutif ; après-midi `a1 rooms=["R2"]`
   (fixe R2). Placement construit pour cet ordre. Avec le flag : la paire intra-matin (m1,m2) force
   **m2 = R1** (unique optimum matin). Assert : la salle de m2 == R1. *(Un bug qui apparierait m2 avec
   a1 à travers midi tirerait m2 vers R2 → l'assert le détecte.)*
3. **`test_room_change_no_common_room_incompressible`** — un prof, 2 cours consécutifs `rooms=["R1"]`
   et `rooms=["R2"]` (fixes, disjointes). Avec le flag : assert solve **FEASIBLE**, placement et
   salles **inchangés** (R1 puis R2), aucune exception. Vérifie le changement incompressible.
4. **`test_room_change_noop_when_all_fixed`** — instance à salles toutes fixes : placement, salles et
   `provenOptimal` **identiques** avec et sans le flag (la passe est sautée).
5. **`test_room_change_respects_availability`** — un prof, cours `i rooms=[["R1","R2"]]`, avec **R2
   indisponible** au créneau où `i` est placé (via les `constraints` de R2). Avec le flag : assert
   solve FEASIBLE et `i` conserve **R1** (R2 forcée à 0 par le domaine de dispo) — pas d'INFEASIBLE.
6. **`test_room_change_off_is_noop`** — même instance que (1) sans le flag : placement/salles/
   `provenOptimal` = baseline (bloc inerte quand off).

Écrire un petit helper de comptage `_count_room_changes(solution, half_cut)` : trier les cours placés
par (prof, jour, demi-journée, startTime), compter les paires consécutives même-demi-journée dont les
salles diffèrent. Utilisé par (1), (3), (6).

## 6. Client — checkbox (dernier, après feu vert)

`packages/scheduler-client/…` panneau CP-SAT : ajouter une case
« Limiter les changements de salle (enseignant) » à côté de celle de `crossNoonGap` (commit du chantier
crossNoonGap = `a4f1926` « checkbox trou de midi enseignant » = pattern exact à copier : `Draft` +
`configToDraft`/`draftToConfig` + UI `SchedulerConfigDialog.tsx`, migration store, tests). Tooltip :
« Fait en sorte qu'un enseignant garde la même salle d'un cours au suivant dans une même demi-journée,
quand une salle commune existe. Confort appliqué en dernier, sans jamais modifier l'emploi du temps ni
les autres préférences. »

## 7. Séquencement & checkpoint

Branche dédiée `feature/minimize-room-changes` (**jamais master**).

1. §1 plomberie contrat + flag + **liste blanche `_map_config`** + docstring.
2. §2 cœur moteur (passe 4).
3. **CHECKPOINT FEU VERT** → montrer à Frédéric le diff moteur (§2) avant d'écrire les tests :
   confirmer le gel dur, la segmentation `half_cut`, la sémantique `same` = OR des salles communes,
   l'objectif `len − sum`.
4. §5 tests (dont la preuve casse-si-retiré, avec ablation vérifiée en revue) + faits bruts au STATUT.
5. §6 checkbox client.
6. Validation sur le **vrai projet complet** (ré-export d'abord — les snapshots vieillissent, cf.
   mémoire `validate on full real project`) : sur une semaine réelle avec des salles alternatives,
   comparer le nb de changements de salle avant/après ; **confirmer placement, `provenOptimal` ET les
   valeurs des 4 autres douces strictement inchangés** ; noter le surcoût de la passe 4 (attendu
   négligeable). Batch loggé, un seul réveil à la fin (cf. mémoire `lean validation checkpoints`).

## 8. STATUT (rempli par l'implémenteur au fil de l'eau)

- [x] §1 contrat/plomberie/flag/`_map_config`/docstring
- [x] §2 cœur moteur (passe 4)
- [x] CHECKPOINT feu vert conception
- [x] §5 tests (+ preuve casse-si-retiré, ablation vérifiée)
- [x] §6 checkbox client
- [x] validation vrai projet (faits bruts uniquement)

*Faits bruts (temps de solve avant/après, nb de changements de salle, invariance des autres douces) —
PAS de conclusion « validé/corrigé » ici.*

**§5 — ablation du test central (`test_room_change_picks_common_room`)** : la construction initiale
(2 alternatives par cours, `[R1_i,R2_i]`/`[R2_i,R3_i]`) donnait 0 changement même `model.Minimize`
commenté (5/5 paires) — même artefact que documenté pour `crossNoonGap` (les variables auxiliaires
`same`/`prods` influencent le tie-breaking du solveur même sans objectif actif). Repro isolée avec
`ortools` nu (2 groupes `AddExactlyOne` + biconditionnel) : ablation donne systématiquement `same=0`
(mismatch), donc l'artefact ne vient pas de la structure logique elle-même mais d'une interaction
avec le reste du modèle réel (hints de la passe 4 posés sur les valeurs de la passe 1, qui elle-même
peut déjà tomber sur des salles partagées par tie-breaking). Durci en ajoutant 2 salles décoys par
cours (`[Rd1_i,Rd2_i,R2_i]`/`[Rd3_i,Rd4_i,R2_i]`) : ablation mesurée → 5/5 changements (Rd1/Rd3,
jamais R2) ; objectif actif → 0/5 (tous R2). 36/36 tests verts après durcissement.

**§5 — flakiness inter-runs découverte via §validation** : `test_room_change_off_is_noop` et
`test_room_change_noop_when_all_fixed` comparaient l'assignation EXACTE des salles/placement entre
deux appels `solve()` séparés (sans/avec flag). Mesuré : `test_room_change_off_is_noop` échoue
~13% des runs (4/30), `test_room_change_noop_when_all_fixed` ~3% (1/30) — CP-SAT multi-thread ne
garantit pas le même départage d'égalité (salle sans préférence, ou contention C2/C3 de `_toy_raw`)
entre deux invocations indépendantes. Alignés sur le patron déjà utilisé par
`test_balance_off_default_unchanged`/`test_soft_teacher_prefs_off_is_default_unchanged` (nb placé +
`provenOptimal` uniquement, pas d'égalité exacte). 50/50 runs de la suite complète stables après
correction.

**Validation vrai projet** : export `Planification MMI_2026-07-21_21-00.json` (décision Frédéric :
utilisé tel quel, pas de re-export), semaine 48 (124 cours, 81 à salles alternatives, 36 profs).
Config : `timeoutSeconds:180`, `lunchBreak` fixe 12h-13h30, `compactTeacherHalfDays`,
`minimizeTeacherDays`, `balanceTeacherDailyLoad`, `crossNoonGap` tous actifs (usage combiné
réaliste) + `minimizeTeacherRoomChanges`.
- Deux invocations séparées (sans/avec flag) : 114/114 placés, `provenOptimal=True` dans les deux
  cas, temps quasi identiques (181.8s → 182.1s). MAIS le placement (startTime par cours) différait
  entre les deux runs — confondu au départ avec un défaut de la passe 4, en fait un artefact de
  non-déterminisme multi-thread des passes 1-3 (optima liés), le même mécanisme que celui trouvé en
  §5 sur les tests `_off_is_noop`.
- Mesure propre refaite EN UN SEUL run (flag actif), avec une instrumentation temporaire (empreinte
  MD5 de `(scheduled[], start[])` juste avant/après le bloc passe 4, retirée immédiatement après
  mesure — diff final du moteur strictement identique à l'état du checkpoint, revérifié par
  `git diff --stat`) : empreinte AVANT = empreinte APRÈS (`8040de17d50652fe3b062f93f95119a0` des
  deux côtés) → le gel dur préserve exactement le placement et toutes les grandeurs non-salle sur
  données réelles.
- Nb de changements de salle, mesuré dans ce même run (instrumentation temporaire distincte, retirée
  après mesure) : 29 avant la passe 4 → 14 après, sur le MÊME placement figé.
- Surcoût mesuré de la passe 4 (comparaison des deux invocations séparées, donc approximatif compte
  tenu du bruit inter-run ci-dessus) : de l'ordre de +0.3s sur un total ~182s — négligeable au
  regard du budget `timeoutSeconds:180` et de la passe 3 (`balanceTeacherDailyLoad`, ~9× à elle
  seule d'après [[project_balance_teacher_daily_load]]).
- Gap trouvé en cours de route (hors passe 4, code pré-existant) : `_make_availability` côté Python
  (cpsat_engine.py) n'accepte `constraints["Default"]` que sous forme de liste brute ; le format
  réel exporté est un `ResourceConstraints` imbriqué (`{"default":[...], "S48":[...]}`) que le
  client (`scheduleApi.ts`, `_buildPayload`) aplatit AVANT envoi. Un premier essai naïf de
  validation (filtrage de `allCourses` par semaine + `constraints` bruts, sans reproduire cet
  aplatissement) donnait 0 cours plaçable. Corrigé dans le script de validation en répliquant
  exactement cette résolution ; pas un défaut du chantier courant, non touché.
