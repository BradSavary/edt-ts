# Plan Combo-Branchement — brancher sur les combos de ressources dans le B&B

*Plan rédigé par Fable pour implémentation par Sonnet. Branche : `feature/optional-tasks`.*

**Préconditions (ne PAS exécuter avant)** : (1) `docs/PlanOptionalTasksP2Explication.md` implémenté — la brique 1 (explications MUS par rejeu de pile) a été RETIRÉE en révision post-usage (§R du plan, 2026-07-19 : jugée pas assez utile par Frédéric au vu de son coût) ; la précondition de compatibilité avec son rejeu déterministe est donc sans objet. Seule contrainte restante, inchangée : la nouvelle API d'unité ci-dessous ne doit pas toucher `earlySchedule` (le gourmand en dépend) ; (2) validation explicite de Frédéric au moment de lancer.

**Plan frère** : `docs/PlanComboUnionMCV.md` (mesure MCV par union) — verrouillé derrière le gate de CE plan (§5), ne jamais exécuter les deux en parallèle.

## 1. Contexte et mesures

L'écart « meilleur combo vs union » (`docs/AuditConformiteMCV.md` §3.2) recouvre deux défauts distincts ; ce plan traite le premier : **la complétude de la recherche**. `earlySchedule` ne retourne que le combo au créneau le plus tôt (tie-break premier combo) ; ni `_backtrack` ni `_bb` ne branchent jamais sur un combo alternatif — une solution exigeant l'autre prof/salle au même créneau est structurellement invisible, et la preuve `provenOptimal` n'est que relative au modèle (cf. commit `6390690`).

**Mesures sur le projet réel (export du 16/07)** — l'écart n'est PAS marginal : 63/97 (S37), 71/113 (S38), 79/106 (S39), 81/110 (S40) cours multi-combos ; combos par tâche : moyenne 2,2-2,7, max 7. Conséquences : (i) une part substantielle de l'espace de solutions est invisible ; (ii) le branchement multipliera le facteur de branchement par ~2,5 en moyenne — les preuves d'optimalité seront plus chères à budget égal (trade-off assumé : la preuve devient plus forte mais plus dure à obtenir).

## 2. Périmètre et flag

`OptionalTasksScheduler._bb` UNIQUEMENT — `Scheduler._backtrack` (gourmand, moteur de production) reste byte-identique (principe code-séparé). Flag transitoire `SchedulerConfig.comboBranching?: boolean`, défaut `false` (motif éprouvé COS/conflictSetExact : A/B mesuré avant toute généralisation). Défaut false = comportement actuel strictement inchangé.

## 3. Design — curseurs par combo, fusion chronologique

Espace de valeurs complet d'une unité = union, sur ses combos, des séquences de départs semi-actifs de chaque combo. Énumération : un curseur `fromTime` PAR combo ; à chaque itération, évaluer `earlyScheduleForCombo(c, fromTime_c)` pour chaque combo non épuisé, brancher sur le couple (combo, start) de start minimal (tie-break : index de combo croissant — déterminisme), puis avancer le curseur DE CE combo seul (`fromTime_c = start + SLOT_STEP`). Un combo dont l'appel retourne `null` est épuisé. La branche de saut reste offerte à l'épuisement de TOUS les combos. Rejets par filtre (pause flottante, plafond quotidien) : avancer le curseur du combo concerné, sans consommer de branche.

Nouvelle API d'unité (SANS toucher `earlySchedule` existant — le gourmand en dépend) :

```ts
// ISchedulingUnit
getComboCount(): number;
earlyScheduleForCombo(comboIndex: number, fromTime: number): SchedulingResult | null;
```

- `TaskUnit` : `getComboCount()` = taille de `getApplicableResources(task)` (cacher la liste) ; `earlyScheduleForCombo(i, t)` = `_findFirstSlot(combos[i], t)` → résultat avec `resources: combos[i]`.
- `TaskGroupUnit` : **v1 = pas de branchement interne** — `getComboCount()` = 1, `earlyScheduleForCombo(0, t)` = `earlySchedule(t)`. Incomplétude résiduelle documentée (le produit cartésien par membre exploserait et `book()` est couplé à `_pendingAssignment` — hors périmètre).

Dans `_bb` : quand le flag est actif, remplacer la boucle de placement par la fusion à curseurs ; quand il est inactif, boucle actuelle inchangée (deux chemins séparés, lisibilité > DRY ici). `book`/`unBook`/`_scheduled`/usage quotidien : identiques par branche.

**Sémantique de la preuve (à documenter dans le code)** : avec `comboBranching: true`, la docstring du getter `provenOptimal` devient « aucune solution plaçant plus de tâches n'existe, modulo (i) groupes multi-combos (non branchés en v1), (ii) discrétisation SLOT_STEP/semi-actif » — la restriction principale (combos des TaskUnit) saute. Flag off : docstring actuelle inchangée.

## 4. Tests (vérifier empiriquement avant de figer, méthode habituelle)

1. **LE test de complétude — affectation croisée** : 2 tâches T1/T2, chacune avec alternatives de prof {A, B}, fenêtres construites telles que la seule solution 2/2 exige l'affectation NON choisie par `earlySchedule` (ex. : A libre tôt mais court, B libre tard mais long — le tie-break naturel affecte mal et bloque l'autre tâche). Flag off : 1 placée + 1 sautée, « prouvé » (au sens relatif) ; flag on : **2/2 placées, prouvé**. C'est la démonstration que l'écart était réel et qu'il est levé.
2. **Neutralité mono-combo** : scénario 100% mono-combo → itérations et résultat STRICTEMENT identiques flag on/off.
3. **Déterminisme** : deux runs flag on → résultats identiques.
4. **Suites existantes intactes** flag off ; vérifier aussi flag on sur les scénarios existants (pigeonhole DUBOIS : mêmes conclusions, preuve possiblement plus chère).

## 5. Validation réelle — GATE du plan frère

Protocole standard (S37-40, budgets 1000/3000/10000/30000, COS on/off, pipeline weekSaves habituel, re-export à demander à Frédéric si le projet a bougé) : colonnes flag off vs flag on. Rapporter par run : placées/sautées, optimum prouvé o/n, itérations. Attendus :

- Jamais pire que flag off (le warm start seed du même gourmand garantit le plancher dans les deux cas).
- **LA question : S40 flag on améliore-t-il 105/107 → 106+, ou prouve-t-il enfin 105 ?** (Réponse possible à la question ouverte depuis P1.5 — l'affectation croisée est exactement le type de solution que le B&B ne voyait pas.)
- S37 : la preuve à budget 1000 peut devenir plus chère (×2,5 de branchement) — rapporter le budget nécessaire.
- Tout écart dégradé = STOP habituel.

**Après le commit : STOP — l'analyse de ces mesures par Fable/Frédéric conditionne le lancement de `docs/PlanComboUnionMCV.md`.**

## 6. Livraison et hors périmètre

- Commit unique, STATUT de CE document mis à jour, conventions habituelles (français, staging par nom, signature, scripts tmp supprimés, aucun fichier `data/`).
- Hors périmètre : branchement des combos dans `Scheduler._backtrack` (gourmand) ; branchement interne des `TaskGroupUnit` ; la mesure MCV par union (plan frère) ; P2-preuve ; tout changement de défaut du flag sans validation explicite de Frédéric.

## 7. Definition of done

- [ ] API `getComboCount`/`earlyScheduleForCombo`, fusion à curseurs dans `_bb` derrière `comboBranching` (défaut off), docstring provenOptimal à jour
- [ ] 4 tests dont l'affectation croisée ; suites complètes intactes ; typecheck clean
- [ ] Validation réelle rapportée (dont la réponse S40) dans le STATUT
- [ ] Commit unique, conventions respectées — puis gate avec Fable/Frédéric
