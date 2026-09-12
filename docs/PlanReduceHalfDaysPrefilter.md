# Plan — Pré-filtrage des candidats de la passe 3 (`reduceTeacherHalfDays`)

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant. Objectif : réduire le coût
> de la **passe 3** (demi-journées sous-utilisées), identifiée comme la plus coûteuse de la séquence
> des préférences douces (consomme ~100 % de son budget, statut `FEASIBLE` plutôt qu'`OPTIMAL`).
> Principe : **retirer de l'objectif les termes dont on peut PROUVER qu'ils sont constants**, sans
> jamais geler une variable ni restreindre l'espace de recherche.

## 0. Décisions verrouillées (ne pas rouvrir)

- **Le filtre agit sur l'OBJECTIF, jamais sur les variables.** On retire des termes de la somme
  minimisée en passe 3 (`model.Minimize(sum(half_terms))`,
  [ligne 1018](../packages/scheduler-cpsat/cpsat_engine.py#L1018)). On ne fixe AUCUN `start[li]`, on
  ne restreint AUCUN choix de ressource alternative. Conséquence décisive : le moteur garde
  intégralement sa liberté d'échanger salles/groupes/créneaux d'un enseignant filtré si cela permet
  à un AUTRE enseignant de réduire ses demi-journées. C'est l'exigence explicite de Frédéric
  (2026-09-12) et le point qui distingue ce plan d'une décomposition par enseignant — approche
  écartée, voir ci-dessous.

- **Décomposition par enseignant ÉCARTÉE (ne pas y revenir).** Une première proposition (geler les
  `start[]` des enseignants sans demi-journée légère, façon LNS) a été invalidée par Frédéric puis
  confirmée fausse par l'analyse : le couplage réel passe par les **groupes** (classes), dont le
  planning est rempli par de nombreux enseignants différents. Vider la demi-journée de l'enseignant A
  exige typiquement de libérer un créneau du groupe, donc de bouger des cours d'enseignants B, C, D
  qui n'ont eux-mêmes aucune demi-journée légère. Toute approche qui gèle « les enseignants non
  concernés » gèle précisément les cours qu'il faudrait pouvoir déplacer.

- **Invariant de sûreté (LE critère d'acceptation d'un filtre).** Un terme `underused[T,d,h]` n'est
  retirable que si sa valeur est **constante sur tout l'espace faisable restant** de la passe 3.
  Retirer une constante de l'objectif ne change pas l'argmin — donc zéro perte de qualité. Tout
  critère qui ne prouve pas la constance est REFUSÉ, même s'il « marche » sur un échantillon.

- **Niveau « déplacement creux » ÉCARTÉ en v1 — unsound, contre-exemple explicite.** L'idée était :
  si la seule destination possible d'un bloc léger est une demi-journée VIDE du même enseignant, le
  déplacement ne fait que déplacer le problème (source −1, destination +1, net 0) → terme
  non-améliorable. **FAUX en présence de plusieurs blocs légers.** Soient A et B deux blocs légers du
  même enseignant, 120 min chacun, dont la seule destination commune est un bloc vide V. Pris
  isolément, chacun ne voit qu'une destination vide → classés « creux » tous les deux. Mais placer A
  ET B dans V donne 240 min > `HALF_DAY_UNDERUSED_THRESHOLD` → V n'est pas léger, A et B sont vidés :
  **gain réel de 2**, écarté à tort. Le critère viole l'invariant de sûreté. Ne PAS l'implémenter
  sans une extension qui raisonne sur les ensembles de blocs (hors périmètre de ce plan).

- **Niveau « disponibilité jointe » à REDÉFINIR avant usage — la version mesurée est unsound.** La
  mesure exploratoire du 2026-09-12 calculait les créneaux libres en retranchant l'occupation de la
  **solution courante** — ce qui suppose que rien d'autre ne bouge, exactement l'hypothèse invalidée
  ci-dessus. Seule une version en **relaxation** est sûre : ne considérer que les fenêtres de
  disponibilité DÉCLARÉES (`rwin`, [ligne 503](../packages/scheduler-cpsat/cpsat_engine.py#L503)),
  sans aucune occupation. Si aucun bloc ne peut accueillir le cours même en ignorant tous les autres
  cours, l'impossibilité est prouvée (ajouter des contraintes ne rend jamais faisable ce qui est déjà
  infaisable). Sa couverture réelle est **inconnue** et probablement bien plus faible que la version
  unsound — d'où l'étape de mesure §2 AVANT tout code moteur.

- **Chiffre à ne PAS reprendre.** La synthèse orale « ~92 % des candidats non-améliorables » reposait
  sur les deux critères unsound ci-dessus. Elle n'est pas exploitable comme justification. Le seul
  fait établi est le niveau 0 (ci-dessous), vérifié sur LAROCHE Julien.

- **Périmètre : moteur uniquement.** Aucun changement de contrat (`SchedulerConfig`), aucune option
  UI, aucun flag. Le filtre est une optimisation interne inconditionnelle de la passe 3, active dès
  que `reduceTeacherHalfDays` l'est. Rien à faire côté `scheduler-common` / `scheduler-api` /
  `scheduler-client`.

- **`provenOptimal` reste basé sur la passe 1**, inchangé (comme toutes les passes douces).

## 1. Les critères SÛRS retenus pour la v1 (niveau 0)

Tous statiques : calculables **avant la passe 1**, à partir des seules données de ressources et de
cours. Aucun ne dépend d'une solution.

Soit `T` un enseignant, `SEUIL = HALF_DAY_UNDERUSED_THRESHOLD` (=120,
[ligne 62](../packages/scheduler-cpsat/cpsat_engine.py#L62)), et `M_T = maxDailyMinutes` de `T`
(`max_daily`, construit [lignes 481-492](../packages/scheduler-cpsat/cpsat_engine.py#L481-L492) —
absent ⇒ pas de plafond ⇒ critère (b) inapplicable).

### Critère (a) — enseignant à cours unique
`T` n'a **qu'un seul cours** dans la semaine, de durée ≤ `SEUIL`.
→ Quel que soit le placement, `T` occupe exactement **un** bloc, et ce bloc est léger. Le terme vaut
1 identiquement. Constant.

### Critère (b) — plafond quotidien structurellement bas
`M_T ≤ SEUIL` **ET** la somme des **deux plus petites** durées de cours de `T` est `> M_T`.
→ `M_T ≤ SEUIL` garantit que tout bloc utilisé par `T` est léger (un bloc est inclus dans un jour,
donc sa charge est bornée par le plafond quotidien). La seconde condition garantit qu'aucune paire de
cours ne peut partager un jour — donc a fortiori un bloc. Le nombre de blocs utilisés est donc
exactement le nombre de cours placés de `T`, tous légers. Constant.
→ **C'est le cas LAROCHE Julien** : `maxDailyMinutes=120`, deux cours `R3.Crea.13` de 120 min
(`120+120=240 > 120`). Ses 2 demi-journées légères sont irréductibles, prouvable sans rien résoudre.

### Réserve à documenter (ne pas traiter comme un bug)
La constance est **conditionnelle au placement du cours** : un cours non placé donne 0 bloc, donc un
terme à 0. Comme `place_term >= best_placed`
([ligne 1010](../packages/scheduler-cpsat/cpsat_engine.py#L1010)) ne verrouille que le TOTAL et non
l'identité des cours placés, le solveur pouvait en théorie « gagner » sur l'objectif demi-journées en
dé-plaçant un tel cours au profit d'un autre. Retirer le terme supprime aussi cette incitation
perverse — **changement de comportement réel, dans le bon sens**, à mentionner dans le STATUT et non
à masquer.

## 2. ÉTAPE DÉCISIONNELLE — mesurer la couverture AVANT d'écrire le code moteur

> Cette étape existe parce que la justification chiffrée initiale s'est révélée non valide (§0).
> **Ne pas la sauter, ne pas enchaîner sur §3 sans le feu vert de Frédéric.**

Écrire un script **jetable** (scratchpad, PAS dans le repo) qui, sans modifier le moteur :

1. Reconstruit le `RawScheduleData` de plusieurs semaines réelles du projet
   `data/BUT MMI 2026-2027_*.json` — **S39 au minimum, plus 2 ou 3 autres semaines chargées**
   (la mesure du 2026-09-12 n'a porté que sur S39 ; une semaine ne fait pas une tendance).
   Un script de reconstruction existe déjà en scratchpad de la session du 2026-09-12
   (`measure_half_day_groups.py`, fonction `build_raw`) — le reprendre plutôt que le réécrire :
   il gère `preNeutralizedKeys`, `manualEnforcedMap`, `taskGroups`, `manualCourses`, la résolution
   `weeklyMaxDailyMinutes` et la résolution hebdo de `Default`.
2. Applique les critères (a) et (b) de §1 sur les données brutes.
3. Rapporte, par semaine : nombre total de blocs légers observés après la passe 2, et parmi eux
   combien sont filtrés par (a), par (b).
4. **En complément** : implémenter aussi la version SÛRE du critère « disponibilité jointe » (§0 :
   fenêtres déclarées `rwin` uniquement, aucune occupation) et mesurer sa couverture additionnelle.
   Si elle est significative, elle rejoint la v1 ; sinon elle est abandonnée.

**Critère d'arrêt à présenter à Frédéric :** si la couverture cumulée des critères sûrs reste
marginale (ordre de quelques pour cent des termes), le pré-filtrage ne vaut pas son coût
d'implémentation → **arrêter ce chantier** et basculer sur la piste déjà identifiée comme suite :
la reformulation de l'objectif (`half_used` = simple présence, 1 seul niveau de composition, au lieu
de `underused = used ∧ light` qui en empile 3). Cette piste attaque la cause structurelle (relaxation
LP faible) plutôt que le volume de candidats.

## 3. Implémentation moteur (SEULEMENT après feu vert §2)

Fichier unique : `packages/scheduler-cpsat/cpsat_engine.py`.

### 3.1 Rendre les termes identifiables
Aujourd'hui `half_terms.append(underused)`
([ligne 936](../packages/scheduler-cpsat/cpsat_engine.py#L936)) perd le contexte : impossible de
savoir à quel enseignant appartient un terme. Remplacer la liste plate par une liste de tuples
`(tid, d, bidx, underused)` — ou une liste parallèle. **Ne pas changer** la construction des
variables elles-mêmes ([lignes 897-936](../packages/scheduler-cpsat/cpsat_engine.py#L897-L936)),
seulement ce qui est accumulé.

### 3.2 Calculer l'ensemble des enseignants filtrés
Fonction pure, testable isolément, à placer près des helpers de haut de fichier :

```python
def _structurally_light_teachers(teacher_durations, max_daily, threshold):
    """Enseignants dont TOUTES les demi-journées légères sont constantes (cf. PlanReduceHalfDaysPrefilter §1).

    `teacher_durations` : tid -> [durées des cours de cet enseignant].
    Retourne l'ensemble des tid dont les termes `underused` sont retirables de l'objectif.
    """
```
Implémenter (a) et (b) exactement comme énoncés en §1. **Ne rien ajouter d'autre** : tout critère
supplémentaire doit d'abord passer l'invariant de sûreté §0.

### 3.3 Filtrer à l'usage, pas à la construction
En passe 3 ([lignes 1002-1025](../packages/scheduler-cpsat/cpsat_engine.py#L1002-L1025)) :
- construire `active_half_terms = [v for (tid, _, _, v) in half_terms if tid not in filtered]` ;
- `model.Minimize(sum(active_half_terms))` ;
- la garde d'activation de la passe (`if reduce_half_days and half_terms`,
  [ligne 1008](../packages/scheduler-cpsat/cpsat_engine.py#L1008)) doit tester
  `active_half_terms` : si le filtre vide tout, la passe n'a plus d'objet → **sauter la passe** et
  laisser son budget aux passes 4/5 (gain net supplémentaire).
- Tracer sur stderr, à côté de `_log_pass_timing` : nombre de termes filtrés / total, et la liste des
  enseignants filtrés. Diagnostic dev indispensable pour valider sur le vrai projet.

**Pourquoi filtrer à l'usage et non à la construction (v1) :** les variables `underused` restent
créées, donc un résidu de propagation subsiste. Les supprimer à la construction serait plus propre
mais impose de déplacer le bloc §3.1 hors de la grande section
`if compact_teacher_day or minimize_days or reduce_half_days:`
([ligne 744](../packages/scheduler-cpsat/cpsat_engine.py#L744)) qui construit aussi `teacher_lits`,
`day_used_by` et `penalty_terms` — restructuration à risque pour un gain second-ordre. **À évaluer en
v2 seulement si la mesure montre que le résidu pèse.**

## 4. Tests (`packages/scheduler-cpsat/test_solve.py`)

> Rappel de rôle (mémoire `feedback_executant_reports_facts_reviewer_concludes`) : l'implémenteur
> écrit les tests et des **faits bruts**. Il n'écrit jamais « validé / vérifié / corrigé » dans le
> STATUT — les conclusions sont tirées au retour par le relecteur.

Config de test : `maxSolutions:1`, `timeoutSeconds:10`, pause fixe `12:00-13:30`,
`num_search_workers=1` si un test compare des placements (mémoire
`feedback_cpsat_verification_nondeterminism` : jamais d'égalité exacte entre deux `solve()` en
multi-thread).

1. **`test_prefilter_single_course_teacher`** — un enseignant, 1 cours de 90 min. Le critère (a)
   s'applique : assert que `_structurally_light_teachers` le retourne.
2. **`test_prefilter_capped_teacher_is_filtered`** — réplique du cas LAROCHE : plafond 120, deux cours
   de 120. Assert critère (b) → filtré.
3. **`test_prefilter_capped_but_pairable_not_filtered`** — plafond 120, deux cours de 45 (45+45=90 ≤
   120 : ils PEUVENT partager un bloc). Assert **non filtré** — c'est le test qui casse si on oublie
   la condition « somme des deux plus petites > M_T ».
4. **`test_prefilter_no_cap_not_filtered`** — enseignant sans `maxDailyMinutes` et plusieurs cours :
   non filtré (aucun des deux critères ne s'applique).
5. **`test_prefilter_preserves_optimum`** — instance où un enseignant filtré partage une **salle
   alternative** avec un enseignant non filtré, construite pour que la seule amélioration possible
   passe par un changement de salle du filtré. Assert : le nombre de demi-journées légères de
   l'enseignant NON filtré est le même avec et sans filtre. **C'est le test de l'exigence de
   Frédéric** — il échoue si l'implémentation gèle quoi que ce soit au lieu de ne toucher qu'à
   l'objectif.
6. **`test_prefilter_all_filtered_skips_pass`** — instance où tous les enseignants sont filtrés :
   assert que la passe 3 est sautée (trace stderr) et que le résultat reste cohérent.

**Preuve de non-trivialité :** vérifier explicitement que (3) et (5) **échouent** si on retire la
condition correspondante. Rapporter le résultat de cette ablation dans le STATUT. Si un test reste
vert malgré l'ablation, c'est un faux positif — le signaler tel quel sans le « réparer » à l'aveugle
(précédent : le faux positif de `test_cross_noon_penalizes_split_day`, cf.
`docs/PlanCrossNoonGap.md` §8).

## 5. Validation sur le vrai projet (faits bruts uniquement)

Mémoire `feedback_validate_on_full_real_project` : **ré-exporter d'abord** (les snapshots
vieillissent), puis valider sur le projet complet, pas sur des payloads isolés.

À relever, avant / après, sur S39 **et au moins deux autres semaines chargées** :
- `WallTime / budget (%)` et statut de la passe 3 (`_log_pass_timing`) ;
- nombre de demi-journées légères dans le résultat final (l'objectif ne doit **pas** se dégrader) ;
- nombre de cours placés et `provenOptimal` (doivent être inchangés) ;
- budget effectivement libéré pour les passes 4 et 5.

Comparer les **grandeurs agrégées**, jamais l'égalité exacte des placements entre deux `solve()`
(non-déterminisme CP-SAT documenté, ~13 % de flakiness inter-runs).

## 6. Séquencement & checkpoints

Branche dédiée `feature/half-days-prefilter` (**jamais master**).

1. §2 mesure de couverture sur plusieurs semaines (script scratchpad, aucun code moteur).
2. **CHECKPOINT FEU VERT — présenter les chiffres à Frédéric.** S'ils sont marginaux : arrêter et
   basculer sur la reformulation `half_used` (piste 2, déjà actée comme suite).
3. §3 implémentation moteur.
4. **CHECKPOINT FEU VERT** — montrer le diff moteur avant d'écrire les tests.
5. §4 tests + ablations, faits bruts dans le STATUT.
6. §5 validation vrai projet par Frédéric.

## 7. STATUT — CHANTIER ABANDONNÉ au checkpoint §2 (2026-09-12)

**La mesure de couverture §2 a été faite ; elle ne justifie pas d'implémenter ce plan.**
Décision prise avec Frédéric : bascule sur la piste 2 (reformulation de l'objectif), voir
`PlanHalfDaysPresence.md`. Ce document est conservé pour ce qu'il ÉTABLIT (§0), pas comme
travail à faire.

- [x] §2 mesure de couverture — script jetable (scratchpad), moteur NON modifié, 5 semaines réelles
      du projet `BUT MMI 2026-2027` (S39, S41, S47, S48, S49).

      Couverture des critères SÛRS : **22 / 175 demi-journées légères = 13 %**
      | Semaine | légères | (a) cours unique | (b) plafond | (c) relaxation dispo |
      |---|---|---|---|---|
      | S48 | 37 | 4 | 0 | 0 |
      | S49 | 37 | 4 | 0 | 0 |
      | S47 | 38 | 4 | 0 | 0 |
      | S41 | 35 | 6 | 0 | 1 |
      | S39 | 28 | 1 | 2 | 0 |
      | **total** | **175** | **19** | **2** | **1** |

      Coût réel de la passe 3 mesuré en parallèle (moteur non modifié, `timeoutSeconds:180`,
      toutes passes actives) :
      - S39 : p1 `2.07s OPTIMAL` | p2 `6.87s OPTIMAL` | **p3 `153.08s / 153.05s (100%) FEASIBLE`**
        | p4 `8.99s / 8.97s (100%) FEASIBLE` | p5 `0.05s OPTIMAL`
      - S48 : p1 `2.84s OPTIMAL` | p2 `8.65s OPTIMAL` | **p3 `150.53s / 150.51s (100%) FEASIBLE`**
        | p4 `8.99s / 8.98s (100%) FEASIBLE` | p5 `0.07s OPTIMAL`

- [x] CHECKPOINT feu vert §2 → **NON franchi, chantier arrêté.** Motifs :
      1. 13 % de termes retirés ne réduisent pas un temps dont la cause est combinatoire — les 87 %
         restants engendrent le même espace de recherche.
      2. Le critère (c) ne rapporte 1 cas sur 175 : l'hypothèse « beaucoup de candidats sont
         prouvablement impossibles », socle de la synthèse initiale, est **réfutée**. Les fenêtres
         de disponibilité déclarées sont trop larges pour prouver quoi que ce soit en relaxation.
      3. La mesure de coût montre que la passe 3 étrangle AUSSI la passe 4 (9 s de budget résiduel,
         `FEASIBLE`) : le vrai levier est la convergence de la passe 3, pas le volume de candidats.
- [ ] ~~§3 implémentation moteur~~ — sans objet.
- [ ] ~~§4 tests~~ — sans objet.
- [ ] ~~§5 validation vrai projet~~ — sans objet.

### Ce que ce document garde de valable
- Le §0 (invariant de sûreté, décomposition par enseignant écartée, contre-exemple du « déplacement
  creux », version unsound de la disponibilité jointe) reste la référence : **ne pas re-proposer ces
  approches**.
- Les critères (a) et (b) du §1 sont corrects et implémentables en ~10 lignes si un jour un autre
  motif que la performance les justifie. Ils ne valent pas d'être implémentés pour la performance.
