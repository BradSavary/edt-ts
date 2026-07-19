# Audit bibliographique — borne inférieure racine par bin-packing

*Opus, 2026-07-19. Confrontation de [rootLowerBound.ts](../packages/scheduler-core/src/rootLowerBound.ts)
à l'état de l'art. Le chantier A+B qui en découle est [PlanLbSurrogateSymetrie.md](PlanLbSurrogateSymetrie.md).*

## 1. Nommer le problème correctement

Les deux certificats ne sont **pas** le même problème — c'est ce qui détermine quelle littérature
s'applique.

| Certificat | Problème de la littérature |
|---|---|
| **mono-ressource** (§1.2) | `MaxPack` = **Multiple Knapsack Problem with Assignment Restrictions**, profits unitaires. Bacs = fenêtres de dispo (capacités hétérogènes), items = tâches, matrice `eligible` = restrictions d'affectation. Cas particulier bacs identiques : *Maximum Cardinality Bin Packing* (MCBPP). |
| **cluster** (§1.3) | Un item consomme simultanément la capacité de **plusieurs** ressources le même jour ⟹ **Multi-Resource Generalized Assignment / vector packing**, chaque couple (ressource, jour) étant une dimension. |

`lb = |S| − MaxPack` combiné par sélection disjointe (§1.4, un *set packing* résolu gloutonnement)
est le schéma classique du certificat combinatoire par sous-structures. Conforme.

## 2. Ce qui est conforme, voire au-dessus de la moyenne

Trois points où la littérature est explicite et où beaucoup d'implémentations se trompent :

- **La direction de sûreté est tenue partout.** Le principe cardinal (« toute approximation doit
  surestimer `MaxPack` ») est le bon invariant, respecté jusque dans `floatingLunchDeduction`.
- **Le repli sur troncature retombe sur la borne DUALE, jamais sur l'incumbent** (ligne 232,
  `exact ? best : Math.min(ub, n)`). Un B&B de maximisation tronqué ne donne une borne valide que
  par son UB — c'est l'erreur la plus fréquente dans les bornes « anytime ».
- **Warm start par une solution primale réalisable** (`bestInit`) : standard en MKP.

## 3. Les écarts, par rapport valeur/effort

### A. Aucune borne duale recalculée aux nœuds — l'écart le plus net → **traité par le plan A+B**

`ub` est calculé une fois à la racine (lignes 190-195) ; le seul élagage dans le DFS est
`placed + (n − idx) <= best`, la cardinalité triviale, qui ignore la capacité. Tout B&B MKP depuis
Martello–Toth recalcule une borne par **relaxation surrogate** aux nœuds. Détail d'implémentation
dans le plan §1.

### B. Mémoïsation : symétrie non cassée, clé coûteuse → **traité par le plan A+B**

Clé positionnelle (`winRes.join(',')`), fenêtres identiques explorées séparément, et côté cluster
une chaîne de `|ressources| × 5` entrées reconstruite à chaque nœud. Détail dans le plan §2.

### C. Le relâchement cluster perd la structure d'intervalles — **NON traité, écart de QUALITÉ**

Le mono raisonne fenêtre par fenêtre ; le cluster agrège en un scalaire par (ressource, jour) plus
une éligibilité au jour. Contre-exemple : dispos 8h-11h et 14h-15h (cap 240), deux tâches de 2h — le
scalaire dit « ça passe », la réalité dit non (la fenêtre d'1h ne peut rien porter). La borne cluster
est donc **structurellement plus lâche** que la mono.

Deux réponses dans la littérature :
- **Raisonnement énergétique** (Erschler–Lopez–Thuriot 1991, rendu efficace par
  Baptiste–Le Pape–Nuijten 1999, checker en O(n²) sur 15n² intervalles) : évaluer le bilan énergie
  sur les *intervalles pertinents* au lieu d'une grille fixe « jour ». Derrien & Petit ont montré
  que 2n² intervalles suffisent ; Ouellet & Quimper donnent un checker en O(n log² n).
- **Formulation par motifs journaliers** (Bagger et al.), issue du timetabling curriculaire —
  c'est-à-dire exactement notre domaine.

### D. Fonctions dual-réalisables (DFF) — **NON traité, renforce le repli**

La borne de comptage de repli (lignes 192-195) est purement volumique. Les **DFF** transforment les
tailles par une fonction super-additive avant de compter et capturent des obstructions que le volume
rate (typiquement : les items > C/2 ne cohabitent pas). Calcul en temps linéaire sur items triés,
**sans aucune recherche**. Deux usages : renforcer le repli sur troncature/deadline, et fournir une
borne gratuite sur le chemin paresseux avant même de lancer un DFS.

### E. Bin completion — l'état de l'art, mais probablement pas pour nous

Notre DFS est **item-oriented** (branchement sur « où placer l'item idx »), le schéma MTM historique.
L'état de l'art pour cette classe est le **bin completion** de Fukunaga & Korf : branchement sur les
*affectations maximales non dominées d'un bac*, avec le critère de dominance de Martello–Toth (F1
domine F2 si les items de F2 se regroupent dans F1) et élagage par nogoods. Gains rapportés :
plusieurs ordres de grandeur sur MKP.

**À garder en réserve.** C'est une réécriture complète (générer les sous-ensembles maximaux non
dominés par fenêtre, avec nos restrictions d'éligibilité) pour des instances qui tiennent déjà en
~1,1 s. A + B coûtent bien moins et attaquent le même goulot.

### F. Arc-flow / génération de colonnes — **écarté**

Valério de Carvalho, et Brandão & Pedroso pour la version avec compression de graphe : c'est la
référence en borne de bin packing (LP souvent entière), et elle n'a pas de falaise de timeout. Mais
elle exigerait un solveur LP dans le monorepo pour un bénéfice marginal à notre échelle.

## 4. Ordre recommandé

**A** (surrogate aux nœuds) → **B** (symétrie + hachage) → **C** (intervalles cluster) → **D** (DFF).

Distinction de validation à ne pas perdre : **A et B laissent la borne inchangée**, donc se valident
par égalité stricte contre les 10 semaines de référence de [PlanLbCoutRacine §5](PlanLbCoutRacine.md).
**C et D renforcent la borne** : ils changent les valeurs attendues et demandent un autre protocole
(vérifier que chaque `lb` reste ≤ l'optimum réel connu). Ne pas mélanger les deux dans un même
chantier.

## 5. Références

- Fukunaga & Korf, *Bin Completion Algorithms for Multicontainer Packing, Knapsack, and Covering
  Problems*, JAIR 2007 — <https://arxiv.org/abs/1110.2209>
- Clautiaux, Alves & Valério de Carvalho, *A survey of dual-feasible and superadditive functions*,
  Annals of OR — <https://link.springer.com/article/10.1007/s10479-008-0453-8>
- Fekete & Schepers, *New classes of fast lower bounds for bin packing problems* —
  <https://www.ibr.cs.tu-bs.de/users/fekete/hp/publications/PDF/1998-New_Classes_of_Lower_Bounds_for_Bin_Packing_Problems.pdf>
- Labbé, Laporte & Martello, *Upper bounds and algorithms for the maximum cardinality bin packing
  problem*, EJOR 2003 — <https://www.sciencedirect.com/science/article/abs/pii/S0377221702004666>
- Pisinger, *An exact algorithm for large multiple knapsack problems*, EJOR 1999 —
  <https://www.sciencedirect.com/science/article/abs/pii/S0377221798001209>
- *Algorithms to compute the energetic lower bounds of the cumulative scheduling problem*,
  Annals of OR 2024 — <https://link.springer.com/article/10.1007/s10479-023-05596-9>
- Brandão & Pedroso, *Bin Packing and Related Problems: General Arc-flow Formulation with Graph
  Compression* — <https://arxiv.org/pdf/1310.6887>
