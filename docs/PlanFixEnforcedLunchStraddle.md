# Plan — Correction : cours `enforced` à cheval sur la pause méridienne (CP-SAT)

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant. Il **corrige un bug de
> sévérité haute** : un cours `enforced` qui empiète sur la pause méridienne fixe rend le modèle
> CP-SAT **INFEASIBLE** quand `crossNoonGap` est actif — toute la semaine s'effondre, zéro cours
> placé. Il corrige au passage une **infidélité silencieuse de `compactTeacherHalfDays`** qui a la
> même cause racine. Aucune nouvelle option, aucun nouveau flag : on répare deux options existantes.

## 0. Diagnostic verrouillé (ne pas rouvrir — tout est mesuré)

### 0.1 Le symptôme

Pause fixe 12:00–14:00, un `enforced` à 13:30. Avec `crossNoonGap` :

```
2 enforced : 13:30 (sur pause) + 16:00     score=0  INFEASIBLE   (baseline sans crossNoonGap = 4)
1 enforced 13:30 + taskGroup séquentiel    score=0  INFEASIBLE   (baseline = 3)
1 enforced 13:30 + 3 cours normaux         score=3  (éviction)   (baseline = 4)
```

Le moteur retombe sur [`_empty_solution`](../packages/scheduler-cpsat/cpsat_engine.py#L722-L724) et
neutralise **tous** les cours de la semaine.

### 0.2 La cause racine — un seuil scalaire sur `start`

[`on_half`](../packages/scheduler-cpsat/cpsat_engine.py#L526-L541) classe un cours matin/après-midi
sur son **seul début**, par rapport au scalaire
[`half_cut = lunch[1]`](../packages/scheduler-cpsat/cpsat_engine.py#L378) (fin de pause) :

```
matin ⟺ start < half_cut        aprem ⟺ start ≥ half_cut
```

Ce proxy est **exact pour tout cours normal**, et c'est pour ça qu'il a été choisi (moins cher qu'une
réification sur la fin) : [`_carve_lunch`](../packages/scheduler-cpsat/cpsat_engine.py#L95-L114) +
[`_start_domain`](../packages/scheduler-cpsat/cpsat_engine.py#L117-L120) garantissent que
l'intervalle entier tient dans une seule fenêtre carvée, donc `start < 14:00 ⟹ fin ≤ 12:00`.

Un `enforced` **court-circuite les deux** ([lignes 408-423](../packages/scheduler-cpsat/cpsat_engine.py#L408-L423) :
`start` imposé, aucune contrainte de domaine de disponibilité — fidèle à `bookEnforced()`). Un
enforced 13:30→15:00 est donc étiqueté **matin** alors qu'il finit à 15:00. Le proxy tombe.

### 0.3 Pourquoi ça rend INFEASIBLE (et pas seulement imprécis)

Le terme de `crossNoonGap` ([lignes 660-662](../packages/scheduler-cpsat/cpsat_engine.py#L660-L662))
n'est pas une pénalité : c'est une **assertion dure**.

```python
gap = model.NewIntVar(0, 1440, ...)                 # domaine ≥ 0
model.Add(gap == first_a - last_m - lunch_len).OnlyEnforceIf(both)
```

Le domaine `[0, 1440]` porte l'assertion `first_a ≥ last_m + lunch_len`. Sa légitimité repose sur
l'argument « positivité garantie par construction » de
[PlanCrossNoonGap.md §0](PlanCrossNoonGap.md#L29-L39) — qui **ne couvre pas les enforced**. Avec
`last_m = 15:00`, tout cours d'après-midi avant 17:00 donne `gap < 0` → contradiction.

Ces contraintes sont posées **avant la passe 1** (le `model` est partagé, seul l'objectif change
entre passes) → la corruption frappe l'optimum de placement lui-même :

| Présence d'après-midi du prof ce jour-là | Effet |
|---|---|
| Droppable (cours normaux) | Éviction silencieuse |
| Non droppable (2ᵉ enforced, ou `taskGroup` collé à l'enforced) | **INFEASIBLE global** |

### 0.4 Déplacer le seuil ne corrige rien — mesuré

| Scénario (pause 12:00–14:00, `crossNoonGap`) | `half_cut`=14:00 (actuel) | `half_cut`=12:00 |
|---|---|---|
| enforced 13:30 + enforced 16:00 | **0 INFEASIBLE** | 3 ✓ |
| enforced 10:00–12:00 + enforced 13:30 | 3 ✓ | **0 INFEASIBLE** |
| les deux à la fois | **0 INFEASIBLE** | **0 INFEASIBLE** |

L'identité `gap ≥ 0` exige **deux** bornes simultanées (`fin_matin ≤ 12:00` **et**
`début_aprem ≥ 14:00`). Un seuil scalaire ne peut que ranger le cours à cheval d'un côté ; de quelque
côté qu'il tombe, il viole la borne de ce côté. **Le cours à cheval n'appartient à aucune des deux
moitiés** — c'est ça qu'il faut modéliser. (Corollaire : toute valeur de `half_cut` dans
`[12:00, 14:00]` est rigoureusement équivalente sur les cours normaux, aucun ne démarrant dans cet
intervalle. Le choix de la borne n'est pas le sujet.)

### 0.5 `compactTeacherHalfDays` : même cause, deux erreurs opposées

Structurellement **incapable** de rendre le modèle infaisable (`idle == last − first − busy` avec
`idle ≥ 0` reste toujours satisfiable : les cours d'un même prof ne se chevauchent pas via
`AddNoOverlap`, donc amplitude ≥ Σ durées quelle que soit la classification). Mais faux **dans les
deux sens** — mesuré en instrumentant `sum(penalty_terms)` :

**Sur-facturation.** Matin parfaitement compact (8:00–10:00, 10:00–12:00) + enforced 13:30–15:00 :

| | pénalité | placement retenu |
|---|---|---|
| enforced 14:00 (témoin) | **0** | M1=8:00-10:00 · A=14:00-15:30 · M2=15:30-17:30 |
| enforced 13:30 (straddler) | **90** | M1=8:00-10:00 · M2=10:00-12:00 · A=13:30-15:00 |

Ces 90 minutes sont exactement 12:00→13:30 : **la pause résiduelle facturée comme du temps mort**.
L'option viole sa propre promesse — sa docstring
([ligne 300-301](../packages/scheduler-cpsat/cpsat_engine.py#L300-L301), reprise
[ligne 575](../packages/scheduler-cpsat/cpsat_engine.py#L575)) garantit qu'être présent matin *et*
après-midi n'est jamais pénalisé. Le placement est distordu au passage.

**Sous-facturation (défaut miroir).** Trou réel l'après-midi, salle forçant `N` à 17:00 :

| | trou réel | pénalité |
|---|---|---|
| enforced 14:00–15:30 (témoin) | 90 min | **90** ✓ |
| enforced 13:30–15:00 (straddler) | **120 min** | **0** ✗ |

Le straddler ayant été volé au bloc après-midi, celui-ci tombe à un seul membre et le garde
[`len(members) < 2 → continue`](../packages/scheduler-cpsat/cpsat_engine.py#L590-L591) supprime le
terme. Un trou **plus grand** est facturé zéro.

**Les deux options actives** : pas de double comptage mais un *transfert* — `crossNoonGap` facture 0
(le straddler étant « matin », `both` est faux) tandis que `compact` facture 90. L'option qui
promettait de ne pas facturer le trou de midi le facture ; celle qui est conçue pour ça ne facture
rien.

### 0.6 La notion qui répare tout : la **pause résiduelle**

Formulation retenue (validée avec Frédéric ; sa remarque est le pivot du correctif) : *« la pause
méridienne ne s'applique qu'au GROUP. Un groupe qui a un cours enforced empiétant sur la pause a une
pause écourtée, mais une pause quand même. »* Vérifié dans le code —
[le carvage ne touche que les groupes](../packages/scheduler-cpsat/cpsat_engine.py#L150-L151) ; un
enseignant n'a aucune pause dans le modèle, il n'en hérite que par transitivité via le groupe de ses
cours.

Donc **on ne supprime pas le terme** pour un (prof, jour) touché — ce serait rendre gratuit un trou
authentique. On soustrait la **pause réellement disponible** au lieu de la constante `lunch_len` :

> **Pause résiduelle `[P0, P1]` d'un (enseignant, jour)** = le plus grand sous-intervalle contigu de
> la fenêtre de pause **libre des cours `enforced` de cet enseignant ce jour-là**.
>
> - matin ⟺ `fin ≤ P0` · après-midi ⟺ `début ≥ P1` · longueur de pause = `P1 − P0`
> - `P1 == P0` (pause entièrement mangée) ⟹ **pas de scission** : la journée est un bloc unique.

**C'est une partition valide** : `[P0, P1]` étant par construction libre des cours de cet enseignant,
et ses cours ne se chevauchant pas, chaque cours tient entièrement avant `P0` ou après `P1`.

Vérification arithmétique sur les trois cas (pause 12:00–14:00) :

| Enforced | Pause résiduelle | Rôle | `gap` attendu |
|---|---|---|---|
| 13:30→15:00 | 12:00–13:30 (90) | 1ᵉʳ cours d'après-midi | `810 − 720 − 90 = 0` ✓ |
| 11:00→13:00 | 13:00–14:00 (60) | dernier cours du matin | `840 − 780 − 60 = 0` ✓ |
| 11:00→15:00 | ∅ | ni l'un ni l'autre | bloc unique, terme nul |

Et si le cours du matin finit à 10:00 au lieu de 12:00 : `810 − 600 − 90 = 120` — **le vrai trou
reste facturé**. C'est le test qui prouve qu'on n'a pas simplement désactivé l'option.

La même notion répare `compact` : cas de sur-facturation → matin `{M1, M2}` span 240 / busy 240 →
**idle 0** ✓ ; cas de sous-facturation → après-midi `{A, N}` span 270 / busy 150 → **idle 120** ✓ ;
témoin inchangé à 90 ✓.

### 0.7 Décisions verrouillées

- **`lunch is None` : aucun changement.** Toute la machinerie nouvelle est conditionnée à
  `lunch is not None`. Quand il n'y a pas de pause fixe, on **garde `on_half` tel quel** avec
  `half_cut = 13:00`. Diff chirurgical, zéro régression sur ce chemin (cohérent avec le périmètre
  déjà acté : pause flottante hors sujet).
- **`max(0, …)` obligatoire.** Une préférence douce ne doit **jamais** pouvoir rendre le modèle
  infaisable. C'est l'invariant qui a sauté ; on le rend structurel plutôt que de dépendre d'un
  raisonnement de partition — voir le point suivant, qui montre qu'il reste un chemin non couvert.
- **Un cours à cheval n'est PAS forcément enforced.** Vérifié : le carvage ne s'appliquant qu'aux
  groupes, un cours dont `groups` est **vide** n'est contraint que par prof et salle, ni l'un ni
  l'autre carvés — testé, il se place à 12:00 en pleine pause, avec un `start` **variable**. La
  partition du §0.6 ne le couvre pas. On ne cherche pas à le modéliser en v1 (à confirmer côté
  loader/UI si `groups: []` est seulement atteignable) : c'est précisément ce que le `max(0, …)`
  neutralise. **À documenter explicitement dans la docstring.**
- **Pas de nouveau flag, pas de changement de contrat.** `SchedulerConfig`, `cpsatGateway.ts`,
  `cpsat_runner.py` (`_map_config`) : **rien à toucher** — vérifié, `crossNoonGap` et
  `compactTeacherHalfDays` y sont déjà tous les deux.
- **Hors périmètre** : avertir l'utilisateur dans l'UI qu'un enforced empiète sur la pause. Question
  produit distincte, à poser à Frédéric séparément — ne pas l'embarquer ici.

## 1. Cœur du correctif (`packages/scheduler-cpsat/cpsat_engine.py`)

### 1.1 Helper module-level — pause résiduelle

À placer près de `_carve_lunch` (~ligne 114), avec test unitaire direct (§4.1) :

```python
def _residual_break(busy: list[tuple[int, int]], l0: int, l1: int) -> tuple[int, int]:
    """Plus grand sous-intervalle contigu de [l0,l1] libre des intervalles `busy`.

    `busy` et le retour sont en minutes DEPUIS MINUIT du jour considéré. Retourne (l0,l0)
    — longueur nulle — si la fenêtre est entièrement occupée. Sert à définir la pause
    méridienne RÉELLEMENT disponible d'un (enseignant, jour) quand un cours enforced
    empiète dessus : la pause est écourtée, pas supprimée.
    """
    clipped = sorted((max(s, l0), min(e, l1)) for s, e in busy if s < l1 and e > l0)
    best, cur = (l0, l0), l0
    for s, e in clipped:
        if s - cur > best[1] - best[0]:
            best = (cur, s)
        cur = max(cur, e)
    if l1 - cur > best[1] - best[0]:
        best = (cur, l1)
    return best
```

### 1.2 Occupation enforced par (enseignant, jour)

À construire dans `solve()` juste après `teacher_lits` (~ligne 569), **uniquement si
`lunch is not None`**. Les `start` des enforced sont des constantes Python → aucun coût solveur.

```python
enf_busy = defaultdict(list)                   # (tid, d) -> [(début, fin)] en minutes du jour
for li, (_gi, c) in enumerate(courses):
    e = c.get("enforced")
    if not e:
        continue
    d, off = e["startTime"] // 1440, e["startTime"] % 1440
    for (rid, rtype, _lit) in used_literals[li]:
        if rtype == TEACHER:
            enf_busy[(rid, d)].append((off, off + c["duration"]))

def residual(tid, d):
    """Pause résiduelle (P0,P1) de ce (prof, jour) ; (0,0) si pas de pause fixe."""
    if lunch is None:
        return (0, 0)
    return _residual_break(enf_busy.get((tid, d), []), lunch[0], lunch[1])
```

> Un enforced qui traverserait minuit (`off + duration > 1440`) est hors sujet pour un emploi du
> temps ; ne pas modéliser, mais **ne pas planter** — `_residual_break` clippe déjà à `l1`.

### 1.3 Réification par côté — remplace `on_half` quand la pause est fixe

`on_half` est **conservé tel quel** (chemin `lunch is None`). Ajouter à côté :

```python
on_side_cache = {}

def on_side(li, d, p0, p1, h):
    """« Le cours li est ENTIÈREMENT du côté h de la pause résiduelle [p0,p1] du jour d ».

    h=0 (matin)  ⟺ base ≤ start ET start + durée ≤ base + p0   ← teste la FIN, pas le début
    h=1 (aprem)  ⟺ base + p1 ≤ start < base + 1440

    Différence clé avec on_half (seuil scalaire sur le seul `start`) : un cours à cheval sur
    la pause n'appartient à AUCUN des deux côtés — littéral constamment faux des deux côtés.
    C'est exactement le cas d'un enforced qui empiète sur la pause, que le seuil scalaire
    rangeait de force d'un côté, cassant l'identité du trou de midi.
    """
    key = (li, d, p0, p1, h)
    if key not in on_side_cache:
        base, dur = d * 1440, courses[li][1]["duration"]
        lo = base if h == 0 else base + p1
        hi = base + p0 - dur if h == 0 else base + 1439      # bornes SUR start, inclusives
        if hi < lo:                                          # ne tient pas de ce côté
            on_side_cache[key] = model.NewConstant(0)
        else:
            ge = model.NewBoolVar(f"sge{li}_{d}_{h}")
            model.Add(start[li] >= lo).OnlyEnforceIf(ge)
            model.Add(start[li] <= lo - 1).OnlyEnforceIf(ge.Not())
            le = model.NewBoolVar(f"sle{li}_{d}_{h}")
            model.Add(start[li] <= hi).OnlyEnforceIf(le)
            model.Add(start[li] >= hi + 1).OnlyEnforceIf(le.Not())
            os_ = model.NewBoolVar(f"os{li}_{d}_{h}")
            model.AddBoolAnd([ge, le]).OnlyEnforceIf(os_)
            model.AddBoolOr([ge.Not(), le.Not()]).OnlyEnforceIf(os_.Not())
            on_side_cache[key] = os_
    return on_side_cache[key]
```

> **Vérifié (ortools 9.15.6755)** : `model.NewConstant(0)` est accepté comme littéral par
> `AddBoolAnd`, y compris sous `OnlyEnforceIf`. Pas de contournement nécessaire. (Fallback si une
> montée de version le refusait : `b = model.NewBoolVar(...); model.Add(b == 0)` — également testé.)

### 1.4 `compactTeacherHalfDays` — blocs pilotés par la pause résiduelle

Dans la boucle `if compact_half_days:` ([lignes 576-603](../packages/scheduler-cpsat/cpsat_engine.py#L576-L603)),
remplacer `for h in (0, 1): … on_half(li, d, h)` par une itération sur des **blocs** :

- `lunch is None` → blocs = `[on_half(li, d, 0), on_half(li, d, 1)]` (**inchangé**)
- `P1 > P0` → blocs = `[on_side(li, d, P0, P1, 0), on_side(li, d, P0, P1, 1)]`
- `P1 == P0` (pause entièrement mangée) → **un seul bloc** = `on_day(li, d)` : la journée n'est plus
  scindée, `compact` facture l'intégralité de son temps mort. Correct — il n'y a plus de pause pour
  excuser un trou.

Le reste du corps (`first`/`last`/`busy`/`idle`, garde `len(members) < 2`) est **inchangé**.

### 1.5 `crossNoonGap` — pause réelle au lieu de `lunch_len`, et positivité structurelle

Dans le bloc Option D ([lignes 609-663](../packages/scheduler-cpsat/cpsat_engine.py#L609-L663)) :

1. Par (tid, d) : `p0, p1 = residual(tid, d)` ; **`if p1 == p0: continue`** (pause entièrement
   mangée → pas de scission → la notion de « trou de midi » n'a plus d'objet ; `compact` prend le
   relais sur la journée entière via §1.4).
2. `oh0`/`oh1` → `on_side(li, d, p0, p1, 0)` / `on_side(li, d, p0, p1, 1)`.
3. `lunch_len` (constante globale) → **`p1 - p0`** (par prof et par jour).
4. Positivité **structurelle**, non plus portée par le domaine :

```python
raw_gap = model.NewIntVar(-1440, 1440, f"cnraw{tid}_{d}")
model.Add(raw_gap == first_a - last_m - (p1 - p0)).OnlyEnforceIf(both)
model.Add(raw_gap == 0).OnlyEnforceIf(both.Not())
gap = model.NewIntVar(0, 1440, f"cngap{tid}_{d}")
model.AddMaxEquality(gap, [raw_gap, 0])     # ← plus JAMAIS d'infaisabilité par ce terme
penalty_terms.append(gap)
```

> **Vérifié (ortools 9.15.6755)** : `AddMaxEquality(gap, [raw_gap, 0])` accepte l'entier littéral `0`
> et donne bien `gap = 0` pour `raw_gap = -180` (statut `OPTIMAL`).

> Remplacer aussi le commentaire « ≥0 garanti, pause carvée » : il est faux depuis toujours pour les
> enforced, c'est l'origine du bug. Documenter la vraie raison (`max(0, …)`) et le chemin non couvert
> (cours sans groupe, §0.7).

### 1.6 Passe 4 (`minimizeTeacherRoomChanges`) — cohérence de la demi-journée

[Ligne 794](../packages/scheduler-cpsat/cpsat_engine.py#L794) : `h = 0 if (sv - d*1440) < half_cut else 1`.
Le placement est **gelé** ici → calcul en Python pur, aucun coût. Aligner sur la même frontière :
`h = 0 if (fin − base) <= P0 else 1` avec `(P0, P1) = residual(tid, d)`, un straddler tombant côté
après-midi (il est adjacent aux cours d'après-midi, c'est là que la continuité de salle a du sens).
Impact faible et purement cosmétique sur le confort ; le faire pour ne pas laisser deux définitions
contradictoires de « demi-journée » dans le même fichier.

### 1.7 Docstring `solve()`

Mettre à jour l'entrée `crossNoonGap` ([lignes 322-330](../packages/scheduler-cpsat/cpsat_engine.py#L322-L330))
et la ligne `compactTeacherHalfDays` : notion de pause résiduelle, comportement sur enforced à cheval,
`max(0, …)`, et le trou connu « cours sans groupe ».

## 2. Ce qu'il ne faut PAS faire (pièges identifiés)

- ❌ **Déplacer `half_cut`** (à 12:00, à 13:00) : mesuré au §0.4, ça déplace le bug.
- ❌ **Sauter le terme pour un (prof, jour) touché** : rend gratuit un trou authentique (§0.6).
- ❌ **Étendre le carvage aux enseignants** : casserait la fidélité à `scheduler-core`, où la pause
  est une contrainte de GROUP (§0.6), et interdirait des enforced légitimes.
- ❌ **Se contenter du `max(0, …)`** sans corriger la classification : plus d'INFEASIBLE, mais
  `compact` reste faux dans les deux sens (§0.5) et `crossNoonGap` facture n'importe quoi.
- ❌ Toucher au contrat, au client, ou au `_map_config` du runner : rien à y faire (§0.7).

## 3. Tests de non-régression (`packages/scheduler-cpsat/test_solve.py`)

> Rappel de rôle : l'implémenteur écrit les tests + **faits bruts**, **n'écrit pas**
> « validé/corrigé » dans le STATUT — conclusions au relecteur.

**Avertissement méthodologique — lire avant d'écrire les tests.** Le chantier `crossNoonGap` a
produit un **faux positif** documenté ([PlanCrossNoonGap.md §8](PlanCrossNoonGap.md#L269-L281)) : sans
`earliest`, la seule *présence* des variables auxiliaires suffisait à faire tomber le solveur sur la
bonne valeur par effet de bord sur son ordre d'exploration, objectif retiré. **Tout test qui assert
une valeur de pénalité ou un placement compacté doit passer `earliest: True`**, et sa
non-trivialité doit être prouvée par ablation.

Config par défaut : pause fixe `{type:'fixed', from:'12:00', to:'14:00'}`, `timeoutSeconds: 10`, un
seul enseignant, `earliest: True` dès qu'un placement est asserté.

**Groupe A — le bug rapporté (doivent échouer avant le correctif).**

1. `test_cross_noon_enforced_straddling_lunch_no_collapse` — 2 enforced, 13:30–15:00 et 16:00, +
   cours normaux, `crossNoonGap`. Assert : `score == ` score de la même instance **sans** le flag, et
   **pas** `INFEASIBLE` dans les `neutralizedTasks`. C'est le bug de Frédéric.
2. `test_cross_noon_enforced_straddling_lunch_symmetric` — enforced 10:00–12:00 + enforced
   13:30–15:00 (le cas qui casse si on déplace `half_cut` à 12:00, §0.4). Même assert.
3. `test_cross_noon_enforced_straddler_with_task_group` — 1 seul enforced 13:30 + `taskGroup`
   `sequential` le liant à un cours d'après-midi (tout-ou-rien →
   [`scheduled[m] == scheduled[m0]`](../packages/scheduler-cpsat/cpsat_engine.py#L498) le rend
   indroppable). Assert : pas d'effondrement.
4. `test_cross_noon_enforced_straddler_no_eviction` — enforced 13:30 + 3 cours normaux. Assert :
   `score` identique avec et sans `crossNoonGap` (mesuré aujourd'hui : 3 vs 4).

**Groupe B — fidélité de la pause résiduelle (le correctif ne doit pas être « on désactive »).**

5. `test_cross_noon_shortened_break_not_charged` — enforced 13:30–15:00, cours du matin 10:00–12:00.
   Pause résiduelle 90 min, trou réel nul. Assert : **pénalité 0**.
6. `test_cross_noon_real_gap_still_charged` — même instance, cours du matin **8:00–10:00**. Trou réel
   120 min. Assert : la pénalité **reste strictement positive** (attendu 120). ⚠️ **Test central** :
   c'est lui qui distingue un vrai correctif d'une désactivation déguisée.
7. `test_cross_noon_enforced_covers_whole_lunch` — enforced 11:00–15:00 (pause résiduelle vide).
   Assert : pas d'effondrement, aucun terme de trou de midi, et `compact` traite la journée en bloc
   unique.

**Groupe C — `compactTeacherHalfDays` (§0.5).**

8. `test_compact_straddler_no_phantom_penalty` — matin 8:00–10:00 + 10:00–12:00, enforced 13:30–15:00.
   Assert : pénalité **0** (vaut 90 aujourd'hui).
9. `test_compact_straddler_afternoon_gap_charged` — enforced 13:30–15:00, salle de `N` disponible
   17:00–18:00 seulement. Trou réel 120 min. Assert : pénalité **120** (vaut 0 aujourd'hui).

**Groupe D — no-op / garde-fous.**

10. `test_lunch_none_unchanged` — `lunchBreak:{type:'none'}` + `compactTeacherHalfDays` : placement et
    `provenOptimal` **identiques à `master`** (le chemin `on_half` doit être strictement inerte).
11. `test_no_enforced_unchanged` — instance sans aucun enforced, `crossNoonGap` +
    `compactTeacherHalfDays` : identique à `master`. **Les 29 tests existants doivent rester verts
    sans modification** — c'est le vrai filet ici.
12. `test_groupless_course_cannot_collapse` — cours à `groups: []` pouvant se placer dans la pause +
    `crossNoonGap`. Assert : jamais `INFEASIBLE` (couvre le chemin non modélisé du §0.7 via le
    `max(0, …)`).

**Comment asserter une pénalité.** `solve()` ne l'expose pas. Deux voies, dans l'ordre de préférence :
(a) construire l'instance pour que la différence de pénalité force un **placement observable
distinct** (style maison, cf. tests `compact`/`balance` existants) ; (b) si impossible pour les tests
5/6/8/9, exposer la valeur — p. ex. un champ `debugPenalty` ajouté au dict résultat uniquement quand
`config.get("_debugPenalty")` est vrai. **Trancher au checkpoint §5, ne pas décider seul** : (b)
touche le contrat de sortie.

**Preuve de non-trivialité (obligatoire).** Vérifier par ablation que le groupe A échoue si on
restaure `on_half` dans le bloc Option D, et que le test 6 échoue si on remplace `p1 - p0` par
`lunch[1] - lunch[0]`. Rapporter les valeurs brutes des deux côtés.

## 4. Vérifications complémentaires

1. **Test unitaire direct de `_residual_break`** (fonction pure, pas besoin du solveur) : fenêtre
   vide, occupation totale, occupation partielle à gauche / à droite / au milieu, **fragmentation**
   (deux enforced laissant deux trous → le plus grand gagne), débordements hors fenêtre.
2. **`groups: []` est-il atteignable ?** Vérifier côté loader / UI / types (`CourseTaskData`) si un
   cours sans groupe peut exister en pratique. **Fait brut dans le STATUT**, pas de conclusion.
3. **Coût.** `on_side` remplace `on_half` à volume comparable (mêmes 3 booléens par cours/jour/côté) ;
   `_residual_break` est du Python pur. Surcoût attendu ~nul. Mesurer le temps de solve avant/après
   sur `test_stress.py` et le rapporter.

## 5. Séquencement & checkpoint

Branche dédiée `fix/cpsat-enforced-lunch-straddle` (**jamais master**).

1. §1.1 + §1.2 helper + occupation enforced, avec le test unitaire §4.1.
2. §1.3 `on_side`.
3. §1.5 `crossNoonGap` (le bug rapporté) + §1.4 `compact`.
4. **CHECKPOINT FEU VERT** → montrer à Frédéric le diff moteur avant d'écrire les tests : confirmer
   la définition de la pause résiduelle (plus grand intervalle libre), le rattachement du straddler,
   le comportement « pause vide → bloc unique », et trancher la question (a)/(b) du §3.
5. §3 tests (dont groupes A et B, + preuve d'ablation) + faits bruts dans le STATUT.
6. §1.6 passe 4 + §1.7 docstrings.
7. Validation sur le **vrai projet** (ré-export d'abord — les snapshots vieillissent) : reproduire le
   cas de Frédéric (enforced 13:30, pause 12:00–14:00), confirmer que la semaine se place, comparer
   placement et `provenOptimal` avec/sans les options douces.

## 6. STATUT (rempli par l'implémenteur au fil de l'eau)

- [x] §1.1/§1.2 `_residual_break` + `enf_busy` (+ test unitaire §4.1)
- [x] §1.3 `on_side`
- [x] §1.5 `crossNoonGap` — pause résiduelle + `max(0, …)`
- [x] §1.4 `compactTeacherHalfDays` — blocs résiduels / bloc unique
- [x] CHECKPOINT feu vert conception
- [x] §3 tests (groupes A/B/C/D) + preuve d'ablation
- [x] §1.6 passe 4 + §1.7 docstrings
- [x] §4.2 `groups: []` atteignable ? (fait brut)
- [x] §4.3 coût avant/après sur `test_stress.py`
- [x] validation vrai projet — testée et confirmée par Frédéric (2026-07-28)

*Faits bruts (valeurs de pénalité, scores, placements, temps de solve) — PAS de conclusion
« validé/corrigé » ici.*

### Déviation de conception vs. l'énoncé du §1.2

`enf_busy`/`residual()` sont construits à la portée FONCTION de `solve()` (juste après la boucle
principale de construction des cours, ~ligne 463), et non nichés dans le bloc
`if compact_half_days or minimize_days or balance_load or (cross_noon and lunch is not None):` comme
le suggérait le texte du §1.2. Raison : §1.6 (passe 4) appelle aussi `residual()`, et la passe 4 vit
en dehors de ce bloc (gardée par `minimize_rooms` seul) — les nicher dedans aurait provoqué un
`NameError` dès que `minimizeTeacherRoomChanges` est actif sans aucune des 4 autres douces. Présenté
et non contesté au checkpoint feu vert.

### Checkpoint feu vert — décision (a)/(b) du §3

Tranché avec Frédéric : **(a) placement observable**. Les tests des groupes B/C ne touchent pas au
contrat de sortie de `solve()` ; ils forcent une tension entre le tie-break `earliest` et la
minimisation de la pénalité douce (passe 2) et lisent le placement résultant.

### §3 — Preuve de non-trivialité (ablation, mesurée par rejeu contre `git show master:…`)

Toutes les instances des groupes A/B/C ont été rejouées contre le moteur PRÉ-correctif
(`cpsat_engine.py` de `master`, chargé dynamiquement) ET contre le moteur corrigé, pour vérifier
qu'elles distinguent effectivement les deux (pas de faux positif façon `PlanCrossNoonGap.md §8`).

**Groupe A (score AVANT → APRÈS, `crossNoonGap` seul) :**

| Test | baseline (sans flag) | AVANT (master) | APRÈS (corrigé) |
|---|---|---|---|
| `..._no_collapse` (2 enforced 13:30+16:00 + 2 normaux) | 4 | **0 INFEASIBLE** | 4 |
| `..._symmetric` (EA 10-12 + EB 13:30 straddler + EC enforced + 1 normal) | 4 | **0 INFEASIBLE** | 4 |
| `..._with_task_group` (enforced straddler + TD séquentiel) | 2 | **0 INFEASIBLE** | 2 |
| `..._no_eviction` (1 enforced straddler + 5 normaux, fenêtre 08h-17h) | 6 | **5 (éviction silencieuse)** | 6 |

Note sur `_symmetric` : une version à 2 cours seulement (EA 10:00-12:00 fini pile à l'heure de pause +
EB straddler + 2 normaux flexibles) ne reproduisait PAS le bug sous master — les cours normaux
pouvaient tous se caser sous le seuil scalaire `half_cut` sans jamais peupler le côté « après-midi »,
contournant la contrainte cassée par pur hasard d'instance. Le test retenu ajoute un 3ᵉ enforced
après-midi (`EC`, non-droppable) pour forcer la présence des deux côtés — c'est ce qui fait
effectivement tomber `master` en INFEASIBLE (vérifié).

**Groupes B/C (placement AVANT vs APRÈS, `earliest` force la tension) :**

| Test | AVANT (master) | APRÈS (corrigé) |
|---|---|---|
| `test5` pause écourtée (M 08-12, enforced 13:30) | M reste à 08:00 (aucune pression — `aft` vide sous l'ancien seuil) | M poussé à 10:00 (pause résiduelle 90 min reconnue suffisante) |
| `test6` vrai trou (central) | M reste lundi | M repoussé à mardi (trou réel 120 min correctement facturé) |
| `test8` compact sur-facturation | M1/M2 poussés en fin de créneau (09:00/10:30) — trou fantôme minimisé | M1/M2 restent au plus tôt (08:00/09:30), collés |
| `test9` compact sous-facturation | N reste lundi (`len(members)<2` → terme sauté) | N repoussé à mardi (trou réel 120 min facturé) |

**Ablation directe sur la formule (§3, demandée explicitement) — résultat surprenant, mesuré.**
Remplacer SEULEMENT `p1 - p0` par `lunch[1] - lunch[0]` (120 min, en gardant `on_side` intact) dans
un fichier moteur patché : `test6` reste VERT (M toujours repoussé à mardi). Raison mesurée : avec
`lunch` 12:00-14:00, `lunch_len`=120 > `p1-p0`=90 réel, donc la formule naïve charge un gap ENCORE
PLUS PETIT (90 au lieu de 120) sur lundi — mais 90 > 0 reste strictement pire que mardi (0), donc la
pression qualitative « bouger vers mardi » subsiste malgré la mauvaise magnitude. La substitution
isolée de la constante ne suffit PAS à casser ce test tant que la classification (`on_side` vs
`on_half`) reste correcte : c'est CETTE classification, pas la magnitude de la pause soustraite, qui
gouverne la décision qualitative jour lundi/mardi dans les constructions retenues. L'ablation qui
casse effectivement les groupes A/B/C est le rejeu contre le moteur `master` COMPLET (tableau
ci-dessus), qui restaure `on_half` ET `lunch_len` ensemble — c'est elle qui fait foi. La substitution
isolée demandée au §3 est un fait négatif rapporté tel quel, pas une conclusion dissimulée.

### §4.2 — `groups: []` atteignable ? (fait brut, investigation déléguée)

Oui, atteignable via des chemins UI/loader réels, pas seulement le système de types :
- `CourseTaskData.groups` (`packages/scheduler-common/src/types.ts:59`) est un `ResourceEntry[]`
  quelconque, aucune contrainte non-vide.
- `schedulerData.ts:125,156-163` : `groups: []` traverse sans erreur, `task.resources[GROUP]` reste
  vide ; `_findDependentTask` (ligne 205) traite `taskGroups.length > 0` comme un cas gardé attendu.
- Aucun schéma Zod ni validation runtime ne rejette `groups: []` (`scheduler-common`,
  `scheduler-core`, `scheduler-api` — `scheduleApi.ts::_buildPayload` transmet tel quel).
- Chemins concrets : import CSV avec cellule "groupes" vide
  (`parseCsvCourses.ts:75-79,90-101`, `filter(Boolean)` sur une liste vide) ; création manuelle de
  cours, `CourseCreateModal.tsx:52` défaut `groups:[]`, `canConfirm` (ligne 55) ne bloque pas dessus.
  Fixtures de test existantes (`weekSavesSlice.test.ts:30`, `courseId.test.ts`) l'exercent déjà.

Conclusion factuelle : le trou non modélisé du §0.7 (cours à cheval sans groupe) est un cas réel, pas
une hypothèse de type système. Neutralisé par le `max(0, …)` structurel — testé
(`test_groupless_course_cannot_collapse`), non modélisé explicitement (hors périmètre v1, comme acté).

### §4.3 — Coût avant/après (données réelles S48, `BUT MMI 2026-2027_2026-07-24_23-19.json`, 120 cours)

Mesuré par rejeu du moteur master vs corrigé sur la même instance réelle, `timeoutSeconds: 60`,
`lunchBreak` fixe 12:00-13:30 (S48 ne contient aucun enforced à cheval — `provenOptimal=True`,
120/120 placés dans tous les cas, donc ce test mesure le coût pur, pas un changement de résultat) :

| Config | AVANT (master) | APRÈS (corrigé) |
|---|---|---|
| aucune douce | 1.46 s | 1.56 s |
| `compactTeacherHalfDays` | 4.14 s | 4.12 s |
| `crossNoonGap` | 4.19 s | 3.54 s |
| `compactTeacherHalfDays` + `crossNoonGap` | 5.55 s | 4.81 s |

Surcoût nul à négligeable (écarts dans le bruit de mesure d'un run à l'autre, cf. suite existante).
`test_stress.py` (moteur corrigé, suite complète) : 6 passed, 8 skipped, 157 s — pas de mesure directe
équivalente sur `master` (`test_stress.py` n'a pas été rejoué intégralement contre l'ancien moteur,
seule la comparaison ciblée S48 ci-dessus l'a été, chargée dynamiquement depuis les deux versions).

### Suite de tests

56/56 verts (`test_solve.py`, dont les 36 préexistants **non modifiés** + 20 nouveaux : §4.1 `_residual_break`
×8, groupe A ×4, groupe B ×3, groupe C ×2, groupe D ×3). `test_stress.py` : 6 passed, 8 skipped
(données S38/S39 absentes localement pour certains sous-tests), 157 s.

### Validation vrai projet (§5.7)

Non reproductible dans l'environnement de la session : les exports locaux (S38/S39/S48) ne contiennent
aucun enforced à cheval sur la pause (cf. §4.3). **Testée et confirmée par Frédéric le 2026-07-28**
sur ses données réelles, sur le cas d'origine du rapport de bug.

---

## 7. Revue (Opus, 2026-07-28)

Vérifications conduites **indépendamment** des tests livrés, en rejouant les scripts de repro qui
avaient servi à établir le diagnostic du §0 (donc antérieurs à l'implémentation et non choisis par
l'implémenteur).

**Le bug rapporté est corrigé.** Les trois instances d'origine reviennent au score de référence :

| Instance de diagnostic (§0.1) | Avant | Après |
|---|---|---|
| 2 enforced 13:30 + 16:00, `crossNoonGap` | 0 INFEASIBLE | **4** (= baseline) |
| 1 enforced 13:30 + `taskGroup` séquentiel | 0 INFEASIBLE | **3** (= baseline) |
| 1 enforced 13:30 + 3 normaux (éviction) | 3 | **4** (= baseline) |

**Les quatre pénalités du §0.5 tombent aux valeurs exactes prédites au §0.6**, mesurées en
ré-instrumentant `sum(penalty_terms)` sur le moteur corrigé : sur-facturation `compact` 90 → **0** ;
sous-facturation `compact` 0 → **120** (exactement le trou réel 15:00→17:00) ; témoin inchangé à
**90** ; les deux options actives 90 → **0**. La prédiction arithmétique du plan est donc confirmée
numériquement, pas seulement qualitativement.

**Les 36 tests préexistants sont intacts** — vérifié au diff : une seule ligne retirée dans
`test_solve.py`, la ligne d'`import`. La non-régression est donc portée par des tests que
l'implémenteur n'a pas pu ajuster.

**Le fait négatif rapporté au §3 était exact, et le trou est refermé.** L'implémenteur signalait
honnêtement qu'aucun test ne cassait en substituant `lunch_len` à `p1 - p0`. Vérifié et expliqué :
`lunch_len > p1 - p0` ne fait que **sous-facturer** (le `max(0, …)` empêche tout passage au négatif),
donc la pression qualitative survit et les instances retenues ne discriminent pas. Mesuré directement
sur une instance sans degré de liberté (M cloué 08:00-10:00, enforced 13:30) : **correct = 120,
naïf = 90** — l'implémentation calcule bien la bonne quantité, mais rien ne la protégeait.
**Test ajouté en revue** : `test_cross_noon_uses_residual_length_not_lunch_length`, qui cale l'écart
pour que le correct facture 10 pendant que le naïf est clampé à 0 (préférence stricte d'un côté,
indifférence de l'autre). Discriminant vérifié **stable 5/5 des deux côtés** avant adoption, puis
ablation directe : le test passe au **ROUGE** (`assert 590 == 600`) quand on rétablit
`lunch[1] - lunch[0]`, et au vert sitôt le moteur restauré. Suite : **57/57**.

**Déviation §1.6 acceptée.** La passe 4 classe sur `offset <= p0` (début) là où le plan écrivait
`fin <= P0`. Les deux coïncident pour tout cours proprement d'un côté — et un `enforced` l'est
toujours vis-à-vis de la pause résiduelle de son propre enseignant, celle-ci étant par construction
libre de ses cours. Ils ne diffèrent que pour un straddler sans groupe, dans une passe de pur confort
où la règle de l'implémenteur a l'avantage d'être **totale** (la passe 4 doit affecter un côté à
chaque cours). Choix supérieur à l'énoncé du plan sur ce point.

**Déviation §1.2 acceptée** : remonter `enf_busy`/`residual()` à la portée de `solve()` est requis par
§1.6, la passe 4 vivant hors du bloc des préférences douces. L'énoncé du plan était fautif ici.

**Conclusion.** Correctif conforme au plan, cause racine traitée (classification par bornes réelles)
et non contournée, garde-fou structurel en place, aucune régression. Les deux déviations sont des
améliorations. Reste la seule case non cochée du §6 : la validation sur données réelles, qui demande
un ré-export contenant un enforced à cheval — hors de portée de cette session.
