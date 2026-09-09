# Plan LB-DFF — fonctions dual-réalisables : renforcer la borne racine SANS recherche

*Plan rédigé par Opus pour implémentation par Sonnet. Branche : **`feature/lb-dff`** (à créer depuis
`master` — ne PAS travailler sur `master`). Point **D** de [AuditBibliographiqueLB.md §3](AuditBibliographiqueLB.md).*

**Déroulé imposé (règle de Frédéric)** : Sonnet implémente §2 + §3 + §4 (code complet, typecheck
clean, suites existantes vertes), commit sur la branche, puis **S'ARRÊTE et demande le feu vert
avant d'écrire les tests (§5) et de lancer la validation réelle (§6)**.

**Règle de compte rendu (posée le 19/07/2026, à respecter à la lettre)** : Sonnet écrit les tests de
non-régression et **rapporte des faits bruts** (nombres, temps, sorties de commande). Il **n'écrit
aucune phrase de la forme « vérifié / validé / corrigé »** dans le STATUT. Les conclusions et
l'attribution des gains sont écrites au retour, par le relecteur (Opus, Fable ou Frédéric).
Motif : sur le plan précédent, six tests corrects ont été présentés comme validant une propriété
qu'aucun d'eux ne pouvait observer.

---

## 0. Ce qui change par rapport aux plans précédents — À LIRE EN PREMIER

`PlanLbSurrogateSymetrie` et `PlanLbCoutRacine` étaient des plans **à borne inchangée** : le critère
de succès était l'égalité stricte des `lb` contre les 10 semaines de référence.

**Ce plan-ci RENFORCE la borne.** Les `lb` attendues peuvent **augmenter**. Le critère de succès
change complètement (§6) et il n'y a plus de table de valeurs attendues à recopier. Ne pas
transposer le protocole de l'autre plan.

Le **principe de sûreté cardinal** reste identique et devient le seul garde-fou : toute borne
calculée ici doit **SURESTIMER** `MaxPack` (le nombre de tâches plaçables). Une borne trop petite
⟹ `lb` surestimée ⟹ **preuve d'optimalité fausse**. C'est le mode de défaillance interdit, et il
est ici plus facile à déclencher qu'avant, puisqu'on abaisse délibérément `ub`.

---

## 1. Le fond mathématique (à comprendre avant de coder)

### 1.1 Définition

Une fonction `f : [0,1] → [0,1]` est **dual-réalisable** (*dual-feasible function*, DFF) si :

> pour tout multi-ensemble fini `X` de réels de `[0,1]` tel que `Σ_{x∈X} x ≤ 1`, on a `Σ_{x∈X} f(x) ≤ 1`.

### 1.2 L'usage qu'on en fait

Soit un « bac » de capacité `C` et des items de durées `d_i`. Si un sous-ensemble `S` tient dans le
bac, alors `Σ_{i∈S} d_i ≤ C`, donc `Σ_{i∈S} (d_i/C) ≤ 1`, donc par définition de `f` :

> `Σ_{i∈S} f(d_i / C) ≤ 1`

D'où la borne sur la CARDINALITÉ, qui est ce qu'on veut :

> **`MaxPackDansLeBac(C) ≤ max{ k : somme des k plus PETITES valeurs f(d_i/C) ≤ 1 }`**

C'est exactement la forme du `ub` actuel ([rootLowerBound.ts:190-194](../packages/scheduler-core/src/rootLowerBound.ts#L190-L194)),
au détail près que le tri et l'accumulation se font sur les `f(d_i/C)` au lieu des `d_i`. Aucune
recherche, O(n log n).

**Toute DFF donne une borne valide ⟹ le MIN sur une famille de DFF est valide.** C'est ce qui rend
la technique payante : on en essaie plusieurs et on garde la meilleure.

### 1.3 La famille à implémenter

**(a) `f_id(x) = x`** — l'identité. Trivialement dual-réalisable. Elle **reproduit exactement le
`ub` actuel**. La garder dans la famille garantit par construction que la nouvelle borne n'est
**jamais pire** que l'ancienne. Ne pas la retirer « parce qu'elle n'apporte rien ».

**(b) `f_ε` pour `ε ∈ (0, 1/2]`** — la famille à seuil :

```
f_ε(x) = 1   si x > 1 - ε
       = x   si ε < x ≤ 1 - ε
       = 0   si x ≤ ε
```

**Preuve de dual-réalisabilité** (à recopier en commentaire dans le code — c'est elle qui autorise
l'élagage) : soit `X` avec `Σx ≤ 1`.
- *Cas 1 — un élément `x₀ > 1-ε`.* Il est unique : deux tels éléments sommeraient à plus de
  `2(1-ε) ≥ 1` puisque `ε ≤ 1/2`. Les autres somment à `≤ 1 - x₀ < ε`, donc chacun est `< ε`, donc
  chacun a `f = 0`. Total = `1`. ✓
- *Cas 2 — aucun élément `> 1-ε`.* Alors `f(x) ≤ x` pour tout `x` (par `f=0` en dessous de `ε`, par
  `f=x` au-dessus). Total `≤ Σx ≤ 1`. ✓ ∎

**Intuition du gain** : `f_ε` fait compter un item « gros » (`> (1-ε)·C`) pour un bac entier, et
annule les items « petits » (`≤ ε·C`). Elle capture l'obstruction que le volume brut rate
totalement : *deux gros items ne cohabitent pas*, quel que soit le volume restant.

**Valeurs de `ε` à essayer.** Seules les tailles réellement présentes constituent des points de
rupture. Prendre `E = { d_i/C : d_i/C ≤ 1/2 } ∪ { 1/2 }`, dédupliqué. `O(n)` candidats, chacun en
`O(n)` après un tri unique ⟹ `O(n²)` au pire, sur des `n ≤ ~130`. Si le coût mesuré gêne, brider à
un échantillon (les 8 plus grandes valeurs de `E`) — mais **mesurer avant de brider**, pas l'inverse.

### 1.4 Le point qui décide de tout le gain : appliquer la DFF PAR JOUR

Appliquée à la capacité **agrégée** de la semaine (`totalCap`, ligne 191), `f_ε` ne rapporte
**rien** : aucune tâche ne fait plus de la moitié d'une semaine, donc `f_ε ≡ f_id` sur tous les
items. Ce serait du code mort.

Le gain vient de l'application **par jour**, où les gros items existent vraiment (une tâche de 4 h
contre une journée de 7 h). Pour chaque jour `d` de capacité `C_d` :

- soit `A_d` = les items **éligibles à au moins une fenêtre du jour `d`** (l'information
  d'éligibilité que le `ub` actuel ignore complètement) ;
- les items effectivement placés le jour `d` forment un sous-ensemble de `A_d` tenant dans `C_d` ;
- donc `#placés(d) ≤ B_d := min_{f ∈ famille} max{ k : somme des k plus petites f(d_i/C_d), i ∈ A_d, ≤ 1 }`.

D'où, en sommant sur les jours :

> **`MaxPack ≤ min( n, ubCount_agrégé_actuel, Σ_d B_d )`**

Les trois termes sont des bornes duales valides ⟹ leur min l'est. Le terme `Σ_d B_d` est le nouveau,
et il est doublement plus fin que l'existant : il exploite l'éligibilité ET la structure par jour.

---

## 2. Le module DFF (fonctions pures, testables isolément)

Nouveau fichier **`packages/scheduler-core/src/dff.ts`**, exporté depuis `src/index.ts` uniquement
si un test en a besoin (sinon rester interne au package — pas d'élargissement d'API publique).

```ts
/** Borne duale sur le nombre d'items d'un multi-ensemble tenant dans une capacité `cap`,
 *  par fonctions dual-réalisables. SURESTIME toujours (sens sûr, cf. en-tête rootLowerBound). */
export function dffMaxCount(durations: number[], cap: number): number
```

Contrat, à respecter scrupuleusement :
- `cap <= 0` ⟹ retourne `0`.
- Un item de durée `> cap` ne peut pas être placé : l'exclure AVANT normalisation (sinon
  `d_i/cap > 1` sort du domaine de définition des DFF et toute la théorie tombe).
- Retourne `min` sur la famille `{f_id} ∪ {f_ε : ε ∈ E}` de `max{k : somme des k plus petites
  f-valeurs ≤ 1}`.
- Aucune allocation superflue dans les boucles chaudes ; `durations` n'est jamais muté (copier
  avant de trier).
- **Arithmétique** : normaliser en flottant introduit un risque d'arrondi qui peut faire passer une
  somme de `1.0000000001` pour `> 1` et donc SOUS-estimer la borne (sens sûr) ou l'inverse (sens
  DANGEREUX) selon le sens de l'erreur. Travailler en **entiers** : plutôt que `f(d/C) ≤ 1`,
  raisonner sur `f` à valeurs dans `{0, d, C}` et comparer des sommes d'entiers à `C`. Écrire les
  comparaisons de sorte qu'une égalité exacte compte comme « tient » (`≤`, jamais `<`).

Note d'implémentation pour `f_ε` en entiers : avec `ε` exprimé comme un seuil entier `E = ε·C`,
`f_ε(d) = C` si `d > C - E`, `= d` si `E < d ≤ C - E`, `= 0` si `d ≤ E`. La condition
`Σ f_ε ≤ C` est alors une comparaison d'entiers exacte, sans flottant.

---

## 3. Branchement dans le mono

Dans `maxPackMono` ([rootLowerBound.ts:183](../packages/scheduler-core/src/rootLowerBound.ts#L183)) :

1. Construire, hors DFS, les ensembles `A_d` par jour depuis `winsIn[w].day` et la matrice `elig`
   (un item est dans `A_d` s'il est éligible à au moins une fenêtre de jour `d`).
2. `const dayBoundSum = Σ_d dffMaxCount(durées des items de A_d, dayCaps.get(d))`.
3. `const ub = Math.min(n, ubCount, dayBoundSum);`

⚠️ **Ne PAS toucher au reste.** `ub` alimente deux chemins et les deux doivent rester corrects :
- la sortie anticipée `if (best >= ub) return` (ligne 234) — reste valide : `best ≤ MaxPack ≤ ub`,
  donc `best ≥ ub` implique `best = MaxPack` ;
- le **repli sur troncature** `return exact ? best : Math.min(ub, n)` (dernière ligne de la
  fonction) — c'est LUI qui bénéficie le plus : un `ub` plus petit rend le repli moins pessimiste.

Ne pas confondre avec la borne surrogate de nœud du §1.3 de `PlanLbSurrogateSymetrie` (variable
`cap`/`lo` dans le DFS) : elle reste telle quelle, ce plan ne la touche pas.

---

## 4. Branchement dans le cluster — le vrai gain fonctionnel

Constat, [rootLowerBound.ts:637-640](../packages/scheduler-core/src/rootLowerBound.ts#L637-L640) :

```
// Dépassement de nœuds : cluster abandonné (aucune borne — côté sûr), pas de repli
// comptage ici (les caps sont réparties sur plusieurs ressources par jour, une borne de
// comptage globale n'est pas immédiate à établir en restant sûre).
if (!exact) continue;
```

**Un cluster tronqué ne produit AUCUN certificat aujourd'hui.** La DFF fournit précisément la borne
de comptage que ce commentaire dit ne pas savoir établir. C'est l'apport le plus concret de ce plan.

Borne à ajouter, calculée hors DFS (donc disponible même si le DFS est tronqué) : pour chaque
ressource `r` du cluster (index `ri`), les items consommant `r` sont contraints par `r`, les autres
ne le sont pas :

> `ubCluster = min_{ri} ( Σ_{d=0..4} dffMaxCount(durées des items consommant r ET éligibles au jour d, capsArr[ri*5+d]) + #items ne consommant PAS r )`

Puis `Math.min(ubCluster, S.length)`. Valide : chaque terme est une borne duale sur `MaxPack` pour
le cluster, leur min l'est aussi. Réutiliser `itemResIdx`, `eligDay` et `capsArr`, déjà construits.

Remplacer alors le `continue` par l'émission d'un certificat de repli :

```ts
const packUb = exact ? best : Math.min(ubCluster, S.length);
const lb = S.length - packUb;
```

⚠️ **Ne JAMAIS émettre `S.length - best` quand `exact === false`** : `best` est le meilleur packing
*partiel trouvé*, il SOUS-estime `MaxPack`, donc SURESTIME `lb` ⟹ preuve fausse. C'est le piège
exact que le `continue` actuel évitait ; le repli DFF est ce qui permet de le retirer sans danger.
Le commentaire des lignes 637-639 doit être réécrit en conséquence, pas supprimé.

---

## 5. Tests (APRÈS feu vert)

Cible : `packages/scheduler-core/__tests__/` (131 tests actuels, tous doivent rester verts **sauf
ceux dont la `lb` attendue augmente légitimement** — voir le point 5 ci-dessous, qui est un
résultat à RAPPORTER, pas à « ajuster jusqu'à ce que ça passe »).

1. **Dual-réalisabilité par force brute — LE test qui compte.** Nouveau fichier `dff.test.ts`.
   Pour chaque `f` de la famille et pour un grand nombre de multi-ensembles tirés au hasard
   vérifiant `Σx ≤ 1`, asserter `Σf(x) ≤ 1`. Compléter par une énumération EXHAUSTIVE sur une
   grille fine (tailles multiples de `1/12`, jusqu'à 12 items, tous les multi-ensembles de somme
   `≤ 1`). Générateur à graine FIXE (reproductible). C'est le seul test capable de falsifier la
   thèse du §1.3 ; si `f_ε` est mal implémentée, il tombe ici et nulle part ailleurs.
2. **`dffMaxCount` ne sous-estime jamais.** Sur des instances petites (≤ 10 items), comparer à un
   `MaxPack` calculé par force brute exacte (énumération de tous les sous-ensembles) : asserter
   `dffMaxCount ≥ bruteForce`. Toute violation est un bug de sûreté.
3. **Cas où la DFF mord.** Une instance mono où `Σ_d B_d < ubCount` (typiquement : 3 tâches de 4 h,
   une journée de 7 h ⟹ le volume dit 1 mais dit surtout que le jour ne porte qu'une tâche),
   `lb` connue à la main.
4. **Certificat de repli cluster (§4) — test de MÉCANISME.** Instance cluster forçant la troncature
   via `clusterNodeLimit` très bas : asserter qu'un certificat est maintenant émis (`certificates`
   non vide) là où l'ancien code n'en émettait aucun, ET que la `lb` obtenue reste `≤` l'optimum
   réel calculé à la main sur cette instance. C'est le pendant du test qui manquait au plan
   précédent : il observe le mécanisme, pas seulement une valeur.
5. **Micro-tests existants.** Les faire tourner et **rapporter la liste exacte de ceux dont la `lb`
   attendue change**, avec l'ancienne et la nouvelle valeur, SANS les modifier d'autorité. Chaque
   changement doit être justifié comme un renforcement légitime (nouvelle `lb` ≤ optimum réel de
   l'instance, vérifiable à la main sur ces micro-instances) — sinon c'est un bug.

---

## 6. Validation réelle (APRÈS feu vert, en UN batch) — protocole NOUVEAU

Re-exporter le projet réel d'abord (les snapshots vieillissent). Export de référence actuel :
`packages/scheduler-core/data/Planification MMI_2026-07-16_10-13.json`. Config Frédéric :
`maxSolutions:1, maxEliminations:3, timeoutSeconds:10, maxIterations:1M, conflictOrderingSearch:true,
conflictSetExact:false, ignoreDailyLimits:false`, pause flottante 90 min 12:00–14:00.

Le harnais du §4 de `PlanLbSurrogateSymetrie` a été supprimé après usage ; il est à reconstruire :
pipeline client complet (`getCoursesForWeek` + `preNeutralizedKeys` + `manualEnforcedMap` +
`taskGroups`/`buildTaskGroupData` + `filterResourcesForCourses` + zones de vacances +
résolution week-aware de la clé `Default` des contraintes, réplique de `_buildPayload`). Le plus
simple est un test jetable dans `packages/scheduler-client/__tests__/` (les alias `@/` y résolvent),
supprimé après lecture. Semaines : **S3, S9, S36, S37, S38, S39, S40, S45, S48, S49**. **Un seul
batch en arrière-plan, une seule lecture des résultats à la fin.**

Deux critères, de natures opposées — ne pas les confondre :

**(A) Non-régression — `lb_new ≥ lb_old` sur les 10 semaines.** `lb_old` = `7, 7, 6, 3, 0, 0, 1, 0,
5, 4` (S3…S49). La famille contenant `f_id`, une baisse est impossible par construction : toute
baisse observée est un **bug d'implémentation**, pas un arbitrage.

**(B) Sûreté — `lb_new ≤ U_semaine`, où `U_semaine` est le nombre de tâches sautées par la
meilleure solution connue du moteur.** C'est LE garde-fou de ce plan. `lb` borne l'optimum `OPT`
par en dessous, et toute solution réalisable donne `OPT ≤ U` : donc `lb ≤ OPT ≤ U`.
**`lb_new > U` pour une semaine ⟹ STOP IMMÉDIAT, preuve fausse.**
Valeurs déjà connues (`PlanLbCoutRacine §5`) : S37 `U=3`, S38 `U=0`, S39 `U=0`, S40 `U=2`. Pour les
six autres semaines, `U` est à obtenir en faisant tourner le moteur complet sur la semaine — à
inclure dans le même batch.

Rapporter, par semaine : `lb_old`, `lb_new`, `U`, le nombre de certificats, le temps. Rapporter
aussi **combien de clusters auparavant abandonnés (§4) produisent désormais un certificat** : c'est
la mesure qui attribue le gain à §4 plutôt qu'à §3.

Le coût doit rester sous les budgets actuels (`deadlineMs` 2000 par défaut). La DFF étant sans
recherche, une hausse de temps significative signalerait une erreur d'implémentation (typiquement
`O(n²)` recalculé dans une boucle chaude au lieu d'une fois hors DFS).

---

## 7. Périmètre explicitement EXCLU

- Le point **C** de l'audit (structure d'intervalles côté cluster / raisonnement énergétique) :
  chantier séparé, bien plus gros. Ne pas commencer à raffiner les capacités cluster ici.
- Les points **E** (bin completion) et **F** (arc-flow) : en réserve, cf. audit.
- Le modèle de relaxation existant : `floatingLunchDeduction`, raffinement union-des-domaines,
  matrice d'éligibilité, `computeTaskDomain`, `maxDailyMinutes`. On AJOUTE une borne, on n'en
  modifie aucune.
- La borne surrogate de nœud et le marquage de symétrie livrés par `PlanLbSurrogateSymetrie` :
  ils restent tels quels.
- `§2.2` (clé mono canonique) et `§2.4` (bornage de la table de transposition) de ce même plan
  précédent : fermés, mesures à l'appui. Ne pas les rouvrir.

---

## 8. Definition of done

- [ ] `dff.ts` implémenté, avec les preuves du §1.3 en commentaire.
- [ ] Branché dans le mono (§3) et dans le cluster (§4), y compris l'émission du certificat de
      repli sur troncature.
- [ ] Typecheck monorepo propre, suite `scheduler-core` verte (hors changements de `lb` légitimes,
      listés et justifiés un par un).
- [ ] Tests §5 écrits, dont la force brute de dual-réalisabilité et le test de mécanisme du §4.
- [ ] §6 lancé en un batch, résultats bruts rapportés en tableau (`lb_old` / `lb_new` / `U` / temps
      / clusters récupérés).
- [ ] STATUT ajouté en tête de ce fichier : **faits bruts uniquement**, aucune phrase de conclusion
      (cf. règle en tête de plan).
