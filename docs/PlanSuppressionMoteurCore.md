# Suppression du moteur maison (`scheduler-core`) — CP-SAT seul moteur

## Contexte

Le projet embarque aujourd'hui **deux moteurs de planification** sélectionnables par
`SchedulerConfig.engine` (`'core' | 'cpsat'`) :

- `@edt-ts/scheduler-core` — moteur maison TypeScript (backtracking CSP + MCV + B&B),
  ~3 550 lignes de source et ~4 330 lignes de tests (149 `it()`) ;
- `scheduler-cpsat` — moteur Python/OR-Tools appelé en sous-processus, ~1 030 lignes,
  60 tests pytest.

CP-SAT est devenu le moteur de référence : c'est lui qui porte toutes les préférences douces
développées depuis (`compactTeacherHalfDays`, `minimizeTeacherDays`, `balanceTeacherDailyLoad`,
`crossNoonGap`, `minimizeTeacherRoomChanges`) et lui seul prouve l'optimum. Le moteur maison n'a
plus reçu de fonctionnalité depuis, mais continue de coûter : il double la surface de
configuration exposée dans l'UI, impose un aiguillage dans l'API, et ~8 000 lignes plus une
vingtaine de documents de conception à maintenir.

**Objectif** : ne conserver que CP-SAT dans `master`, après avoir figé l'état actuel à deux
moteurs sur une branche d'archive dédiée qui reste le seul témoin du moteur supprimé.

**Décisions déjà prises par Frédéric** (ne pas les rouvrir) :

| Sujet | Décision |
|---|---|
| Périmètre | **Suppression complète** du package et de tout le contrat core-only |
| Branche de sauvegarde | `archive/dual-engine`, créée depuis `master` et poussée |
| Pause méridienne flottante | **Onglet conservé mais désactivé** dans l'UI, avec mention explicite |
| Docs core-only | **Déplacées dans `docs/archive/`**, pas supprimées |

**Perte fonctionnelle assumée** : la pause méridienne flottante (CP-SAT lève une erreur
explicite dessus), `searchStrategy: 'maxPlacement'` + la borne inférieure racine `rootBound`,
`postRepair`, et les diagnostics d'échec `eliminationRound` / `failureCount`. `provenOptimal`
est conservé — CP-SAT l'émet aussi.

---

## Étape 0 — Branches (à faire en premier, avant toute modification)

```bash
git checkout master
git branch archive/dual-engine master
git push -u origin archive/dual-engine
git checkout -b feature/cpsat-only master
```

Tout le travail se fait sur `feature/cpsat-only`. **Jamais de commit direct sur `master`.**
Vérifier que `archive/dual-engine` est bien visible sur `origin` avant de supprimer quoi que ce
soit — c'est la seule sauvegarde.

---

## Étape 1 — Contrat partagé : `packages/scheduler-common/src/types.ts`

⚠️ **`scheduler-common` reste** : le client Next.js en dépend massivement en production
(`AvailabilityManager`, `SolutionAnalysis`, `SchedulerData`, `Availability`, ~50 imports). Seul
le contrat core-only est retiré.

**1a. `SchedulerConfig` — supprimer les champs core-only** (et la ligne correspondante dans
`DEFAULT_SCHEDULER_CONFIG`) :

`maxSolutions`, `maxIterations`, `maxEliminations`, `conflictOrderingSearch`,
`conflictSetExact`, `comboBranching`, `searchStrategy`, `postRepair`, **`engine`**.

Champs **conservés** : `timeoutSeconds`, `lunchBreak`, `ignoreDailyLimits`, et les cinq
préférences douces CP-SAT. Sur ces cinq, retirer la mention désormais fausse « Sans effet sur
le core » des commentaires.

**1b. `LunchBreakFloating` est conservé** (l'UI garde l'onglet désactivé), mais son commentaire
doit dire qu'aucun moteur ne l'implémente aujourd'hui.

**1c. Supprimer les types de sortie core-only** : `RootLowerBoundJSON`,
`RootLowerBoundCertificateJSON`, et le champ `ScheduleSolutionJSON.rootBound`.

**1d. `ScheduleSolutionJSON.provenOptimal` reste** — reformuler le commentaire pour qu'il parle
de la preuve CP-SAT et non du B&B du core.

**Contrôle** : `packages/scheduler-cpsat/cpsat_runner.py` (`_map_config`) ne mappe que 7
champs — confirmer par lecture qu'aucun champ supprimé n'y figure. Aucune modification Python
n'est attendue dans ce chantier.

---

## Étape 2 — API : `packages/scheduler-api`

**2a. `src/runEngine.ts`** — supprimer `runCoreEngine` et tous les imports de
`@edt-ts/scheduler-core`. Le fichier **reste** (ses deux appelants ont besoin de la séparation
`{ options, ...raw }`) et se réduit à :

```ts
import type { RawScheduleData, ScheduleSolutionJSON, SchedulerConfig } from '@edt-ts/scheduler-common';
import { runCpsat } from './cpsatGateway.js';

/** Unique point d'entrée moteur (CP-SAT). Réutilisé par le handler sync et le worker async. */
export async function runEngine(
  payload: RawScheduleData & { options?: SchedulerConfig },
): Promise<ScheduleSolutionJSON[]> {
  const { options, ...raw } = payload;
  return runCpsat(raw, options);
}
```

**2b. Supprimer `src/serializeScheduler.ts`** — seul consommateur de `SchedulerSolution` /
`UnitSolution` / `NeutralizedUnitInfo`, plus rien ne l'appelle après 2a.

**2c. Retirer la dépendance au core** dans trois fichiers :
- `package.json` : la ligne `"@edt-ts/scheduler-core": "*"` des `dependencies` ;
- `tsconfig.json` : l'entrée `paths` `"@edt-ts/scheduler-core"` ;
- `vitest.config.ts` : l'alias `'@edt-ts/scheduler-core'`.

Puis `npm install` à la racine pour régénérer `package-lock.json`.

**2d. Tolérance d'entrée** — `src/controllers/scheduleController.ts` ne fait aucune validation
stricte du corps (pas de zod sur `options`) et le runner Python ignore les clés inconnues : un
`engine: 'core'` résiduel envoyé par un client non migré sera **ignoré silencieusement** plutôt
que de provoquer une erreur. C'est le comportement voulu, aucun code défensif à ajouter. Le
commentaire d'en-tête de `schedulerV2Handler` (« Nouveau moteur (Scheduler) avec élimination
intégrée », `maxEliminations`) est obsolète — le réécrire.

---

## Étape 3 — Suppression du package et des scripts

```bash
git rm -r packages/scheduler-core
```

Puis dans `package.json` **racine** : supprimer les scripts `test-ar` et
`test-ar-elimination` (ils pointent déjà vers des cibles inexistantes du core).

`tsconfig.json` racine utilise `"include": ["packages/*/src"]` — aucune référence nommée à
retirer.

---

## Étape 4 — Client : `packages/scheduler-client`

**4a. `store/useAppConfigStore.ts` — migration v8 → v9.** C'est le point critique : sans elle,
les configurations déjà persistées chez les utilisateurs continuent d'envoyer `engine: 'core'`
et, pire, une éventuelle pause flottante que CP-SAT refuse.

Passer `version: 9` et ajouter à `migrate` :

```ts
// v9 : moteur unique CP-SAT — les options du moteur maison n'ont plus de destinataire.
for (const k of ['engine', 'maxSolutions', 'maxIterations', 'maxEliminations',
                 'conflictOrderingSearch', 'conflictSetExact', 'comboBranching',
                 'searchStrategy', 'postRepair']) {
  delete schedulerConfig[k];
}
// Aucun moteur ne gère la pause flottante : rabattre sur « aucune ».
if ((schedulerConfig.lunchBreak as { type?: string } | undefined)?.type === 'floating') {
  schedulerConfig.lunchBreak = { type: 'none' };
}
```

Conserver les `delete` et les valeurs par défaut déjà présents des versions antérieures.

**4b. `components/planning/modals/SchedulerConfigDialog.tsx`** (719 l., le plus gros morceau) :

- Supprimer le champ `engine` de `Draft`, la fonction `setEngine`, la variable `isCpsat`, et
  toute la `<section>` « Moteur » avec ses deux radios (~l. 224-256).
- Supprimer les champs `Draft` devenus sans objet : `maxIterations`, `maxEliminations`,
  `conflictOrderingSearch`, `conflictSetExact`, `postRepair`, `searchStrategy` — ainsi que
  leurs lignes dans `configToDraft` et `draftToConfig`.
- Supprimer la section `{!isCpsat && ...}` entière (« Stratégie de recherche », « Éliminations
  max », `conflictOrderingSearch`, `conflictSetExact`, `postRepair`, « Itérations max »),
  ~l. 380-500.
- Rendre inconditionnelles les sections aujourd'hui gardées par `{isCpsat && ...}` (préférences
  douces). Le titre « CP-SAT — préférences (douces) » peut devenir simplement
  « Préférences (douces) ».
- **Pause flottante** : garder l'onglet et son `TabsContent`, mais remplacer
  `disabled={isCpsat}` par `disabled` en dur (l. 585) et rendre le message d'aide permanent —
  reformulé sans faire référence à un choix de moteur, par exemple : « Pause flottante non
  supportée par le moteur — sélectionnez "Aucune" ou "Fixe". »

**4c. `lib/api/scheduleApi.ts`** :
- `_buildPayload` : retirer le forçage `maxSolutions: 1` (le champ n'existe plus au contrat) ;
- retirer le champ `rootBound` et sa logique du type de résultat local et du message
  « nombre de sauts inévitables » ; conserver `provenOptimal` et son message générique.

---

## Étape 5 — Documentation

**5a.** Créer `docs/archive/` et y déplacer via `git mv` les documents 100 % moteur maison :

`Scheduler.md`, `HeuristiquePriorite-Conception.md`, `ConceptionTachesOptionnelles.md`,
`PlanOptionalTasksP1.md`, `PlanOptionalTasksP15.md`, `PlanOptionalTasksP2Preuve.md`,
`PlanOptionalTasksP2Explication.md`, `PlanOptionalTasksP3.md`, `PlanLbCoutRacine.md`,
`PlanLbDFF.md`, `PlanLbSurrogateSymetrie.md`, `AuditBibliographiqueLB.md`,
`PlanConflictOrderingSearch.md`, `PlanBlameExact.md`, `PlanPostRepair.md`,
`PlanComboBranchementBB.md`, `PlanComboUnionMCV.md`, `AuditConformiteMCV.md`,
`PlanFixEliminationDependants.md`, `PlanFloatingLunchBreakGap.md`, `lunchBreakBiasAnalysis.md`.

Ajouter `docs/archive/README.md` : ces documents décrivent le moteur `scheduler-core`, retiré
du projet ; le code correspondant est sur la branche `archive/dual-engine`.

**5b.** Amender (ne pas déplacer) les docs qui décrivent le projet vivant :
- `README.md` racine : arborescence (l. 10-13), schéma de dépendances (l. 21), tableau des
  scripts (l. 32-33 — `test-ar` / `test-standard`, déjà obsolètes), section
  `@edt-ts/scheduler-core` (l. 63-69), l. 120 ; la section `scheduler-cpsat` (l. 92-111) cesse
  de parler d'un « 2e moteur sélectionnable » ;
- `INSTALL.md` : l. 261 (curl avec `"engine":"cpsat"`), l. 375 (« chacun des deux moteurs ») ;
  le venv Python + `ortools` deviennent un **prérequis dur** et non plus optionnel ;
- `docs/Deploiement.md` : l. 84-85, 130, 137 — même bascule de prérequis ;
- `docs/archi.md`, `docs/Task-Resources.md`, `docs/ConstraintsManager.md` : retirer les
  mentions du moteur maison.

**5c.** Instructions Copilot :
- `git rm .github/instructions/scheduler-core.instructions.md` (déjà périmé — il référence des
  fichiers qui n'existent plus) ;
- amender `.github/copilot-instructions.md` et
  `.github/instructions/scheduler-api.instructions.md`.

**5d.** Copier ce plan dans `docs/PlanSuppressionMoteurCore.md` pour la traçabilité repo,
conformément à la convention `docs/Plan*.md`.

---

## ⛔ CHECKPOINT — feu vert avant les tests

**S'arrêter ici et rendre la main.** Rapporter des **faits bruts** : fichiers supprimés,
fichiers modifiés, sortie exacte de `npm run typecheck`. Ne pas écrire « vérifié », « validé »
ou « corrigé » — les conclusions sont tirées au retour par le relecteur.

---

## Étape 6 — Tests (après feu vert)

**6a. `packages/scheduler-api/__tests__/runEngine.test.ts`** — 3 tests aujourd'hui, dont deux
exercent réellement le core. **Réécrire, pas supprimer** : un seul test suffit, vérifiant que
`runEngine` délègue à `runCpsat` avec `raw` et `options` correctement séparés (`runCpsat`
mocké). Le test d'aiguillage `engine: 'cpsat'` disparaît avec l'aiguillage.

**6b. `packages/scheduler-api/__tests__/cpsatGateway.test.ts`** — 4 tests, indépendants de
Python (faux runners Node). **Ne pas y toucher.**

**6c. `packages/scheduler-client/__tests__/appConfigStoreEngine.test.ts`** — 8 tests sur la
migration `engine`. Réécrire en tests de la migration **v9** : les 9 clés core-only sont
retirées d'un état v8, une `lunchBreak` flottante persistée est rabattue sur `{ type: 'none' }`,
les cinq préférences douces sont préservées. Renommer le fichier (`appConfigStoreMigration.test.ts`).

**6d. `packages/scheduler-client/__tests__/SchedulerConfigDialog.test.tsx`** — 8 tests, tous sur
le sélecteur de moteur. Les réécrire sur ce qui reste : les préférences douces sont toujours
visibles, l'onglet « Flottante » est présent mais désactivé, aucune option core-only n'est
rendue.

**6e. `packages/scheduler-client/__tests__/scheduleApi.test.ts`** — retirer les 2 tests
`rootBound`, garder le test `provenOptimal` générique.

**6f. Ne PAS confondre** `origin: 'engine'` (origine d'un cours non placé, concept **client**,
~15 fichiers de tests) avec `SchedulerConfig.engine`. Ces tests ne doivent pas être touchés.

---

## Étape 7 (séparable) — Diagnostics d'échec core-only

À traiter **uniquement après que les étapes 1-6 sont vertes**, en commit distinct : c'est la
partie la plus risquée car elle touche des données **persistées** dans `localStorage`.

CP-SAT n'émet que `reason` (cf. `_neutralized` dans `cpsat_engine.py`) : aujourd'hui déjà, en
mode CP-SAT, `SidebarAnalysis.tsx:241` affiche systématiquement « Échecs : 0 ». C'est un
affichage trompeur qu'il faut retirer.

- `scheduler-common/src/types.ts` : retirer de `NeutralizedTaskInfoJSON` les champs
  `eliminationRound`, `failureCount`, `requiredMinutes`, `schedulableMinutes`,
  `resourceSnapshots` (garder `reason`) ;
- `lib/calendar/unplaced.ts:15-16` et `components/planning/sidebar/SidebarAnalysis.tsx:72-73,241` :
  ne plus lire ni afficher ces champs ;
- adapter les tests qui les construisent en fixtures (`unplaced.test.ts`,
  `persistPlacements.test.ts`, `unplacedPersistence.test.ts`, `resourceLoadAnalysis.test.ts`,
  `weekNavigationRoundtrip.test.ts`, `runScheduleExclusion.test.ts`, `returnToPreparation.test.ts`,
  `piocheLoadAnalysis.test.tsx`).

**Point de vigilance** : les `UnplacedEntry.diagnostics` déjà persistés contiennent ces clés.
Retirer des champs *lus* ne casse rien au runtime (les clés en trop sont ignorées) — mais
confirmer qu'aucune validation stricte ne rejette un objet à clés surnuméraires au rechargement
d'un projet existant.

---

## Vérification

1. `npm run typecheck` à la racine — aucune référence résiduelle à `@edt-ts/scheduler-core`.
2. `grep -rn "scheduler-core\|engine.*'core'\|searchStrategy\|postRepair\|maxEliminations" packages/ .github/ *.md --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md"`
   → ne doit plus rien remonter hors `docs/archive/`.
3. `npm test -w packages/scheduler-api` puis `npm test -w packages/scheduler-client`.
4. `cd packages/scheduler-cpsat && .venv/bin/pytest test_solve.py` — doit rester vert sans
   modification (aucun changement Python attendu ; si un test bouge, c'est un signal).
5. `npm run build` à la racine — l'esbuild du worker ne doit plus bundler le core.
6. **Validation sur le VRAI projet, pas sur un payload d'exemple** :
   - **ré-exporter** le projet réel depuis l'application (les instantanés vieillissent) ;
   - lancer `npm run api:dev` + `npm run client:dev`, charger le projet, ouvrir les paramètres :
     vérifier qu'il ne reste aucune option core-only et que l'onglet « Flottante » est présent
     mais grisé ;
   - **cas critique de la migration** : partir d'un `localStorage` v8 réel contenant
     `engine: 'core'` (idéalement avec une pause flottante), recharger, et confirmer que la
     planification part bien vers CP-SAT sans erreur — c'est le seul chemin qui casse en
     production si la v9 est fausse ;
   - planifier une semaine chargée (S48) et comparer le résultat à un lancement CP-SAT
     antérieur. Attention : CP-SAT est non-déterministe en multi-thread — **ne pas comparer
     l'égalité exacte entre deux `solve()`**. Vérifier le nombre de cours placés et l'absence
     de violation, pas l'emploi du temps au créneau près.

---

## Ce qu'il ne faut pas faire

- Supprimer `packages/scheduler-common` — le client en dépend en production.
- Toucher au code Python : ce chantier ne modifie aucun fichier de `packages/scheduler-cpsat`.
- Toucher aux tests portant sur `origin: 'engine'` (concept client sans rapport).
- Merger dans `master` avant que Frédéric ait validé sur le projet réel.
- Supprimer `archive/dual-engine` ou la merger — c'est une archive, pas une branche de travail.
