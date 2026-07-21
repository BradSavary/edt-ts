# Plan d'implémentation — persistance des placements dans le Projet

## STATUT

**§4 (implémentation) : Sonnet, 2026-07-21.** Arrêt au CHECKPOINT §5 conformément au plan — aucun
test, aucune mesure, aucun STATUT de validation à ce stade au-delà des faits ci-dessous.

**§6.1-§6.3 (validation automatisée + mesure) : Sonnet, 2026-07-21, feu vert reçu de Frédéric.**
§6.4 (passe manuelle) non fait — réservé à Frédéric par le plan lui-même.

### §5 — checkpoint, item par item
- `npm run typecheck --workspace=packages/scheduler-client` : propre.
- `grep -rn "constraintViolation" packages/scheduler-client/{app,components,hooks,lib,store}` :
  3 occurrences restantes, toutes sur la prop dérivée au rendu (`useCalendarCore.ts:71` —
  `extendedProps.constraintViolation`, `ScheduleCalendar.tsx:30,55,58` — lecture de cette prop,
  `lib/calendar/types.ts:44` — déclaration de `CalendarEventExtProps.constraintViolation`).
  **Zéro** occurrence sur `Placement`/`store/types.ts` ou un point d'écriture du store.
- Aucun `pre-enforced` ni `user-pre` écrit dans les nouveaux champs : `_saveCurrentWeekSnapshot`
  filtre `ps.placements.filter((p) => p.origin !== 'pre-enforced')` et
  `ps.unplaced.filter((u) => u.origin !== 'user-pre')` (store/usePlanningStore.ts, section
  `_saveCurrentWeekSnapshot`).
- Garde d'auto-save : simplifiée, pas étendue — les deux comparaisons `JSON.stringify` ont
  disparu, remplacées par des comparaisons de référence sur `placements`/`unplaced` (ajoutées à la
  liste déjà comparée par référence : `taskGroups`/`blockedZones`/`manualEnforcedMap`). Écart au
  texte du plan : `lastRun` a été ajouté à cette même comparaison de référence — non listé
  littéralement au §4.4, mais `lastRun` change toujours en même temps que `placements` dans tous
  les appelants (`applyPendingResult`, `returnToPreparation`, `reset`, `setSelectedWeek`), donc
  redondant en pratique, jamais observé comme la seule différence.
- §4.5 `handleEnforceChange` : **non touché**, conformément à la préférence énoncée dans le plan.
  Il continue de détruire `placements`/`unplaced`/`scheduleResult` sur toute imposition. Je n'ai
  pas non plus touché `lastRun` à cet endroit : après un `handleEnforceChange`, `lastRun` reste
  celui du dernier calcul alors que `placements` a été réduit aux seuls `pre-enforced` — la bascule
  de mode (§4.6, fondée sur `lastRun`) resterait donc sur la vue solution dans ce cas précis. Même
  incohérence que celle déjà signalée par le plan pour `scheduleResult`, non résolue ici, à
  trancher par le relecteur.

### Écarts au plan (fichiers touchés hors §7, ou comportement non explicitement demandé)
- **`app/planning/page.tsx`** (absent du tableau §7) : les boutons « Statistiques » /
  « ↺ Réinitialiser » étaient gardés par `scheduleResult !== null` ; passés à `lastRun !== null`.
  Sans ce changement, ces boutons disparaîtraient après un rechargement de page alors même que
  `SidebarLeft` afficherait la vue solution (`lastRun !== null`) — c'est-à-dire que le test manuel
  §6.4.2/§6.4.3 du plan lui-même ne pourrait pas passer sans ce changement.
- Même fichier : la bannière de statut affiche désormais un statut reconstruit
  (`"N cours placé(s), M non placé(s)"`, `kind: 'inf'`) quand `status` est `null` et
  `lastRun !== null` — c'est la demande explicite du §4.6 ("afficher un statut reconstruit...").
- **`components/planning/sidebar/SidebarAnalysis.tsx`** (absent du tableau §7) : le bouton export
  iCal était gardé par `scheduleResult !== null` — même raisonnement, passé à `lastRun !== null`.
- **`returnToPreparation` et `reset()`** (`store/usePlanningStore.ts`) : ajout de `lastRun: null`
  dans les deux `set()`, en plus de ce que le plan décrivait pour ces deux actions. Sans ça, un
  retour explicite à la préparation ne survivrait pas à un rechargement de page : la bascule de
  mode (§4.6) rouvrirait la vue solution au lieu de la préparation.
- **Non touché, à signaler** : `hasSolution` dans `hooks/useCalendarCore.ts` (consommé par
  `selectable={!hasSolution}` dans `ScheduleCalendar.tsx`) reste fondé sur `scheduleResult`
  (session), pas sur `lastRun`. Absent du tableau §7, donc laissé tel quel — mais après
  rechargement en vue solution restaurée, `hasSolution` vaudra `false` (aucun calcul dans la
  session), ce qui réactive la sélection de zone alors que `SidebarLeft` affiche la vue solution.
  Incohérence pré-existante dans le même sens que celles ci-dessus, non résolue faute de mandat.
- **§4.3, restriction non étendue** : l'élagage « cours disparu » (`courseById.get(taskId)` vide)
  n'a été appliqué qu'aux `placements` persistés, comme demandé littéralement par le plan. Je ne
  l'ai pas étendu aux `unplaced` persistés, qui peuvent souffrir du même problème (un `taskId`
  fantôme resterait dans l'état et repartirait en sauvegarde indéfiniment) — non testé, à trancher.

### Autre effet de comportement, dérivé de la lecture du §1.1
La suppression de la branche `origin === 'auto' ? undefined : ...` dans
`buildPlacementEvent` (`useCalendarCore.ts`) fait qu'une violation est maintenant affichée aussi
sur les placements `auto` (avant, elle était explicitement masquée pour cette origine). C'est
littéralement l'« effet attendu » décrit au §1.1 du plan ("une tâche placée par le moteur puis
recouverte par une zone bloquée devient rouge, ce qui n'arrivait pas"), donc traité comme faisant
partie de la demande plutôt que comme un écart.

### §6.1 — non-régression automatisée
- Avant tout changement de test : `npx vitest run` → **2 échecs** dans
  `__tests__/unplacedPersistence.test.ts` (27 fichiers, 362 tests, 360 passants). Les deux
  assertions échouées testaient explicitement le comportement **d'avant ce chantier** que le
  chantier change délibérément :
  - « un aller-retour ne restaure que les user-pre : engine/user-post disparaissent » — c'est
    désormais faux par construction : `engine`/`user-post` traversent le nouveau champ `unplaced`
    et survivent à un changement de semaine (c'est le but même de §4.2/§4.3).
  - « une modification engine seul ne redéclenche pas la sauvegarde » — c'est désormais faux par
    construction : la garde simplifiée (§4.4) sauve sur toute référence `unplaced` différente,
    explicitement demandé par le plan.
  - J'ai mis à jour ces deux tests pour affirmer le nouveau comportement (avec commentaire
    expliquant pourquoi l'ancien était testé), plutôt que de les supprimer ou de les affaiblir.
  - `npx vitest run` après correction : **28 fichiers, 370 tests, tous passants** (362 existants
    + 8 nouveaux de §6.2, voir plus bas — le différentiel de 362→370 est net des tests ajoutés,
    aucun test n'a été supprimé).
- `npm run typecheck --workspaces --if-present` : propre sur les 4 packages
  (scheduler-api/scheduler-client/scheduler-common/scheduler-core).
- `npm run lint --workspace=packages/scheduler-client` : **27 problèmes (7 erreurs, 20
  avertissements)** — identique au chiffre de référence du plan (§6.1 : "27 problèmes
  préexistants"), donc aucun nouveau problème de lint introduit.
- `npm run build --workspace=packages/scheduler-client` : `next build` réussi (Compiled
  successfully, TypeScript OK, 8 pages statiques générées).

### §6.2 — tests ciblés
Nouveau fichier `__tests__/persistPlacements.test.ts`, 8 cas correspondant un-à-un aux 8 listés
par le plan (aller-retour complet, aucune duplication pre-enforced/user-pre, élagage cours
disparu, dédup imposition > placement persisté, lastRun sans scheduleResult, snapshot ancien sans
erreur, semaine sans préparation mais avec placements sauvegardée, zone bloquée ne supprime pas).

**Contrôle de mutation** (les tests mordent-ils réellement) — quatre mutations ciblées appliquées
une à une puis annulées :
- retrait du filtre d'élagage "cours disparu" dans `setSelectedWeek` → cas 3 échoue ;
- inversion de l'ordre de concaténation `pre-enforced`/persisté dans `dedupePlacements` → cas 1 et
  4 échouent ;
- retrait des conditions `persistedPlacements.length === 0 && persistedUnplaced.length === 0 &&
  ps.lastRun === null` de la garde `isEmpty` → cas 7 échoue (et cas 3 par ricochet, qui dépend de
  la même garde pour vérifier la non-resauvegarde du fantôme) ;
- réintroduction de `scheduleResult: null` dans `handleBlockedZoneAdd` → cas 8 échoue.

### §6.3 — mesure du volume (chiffres bruts, projet réel ré-exporté)
Projet utilisé : `packages/scheduler-core/data/Planification MMI_2026-07-21_21-00.json` (export du
jour même). Semaines mesurées : **S48, S49, S38** — les 3 semaines les plus chargées parmi celles
ayant un `weekSaves` existant (124, 121, 113 cours).

**Écart au protocole du plan, à signaler explicitement :** le plan demande de "planifier 3
semaines chargées" avec le vrai moteur. Invoqué directement (`Loader.loadFromRawData` +
`Scheduler`/`OptionalTasksScheduler`, hors flux applicatif complet), le moteur n'a placé **aucune
tâche** sur ce projet, dans les deux stratégies ('elimination' : 6 éliminations × 10s, toutes à 0
placement ; 'maxPlacement' : passe gourmande + B&B à 30s chacune, incumbent final "0 placées, 3
sautée(s)" sur les 3 semaines). Logs bruts conservés le temps de l'investigation, supprimés avec le
script. Hypothèse non vérifiée : le payload construit pour l'invocation directe omet
`manualEnforcedMap`/`taskGroups`/`blockedZones` de la semaine (normalement fournis par
`usePlanningStore.runSchedule`), qui fixent une partie des cours et réduisent l'espace de
recherche — diagnostic relevant d'un chantier de qualité de planification, hors périmètre ici.

Mesure de repli, choisie pour rester fidèle à l'objet réel de la mesure (le coût de sérialisation
d'un `Placement`, pas la capacité du moteur à converger) : un `Placement` **synthétique** par cours
de la semaine, taskId/duration/ressources réels du projet (première alternative de chaque
ressource), origin `'auto'`. Script temporaire (`packages/scheduler-core/examples/
measure-persist-placements.ts`), supprimé après usage.

```
S48 : 124 cours → snapshot edt-project:week:48 = 44 036 octets (43 951 caractères) — 176,1 octets/placement
S49 : 121 cours → snapshot edt-project:week:49 = 42 816 octets (42 736 caractères) — 175,4 octets/placement
S38 : 113 cours → snapshot edt-project:week:38 = 40 344 octets (40 270 caractères) — 177,3 octets/placement

Total 3 semaines : 127 196 octets. Moyenne/semaine : 42 399 octets.
Extrapolation brute × 35 semaines (moyenne mesurée) : 1 483 953 octets ≈ 1,42 Mo.
Extrapolation brute × 35 semaines (semaine la plus lourde mesurée) : 1 541 260 octets.
```

Écart caractères/octets UTF-8 mesuré : ~85-100 octets sur ~40-44 Ko, soit <0,25% (peu
d'accents dans les identifiants de ressources/cours de ce projet). **Non mesuré** : l'écart
caractères UTF-16 vs occupation réelle du quota localStorage d'un navigateur — le plan le
demandait "si le navigateur le permet" ; aucune instrumentation navigateur n'a été faite dans ce
passage (script Node uniquement), à faire lors de la passe manuelle §6.4 si jugé utile.

Ces chiffres (176 octets/placement) sont proches de l'estimation au doigt mouillé du §1.3 du plan
(~150 octets/placement) et de l'extrapolation qui en découlait (~1,6 Mo/35 semaines avec doublement
`lastRun`, contre ~1,42-1,5 Mo mesuré ici). Rapportés bruts, sans conclusion sur leur suffisance —
c'est au relecteur de trancher.

### §6.4 — passe manuelle
Non faite : le plan la réserve explicitement à Frédéric ("Passe manuelle (Frédéric)"). Les 7
points du plan restent à dérouler manuellement sur `feature/persist-placements`.

## Relecture (Opus, 2026-07-21)

Contrôles refaits indépendamment : typecheck propre sur les 4 workspaces, lint 27 (inchangé),
build OK. Les deux filtres d'écriture sont conformes (aucun `pre-enforced` ni `user-pre` dans les
nouveaux champs) et la garde d'auto-save a bien été **simplifiée** — les comparaisons
`JSON.stringify` ont disparu au profit de comparaisons de référence.

Le STATUT signalait trois incohérences non résolues. **Les trois sont réelles et corrigées ici.**

**1. `handleEnforceChange` ne remettait pas `lastRun` à `null`.** La bascule de mode ayant déménagé
de `scheduleResult` vers `lastRun`, imposer un cours laissait la vue solution ouverte sur un
calendrier réduit aux seules impositions. « Ne pas toucher à `handleEnforceChange` » (§4.5) veut
dire préserver son *comportement observable*, ce qui imposait de suivre le déménagement de la
porte — l'interprétation littérale a produit une régression. Une ligne.

**2. `hasSolution` restait fondé sur `scheduleResult`.** Après un rechargement en vue solution
restaurée, il valait `false`, donc `selectable={!hasSolution}` réactivait la sélection de zone
bloquée alors qu'on n'est pas en préparation. Basculé sur `lastRun`.

**3. L'élagage « cours disparu » n'était pas appliqué aux `unplaced`.** Étendu.

**Une régression potentiellement grave trouvée en corrigeant le point 3.** L'élagage compare les
`taskId` persistés aux cours résolus pour la semaine. Or une liste de cours vide recouvre deux
situations indiscernables à cet endroit : la semaine n'a réellement aucun cours, ou `allCourses`
n'est pas encore disponible. Sans garde, le second cas **efface silencieusement tous les placements
et non-placés persistés**. Ajout de `canPrune = restoredCourseIds.size > 0` : on n'élague que si
des cours ont été résolus. Couvert par le cas 3bis, vérifié par mutation (retirer la garde le fait
échouer).

**Un manque à la source, hors du texte du plan.** `pruneWeekSavesOfCourseIds` (`lib/weekCourses.ts`)
élaguait `taskGroups`, `preNeutralizedKeys` et `manualEnforcedMap`, mais **pas** les nouveaux
champs : après un réimport CSV supprimant des cours, les placements et non-placés fantômes
restaient sur le disque indéfiniment. L'élagage défensif de `setSelectedWeek` les masque à
l'affichage, il ne les retire pas. Étendu aux trois champs, avec deux tests dans
`weekCourses.test.ts` (dont un vérifiant qu'un snapshot ancien garde ses champs absents).

Tests : 370 → **373**, tous passants. Les quatre contrôles de mutation rapportés par l'exécution
ont été acceptés tels quels ; deux mutations supplémentaires ont été faites en relecture (garde
`canPrune`, et vérification que les tests §6.2 existants mordent).

### §6.3 — volume (chiffres bruts)

Relevé de Frédéric : ~115 Ko pour le JSON d'une semaine. Vérification : ce chiffre mesure la
**vue formatée**, pas le contenu stocké — `_saveCurrentWeekSnapshot` passe par
`JSON.stringify(snapshot)` sans indentation.

Simulation sur la semaine 39 réelle (106 cours), snapshot complet avec `placements` + `lastRun`
+ `unplaced` :

```
compact (stocké)   : 39,8 Ko
formaté (affiché)  : 78,2 Ko   (rapport x1,97)
```

Le rapport ≈ 2 est structurel : les objets `resources` imbriqués à trois petits tableaux paient
cher l'indentation. Extrapolation à **35 semaines** (maximum réel d'une année de cours) :

```
35 x 39,8 Ko          = 1,36 Mo
+ reste du projet     ≈ 0,60 Mo
                        ───────
                        1,96 Mo   sur un quota de ~5 Mo
```

Réserve UTF-16 non levée : si le navigateur décompte le quota en unités UTF-16, l'occupation réelle
serait ~3,9 Mo — encore sous la limite, marge réduite. Se vérifie par
`new Blob(Object.entries(localStorage).flat()).size` comparé à la somme des `.length`. Sans
incidence sur la décision : on passe dans les deux cas.

### §6.4 — passe manuelle (Frédéric, 2026-07-21)

Points 1 à 5 conformes — dont le 1 (rechargement de page restaurant tout, vue solution comprise),
le 3 (« ↺ Réinitialiser » après rechargement, donc `lastRun` persisté fait bien le travail de
`scheduleResult`) et le 5 (violations dérivées, la couleur suit le déplacement).

**Point 6 — partiellement inatteignable.** On ne peut pas *créer* une zone bloquée en vue solution
(`selectable={!hasSolution}`). Le §4.5 n'est donc observable que par *déplacement* ou *suppression*
d'une zone existante, chemins bien accessibles (`handleBlockedZoneMove`/`handleBlockedZoneRemove`
en l.395/194 de `useCalendarCore.ts`). À noter, honnêtement : avant le correctif de relecture,
`hasSolution` valait `scheduleResult !== null` et redevenait donc faux après un rechargement — la
création de zone était accidentellement possible en vue solution restaurée. Le correctif a fermé
cette porte par cohérence, mais c'était la seule.

**Point 7 — formulation ambiguë du relecteur.** Frédéric a testé le glisser depuis la pioche :
c'est `addPlacement` (`origin: 'post-enforced'`), qui ne passe jamais par `handleEnforceChange` et
ne détruit rien — édition en place, jugée satisfaisante. Le geste visé était le déplacement d'une
tâche **déjà imposée** (pin), qui lui passe par `confirmEnforce` → `handleEnforceChange` et détruit
la solution. Comportement d'avant le chantier, préservé par le correctif `lastRun: null`.

**Point 8** non déroulé manuellement : couvert par le cas 2 de §6.2 (aucun `pre-enforced` ni
`user-pre` dans les champs persistés), vérifié par mutation.

**Portée réelle du chantier — voir la correction en tête du §6.4.** La persistance est correcte et
mesurée, mais l'UI n'offre aucun chemin pour changer de semaine sans passer par « Retour à la
préparation », qui détruit la solution. Le gain accessible aujourd'hui est la survie au
rechargement de page ; la survie au changement de semaine existe au niveau des données mais reste
hors d'atteinte. La fusion des vues préparation/solution devient donc la seconde moitié de la
demande d'origine.

---

**Branche :** `feature/persist-placements` — créée depuis master.
**Rôle :** conception validée (Opus/Frédéric) → exécution Sonnet.
**Statut :** §4 et §6.1-§6.3 faits. Reste §6.4 (passe manuelle, réservée à Frédéric).
**Prérequis livrés :** modèle unifié (94d745c, b2a94af, 6d27514) et stockage découpé par semaine
(cbc0caa). **Lire `docs/PlanSplitWeekStorage.md` avant de toucher à la sauvegarde.**

## 1. Objectif

C'est la demande d'origine : **revenir à la préparation ou changer de semaine ne doit plus effacer
une solution et les modifications qu'on lui a apportées.** Les six chantiers précédents ont levé
les obstacles ; il ne reste qu'à écrire deux listes dans le snapshot de semaine et à les relire.

### 1.1 Ce qui est déjà dérivé — et ce qui ne l'est pas encore

Les **conflits entre tâches** (`computeStaticConflicts`) sont déjà recalculés au rendu
(`useCalendarCore.ts` ~l.536). Les **violations de contrainte**, elles, sont **stockées** sur le
placement et calculées au seul moment du drag (l.292, 353, 433, 449). D'où le défaut : changer une
zone bloquée après coup laisse la couleur figée.

Décision (Frédéric) : **signaler, jamais supprimer.** Le correctif consiste donc à aligner les
violations sur les conflits — les dériver au rendu — et à **supprimer `constraintViolation` de
`Placement`**. On retire un champ stocké au lieu d'ajouter une logique d'invalidation.

Effet attendu : une tâche placée par le moteur puis recouverte par une zone bloquée devient rouge,
ce qui n'arrivait pas. Aucun bruit visuel introduit au moment du calcul, le moteur respectant les
contraintes par construction.

### 1.2 Ce qu'on refuse de dupliquer

Le snapshot persiste déjà `manualEnforcedMap` (les impositions) et `preNeutralizedKeys` (les
exclusions amont). Or ces données **sont** des placements `pre-enforced` et des non-placés
`user-pre`. Les persister une seconde fois dans les nouvelles listes créerait deux sources de
vérité pour la même chose.

Règle : **on ne persiste que ce qui n'est pas déjà couvert.**

| Origine | D'où elle vient à la relecture |
|---|---|
| `pre-enforced` (dont les propagés `derived`) | recalculée depuis `manualEnforcedMap` + `taskGroups` |
| `auto`, `post-enforced` | **nouveau champ `placements`** |
| `user-pre` | recalculée depuis `preNeutralizedKeys` |
| `engine`, `user-post` | **nouveau champ `unplaced`** |

Unifier `manualEnforcedMap` dans `placements` serait plus élégant, mais impose de toucher
`pruneWeekSavesOfCourseIds`, `copyWeekPrep` et `csvMerge`. **Hors périmètre** — à envisager plus
tard.

### 1.3 Le volume : à confirmer, sans inquiétude particulière

Estimation : ~150 placements par semaine chargée × ~150 octets ≈ 22 Ko, **doublés** par l'état
initial du calcul (§3) ≈ 45 Ko/semaine. Une année universitaire compte **au plus 35 semaines de
cours** (et non 52) : ~1,6 Mo, auxquels s'ajoutent les ~600 Ko du reste du projet, soit ~2,2 Mo
dans un quota localStorage de ~5 Mo par origine. Marge confortable — arbitrage Frédéric.

§6.3 demande néanmoins une mesure réelle, pour deux raisons : confirmer l'ordre de grandeur d'un
calcul fait au doigt mouillé, et lever une ambiguïté connue — selon les navigateurs, le quota se
compte en caractères UTF-16, ce qui peut doubler le coût réel par rapport au nombre d'octets
attendu. La mesure tranche ; le calcul non.

Le découpage par semaine (cbc0caa) a réglé le **coût d'écriture**, indépendamment du volume.

## 2. Non-objectifs

- **NE PAS** fusionner les vues préparation et solution (chantier séparé, à juger sur pièce).
- **NE PAS** absorber `manualEnforcedMap`/`preNeutralizedKeys` dans les nouvelles listes (§1.2).
- **NE PAS** persister `scheduleResult` : c'est un DTO d'API (`NormalizedSolution` est calqué sur
  la réponse HTTP). Le figer dans le fichier projet coupleraît le format de fichier à la forme de
  la réponse serveur — exactement le couplage supprimé par les identifiants stables. On persiste
  le modèle métier, qu'on possède déjà.
- **NE PAS** persister les métadonnées du bandeau (`score`, `provenOptimal`, `rootBound`) : elles
  décrivent *un calcul*, pas l'état courant, et mentent dès la première retouche (§4.6).
- **NE PAS** modifier `scheduler-core`, `scheduler-common`, `scheduler-api`.

## 3. Le format persisté

`PreparedWeekSnapshot` (`store/slices/weekSavesSlice.ts`) gagne trois champs **optionnels** :

```ts
  /** Placements `auto` et `post-enforced`. Les `pre-enforced` sont recalculés (§1.2). */
  placements?: Placement[];
  /** Non-placés `engine` et `user-post`. Les `user-pre` sont recalculés (§1.2). */
  unplaced?: Unplaced[];
  /**
   * Sortie brute du dernier calcul, pour « ↺ Réinitialiser » sans relancer le moteur.
   * Absent si aucun calcul n'a encore tourné pour cette semaine.
   */
  lastRun?: { placements: Placement[]; unplaced: Unplaced[] };
```

**`lastRun.placements` porte le combo de ressources, pas seulement le créneau** : le moteur choisit
parmi les alternatives (une salle parmi plusieurs, un enseignant parmi plusieurs) et ce choix n'est
pas redérivable. Le triplet nécessaire est `(taskId, startTime, resources)` — c'est-à-dire
exactement un `Placement`.

**Champs optionnels, donc pas de bump de version** : un snapshot ancien les a simplement absents et
se lit comme « aucun placement persisté » ; un fichier récent importé dans une version ancienne
voit les champs ignorés. La lecture doit être **défensive** (ne jamais faire confiance au typage
pour une donnée venue du disque), sur le modèle de `getManualCoursesForWeek` dans
`lib/weekCourses.ts`. `ProjectFileV1.formatVersion` reste à 1.

`Placement` et `Unplaced` sont déjà sérialisables tels quels (chaînes, nombres, tableaux) —
contrairement à `blockedZones`, aucune conversion `Date` ↔ ISO n'est nécessaire.

## 4. Changements de code

### 4.1 Violations dérivées — `hooks/useCalendarCore.ts`, `store/types.ts`

Supprimer `constraintViolation` de `Placement` et de tous ses points d'écriture (l.292, 353, 433,
449) et de lecture (l.41, 50, 75). Le calculer dans le mémo des événements, à côté de
`computeStaticConflicts` : `availabilityManager` et `week` y sont déjà disponibles.

Vérifier `updatePlacement` : les appels qui ne servaient qu'à poser la violation disparaissent
entièrement ; ceux qui déplacent la tâche restent. Attention à ne pas supprimer par mégarde la
bascule d'origine `auto` → `post-enforced` qui vit dans le store.

### 4.2 Sauvegarde — `store/usePlanningStore.ts`, `_saveCurrentWeekSnapshot`

Ajouter au snapshot :

```ts
placements: ps.placements.filter((p) => p.origin !== 'pre-enforced'),
unplaced:   ps.unplaced.filter((u) => u.origin !== 'user-pre'),
lastRun:    ps.lastRun ?? undefined,
```

Le filtre sur `pre-enforced` exclut mécaniquement les propagés (`derived`), qui sont tous
`pre-enforced` — pas de condition supplémentaire.

⚠️ La garde « ne pas créer de snapshot vide » (correctif `fafa8cb`) doit tenir compte des nouveaux
champs : une semaine sans préparation mais **avec des placements** n'est pas vide et doit être
sauvegardée.

### 4.3 Restauration — `store/usePlanningStore.ts`, `setSelectedWeek`

Branche « snapshot existant » : après avoir reconstruit les `pre-enforced` et les `user-pre` comme
aujourd'hui, **concaténer** les listes persistées :

```ts
placements: [...placementsFromEnforcedMap(restoredEnforcedMap, snapshot.manualEnforcedMap),
             ...(snapshot.placements ?? [])],
unplaced:   [...unplacedFromPreNeutralized(snapshot.preNeutralizedKeys),
             ...(snapshot.unplaced ?? [])],
lastRun:    snapshot.lastRun ?? null,
```

Dédupliquer par `placementId` et par `taskId` (via `dedupeUnplaced`, déjà là) : un cours à la fois
imposé et présent dans les placements persistés ne doit pas apparaître deux fois. **Les
`pre-enforced` recalculés priment** — même raisonnement que l'ordre de `dedupeUnplaced` : une
imposition perdue est plus grave qu'un placement auto perdu.

**Élaguer les placements dont le cours n'existe plus** (`courseById.get(taskId)` vide) : un
réimport CSV peut avoir supprimé le cours. Sans ça, un placement fantôme reste dans l'état sans
jamais s'afficher, et repart en sauvegarde indéfiniment.

### 4.4 Auto-save — le `subscribe`

Aujourd'hui la garde ne déclenche que sur les `pre-enforced` et les `user-pre`, précisément pour
éviter qu'un déplacement de tuile ne réécrive tout le projet. **Ce n'est plus nécessaire** : le
découpage par semaine ramène une écriture à ~2,4 Ko mesurés. La garde se simplifie donc — sauver
dès que `placements`, `unplaced`, `taskGroups`, `blockedZones` ou `manualEnforcedMap` changent.

Retirer les comparaisons `JSON.stringify` de `enforcedChanged`/`userPreChanged`, devenues inutiles.
C'est une **simplification**, pas un ajout : le dire au checkpoint.

### 4.5 Invalidation — arrêter de détruire

`handleBlockedZoneAdd` et `handleBlockedZoneMove` remettent aujourd'hui `scheduleResult` à `null`
et reconstruisent les placements depuis les seules impositions — donc **détruisent** les placements
auto et retouchés. C'est exactement ce que la décision « signaler, jamais supprimer » interdit.

Les deux ne doivent plus toucher ni `placements`, ni `unplaced`, ni `scheduleResult`. Les couleurs
suivront d'elles-mêmes (§4.1). Idem pour un changement de contraintes de ressource.

**Point laissé ouvert, à trancher au checkpoint :** `handleEnforceChange` détruit aussi les
placements. Ce n'est pas une contrainte au sens de la décision mais une imposition, et ça relève
plutôt de la fusion des vues. Ma préférence : **ne pas y toucher dans ce chantier**, pour garder
le périmètre serré — mais le signaler explicitement plutôt que de laisser une incohérence tacite.

### 4.6 Mode et bandeau — `store/usePlanningStore.ts`, `SidebarLeft.tsx`

`SidebarLeft` bascule sur `scheduleResult !== null`, qui n'est **pas** persisté : après
rechargement, l'utilisateur verrait la préparation alors que ses placements sont là. La bascule
doit donc se fonder sur une donnée persistée — **`lastRun !== null`**.

`resetCurrentSolution` lit désormais `lastRun` au lieu de `scheduleResult.solution`, et survit donc
au rechargement — c'est un gain, pas seulement une adaptation.

`applyPendingResult` renseigne `lastRun` en même temps que `placements`/`unplaced`.

Bandeau : après un calcul, `buildScheduleStatus` reste inchangé (les métadonnées sont fraîches en
session). Après rechargement il n'y a plus de `scheduleResult` : afficher un statut reconstruit
depuis les données — « N cours placés, M non placés » — sans prétendre à l'optimalité.

## 5. CHECKPOINT feu-vert (obligatoire — s'arrêter ici)

- diff complet ; `npm run typecheck --workspace=packages/scheduler-client` propre ;
- `grep -rn "constraintViolation" packages/scheduler-client/{app,components,hooks,lib,store}` :
  attendu **zéro** (le champ est supprimé, la valeur est dérivée dans le mémo) ;
- confirmation que **rien de `pre-enforced` ni de `user-pre` n'est écrit** dans les nouveaux champs
  (montrer les deux filtres) ;
- confirmation que la garde d'auto-save a été **simplifiée** et non étendue ;
- l'arbitrage §4.5 sur `handleEnforceChange`.

## 6. Validation

### 6.1 Non-régression automatisée
`npm run test --workspace=packages/scheduler-client` (363 attendus), `typecheck` racine, `lint`
(27 problèmes préexistants), `build`. Les tests existants sur `emptySnapshot`, `unplacedPersistence`
et `projectStorage` **doivent passer sans être affaiblis** — s'ils échouent, c'est un signal.

### 6.2 Tests ciblés à écrire
1. Aller-retour complet : placements des trois origines + non-placés des trois origines →
   sauvegarde → `setSelectedWeek` ailleurs puis retour → état identique, chaque origine restaurée
   depuis la bonne source.
2. **Aucun `pre-enforced` ni `user-pre` dans le snapshot écrit** (c'est la non-duplication du §1.2).
3. Un placement dont le cours a disparu est élagué à la restauration, et ne repart pas en
   sauvegarde.
4. Déduplication : un cours à la fois imposé et présent dans `placements` persistés → une seule
   entrée, l'imposition l'emporte.
5. `lastRun` restauré permet à `resetCurrentSolution` de fonctionner **sans** `scheduleResult`
   (simuler un rechargement).
6. Un snapshot ancien (sans les trois champs) se lit sans erreur, avec des listes vides.
7. Une semaine sans préparation mais avec des placements **est** sauvegardée (garde du §4.2).
8. Ajouter une zone bloquée par-dessus un placement **ne le supprime pas** (§4.5).

### 6.3 Mesure du volume (obligatoire — §1.3)
Sur le projet réel ré-exporté : planifier 3 semaines chargées, puis relever la taille de chaque clé
`edt-project:week:*` et le total occupé. Extrapoler à **35 semaines** (maximum réel d'une année de
cours). Relever aussi, si le navigateur le permet, l'écart entre le nombre de caractères et
l'occupation réellement décomptée du quota. **Rapporter les chiffres bruts**, sans conclure.

### 6.4 Passe manuelle (Frédéric)

> **Correction du relecteur (2026-07-21).** Le point 1 exigeait initialement « changer de semaine
> et revenir : tout est là ». **Ce scénario est inatteignable par l'UI actuelle** : le sélecteur de
> semaine vit dans `SidebarPreparation`, que `SidebarLeft` n'affiche que si `lastRun === null`.
> Changer de semaine impose donc de passer par « ← Retour à la préparation », qui appelle
> `returnToPreparation([])` — lequel vide délibérément les placements `auto`/`post-enforced` **et
> l'écrit sur le disque**.
>
> Mesuré : un changement de semaine **direct** restaure les placements à leur position retouchée
> avec `lastRun` intact ; le même changement **via le retour à la préparation** rend 0 placement et
> `[]` sur le disque. La persistance est donc correcte — c'est le chemin utilisateur qui manque.
>
> Conséquence : la demande d'origine n'est qu'à moitié satisfaite tant que le sélecteur de semaine
> reste enfermé dans la vue préparation. **La fusion des vues devient la seconde moitié du
> chantier, pas une piste optionnelle.**

1. Planifier, retoucher deux tâches, en neutraliser une, **recharger la page (F5)** : tout est là,
   à l'identique, et la vue reste en mode solution. *C'est la démonstration accessible aujourd'hui.*
2. Changer de semaine et revenir **passe forcément par le retour à la préparation** : vérifier que
   le comportement est celui d'avant ce chantier (solution perdue, préparation conservée) — donc
   aucune régression, mais pas encore le gain visé.
3. « ↺ Réinitialiser » après rechargement : retour à l'état moteur.
4. Ajouter une zone bloquée par-dessus une tâche placée : elle **reste en place** et **change de
   couleur**.
5. Déplacer une tâche sur une plage indisponible : couleur immédiate. La déplacer à nouveau sur
   une plage libre : la couleur disparaît.
6. « ← Retour à la préparation », puis replanifier : comportement inchangé.
7. Exporter le projet : les placements figurent dans `weekSaves`, sans doublon d'imposition.

## 7. Fichiers touchés (récapitulatif)

| Fichier | Nature |
|---|---|
| `store/types.ts` | §4.1 suppression de `constraintViolation` |
| `hooks/useCalendarCore.ts` | §4.1 violations dérivées au rendu |
| `store/slices/weekSavesSlice.ts` | §3 trois champs optionnels |
| `store/usePlanningStore.ts` | §4.2 à §4.6 |
| `components/planning/sidebar/SidebarLeft.tsx` | §4.6 bascule sur `lastRun` |
| tests vitest | §6.2 |

## 8. Ce que l'exécution rapporte

**STATUT** en tête de ce document : faits bruts uniquement — diff conforme ou non et où il s'en
écarte, compteurs de tests avant/après, sorties de grep, **chiffres bruts de §6.3**, arbitrages
retenus. **Ne pas** écrire « vérifié », « validé », « corrigé » ni conclure sur le gain : les
conclusions sont écrites au retour par le relecteur.
