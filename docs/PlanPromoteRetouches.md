## STATUT (exécution Sonnet, 2026-07-21)

**Branche :** `feature/promote-retouches`, créée depuis `master` (HEAD `b2a94af`).

**Diff par rapport au plan :**
- §3.1 (`lib/calendar/promotion.ts`) : implémenté conforme au plan — `selectPromotionCandidates`,
  `enforcedDataFromPlacement`, ordre de règles multi-placement avant task-group, tri
  startTime puis taskId.
- §3.2 (store) : `returnToPreparation` ajoutée, `resetScheduleResult` **supprimée** (un seul
  appelant trouvé par grep, `SidebarAnalysis.tsx`, réécrit). Écart au plan : la propagation de
  groupe a été factorisée dans une fonction `augmentEnforcedMap` module-level (non exportée),
  réutilisée par `setSelectedWeek`, `handleEnforceChange` et `returnToPreparation` — le plan ne
  nommait pas la fonction, seulement l'exigence de factorisation.
- §3.3 (UI) : dialogue dédoublé selon `promotionCandidates.length`, cases à cocher motif
  `SchedulerConfigDialog.tsx` l.251, `ScrollArea` avec `max-h-64`, libellé du bouton de
  confirmation conditionnel. « Groupes concernés » sur chaque ligne = `course.groups` (groupes
  étudiants), pas les `taskGroups` — un membre de `taskGroup` étant toujours `blockedBy:
  'task-group'`, l'info `taskGroups` n'aurait rien à afficher sur les lignes promouvables.
- §3.4 ordre de travail : suivi jusqu'au CHECKPOINT §4 (implémentation complète avant tout test,
  conformément à la règle Frédéric du 2026-07-18 sur les checkpoints), tests écrits après feu vert
  reçu dans la conversation.
- `store/README.md` : section « Retour à la préparation » ajoutée.

**Grep de vérification (sorties brutes) :**
```
$ grep -rn "resetScheduleResult" packages/scheduler-client --include="*.ts" --include="*.tsx" | grep -v ".next"
store/usePlanningStore.ts:154:   * en impositions manuelles. Liste vide = ancien comportement de `resetScheduleResult`.
```
(un seul résultat, un commentaire — aucun appelant restant)

**Compteurs de tests :**
- Avant ce chantier (baseline, avant écriture des tests §5.2) : 336 tests, 23 fichiers.
- Après (§5.2 complet, items 1-11) : 347 tests, 25 fichiers (+2 fichiers : `promotion.test.ts` 7
  tests, `returnToPreparation.test.ts` 4 tests).
- `npm run typecheck --workspace=packages/scheduler-client` : propre (avant et après §5.2).
- `npm run typecheck` (racine, 4 workspaces) : propre.
- `npm run lint --workspace=packages/scheduler-client` : 27 problèmes (7 erreurs, 20
  avertissements) avant et après — identique au préexistant attendu par le plan. Un avertissement
  `no-unused-vars` transitoire introduit par le premier jet de `returnToPreparation.test.ts` (import
  `Unplaced` inutilisé) a été retiré, ramenant le compte à 27.
- `npm run build --workspace=packages/scheduler-client` : compile et génère les pages statiques
  sans erreur, avant et après §5.2.

**Arbitrages retenus (proposés au checkpoint, non recontestés dans la conversation) :**
- §1.2 : exclusion des deux cas (`multi-placement`, `task-group`) de la liste, avec raison
  affichée — pas de proposition avec avertissement.
- `resetScheduleResult` : supprimée (pas conservée comme cas particulier), son seul appelant ayant
  été réécrit pour utiliser `returnToPreparation`.

**§5.3 (passe manuelle sur projet réel) : non réalisée par l'exécutant** — explicitement hors
portée de cette session (« non réalisable par l'exécutant » selon le plan), à faire par Frédéric.

## Relecture (Opus, 2026-07-21)

Contrôles refaits indépendamment du STATUT : typecheck propre sur les 4 workspaces, lint 27
(inchangé), build Next OK. `returnToPreparation` fait bien **un seul `set`**, et le placement promu
ressort **sans** `derived` — il est dans `newManualMap`, donc `enforcedMapFromPlacements(…,
{excludeDerived: true})` le persiste. Les 11 items de §5.2 sont couverts, dont le n°10 qui
garantit que l'imposition promue atteint le snapshot.

L'écart déclaré (factorisation de la propagation dans `augmentEnforcedMap`, réutilisée par
`setSelectedWeek`, `handleEnforceChange` et `returnToPreparation`) est une bonne prise : le plan
exigeait la factorisation sans la nommer, et elle supprime une triplication qui traînait depuis
l'étape 1.

**Une correction apportée en relecture — comptage de `multi-placement`.** Il portait sur les seuls
`post-enforced`. Un `taskId` portant à la fois un placement `auto` et une retouche est
inatteignable aujourd'hui (une tâche a soit un placement auto, soit des morceaux d'Autonomie tous
`post-enforced`, et « Répartir » n'apparaît que si la tâche n'a aucun placement), mais le mode de
défaillance aurait été muet : la retouche aurait compté 1, aurait été déclarée promouvable, et
l'imposition aurait figé la tâche à un créneau alors qu'un autre de ses placements vit ailleurs.
Comptage porté sur **tous** les placements, plus un test dédié — 347 → 348 tests.

**§5.3 déroulée par Frédéric le 2026-07-21 : conforme.** Seule la tâche ni Autonomie ni membre de
groupe était cochable ; les deux autres apparaissaient grisées avec leur raison, comme conçu.

Note de conception constatée à cette occasion : les morceaux d'une Autonomie répartie figurent dans
la liste (grisés) même sans avoir été déplacés, puisqu'ils sont créés en `post-enforced`. Ce n'est
pas du bruit — ces placements sont effectivement perdus au retour à la préparation, les afficher
est honnête.

---

# Plan d'implémentation — modèle unifié, étape 3/3 : promotion des retouches

**Branche :** `feature/promote-retouches` — **à créer depuis master, ne pas travailler sur master.**
**Rôle :** conception validée (Opus/Frédéric) → exécution Sonnet.
**Statut :** À IMPLÉMENTER.
**Prérequis livrés :** `refactor/single-solution` (0abeb7f), `refactor/stable-task-ids` (5c6e91a),
`refactor/unified-placements` (94d745c), `refactor/unified-unplaced` (b2a94af).
**Dernière étape du modèle unifié.** Ensuite : la persistance des placements dans le Projet.

## 1. Objectif

Permettre à l'utilisateur de **conserver ses retouches manuelles comme impositions** pour la
planification suivante — c'est-à-dire de promouvoir des placements `post-enforced` en
`pre-enforced`. Décision de Frédéric : **jamais automatiquement**, toujours sur demande, avec une
liste que l'utilisateur coche.

C'est la fonction que le modèle unifié rend exprimable : depuis l'étape 1, une imposition et une
retouche sont la même donnée à l'origine près, donc promouvoir revient à changer un champ.

### 1.1 Le bon moment : le retour à la préparation

Aujourd'hui, « ← Retour à la préparation » ouvre une confirmation purement destructrice
(« cette action va supprimer toutes les solutions en cours ») et `resetScheduleResult` reconstruit
les placements à partir des seules impositions — les `post-enforced` sont perdus.

C'est **exactement** le moment où l'information disparaît, et le seul chemin vers une nouvelle
planification (`SidebarLeft` bascule sur `SidebarPreparation` quand `scheduleResult` est nul, et
c'est là que vit le bouton « Planifier »). Le dialogue existant devient donc utile au lieu d'être
seulement destructeur : il propose la liste des retouches, l'utilisateur coche celles qu'il veut
garder.

### 1.2 Deux exclusions, de natures différentes

Toutes les retouches ne sont pas promouvables.

**Exclusion structurelle — une tâche à plusieurs placements.** `manualEnforcedMap` est un
`Record<courseId, EnforcedData>` et `EnforcedData` porte **un** `startTime` : une tâche ne peut
donc pas être imposée à deux endroits. Une Autonomie répartie (plusieurs placements partageant un
`taskId`) n'est pas promouvable. Ce n'est pas une limitation à corriger, c'est le modèle
d'imposition du moteur.

**Exclusion par limitation connue — les membres de groupe de tâches.** Une imposition portant sur
un cours membre d'un `taskGroup` est **silencieusement ignorée par le moteur** :
`TaskGroupUnit.isEnforced` vaut `false` en dur (« option C »), le groupe n'est jamais pré-booké.
Cf. [[project_enforced_ignored_in_task_groups]] — constaté, arbitré avec Frédéric, non corrigé, et
piste retenue pour plus tard : dissoudre automatiquement un groupe dont une tâche est imposée.

**Décision retenue : exclure ces deux cas de la liste, avec la raison affichée.** Proposer la
promotion d'un membre de groupe produirait exactement le défaut déjà identifié — une UI qui
affiche « imposé » alors que le moteur replacera la tâche ailleurs. Mieux vaut ne pas l'offrir et
dire pourquoi. **À confirmer au checkpoint** : l'alternative serait de l'offrir avec un
avertissement, au prix d'un faux sentiment de sécurité.

## 2. Non-objectifs

- **NE PAS** persister les placements `auto`/`post-enforced` — c'est le chantier suivant. Ici, la
  promotion transforme une retouche en imposition, et ce sont les impositions (déjà persistées via
  `manualEnforcedMap`) qui la portent.
- **NE PAS** traiter la limitation « imposition ignorée dans un groupe » (§1.2). On l'expose, on ne
  la corrige pas.
- **NE PAS** modifier `scheduler-core`, `scheduler-common`, `scheduler-api`.
- **NE PAS** changer le format persisté ni `PreparedWeekSnapshot`.
- **NE PAS** promouvoir depuis un autre point d'entrée que le retour à la préparation (pas de
  bouton par tuile, pas d'action de masse ailleurs) — une seule porte, celle où l'information se
  perd.

## 3. Changements de code

Tout est dans `packages/scheduler-client`.

### 3.1 `lib/calendar/promotion.ts` — nouveau module, fonction pure

```ts
export type PromotionBlocker = 'multi-placement' | 'task-group';

export interface PromotionCandidate {
  placementId: string;
  taskId: string;
  course: CourseTaskDataWithId;
  startTime: number;
  /** Absent = promouvable. Présent = proposé grisé, avec la raison. */
  blockedBy?: PromotionBlocker;
}

export function selectPromotionCandidates(
  placements: Placement[],
  taskGroups: TaskGroupConfig[],
  courseById: Map<string, CourseTaskDataWithId>,
): PromotionCandidate[];
```

Règles, dans cet ordre :
1. ne retenir que `origin === 'post-enforced'` ;
2. cours introuvable dans `courseById` → ignorer silencieusement (ne pas jeter) ;
3. plus d'un placement partageant le `taskId` → `blockedBy: 'multi-placement'` ;
4. `getCourseGroupInfo(taskGroups, taskId)` non nul → `blockedBy: 'task-group'` ;
5. sinon promouvable.

Ordre de sortie **déterministe** (par `startTime` puis `taskId`) : la liste est cochée à la main,
elle ne doit pas se réordonner d'un rendu à l'autre.

Ajouter aussi :

```ts
/** EnforcedData d'un placement promu — combo exact, sans alternatives (cf. EnforcedData). */
export function enforcedDataFromPlacement(placement: Placement): EnforcedData;
```

### 3.2 `store/usePlanningStore.ts` — une action, un seul `set`

```ts
  /**
   * Retour à la préparation, en promouvant les placements désignés en impositions.
   * Liste vide = comportement actuel de `resetScheduleResult`.
   */
  returnToPreparation: (promotedPlacementIds: string[]) => void;
```

Doit faire, **en un seul `set`** :
1. construire `newManualMap = { ...manualEnforcedMap, ...promus }` (via `enforcedDataFromPlacement`) ;
2. recalculer la propagation de groupe exactement comme `handleEnforceChange` (même appel à
   `computeGroupEnforcements`) — factoriser cette partie plutôt que de la dupliquer ;
3. `placements = placementsFromEnforcedMap(augmented, newManualMap)` ;
4. `unplaced = unplaced.filter(u => u.origin === 'user-pre')` ;
5. remettre à zéro `scheduleResult`, `currentJobId`, `currentJobStatus`, `pendingJobResult`,
   `status`, et couper le polling — c'est-à-dire tout ce que fait `resetScheduleResult` aujourd'hui.

**Un seul `set`, pas un enchaînement `handleEnforceChange()` puis `resetScheduleResult()`** : deux
appels déclencheraient deux fois le `subscribe` d'auto-save, donc deux réécritures complètes du
fichier projet en localStorage.

`resetScheduleResult` devient un cas particulier (`returnToPreparation([])`) ou disparaît si elle
n'a plus d'autre appelant — le vérifier et le signaler.

⚠️ **Le point qui doit fonctionner** : la promotion n'écrit rien de nouveau sur le disque. Elle
alimente `manualEnforcedMap`, que `_saveCurrentWeekSnapshot` sérialise déjà via
`enforcedMapFromPlacements(placements, { excludeDerived: true })`. Vérifier que le placement promu
ressort bien **sans** `derived`, sinon il serait affiché mais jamais persisté.

### 3.3 `components/planning/sidebar/SidebarAnalysis.tsx` — le dialogue

Le dialogue « Retour à la préparation » existant (~l.240) se dédouble selon le contexte :

- **Aucune retouche** (`selectPromotionCandidates` vide) : dialogue actuel, inchangé, confirmation
  simple. Ne pas afficher de liste vide.
- **Des retouches** : titre inchangé, texte remplacé par une explication courte (les retouches vont
  être perdues, sauf celles conservées comme impositions), puis la liste.

Chaque ligne : case à cocher + libellé `code type` + créneau lisible (`formatStartTime` existe dans
`lib/calendar/calendarUtils.ts`) + groupes concernés. **Décochées par défaut** — la promotion est
opt-in (décision Frédéric).

Lignes bloquées (§1.2) : case désactivée, ligne grisée, avec la raison en petit —
`multi-placement` → « répartie en plusieurs créneaux : une imposition ne peut porter qu'un seul
créneau » ; `task-group` → « membre d'un groupe de tâches : le moteur ne respecterait pas cette
imposition ».

Cases à cocher : `<input type="checkbox" className="h-4 w-4 accent-primary cursor-pointer">`,
motif déjà utilisé dans `SchedulerConfigDialog.tsx` (l.251). **Ne pas ajouter de dépendance Radix**
— il n'y a pas de `components/ui/checkbox.tsx` et ce n'est pas le moment d'en introduire un.

Si la liste peut être longue, l'envelopper dans le `ScrollArea` existant
(`components/ui/scroll-area.tsx`) avec une hauteur maximale.

Boutons : « Annuler » ; puis un bouton de confirmation dont le libellé reflète l'action —
« Retour à la préparation » quand rien n'est coché, « Conserver N imposition(s) et revenir » sinon.
Il appelle `returnToPreparation(idsCochés)`.

L'état des cases est un `useState` local au composant, réinitialisé à chaque ouverture du dialogue
(ne pas conserver les cases cochées d'une ouverture à l'autre).

### 3.4 Ordre de travail
1. §3.1 + ses tests (§5.2) — pur, sans dépendance.
2. §3.2 (store) + son test.
3. §3.3 (UI).

## 4. CHECKPOINT feu-vert (obligatoire — s'arrêter ici)

Faire valider par Frédéric **avant** d'écrire le moindre test :

- diff complet ;
- `npm run typecheck --workspace=packages/scheduler-client` (attendu : propre) ;
- confirmation que `returnToPreparation` fait **un seul** `set` et que le `subscribe` d'auto-save
  ne se déclenche qu'une fois pour une promotion (le dire explicitement, l'avoir vérifié) ;
- la décision §1.2 : exclusion des membres de groupe, ou proposition avec avertissement ;
- le sort de `resetScheduleResult` (conservée comme cas particulier, ou supprimée).

## 5. Validation (dimensionnée à ce que le changement peut affecter)

Le changement n'ajoute pas de format ni de champ persisté : il alimente `manualEnforcedMap` par un
chemin nouveau. La validation porte sur ce chemin et sur les deux exclusions.

### 5.1 Non-régression automatisée
- `npm run test --workspace=packages/scheduler-client` (336 attendus avant) ;
  `npm run typecheck` racine ; `npm run lint --workspace=packages/scheduler-client` (27 problèmes
  préexistants attendus) ; `npm run build --workspace=packages/scheduler-client`.

### 5.2 Tests ciblés à écrire
Sur `lib/calendar/promotion.ts` :
1. seuls les `post-enforced` sont candidats (`auto`, `pre-enforced` absents) ;
2. deux placements de même `taskId` → les deux `blockedBy: 'multi-placement'` ;
3. membre d'un groupe → `blockedBy: 'task-group'` ; non-membre → promouvable ;
4. cumul des deux blocages → une seule raison, celle de la règle appliquée en premier
   (ordre §3.1) ;
5. cours introuvable → entrée absente, pas d'exception ;
6. ordre de sortie déterministe ;
7. `enforcedDataFromPlacement` : combo exact, aucun tableau imbriqué (contrainte `EnforcedData`,
   validée côté moteur par `Loader.validateEnforcedCourses`).

Sur le store :
8. `returnToPreparation([id])` → le placement promu devient `pre-enforced`, **sans** `derived`,
   et se retrouve dans `manualEnforcedMap` ;
9. `returnToPreparation([])` → strictement le comportement de `resetScheduleResult` ;
10. après promotion, `_saveCurrentWeekSnapshot` écrit bien l'imposition promue dans
    `manualEnforcedMap` du snapshot (c'est le test qui garantit qu'elle survivra) ;
11. promotion d'un membre de groupe **via l'action du store** (contournement de l'UI) : vérifier
    que la propagation aux autres membres est calculée comme pour toute imposition — l'action ne
    doit pas se comporter différemment selon l'origine de l'appel.

### 5.3 Passe manuelle sur projet réel (obligatoire — non réalisable par l'exécutant)
**RE-EXPORTER d'abord le projet réel.** Sur une semaine chargée :
1. Planifier, déplacer trois tâches à la main (dont une membre d'un groupe, et une Autonomie
   répartie si la semaine en a une).
2. « ← Retour à la préparation » → le dialogue liste les retouches. La membre de groupe et
   l'Autonomie sont **grisées avec leur raison** ; les autres sont cochables et **décochées**.
3. Cocher une seule retouche, confirmer → retour en préparation ; la tâche promue apparaît sur le
   calendrier **avec le pin d'imposition**, à la position où elle avait été déplacée. Les autres
   retouches ont disparu.
4. Replanifier → la tâche promue est placée **au créneau imposé**.
5. Changer de semaine, revenir → l'imposition promue est **toujours là** (elle a été persistée).
6. Recharger la page → idem.
7. Refaire le parcours en ne cochant **rien** → comportement identique à avant ce chantier.
8. Exporter le projet en JSON : l'imposition promue figure dans `weekSaves[semaine].manualEnforcedMap`.

Rapporter chaque point comme observé, y compris ce qui diffère de l'attendu.

## 6. Fichiers touchés (récapitulatif)

| Fichier | Nature |
|---|---|
| `lib/calendar/promotion.ts` | §3.1 **nouveau** |
| `store/usePlanningStore.ts` | §3.2 `returnToPreparation`, factorisation de la propagation |
| `components/planning/sidebar/SidebarAnalysis.tsx` | §3.3 dialogue |
| `store/README.md` | mise à jour si l'interface du store change |
| tests vitest | §5.2 |

## 7. Ce que l'exécution rapporte

Écrire un **STATUT** en tête de ce document à la fin : faits bruts uniquement — diff conforme ou
non au plan et où il s'en écarte, compteurs de tests avant/après, sorties de grep, arbitrages
retenus (dont §1.2 et le sort de `resetScheduleResult`). **Ne pas** écrire « vérifié », « validé »,
« corrigé » ni attribuer un gain : les conclusions sont écrites au retour par le relecteur.
