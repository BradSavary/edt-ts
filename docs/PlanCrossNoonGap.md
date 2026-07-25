# Plan — Option CP-SAT « Limiter le trou de midi enseignant » (préférence douce `crossNoonGap`)

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant. Il ajoute une **4ème
> préférence douce opt-in** au panneau CP-SAT, combinable avec les 3 existantes
> (`compactTeacherHalfDays`, `minimizeTeacherDays`, `balanceTeacherDailyLoad`). But : pénaliser le
> **trou de midi au-delà de la pause déjeuner** pour un enseignant présent matin ET après-midi —
> typiquement le cas « un cours à 8h, un cours à 18h, 2h de cours pour 10h d'amplitude ». Cible le
> mauvais **ratio temps-de-cours / amplitude**, sans jamais dégrader le nombre de cours placés ni
> violer une contrainte dure.

## 0. Décisions verrouillées (ne pas rouvrir)

- **Problème visé, et pourquoi les 3 options actuelles le ratent.**
  [`compactTeacherHalfDays`](../packages/scheduler-cpsat/cpsat_engine.py#L553-L580) minimise l'idle
  **par demi-journée** (découpe à `half_cut` = fin de pause). Un cours à 8h (matin) et un à 18h
  (aprem) tombent dans **deux blocs disjoints** → idle nul dans chacun ; le commentaire du code le
  dit : « Être présent matin ET après-midi n'est jamais pénalisé ». `minimizeTeacherDays` compte des
  jours (orthogonal). `balanceTeacherDailyLoad` équilibre les volumes entre jours (indifférent à
  l'amplitude d'un jour donné). Le trou de midi n'est donc couvert par aucune option → nouvelle
  option dédiée.

- **Métrique = idle additif, PAS un ratio.** Le ratio `busy/amplitude` est non linéaire (division),
  hors de portée propre de CP-SAT. Le proxy additif exact est l'**idle absolu** `amplitude − busy` :
  un mauvais ratio ⟺ un grand idle. On ne modélise QUE le **trou de midi** (segment d'idle qui
  traverse l'heure du déjeuner), au-delà de la pause protégée — c'est le morceau que
  `compactTeacherHalfDays` laisse passer. L'idle intra-demi-journée reste la responsabilité de
  `compactTeacherHalfDays` (les deux se cumulent proprement, cf. §0 « décomposition »).

- **Décomposition (fondement de correction).** Pour un (enseignant, jour) donné :
  `idle_journée = idle_matin + idle_aprem + trou_de_midi`, où
  `trou_de_midi = début_1er_cours_aprem − fin_dernier_cours_matin − durée_pause`.
  Cette identité tient **parce qu'aucun cours ne chevauche la pause** :
  [`_carve_lunch`](../packages/scheduler-cpsat/cpsat_engine.py#L95-L114) scinde chaque fenêtre en
  `[s, pause_début]` et `[pause_fin, e]`, et
  [`_start_domain`](../packages/scheduler-cpsat/cpsat_engine.py#L117-L120) contraint le départ à
  `[s, e−dur]` **par fenêtre** → l'intervalle entier tient dans une seule fenêtre carvée. Donc
  `fin_matin ≤ pause_début` et `début_aprem ≥ pause_fin`, d'où
  `trou_de_midi ≥ pause_fin − pause_début − durée_pause = 0`. **Positivité garantie par
  construction** : pas de `max(0,…)` défensif, pas de piège de signe.

- **Gate sur pause FIXE.** La garantie ci-dessus n'existe que si `lunch is not None`. Si la config
  est `lunchBreak:{type:'none'}`, la découpe à `half_cut=13:00` est arbitraire, un cours peut
  enjamber midi, et `trou_de_midi` pourrait être négatif → **quand `lunch is None`, l'option ne pose
  aucun terme** (documenté ; cas `none` = suite éventuelle, hors périmètre v1).

- **Où dans l'ordre lexico : PASSE 2.** Le terme est en **minutes**, même échelle que l'idle de
  `compactTeacherHalfDays` → il rejoint `penalty_terms`
  ([ligne 537](../packages/scheduler-cpsat/cpsat_engine.py#L537)) et est minimisé **dans la passe 2
  existante**. Conséquences décisives : **aucune nouvelle passe**, **aucun coût façon passe 3
  min-max** (le surcoût ~2s→18s de `balanceTeacherDailyLoad` NE s'applique PAS ici), et **aucun trou
  de soundness** du type « verrou du nombre de jours » : un simple terme de pénalité additif ne peut
  ni faire baisser le nombre de cours placés (verrouillé par `place_term >= best_placed` en passe 2,
  [ligne 648](../packages/scheduler-cpsat/cpsat_engine.py#L648)) ni ajouter un jour.

- **Poids = 1 (minutes brutes) en v1.** Le terme entre tel quel dans la somme `penalty_terms`. À
  méditer mais NE PAS pondérer en v1 : voir §4 (interaction avec `minimizeTeacherDays`, où 1 minute
  de trou de midi « pèse » face à `DAY_PRESENCE_PENALTY = 240`
  [ligne 53](../packages/scheduler-cpsat/cpsat_engine.py#L53)). Rester en minutes brutes = cohérent
  avec l'idle existant ; si le réglage se révèle nécessaire, l'exposer plus tard.

- **Portée = enseignants (`teacher`) uniquement**, comme les 3 autres options. Pas groupes ni salles.

- **Zéro impact quand l'option est off** : tout le bloc derrière le flag ; `provenOptimal` reste
  basé sur la passe 1, inchangé.

- **Indépendance / cumul.** `crossNoonGap` est un flag **indépendant**, combinable avec les 3
  autres. Activé seul, il ne pénalise QUE le trou de midi (pas l'idle intra-bloc). Pour compacter
  aussi l'intérieur des blocs, l'utilisateur combine avec `compactTeacherHalfDays` ; les deux termes
  s'additionnent sans double comptage (segments disjoints, cf. décomposition).

## 1. Contrat & plomberie config (faire en premier)

### 1.1 `packages/scheduler-common/src/types.ts`
- Ajouter à `interface SchedulerConfig`, **à côté** de `balanceTeacherDailyLoad`, un champ optionnel
  `crossNoonGap?: boolean`. Commentaire : « Préférence DOUCE (CP-SAT) : pénalise le trou de midi
  d'un enseignant présent matin et après-midi, au-delà de la pause déjeuner (limite les journées à
  faible ratio cours/amplitude, ex. 8h+18h). Ignorée si la pause n'est pas fixe. »
- **Vérifier** le nom/emplacement exact de l'interface (grep `balanceTeacherDailyLoad` dans le
  package). Respecter la règle archi : `scheduler-common` = modèle + contrat only, **aucune logique
  moteur** ici.

### 1.2 `packages/scheduler-api/src/cpsatGateway.ts`
- Faire suivre `crossNoonGap` du config TS vers le payload Python, **exactement** comme
  `balanceTeacherDailyLoad` (grep ce nom dans le fichier, copier le pattern). Rien d'autre.

### 1.3 `packages/scheduler-cpsat/cpsat_engine.py` — lecture du flag
- Après [ligne 331](../packages/scheduler-cpsat/cpsat_engine.py#L331)
  (`balance_load = bool(config.get("balanceTeacherDailyLoad", False))`), ajouter :
  `cross_noon = bool(config.get("crossNoonGap", False))`.
- **Gate pause fixe** : le terme ne sera construit que si `cross_noon and lunch is not None`
  (`lunch` est défini [ligne 349-352](../packages/scheduler-cpsat/cpsat_engine.py#L349-L352)).
- Étendre la garde du bloc doux : `if compact_half_days or minimize_days or balance_load:`
  ([ligne 539](../packages/scheduler-cpsat/cpsat_engine.py#L539)) devient
  `... or (cross_noon and lunch is not None):` — pour que `teacher_lits` soit construit quand
  `crossNoonGap` est la seule option active.
- Compléter le docstring de `solve()` (bloc ~L282-320) sur le modèle des options existantes.

## 2. Cœur moteur — le terme « trou de midi » (le seul vrai point technique)

Insérer un bloc **après** le bloc `compact_half_days` ([se termine ~L580](../packages/scheduler-cpsat/cpsat_engine.py#L580))
et avant/à côté de la présence-jours. Réutilise `teacher_lits`
([L542](../packages/scheduler-cpsat/cpsat_engine.py#L542)),
`on_half(li, d, h)` ([L503](../packages/scheduler-cpsat/cpsat_engine.py#L503)),
`possible_days`, `start[li]`, `courses[li][1]["duration"]`.

```python
# ── Option D : trou de midi (idle qui traverse la pause déjeuner, au-delà de celle-ci). ──
# Pour chaque (enseignant, jour) présent matin ET après-midi :
#   trou = début_1er_aprem − fin_dernier_matin − durée_pause  (≥ 0 garanti, pause carvée).
# Gate : pause fixe uniquement (sinon un cours peut enjamber midi → identité fausse).
if cross_noon and lunch is not None:
    lunch_len = lunch[1] - lunch[0]
    for tid, lst in teacher_lits.items():
        days = sorted({d for (li, _) in lst for d in possible_days[li]})
        for d in days:
            base = d * 1440
            morn, aft = [], []            # (li, p_m) / (li, p_a)
            for (li, lit) in lst:
                if d not in possible_days[li]:
                    continue
                p_m = model.NewBoolVar(f"cnm{tid}_{li}_{d}")
                model.AddBoolAnd([lit, on_half(li, d, 0)]).OnlyEnforceIf(p_m)
                model.AddBoolOr([lit.Not(), on_half(li, d, 0).Not()]).OnlyEnforceIf(p_m.Not())
                p_a = model.NewBoolVar(f"cna{tid}_{li}_{d}")
                model.AddBoolAnd([lit, on_half(li, d, 1)]).OnlyEnforceIf(p_a)
                model.AddBoolOr([lit.Not(), on_half(li, d, 1).Not()]).OnlyEnforceIf(p_a.Not())
                morn.append((li, p_m))
                aft.append((li, p_a))
            if not morn or not aft:
                continue                  # aucun cours possible d'un côté ⇒ jamais de trou
            # fin_matin = MAX des fins matin présentes (0 si aucune) ; e_i = fin si présent, sinon 0.
            ends = []
            for (li, p_m) in morn:
                dur = courses[li][1]["duration"]
                e_i = model.NewIntVar(0, base + 1440, f"em{tid}_{li}_{d}")
                model.Add(e_i == start[li] + dur).OnlyEnforceIf(p_m)
                model.Add(e_i == 0).OnlyEnforceIf(p_m.Not())
                ends.append(e_i)
            last_m = model.NewIntVar(0, base + 1440, f"lm{tid}_{d}")
            model.AddMaxEquality(last_m, ends)
            # début_aprem = MIN des débuts aprem présents (BIG si aucun) ; s_i = début si présent, sinon BIG.
            BIG = base + 1440
            starts = []
            for (li, p_a) in aft:
                s_i = model.NewIntVar(0, BIG, f"sa{tid}_{li}_{d}")
                model.Add(s_i == start[li]).OnlyEnforceIf(p_a)
                model.Add(s_i == BIG).OnlyEnforceIf(p_a.Not())
                starts.append(s_i)
            first_a = model.NewIntVar(0, BIG, f"fa{tid}_{d}")
            model.AddMinEquality(first_a, starts)
            # both = présent matin ET aprem.
            pm_any = model.NewBoolVar(f"pmA{tid}_{d}")
            model.AddMaxEquality(pm_any, [p for (_, p) in morn])
            pa_any = model.NewBoolVar(f"paA{tid}_{d}")
            model.AddMaxEquality(pa_any, [p for (_, p) in aft])
            both = model.NewBoolVar(f"both{tid}_{d}")
            model.AddBoolAnd([pm_any, pa_any]).OnlyEnforceIf(both)
            model.AddBoolOr([pm_any.Not(), pa_any.Not()]).OnlyEnforceIf(both.Not())
            # trou = first_a − last_m − lunch_len, seulement si both ; sinon 0. ≥0 garanti.
            gap = model.NewIntVar(0, 1440, f"cngap{tid}_{d}")
            model.Add(gap == first_a - last_m - lunch_len).OnlyEnforceIf(both)
            model.Add(gap == 0).OnlyEnforceIf(both.Not())
            penalty_terms.append(gap)     # en minutes → passe 2
```

**Points de vigilance pour l'implémenteur (ne pas improviser) :**
- `last_m` via `AddMaxEquality` sur `e_i` (fin si présent, **0** sinon) : le max ignore les absents
  car toute fin présente > 0. `first_a` via `AddMinEquality` sur `s_i` (début si présent, **BIG**
  sinon) : le min ignore les absents car BIG domine. **Ne pas inverser** (0 pour un min, BIG pour un
  max casserait tout).
- Égalité `gap == first_a − last_m − lunch_len` posée **uniquement `OnlyEnforceIf(both)`** : quand
  un seul côté est présent, `first_a=BIG` / `last_m=0` donneraient un `gap` absurde — d'où
  `gap == 0 OnlyEnforceIf(both.Not())`. C'est ce garde-fou qui rend le terme correct, PAS un
  `max(0,…)`.
- `AddMaxEquality(pm_any, [bools])` = OR réifié (déjà utilisé pour `day_used`
  [L602](../packages/scheduler-cpsat/cpsat_engine.py#L602)) : ok car domaine {0,1}.
- Un cours dont le domaine de départ enjambe midi apparaît dans `morn` ET `aft`, mais
  `on_half(_,_,0)` et `on_half(_,_,1)` sont mutuellement exclusifs (un départ est dans exactement
  une moitié) → au plus un de `p_m`/`p_a` vrai. Correct.

## 3. Passes lexico — vérifs (rien à ajouter, juste confirmer)

- Le terme est dans `penalty_terms` → minimisé en **passe 2**
  ([L654](../packages/scheduler-cpsat/cpsat_engine.py#L654)). Rien à toucher passe 1.
- Si `balanceTeacherDailyLoad` est co-actif : la passe 3 fige `sum(penalty_terms) <= best_p2`
  ([L668](../packages/scheduler-cpsat/cpsat_engine.py#L668)) → le trou de midi acquis en passe 2 est
  gelé, cohérent, rien à faire.
- `provenOptimal` = passe 1, inchangé.

## 4. Interaction avec `minimizeTeacherDays` (à documenter, pas à coder en v1)

Concentrer sur moins de jours peut allonger l'amplitude d'un jour donné. Les deux termes coexistent
additivement en minutes dans `penalty_terms` : `DAY_PRESENCE_PENALTY=240` par jour vs 1/minute de
trou. Un trou de midi de 4h (240 min) « vaut » donc exactement 1 jour de présence — équilibre
raisonnable a priori. **Ne pas pondérer en v1** ; noter dans le STATUT si le vrai projet montre un
arbitrage indésirable (p. ex. trou de midi qui l'emporte sur un jour en trop, ou l'inverse).

## 5. Tests de non-régression (`packages/scheduler-cpsat/test_solve.py`)

> Rappel de rôle : l'implémenteur écrit les tests + faits bruts, **n'écrit pas** « validé/corrigé »
> dans le STATUT — conclusions au relecteur.

Config de test par défaut : pause **fixe** (ex. `{type:'fixed', from:'12:00', to:'13:30'}`),
`timeoutSeconds:10`, un seul enseignant.

1. **`test_cross_noon_penalizes_split_day`** — un prof, 2 cours de 60 min, fenêtre large 8h-19h. Sans
   `crossNoonGap` : le placement peut mettre 8h-9h + 18h-19h (ou indifférent). Avec `crossNoonGap` :
   les 2 cours doivent être **compactés du même côté de midi** (idle midi = 0) OU collés autour de la
   pause (8h-9h impossible à coller à 18h). Assert : le trou de midi de la solution optimisée est
   **strictement inférieur** à celui d'un placement 8h/18h, et idéalement nul. Construire l'instance
   pour que le placement compact soit faisable.
2. **`test_cross_noon_lunch_not_counted`** — un prof, cours matin 11h-12h + cours aprem 13h30-14h30,
   pause 12h-13h30. Le trou de midi **réel = 0** (les deux cours encadrent exactement la pause).
   Assert : pénalité = 0 (la pause n'est PAS comptée comme idle). C'est le test qui **échoue si on
   oublie de soustraire `lunch_len`**.
3. **`test_cross_noon_only_afternoon_no_penalty`** — un prof, 2 cours l'après-midi seulement. Assert :
   aucun trou de midi (both = faux) → pénalité 0. Vérifie le garde-fou `OnlyEnforceIf(both)`.
4. **`test_cross_noon_off_is_noop`** — même instance que (1) sans le flag : placement/`provenOptimal`
   identiques à la baseline (le bloc est bien inerte quand off).
5. **`test_cross_noon_lunch_none_is_noop`** — flag activé mais `lunchBreak:{type:'none'}` : aucun
   terme posé, comportement = baseline (vérifie le gate `lunch is not None`).
6. **`test_cross_noon_combined_with_compact`** — `crossNoonGap` + `compactTeacherHalfDays` actifs :
   une journée 8h-9h, 11h-12h (matin) + 15h-16h, 18h-19h (aprem) doit être compactée des DEUX
   manières sans conflit ; assert que le solve reste FEASIBLE et que placement n'est pas dégradé.
   (Test d'intégration, pas de valeur exacte figée.)

**Test qui doit CASSER si on retire le cœur** (preuve de non-trivialité) : `test_cross_noon_penalizes_split_day`
doit échouer si on commente `penalty_terms.append(gap)`. Le vérifier explicitement (comme le
`test_balance_combined_never_adds_day` du chantier précédent).

## 6. Client — checkbox (dernier, après feu vert)

`packages/scheduler-client/…` panneau CP-SAT : ajouter une case
« Limiter le trou de midi enseignant » à côté de celle de `balanceTeacherDailyLoad` (commit
`6373431` = pattern exact à copier : state, binding config, libellé). Tooltip : « Évite qu'un
enseignant ait un cours tôt le matin et un autre tard le soir avec un grand vide au milieu (au-delà
de la pause déjeuner). Sans effet si la pause n'est pas fixe. »

## 7. Séquencement & checkpoint

Branche dédiée `feature/cross-noon-gap` (**jamais master**).

1. §1 plomberie contrat + flag + gate + docstring.
2. §2 cœur moteur.
3. **CHECKPOINT FEU VERT** → montrer à Frédéric le diff moteur (§2) avant d'écrire les tests :
   confirmer la formulation `first_a/last_m`, la soustraction `lunch_len`, le gate pause fixe.
4. §5 tests (dont le test qui casse-si-retiré) + faits bruts dans STATUT.
5. §6 checkbox client.
6. Validation sur le **vrai projet complet** (ré-export d'abord — les snapshots vieillissent) :
   observer un cas 8h/18h réel avant/après ; confirmer placement + `provenOptimal` inchangés ;
   noter le surcoût de la passe 2 (attendu faible, pas de passe 3).

## 8. STATUT (rempli par l'implémenteur au fil de l'eau)

- [x] §1 contrat/plomberie/flag/gate — `crossNoonGap` ajouté à `SchedulerConfig` +
      `DEFAULT_SCHEDULER_CONFIG` (scheduler-common/types.ts) ; `cpsatGateway.ts` inchangé (sérialise
      `config` tel quel, aucun champ nommé explicitement — vérifié par grep, aucune autre occurrence
      de `balanceTeacherDailyLoad` dans scheduler-api) ; `cross_noon` lu dans `cpsat_engine.py`,
      docstring complété, garde du bloc doux étendue à `(cross_noon and lunch is not None)`.
- [x] §2 cœur moteur — bloc Option D inséré tel quel (copié du plan), `tsc --noEmit` et
      `ast.parse` + import du module OK.
- [x] CHECKPOINT feu vert conception — approuvé par Frédéric ("ok").
- [x] §5 tests (+ preuve casse-si-retiré) — 7 nouveaux tests dans `test_solve.py`, 29/29 passent
      (aucune régression sur les tests compact/balance existants).
      **Gap non prévu par le plan** : `cpsat_runner.py` a une liste blanche `_map_config()` qui
      filtre les champs transmis à `solve()` (test `test_runner_map_config_passes_*_flag` existant
      pour compact/minimize/balance). `crossNoonGap` y était absent — ajouté (`cpsat_runner.py`),
      sinon le flag aurait été silencieusement supprimé à la frontière process malgré §1.1/§1.3 OK.
      **Preuve "casse-si-retiré" — fait rapporté par l'exécutant, PUIS tranché par le relecteur
      (Opus, 2026-07-26).** Sonnet avait honnêtement signalé que commenter uniquement
      `penalty_terms.append(gap)` NE cassait PAS `test_cross_noon_penalizes_split_day`. Vérifié en
      revue par ablation directe : la cause exacte est que, **sans `earliest`**, la seule PRÉSENCE
      des variables auxiliaires (`last_m`/`first_a`/`both`/`gap`) suffit à faire tomber le solveur
      sur trou=0 par effet de bord sur son ordre d'exploration, objectif retiré → **le test était un
      faux positif** (il serait resté vert avec l'objectif cassé). CORRIGÉ par le relecteur : ajout
      de `earliest:True` aux deux `solve()` du test. Mesures d'ablation qui l'établissent :
      `without+earliest = 90` (5/5), `with crossNoonGap+earliest = 0` (5/5) ; avec l'objectif retiré,
      `with+earliest` **remonte à 90** (5/5) → le passage à 0 est désormais imputable à l'objectif,
      pas au tie-breaking. Vérifié en revue : le test durci **échoue** (`assert 90 == 0`) quand on
      commente `penalty_terms.append(gap)`, et passe avec — vraie preuve de non-trivialité. Docstring
      du test réécrit en conséquence.
- [x] §6 checkbox client — pattern du commit 6373431 copié à l'identique : `Draft` +
      `configToDraft`/`draftToConfig` + UI (`SchedulerConfigDialog.tsx`), migration store v6→v7
      (`useAppConfigStore.ts`), tests étendus (`SchedulerConfigDialog.test.tsx`,
      `appConfigStoreEngine.test.ts`). `tsc --noEmit` propre.
      **Fait brut (pré-existant, sans rapport avec ce chantier)** : `SchedulerConfigDialog.test.tsx`
      échoue en entier (8/8, `storage.setItem is not a function`) aussi bien sur `master` avant ce
      chantier (vérifié via `git stash`) que sur cette branche — environnement `jsdom`/localStorage
      cassé pour ce fichier de test précis (contourné dans `appConfigStoreEngine.test.ts` par un
      `MemoryStorage` custom, absent de `SchedulerConfigDialog.test.tsx`). Suite scheduler-client
      complète par ailleurs : 443 passed / 8 failed (les 8 = ce seul fichier, pré-existant).
      `scheduler-api` : 7/7 passed. `scheduler-cpsat` : 29/29 passed.
- [ ] validation vrai projet (faits bruts uniquement) — nécessite les données réelles du projet de
      Frédéric (ré-export), non disponibles dans cet environnement : reste à faire par lui via l'UI.

*Faits bruts (temps de solve avant/après, valeurs de pénalité, placements) — PAS de conclusion
« validé/corrigé » ici.*
