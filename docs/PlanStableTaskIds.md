# Plan d'implémentation — identifiants de tâches stables de bout en bout

## STATUT (exécution Sonnet, 2026-07-21)

Branche `refactor/stable-task-ids` créée depuis `master` (HEAD `0abeb7f` au moment du checkout).
§3.1 à §3.4 implémentés. CHECKPOINT §4 franchi (feu vert Frédéric, 2026-07-21). §5.1 à §5.4
faits — voir ci-dessous. Non committé à ce stade (attente d'instruction explicite).

**Diff :** 12 fichiers de code + 1 nouveau test, par package :
- `scheduler-common` : `src/types.ts`, `src/schedulerData.ts` (§3.1).
- `scheduler-core` : `src/schedulingUnit.ts`, `src/taskUnit.ts`, `src/taskGroupUnit.ts`,
  `src/scheduler.ts`, `src/optionalTasksScheduler.ts` (§3.2) + `__tests__/schedulerOptionalTasks.test.ts`,
  `__tests__/schedulerEliminationDependents.test.ts` (assertions existantes corrigées) +
  `__tests__/initTasksStableId.test.ts` (nouveau, §5.2).
- `scheduler-client` : `hooks/useCalendarCore.ts` (§3.3), `lib/api/scheduleApi.ts`,
  `lib/taskGroupUtils.ts`, `store/usePlanningStore.ts` (§3.4).

**Écart au plan constaté pendant §3.2 :** le plan annonçait « cinq sites d'affichage — et à eux
seuls ». `npm run test --workspace=packages/scheduler-core` après les 5 sites prévus donnait
2 échecs, pas 0 : `schedulerOptionalTasks.test.ts:189` (le piège connu du plan) échouait encore
même après le correctif prescrit (`cm.unit.label`), et `schedulerEliminationDependents.test.ts:72`
(non mentionné par le plan) échouait aussi. Cause commune : `cascadeReason()` dans
`optionalTasksScheduler.ts` (deux appels, ~l.294 et ~l.482) construit la même chaîne `reason`
visible utilisateur à partir de `dep.id`/`root.id`, hors de l'énumération des 5 sites. Signalé à
Frédéric avant d'agir ; il a validé l'extension. Après extension aux 7 sites réels (5 prévus + 2
`cascadeReason`) et correction de l'assertion non anticipée, `scheduler-core` repasse à 0 échec.
Aucun `unit.id` servant de clé (`_scheduled`, `_failureCounts`, `_skippedSet`, `counts`, `removed`)
n'a été touché — vérifié ligne par ligne sur le diff final.

**Variante retenue pour `RunScheduleParamsFromData.courses` (§3.4) :** resserré en
`CourseTaskDataWithId[]` ; le garde `course.id !== undefined ?` a pu être supprimé proprement (TS
le permet). Effet de bord mécanique non prévu explicitement par le plan : `buildTaskGroupData`
(`taskGroupUtils.ts`) devait aussi changer son type de retour de `CourseTaskData[]` vers
`CourseTaskDataWithId[]` pour que `npm run typecheck --workspaces` passe (sinon `source`, champ
requis de `CourseTaskDataWithId`, était perdu au niveau du type alors que présent à l'exécution).

**Typecheck** (`npm run typecheck --workspaces`) : propre sur les 4 packages, au checkpoint et
après §5.

**Grep de contrôle** (`grep -rn "getCourseFromTaskId\|idToNewIdx\|remappedEnforced"
packages/scheduler-client --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out`) :
zéro occurrence.

### §5.1 — Non-régression automatisée
- `scheduler-core` : 133/133 avant (`master`, inchangé — seules 2 assertions de test modifiées,
  voir écart ci-dessus) et après (avant ajout §5.2) ; 137/137 après ajout des 4 tests §5.2.
- `scheduler-client` : 302/302 avant (`master`, via `git stash`) et après — compteur identique.
- `npm run lint --workspace=packages/scheduler-client` : 29 problèmes (7 erreurs, 22 warnings)
  avant (`master`) **et** après (branche) — identique, aucune régression. Les 7 erreurs sont
  réparties sur 3 fichiers hors diff : `components/config/TightThresholdBlock.tsx`
  (`react/no-unescaped-entities`), `components/constraints/ResourceConstraintEditor.tsx` (setState
  synchrone dans un effet), `components/planning/courses/TaskCard.tsx` (composants créés pendant
  le render).

### §5.2 — Test ciblé `initTasks`
Nouveau fichier `packages/scheduler-core/__tests__/initTasksStableId.test.ts`, 4 cas (id fourni,
sans id, mélange, doublon → erreur), via `Loader.loadFromRawData` +
`Loader.tasksManager.getAllUnits()`. 4/4 verts.

### §5.3 — Invariance moteur sur projet réel
Écart au plan, décidé avec Frédéric : réutilisation de l'export existant
`packages/scheduler-core/data/Planification MMI_2026-07-16_10-13.json` (2026-07-16) plutôt que
« RE-EXPORTER d'abord » comme demandé littéralement — le projet n'avait pas bougé depuis.

Méthode : script jetable (`examples/compareStableId-tmp.ts`, créé puis supprimé après usage) qui
reproduit le pipeline `usePlanningStore.runSchedule` (filtrage pré-neutralisées, `buildTaskGroupData`,
`computeGroupEnforcements`, `filterResourcesForCourses`, attache des enforced en mode `master`
[index, remappé] ou `branch` [id, direct]), puis appelle directement `Loader.loadFromRawData` +
`createScheduler(...).solveWithElimination()` — une fois via un `git worktree` sur `master` (avec
`node_modules` copié pour préserver les symlinks workspace vers le code de `master`), une fois sur
la branche. Corrélation cours↔résultat faite via `Loader.tasksManager.getAllUnits()` (ordre
préservé depuis `initTasks`), pas via le `taskId` moteur.

- **Semaine 39** (3 pré-neutralisées, 10 impositions, 3 cours manuels, 3 groupes de tâches) :
  106 cours placés des deux côtés, 0 neutralisé, score 103 identique, **0 différence de
  `startTime`/ressources sur les 106 cours**, ensembles de neutralisés identiques (vides).
- **Semaine 45** (5 pré-neutralisées, 15 impositions, sans groupes) : 94 cours placés des deux
  côtés, 0 neutralisé, score 94 identique, 1341 itérations identiques des deux côtés, **0
  différence cours par cours**.
- Semaine 36 : le script a dépassé 60s sans terminer sur cette semaine ; non retenue, non
  investiguée davantage (hors scope — les deux autres semaines couvrent déjà pré-neutralisation +
  impositions + groupes).

### §5.4 — Passe manuelle (bug §1.2)
Faite par Frédéric lui-même sur la semaine 40 (3 cours pré-neutralisés + 4 réellement neutralisés
par le moteur pendant l'élimination : SAÉ 5.Crea.01 TP, R3.04 TD Culture numérique, R1.08 TP
Production graphique ×2 — identifiés via le même script que §5.3).

Rapporté par Frédéric : points 1 et 2 confirmés (sur la branche, glisser une des tâches réellement
neutralisées ouvre `EnforceModal` avec les bonnes alternatives). Point 3 (reproduction du
comportement fautif sur `master`) : **Frédéric n'a pas pu reproduire le problème de ressources sur
master** dans ce scénario.

#### Élucidation du point 3 (relecteur, 2026-07-21)

Le bug est bien présent sur `master` et **la tâche testée était affectée** ; le symptôme est
silencieux, pas absent. Vérifié analytiquement sur l'export
`packages/scheduler-core/data/Planification MMI_2026-07-16_10-13.json`, en rejouant hors UI la
résolution de `getCourseFromTaskId` (`parsed[N-1]` avec `N` = index dans la liste filtrée) :

| Semaine | Cours | Pré-neutr. (1re position) | Mal résolus | dont structure d'alternatives différente |
|---|---|---|---|---|
| S38 | 113 | 3 (pos. 94) | 16/110 | 4 |
| S39 | 109 | 3 (pos. 84) | 22/106 | 3 |
| S40 | 110 | 3 (pos. 88) | 19/107 | 3 |
| S45 | 99 | 5 (pos. 77) | 17/94 | 3 |

Sur S40, `SAÉ 5.Crea.01 TP [BUT3-G1]` résout vers `SAÉ 5.Crea.01 TD [BUT3-G1/BUT3-G2]` :

```
attendu   rooms=[["115","102"]]  teacher=["PASQUIER Aurore"]
proposé   rooms=[["115","102"]]  teacher=["AUBRY Bastien"]
```

Les salles coïncident par hasard et `hasAlts` vaut `true` des deux côtés : la modale s'ouvre
normalement, avec le bon choix de salles. Seul l'enseignant est faux — et pas seulement à
l'affichage : `EnforceModal` reçoit `course={pendingNeutralizedDrop.course}`, et la sélection
confirmée est écrite telle quelle par `addPlacedNeutralizedTask`. Les deux autres cibles testées
(`R1.08 TP`, `R3.04 TD`) sont en positions antérieures à la 1re pré-neutralisée : résolution
correcte, hors périmètre du bug.

Défaut du protocole §5.4 tel qu'écrit (imputable au plan, pas à l'exécution) : il demandait « une
semaine avec ≥1 cours pré-neutralisé » sans exiger que la tâche glissée soit **postérieure** à la
première pré-neutralisée **et** de structure de ressources différente du cours décalé. Sans ces
deux conditions, on tombe presque toujours sur un cas silencieux.

### Correctif de relecture (2026-07-21) — `filterResourcesForCourses`

Écart au plan non signalé par l'exécution : §3.4 a fait passer `enforcedMap` **complet** à
`filterResourcesForCourses`, là où `remappedEnforced` était implicitement restreint aux cours
conservés (la boucle de remapping écartait les ids absents d'`idToNewIdx`). Une ressource
référencée uniquement par une imposition portant sur un cours pré-neutralisé rentrait donc dans le
payload — précisément ce que ce filtrage existe pour éviter (avertissements « ressource non trouvée
dans les contraintes », poids du payload). Sans effet sur le placement, donc invisible dans
l'invariance §5.3. Corrigé par un `keptEnforced` restreint à `keptIds`. `submitParams.enforcedMap`
reste inchangé : `_buildPayload` n'itère que sur les cours réellement envoyés.

**Branche :** `refactor/stable-task-ids` — **à créer depuis master, ne pas travailler sur master.**
**Rôle :** conception validée (Opus/Frédéric) → exécution Sonnet.
**Statut :** À IMPLÉMENTER.
**Contexte :** prérequis isolé du chantier « modèle unifié de placements » (voir §1). Se merge seul
et corrige au passage un bug réel. Le modèle unifié et la persistance des solutions viennent après,
dans des plans séparés.

## 1. Objectif

Le `taskId` produit par le moteur est **positionnel** : `initTasks` le fabrique comme
`${code}_${enseignants}_${groupes}_${compteur}`, où le compteur est l'index du cours dans le
tableau envoyé au moteur. Toute correspondance `taskId → cours` côté client est donc fragile par
construction, et elle est **déjà cassée** (voir §1.2).

On fait porter au moteur l'identifiant stable que le client possède déjà (`CourseTaskDataWithId.id`
— hash djb2 de la clé d'identité + suffixe d'occurrence, ou `m_<ts>_<rand>` pour les cours manuels).
Un seul espace d'identifiants du client au moteur et retour ; la correspondance `taskId → cours`
disparaît en tant que concept, au lieu d'être matérialisée et transportée.

### 1.1 Le champ est déjà sur le fil

Vérifié : le client ne strippe rien. `buildTaskGroupData` fait `courses.map(c => …)` en préservant
les objets, `_buildPayload` ne fait qu'ajouter `enforced`, et côté serveur
[`loader.ts:94`](../packages/scheduler-core/src/loader.ts) passe `data.courses` **tel quel** à
`initTasks`. `id` et `source` voyagent donc déjà dans chaque requête et sont ignorés. Ce chantier
ne « étend » pas l'API : il **consomme un champ déjà transmis**.

### 1.2 Le bug corrigé au passage

`getCourseFromTaskId` ([`useCalendarCore.ts`](../packages/scheduler-client/hooks/useCalendarCore.ts),
~l.157) parse le compteur en fin de `taskId` et fait `parsedCourses[N - 1]`. Or `parsedCourses` est
la liste **complète** de la semaine, alors que le compteur moteur est l'index dans la liste
**filtrée des pré-neutralisées** (`runSchedule` retire `preNeutralizedKeys` avant l'envoi). Dès
qu'un cours est pré-neutralisé, toute tâche d'index moteur supérieur résout vers le **mauvais
cours** : au drop d'une tâche neutralisée sur le calendrier, la détection d'alternatives
salle/enseignant porte sur un autre cours, donc `EnforceModal` propose les mauvaises ressources ou
ne s'ouvre pas alors qu'il le faudrait. `buildTaskGroupData` préserve l'ordre — le filtrage est la
seule cause.

### 1.3 Neutralité vis-à-vis du moteur

Vérifié exhaustivement : le `taskId` est **opaque** dans tout `scheduler-core`. `TaskUnit.id`
retourne `task.id` sans le lire ; `rootLowerBound` ne fait que le collecter dans les certificats ;
`serializeScheduler` le recopie. Il sert de **clé de Map** (`_scheduled`, `_failureCounts`,
`_conflictStamps`, `_skippedSet`) et de chaîne d'affichage, jamais de valeur comparée : aucun
comparateur ne départage par id (`_units.sort` trie sur `isEnforced`, `_dynamicSort` sur
`getSchedulingPriority`, `_conflictStamps` compare des compteurs, et le `[...ids].sort()` de
`rootLowerBound` porte sur des ids de **ressources** pour une clé de déduplication).

**Conséquence, qui sert de critère de validation (§5.3) : à entrée identique, le moteur doit
produire exactement les mêmes placements qu'avant — mêmes créneaux, mêmes ressources, mêmes
neutralisations. Seules les chaînes `taskId` changent.**

## 2. Non-objectifs (ne pas toucher à ce stade)

- **NE PAS** introduire le modèle unifié de placements (`origin: pre-enforced | auto |
  post-enforced`, les trois origines de neutralisation, les placements référençant les tâches).
  C'est le chantier suivant. Ici on ne change **que** l'espace d'identifiants.
- **NE PAS** toucher à la convention `pre-neutral-<id>` des entrées synthétiques ni au test
  `taskId.startsWith('pre-neutral-')` de `SidebarAnalysis` : elle disparaîtra avec le champ
  `origin`, pas maintenant.
- **NE PAS** persister quoi que ce soit. `usePlanningStore` reste un store de session.
- **NE PAS** modifier la logique de placement, de score, de neutralisation ou de borne inférieure.
- **NE PAS** changer le format d'id côté client (`csvCourseId`/`manualCourseId` restent tels quels).

## 3. Changements de code

### 3.1 `scheduler-common` — accepter l'identifiant fourni

**`src/types.ts`, `CourseTaskData`** — ajouter le champ, optionnel :

```ts
  /**
   * Identifiant stable fourni par l'appelant. Quand il est présent, il devient le `taskId` de la
   * tâche, de bout en bout jusqu'à la réponse JSON. Absent (fixtures, scripts d'essai), on retombe
   * sur l'identifiant positionnel historique.
   */
  id?: string;
```

**`src/schedulerData.ts`, `initTasks`** (~l.122-125) — consommer le champ :

```ts
this._taskCounter++;
const teacherIds = courseData.teacher.flat().join('_');
const fallbackId = `${courseData.code}_${teacherIds}_${courseData.groups.flat().join('_')}_${this._taskCounter}`;
const taskId = courseData.id ?? fallbackId;
```

Garder `_taskCounter` : il alimente le repli et ne doit pas changer de sémantique.

**Garde d'unicité** — le compteur garantissait l'unicité par construction ; l'identifiant fourni
non. Avant la boucle de création (ou en tête d'`initTasks`), échouer bruyamment sur doublon, sur le
modèle de `Loader.validateEnforcedCourses` :

```ts
const providedIds = courses.filter(c => c.id !== undefined).map(c => c.id!);
const dup = providedIds.find((id, i) => providedIds.indexOf(id) !== i);
if (dup !== undefined) {
  throw new Error(`initTasks : identifiant de cours dupliqué « ${dup} » — les id fournis doivent être uniques dans la semaine.`);
}
```

### 3.2 `scheduler-core` — libellé d'affichage distinct de l'identité

Avec un hash opaque (`k3f9a2`), les messages du moteur deviennent illisibles. Le point sensible
n'est pas le log de debug mais [`scheduler.ts:226`](../packages/scheduler-core/src/scheduler.ts) :
la chaîne `reason` remonte dans `NeutralizedTaskInfoJSON.reason` et s'affiche **dans le tooltip
utilisateur** de la pioche. Sans libellé, l'utilisateur lirait « Dépend de « k3f9a2 » ».

**`schedulingUnit.ts`, `ISchedulingUnit`** — ajouter `readonly label: string;` avec un commentaire
disant que c'est une chaîne d'**affichage** (logs, messages d'erreur, `reason` visible par
l'utilisateur) et jamais une clé.

**`taskUnit.ts`** — `get label(): string { return \`${this.task.code} ${this.task.type}\`; }`

**`taskGroupUnit.ts`** — libellé dérivé des membres, ex.
`` `groupe [${this._tasks.map(t => `${t.code} ${t.type}`).join(', ')}]` ``.

**Remplacer `id` par `label` aux cinq sites d'affichage — et à eux seuls** :
`scheduler.ts` l.214 (log d'élimination), **l.226 (`reason`, visible utilisateur)**, l.296 (message
d'erreur de dépendance), l.309 (log d'itération) ; `optionalTasksScheduler.ts` l.343 (message
d'erreur de dépendance). **Ne toucher à aucun `unit.id` servant de clé de Map ou de Set**
(`_scheduled`, `_failureCounts`, `_conflictStamps`, `_skippedSet`).

⚠️ **Piège connu, à traiter et à rapporter** : `__tests__/schedulerOptionalTasks.test.ts` l.189
asserte `expect(td.reason).toContain(cm.unit.id)`. Le changement de l.226 la fait échouer —
mettre à jour l'assertion en `toContain(cm.unit.label)`. En revanche le helper l.17
(`units.find(u => u.id.startsWith(codePrefix))`) continue de fonctionner : ces fixtures n'ont pas
de champ `id`, donc le repli positionnel s'applique et les ids gardent leur forme historique.

### 3.3 `scheduler-client` — supprimer la résolution par index

**`hooks/useCalendarCore.ts`** — supprimer `getCourseFromTaskId` (~l.155-164) et remplacer son
unique appel (~l.256) par une résolution directe dans la map déjà construite dans ce hook :

```ts
const originalCourse = courseById.get(taskId) ?? null;
```

`courseById` est déjà présent (utilisé l.294 `courseById.get(courseKey)`). Vérifier qu'il est bien
construit sur `parsedCourses` avec `buildCourseMap`, et que la suite (`hasAlts`,
`hasMultipleRooms`, `setPendingNeutralizedDrop`) fonctionne inchangée — seule la **source** du
cours change, pas son usage.

Le garde `if (taskId.startsWith('pre-neutral-')) return null;` disparaît naturellement : un
`pre-neutral-<id>` n'est pas une clé de `courseById`, donc `.get()` retourne `undefined` → `null`.
Comportement identique, sans parsing.

### 3.4 `scheduler-client` — impositions par identifiant, non par position

Second couplage positionnel, indépendant du premier : `_buildPayload` attache les impositions par
**index de tableau** (`enforcedMap[String(i)]`), ce qui oblige `runSchedule` à pré-calculer
`remappedEnforced[String(newIdx)]`.

**`lib/api/scheduleApi.ts`, `_buildPayload`** (~l.51-55) :

```ts
const coursesWithEnforced = courses.map((course) => {
  const enforced = course.id !== undefined ? enforcedMap[course.id] : undefined;
  return enforced ? { ...course, enforced } : course;
});
```

Resserrer au passage le typage de `RunScheduleParamsFromData.courses` en
`CourseTaskDataWithId[]` (le client n'envoie jamais autre chose) — ça rend `course.id` non
optionnel au point d'usage et supprime le garde ci-dessus si TS le permet proprement. Signaler au
checkpoint la variante retenue.

**`store/usePlanningStore.ts`, `runSchedule`** (~l.327-353) : supprimer `idToNewIdx` et
`remappedEnforced`, passer `enforcedMap` tel quel (déjà clé par `course.id`). `idToNewIdx` ne
servait plus qu'à deux choses :
- filtrer les `courseKeys` des `taskGroups` → remplacer par un `Set<string>` des ids **conservés**
  (non pré-neutralisés) : `remappedTaskGroups` devient un simple filtre `keptIds.has(k)` ;
- construire `remappedEnforced` → disparaît.

**Aucun changement** requis dans `filterResourcesForCourses` : vérifié, elle n'itère que sur
`Object.values(enforcedMap)` et ne lit jamais les clés.

### 3.5 Ordre de travail suggéré

1. §3.1 (common) puis §3.2 (core) — le moteur seul, tests `scheduler-core` verts avant d'aller plus loin.
2. §3.3 puis §3.4 (client).
3. `npm run typecheck` à la racine (`--workspaces`) entre chaque étape.

## 4. CHECKPOINT feu-vert (obligatoire — s'arrêter ici)

Faire valider par Frédéric **avant** d'écrire le moindre test :

- diff complet, par package ;
- `npm run typecheck` racine (attendu : propre sur les 4 packages) ;
- confirmation explicite qu'**aucun `unit.id` servant de clé** n'a été remplacé par `label`, avec
  la liste des sites effectivement modifiés ;
- `grep -rn "getCourseFromTaskId\|idToNewIdx\|remappedEnforced" packages/scheduler-client --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out`
  (attendu : zéro) ;
- la variante retenue pour le typage de `RunScheduleParamsFromData` (§3.4).

## 5. Validation (dimensionnée à ce que le changement peut affecter)

Le changement touche l'identité des tâches dans les 4 packages, mais **ne doit rien changer au
comportement** (§1.3). La validation est construite autour de cette invariance.

### 5.1 Non-régression automatisée
- `npm run test --workspace=packages/scheduler-core` — c'est la suite critique : elle couvre le
  placement, l'élimination, les dépendances, la borne inférieure. Rapporter les compteurs
  avant/après. **Attendu : une seule modification de test, celle du §3.2 (l.189).** Toute autre
  rupture est un signal, pas un test à ajuster : la rapporter sans la « réparer ».
- `npm run test --workspace=packages/scheduler-client` (302 tests attendus) et
  `npm run typecheck` racine.
- `npm run lint --workspace=packages/scheduler-client` — rapporter le compte avant/après.

### 5.2 Test ciblé à écrire (nouveau, `scheduler-core`)
Sur `initTasks` :
1. cours **avec** `id` → `task.id` vaut exactement cet id (et non le format positionnel) ;
2. cours **sans** `id` → format positionnel historique inchangé (garantit les fixtures) ;
3. mélange des deux dans la même semaine → chacun son régime ;
4. deux cours avec le **même** `id` → `initTasks` lève l'erreur d'unicité.

### 5.3 Invariance moteur sur projet réel (le vrai critère)
**RE-EXPORTER d'abord le projet réel.** Sur **une** semaine chargée, avec la config réelle :
- planifier sur `master` et sur la branche, avec les mêmes données et la même config ;
- comparer les deux résultats **par cours** (et non par taskId, qui change par construction) :
  pour chaque cours, `startTime` et l'ensemble des ressources retenues doivent être identiques, et
  l'ensemble des cours neutralisés doit être le même.
- Un écart n'est pas « du bruit » : il signifierait qu'une dépendance à la forme de l'id a été
  ratée. Le rapporter tel quel, sans le contourner.

Un seul batch loggé, un seul réveil à la fin.

### 5.4 Passe manuelle — le bug de §1.2
Sur une semaine où **au moins un cours est pré-neutralisé** (condition indispensable pour
reproduire) :
1. planifier ;
2. glisser une tâche neutralisée depuis la pioche vers le calendrier ;
3. vérifier que `EnforceModal` s'ouvre avec les alternatives **du bon cours** (salles/enseignants),
   et qu'un cours sans alternative n'ouvre pas la modale ;
4. refaire la même manipulation sur `master` pour constater le comportement fautif — c'est ce qui
   documente la correction.

## 6. Fichiers touchés (récapitulatif)

| Fichier | Nature |
|---|---|
| `scheduler-common/src/types.ts` | §3.1 champ `id?` |
| `scheduler-common/src/schedulerData.ts` | §3.1 consommation + garde d'unicité |
| `scheduler-core/src/schedulingUnit.ts` | §3.2 `label` dans l'interface |
| `scheduler-core/src/taskUnit.ts`, `taskGroupUnit.ts` | §3.2 implémentations de `label` |
| `scheduler-core/src/scheduler.ts`, `optionalTasksScheduler.ts` | §3.2 5 sites d'affichage |
| `scheduler-core/__tests__/schedulerOptionalTasks.test.ts` | §3.2 assertion l.189 |
| `scheduler-client/hooks/useCalendarCore.ts` | §3.3 suppression de `getCourseFromTaskId` |
| `scheduler-client/lib/api/scheduleApi.ts` | §3.4 impositions par id |
| `scheduler-client/store/usePlanningStore.ts` | §3.4 suppression du remapping |
| tests `scheduler-core` | §5.2 nouveaux cas `initTasks` |

## 7. Ce que l'exécution rapporte

Écrire un **STATUT** en tête de ce document à la fin : faits bruts uniquement — diff conforme ou
non au plan et où il s'en écarte, compteurs de tests avant/après par package, sorties de grep,
résultat de la comparaison §5.3 **cours par cours**, observations de la passe manuelle §5.4.
**Ne pas** écrire « vérifié », « validé », « corrigé » ni attribuer un gain : les conclusions sont
écrites au retour par le relecteur (Opus, Fable ou Frédéric).
