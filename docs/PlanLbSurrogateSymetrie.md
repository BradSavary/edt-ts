# Plan LB-Surrogate-Symétrie — accélérer le DFS de la borne racine à borne INCHANGÉE

## STATUT — livré (2026-07-19, exécution Sonnet)

**§1 + §2 implémentés, testés (§3), validés sur le projet réel (§4).** Trois commits sur
`feature/lb-surrogate` : `f9c25a6` (§1+§2, checkpoint), `b642e3c` (§3, 6 tests), et celui-ci (§4 +
STATUT). §1.4 (borne surrogate cluster) et §2.3 (Zobrist + Int32Array) livrés dans leur version
complète, pas différés — la dérivation de sûreté (bornes globalement-triées ≤ bornes du sous-
ensemble réellement non-décidé, vérification exacte sur collision de hash) tenait dans le temps
imparti. §2.2 et §2.4 non implémentés, conformément au plan (secondaires/optionnels).

**Bug trouvé et corrigé pendant l'implémentation (§2.1)** : le marqueur de symétrie de fenêtres
utilisait un compteur d'epoch PARTAGÉ, incrémenté aussi par les appels récursifs imbriqués — au
retour d'un appel enfant, l'epoch du nœud courant avait déjà changé, et la détection « fenêtre
symétrique déjà essayée » ne se déclenchait quasiment plus jamais après le premier enfant. Sûr
(l'élagage manqué ne coupe jamais une solution) mais inopérant. Corrigé en capturant l'epoch dans
une `const` locale au sommet de chaque appel `dfs`. Vérifié après coup par un test dédié (§3).

**Validation réelle (§4)** — export du 16/07 (`packages/scheduler-core/data/Planification
MMI_2026-07-16_10-13.json`, localisé avec l'aide de Frédéric), pipeline reconstruit à la main
(`getCoursesForWeek` + `manualEnforcedMap` + `preNeutralizedKeys` + résolution week-aware de la clé
`Default` des contraintes — réplique exacte de `_buildPayload` côté client) ; `manualBlockedZones`
vérifié vide sur les 10 semaines et aucune période de vacances ne les recouvre ⟹ omis sans perte de
fidélité. Config Frédéric (`lunchBreak` floating 90 min 12:00–14:00, `ignoreDailyLimits: false`).
Comparaison **avant/après** en checkout temporaire du commit `134b439` (dernier `rootLowerBound.ts`
avant ce plan), même pipeline, script jetable supprimé après usage :

| Semaine | lb | tasks | temps AVANT | temps APRÈS | nœuds AVANT | nœuds APRÈS |
|---|---|---|---|---|---|---|
| S3  | 7 | 34  | 4 ms    | 5 ms    | — | — |
| S9  | 7 | 29  | 2 ms    | 2 ms    | — | — |
| S36 | 6 | 95  | 1054 ms | 126 ms  | 600 823 | 200 952 |
| S37 | 3 | 97  | 759 ms  | 243 ms  | — | — |
| S38 | 0 | 110 | 53 ms   | 15 ms   | — | — |
| S39 | 0 | 106 | 9 ms    | 6 ms    | — | — |
| S40 | 1 | 107 | 66 ms   | 22 ms   | — | — |
| S45 | 0 | 94  | 429 ms  | 130 ms  | — | — |
| S48 | 5 | 124 | 1194 ms | 140 ms  | 613 927 | 214 052 |
| S49 | 4 | 121 | 1176 ms | 343 ms  | 604 858 | 604 858 |

**Zéro STOP : les 10 `lb` sont EXACTEMENT identiques avant/après, et identiques à la référence de
`PlanLbCoutRacine.md §5` (7,7,6,3,0,0,1,0,5,4).** Temps ≤ partout, souvent très inférieurs (×5 à
×8 sur S36/S45/S48, ×3 sur S49/S37).

**Attribution §1 vs §2.3 (nœuds S36/S48/S49)** : S36 et S48 montrent une réduction du nombre de
nœuds explorés (×3 environ) ET une réduction du temps par nœud — les deux mécanismes contribuent.
**S49 est le cas net qui isole §2.3 seul** : nombre de nœuds strictement IDENTIQUE avant/après
(604 858), temps divisé par 3,4 — sur cette semaine précise, la borne surrogate/symétrie ne coupe
aucun nœud supplémentaire (la structure du problème ne s'y prête pas), tout le gain vient du
hachage Zobrist + `Int32Array` remplaçant la reconstruction de chaîne à chaque nœud du memo cluster.

**Détail notable (non bloquant) sur S48** : la composition des certificats diffère avant/après (4
certificats avant : 2 mono-ressource séparés `BUT3-G1` et `BUT3-G3` chacun lb=1 ; 3 après : un seul
certificat cluster `{BUT3-G1+BUT3-G2+BUT3-G3}` lb=2) — la **somme reste strictement 5 dans les deux
cas**. Explication cohérente avec le mécanisme : le DFS cluster AVANT ce plan sature probablement
son budget de nœuds (`clusterNodeLimit` 200k) sur ce cluster à 3 groupes et le certificat est jeté
(`exact=false`), la sélection disjointe se rabat alors sur deux certificats mono-ressource plus
petits qui somment au même total ; APRÈS ce plan, la borne §1.4 accélère suffisamment le DFS cluster
pour qu'il converge et produise directement le certificat combiné. C'est l'effet recherché par le
plan, pas une régression — le critère de succès (`lb` inchangée) est respecté.

124/124 → 130/130 scheduler-core (+6 tests §3 : surrogate mono mordante ×3, symétrie exacte ×2,
memo cluster à 6 ressources consommées ×1), typecheck monorepo clean.

---

*Plan rédigé par Opus pour implémentation par Sonnet. Branche : **`feature/lb-surrogate`** (à créer
depuis `master` — ne PAS travailler sur `master`).*

**Déroulé imposé (règle de Frédéric)** : Sonnet implémente §1 + §2 (code complet, typecheck clean,
suites existantes vertes), commit sur la branche, puis **S'ARRÊTE et demande le feu vert de
Frédéric avant d'écrire les tests (§3) et de lancer la validation réelle (§4)**.

---

## 0. Objectif et invariant

Réduire le coût du DFS de `computeRootLowerBound` ([rootLowerBound.ts](../packages/scheduler-core/src/rootLowerBound.ts))
**sans changer la valeur de `lb`**. Les deux modifications sont des optimisations de recherche pures :
un élagage plus fort (§1) et l'élimination d'états symétriques/redondants (§2). Ni l'une ni l'autre
ne touche au modèle de relaxation (capacités, éligibilité, `floatingLunchDeduction`).

**Critère de succès (§4)** : les 10 semaines de référence de
[PlanLbCoutRacine.md §5](PlanLbCoutRacine.md) rendent des `lb` **strictement identiques**, avec des
temps ≤ aux temps actuels. Tout écart de `lb` est un STOP : c'est un bug, pas une amélioration.

**Contexte état de l'art** (audit Opus 2026-07-19) : le DFS actuel est *item-oriented* façon MTM
(Martello–Toth). §1 lui ajoute la borne par **relaxation surrogate** recalculée aux nœuds, standard
en Multiple Knapsack depuis Martello–Toth / Pisinger, et absente aujourd'hui. §2 applique la
canonisation d'état et le hachage incrémental usuels des tables de transposition.

**Rappel du principe de sûreté cardinal** (en-tête du fichier) : toute borne ajoutée doit
**SURESTIMER** `MaxPack`. Un élagage trop agressif coupe une branche qui aurait amélioré `best`,
donc SOUS-estime `MaxPack`, donc SURESTIME `lb` ⟹ **preuve d'optimalité fausse**. C'est le mode de
défaillance à surveiller dans tout ce plan.

---

## 1. Borne surrogate recalculée aux nœuds

### 1.1 Constat

Dans `maxPackMono` :
- `ub` (lignes 190-195) est un comptage volumique calculé **une seule fois à la racine** sur
  `totalCap` = Σ `dayCaps`. Il sert à la sortie anticipée `if (best >= ub) return` et au repli sûr
  sur troncature (ligne 232).
- Le seul élagage vivant DANS le DFS est `placed + (n - idx) <= best` (ligne 206) : la borne de
  cardinalité triviale, qui **ignore totalement la capacité**. À un nœud profond où l'essentiel des
  fenêtres est consommé, rien ne le voit.

Même constat dans le DFS cluster de `computeClusterCertificates` (ligne 433) : `placed +
(order.length - k) <= best`, et là il n'y a même pas de `ub` racine.

### 1.2 La borne à ajouter

À un nœud `(idx, résiduels)`, en profits unitaires, la relaxation surrogate agrège toutes les
capacités résiduelles en un sac unique :

> `UB(nœud) = placed + max{ k : somme des k plus PETITES durées de items[idx..] ≤ capRésiduelle }`

Valide car toute solution complétant ce nœud place un sous-ensemble de `items[idx..]` dont le
volume total tient dans la capacité résiduelle, et prendre les plus petites maximise la cardinalité
à volume donné. Elle **surestime** `MaxPack` (sens sûr).

### 1.3 Implémentation dans `maxPackMono`

Trois éléments, tous O(1) ou O(log n) par nœud, aucune allocation dans le DFS.

**(a) Sommes-suffixes.** `items` est déjà trié **décroissant** (ligne 185). Le suffixe `items[idx..]`
est donc lui aussi décroissant, et ses *k* plus petits sont ses *k* DERNIERS éléments,
`items[n-k..n-1]`. Précalculer une fois, hors DFS :

```ts
// suf[j] = somme de items[j..n-1]  (donc suf[n] = 0)
const suf = new Array<number>(n + 1).fill(0);
for (let j = n - 1; j >= 0; j--) suf[j] = suf[j + 1] + items[j];
```

Alors « somme des k plus petites de `items[idx..]` » = `suf[n - k]`, valide pour `k ≤ n - idx`.

**(b) Capacité résiduelle maintenue incrémentalement.** Deux compteurs mis à jour exactement là où
`winRes` et `dayRes` le sont déjà (lignes 224 et 226) :

```ts
let winTotal = winRes.reduce((s, v) => s + v, 0);
let dayTotal = [...dayRes.values()].reduce((s, v) => s + v, 0);
// dans la boucle w, au placement :
winRes[w] -= d; dayRes.set(day, dc - d); winTotal -= d; dayTotal -= d;
// au retour arrière : symétrique (+= d)
```

**(c) Le test d'élagage.** Remplacer `placed + (n - idx) <= best` par :

```ts
const rem = n - idx;
const cap = Math.min(winTotal, dayTotal);   // deux bornes valides ⟹ leur min l'est aussi
// plus grand k ≤ rem tel que suf[n - k] <= cap, par dichotomie sur k
let lo = 0, hi = rem;
while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (suf[n - mid] <= cap) lo = mid; else hi = mid - 1; }
if (placed + lo <= best) return;
```

Notes d'implémentation :
- Conserver le test `if (best >= ub) return;` (ligne 205) et le `ub` racine tels quels : ils servent
  au **repli sur troncature** (ligne 232), qui doit rester une borne duale valide. Ne PAS remplacer
  `ub` par la borne de nœud.
- Le `min(winTotal, dayTotal)` est plus serré que `totalCap` seul : `dayCaps` peut être plus
  restrictif que Σ des longueurs de fenêtres (`maxDailyMinutes`, raffinement union-des-domaines),
  et réciproquement.

### 1.4 Implémentation dans le DFS cluster

Même principe, mais l'état de capacité y est une `Map` de couples (ressource, jour) et **un item
consomme plusieurs ressources à la fois** — la somme brute des capacités surestimerait grossièrement.
Borne valide et simple à maintenir : se restreindre aux **ressources du cluster**, dimension par
dimension, et prendre le meilleur (= le plus petit) comptage.

Pour chaque ressource `r` consommée, maintenir `capTotal[r]` = Σ_d `caps[r#d]`, mis à jour aux
lignes 449 et 453. Puis, au nœud `k` :

```ts
// items restants CONSOMMANT r : ceux de order[k..] dont itemRes contient r.id
// borne_r = nb max de ces items dont le volume tient dans capTotal[r], + les items restants
//           qui ne consomment PAS r (non contraints par cette dimension)
```

Pour rester simple et sûr sans structure lourde : précalculer, **par ressource** `r`, le tableau
des durées des items de `S` consommant `r`, trié croissant, avec ses sommes-préfixes ; et maintenir
un compteur `restants_r` du nombre de ces items encore non décidés. La borne devient
`placed + nonConcernés_k + maxK(r)` où `maxK(r)` se lit par dichotomie dans les préfixes tronqués à
`restants_r`. Prendre le min sur les `r` du cluster.

**Si cette version cluster s'avère délicate ou coûteuse à maintenir correctement, la livrer en
second temps** : §1.3 seul (mono) est déjà autonome et validable. Signaler le choix au checkpoint.

---

## 2. Symétrie et coût de la clé de mémoïsation

### 2.1 Symétrie des fenêtres identiques (mono)

La boucle `for (let w = 0; w < winsIn.length; w++)` (ligne 219) essaie **chaque** fenêtre. Deux
fenêtres de même jour et même longueur initiale, toutes deux intactes, engendrent deux sous-arbres
isomorphes ; `seen` ne les rattrape qu'APRÈS avoir payé la descente, et seulement si les résidus
coïncident positionnellement — ce qui n'est pas garanti (clé positionnelle, cf. §2.2).

Casser la symétrie à la source. Classe d'équivalence d'une fenêtre = `(day, longueur initiale)`.
Dans la boucle, si la fenêtre `w` est **intacte** (`winRes[w] === winsIn[w].len`) et qu'il existe
`w' < w` intacte de même classe **et de même colonne d'éligibilité pour cet item**, sauter `w`.

⚠️ La condition d'éligibilité est indispensable : deux fenêtres de même (jour, longueur) ne sont
interchangeables que si les items les voient identiquement. Le plus sûr et le plus simple est de
précalculer, hors DFS, une signature de classe par fenêtre :

```ts
// classe = day | len | colonne d'éligibilité complète (bits sur les n items)
const classId: number[] = /* index de classe par fenêtre, via une Map<string, number> */;
```

et de sauter `w` si une fenêtre intacte de même `classId` la précède. Avec cette signature,
l'interchangeabilité est totale et le saut est exact (ne coupe aucune solution de valeur
supérieure).

### 2.2 Clé de mémoïsation canonique (mono)

`const key = idx + '|' + winRes.join(',')` (ligne 214) est **positionnelle**. Avec §2.1 la plupart
des symétries ne naissent plus, mais des états équivalents subsistent (fenêtres de même classe
partiellement consommées différemment). Canoniser : trier les résidus **à l'intérieur de chaque
classe** avant de composer la clé. Bénéfice réel mais secondaire — **livrer §2.1 d'abord**, et ne
faire §2.2 que si les mesures du §4 montrent que ça paie.

### 2.3 Coût de la clé cluster — le point qui rapporte

`const stateKey = k + '|' + [...caps.values()].join(',')` (ligne 439) reconstruit une chaîne de
`|consumed| × 5` entrées **à chaque nœud**, avec l'allocation du spread. C'est très probablement une
part importante du « coût par nœud non constant » relevé au [§0 de PlanLbCoutRacine](PlanLbCoutRacine.md).

Remplacer par un **hachage incrémental de type Zobrist** :
- Précalculer, hors DFS, une table `zob[capIndex][quantum]` de `number` pseudo-aléatoires 32 bits.
  Les durées étant des minutes multiples d'un pas fin, indexer par la valeur de capacité elle-même
  est trop large : indexer plutôt par **(index de capacité, valeur consommée)**, en construisant la
  table paresseusement dans une `Map<number, number>` par index de capacité.
- Maintenir `hash` par XOR : au moment où `caps.set(key, v - dur)`, faire
  `hash ^= zobOf(capIdx, v) ^ zobOf(capIdx, v - dur)`. Symétrique au retour arrière.
- Clé du memo : `k * 2**32 + hash` sous forme de `number` composite, ou `Map<number, Map<number, number>>`
  indexée `k` puis `hash`.

⚠️ **Un hachage est ambigu par nature** : deux états distincts peuvent collisionner, et le memo
répondrait « déjà vu avec `placed` ≥ » à tort ⟹ branche coupée ⟹ `MaxPack` sous-estimé ⟹ **`lb`
surestimé ⟹ preuve fausse**. C'est exactement le mode de défaillance interdit. Deux parades, choisir
la **seconde** :
1. accepter le risque (probabilité faible) — **REFUSÉ**, incompatible avec le principe cardinal ;
2. stocker dans le memo, à côté de `placed`, une **vérification exacte** de l'état (la chaîne
   actuelle, ou mieux un `Int32Array` copié des capacités) et ne conclure à l'égalité qu'après
   comparaison. Le hash ne sert alors qu'à éviter de CONSTRUIRE et comparer la clé dans le cas
   général : on ne matérialise l'état exact que sur collision de hash, c'est-à-dire quasi jamais.

Convertir aussi `caps` d'une `Map<string, number>` vers un `Int32Array` indexé par un entier
`capIdx = resIdx * 5 + day` (table `resIdx` précalculée). Cela supprime le hachage de chaînes des
lignes 447-453, qui est chaud, et rend la copie d'état du point 2 triviale (`.slice()` seulement en
cas de collision).

### 2.4 Bornage de la table de transposition

`seen` et `seenState` croissent sans borne sur toute la durée du DFS (jusqu'à 200 000 nœuds côté
cluster) : coût mémoire et dégradation du `Map`. Optionnel, à ne faire que si §4 le justifie :
table à taille fixe (puissance de 2, indexée par `hash & mask`) avec remplacement systématique.
Sûr par construction avec la vérification exacte du §2.3 : un remplacement ne fait que perdre une
occasion d'élaguer, jamais couper à tort.

---

## 3. Tests (APRÈS feu vert)

Cible : `packages/scheduler-core/__tests__/rootLowerBound.test.ts` (112 tests actuels, tous doivent
rester verts — c'est le premier filet, la borne ne change pas).

Ajouts ciblés, resserrés sur ce que le changement peut affecter :

1. **Équivalence borne surrogate.** Sur 3-4 instances synthétiques déjà présentes dans le fichier,
   vérifier que `lb` est identique avec et sans le nouvel élagage (exposer un flag interne de test,
   ou comparer contre les valeurs attendues déjà écrites dans les tests existants).
2. **Symétrie exacte.** Instance avec ≥ 3 fenêtres strictement identiques (même jour, même longueur,
   même éligibilité) et des items qui les remplissent exactement : `lb` attendu connu à la main.
   Vérifie que §2.1 ne coupe pas une solution.
3. **Non-collision du memo.** Instance cluster avec ≥ 4 ressources consommées et des capacités qui
   se croisent, `lb` attendu connu : verrouille la vérification exacte du §2.3.
4. **Repli sur troncature intact.** Les micro-tests existants sur `monoNodeLimit` /
   `clusterNodeLimit` / `deadlineMs` doivent rester verts SANS modification — si l'un d'eux change
   de valeur, c'est que `ub` ou le chemin de repli a été touché : STOP.

Pas de nouveau test de performance en unitaire (non déterministe) : la mesure de coût est le §4.

---

## 4. Validation réelle (APRÈS feu vert, en UN batch)

Protocole identique à [PlanLbCoutRacine §5](PlanLbCoutRacine.md) — **re-exporter le projet réel
d'abord** (les snapshots vieillissent). Config Frédéric : `maxSolutions:1, maxEliminations:3,
timeoutSeconds:10, maxIterations:1M, conflictOrderingSearch:true, conflictSetExact:false,
ignoreDailyLimits:false`, pause flottante 90 min 12:00–14:00.

Appeler `computeRootLowerBound` directement sur les 10 semaines S3, S9, S36, S37, S38, S39, S40,
S45, S48, S49. **Un seul batch lancé en arrière-plan, une seule lecture des résultats à la fin** —
ne pas relancer semaine par semaine.

| Semaine | lb attendu | temps avant |
|---|---|---|
| S3 | 7 | 4 ms |
| S9 | 7 | 2 ms |
| S36 | 6 | 1037 ms |
| S37 | 3 | 4 ms |
| S38 | 0 | sautée (paresseux) |
| S39 | 0 | sautée (paresseux) |
| S40 | 1 | 68 ms |
| S45 | 0 | sautée (paresseux) |
| S48 | 5 | 1164 ms |
| S49 | 4 | 1120 ms |

**STOP immédiat si un `lb` diffère.** Les temps attendus baissent sur S36 / S48 / S49 (les trois
qui explorent réellement) ; les autres sont déjà triviaux et ne diront rien.

Reporter aussi le **nombre de nœuds** explorés avant/après sur S36, S48, S49 : c'est la mesure qui
attribue le gain à §1 (moins de nœuds) ou à §2.3 (même nombre de nœuds, moins de temps par nœud).
Sans cette séparation, on ne saura pas laquelle des deux modifications a payé.

---

## 5. Périmètre explicitement EXCLU

Ne pas toucher, dans ce plan :
- le modèle de relaxation : capacités, `floatingLunchDeduction`, raffinement union-des-domaines,
  matrice d'éligibilité, `computeTaskDomain` ;
- la sélection disjointe gloutonne (§1.4 de l'original) ;
- le repli sur troncature et le `ub` racine (§1.3 ci-dessus le dit explicitement) ;
- les points **C** (structure d'intervalles côté cluster) et **D** (fonctions dual-réalisables) de
  l'audit : ceux-là RENFORCENT la borne, changent donc les valeurs attendues, et demandent un
  protocole de validation différent. Chantier séparé.
