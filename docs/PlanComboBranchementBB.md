# Plan Combo-Branchement — brancher sur les combos de ressources dans le B&B

> **GATE FERMÉ — NÉGATIF (2026-07-17, décision de Frédéric sur recommandation de Fable, revue code validée).** Verdict sur les 3 axes : (1) placements — zéro gain sur les 64 cellules réelles, question S40 sans réponse ; (2) convergence — ×1,95 d'itérations pour la même conclusion (S37), seul axe où le plan frère pourrait payer et il est déjà mesuré négatif ; (3) preuve — fréquence de `provenOptimal` strictement inchangée. Conséquences : `docs/PlanComboUnionMCV.md` **NON lancé** (reste en réserve, verrou maintenu) ; `comboBranching` conservé tel quel (défaut `false`, complétude disponible et testée) ; si la question S40 « 106/107 faisable ? » redevient prioritaire, la piste retenue est P2-preuve (LB bin-packing exact à la racine) — ce plan a montré qu'explorer plus ne répond pas dans le budget, il faut borner, pas brancher. Remarque perf consignée si réactivation un jour : la fusion à curseurs ré-interroge tous les combos non épuisés à chaque itération alors que seuls les candidats du combo gagnant peuvent changer (mémoïsable, part probable du ×1,95).
>
> **STATUT (2026-07-17, exécution par Sonnet) : LIVRÉ, commité (`bb4e98e`) — bénéfice NON démontré sur le projet réel aux budgets testés.** API `getComboCount`/`earlyScheduleForCombo` (§3) ajoutée à `ISchedulingUnit`/`TaskUnit` (combos mis en cache, `earlySchedule` byte-identique, non touché)/`TaskGroupUnit` (v1, pas de branchement interne). Fusion à curseurs implémentée dans `OptionalTasksScheduler._bb`, deux chemins séparés derrière `SchedulerConfig.comboBranching` (défaut `false`) ; flag ajouté aux DEUX littéraux `Required<SchedulerConfig>` (types.ts ET le second dans `scheduler.ts`, piège déjà documenté par P3). Docstring `provenOptimal` mise à jour pour documenter les deux régimes (flag off/on) au lieu d'être remplacée. Typecheck clean sur les 4 workspaces, 102/102 scheduler-core + 269/269 scheduler-client verts (aucune suite existante modifiée).
>
> **4 tests dédiés** (`schedulerOptionalTasks.test.ts`, describe `comboBranching`) : (1) **affectation croisée** — scénario construit à la main (2 tâches, alternatives {A,B} tie-break à l'instant t, la seule solution 2/2 exige le combo NON tie-breaké) : flag off → 1/2 placée, `provenOptimal:true` (relatif) ; flag on → **2/2, prouvé** — vérifié empiriquement en dérivant à la main le déroulé exact du B&B avant d'écrire le test (curseur B non consommé après l'échec du combo A à l'instant t, retenté au même instant après épuisement structurel de A — exactement le mécanisme du §3) ; (2) neutralité mono-combo : itérations et résultats STRICTEMENT identiques flag off/on ; (3) déterminisme : deux runs flag on identiques ; (4) pigeonhole DUBOIS (scénario existant) flag on : mêmes conclusions (3/1, prouvé) ET mêmes itérations que flag off (mono-combo, aucun surcoût).
>
> **Validation réelle** (export du 16/07, S37-40, budgets 1000/3000/10000/30000, COS off/on × combo off/on = 64 cellules, pipeline weekSaves complet reconstruit fidèlement pour 38/39 via les fonctions pures du client — `getCoursesForWeek`/`buildTaskGroupData`/`computeGroupEnforcements`/`filterResourcesForCourses`/`applyBlockedZonesToConstraints` importées directement, pas réimplémentées) :
>
> 1. **Nombre de tâches planifiées** — **jamais pire, mais jamais mieux non plus** sur les 64 cellules. S37 : 94/97 (3 sautées) identique aux 4 budgets × COS × combo. S38/S39 : 110/110 et 106/106 (0 sauté, gourmand déjà complet — le B&B ne tourne même pas, le flag n'a donc structurellement aucun effet possible). **S40 : la question ouverte du §5.1 (« 105/107 → 106+, ou preuve de 105 ? ») reste sans réponse positive à ces budgets** — combo off et combo on convergent vers EXACTEMENT les mêmes chiffres à chaque cellule (5 sautées à budget 1000/COS off, 4 sautées partout ailleurs), jamais 105/107 ni mieux. Aucune dégradation nulle part (STOP non déclenché) mais aucun gain observé.
> 2. **Vitesse de convergence** — mesurable uniquement sur S37 (seule semaine où le B&B améliore effectivement le gourmand sans être budget-limité) : **22 → 43 itérations pour la même conclusion (94/97, prouvé)**, soit ×1,95 — cohérent avec le facteur ×2,2-2,7 annoncé au §1. Sur S40, comparaison non concluante : les deux régimes sont budget-exhausted à chaque budget testé (itérations = budget+1 des deux côtés), impossible de distinguer un éventuel surcoût ou gain au-delà de 30000 itérations avec le protocole standard.
> 3. **Qualité d'explication des limites** — `provenOptimal` est VRAI/FAUX dans EXACTEMENT les mêmes cellules flag off/on (vrai sur S37/38/39, faux sur S40 à ces budgets) : aucun gain de fréquence de preuve mesuré sur ce projet à ces budgets. La docstring (§3) reste correcte en soi mais n'a rien à démontrer empiriquement ici.
>
> **Lecture** : le mécanisme est correct et démontré sur un cas construit à la main (test 1) — la complétude gagnée est réelle et le design (curseurs par combo, tie-break déterministe) fonctionne exactement comme spécifié. Mais sur CE projet réel, à CES budgets, le gap structurel qu'il comble ne se manifeste pas (ou son coût combinatoire consomme le budget avant de payer) : aucune solution de type « affectation croisée » n'a été débloquée sur S37/40 dans la plage 1000-30000 itérations. **Décision de lancement de `docs/PlanComboUnionMCV.md` à trancher par Fable/Frédéric sur cette base — pas une recommandation de ce STATUT.**
>
> Commit unique livré : `bb4e98e` (script de validation jetable supprimé, aucun fichier `data/` touché).

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

Protocole standard (S37-40, budgets 1000/3000/10000/30000, COS on/off, pipeline weekSaves habituel, re-export à demander à Frédéric si le projet a bougé) : colonnes flag off vs flag on. **Le rapport du gate est structuré sur les trois axes d'évaluation fixés par Frédéric (2026-07-19)** :

1. **Nombre de tâches planifiées** — placées/sautées par semaine × budget × COS, flag off vs on. Le jamais-pire est garanti par construction (warm start seed du même gourmand dans les deux cas) : tout écart ne peut être qu'une amélioration. **LA question : S40 flag on améliore-t-il 105/107 → 106+, ou prouve-t-il enfin 105 ?** (l'affectation croisée est exactement le type de solution que le B&B ne voyait pas).
2. **Vitesse de convergence** — en itérations, jamais en wall-clock (budgets déterministes, règle maison) : itérations jusqu'au premier incumbent, jusqu'à la preuve le cas échéant, et budget minimal pour prouver S37 (référence actuelle : 1000 — le branchement ×2,2-2,7 le renchérira, chiffrer de combien). Rapporter aussi les durées à titre indicatif.
3. **Qualité d'explication des limites** — cadrage honnête : ce plan ne change NI les textes de raison (génériques depuis la révision post-usage de P2-Explication) NI l'analyse de charge. Son apport sur cet axe est la **fiabilité et la fréquence de la preuve** : `provenOptimal` passe d'une preuve relative au modèle (« aucune solution atteignable par le moteur, combos non branchés ») à une preuve quasi absolue — rapporter, par semaine, où la preuve est obtenue flag on vs off, et mettre à jour les libellés/docstrings en conséquence (§3). Des explications textuelles plus riches relèveraient du volet P2-preuve (reporté), pas de ce plan.

- Tout écart dégradé = STOP habituel.

**Après le commit : STOP — l'analyse de ces mesures par Fable/Frédéric, sur les trois axes ci-dessus, conditionne le lancement de `docs/PlanComboUnionMCV.md`.**

## 6. Livraison et hors périmètre

- Commit unique, STATUT de CE document mis à jour, conventions habituelles (français, staging par nom, signature, scripts tmp supprimés, aucun fichier `data/`).
- Hors périmètre : branchement des combos dans `Scheduler._backtrack` (gourmand) ; branchement interne des `TaskGroupUnit` ; la mesure MCV par union (plan frère) ; P2-preuve ; tout changement de défaut du flag sans validation explicite de Frédéric.

## 7. Definition of done

- [x] API `getComboCount`/`earlyScheduleForCombo`, fusion à curseurs dans `_bb` derrière `comboBranching` (défaut off), docstring provenOptimal à jour
- [x] 4 tests dont l'affectation croisée ; suites complètes intactes ; typecheck clean
- [x] Validation réelle rapportée (dont la réponse S40 — négative aux budgets testés) dans le STATUT
- [x] Commit unique (`bb4e98e`), conventions respectées — gate tranché avec Fable/Frédéric (FERMÉ négatif, voir bandeau en tête)
