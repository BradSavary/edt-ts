# Plan — Synchroniser la carte sidebar et la tuile calendrier d'un cours imposé

> **Public : session d'implémentation (Sonnet).** Ce plan est autoportant. Il corrige un bug de
> **désynchronisation d'affichage en mode préparation** (`lastRun === null`). Aucun nouveau format
> de persistance, aucune option de configuration, aucun changement du contrat moteur.

## 0. Le bug, et pourquoi la durée y échappe (vérifié, ne pas rouvrir)

**Symptôme rapporté.** Un cours est glissé de la sidebar sur le calendrier (il devient *imposé* :
carte sidebar sur fond vert, badge « 📌 Imposé »). On clique la tuile du calendrier, on change la
salle (ou l'enseignant, ou les groupes), on confirme : la **tuile** est à jour, la **carte sidebar**
non. Avec la **durée**, tout reste synchrone.

**Cause : deux enregistrements distincts pour un même cours imposé.**

| Vue | Ce qu'elle lit |
| --- | --- |
| Carte sidebar | le **cours-modèle** (`useProjectStore`), via [`CourseCard`](../packages/scheduler-client/components/planning/courses/CourseCard.tsx#L31-L33) → `course.teacher/groups/rooms` |
| Tuile calendrier | le **placement `pre-enforced`**, dérivé de `enforcedMap` par [`placementsFromEnforcedMap`](../packages/scheduler-client/lib/calendar/placements.ts#L61-L73) → `enforced.teacher/groups/rooms` |

Les ressources sont donc **dupliquées** : le modèle (qui peut porter des alternatives
`string | string[]`) et l'imposition (un **combo concret**, `string[]`, cf. `EnforcedData`).

[`handleEditConfirm`](../packages/scheduler-client/hooks/useCalendarCore.ts#L331-L371), branche
`pre-enforced` + `lastRun === null` ([L336-L359](../packages/scheduler-client/hooks/useCalendarCore.ts#L336-L359)) :

- ressources → écrites **uniquement** dans `manualEnforcedMap` (via `handleEnforceChange`) ;
- durée → écrite **uniquement** dans le cours-modèle (commentaire L346-347 : `EnforcedData` ne
  porte pas de champ `duration`).

**D'où l'asymétrie.** La durée de la tuile n'est pas lue dans l'imposition mais dans le cours :
`placement.duration ?? course?.duration`
([`buildPlacementEvent`](../packages/scheduler-client/hooks/useCalendarCore.ts#L38) — un placement
`pre-enforced` n'a **pas** de champ `duration`). La durée n'a qu'**une** source, elle ne peut pas
désynchroniser. Les ressources en ont deux, et une seule des deux est écrite.

**Le bug est symétrique, et il est aussi présent dans l'autre sens.** Éditer un cours **déjà
imposé** depuis la sidebar (`✏ Modifier` sur la carte verte →
[`SidebarPreparation.handleEditConfirm`](../packages/scheduler-client/components/planning/sidebar/SidebarPreparation.tsx#L74-L89))
n'écrit **que** le cours-modèle : la carte change, la tuile du calendrier reste sur les anciennes
ressources. L'objectif « synchronisées en cas de modification, quelle qu'elle soit » exige de
traiter les **deux sens** — §2 et §3. Ne pas s'arrêter au sens rapporté.

**Cadre d'exécution — deux acquis qui simplifient tout :**

1. La sidebar de préparation n'est montée **que** si `lastRun === null`
   ([`SidebarLeft`](../packages/scheduler-client/components/planning/sidebar/SidebarLeft.tsx#L15-L17)).
   Tout ce plan vit donc en mode préparation ; les branches « après planification » de
   `handleEditConfirm` (`else`, [L360-L368](../packages/scheduler-client/hooks/useCalendarCore.ts#L360-L368))
   ne sont **pas** concernées et **ne doivent pas être touchées** — leur commentaire « teacher/
   groups/rooms ne sont volontairement PAS recopiés sur le cours-modèle » reste valable tel quel
   pour une retouche `post-enforced` d'une solution moteur.
2. En préparation, `placements` ne contient **que** des `pre-enforced` : `handleEnforceChange` et
   `returnToPreparation` reconstruisent intégralement la liste depuis la map
   ([L713](../packages/scheduler-client/store/usePlanningStore.ts#L713),
   [L854](../packages/scheduler-client/store/usePlanningStore.ts#L854)). Rappeler
   `handleEnforceChange` en préparation ne peut donc perdre aucun placement.

**Impositions propagées (groupes).** `augmentEnforcedMap`
([L74-L94](../packages/scheduler-client/store/usePlanningStore.ts#L74-L94)) recalcule les entrées
dérivées à **chaque** appel, et
[`computeGroupEnforcements`](../packages/scheduler-client/lib/taskGroupUtils.ts#L164-L205) résout
leurs ressources depuis le **cours-modèle** du partenaire (`pickDefaultResources`, premier choix de
chaque alternative — [L150-L154](../packages/scheduler-client/lib/taskGroupUtils.ts#L150-L154)).
Conséquence exploitée au §3 : pour une imposition dérivée, **rappeler `handleEnforceChange` avec la
map manuelle inchangée suffit** à la réaligner sur un modèle qui vient d'être édité.

## 1. Couche pure — `lib/enforcedResources.ts` (nouveau fichier)

Deux réconciliations, chacune dans un sens, toutes deux **positionnelles** (un « slot » de
`ResourceSlots` ↔ une entrée de la liste ; c'est déjà l'appariement implicite entre modèle et combo
concret, produit par `pickDefaultResources`/`flatMap` qui rendent une valeur par entrée).

```ts
import type { ResourceEntry } from '@edt-ts/scheduler-common';

/**
 * Sens calendrier → modèle. Réinjecte un combo concret (retouche d'une tuile imposée) dans les
 * entrées du cours-modèle, slot par slot : une alternative qui **contient déjà** le choix est
 * laissée intacte — elle doit rester ouverte pour le moteur si l'imposition est retirée plus tard ;
 * sinon le slot prend la valeur concrète. Les slots ajoutés/supprimés dans la modale suivent, la
 * longueur du résultat est celle de `concrete`.
 */
export function mergeConcreteIntoEntries(
  entries: ResourceEntry[],
  concrete: string[],
): ResourceEntry[] {
  return concrete.map((value, i) => {
    const entry = entries[i];
    return Array.isArray(entry) && entry.includes(value) ? entry : value;
  });
}

/**
 * Sens modèle → imposition. Ré-résout un combo concret sur des entrées de cours modifiées, en
 * **préservant le choix déjà imposé** quand il reste admissible (sinon éditer la salle depuis la
 * sidebar réinitialiserait l'enseignant choisi à la pose). À défaut, premier choix de
 * l'alternative — même règle que `pickDefaultResources`, y compris le filtrage des valeurs vides.
 */
export function resolveEntriesAgainstPrevious(
  entries: ResourceEntry[],
  previous: string[],
): string[] {
  return entries
    .map((entry) => {
      const alts = Array.isArray(entry) ? entry : [entry];
      return alts.find((a) => previous.includes(a)) ?? alts[0];
    })
    .filter((r): r is string => Boolean(r));
}
```

Fichier **sans dépendance React ni store** : c'est ce qui le rend testable en unitaire (§5.1).
Ne pas le poser dans `lib/calendar/promotion.ts`, qui traite la frontière `Placement ↔ EnforcedData`
et non `CourseTaskData ↔ EnforcedData`.

## 2. Sens calendrier → sidebar (le bug rapporté) — `hooks/useCalendarCore.ts`

Réécrire la branche `pre-enforced` de `handleEditConfirm`
([L336-L359](../packages/scheduler-client/hooks/useCalendarCore.ts#L336-L359)) selon cet ordre,
**qui est fonctionnel** :

1. **Patcher le cours-modèle d'abord** — ressources fusionnées via `mergeConcreteIntoEntries` **et**
   durée, en **un seul** `updateManualCourse`/`setCourses` (aujourd'hui la durée fait son propre
   appel) ;
2. **puis** `handleEnforceChange(newMap)`.

L'ordre actuel est l'inverse et c'est un défaut latent : `handleEnforceChange` relit les cours de la
semaine pour la propagation de groupe ; appelée avant le patch, elle propage l'**ancienne** durée le
long d'un groupe séquentiel. Inverser corrige ce point au passage — le noter en commentaire.

Forme cible (le reste de la fonction inchangé) :

```ts
if (pendingEdit.origin === 'pre-enforced' && lastRun === null) {
  const courseKey = pendingEdit.taskId;
  const teachers = update.teachers.flat();
  const groups = update.groups.flat();
  const rooms = update.rooms.flat();

  // 1. Cours-modèle — c'est lui que rend la carte sidebar (CourseCard). Sans cette écriture, la
  //    retouche reste invisible côté sidebar : c'est exactement le bug que corrige ce chantier.
  //    `mergeConcreteIntoEntries` préserve les alternatives du modèle encore compatibles avec le
  //    choix imposé (cf. lib/enforcedResources.ts).
  const course = courseById.get(courseKey);
  if (course) {
    const patch = {
      teacher: mergeConcreteIntoEntries(course.teacher, teachers),
      groups: mergeConcreteIntoEntries(course.groups, groups),
      rooms: mergeConcreteIntoEntries(course.rooms ?? [], rooms),
      ...(update.duration !== undefined ? { duration: update.duration } : {}),
    };
    if (course.source === 'manual') {
      if (selectedWeek !== null) useProjectStore.getState().updateManualCourse(selectedWeek, course.id, patch);
    } else {
      const { allCourses, setCourses } = useProjectStore.getState();
      setCourses(allCourses.map((c) => (c.id === course.id ? { ...c, ...patch } : c)));
    }
  }

  // 2. Imposition — APRÈS le patch : `handleEnforceChange` relit les cours de la semaine pour la
  //    propagation de groupe, elle doit voir la durée et les ressources neuves.
  const state = usePlanningStore.getState();
  const existing = state.manualEnforcedMap[courseKey] ?? state.enforcedMap[courseKey];
  if (existing) {
    const updated: EnforcedData = { ...existing, teacher: teachers, groups, rooms };
    handleEnforceChange({ ...state.manualEnforcedMap, [courseKey]: updated });
  }
}
```

Trois points d'attention :

- `update.teachers.flat()` reste correct : la modale du calendrier est ouverte avec
  [`allowAlternatives={false}`](../packages/scheduler-client/components/planning/calendar/ScheduleCalendar.tsx#L200),
  chaque slot y est une chaîne. L'imposition **doit** rester un combo concret.
- Le `c.id === course.id` remplace le `c === course` de l'ancien code (comparaison d'identité
  d'objet). Les ids sont stables et uniques (`lib/courseId.ts`) ; la comparaison par id survit à un
  cours recopié entre-temps.
- Le `?? state.enforcedMap[courseKey]` (fallback imposition dérivée → promue en manuelle) est le
  comportement existant : **le conserver tel quel**, ce n'est pas le sujet du chantier.

## 3. Sens sidebar → calendrier — `components/planning/sidebar/SidebarPreparation.tsx`

### 3.1 Nouvelle action de store

Le composant ne doit pas refaire la résolution du combo : elle a besoin des cours de la semaine et
de la distinction manuelle/dérivée. Ajouter dans `PlanningStore` (à côté de `handleEnforceChange`) :

```ts
/**
 * Réaligne l'imposition d'un cours sur son modèle après édition de celui-ci (préparation).
 * No-op si le cours n'est pas imposé.
 */
syncEnforcedAfterCourseEdit: (courseId: string) => void;
```

Implémentation, dans cet ordre de tests :

1. `courseId in manualEnforcedMap` → recomposer l'entrée à partir du **cours courant** (relu via
   `getCoursesForWeek(allCourses, weekSaves, selectedWeek)`, comme `handleEnforceChange`) :
   `startTime` **inchangé** ; `teacher/groups/rooms` = `resolveEntriesAgainstPrevious(course.X, existing.Y)` ;
   puis `get().handleEnforceChange({ ...manualEnforcedMap, [courseId]: updated })`.
   Cours introuvable → ne rien faire (référence orpheline, pas de jet).
2. sinon `courseId in enforcedMap` (imposition **dérivée** d'un groupe) → `get().handleEnforceChange({ ...get().manualEnforcedMap })`.
   La map manuelle est inchangée ; c'est `augmentEnforcedMap` qui recalcule l'entrée dérivée depuis
   le modèle fraîchement patché (§0). Écrire ce « pourquoi » en commentaire, sinon l'appel passe
   pour du bruit et sera supprimé au prochain nettoyage.
3. sinon → `return` sans `set()` : ne pas créer de référence neuve pour rien (l'auto-save compare
   les références).

Réutiliser `handleEnforceChange` plutôt que dupliquer son `set()` : lui seul sait recomposer
`enforcedMap` + `placements` de façon cohérente. Documenter l'action dans
[`store/README.md`](../packages/scheduler-client/store/README.md), à la suite de
`handleEnforceChange`.

### 3.2 Câblage dans le composant

Dans `handleEditConfirm` ([L74-L89](../packages/scheduler-client/components/planning/sidebar/SidebarPreparation.tsx#L74-L89)),
après le patch du cours (inchangé), appeler `syncEnforcedAfterCourseEdit(courseRef.id)` — sélecteur
`usePlanningStore((s) => s.syncEnforcedAfterCourseEdit)` ajouté en tête de composant, comme les
autres. L'ordre patch-puis-sync est obligatoire pour la même raison qu'au §2.

Effet de bord bienvenu : éditer la **durée** d'un cours imposé membre d'un groupe **séquentiel**
décale enfin les impositions propagées en aval, ce qui n'était pas le cas.

## 4. Points de conception tranchés

**4.1 — La carte sidebar continue d'afficher le modèle, pas l'imposition.** Une alternative
`[A|B]` non touchée par l'utilisateur reste affichée « A | B » sur la carte alors que la tuile
montre le combo résolu « A ». Ce n'est **pas** le bug rapporté (aucune *modification* n'est perdue),
et masquer les alternatives du modèle sur la carte verte cacherait la marge laissée au moteur si
l'imposition est retirée. **Ne pas** modifier `CourseCard`/`courseToBaseProps`. À rouvrir seulement
si Frédéric le demande explicitement.

**4.2 — Préserver les alternatives est le point délicat, ne pas le simplifier.** La tentation est
d'écrire `course.teacher = update.teachers.flat()` au §2 : c'est trois lignes de moins et une perte
de données **silencieuse** (un cours modélisé `[['A','B']]`, imposé puis retouché, retomberait à
`['A']` définitivement, y compris après « Retirer l'imposition »). D'où
`mergeConcreteIntoEntries`.

**4.3 — Rien ne change après planification.** `lastRun !== null` : la sidebar est
`SidebarAnalysis`, la branche `else` de `handleEditConfirm` reste intacte (§0, acquis 1).

**4.4 — Factorisation du patch de cours (optionnel).** La bascule `source === 'manual' ?
updateManualCourse : setCourses` existe désormais à deux endroits quasi identiques (§2 et
`SidebarPreparation`). L'extraire en `applyCoursePatch(course, patch, selectedWeek)` dans
`lib/courseMutations.ts` est propre **si ça tient en ~15 lignes** ; sinon laisser tel quel et ne pas
gonfler la diff.

## 5. Tests

### 5.1 `__tests__/enforcedResources.test.ts` (nouveau, unitaire pur)

`mergeConcreteIntoEntries` : alternative conservée quand le choix concret y figure (`[['A','B']]` +
`['A']` → `[['A','B']]`) ; alternative remplacée quand il n'y figure plus (`+ ['C']` → `['C']`) ;
slot ajouté (`+ ['A','X']` → `[['A','B'],'X']`) ; slot retiré (`+ []` → `[]`) ; entrées simples
inchangées.

`resolveEntriesAgainstPrevious` : choix précédent préservé s'il reste admissible (`[['B','A']]` +
`['A']` → `['A']`) ; premier choix sinon (`[['C','D']]` + `['A']` → `['C']`) ; entrée simple rendue
telle quelle ; valeurs vides filtrées.

### 5.2 `__tests__/courseEditPreservesPrep.test.ts` (étendre — mêmes stubs, hook déjà monté)

Le fichier monte déjà `useCalendarCore` via `renderHook` et le hook expose `setPendingEdit` **et**
`handleEditConfirm` : la retouche calendrier se pilote donc en deux `act()` (poser `pendingEdit`,
re-lire `result.current`, confirmer).

1. **Sens calendrier → modèle (le bug).** `c1` imposé, retouche `rooms: ['R9']` depuis la tuile →
   `useProjectStore` : `c1.rooms === ['R9']` **et** `manualEnforcedMap.c1.rooms === ['R9']`. Le
   premier `expect` est celui qui échoue avant correction.
2. **Alternatives préservées.** `c1.teacher = [['T1','T2']]`, imposé sur `T1`, retouche de la seule
   salle → `c1.teacher` vaut toujours `[['T1','T2']]` (§4.2).
3. **Durée toujours synchrone (non-régression).** La retouche de durée écrit le cours et laisse
   l'imposition en place.
4. **Sens modèle → imposition.** `c1` imposé (`rooms: ['R1']`), édition sidebar `rooms: ['R9']`
   (appliquée comme le fait le composant : patch cours puis `syncEnforcedAfterCourseEdit('c1')`) →
   `enforcedMap.c1.rooms === ['R9']` et `startTime` inchangé.
5. **Choix imposé préservé.** Modèle passé à `teacher: [['T2','T1']]` alors que l'imposition porte
   `T1` → l'imposition reste sur `T1`, pas de retour à `T2`.
6. **Imposition dérivée.** `c1`+`c2` en groupe parallèle, `c1` imposé (donc `c2` dérivé) ; éditer la
   salle de `c2` puis `syncEnforcedAfterCourseEdit('c2')` → `enforcedMap.c2.rooms` suit, et `c2`
   **n'entre pas** dans `manualEnforcedMap` (l'imposition reste dérivée).
7. **No-op.** `syncEnforcedAfterCourseEdit` sur un cours non imposé ne change ni `manualEnforcedMap`
   ni `placements` (comparer les **références**, c'est la garde d'auto-save).

Commandes : `npm run test --workspace=packages/scheduler-client`, puis `npm run lint` et
`npm run typecheck --workspace=packages/scheduler-client`. Le `typecheck` racine échoue déjà sur
`scheduler-core`/`scheduler-api` (`SchedulerConfig` incomplet, `scheduler.ts:60`) — préexistant,
sans rapport.

## 6. Vérification manuelle

Semaine vierge, mode préparation :

1. Glisser un cours sur le calendrier. Clic sur la tuile → changer **la salle** → Confirmer.
   **Attendu :** carte sidebar verte **et** tuile portent la nouvelle salle. Recommencer avec
   l'enseignant, puis les groupes, puis la durée.
2. Sur ce même cours imposé, `✏ Modifier` **depuis la carte sidebar** → changer la salle.
   **Attendu :** la tuile du calendrier suit.
3. Cours à alternatives (`T1 | T2`) : l'imposer sur `T1`, retoucher la salle depuis la tuile,
   « Retirer l'imposition ». **Attendu :** le cours revient dans la sidebar avec `T1 | T2` intact et
   la nouvelle salle.
4. Groupe séquentiel de 2 cours, imposer le premier, changer sa durée depuis la sidebar.
   **Attendu :** l'imposition propagée du second se décale.
5. Changer de semaine puis revenir. **Attendu :** tout tient (relecture du snapshot).

## 7. STATUT

**Implémenté intégralement (§1 à §5).**

- §1 — `lib/enforcedResources.ts` créé tel quel (`mergeConcreteIntoEntries`, `resolveEntriesAgainstPrevious`).
- §2 — branche `pre-enforced` de `handleEditConfirm` (`useCalendarCore.ts`) réécrite dans l'ordre
  patch-cours-puis-`handleEnforceChange`, un seul patch pour ressources + durée.
- §3 — `syncEnforcedAfterCourseEdit` ajoutée au `PlanningStore` (implémentation conforme à l'ordre
  de tests du §3.1), documentée dans `store/README.md`, câblée dans
  `SidebarPreparation.handleEditConfirm` juste après le patch du cours.
- §4 — aucun écart : `CourseCard` non touché, `mergeConcreteIntoEntries` conservée telle quelle,
  branche `else` (post-planification) intacte, factorisation §4.4 non tentée (pas nécessaire, diff
  restée petite).
- §5.1 — `__tests__/enforcedResources.test.ts` créé, 9 tests, les 5 cas listés au plan.
- §5.2 — `__tests__/courseEditPreservesPrep.test.ts` étendu d'un nouveau `describe` (7 tests, un par
  scénario du plan).

**Commandes exécutées :**
- `npm run test --workspace=packages/scheduler-client` → 39 fichiers, 483 tests, tous verts.
- `npm run lint --workspace=packages/scheduler-client` → 6 erreurs/26 warnings préexistants dans
  des fichiers non touchés par ce chantier (`TaskCard.tsx` et autres) ; aucun nouveau problème
  introduit par ce diff (seul `usePlanningStore.ts` apparaît, pour un warning `GroupType` inutilisé
  déjà présent avant ce chantier).
- `npm run typecheck --workspace=packages/scheduler-client` → 0 erreur.

**Non fait :** §6 (vérification manuelle dans le navigateur) — non exécutée dans cette session
(pas de serveur dev lancé). À faire par Frédéric avant de considérer le chantier clos, en suivant
les 5 scénarios du §6.
