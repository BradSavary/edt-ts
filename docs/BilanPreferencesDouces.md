# Bilan du chantier « préférences douces CP-SAT » (2026-09-09 → 2026-09-11)

Document de reprise. Le chantier est **suspendu**, pas abandonné : la suite se fera sur une
branche neuve, centrée sur la **séquence** de traitement des préférences. Ce document existe pour
qu'on ne refasse pas les explorations déjà menées, et surtout qu'on ne les refasse pas *mal*.

Branche : `feature/soft-prefs-rework` (3 commits, non mergée).
Données de référence : `data/BUT MMI 2026-2027_2026-09-09_16-40.json`, semaines **S48 / S41 / S47**
(121 / 108 / 114 cours, 51 enseignants, 10 groupes, 11 salles).

---

## 1. Point de départ

Question initiale : pourquoi le moteur CP-SAT est-il lent ? Neuf causes documentées ont été
passées en revue (domaines trop larges, symétries, borne duale faible sur min-max, gros
coefficients, décomposition manuelle, contraintes redondantes manquantes, hints incomplets,
paramètres au défaut, passes lexicographiques).

**Le placement n'a jamais été le problème.** Passe 1 : 1,0 à 2,6 s, **zéro conflit**, optimum
prouvé sur les trois semaines. Tout le temps part dans les préférences douces.

---

## 2. Ce qui est acquis (mesuré, commité)

### `7ef0d44` — budget de temps

Chaque passe calculait son temps restant avec `total_timeout - solver.WallTime()`, où `solver`
pointait sur le solveur de la passe **précédente**. On ne retranchait donc que la durée de cette
passe-là, re-créditant tout le temps consommé avant : jusqu'à **~2× `timeoutSeconds`**. Comme
`cpsatGateway.ts` tue le process à `timeoutSeconds + 5` et **rejette la promesse**, un dépassement
ne dégradait pas le résultat : il le **détruisait**.

Corrigé par une échéance absolue posée en tête de `solve()`. Une passe sans budget est désormais
**sautée et tracée sur stderr**, au lieu d'être lancée sur le reliquat d'1 s de l'ancien
`max(1.0, …)` — elle rendait `UNKNOWN` et l'option cochée restait sans effet, en silence.

Mesuré : 60,1 s / 20,1 s / 5,1 s / 1,8 s pour des timeouts de 60 / 20 / 5 / 2 s (avant : 61 à
**327 s** pour 60 s demandées). Placement inchangé.

**À conserver quoi qu'il advienne de la suite.**

### `773c2bb` — fusion des termes doux

- `compactTeacherHalfDays` et `crossNoonGap` découpaient la **même grandeur** (le temps mort d'une
  journée) en deux termes, au prix de littéraux `on_side` par (cours, jour, côté) : **+37 % de
  variables**, **+42 à +70 % de temps** sur la passe 2. Fusionnés en un seul terme
  `limitTeacherIdleTime`, avec franchise par morceaux (1 h par demi-journée, puis tarif ×10 —
  dissuasif, **jamais interdit**, pour qu'une disponibilité contrainte ne rende pas la semaine
  insoluble).
- Le min-max des pics ne mesurait pas l'équité : `(5,5,2)` valait `(5,4,3)`. Remplacé par
  l'**écart max−min** entre journées de présence.
- `on_half` et `on_side` sont devenus inatteignables : 52 lignes supprimées.

Résultat : modèle **2,4× plus léger** (le facteur douces/base passe de ×4,1 à ×1,7), écart médian
en baisse sur **6 runs sur 6** (105→75, 97→37, 90→60), Σ écart −29 % et −23 % sur S48 et S41,
+8 % sur S47 (dans le bruit). Placement identique partout.

### `b5df28f` — UI, contrat, store, runner

5 cases → 4 (deux déclenchaient le même terme). Migration v10 du store. Le runner relaie
anciennes et nouvelles clés.

---

## 3. Écarté — ne pas refaire

| Piste | Verdict | Mesure |
|---|---|---|
| **Symétries** | Écarté | 3 classes de 2 cours interchangeables sur 124 ; CP-SAT ne détecte que 4-6 générateurs. **Cause latente** : avec 17 salles identiques, la passe 2 passe d'un optimum prouvé en 13 s à `FEASIBLE` en 50 s, pour un résultat **6 à 11 % moins bon** |
| **Granularité** | Écarté, **effet nul** | Gap 14,9 % (minute) → 13,7 % (15 min) → 14,0 % (30 min), **inférieur à la variance entre deux runs identiques** (2,8 points). Conservée uniquement parce qu'elle supprime les horaires bâtards (1 cours sur 120 démarrait à une heure non ronde) |
| **Contraintes redondantes** | Retirées | Gap 17,5 % → 13,4 %, borne duale +2 à +8 %. Réel mais **insuffisant** : ne fait pas converger, ne libère pas de budget, effet invisible sur la qualité |
| **`num_workers` fixé** | Écarté (décision) | Fixer 8 ne garantit pas 8 cœurs disponibles : aucune reproductibilité gagnée, risque de contention. 1 thread ralentirait trop |
| **Borne inférieure sur le pic** | Sans objet | L'objectif a changé (écart, pas pic) |
| **Demi-journées au lieu des jours** | **Écarté (tests Frédéric, 2026-09-11)** | Les plannings produits sont **moins qualitatifs**. Le comptage doit revenir aux **journées** |

⚠️ Nuance sur les contraintes redondantes : la version testée lisait les capacités sur les
**disponibilités seules**. Elle couvrait donc le cas « 2 h de dispo/jour » (déjà bien géré par la
restriction de domaine) et **ratait** le cas « dispo maximale + plafond quotidien de 2 h », le seul
qui coûte vraiment. Une version lisant `min(disponibilité, maxDailyMinutes)` n'a **jamais été
testée**.

---

## 4. Diagnostic à l'arrêt du chantier

- **Passe 2 ne converge jamais** : `FEASIBLE` à 58-59 s, gap 13-15 %, sur les **18 runs** de la
  campagne granularité. Sans exception.
- **La passe salles n'est jamais exécutée** : la passe 2 consomme tout le timeout.
- **Au-delà de 120 s, le résultat ne bouge plus** : objectif identique à 120 s et 180 s, seule la
  borne progresse. Le timeout client de 180 s fait attendre trois minutes pour un planning obtenu
  à 1,8 % près au bout de 60 s.
- Les deux causes documentées testées (borne duale, granularité) **n'expliquent pas** la
  non-convergence.

**Hypothèse non testée, la plus sérieuse** : une somme de termes **antagonistes** crée un plateau
de solutions quasi équivalentes, sur lequel la borne duale progresse très mal. L'antagonisme réel
n'est pas « compacité vs équilibrage » (l'une agit *dans* la journée, l'autre *entre* les journées
— largement orthogonales) mais **« concentration vs équilibrage »**.

---

## 5. Piste de reprise : la séquence

**Ce qui n'a jamais été remis en cause**, ni dans l'ancien moteur ni dans la refonte :

```
placement → compacité (+ jours + midi) → équilibrage → salles
```

Trois mesures convergent pour dire que **cet ordre est à l'envers** :

- la compacité est **facile** : dès qu'on la demande, le temps mort tombe de 1 400-2 100 min à
  0-150 min ;
- l'équilibrage **subordonné** ne produit rien : gain 0, 0 et 1,6 % ;
- l'équilibrage **seul** est efficace : jusqu'à **−70 %** d'écart.

Un critère qui se satisfait presque toujours devrait passer **en dernier**, précisément parce
qu'il retrouvera sa liberté quoi qu'il arrive. Aujourd'hui le critère facile passe en premier et
sature tous les degrés de liberté ; le critère difficile passe en dernier et n'a plus rien.

**Ordre à essayer** (les demi-journées étant écartées, retour aux journées) :

```
placement → équilibrage → nombre de jours → temps mort → salles
```

**Forme à privilégier** : hiérarchie à **tolérance relative** (« minimise le niveau suivant sans
dégrader le précédent de plus de X % »), en pourcentage et non en minutes.

- Un pourcentage est **invariant d'échelle** : c'est la faiblesse de fond de la pondération
  actuelle, dont les poids encodent des ordres de grandeur propres à ce projet (écart médian
  90-120 min, temps mort médian 60-90 min). Sur un projet où les enseignants feraient 20 h/semaine,
  les écarts typiques dépasseraient 500 min et l'arbitrage basculerait tout seul.
- **Ne pas refaire du lexicographique strict** : c'est lui qui stérilise. Verrouiller un optimum
  *prouvé* à la minute près ne laissait au niveau suivant qu'un espace réduit à un point — avec
  pour résultat un planning **moins équilibré que sans aucune option** (Σ écart 2 700 contre
  2 130 sur S48).

---

## 6. Pièges méthodologiques rencontrés

1. **La variance inter-runs écrase la plupart des effets.** Jusqu'à **×19** en temps (17 s contre
   322 s, même modèle) et **±20 %** sur Σ écart. Toute mesure à 1 ou 2 runs est ininterprétable :
   **3 runs minimum, comparer les médianes**. Cette variance vient du multi-thread et ne sera pas
   éliminée (décision assumée).
2. **Vérifier que les deux branches comparées diffèrent réellement.** Une campagne a comparé deux
   configurations qui se rabattaient sur la **même** configuration interne : elle mesurait la
   variance, pas un effet.
3. **Comparer des périmètres identiques.** Σ pics calculé sur *tous* les enseignants (8 490) contre
   objectif du modèle (7 890) : le modèle exclut les profs dont les cours n'ont qu'un jour possible.
4. **Toujours re-exporter le projet avant de mesurer.** L'export de juillet avait **1 enseignant
   sur 50** avec un plafond quotidien ; celui de septembre en a **13 sur 51**. Tout le diagnostic
   sur la marge de l'équilibrage en dépend.
5. **Un test de discrétisation doit changer l'unité, pas trouer le domaine.** Le premier essai
   remplaçait le domaine par des singletons de 30 en 30 : il *ralentit* (domaine fragmenté en
   centaines d'intervalles). La forme correcte est `start = pas × k`, qui garde un domaine contigu.

---

## 7. Manque identifié, hors moteur

Rien, ni dans l'UI ni dans le retour moteur, ne signale qu'un enseignant est **structurellement
contraint** : 2 h de disponibilité par jour (ou un plafond quotidien de 2 h) et 10 h à placer
imposent 5 journées, quelle que soit l'option cochée. Le solveur ne le sait pas non plus a priori —
il doit le *prouver*, et c'est précisément cette preuve qui n'aboutit pas.

`lib/resourceLoadAnalysis.ts` calcule déjà la capacité quotidienne **plafonnée par
`maxDailyMinutes`**. Rapporter la charge hebdomadaire à cette capacité donnerait le nombre minimal
de journées sans toucher au moteur. Cela ne le rendrait pas plus rapide, mais éviterait d'attendre
un résultat qu'aucune optimisation ne peut produire.

---

## 8. Scripts de mesure

Tous dans le scratchpad de la session (non versionnés, à réécrire si besoin) : construction du
payload depuis un export projet (réplique `scheduleApi.ts::_buildPayload`, y compris le filtre
`preNeutralizedKeys` et l'aplatissement du `Default` par semaine — sans quoi les ressources
retombant sur `Default` reçoivent des fenêtres vides et « disparaissent »), instrumentation de
`CpSolver.Solve` par sous-classe pour journaliser statut / temps / objectif / borne par passe, et
calcul des grandeurs métier (temps mort net, demi-journées, écart max−min) depuis la solution.
