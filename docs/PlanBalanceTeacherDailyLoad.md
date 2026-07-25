# Plan — Option CP-SAT « Équilibrer la charge quotidienne d'un enseignant » (préférence douce)

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant. Il ajoute une **3ème
> préférence douce opt-in** au panneau CP-SAT, combinable avec les 2 existantes
> (`compactTeacherHalfDays`, `minimizeTeacherDays`). But : quand un enseignant doit venir plusieurs
> jours (typiquement parce que sa charge dépasse `maxDailyMinutes`), **équilibrer** sa charge entre
> ces jours plutôt que de le surcharger un jour et l'alléger un autre — p. ex. 8h/2h → 6h/4h avec
> des séances de 2h. Cible les **grands déséquilibres**, sans jamais dégrader le nombre de cours
> placés ni violer une contrainte dure.

## 0. Décisions verrouillées (ne pas rouvrir)

- **Métrique = min-max de la charge quotidienne par enseignant (makespan).** Pour chaque
  enseignant : `peak[t] = max_jour( charge quotidienne )`, objectif `min Σ_t peak[t]` (en minutes).
  À charge totale fixée sur un jeu de jours fixé, minimiser le pic **est** l'équilibrage : le pic
  minimal de 10h en séances de 2h sur 2 jours vaut 6h → 6h/4h. Variance quadratique écartée (non
  linéaire) ; `max − min` sur « jours présents » écarté (le min sur jours absents = 0 est piégeux).
  Référence : équilibrage de charge / minimisation du makespan (ordonnancement machines, RCPSP).
- **Structure = 3 niveaux LEXICOGRAPHIQUES** (extension du 2-passes existant), PAS de somme
  pondérée (poids fragiles, cf. l'historique d'heuristiques cassées sur le vrai projet) :
  1. **Passe 1** — max cours placés *(inchangée)*.
  2. **Passe 2** — min pénalité douce « placement-neutre » (idle compacité + présence-jours)
     à placement figé *(existante, à étendre — voir §0 « ancrage »)*.
  3. **Passe 3** — min `Σ pic quotidien` à placement figé **ET** pénalité passe-2 figée.
- **Ancrage anti-étalement (crucial).** Le min-max récompense l'étalement sur PLUS de jours
  (10h sur 3 jours → pic 4h < pic 2 jours). Contraire à l'intention (« quitte à venir 2 jours » =
  le nombre de jours est subi, pas un levier). Garde-fou : **quand `balanceTeacherDailyLoad` est
  actif, on force TOUJOURS la présence-jours dans la passe 2** (même si `minimizeTeacherDays` est
  off), et la passe 3 verrouille la pénalité passe-2 → l'équilibrage ne peut réarranger qu'à
  l'intérieur du jeu de jours déjà arrêté, jamais en ajouter. Conséquence assumée et voulue
  (validée avec l'utilisateur) : **activer l'équilibrage seul minimise d'abord les jours de
  présence, puis équilibre ces jours.**
- **Portée = enseignants (`teacher`) uniquement.** Pas groupes ni salles.
- **Zéro impact quand l'option est off** : tout le bloc est gardé derrière le flag ; `provenOptimal`
  reste basé sur la passe 1 (optimum du nombre placé), inchangé.

## 1. Contrat & plomberie config (faire en premier)

### 1.1 `packages/scheduler-common/src/types.ts`
- Ajouter à `interface SchedulerConfig`, **après** `minimizeTeacherDays` (~ligne 337), avant la
  fermeture de l'interface :
  ```ts
  /**
   * CP-SAT uniquement — préférence DOUCE : équilibrer la charge quotidienne d'un enseignant entre
   * les jours où il est présent (minimiser sa charge journalière maximale), pour éviter qu'il soit
   * surchargé un jour et presque vide un autre. N'AJOUTE jamais de jour de présence : activée, elle
   * minimise d'abord le nombre de jours (comme `minimizeTeacherDays`) puis équilibre CES jours.
   * Mêmes garanties que les autres douces (à placement constant, résolution lexicographique) : ne
   * sacrifie jamais un placement ni ne viole une contrainte dure. Combinable avec
   * `compactTeacherHalfDays` et `minimizeTeacherDays`. Sans effet sur le moteur core. Défaut : false.
   */
  balanceTeacherDailyLoad?: boolean;
  ```
- Ajouter `balanceTeacherDailyLoad: false,` à `DEFAULT_SCHEDULER_CONFIG`.

### 1.2 `packages/scheduler-cpsat/cpsat_runner.py` — `_map_config`
`_map_config` **filtre** les champs transmis au moteur (~ligne 18-36). Sans ajout ici, le flag est
perdu à la frontière process. Après le bloc `minimizeTeacherDays` :
```python
if "balanceTeacherDailyLoad" in config:
    mapped["balanceTeacherDailyLoad"] = config["balanceTeacherDailyLoad"]
```

### 1.3 `packages/scheduler-client/store/useAppConfigStore.ts`
- Bump `version: 5` → `6`.
- Dans `migrate`, après la ligne `minimizeTeacherDays` (~ligne 36) :
  ```ts
  if (!('balanceTeacherDailyLoad' in schedulerConfig)) schedulerConfig.balanceTeacherDailyLoad = false;
  ```

### 1.4 `packages/scheduler-client/components/planning/modals/SchedulerConfigDialog.tsx`
> ⚠️ Ce package a un CLAUDE.md avertissant que le Next.js local diffère du connu. Ici on ne fait que
> **dupliquer le patron d'une checkbox déjà présente** (aucune API Next touchée) : suivre à
> l'identique `cfg-minimizeTeacherDays`.
- `interface Draft` : ajouter `balanceTeacherDailyLoad: boolean;` (~ligne 59).
- `configToDraft` : `balanceTeacherDailyLoad: config.balanceTeacherDailyLoad ?? DEFAULT_SCHEDULER_CONFIG.balanceTeacherDailyLoad,` (~ligne 97).
- `draftToConfig` : `balanceTeacherDailyLoad: draft.balanceTeacherDailyLoad,` (~ligne 129).
- **UI** : 3ème `<div className="flex items-start gap-3 pt-1">` dans la section
  « CP-SAT — préférences (douces) » (après le bloc `cfg-minimizeTeacherDays`, ~ligne 302), même
  structure exacte :
  - `id="cfg-balanceTeacherDailyLoad"`, `checked={draft.balanceTeacherDailyLoad}`,
    `onChange={(e) => setDraftField('balanceTeacherDailyLoad', e.target.checked)}`.
  - Label : « Équilibrer la charge quotidienne d'un enseignant ».
  - Aide : « Répartit plus équitablement la charge d'un enseignant entre les jours où il est présent
    (évite un jour surchargé et un autre presque vide). N'ajoute jamais de jour : elle regroupe
    d'abord sur le moins de jours possible, puis équilibre ces jours. »

## 2. Cœur — `packages/scheduler-cpsat/cpsat_engine.py`

### 2.0 Lecture du flag
Dans `solve()`, à côté de `minimize_days = ...` (~ligne 318) :
```python
balance_load = bool(config.get("balanceTeacherDailyLoad", False))
# L'équilibrage ancre le nombre de jours : il force la présence-jours dans la passe 2.
include_days = minimize_days or balance_load
```

### 2.1 Réutiliser une structure teacher-jour partagée
Le bloc « préférences douces » actuel (~lignes 517-583) reconstruit `teacher_lits` et, sous
`minimize_days`, des `q = lit ∧ on_day(li,d)` par (enseignant, jour). **La charge quotidienne se
calcule à partir de ces mêmes `q`** (`charge[t,d] = Σ durée[li]·q`). Refactor : construire ces
`q` dès que `include_days` (au lieu de `minimize_days` seul), les **mémoriser** par (tid, d) pour
les partager entre la pénalité présence-jours ET les pics.

Remplacer le sous-bloc « Option B » (~lignes 566-583) par une construction qui expose les `q` :
```python
        # ── Présence-jours enseignant (partagée : pénalité "moins de jours" + équilibrage). ──
        # Construite dès qu'une des deux options la requiert (minimize_days OU balance_load).
        present_q = defaultdict(list)                 # (tid, d) -> [q = lit ∧ on_day]
        day_used_by = {}                              # (tid, d) -> BoolVar "présent ce jour"
        if include_days:
            for tid, lst in teacher_lits.items():
                for d in sorted({d for (li, _) in lst for d in possible_days[li]}):
                    present = []
                    for (li, lit) in lst:
                        if d not in possible_days[li]:
                            continue
                        q = model.NewBoolVar(f"pd{tid}_{li}_{d}")
                        od = on_day(li, d)
                        model.AddBoolAnd([lit, od]).OnlyEnforceIf(q)
                        model.AddBoolOr([lit.Not(), od.Not()]).OnlyEnforceIf(q.Not())
                        present.append((li, q))
                        present_q[(tid, d)].append((li, q))
                    if not present:
                        continue
                    day_used = model.NewBoolVar(f"day{tid}_{d}")
                    model.AddMaxEquality(day_used, [q for (_, q) in present])
                    day_used_by[(tid, d)] = day_used
                    if minimize_days:                 # pénalité "jours" seulement si l'option est on
                        penalty_terms.append(DAY_PRESENCE_PENALTY * day_used)
```
> Note : `include_days` peut être vrai avec `minimize_days` faux (équilibrage seul). Dans ce cas on
> construit bien les `day_used` (ils ancrent les jours via la passe 2, voir §2.3) mais on
> **n'ajoute pas** `DAY_PRESENCE_PENALTY * day_used` à `penalty_terms`… **sauf** qu'alors rien
> n'ancrerait le nombre de jours. → **Décision : quand `balance_load`, ajouter TOUJOURS la pénalité
> présence-jours** (c'est le garde-fou anti-étalement). Donc la condition est `if include_days:`
> (pas `if minimize_days:`) pour la ligne `penalty_terms.append(...)`. Réécrire cette ligne en :
> ```python
>                     if include_days:                 # jours pénalisés dès que minimize_days OU balance
>                         penalty_terms.append(DAY_PRESENCE_PENALTY * day_used)
> ```

### 2.2 Pics quotidiens par enseignant (gardé derrière `balance_load`)
Juste après le bloc présence-jours, toujours dans `if compact_half_days or minimize_days or balance_load:`
(élargir la garde du bloc, ~ligne 523) :
```python
        # ── Équilibrage : min-max de la charge quotidienne par enseignant (passe 3). ──
        peak_terms = []                               # Σ pic, minimisé en passe 3 (pas passe 2)
        if balance_load:
            for tid, lst in teacher_lits.items():
                days = sorted({d for (li, _) in lst for d in possible_days[li]})
                loads = []
                for d in days:
                    qs = present_q.get((tid, d), [])
                    if not qs:
                        continue
                    loads.append(sum(courses[li][1]["duration"] * q for (li, q) in qs))
                if len(loads) < 2:
                    continue                          # ≤1 jour possible ⇒ rien à équilibrer
                peak = model.NewIntVar(0, 1440, f"peak{tid}")
                model.AddMaxEquality(peak, loads)     # peak = charge quotidienne max
                peak_terms.append(peak)
```
> `peak_terms` est construit dans le modèle mais **n'entre PAS** dans `penalty_terms` (passe 2) : il
> a son propre niveau lexicographique (passe 3). `1440` = borne physique (une journée ≤ 24 h de
> minutes) ; sûre même si `ignoreDailyLimits`. `present_q` est vide si `include_days` est faux —
> mais `balance_load ⇒ include_days`, donc `present_q` est toujours peuplé quand on arrive ici.

Sortir `peak_terms` de la portée du `if` (l'initialiser à `[]` avant le grand bloc, comme
`penalty_terms`) pour qu'il soit visible à la résolution.

### 2.3 Résolution lexicographique — ajouter la passe 3
Le bloc actuel fait passe 1 (max place) puis passe 2 (min `penalty_terms` à place figé,
~lignes 585-620). **Ajouter une passe 3** après la passe 2, gardée par `balance_load and peak_terms` :

```python
    # ── Passe 3 : à placement ET pénalité passe-2 FIGÉS, équilibrer (min Σ pic quotidien). ──
    if balance_load and peak_terms:
        model.Add(place_term >= best_placed)          # placement toujours verrouillé
        if penalty_terms:
            best_p2 = int(round(solver.Value(sum(penalty_terms))))
            model.Add(sum(penalty_terms) <= best_p2)  # fige compacité + jours acquis en passe 2
        model.ClearHints()
        for li in range(len(courses)):
            model.AddHint(scheduled[li], solver.Value(scheduled[li]))
            model.AddHint(start[li], solver.Value(start[li]))
        model.Minimize(sum(peak_terms))
        remaining = max(1.0, total_timeout - solver.WallTime())
        solver3 = cp_model.CpSolver()
        solver3.parameters.max_time_in_seconds = remaining
        status3 = solver3.Solve(model)
        if status3 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            solver = solver3                          # extraire la solution équilibrée
        # provenOptimal reste basé sur placement_proven (passe 1).
```
> **Points de vigilance** :
> - La passe 2 ne s'exécute que si `penalty_terms` est non vide. Comme `balance_load ⇒ include_days`
>   et qu'`include_days` peuple `penalty_terms` (présence-jours), **la passe 2 tourne toujours quand
>   l'équilibrage est actif** → `solver.Value(sum(penalty_terms))` est valide. Si un jour on activait
>   balance sans aucun terme (aucun enseignant multi-jours possible), le `if penalty_terms:` protège.
> - `sum(penalty_terms) <= best_p2` fige l'**agrégat** (somme sur enseignants), pas le compte par
>   enseignant. Un réarrangement total-jours-neutre entre 2 enseignants reste théoriquement possible ;
>   c'est accepté (nombre total de jours de présence inchangé). À noter dans le commit.
> - Budget temps partagé sur 3 passes : `remaining` peut être serré. Ne pas planter si `status3`
>   n'aboutit pas (le `if` conserve la solution passe 2).
> - `Minimize` écrase l'objectif précédent sur le même proto ; un nouveau `CpSolver` est sans état
>   partagé (déjà le patron de la passe 2).

### 2.4 Extraction & `provenOptimal`
Inchangés : `solver` pointe sur la dernière passe aboutie ; `provenOptimal = placement_proven`.

### 2.5 Docstring & en-tête de fidélité
- En-tête `solve()` (liste `config`) : documenter `balanceTeacherDailyLoad: bool (défaut False)` —
  min-max de la charge quotidienne par enseignant, passe 3 lexicographique, ancre le nombre de jours
  (force la présence-jours en passe 2), ne dégrade jamais placement ni contraintes dures,
  `provenOptimal` sur la passe 1.
- Bloc « préférences douces prof » en tête de fichier (~ligne 29-30) : ajouter l'équilibrage.

## 3. Tests — `packages/scheduler-cpsat/test_solve.py` (obligatoire, sans données réelles)

Mêmes fixtures que l'existant (`_resources`, `ALL_DAY`, `_toy_raw`). Rappel config de test par
défaut : `maxSolutions:1`, `timeoutSeconds:10`, pause fixe 12:00-13:30 (adapter au besoin).

1. **`test_balance_reduces_peak`** — un enseignant T1, 5 cours de 2h (total 10h), déplaçables,
   `maxDailyMinutes = 480` (8h), dispo lundi + mardi toute la journée (⇒ 2 jours forcés : 10h > 8h).
   Résoudre avec `{"balanceTeacherDailyLoad": True}`. Assert : les 5 cours placés **et** aucune
   journée de T1 ne dépasse **360 min (6h)** de charge (le pic minimal = 6h/4h). Comparer au run
   **sans** l'option n'est pas garanti (il peut déjà équilibrer) → n'asserter que le run activé.

2. **`test_balance_never_adds_day`** *(garde-fou central)* — T1, 3 cours de 2h (total 6h),
   `maxDailyMinutes = 480`, dispo **lundi+mardi+mercredi** toute la journée (3 jours *possibles*,
   1 seul *nécessaire* : 6h ≤ 8h). Résoudre avec `{"balanceTeacherDailyLoad": True}` (SEUL, sans
   `minimizeTeacherDays`). Assert : les 3 cours sont sur **un seul jour distinct** (l'équilibrage ne
   doit PAS étaler en 2h/2h/2h sur 3 jours). C'est le test de l'ancrage anti-étalement.

3. **`test_balance_never_sacrifices_placement`** — instance où l'équilibrage est en tension avec le
   placement (p. ex. cap bas + dépendances) : nombre de cours placés **identique** avec et sans
   l'option.

4. **`test_balance_off_default_unchanged`** — sur `_toy_raw()`, résultat identique (nombre placé,
   `provenOptimal`) avec option absente vs `{"balanceTeacherDailyLoad": False}`.

5. **`test_balance_combined_all_three`** — `{compactTeacherHalfDays, minimizeTeacherDays,
   balanceTeacherDailyLoad}` tous `True` sur une instance jouet : ne plante pas, place le même
   nombre de cours que sans options, `provenOptimal` inchangé.

6. **`test_runner_map_config_passes_balance_flag`** — étendre le test `_map_config` :
   `balanceTeacherDailyLoad: True` survit dans `mapped`.

## 4. Tests — `packages/scheduler-cpsat/test_stress.py` (parité S48 — skip auto sans données)
Cas paramétré S48 (données `2026-07-24_23-19`, cf. `_build_raw`) avec `balanceTeacherDailyLoad:
True` : assert nombre de solutions **inchangé** vs sans option et `provenOptimal is True`. Vérifie
sur données réelles que l'équilibrage ne casse jamais le placement.

## 5. Tests — client
- `SchedulerConfigDialog.test.tsx` : la checkbox `cfg-balanceTeacherDailyLoad` est **absente** en
  core, **présente** en CP-SAT, et survit save→reload.
- `appConfigStoreEngine.test.ts` : la migration v6 injecte `balanceTeacherDailyLoad: false` sur une
  config persistée sans le champ.

## 6. STATUT — à remplir par l'exécutant (faits bruts UNIQUEMENT)
> Rappel de convention : l'exécutant rapporte des **faits** (commandes lancées, sorties, comptes),
> pas de conclusions (« validé », « corrigé », « fonctionne »). L'attribution des gains et le verdict
> sont écrits au retour par le relecteur. Ne rien merger sans le §8.

- [x] pytest `scheduler-cpsat` : coller la sortie `-q` (nb passés/échoués).
  ```
  .....................ssssssssssssss                                      [100%]
  21 passed, 14 skipped in 0.50s
  ```
  (pytest absent du venv au départ, installé via `.venv/bin/python -m pip install pytest` — pytest 9.1.1.
  Les 14 skips : `test_parity_with_spike_measurements`/`test_contract_fields_and_group_semantics` (S38/S39,
  6+2=8) + `test_parity_soft_teacher_prefs_s48` (6 combos dont les 2 ajoutées pour balance) — fichiers
  export réels absents sur cette machine (`DATA.exists()` / `DATA_S48.exists()` → False).)
- [x] `test_stress` S48 avec option : nombre de solutions obtenu, `provenOptimal`, temps passe 3.
  Non exécutable sur cette machine : `packages/scheduler-core/data/BUT MMI 2026-2027_2026-07-24_23-19.json`
  absent (gitignoré) → les 2 paramétrisations ajoutées (`{"balanceTeacherDailyLoad": True}` et le combo des
  3 flags) sont dans `test_stress.py` mais skippées (`skipif`), jamais exécutées ici.
- [x] `npx tsc --noEmit` sur `scheduler-common` et `scheduler-client` : sortie.
  Les deux commandes retournent sans sortie (exit 0, aucune erreur).
- [x] `vitest run` sur `scheduler-client` : sortie.
  ```
  Test Files  1 failed | 37 passed (38)
       Tests  8 failed | 442 passed (450)
  ```
  Les 8 échecs sont tous dans `SchedulerConfigDialog.test.tsx`, même erreur (`storage.setItem is not a
  function`, `zustand/esm/middleware.mjs`). Fait vérifié : `git stash` (retour à `master` sans les
  changements de ce plan) + `npx vitest run __tests__/SchedulerConfigDialog.test.tsx` seul → les mêmes 8
  tests échouent à l'identique (même message, même stack). Le nouveau test client sur `useAppConfigStore`
  (migration v6) passe : `appConfigStoreEngine.test.ts (6 tests)` tout vert.
- [ ] Sur S48 réel, pour 2-3 enseignants multi-jours : charge par jour AVANT (sans option) vs APRÈS
      (avec option) — chiffres bruts, sans commentaire de succès.
  Non fait : pas d'export S48 réel sur cette machine. Smoke-test manuel de substitution (hors pytest, sur
  instance jouet, pour vérifier le mécanisme avant d'écrire les tests formels) :
  - 5 cours de 2h (T1, `maxDailyMinutes=480`, dispo lundi+mardi) : sans option, charge par jour
    {lundi: 480, mardi: 120} (5/5 placés) ; avec `balanceTeacherDailyLoad`, charge par jour
    {lundi: 240, mardi: 360} (5/5 placés, `provenOptimal=True`).
  - 3 cours de 2h (T1, dispo lundi+mardi+mercredi, 1 seul jour nécessaire) : avec l'option seule (sans
    `minimizeTeacherDays`), les 3 cours restent sur 1 seul jour distinct (pas d'étalement sur les 3 jours
    possibles).

## 7. CHECKPOINT feu-vert impl → tests
Après §1-§2 (implémentation câblée, avant d'écrire/lancer la batterie §3-§5) : **s'arrêter, rendre
la main pour feu vert.** Ne lancer §3-§6 qu'ensuite. (Règle Frédéric : checkpoint explicite dans
tout plan.)

## 8. Vérification manuelle (avant de rendre la main définitivement)
1. `cd packages/scheduler-cpsat && .venv/Scripts/python.exe -m pytest -q` (ou `.venv/bin/python`
   selon OS) → tout vert.
2. Rejouer S48 réel avec l'option : placement inchangé, `provenOptimal` inchangé ; inspecter la
   charge quotidienne de quelques enseignants multi-jours (doit être plus équilibrée qu'un run sans
   option). **⚠️ Piège export** (mémoire `cpsat-second-engine`) : reconstruire un `RawScheduleData`
   réaliste depuis l'export brut exige de répliquer la résolution `Default` par-semaine de
   `scheduleApi.ts::_buildPayload` (`rc["S{week}"] ?? rc.default`), sinon faux INFEASIBLE.
3. Noter dans le commit l'ordre de grandeur du surcoût temps de la passe 3 sur S48.

## 9. Périmètre explicitement HORS de ce plan
- Groupes/salles équilibrés (même moule, extension future).
- Deadband / seuil « ne toucher qu'aux GROS déséquilibres » : le min-max cible déjà les pics ; un
  seuil réglable (ignorer les écarts < X min) est un raffinement v2, non demandé.
- Poids/intensité réglable : binaire on/off suffit pour la v1.
- Équilibrage inter-enseignants (répartir la charge ENTRE profs) : hors sujet, ici c'est intra-prog.

## 10. Commits suggérés
1. `feat(scheduler-common): flag balanceTeacherDailyLoad (CP-SAT, préférence douce)` — types + défaut.
2. `feat(scheduler-cpsat): équilibrage charge quotidienne enseignant (min-max, passe 3 lexico)` —
   moteur + runner + tests pytest.
3. `feat(scheduler-client): checkbox équilibrage charge quotidienne (panneau CP-SAT)` — dialog +
   store migration v6 + tests client.

Branche dédiée depuis `master` (jamais sur master directement). Ne pas merger sans le §8.
