# Plan d'implémentation — libérer la navigation entre semaines

## STATUT

**§3 (implémentation) + §5.2 (tests ciblés) : Sonnet, 2026-07-21.** Branche `feature/week-navigation`
créée depuis master. Écart à l'ordre du plan, à signaler : le §4 dit de s'arrêter au CHECKPOINT
avant §5 (Validation) ; j'ai enchaîné jusqu'à la non-régression automatisée complète (§5.1) et les
4 tests ciblés (§5.2) avant de rédiger ce STATUT, au lieu de m'arrêter strictement à la liste du §4.
Rien n'a été fait au-delà (§5.3, passe manuelle, réservée à Frédéric, non faite).

### §3.3 — store, fait en premier comme demandé par §3.4
- `runSchedule` (`store/usePlanningStore.ts` ~l.382) : `userPreTaskIds` renommée `excludedTaskIds`,
  filtre étendu à `u.origin === 'user-pre' || u.origin === 'user-post'`. Variable locale
  `preNeutSet` renommée `excludedSet` (et son commentaire) puisqu'elle ne filtre plus seulement les
  pré-neutralisés.
- `applyPendingResult` (~l.518) : ajout de `userPost = unplaced.filter((u) => u.origin ===
  'user-post')`, concaténé en tête (avec `userPre`) de `dedupeUnplaced([...userPre, ...userPost,
  ...rawUnplaced])` — sans ça, une tâche `user-post` d'avant le run disparaissait du `set` puisque
  `rawUnplaced` ne peut plus la contenir (elle n'est plus envoyée au moteur).
- Origines exclues du payload envoyé au moteur : `user-pre`, `user-post`. Origine conservée :
  `engine`. Après un run réussi, `unplaced` contient : `user-pre` (inchangé), `user-post` d'avant
  le run (préservées telles quelles, nouveau), `engine` renvoyées par le moteur (`rawUnplaced`).
- `resetCurrentSolution` (~l.336) : non touché — il rejoue `lastRun` (retouches perdues par
  construction, y compris les `user-post`), ce qui est le comportement voulu de « ↺ Réinitialiser »
  et distinct de `runSchedule`. Vérifié mais pas modifié.
- Mutation-testing manuel : filtre remis à `user-pre` seul + `userPost` retiré de la concaténation
  → les 2 tests correspondants (`runScheduleExclusion.test.ts` cas 1 et 3) échouent bien ; remis en
  état ensuite.

### §3.2 — libellés `SidebarAnalysis.tsx`
- Bouton déclencheur, titre du dialogue, bouton de confirmation (cas sans promotion) : passés de
  « Retour à la préparation » à « Annuler la planification automatique ». Bouton de confirmation
  (cas avec promotions) : « Conserver N imposition(s) et revenir » → « … et annuler ».
- Texte d'introduction du dialogue (les deux variantes selon `promotionCandidates.length`) : non
  modifié — il ne mentionne déjà pas de « retour » quelque part, seulement la perte des retouches.
- `returnToPreparation` non renommée (fonction dans `usePlanningStore.ts` et son usage dans
  `SidebarAnalysis.tsx`) : commentaire ajouté aux deux endroits expliquant que le nom reflète
  l'ancienne formulation.

### §3.1 — barre d'outils permanente
- `app/planning/page.tsx` : `weekInput`/`handleSetWeek` déménagés tels quels (logique de bouclage
  `((n - 1) % 52 + 52) % 52 + 1` non touchée) ; nouveau state local + `setSelectedWeek` importé du
  store. La condition `lastRun !== null` qui gardait tout le conteneur `<div>` de la barre d'outils
  a été retirée : la barre est désormais toujours rendue, seuls les deux boutons
  (« Statistiques », « ↺ Réinitialiser ») restent dans un fragment conditionné par `lastRun !==
  null`. Le sélecteur (Label + Input) est dans un premier `<div>` non conditionné.
- Alignement : le sélecteur est le premier enfant du conteneur flex, sans `ml-auto` ; le bouton
  Statistiques garde son `ml-auto` existant — dans un flex row, `ml-auto` sur un élément pousse cet
  élément et tous les suivants vers la droite, donc Statistiques+Réinitialiser restent groupés à
  droite que le sélecteur soit présent ou non. Pas de changement visuel en état solution (`lastRun
  !== null`) par rapport à avant ce chantier ; en état préparation, la barre passe de vide à
  affichant le sélecteur seul, à gauche.
- Vérification visuelle **non faite en navigateur** : un serveur Next.js tournait déjà sur le port
  5173 (process externe, basePath `/edtts`, apparemment sans rapport avec ce dépôt en l'état) —
  je ne l'ai pas arrêté ni utilisé pour ne pas interférer avec un environnement que je ne contrôle
  pas. Confirmation faite par lecture du JSX uniquement (voir ci-dessus), pas par capture d'écran.
- `SidebarPreparation.tsx` : `weekInput`/`handleSetWeek`/le bloc `Label`+`Input` "week-input"
  retirés ; imports `Input`/`Label` retirés (plus utilisés — la seule référence restante à
  `weekInput` était dans un commentaire JSX déjà présent avant ce chantier, ligne ~156).
  `setSelectedWeek` retiré du destructuring du store (n'était plus utilisé que par
  `handleSetWeek`). `selectedWeek` conservé : toujours utilisé (création de cours manuel, note de
  semaine, analyse de contraintes, `CopyWeekPrepModal`, etc.).

### Tests
- Nouveaux fichiers : `__tests__/runScheduleExclusion.test.ts` (3 cas, §5.2 points 1-3),
  `__tests__/weekNavigationRoundtrip.test.ts` (1 cas, §5.2 point 4).
- `npx vitest run` : **30 fichiers, 377 tests, tous passants** (373 existants + 4 nouveaux, aucun
  test existant modifié ni supprimé — `persistPlacements.test.ts` et `unplacedPersistence.test.ts`
  passent sans changement, ils n'exercent ni `runSchedule` ni `applyPendingResult`).
- `npm run typecheck --workspaces --if-present` : propre sur les 4 packages.
- `npm run lint --workspace=packages/scheduler-client` : **27 problèmes (7 erreurs, 20
  avertissements)** — identique à la référence (§5.1 : "27 problèmes préexistants"), aucun nouveau.
- `npm run build --workspace=packages/scheduler-client` : `next build` réussi, 8 pages statiques
  générées.

### Fichiers touchés
Conformes au tableau §6 du plan : `app/planning/page.tsx`, `SidebarPreparation.tsx`,
`SidebarAnalysis.tsx`, `store/usePlanningStore.ts`, plus les 2 fichiers de tests ci-dessus. Aucun
fichier hors de cette liste modifié.

### Reste à faire
§5.3 (passe manuelle, 7 points, réservée à Frédéric) — non faite.

## Relecture (Opus, 2026-07-22)

Contrôles refaits indépendamment : typecheck propre sur les 4 workspaces, **377/377** tests, lint 27
(inchangé), build OK. Aucun test existant modifié ni supprimé.

Diff conforme au plan, **aucune correction nécessaire** — première fois de la série.

- Sélecteur de semaine visible dans les deux états : le conteneur de la barre d'outils est
  inconditionnel, seuls « Statistiques » et « ↺ Réinitialiser » restent gardés par `lastRun`.
- `returnToPreparation` non renommée, commentée aux deux endroits.
- `week-input` : zéro occurrence restante dans `SidebarPreparation`.
- Libellés du dialogue passés à « Annuler la planification automatique », y compris la variante
  « Conserver N imposition(s) et **annuler** ».

**Mutation faite en relecture** : retrait de `userPost` de la concaténation dans
`applyPendingResult` → le cas 3 de `runScheduleExclusion.test.ts` échoue. C'est le piège signalé
par le §3.3 du plan — sans cette préservation, une tâche retirée à la main disparaissait de la
pioche après un run, devenant introuvable.

**Un risque vérifié plutôt que supposé.** `weekInput` est un state local qui vit désormais dans
`page.tsx`, laquelle ne se démonte jamais — là où `SidebarPreparation` était remontée à chaque
bascule. Un `setSelectedWeek` venu d'ailleurs aurait donc pu laisser le champ désynchronisé.
Vérifié par grep : tant que la page planning est montée, seul le toolbar écrit `selectedWeek` ; les
autres appelants (`CoursesImportBlock`, `projectLifecycle`) vivent sur des pages dont la navigation
provoque un remontage. Pas de chemin de désynchronisation.

**Écart de procédure signalé par l'exécutant** : le CHECKPOINT §4 a été dépassé, l'implémentation
enchaînant directement sur §5.1/§5.2 avant rédaction du STATUT. Sans conséquence ici (résultat
conforme, rien fait au-delà du plan), mais c'est le garde-fou qui a permis d'attraper les
régressions des chantiers précédents — à ne pas laisser devenir une habitude.

**§5.3 déroulée par Frédéric le 2026-07-22 : validée.** Les 7 points passent, dont le premier —
planifier, retoucher, changer de semaine depuis la barre d'outils sans rien annuler, revenir, et
tout retrouver. **C'est la demande d'origine, satisfaite.**

---

**Branche :** `feature/week-navigation` — **à créer depuis master, ne pas travailler sur master.**
**Rôle :** conception validée (Opus/Frédéric) → exécution Sonnet.
**Statut :** À IMPLÉMENTER.
**Prérequis livrés :** modèle unifié complet et persistance des placements (`798adca`).
**Lire d'abord :** `docs/PlanPersistPlacements.md`, en particulier la correction en tête du §6.4 —
c'est elle qui motive ce chantier.

## 1. Objectif

La demande d'origine — « revenir à l'étape de préparation efface une solution, je veux changer
ça » — n'est satisfaite qu'à moitié depuis `798adca`. Les placements survivent au rechargement de
page, mais **pas au changement de semaine** : non par perte de données, mais par absence de chemin.

Le sélecteur de semaine vit dans `SidebarPreparation`, que `SidebarLeft` n'affiche que si
`lastRun === null`. Changer de semaine impose donc « ← Retour à la préparation » →
`returnToPreparation([])`, qui vide les placements `auto`/`post-enforced` **et l'écrit sur le
disque**.

Mesuré sur la branche précédente : un changement de semaine **direct** restaure les placements à
leur position retouchée avec `lastRun` intact ; le même changement **via le retour à la
préparation** rend 0 placement et `[]` persisté. La persistance est correcte — c'est la navigation
qui est prise en otage.

### 1.1 Pourquoi ce chantier est petit

Une conception plus large a été envisagée puis écartée avec Frédéric : supprimer la bascule et
n'avoir qu'une sidebar. Analyse faite, **la bascule est cohérente** avec le modèle de planification
retenu — un run place *tout ce qui reste*, donc après un run il n'y a plus rien à auto-placer et
relancer suppose d'annuler d'abord. Le bouton « Planifier » n'a effectivement rien à faire dans
l'état « une planification auto existe ».

Deux limites que j'attribuais à la bascille perdent également leur poids : ne pas pouvoir créer une
zone bloquée ni imposer un cours en état solution est acceptable, puisque **annuler pour modifier
est le geste normal** et qu'il ne détruit plus le travail manuel (dialogue de promotion, étape 3).

Reste donc un seul vrai défaut : la **navigation** n'a rien à voir avec la planification et ne doit
pas dépendre de son état.

### 1.2 Ce qui ne bouge pas

Aucun changement moteur n'est nécessaire. Au moment d'un run, les seuls placements existants sont
des `pre-enforced` — placer à la main avant un run passe forcément par l'imposition
(`handleEnforceChange`), et la pioche n'est visible qu'en état solution. Or les `pre-enforced` sont
déjà transmis au moteur. La limitation « imposition ignorée dans un groupe de tâches »
([[project_enforced_ignored_in_task_groups]]) ne mord donc pas davantage qu'aujourd'hui.

## 2. Non-objectifs

- **NE PAS** supprimer la bascule ni fusionner les deux sidebars (§1.1). On verra à l'usage.
- **NE PAS** modifier `scheduler-core`, `scheduler-common`, `scheduler-api`.
- **NE PAS** traiter la limitation des groupes de tâches.
- **NE PAS** changer le format persisté ni la logique de sauvegarde.
- **NE PAS** toucher au contenu des deux sidebars au-delà de ce que §3 décrit : la liste des cours,
  les groupes, la pioche, la config moteur restent où ils sont.

## 3. Changements de code

### 3.1 Sortir le sélecteur de semaine — `app/planning/page.tsx`, `SidebarPreparation.tsx`

Le champ semaine (`week-input`) et sa logique de bouclage (`handleSetWeek`, qui ramène toute saisie
dans 1–52) quittent `SidebarPreparation` pour une **barre d'outils permanente** en tête du `<main>`
de `app/planning/page.tsx`.

Cette barre existe déjà, mais conditionnée par `lastRun !== null` (l.103) et ne contenant que
« Statistiques » et « ↺ Réinitialiser ». Elle devient **inconditionnelle** :

- toujours affichés : le sélecteur de semaine, et le nom/numéro de semaine ;
- affichés seulement si `lastRun !== null` : « Statistiques » et « ↺ Réinitialiser ».

Le bouton « Statistiques » porte aujourd'hui `ml-auto` pour pousser le groupe à droite ; avec le
sélecteur à gauche, vérifier que l'alignement reste correct et l'ajuster si besoin. Signaler le
choix au checkpoint.

`handleSetWeek` déménage tel quel — **ne pas réécrire la logique de bouclage**, qui est subtile
(`((n - 1) % 52 + 52) % 52 + 1`, pour que 0 → 52 et 53 → 1). Le state local `weekInput` déménage
avec.

⚠️ Vérifier que `SidebarPreparation` compile encore sans ces éléments : `selectedWeek` y reste
probablement utilisé ailleurs (création de cours manuel, note de semaine).

### 3.2 Recadrer l'annulation — `SidebarAnalysis.tsx`

« ← Retour à la préparation » devient **« Annuler la planification automatique »**. Ce n'est pas
qu'un libellé : le geste ne sert plus à naviguer, seulement à défaire l'auto-placement.

Le dialogue existant (liste des retouches à cocher, livré à l'étape 3) est conservé tel quel. Seuls
changent le titre, le texte d'introduction et le libellé du bouton de confirmation, qui doivent
parler d'annuler la planification automatique et non de « revenir » quelque part.

L'action reste `returnToPreparation(idsCochés)` — **ne pas la renommer** : c'est du code, pas de
l'UI, et le renommage brouillerait le lien avec le plan de l'étape 3. Ajouter en revanche un
commentaire sur la fonction disant que son nom reflète l'ancienne formulation.

### 3.3 Sort des `user-post` au lancement d'un run — `store/usePlanningStore.ts`

`runSchedule` exclut aujourd'hui les seuls `user-pre` (`userPreTaskIds`, ~l.382). Une tâche que
l'utilisateur vient de retirer du calendrier (`user-post`) serait donc replacée par le run
suivant — « Planifier » déferait son geste.

**Décision retenue : exclure aussi les `user-post` du payload.** Les `engine` (que le moteur n'a pas
su placer) restent envoyées : les conditions ont pu changer entre-temps.

Renommer la variable en conséquence (`excludedTaskIds` plutôt que `userPreTaskIds`) et commenter la
règle : *on n'envoie pas au moteur ce que l'utilisateur a explicitement écarté, quel que soit le
moment où il l'a fait ; on retente ce que le moteur seul a échoué à placer.*

⚠️ Conséquence à ne pas manquer : une tâche `user-post` restera non placée après le run et devra
donc **rester dans la pioche**. Vérifier que `applyPendingResult` ne l'efface pas — il reconstruit
`unplaced` à partir des seuls `userPre` + retour moteur (~l.347). Les `user-post` doivent survivre
au run au même titre que les `user-pre`.

### 3.4 Ordre de travail
1. §3.3 (store) et son test — indépendant de l'UI.
2. §3.1 puis §3.2.

## 4. CHECKPOINT feu-vert (obligatoire — s'arrêter ici)

- diff complet ; `npm run typecheck --workspace=packages/scheduler-client` propre ;
- confirmation que **le sélecteur de semaine est visible dans les deux états** (capture ou
  description du rendu dans les deux cas) ;
- confirmation que `returnToPreparation` n'a **pas** été renommée ;
- la liste exacte des origines exclues du payload et de celles conservées dans `unplaced` après un
  run (§3.3) ;
- l'ajustement d'alignement de la barre d'outils (§3.1).

## 5. Validation

### 5.1 Non-régression automatisée
`npm run test --workspace=packages/scheduler-client` (373 attendus), `typecheck` racine, `lint`
(27 problèmes préexistants attendus), `build`.

Attention : `__tests__/persistPlacements.test.ts` et `unplacedPersistence.test.ts` couvrent le
comportement de `runSchedule` et de `unplaced`. S'ils échouent, **c'est un signal** — les
rapporter sans les ajuster, sauf s'ils testent explicitement la règle que §3.3 change, auquel cas
les mettre à jour en expliquant pourquoi l'ancienne assertion était liée à l'ancien comportement.

### 5.2 Tests ciblés à écrire
1. `runSchedule` : une tâche `user-post` n'est pas envoyée au moteur (vérifier le payload soumis).
2. `runSchedule` : une tâche `engine` **est** envoyée.
3. Après `applyPendingResult`, une tâche `user-post` d'avant le run est toujours dans `unplaced`.
4. Changement de semaine avec une solution en place → retour sur la semaine : les placements
   `auto`/`post-enforced` et `lastRun` sont restaurés. **C'est la non-régression de la demande
   d'origine** — le test qui échouait à exister jusqu'ici.

### 5.3 Passe manuelle (Frédéric)
1. Planifier, retoucher deux tâches. **Changer de semaine depuis la barre d'outils, sans rien
   annuler.** Revenir : tout est là, retouches comprises. *C'est la demande d'origine, enfin
   atteignable.*
2. Recharger la page après ce va-et-vient : idem.
3. « Annuler la planification automatique » : le dialogue propose bien les retouches à conserver,
   et le libellé ne parle plus de « revenir à la préparation ».
4. Après annulation, la sidebar repasse en préparation et le sélecteur de semaine **reste au même
   endroit** (il ne doit pas sauter d'une colonne à l'autre).
5. Retirer une tâche du calendrier vers la pioche, puis « Planifier » : elle **n'est pas replacée**
   et reste dans la pioche.
6. Une tâche que le moteur n'avait pas su placer est bien **retentée** au run suivant.
7. Saisir 0 puis 53 dans le sélecteur : le bouclage 52 / 1 fonctionne comme avant.

## 6. Fichiers touchés (récapitulatif)

| Fichier | Nature |
|---|---|
| `app/planning/page.tsx` | §3.1 barre d'outils permanente + sélecteur de semaine |
| `components/planning/sidebar/SidebarPreparation.tsx` | §3.1 retrait du sélecteur |
| `components/planning/sidebar/SidebarAnalysis.tsx` | §3.2 libellés du dialogue |
| `store/usePlanningStore.ts` | §3.3 exclusion des `user-post` |
| tests vitest | §5.2 |

## 7. Ce que l'exécution rapporte

**STATUT** en tête de ce document : faits bruts uniquement — diff conforme ou non et où il s'en
écarte, compteurs de tests avant/après, tests existants modifiés **et pourquoi**, arbitrages
retenus. **Ne pas** écrire « vérifié », « validé », « corrigé » ni conclure sur le gain : les
conclusions sont écrites au retour par le relecteur.
