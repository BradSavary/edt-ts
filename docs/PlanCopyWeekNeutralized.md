# Plan — Copier la préparation d'une semaine : 3ᵉ étape « tâches neutralisées »

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant. Il **ajoute une étape**
> au flux existant `CopyWeekPrepModal` (enforced → groupes), sans toucher aux deux premières.
> Aucun nouveau format de persistance, aucune option de configuration.

## 0. État des lieux (vérifié, ne pas rouvrir)

**Ce qu'est une « tâche neutralisée ».** Une exclusion amont décidée par l'utilisateur en mode
préparation : le cours n'est jamais envoyé au moteur
([`runSchedule`, filtrage §3.3](../packages/scheduler-client/store/usePlanningStore.ts#L506-L515)).

| Où | Représentation |
| --- | --- |
| En mémoire (semaine courante) | `usePlanningStore.unplaced`, entrées `{ taskId, origin: 'user-pre' }` |
| Sur disque (snapshot semaine) | `PreparedWeekSnapshot.preNeutralizedKeys: string[]` |
| Bascule UI | [`togglePreNeutralized(courseKey)`](../packages/scheduler-client/store/usePlanningStore.ts#L320-L329), depuis [`CourseCard`](../packages/scheduler-client/components/planning/courses/CourseCard.tsx#L41) |

Les clés sont des **`course.id`**, exactement comme les clés de `manualEnforcedMap` et les
`courseKeys` des groupes. Le mécanisme d'appariement source→destination existant
(`courseSimilarityKey`) s'y applique donc **tel quel**, sans adaptation.

**Persistance : rien à faire.** `preNeutralizedKeys` est re-dérivé de `unplaced` à chaque auto-save
([`_saveCurrentWeekSnapshot`](../packages/scheduler-client/store/usePlanningStore.ts#L1020)), et le
`subscribe` se déclenche sur tout changement de **référence** de `state.unplaced`
([garde](../packages/scheduler-client/store/usePlanningStore.ts#L1084-L1092)). Muter `unplaced`
suffit à persister.

**Indépendance des trois étapes.** Neutralisation, imposition et groupes vivent dans trois
structures disjointes (`unplaced` / `manualEnforcedMap` / `taskGroups`) et ne se nettoient pas
mutuellement — c'est explicite dans le
[commentaire de `runSchedule`](../packages/scheduler-client/store/usePlanningStore.ts#L522-L523) :
« Un cours peut être à la fois exclu et imposé ». L'ordre d'application dans `handleApply` est donc
sans effet ; voir §4.3 pour la conséquence produit.

## 1. Couche données — `lib/copyWeekPrep.ts`

### 1.1 Étendre `relevantSourceCourseIds`

Ajouter `snapshot.preNeutralizedKeys` **en dernier**, après les clés enforced puis les membres de
groupes, avec le même dédoublonnage par `seen` :

```ts
for (const id of snapshot.preNeutralizedKeys) {
  if (!seen.has(id)) { seen.add(id); ids.push(id); }
}
```

**L'ordre est fonctionnel, pas cosmétique.** `matchCoursesForCopy` consomme les candidats
destination un par un dans l'ordre de cette liste. Ajouter les neutralisés **en queue** garantit que
l'appariement des enforced et des membres de groupes reste **identique à l'existant** : la nouvelle
étape ne peut pas voler un cours destination aux deux premières. Écrire ce « pourquoi » en
commentaire dans la fonction — c'est le seul piège du chantier.

Un cours à la fois enforced (ou groupé) **et** neutralisé en S n'est ajouté qu'une fois, et reste
apparié au même cours destination pour les trois étapes. C'est le comportement voulu.

### 1.2 Nouveau type + constructeur

```ts
export interface NeutralizedCopyItem {
  sourceCourseId: string;
  sourceCourse: CourseTaskDataWithId;
  destCourseId: string | null;
  /** Le cours destination porte déjà une exclusion amont `user-pre` en D. */
  alreadyNeutralizedInDest: boolean;
  copiable: boolean;
}

export function buildNeutralizedCopyItems(
  sourceSnapshot: PreparedWeekSnapshot | undefined,
  matches: Map<string, string | null>,
  destPreNeutralizedIds: Set<string>,
  sourceCourses: CourseTaskDataWithId[],
): NeutralizedCopyItem[]
```

Règles, calquées sur `buildEnforcedCopyItems` :

- `sourceSnapshot` absent → `[]` ;
- itérer `sourceSnapshot.preNeutralizedKeys` **dans l'ordre** ;
- id source introuvable dans `sourceCourses` (référence orpheline, cours supprimé depuis) →
  `continue` silencieux, pas de jet ;
- `destCourseId = matches.get(id) ?? null` ;
- `copiable = destCourseId !== null && !alreadyNeutralizedInDest`.

**Pas d'équivalent de `roomMismatch`** : une neutralisation ne transporte aucune donnée au-delà de
l'identité du cours. Rien à valider côté destination.

**`destPreNeutralizedIds` ne contient QUE les `user-pre` de D.** *(Règle corrigée après
implémentation — la première rédaction de ce plan disait « toutes origines », c'était un défaut ;
voir §7.)* Un `engine`/`user-post` est **volatil** :
[`handleEnforceChange`](../packages/scheduler-client/store/usePlanningStore.ts#L716) réduit `unplaced`
aux seuls `user-pre`. Le compter comme « déjà non placé, rien à copier » ferait silencieusement
disparaître la neutralisation dès qu'un cours imposé est copié dans la même passe : la modale la
déclare non copiable, puis l'application des enforced efface l'entrée sur laquelle ce verdict
reposait. Le recouvrement est absorbé côté store, par promotion (§2).

Rien à changer dans `matchCoursesForCopy`, `buildEnforcedCopyItems`, `buildGroupCopyItems`,
`buildNewEnforcedMap`.

## 2. Couche store — action groupée

`togglePreNeutralized` est une **bascule unitaire** : l'appeler en boucle depuis `handleApply`
déclencherait N `set()` donc N auto-saves, et rebasculerait à tort un cours déjà `user-pre` glissé
entre-temps. Ajouter à côté, dans `PlanningStore` :

```ts
/** Ajoute en une passe des exclusions amont (copie de préparation). Ignore les taskIds déjà non placés. */
addPreNeutralized: (taskIds: string[]) => void;
```

Implémentation : un seul `set()`. Un `taskId` déjà non placé pour une **autre** raison
(`engine`/`user-post`) est **promu sur place** en `user-pre` — ni ignoré (la neutralisation serait
perdue au prochain `handleEnforceChange`, §1.2) ni ajouté en doublon
([`selectPiocheEntries`](../packages/scheduler-client/lib/calendar/unplaced.ts#L50) n'y déduplique
pas). Déjà `user-pre` → rien. Retour de l'état inchangé — `return {}` — si rien ne change, pour ne
pas créer une référence `unplaced` neuve et déclencher un auto-save à vide.

Documenter l'action dans [`store/README.md`](../packages/scheduler-client/store/README.md#L84), à la
suite de la ligne `togglePreNeutralized`.

## 3. Couche UI — `CopyWeekPrepModal.tsx`

### 3.1 Étape

```ts
type Step = 'pick-week' | 'enforced' | 'groups' | 'neutralized';
```

Ordre : enforced → groupes → **neutralisés**, et « Appliquer » migre sur la dernière étape.

### 3.2 État et sélecteurs

- `const [selectedNeutralizedIds, setSelectedNeutralizedIds] = useState<Set<string>>(new Set())` ;
- `const destUnplaced = usePlanningStore((s) => s.unplaced)` et
  `const addPreNeutralized = usePlanningStore((s) => s.addPreNeutralized)` ;
- `destPreNeutralizedIds = useMemo(...)` — **filtré sur `origin === 'user-pre'`** (§1.2), pas tout `unplaced` ;
- `neutralizedItems = useMemo(() => buildNeutralizedCopyItems(sourceSnapshot, matches, destPreNeutralizedIds, sourceCourses), [...])` ;
- pré-sélection dans le `useEffect` existant sur `sourceWeek` (garder la dépendance unique et le
  `eslint-disable` en place) ;
- vidage dans `resetAndClose` ;
- `toggleNeutralized(id)`, copie conforme de `toggleEnforced`.

### 3.3 Rendu

Bloc `step === 'neutralized'` calqué sur le bloc `groups` :

- vide → `Aucune tâche neutralisée en semaine {sourceWeek}.` ;
- par item : case à cocher (`disabled={!item.copiable}`), titre
  `{code} {type} — {name}`, sous-titre `{duration} min` ;
- non copiable → `item.alreadyNeutralizedInDest ? 'Déjà neutralisé en semaine ' + destWeek : 'Cours similaire non trouvé'`.

`DialogDescription` de l'étape :
« Tâches neutralisées de la semaine {sourceWeek} — cochez celles à neutraliser en semaine {destWeek}. »

**Déplacer le rappel `roomMismatches`** du bloc `groups` vers ce bloc, inchangé par ailleurs : c'est
un avertissement d'avant-application, il doit rester sur l'écran qui porte le bouton « Appliquer ».

Pied de dialogue : l'étape `groups` passe de « Appliquer » à « Suivant » (→ `neutralized`) ;
`neutralized` porte « Retour » (→ `groups`) et « Appliquer ».

### 3.4 `handleApply`

Après les enforced et les groupes :

```ts
const selectedNeutralized = neutralizedItems.filter(
  (i) => i.copiable && selectedNeutralizedIds.has(i.sourceCourseId),
);
const ids = selectedNeutralized.map((i) => i.destCourseId).filter((id): id is string => id !== null);
if (ids.length > 0) addPreNeutralized(ids);
```

L'ordre relatif aux deux autres étapes est indifférent (§0) ; le placer en dernier suit l'ordre des
écrans.

Mettre à jour le **commentaire d'en-tête du composant** (lignes 31-38) : la copie porte désormais sur
« cours enforced + groupes + tâches neutralisées ».

## 4. Points de conception tranchés

**4.1 — Pas de filtre « déjà neutralisé donc inutile d'imposer ».** Les trois étapes restent
indépendantes ; on reproduit la préparation de S telle quelle.

**4.2 — Faisabilité.** Une neutralisation ne peut pas rendre la semaine infaisable (elle retire du
travail au moteur). Aucune validation supplémentaire n'est requise, contrairement aux enforced.

**4.3 — Cours à la fois imposé et neutralisé.** L'état est légal côté store et peut exister en S ;
la copie le reproduit fidèlement. **Ne pas** ajouter de garde croisée. Une mention discrète dans
l'étape 3 pour l'item dont le `destCourseId` est aussi sélectionné à l'étape 1 (« ⚠ également imposé
— comme en semaine {sourceWeek} ») est acceptable si elle tient en trois lignes ; sinon la sauter.

## 5. Tests

**`packages/scheduler-client/__tests__/copyWeekPrep.test.ts`** (helper `snapshot()` déjà prêt, il
porte `preNeutralizedKeys: []`) :

1. `relevantSourceCourseIds` — unionne enforced + membres de groupes + `preNeutralizedKeys`, sans
   doublon, **les neutralisés en queue** (assertion d'égalité de tableau ordonné, c'est la garantie
   du §1.1) ;
2. `buildNeutralizedCopyItems` — copiable quand un similaire libre existe en D ;
3. non copiable, `destCourseId === null`, quand aucun similaire ;
4. non copiable, `alreadyNeutralizedInDest === true`, quand le cours destination est dans
   `destPreNeutralizedIds` ; **copiable** quand il n'y est pas (cas `engine`/`user-post`) ;
5. référence orpheline ignorée sans jeter ; `undefined` en snapshot → `[]`.

**`packages/scheduler-client/__tests__/unplacedPersistence.test.ts`** (stub `localStorage` +
`vi.resetModules()` déjà en place) : `addPreNeutralized` ajoute les ids absents, **promeut** une
entrée `engine`/`user-post` existante sans la dupliquer ni déplacer, laisse intactes les tâches hors
demande, et le snapshot auto-sauvegardé porte bien les clés dans `preNeutralizedKeys` ; un second
test vérifie la référence `unplaced` **inchangée** quand tout est déjà `user-pre`.

Commandes : `npm test -w @edt-ts/scheduler-client` puis `npm run lint` et `npm run build` (TS strict)
à la racine.

## 6. Vérification manuelle

Semaine S : neutraliser 2 cours, en imposer 1, former 1 groupe. Ouvrir la semaine D, « Copier »,
saisir S, dérouler les 3 étapes, appliquer. Attendu : les 2 cours apparaissent barrés/neutralisés en
D, l'imposition et le groupe sont posés ; changer de semaine et revenir → tout tient (relecture via
`preNeutralizedKeys`). Recommencer la copie : les 2 mêmes cours sont désormais grisés « Déjà
neutralisé en semaine D ».

**Cas ajouté après correction (§7.1)** : lancer un calcul sur D **avant** de copier, de sorte qu'un
cours neutralisé en S corresponde à un cours que le moteur n'a pas placé en D. Il doit rester
**cochable** (et non grisé), et après application il doit figurer comme neutralisé — y compris après
un aller-retour de semaine.

## 7. STATUT

**Implémenté intégralement, sans déviation par rapport au plan.**

- §1 — `lib/copyWeekPrep.ts` : `relevantSourceCourseIds` ajoute `preNeutralizedKeys` en queue
  (commentaire du « pourquoi » inclus) ; `NeutralizedCopyItem` + `buildNeutralizedCopyItems`
  ajoutés tels que spécifiés.
- §2 — `store/usePlanningStore.ts` : `addPreNeutralized` ajoutée (un seul `set()`, promotion des
  entrées non-`user-pre`, `return {}` si rien ne change) ; documentée dans `store/README.md`.
- §3 — `CopyWeekPrepModal.tsx` : étape `neutralized` ajoutée après `groups` ; état/sélecteurs/
  rendu/pied de dialogue calqués sur les étapes existantes ; rappel `roomMismatches` déplacé sur
  l'étape `neutralized` (dernier écran avant « Appliquer ») ; commentaire d'en-tête mis à jour.
- §3.4 / §4.3 — La mention discrète « également imposé » n'a pas été ajoutée : les trois
  structures restent indépendantes et rien dans l'UI existante n'affiche déjà ce genre de
  recoupement inter-étapes ; le plan la rendait explicitement optionnelle.
- §5 — Tests ajoutés : `copyWeekPrep.test.ts` (ordre des neutralisés en queue + les cas
  `buildNeutralizedCopyItems`) ; `unplacedPersistence.test.ts` (`addPreNeutralized`).

### 7.1 Correction post-revue — règle du §1.2 fautive

La revue a trouvé un **défaut hérité de la première rédaction de ce plan** (pas de l'implémentation,
qui la suivait fidèlement) : le §1.2 faisait porter `alreadyUnplacedInDest` sur **toutes** les
origines de `unplaced`, en supposant que copier la neutralisation d'un cours déjà dans la pioche de D
serait un no-op. Prémisse fausse —
[`handleEnforceChange`](../packages/scheduler-client/store/usePlanningStore.ts#L716) réduit `unplaced`
aux seuls `user-pre`.

Scénario reproduit par test jetable avant correction :

1. D a déjà tourné, le cours X n'a pas été placé par le moteur (`origin: 'engine'`) ;
2. X est neutralisé en S → la modale l'affiche grisé « Déjà non placé en semaine D », non copiable ;
3. l'utilisateur applique avec ≥ 1 cours imposé sélectionné → `handleEnforceChange` efface l'entrée
   `engine` de X.

Résultat : **X n'est ni neutralisé, ni non placé** — la neutralisation demandée disparaît en silence,
précisément dans le cas « recopier la prépa sur une semaine déjà calculée ».

Correction appliquée : `alreadyNeutralizedInDest` sur les `user-pre` **seuls** (§1.2, §3.2, §3.3), et
`addPreNeutralized` **promeut** l'entrée existante au lieu de l'ignorer (§2) — ce qui règle à la fois
la perte et le risque de doublon dans la pioche.

**Discrimination des tests, vérifiée par ablation** (rétablissement de la version « ignore » de
`addPreNeutralized`) : le test de promotion passe au **ROUGE**, les 5 autres restent verts, et le
moteur restauré les remet tous au vert. À noter honnêtement : le test
« survit à l'imposition appliquée dans la même passe » est resté vert sous ablation — il garde la
préservation des `user-pre` par `handleEnforceChange`, pas la promotion, et son commentaire le dit.
Le filtre `user-pre` de `destPreNeutralizedIds` **côté modale** n'a, lui, pas de couverture
automatisée (pas de test de composant sur cette modale) : il tient par le typage du paramètre
renommé, sa doc, et la vérification manuelle ajoutée au §6.

### 7.2 Ajout post-test — étape muette quand rien n'est copiable

Test manuel de Frédéric : à la 3ᵉ étape, toutes les cases grisées, curseur « interdit » au survol, et
aucune explication d'ensemble. Cause réelle : la semaine destination portait déjà les
neutralisations (« Déjà neutralisé en semaine D ») — donc **pas un bug**, le verdict était juste. Le
défaut est ailleurs : une étape dont **aucun** item n'est copiable est un cul-de-sac muet, il fallait
lire ligne à ligne pour le comprendre. Défaut présent depuis l'origine sur les étapes enforced et
groupes, jamais rencontré jusque-là.

Ajouté dans `CopyWeekPrepModal` — **les trois étapes**, pas seulement la nouvelle :

- composant `NothingCopiable` : synthèse en tête de liste quand `items.length > 0` et qu'aucun n'est
  copiable (« Aucune des N tâches… n'est copiable en semaine D — le motif est indiqué sous chaque
  ligne »). Volontairement sans diagnostic global : le motif peut différer d'un item à l'autre, le
  détail par ligne reste la source de vérité ;
- `autoFocus` sur le bouton d'avancement de chaque étape : le changement d'étape démonte la branche
  précédente, le bouton qui portait le focus disparaît et celui-ci retombait sur le document.

**Résultat des suites :**
- `npm run test --workspace=packages/scheduler-client` : 38 fichiers, 464 tests verts avant
  correction ; **467 après** (3 cas ajoutés).
- `npm run lint --workspace=packages/scheduler-client` : 6 erreurs / 26 warnings préexistants
  (`TightThresholdBlock.tsx`, `TaskCard.tsx`, divers `no-unused-vars`), aucun dans les fichiers
  touchés par ce chantier — vérifié par `git stash` sur `master` avant modification.
- `npm run typecheck --workspace=packages/scheduler-client` : propre (0 erreur). Le `typecheck`
  racine échoue sur `scheduler-core`/`scheduler-api` (`SchedulerConfig` incomplet dans
  `scheduler.ts:60`), erreur préexistante sur `master`, sans rapport avec ce chantier.
- `npm run client:build` (Next.js) : compile et prerend avec succès.

Vérification manuelle (§6) non exécutée dans cette session (pas d'accès UI interactive) — à
faire par Frédéric avant merge.
