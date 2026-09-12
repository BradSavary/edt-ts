# Plan — Passe 3 : objectif de PRÉSENCE au lieu de SOUS-UTILISATION (`reduceTeacherHalfDays`)

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant.
> **Branche dédiée `feature/half-days-presence` — JAMAIS master, JAMAIS une branche existante.**
> Objectif : faire converger la **passe 3**, qui consomme aujourd'hui 100 % de son budget sans jamais
> prouver son optimum, en remplaçant son objectif par un indicateur de **présence** de même forme que
> celui de la passe 2 (qui, elle, converge en ~7 s). Contient aussi la correction d'un **verrou
> manquant en passe 4**, trouvé en analysant ce code.

## 0. Décisions verrouillées (ne pas rouvrir)

### 0.1 Les mesures qui motivent le chantier
Projet réel `data/BUT MMI 2026-2027_*.json`, `timeoutSeconds:180`, toutes passes actives, moteur non
modifié (2026-09-12) :

| | passe 1 | passe 2 (jours) | **passe 3 (demi-j.)** | passe 4 (compacité) | passe 5 |
|---|---|---|---|---|---|
| S39 | 2,07 s `OPTIMAL` | 6,87 s `OPTIMAL` | **153,08 s / 153,05 s (100 %) `FEASIBLE`** | 8,99 s (100 %) `FEASIBLE` | 0,05 s `OPTIMAL` |
| S48 | 2,84 s `OPTIMAL` | 8,65 s `OPTIMAL` | **150,53 s / 150,51 s (100 %) `FEASIBLE`** | 8,99 s (100 %) `FEASIBLE` | 0,07 s `OPTIMAL` |

Deux faits à retenir : la passe 3 ne converge jamais, **et** elle étrangle la passe 4 (9 s de budget
résiduel, `FEASIBLE` elle aussi). Corriger la passe 3 bénéficie donc aussi à la compacité.

### 0.2 Le changement : `underused` → `half_used`
Aujourd'hui, par (enseignant, jour, bloc)
([lignes 926-936](../packages/scheduler-cpsat/cpsat_engine.py#L926-L936)) :
```
load     = Σ durée × présence            (IntVar + contrainte linéaire)
light    = (load <= SEUIL)               (BoolVar réifié sur une SOMME)
used     = OR(présences)                 (BoolVar)
underused = used ∧ light                 (BoolVar)      ← le terme minimisé
```
Trois niveaux de composition empilés, dont un seuil réifié sur une somme. Après le changement :
```
half_used = OR(présences)                (BoolVar)      ← le terme minimisé
```
Un seul niveau — **exactement la forme de `day_used`**
([lignes 891-893](../packages/scheduler-cpsat/cpsat_engine.py#L891-L893)), dont la passe 2 prouve son
optimum en ~7 s sur les mêmes instances. `load` et `light` disparaissent : c'est aussi un allègement
net du modèle (une IntVar + une contrainte linéaire + deux BoolVars réifiées en moins **par bloc**).

### 0.3 Changement de SÉMANTIQUE assumé
- Avant : « minimiser le nombre de demi-journées **sous-utilisées** (≤ 120 min) ».
- Après : « minimiser le nombre de demi-journées **utilisées** » = concentrer les cours d'un
  enseignant sur le moins de demi-journées possible. Même logique que `minimizeTeacherDays`, un cran
  plus fin.
- Conséquences : une demi-journée bien remplie devient elle aussi une cible de fusion (le solveur a
  intérêt à la fusionner si c'est possible — borné naturellement par la capacité physique d'un bloc,
  ~4 h) ; **la constante `HALF_DAY_UNDERUSED_THRESHOLD` disparaît**, avec son arbitraire.
- **Un utilisateur ayant coché l'option verra un comportement différent.** Assumé, à refléter dans
  le libellé UI (§4).

### 0.4 Ce qui NE change PAS (écarté explicitement)
- **Pas de fusion des passes 2 et 3.** Une somme unique `W·jours + demi-journées` exigerait un poids
  « gros-M » deviné, et des coefficients de magnitudes très différentes dans une même somme
  **dégradent** la relaxation au lieu de l'améliorer. Le verrouillage séquentiel actuel donne la même
  priorité stricte (optimisation lexicographique par contraintes), sans réglage à deviner. La passe 2
  coûte 7-9 s : il n'y a rien à gagner à la fusionner.
- **Pas de pré-filtrage des candidats.** Piste mesurée et abandonnée : 13 % de couverture pour les
  seuls critères sûrs. Voir `PlanReduceHalfDaysPrefilter.md` §7 — **ne pas la rouvrir**, et surtout
  ne pas ré-proposer les critères unsound qui y sont réfutés (décomposition par enseignant,
  « déplacement creux », disponibilité jointe calculée sur l'occupation courante).
- **Nom du flag inchangé** : `reduceTeacherHalfDays` reste le nom dans `SchedulerConfig`,
  `cpsat_runner.py` et le store. Type identique (`bool`) ⇒ **aucune migration de store nécessaire**.
- `provenOptimal` reste basé sur la passe 1.
- Le découpage matin/après-midi (`on_half` / `on_side` / `residual`) est **conservé tel quel** —
  unité unique partagée avec la passe 4, ne pas en ouvrir une seconde définition.

## 1. Cœur moteur — remplacer l'objectif de la passe 3

Fichier : `packages/scheduler-cpsat/cpsat_engine.py`, bloc
[897-936](../packages/scheduler-cpsat/cpsat_engine.py#L897-L936). Toute la partie qui construit les
`blocks` (choix `on_half` / `on_side` / `on_day` selon la pause résiduelle) est **conservée
inchangée**. Seule la fin change :

```python
                    for bidx, side in blocks:
                        present = []
                        for (li, lit) in lst:
                            if d not in possible_days[li]:
                                continue
                            p = model.NewBoolVar(f"hp{tid}_{li}_{d}_{bidx}")
                            oh = side(li)
                            model.AddBoolAnd([lit, oh]).OnlyEnforceIf(p)
                            model.AddBoolOr([lit.Not(), oh.Not()]).OnlyEnforceIf(p.Not())
                            present.append(p)
                        if not present:
                            continue
                        half_used = model.NewBoolVar(f"hused{tid}_{d}_{bidx}")
                        model.AddMaxEquality(half_used, present)   # OR réifié, cf. day_used
                        half_terms.append(half_used)
```

**Supprimer** : les variables `load`, `used`, `light`, `underused` et leurs contraintes, ainsi que la
constante `HALF_DAY_UNDERUSED_THRESHOLD`
([ligne 62](../packages/scheduler-cpsat/cpsat_engine.py#L62)) si plus aucune référence ne subsiste
(vérifier par grep — y compris `test_solve.py` et `test_stress.py`).

**Vigilances :**
- `AddMaxEquality` sur des BoolVars = OR réifié. C'est le motif déjà utilisé pour `day_used`
  ([ligne 892](../packages/scheduler-cpsat/cpsat_engine.py#L892)) — le copier, ne pas improviser.
- Cas `p1 <= p0` (pause entièrement mangée par un enforced) : `blocks` se réduit à un unique bloc
  `on_day(li, d)`, et `half_used` devient alors **identique à `day_used` de ce jour**. Redondant mais
  inoffensif (le verrou du nombre de jours est déjà posé en amont). Ne pas « corriger ».
- Le verrou des jours de la passe 3
  ([lignes 1011-1013](../packages/scheduler-cpsat/cpsat_engine.py#L1011-L1013)) reste
  **indispensable** : sans lui, étaler 2 blocs sur 2 jours au lieu d'un seul jour matin+après-midi a
  le même coût en demi-journées, et le solveur pourrait ajouter un jour. Ne pas le retirer.
- Nom de variable `hp…` au lieu de `hu…` pour les présences, afin de ne pas réutiliser un préfixe qui
  désignait autre chose dans l'ancienne formulation (confort de debug, sans effet fonctionnel).

## 2. Bug indépendant — verrou manquant en passe 4 (à corriger dans ce chantier)

**Constat.** Le commentaire de la passe 4 annonce « à placement ET passe-3 (demi-journées) FIGÉS »
([ligne 1026](../packages/scheduler-cpsat/cpsat_engine.py#L1026)), mais le code ne pose que
`place_term >= best_placed` ([ligne 1031](../packages/scheduler-cpsat/cpsat_engine.py#L1031)) —
**aucun verrou sur `half_terms`** (vérifié par grep : `half_terms` n'apparaît qu'aux lignes 743, 936,
972, 1008 et 1018). La passe 3 verrouille pourtant bien les jours en amont. La compacité peut donc
défaire librement le travail de la passe 3.

**Que le cas soit atteignable se démontre** (identité exacte, pas un pattern-matching) : un
enseignant, cours A 8 h-10 h, cours B. Pause fixe 12:00-13:30.
- B à 11 h-12 h → 1 bloc, idle intra-bloc 60 min, pénalité `60 × COMPACT_DAY_IDLE_WEIGHT(2) = 120`.
- B à 13 h 30-14 h 30 → 2 blocs, idle intra-bloc 0, trou de midi `810 − 600 − 90 = 120`, pénalité
  `120 × 1 = 120`.
Les deux pénalités sont **exactement égales** : la passe 4 est indifférente et peut choisir la
seconde, ajoutant une demi-journée que la passe 3 venait d'éliminer.

**Correction.** En passe 4, juste après `model.Add(place_term >= best_placed)` :
```python
        if reduce_half_days and half_terms:
            best_half = int(round(sum(solver.Value(v) for v in half_terms)))
            model.Add(sum(half_terms) <= best_half)
```
À poser **même si la passe 3 a été sautée faute de budget** : `solver` contient alors la solution de
la passe 2, et le verrou signifie simplement « ne pas empirer », ce que l'utilisateur qui a coché
l'option est en droit d'attendre.

**Attendu** : ce verrou peut ralentir la passe 4. C'est le prix de la correction — le mesurer (§6),
ne pas le contourner.

## 3. Docstring & commentaires

Mettre à jour, en cohérence avec §0.3 :
- l'entrée `reduceTeacherHalfDays` du docstring de `solve()`
  ([lignes 403-414](../packages/scheduler-cpsat/cpsat_engine.py#L403-L414)) — réécrire entièrement :
  plus de seuil, plus de « reporter pour vider », mais « minimiser le nombre de demi-journées de
  présence » ;
- l'en-tête de module ([lignes 29-32](../packages/scheduler-cpsat/cpsat_engine.py#L29-L32)) ;
- le commentaire d'introduction du bloc (§1) et celui de `half_terms`
  ([ligne 743](../packages/scheduler-cpsat/cpsat_engine.py#L743)) ;
- le commentaire de la passe 4 ([ligne 1026](../packages/scheduler-cpsat/cpsat_engine.py#L1026)),
  qui devient enfin exact une fois §2 appliqué.

## 4. UI — libellé et tooltip (`SchedulerConfigDialog.tsx`)

Le libellé actuel décrit précisément l'ancienne sémantique et devient **faux** :
[lignes 219-225](../packages/scheduler-client/components/planning/modals/SchedulerConfigDialog.tsx#L219-L225)
(« Réduire les demi-journées sous-utilisées… ne contient qu'un cours isolé (2h ou moins)… »).

Remplacer par, en substance :
- libellé : « Concentrer les cours d'un enseignant sur moins de demi-journées » ;
- tooltip : « Regroupe les cours d'un enseignant sur le moins de demi-journées de présence possible
  (matin / après-midi). N'ajoute jamais de jour et ne dégrade jamais le nombre de cours placés. »

**Aucune migration de store** (§0.4) : même clé, même type. Vérifier tout de même par grep qu'aucun
test client ne fige l'ancien libellé.

## 5. Tests (`packages/scheduler-cpsat/test_solve.py`)

> Rappel de rôle (mémoire `feedback_executant_reports_facts_reviewer_concludes`) : l'implémenteur
> écrit les tests et des **faits bruts**, jamais « validé / vérifié / corrigé » dans le STATUT. Les
> conclusions sont tirées au retour par le relecteur.

Config : pause fixe `12:00-13:30`, `timeoutSeconds:10`. Pour toute comparaison de placements, fixer
`num_search_workers=1` + `random_seed` (mémoire `feedback_cpsat_verification_nondeterminism` :
jamais d'égalité exacte entre deux `solve()` multi-thread).

1. **`test_half_days_merges_two_blocks`** — un enseignant, 2 cours de 90 min, fenêtre large, aucune
   contrainte de groupe/salle qui s'y oppose. Sans l'option : placement indifférent. Avec : les deux
   cours doivent finir dans la **même** demi-journée. Assert sur le nombre de blocs (jour, demi)
   distincts occupés = 1.
2. **`test_half_days_never_adds_a_day`** — instance où fusionner des demi-journées serait possible en
   ajoutant un jour. Assert : le nombre de jours de présence du résultat est ≤ celui obtenu avec
   `minimizeTeacherDays` seul. Protège le verrou des jours (§1, dernière vigilance).
3. **`test_half_days_off_is_noop`** — même instance sans le flag : comportement baseline, le bloc est
   bien inerte.
4. **`test_half_days_full_block_also_counts`** — le test qui distingue la NOUVELLE sémantique de
   l'ancienne : un enseignant dont toutes les demi-journées dépassent 120 min mais peuvent être
   fusionnées. L'ancienne formulation ne faisait rien (aucune n'était « sous-utilisée ») ; la
   nouvelle doit fusionner. **Ce test échoue sur le code d'avant le chantier** — c'est sa raison
   d'être.
5. **`test_compact_pass_does_not_undo_half_days`** — §2. Construire l'instance d'égalité démontrée
   au §2 (A 8 h-10 h ; B plaçable soit 11 h-12 h, soit 13 h 30-14 h 30, pénalités égales à 120).
   Assert : le résultat final garde **1** demi-journée. **Ablation obligatoire** : retirer le verrou
   `sum(half_terms) <= best_half` doit faire échouer ce test.
6. **`test_half_days_lunch_eaten_by_enforced`** — un enforced couvre toute la pause (`p1 <= p0`) :
   le bloc unique `on_day` est utilisé, le solve reste faisable, aucun crash. Cas limite du §1.

**Preuve de non-trivialité** : vérifier explicitement que (1) et (5) échouent quand on retire
respectivement `half_terms.append(half_used)` et le verrou du §2. **Rapporter le résultat de chaque
ablation, y compris celles qui NE cassent pas** — un test resté vert après ablation est un faux
positif, à signaler tel quel sans le « réparer » à l'aveugle (précédent documenté :
`PlanCrossNoonGap.md` §8).

## 6. Validation sur le vrai projet (faits bruts uniquement)

Mémoire `feedback_validate_on_full_real_project` : **ré-exporter d'abord** (les snapshots
vieillissent), puis valider sur le projet complet.

Relever, avant / après, sur **S39 et S48 au minimum** (les deux semaines déjà mesurées en §0.1, donc
directement comparables), `timeoutSeconds:180`, toutes passes actives :
- `WallTime / budget (%)` et **statut** de chaque passe — l'attendu principal est que la passe 3
  sorte en `OPTIMAL` bien avant son budget, et que la passe 4 récupère un budget décent ;
- nombre de demi-journées de présence par enseignant dans le résultat final ;
- nombre de cours placés et `provenOptimal` (doivent être **inchangés**) ;
- jugement qualitatif de Frédéric sur les emplois du temps produits — la nouvelle sémantique est plus
  agressive, c'est le point qui ne se mesure pas.

Comparer des **grandeurs agrégées**, jamais l'égalité exacte des placements entre deux `solve()`.

## 7. Séquencement & checkpoints

**Branche dédiée `feature/half-days-presence`, créée depuis `master` à jour. Jamais master
directement, jamais une branche d'un chantier précédent.**

1. §1 cœur moteur (remplacement de l'objectif) + §3 docstrings.
2. **CHECKPOINT FEU VERT** → montrer le diff moteur à Frédéric avant d'écrire les tests.
3. §2 verrou de la passe 4.
4. §5 tests + ablations, faits bruts dans le STATUT.
5. §4 UI (libellé + tooltip).
6. §6 validation vrai projet par Frédéric.

## 8. STATUT — §1/§3 REJETÉS après test utilisateur ; §2 livré ailleurs (2026-09-12)

**La reformulation `half_used` a été implémentée, mesurée, testée par Frédéric, puis ABANDONNÉE.**
Le moteur reste sur la formulation initiale `underused = used ∧ light` ; la branche d'essai a été
supprimée (rien d'unique à conserver — le §0.2 décrit le changement en entier, et il tient en une
vingtaine de lignes si quelqu'un devait le rejouer).

- [x] §1 cœur moteur + §3 docstrings — implémentés, 59/59 tests verts.
- [x] **Hypothèse de performance RÉFUTÉE par la mesure.** La passe 3 consomme toujours 100 % de son
      budget en `FEASIBLE` : S39 153,08 s → 152,34 s ; S48 150,53 s → 152,70 s. La forme de
      l'objectif (1 niveau de composition au lieu de 3) **n'explique donc pas** l'écart de
      convergence avec la passe 2. Le raisonnement du §0.2 est faux.
- [x] **Qualité non concluante en mesure** (budget 40 s, métrique commune) : S39 ancienne 60
      présences / 17 sous-utilisées contre nouvelle 59 / 15 ; S48 ancienne 77 / 29 contre nouvelle
      80 / 34. Chaque formulation gagne sur une semaine et perd sur l'autre, dans le bruit du
      non-déterminisme.
- [x] **Test utilisateur (Frédéric, sur le vrai projet) : « la reformulation est un peu moins
      qualitative »** → retour à la formulation initiale. C'est ce jugement, et non la mesure
      agrégée, qui a tranché — la mesure ne départageait pas.
- [ ] ~~§4 UI libellé/tooltip~~ — sans objet (sémantique inchangée, le libellé existant reste juste).
- [x] §2 verrou `half_terms` en passe 4 — **LIVRÉ** sur `feature/lock-half-days-pass4` (branche
      dédiée, sans l'arrêt sur plateau qui reste en suspens). Bug confirmé par la mesure sur le vrai
      projet : 2 runs sur 4 dégradent, jusqu'à **+5 demi-journées** (S48 : 28 à la fin de la passe 3,
      33 dans la solution finale). Intermittent (non-déterminisme) et invisible sans instrument,
      puisqu'il faut comparer l'état d'après-passe-3 à l'état final — ce que l'UI ne montre pas ;
      c'est pourquoi il n'avait jamais été repéré en usage.
      Test `test_compact_pass_does_not_undo_half_days` : instance où la dégradation est **forcée**
      (et non seulement permise, ce qui rend le test déterministe) — T1 dispo 08:00-09:00 /
      10:00-12:00 / 13:30-14:30, A=120 min ne tient que dans 10:00-12:00, B=60 min au choix le matin
      ou l'après-midi. Option matin : 1 bloc de 180 min, 0 sous-utilisée, mais pénalité 120. Option
      après-midi : 2 sous-utilisées, pénalité 0. La passe 4 préfère donc STRICTEMENT la mauvaise.
      **Ablation vérifiée** : verrou retiré, le test échoue sur `assert 2 == 0` ; verrou en place,
      60/60 passent.

### Ce que ce chantier a produit d'utile
1. **Le vrai levier, trouvé en cherchant autre chose** : le budget de la passe 3 au-delà de ~40 s est
   gaspillé (S39 : off=65 | 20 s=61 | 40 s=59 | 90 s=60 | 180 s=60). D'où l'arrêt anticipé sur
   plateau, livré sur `feature/pass3-early-stop`.
2. **Le bug du §2**, qui serait passé inaperçu sans cette relecture.
3. Une leçon de méthode : l'analyse structurelle (nombre de niveaux de composition, qualité de la
   relaxation) était plausible, cohérente avec la littérature… et fausse sur ce modèle. **Mesurer
   avant d'implémenter** aurait coûté un script et évité l'aller-retour ; la même erreur a déjà été
   faite au chantier précédent (`PlanReduceHalfDaysPrefilter.md` §7).
