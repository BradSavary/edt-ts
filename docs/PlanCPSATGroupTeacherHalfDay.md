# Plan — Option CP-SAT « Regrouper les cours d'un enseignant par demi-journée » (contrainte douce)

> ⚠️ **SUPERSÉDÉ (2026-07-25) — conservé comme trace.** La première version (une case unique
> `groupTeacherHalfDays`, sémantique « une seule demi-journée par jour ») a été implémentée puis
> **revue** après retour utilisateur : « regrouper » ne veut PAS dire une seule demi-journée par
> jour — matin + après-midi du même jour est un regroupement valide. Remplacée par **deux options
> douces indépendantes et combinables** : `compactTeacherHalfDays` (coller les cours dans une même
> demi-journée, minimiser les trous intra-bloc — jamais pénaliser matin+après-midi) et
> `minimizeTeacherDays` (concentrer sur le moins de journées distinctes). L'ossature ci-dessous
> (résolution 2 passes, `provenOptimal` sur la passe 1, plomberie config/UI, garde-fou placement)
> reste valable ; seule la fonction de pénalité de la passe 2 a changé.

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant. Il décrit une
> nouvelle **option opt-in du panneau CP-SAT** : une préférence *douce* qui pousse le solveur
> à concentrer les cours d'un même enseignant sur une seule demi-journée (matin **ou**
> après-midi) par jour, **sans jamais** dégrader le nombre de cours placés ni violer une
> contrainte dure (dispo, `maxDailyMinutes`, enforced, groupes…).
>
> Faisabilité déjà **démontrée** en spike (objectif lexicographique, cf. mémoire projet
> `cpsat-second-engine` §"contraintes douces"). Ce plan transforme la démo en feature câblée
> bout-en-bout.

## 0. Décisions verrouillées (ne pas rouvrir)

- **Modélisation = objectif lexicographique en DEUX passes** (voir §2). Le placement reste roi,
  prouvé indépendamment ; le regroupement est optimisé « au mieux » dans le temps restant.
  Alternative single-objective big-M écartée (coefficients énormes, `provenOptimal` moins net).
- **Portée = enseignants (`teacher`) uniquement.** Pas les groupes ni les salles (l'utilisateur
  a demandé « un même teacher »). Extensible plus tard sur le même moule.
- **Frontière de demi-journée** = fin de la pause méridienne fixe si `lunchBreak.type==='fixed'`,
  sinon défaut **13:00 (780 min)**. Classification par **heure de début** du cours (§2.2).
- **Enforced comptent** dans l'occupation d'une demi-journée (ils ne bougent pas mais occupent
  bien une moitié — les regrouper autour est le comportement voulu). Aucun cas particulier.
- **Zéro impact quand l'option est off** : tout le bloc de modélisation est gardé derrière le
  flag ; le chemin par défaut (`Maximize(place_term)`) reste strictement inchangé.

## 1. Contrat & plomberie config (faire en premier)

### 1.1 `packages/scheduler-common/src/types.ts`
- Ajouter à `interface SchedulerConfig` (après `postRepair`, avant `engine`) :
  ```ts
  /**
   * CP-SAT uniquement — préférence DOUCE : concentrer les cours d'un même enseignant sur une
   * seule demi-journée (matin OU après-midi) par jour. N'est optimisée qu'à nombre de cours
   * placés CONSTANT (objectif lexicographique 2 passes) : ne sacrifie jamais un placement ni
   * ne viole une contrainte dure. Sans effet sur le moteur core. Défaut : false.
   */
  groupTeacherHalfDays?: boolean;
  ```
- Ajouter `groupTeacherHalfDays: false,` à `DEFAULT_SCHEDULER_CONFIG`.

### 1.2 `packages/scheduler-cpsat/cpsat_runner.py` — `_map_config`
`_map_config` **filtre** les champs transmis au moteur : sans ajout ici, le flag est perdu à la
frontière process. Ajouter :
```python
if "groupTeacherHalfDays" in config:
    mapped["groupTeacherHalfDays"] = config["groupTeacherHalfDays"]
```

### 1.3 `packages/scheduler-client/store/useAppConfigStore.ts`
- Bump `version: 3` → `4`.
- Dans `migrate`, après la ligne `engine` :
  ```ts
  if (!('groupTeacherHalfDays' in schedulerConfig)) schedulerConfig.groupTeacherHalfDays = false;
  ```

### 1.4 `SchedulerConfigDialog.tsx`
- `interface Draft` : ajouter `groupTeacherHalfDays: boolean;`.
- `configToDraft` : `groupTeacherHalfDays: config.groupTeacherHalfDays ?? DEFAULT_SCHEDULER_CONFIG.groupTeacherHalfDays,`.
- `draftToConfig` : `groupTeacherHalfDays: draft.groupTeacherHalfDays,`.
- **UI** : nouvelle section affichée **seulement en CP-SAT** (`{isCpsat && (...)}`), placée après
  la section « Moteur » (ou avant « Pause méridienne »). Une seule checkbox, même patron visuel
  que `cfg-ignoreDailyLimits` :
  - Titre section : « CP-SAT — préférences (douces) ».
  - Label : « Regrouper les cours d'un enseignant par demi-journée ».
  - Aide : « Préférence appliquée au mieux : le moteur essaie de concentrer les cours d'un même
    enseignant sur une seule demi-journée par jour, sans jamais déplacer moins de cours ni
    dépasser ses limites. Peut allonger le temps de calcul et l'optimum de regroupement n'est pas
    toujours prouvé sous le timeout (le nombre de cours placés, lui, reste prouvé optimal). »
- Vérifier le test existant `SchedulerConfigDialog.test.tsx` : ajouter/adapter une assertion que
  la checkbox est **absente** en core et **présente** en CP-SAT, et qu'elle survit save→reload.

## 2. Cœur — `packages/scheduler-cpsat/cpsat_engine.py`

### 2.0 Lecture du flag
Dans `solve()`, à côté de `earliest = ...` (~ligne 293) :
```python
group_teacher = bool(config.get("groupTeacherHalfDays", False))
```

### 2.1 Frontière de demi-journée
Juste après le calcul de `lunch` (~ligne 309-312) :
```python
# Frontière matin/après-midi pour l'option de regroupement enseignant.
half_cut = lunch[1] if lunch is not None else 13 * 60   # fin de pause fixe, sinon 13:00
```
(`lunch` est `(from, to)` en minutes, ou `None`.) Comme la pause fixe est déjà retirée des dispos
des GROUP (donc aucun cours ne chevauche la pause), classer par heure de début est exact quand la
pause est fixe ; en l'absence de pause, la classification à 13:00 est une approximation acceptable
pour une préférence douce.

### 2.2 Réification « demi-journée » (réutiliser le patron `on_day`)
La fonction `on_day(li, d)` (~ligne 444) réifie déjà « le cours li démarre le jour d ». Ajouter un
helper frère, **juste après** `on_day`, réifiant « li démarre le jour d, moitié h » (h=0 matin,
h=1 après-midi) :
```python
on_half_cache = {}
def on_half(li, d, h):
    if (li, d, h) not in on_half_cache:
        base = d * 1440
        lo = base if h == 0 else base + half_cut
        hi = base + half_cut if h == 0 else base + 1440
        ge = model.NewBoolVar(f"hge{li}_{d}_{h}")
        model.Add(start[li] >= lo).OnlyEnforceIf(ge)
        model.Add(start[li] <= lo - 1).OnlyEnforceIf(ge.Not())
        lt = model.NewBoolVar(f"hlt{li}_{d}_{h}")
        model.Add(start[li] <= hi - 1).OnlyEnforceIf(lt)
        model.Add(start[li] >= hi).OnlyEnforceIf(lt.Not())
        oh = model.NewBoolVar(f"oh{li}_{d}_{h}")
        model.AddBoolAnd([ge, lt]).OnlyEnforceIf(oh)
        model.AddBoolOr([ge.Not(), lt.Not()]).OnlyEnforceIf(oh.Not())
        on_half_cache[(li, d, h)] = oh
    return on_half_cache[(li, d, h)]
```

### 2.3 Construction de la pénalité (gardée derrière le flag)
Placer **après** le bloc des plafonds quotidiens (après ~ligne 469, avant l'objectif). **Ne rien
construire si `group_teacher` est faux.**
```python
split_terms = []
if group_teacher:
    # Littéraux enseignant par cours : (rid teacher, lit d'utilisation) — enforced inclus
    # (lit == scheduled[li]), alternatives incluses (lit == bool de l'alternative choisie).
    teacher_lits = defaultdict(list)                      # tid -> [(li, lit)]
    for li in range(len(courses)):
        for (rid, rtype, lit) in used_literals[li]:
            if rtype == TEACHER:
                teacher_lits[rid].append((li, lit))

    active = {}                                           # (tid, d, h) -> BoolVar « prof actif »
    for tid, lst in teacher_lits.items():
        days = sorted({d for (li, _) in lst for d in possible_days[li]})
        for d in days:
            for h in (0, 1):
                members = []
                for (li, lit) in lst:
                    if d not in possible_days[li]:
                        continue
                    p = model.NewBoolVar(f"p{tid}_{li}_{d}_{h}")
                    oh = on_half(li, d, h)
                    model.AddBoolAnd([lit, oh]).OnlyEnforceIf(p)
                    model.AddBoolOr([lit.Not(), oh.Not()]).OnlyEnforceIf(p.Not())
                    members.append(p)
                if members:
                    a = model.NewBoolVar(f"act{tid}_{d}_{h}")
                    model.AddMaxEquality(a, members)       # a = OR(members) (booléens)
                    active[(tid, d, h)] = a

    # split[tid,d] = actif le matin ET l'après-midi = journée « éclatée » (à pénaliser).
    for tid, lst in teacher_lits.items():
        for d in sorted({d for (li, _) in lst for d in possible_days[li]}):
            am, pm = active.get((tid, d, 0)), active.get((tid, d, 1))
            if am is None or pm is None:
                continue
            s = model.NewBoolVar(f"split{tid}_{d}")
            model.AddBoolAnd([am, pm]).OnlyEnforceIf(s)
            model.AddBoolOr([am.Not(), pm.Not()]).OnlyEnforceIf(s.Not())
            split_terms.append(s)
```

### 2.4 Résolution 2 passes (remplace le bloc objectif + `solver.Solve` unique)
Remplacer le bloc actuel (`# Objectif : ...` jusqu'à `status = solver.Solve(model)`, ~lignes
471-481) par une résolution lexicographique. **Quand `group_teacher` est faux ou qu'il n'y a aucun
`split_terms`, on retombe exactement sur le comportement actuel (une seule passe).**
```python
total_timeout = float(config.get("timeoutSeconds", 30.0))
place_term = sum(scheduled.values())

# ── Passe 1 : optimum du NOMBRE de cours placés (départage « au plus tôt » si earliest). ──
if earliest and courses:
    weight = HORIZON * len(courses) + 1
    model.Maximize(weight * place_term - sum(start.values()))
else:
    model.Maximize(place_term)

solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = total_timeout
status = solver.Solve(model)

if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    return [_empty_solution(all_courses, week, exclude_types, rtype_of, counters, status)]

placement_proven = status == cp_model.OPTIMAL
best_placed = int(round(solver.Value(place_term)))

# ── Passe 2 : à placement FIXÉ, minimiser le nombre de demi-journées éclatées. ──
if group_teacher and split_terms:
    model.Add(place_term >= best_placed)          # verrou : jamais moins de cours placés
    # Amorce (warm start) avec la solution de la passe 1 → convergence plus rapide.
    model.ClearHints()
    for li in range(len(courses)):
        model.AddHint(scheduled[li], solver.Value(scheduled[li]))
        model.AddHint(start[li], solver.Value(start[li]))
    model.Minimize(sum(split_terms))
    remaining = max(1.0, total_timeout - solver.WallTime())
    solver2 = cp_model.CpSolver()
    solver2.parameters.max_time_in_seconds = remaining
    status2 = solver2.Solve(model)
    if status2 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        solver = solver2                          # extraire la solution regroupée
    # provenOptimal reste basé sur placement_proven (passe 1) — voir §2.5.
```
> **Note API OR-Tools** : `Maximize`/`Minimize` écrasent l'objectif précédent sur le même
> `CpModel` proto ; ré-`Solve` avec un nouveau `CpSolver` est correct et sans état partagé.
> `solver.WallTime()` renvoie le temps de la passe 1. Vérifier que `ClearHints`/`AddHint` existent
> dans la version d'ortools du venv (`packages/scheduler-cpsat/.venv`) ; sinon retirer le warm
> start (optionnel, pas nécessaire à la correction).

### 2.5 Extraction & `provenOptimal`
- L'extraction existante (`for li ... if solver.Value(scheduled[li])`, ~ligne 490) fonctionne
  telle quelle : `solver` pointe désormais sur la passe 2 si elle a abouti.
- **Conserver** `"provenOptimal": placement_proven` (au lieu de `status == OPTIMAL`). Sémantique
  voulue et honnête : on prouve l'optimum du **nombre de cours placés** (passe 1) ; le
  regroupement est « au mieux » et peut ne pas être prouvé sous le timeout. C'est cohérent avec le
  contrat documenté (`ScheduleSolutionJSON.provenOptimal` = optimum du nombre placé).
  ⚠️ Adapter la ligne `result = {...}` en conséquence (elle utilise aujourd'hui `status == OPTIMAL`).

### 2.6 Docstring
Mettre à jour l'en-tête de `solve()` (liste `config`, ~ligne 277-286) pour documenter
`groupTeacherHalfDays: bool (défaut False)`, et le bloc « Fidélité de modélisation » en tête de
fichier (ajouter une ligne « regroupement enseignant par demi-journée → préférence douce
lexicographique, passe 2 »).

## 3. Tests

### 3.1 `packages/scheduler-cpsat/test_solve.py` (obligatoire — pas de dépendance données réelles)
Ajouter (mêmes fixtures `_resources`/`ALL_DAY` que l'existant, ajuster au besoin) :

1. **`test_group_half_days_prefers_single_half`** — un enseignant T1 avec 2 cours courts et
   déplaçables, dispo toute la journée, aucune contrainte forçant un éclatement. Résoudre avec
   `{"groupTeacherHalfDays": True, "lunchBreak": {"type":"fixed","from":"12:00","to":"13:30"}}`.
   Assert : les 2 cours placés **et** dans la même demi-journée (les deux `startTime < base+810`
   OU les deux `>= base+810`, où `base` = jour*1440, `810` = 13:30). Idéalement comparer à un run
   **sans** l'option qui, lui, peut les éclater (non garanti — donc n'asserter QUE le run activé).

2. **`test_group_half_days_never_sacrifices_placement`** — instance où concentrer sur une
   demi-journée est **impossible** sans dépasser une limite (`maxDailyMinutes` de T1 assez basse
   pour ne tenir qu'un cours par demi-journée) : vérifier que le **nombre de cours placés est
   identique** avec et sans l'option (l'option ne doit jamais faire chuter le placement). C'est le
   test de non-régression central de la garantie « ne supplante pas le reste ».

3. **`test_group_half_days_off_is_default_unchanged`** — sur `_toy_raw()`, résultat identique
   (nombre placé, `provenOptimal`) avec option absente vs `{"groupTeacherHalfDays": False}`.

4. **`test_runner_map_config_passes_group_flag`** — étendre le test `_map_config` existant :
   `groupTeacherHalfDays: True` doit survivre dans `mapped`.

### 3.2 `packages/scheduler-cpsat/test_stress.py` (parité — skip auto sans données)
Optionnel mais recommandé : un cas paramétré S48 (données `2026-07-24_23-19`, cf. `_build_raw`)
avec `groupTeacherHalfDays: True`, assert `len(solutions) == 120` (inchangé vs sans option) et
`provenOptimal is True`. Vérifie sur données réelles que l'option ne casse pas le placement.

### 3.3 Client
- Adapter `SchedulerConfigDialog.test.tsx` (présence/absence checkbox selon moteur, round-trip).
- Vérifier `appConfigStoreEngine.test.ts` : la migration v4 injecte `groupTeacherHalfDays:false`
  sur une config persistée sans le champ (ajouter une assertion).

## 4. Vérification manuelle (avant de rendre la main)

1. `cd packages/scheduler-cpsat && .venv/Scripts/python.exe -m pytest -q` → tout vert.
2. Rejouer S48 réel (script standalone ou test_stress) **avec** l'option :
   - placé = 120 (inchangé), `provenOptimal = True` ;
   - inspecter quelques enseignants multi-cours : le nombre de journées « éclatées » doit baisser
     vs run sans option (métrique de succès qualitatif).
   - **⚠️ Piège connu** (mémoire `cpsat-second-engine`) : pour reconstruire un `RawScheduleData`
     réaliste depuis l'export projet brut, répliquer la résolution `Default` par-semaine faite par
     `scheduleApi.ts::_buildPayload` (`rc["S{week}"] ?? rc.default`), sinon faux INFEASIBLE dû aux
     salles sans fenêtre de dispo.
3. `npx tsc --noEmit` sur `scheduler-common`, `scheduler-client` ; `vitest run` sur `scheduler-client`.
4. Mesurer le surcoût temps passe 2 sur S48 (noter dans le commit / mémoire) — l'objectif secondaire
   transforme un placement trivial (~1s) en vraie optimisation ; documenter l'ordre de grandeur.

## 5. Périmètre explicitement HORS de ce plan
- Groupes/salles regroupés (même moule, extension future).
- Autres douces (trous/temps morts, compacité, équilibrage jours, salles préférées) — cohabiteraient
  en somme pondérée dans la passe 2, mais non demandées ici.
- Exposer une « intensité » de préférence (poids réglable) : binaire on/off suffit pour la v1.

## 6. Commits suggérés
1. `feat(scheduler-common): flag groupTeacherHalfDays (CP-SAT, préférence douce)` — types + défaut.
2. `feat(scheduler-cpsat): regroupement enseignant par demi-journée (objectif lexico 2 passes)` —
   moteur + runner + tests pytest.
3. `feat(scheduler-client): checkbox regroupement demi-journée (panneau CP-SAT)` — dialog + store
   migration v4 + tests client.

Branche : reprendre depuis `master` (l'intégration CP-SAT y est mergée). Ne pas merger sans le §4.
