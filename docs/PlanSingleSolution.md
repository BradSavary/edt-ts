# Plan d'implémentation — phase 1 : une seule solution côté client

## STATUT (exécution Sonnet, 2026-07-21)

Branche `refactor/single-solution` créée depuis `master` (HEAD `ca5d54a` au moment du checkout).
§3.1 à §3.8 implémentés. CHECKPOINT §4 franchi (feu vert Frédéric, 2026-07-21). §5.1/§5.2/§5.3
faits — voir en bas de section. Non committé à ce stade (attente d'instruction explicite).

**Diff :** `git diff --stat` limité à `packages/scheduler-client`, 8 fichiers :
`README.md`, `app/planning/page.tsx`, `components/planning/modals/SchedulerConfigDialog.tsx`,
`lib/api/scheduleApi.ts`, `store/README.md`, `store/types.ts`, `store/useAppConfigStore.ts`,
`store/usePlanningStore.ts`. +53/-216 lignes. Zéro fichier dans `scheduler-core`,
`scheduler-common`, `scheduler-api`.

**Typecheck** (`npm run typecheck --workspace=packages/scheduler-client`) : sortie vide, propre.

**Grep de contrôle**
(`grep -rn "selectedSolutionIndex\|solutionStates\|SolutionState\|maxSolutions" packages/scheduler-client --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out`) :
zéro occurrence de `selectedSolutionIndex`, `solutionStates`, `SolutionState`. Quatre lignes
`maxSolutions` restantes, toutes attendues :
- `lib/api/scheduleApi.ts:70-71` — le forçage `_buildPayload` (§3.1) + son commentaire.
- `store/useAppConfigStore.ts:28,30` — le `migrate` de purge (§3.2), qui doit nécessairement
  citer la clé pour la retirer de l'état persisté.

**Lint** (`npm run lint --workspace=packages/scheduler-client`) : 29 problèmes (7 erreurs,
22 warnings) après changement, contre 30 (7 erreurs, 23 warnings) sur `master` avant. Les 7
erreurs se répartissent sur trois fichiers, tous intouchés par ce diff : 4 dans
`components/config/TightThresholdBlock.tsx` (`react/no-unescaped-entities`), 1 dans
`components/constraints/ResourceConstraintEditor.tsx` (setState synchrone dans un effet), 2 dans
`components/planning/courses/TaskCard.tsx` (composants créés pendant le render). Toutes
présentes à l'identique avant et après, hors périmètre de ce plan.
*(Correction du relecteur, 2026-07-21 : le STATUT initial les attribuait toutes à `TaskCard.tsx`
— la conclusion « préexistantes, hors périmètre » tient, la localisation rapportée était fausse.)*
Le warning en moins est
`runScheduleRequestFromData is defined but never used` (import mort supprimé, §3.4). Aucun
nouveau warning introduit par ce changement (un `_maxSolutions` unused a été soulevé pendant
l'écriture puis éliminé par une réécriture du `migrate` sans destructuring — cf. diff final).

**Tests vitest** (`npm run test --workspace=packages/scheduler-client`) : 19 fichiers / 296 tests
passent, avant (`master`) comme après. Compteurs identiques.

**Trois points signalés (§3.3.4, §3.3.5, §3.7) :**
1. Grille du dialog (§3.3.4) : le `grid grid-cols-2 gap-4` enveloppant `maxSolutions` +
   `maxEliminations` est retiré ; `Éliminations max` devient un bloc pleine largeur
   (`div className="space-y-1.5"` directement dans la section), au même niveau que les blocs
   checkbox voisins.
2. Texte `maxPlacement` (§3.3.5) : la phrase supprimée est « Une seule solution (la meilleure) :
   le nombre max de solutions est ignoré. » ; le reste de la description (maximisation, jamais
   pire que l'élimination, preuve d'optimalité) est conservé mot pour mot.
3. Barre d'outils (§3.7) : le bouton « Solution N » disparaît, `ml-auto` reste sur le bouton
   Statistiques — le groupe Statistiques/Réinitialiser reste aligné à droite de la barre, comme
   avant. Confirmé correct visuellement par la passe manuelle §5.3 (point 4).

**Grep `runScheduleRequestFromData`** (avant modification) :
`README.md:83,297,399` (mentions doc) + `lib/api/scheduleApi.ts:146` (la fonction) +
`store/usePlanningStore.ts:4` (import). Aucun autre appelant dans `packages/scheduler-client`.
`runScheduleRequestFromData` et `_callScheduleApi` supprimés de `scheduleApi.ts` ; l'import mort
retiré de `usePlanningStore.ts` ; les trois mentions dans `README.md` réécrites pour décrire
l'API réellement utilisée (`submitJobAsync`/`pollJob`/`buildScheduleStatus`). Le type
`RunScheduleParamsFromData` est conservé (il type toujours `submitJobAsync`).

**Écart additionnel au texte du plan** : le grep de contrôle a fait remonter une cinquième
mention de `maxSolutions` non listée dans le plan — `README.md:165`, dans la description du
dialog de config (« `maxSolutions` — nombre de solutions à générer »), rendue fausse par §3.3.
Corrigée par cohérence avec l'esprit du §3.8 (« ne corriger que les lignes rendues fausses par
ce plan »), non explicitement prévue dans le texte.

### Après feu vert (§5)

**§5.2 — test ciblé** : `__tests__/scheduleApi.test.ts` créé, 6 cas sur `buildScheduleStatus`
(solution complète ; incomplète + neutralisées ; `tasks: []` seule et avec neutralisées ;
`provenOptimal` avec `rootBound.lb > 0` et sans). Chaque cas vérifie explicitement l'absence de
toute mention de nombre de solutions dans le message.

**§5.1 — suite complète après ajout du test** : 20 fichiers / 302 tests passent (296 + les 6
nouveaux). Typecheck propre. Lint : 29 problèmes (7 erreurs, 22 warnings), compte inchangé par
rapport à l'état post-§3 (le nouveau fichier de test n'introduit rien). `test:e2e` non lancé,
conformément à la note du plan (route interceptée `/api/schedule` non empruntée par le flux réel).

**§5.3 — passe manuelle sur projet réel** : faite par Frédéric lui-même (accès direct aux
serveurs de dev déjà démarrés, branche `refactor/single-solution`). Message reçu le
2026-07-21 : « Je te confirme le bon fonctionnement des 7 points du parcours » — couvre les
points 1 à 6 de la checklist §5.3 (config sans le champ solutions, payload `maxSolutions: 1`,
barre d'outils sans sélecteur, réinitialisation, changement de semaine, retour préparation).

---

**Branche :** `refactor/single-solution` — **à créer depuis master, ne pas travailler sur master.**
**Rôle :** conception validée (Opus/Frédéric) → exécution Sonnet.
**Statut :** IMPLÉMENTÉ, CHECKPOINT §4 et validation §5 faits. Non committé. Conclusion et décision
de merge à écrire par le relecteur (Opus, Fable ou Frédéric).
**Suite :** phase 2 = persistance des solutions dans le Projet (plan séparé, écrit après le
checkpoint de celui-ci). Ce plan-ci ne persiste rien.

## 1. Objectif

Le client ne propose plus, n'envoie plus et n'affiche plus qu'**une seule solution**. L'API et
le moteur conservent la capacité multi-solutions (`maxSolutions`) : **rien n'est modifié dans
`scheduler-core`, `scheduler-common` ou `scheduler-api`.** Le client force `maxSolutions: 1`
dans les requêtes et ne garde que la première solution rendue.

Décision et justification (Frédéric, 2026-07-21) : en pratique les solutions multiples rendues
sont quasi identiques — elles ne diffèrent que par le placement d'une ou deux tâches à 30 min
près. Le sélecteur n'a donc pas d'intérêt réel, et l'état par solution qu'il impose de maintenir
(`solutionStates`) est le principal obstacle à la phase 2 : sans lui, la forme persistée devient
exactement la forme runtime (sauvegarder = copier, charger = copier), au lieu d'exiger une
transformation « replier N solutions + états → 1 solution + son état » et son inverse.

Effet moteur assumé : en `searchStrategy: 'elimination'`, `_backtrack` s'arrête à
`_solutionsFound >= maxSolutions` et `_allSolutions` est trié par score décroissant avant retour
(`scheduler.ts` l.188 et l.284). Avec `maxSolutions: 1` on obtient donc la **première** solution
complète trouvée, pas la meilleure d'un lot de 6 — score potentiellement inférieur, recherche plus
rapide. Arbitrage accepté. En `searchStrategy: 'maxPlacement'`, `maxSolutions` est déjà ignoré par
le moteur : impact nul.

## 2. Non-objectifs (ne pas toucher à ce stade)

- **NE PAS** modifier `packages/scheduler-core`, `packages/scheduler-common`,
  `packages/scheduler-api`. `SchedulerConfig.maxSolutions` reste dans le type commun et reste
  honoré par le moteur — le client cesse simplement de l'exposer et le fixe à 1.
- **NE PAS** persister quoi que ce soit de la solution. `usePlanningStore` reste un store de
  session non persisté. Toute la persistance est la phase 2.
- **NE PAS** toucher à `computeEffectiveSolution`, aux calques d'édition (`taskOverrides`,
  `placedNeutralizedTasks`, `manuallyNeutralizedTasks`, `autonomyDistributions`), ni à la
  répartition Autonomie. Seul l'**index de solution** disparaît, pas l'état d'édition.
- **NE PAS** changer la politique d'invalidation existante (`handleEnforceChange`,
  `handleBlockedZoneAdd/Move` continuent de remettre `scheduleResult` à `null`). Ce débat est
  la phase 2.

## 3. Changements de code

Tout est dans `packages/scheduler-client`. Les numéros de ligne sont des repères au moment de
l'écriture du plan — se fier aux noms de symboles.

### 3.1 Forcer `maxSolutions: 1` dans le payload — `lib/api/scheduleApi.ts`

Point d'étranglement unique : `_buildPayload` (l.68), qui alimente **à la fois** le chemin async
utilisé par l'UI et le chemin sync. Remplacer :

```ts
const options: Record<string, unknown> = { ...schedulerConfig };
```

par :

```ts
// Le client ne gère plus qu'une solution (docs/PlanSingleSolution.md). Forcé ici plutôt que
// dans le store : `edt-app-config` déjà persisté chez les utilisateurs contient un
// `maxSolutions` hérité (6 par défaut) qui repartirait sinon dans la requête.
const options: Record<string, unknown> = { ...schedulerConfig, maxSolutions: 1 };
```

C'est ce forçage — pas le retrait du champ dans l'UI — qui garantit l'invariant. Ne pas le
déplacer ailleurs.

### 3.2 Purger la config persistée — `store/useAppConfigStore.ts`

`draftToConfig` (§3.3) cessera d'écrire la clé, mais seulement après que l'utilisateur ait ouvert
et enregistré le dialog une fois. Rendre l'état déterministe : passer `version: 1` → `version: 2`
et ajouter un `migrate` qui retire `maxSolutions` de `schedulerConfig`. La clé devient absente,
`_buildPayload` la réinjecte à 1.

### 3.3 Retirer le champ du dialog — `components/planning/modals/SchedulerConfigDialog.tsx`

1. `interface Draft` : supprimer `maxSolutions: string;` (l.46).
2. `configToDraft` : supprimer la ligne `maxSolutions:` (l.81).
3. `draftToConfig` : supprimer la ligne `maxSolutions:` (l.112). L'objet retourné n'a plus la clé
   — c'est voulu, cf. §3.2.
4. Supprimer le bloc UI `cfg-maxSolutions` (l.236-253) **et corriger la grille** : le
   `<div className="grid grid-cols-2 gap-4">` qui l'enveloppait ne contient plus que
   « Éliminations max ». Choisir la mise en page qui reste cohérente avec les autres blocs du
   dialog (soit fusionner « Éliminations max » dans une grille voisine, soit retirer la grille et
   laisser le bloc en pleine largeur). Signaler le choix retenu au checkpoint.
5. Reformuler la description de `maxPlacement` (l.225-229) : la phrase « Une seule solution (la
   meilleure) : le nombre max de solutions est ignoré. » n'a plus de sens quand le client n'en
   demande qu'une. Ne garder que ce qui reste vrai et informatif (maximisation du nombre de cours
   placés, jamais pire que l'élimination, preuve d'optimalité).

### 3.4 Replier `ScheduleResult` sur une solution — `lib/api/scheduleApi.ts`

```ts
export interface ScheduleResult {
  solution: NormalizedSolution;   // était: solutions: NormalizedSolution[]
  week: number;
}
```

`NormalizedSolution` est inchangé (`isComplete`, `score`, `tasks`, `neutralizedTasks`,
`provenOptimal`, `rootBound` — tous conservés, ils alimentent `buildScheduleStatus` et
`StatisticsDialog`).

`buildScheduleStatus` : `const best = result.solution;` et **supprimer** le fragment
`— ${result.solutions.length} solution(s)` du message de succès. Le reste du message
(`neutralizedMsg`, `provenMsg`, les deux branches ok/err) est inchangé mot pour mot.

**Code mort à vérifier puis supprimer :** `runScheduleRequestFromData` et son unique appelé
`_callScheduleApi` ne sont utilisés nulle part (l'UI passe par `submitJobAsync` + `pollJob`) ;
seul subsiste un import inutilisé en tête de `store/usePlanningStore.ts` (l.4). Confirmer par
`grep -rn "runScheduleRequestFromData" packages/scheduler-client --exclude-dir=node_modules`,
puis supprimer les deux fonctions + l'import mort, et retirer les mentions dans
`packages/scheduler-client/README.md` (l.83, 297, 399). **Conserver** le type
`RunScheduleParamsFromData` : il typa la signature de `submitJobAsync`. Si le grep révèle un
usage réel, ne rien supprimer et adapter la fonction au nouveau type à la place — et le signaler.

### 3.5 Adapter le store — `store/usePlanningStore.ts`

**Interface `PlanningStore` :**
- supprimer `selectedSolutionIndex` et `setSelectedSolutionIndex` (l.46-47) ;
- supprimer `solutionStates` (l.58) ;
- `scheduleResult: ScheduleResult | null` est conservé tel quel — c'est lui qui pilote
  l'aiguillage `SidebarLeft` → `SidebarAnalysis`, ne pas y toucher.

**`_normalizeJobResult`** (l.776) : ne construire qu'une solution, à partir de
`jobStatus.result?.[0]`. **Ne pas supposer que le tableau a exactement un élément** (le moteur
peut en rendre plusieurs sur d'autres chemins) : prendre le premier, ignorer les suivants. Cas
tableau vide/absent : synthétiser `{ isComplete: false, tasks: [], neutralizedTasks: [] }` plutôt
que renvoyer `null` — c'est ce qui préserve exactement le comportement actuel, puisque la garde
`!best || best.tasks.length === 0` de `applyPendingResult` déclenchera la branche « Aucune
solution trouvée » comme aujourd'hui, sans introduire de cas nullable en aval.

**`setSelectedSolutionIndex`** (l.231-252) : **supprimer intégralement**. C'est la fonction qui
gelait l'état d'édition courant dans `solutionStates` avant de basculer et restaurait celui de la
cible — sans index de solution, elle n'a plus d'objet.

**`resetCurrentSolution`** (l.259-273) : simplifier. Plus de `solutionStates` à purger, plus
d'index ; lire `scheduleResult.solution`, et remettre à vide les quatre champs d'édition
(`taskOverrides`, `placedNeutralizedTasks`, `manuallyNeutralizedTasks`, `autonomyDistributions`)
+ recalculer `activeNeutralizedTasks` comme aujourd'hui. **Comportement utilisateur inchangé.**

**`applyPendingResult`** (l.458) : `const best = result.solution;` ; retirer les clés
`selectedSolutionIndex: 0` et `solutionStates: {}` du `set`. La garde « aucune tâche placée →
on reste en préparation » est conservée telle quelle.

**Retirer les clés `selectedSolutionIndex: 0` et `solutionStates: {}` de tous les autres `set`**
qui les initialisent : `setSelectedWeek` (les deux branches, ~l.185/191 et ~l.209/216),
`handleEnforceChange` (~l.542), `resetScheduleResult` (~l.702/708), `reset` (~l.724/731).
Ne rien retirer d'autre de ces blocs.

**Ré-exports** (l.23-24) : retirer `SolutionState` de la ligne `export type { … }` et de l'import
correspondant.

### 3.6 Supprimer le type `SolutionState` — `store/types.ts`

Supprimer l'interface `SolutionState` (l.72-81) et son commentaire. `PlacedTaskOverride`,
`ManuallyNeutralizedTask`, `PlacedNeutralizedTask`, `AutonomyDistribution` et
`SerializedBlockedZone` restent.

### 3.7 Supprimer le sélecteur — `app/planning/page.tsx`

- Retirer les sélecteurs `selectedSolutionIndex` et `setSelectedSolutionIndex` (l.33-34).
- Retirer le `scheduleResult.solutions.length > 1 && …map(…)` (l.90-101).
- **Conserver** la barre `{scheduleResult && (…)}` et ses deux boutons « Statistiques » et
  « ↺ Réinitialiser ». Le `ml-auto` du bouton Statistiques poussait le groupe à droite face aux
  boutons de solutions ; sans eux, vérifier que l'alignement de la barre reste correct et ajuster
  si besoin (le signaler au checkpoint).

### 3.8 Documentation — `store/README.md`

Mettre à jour la section « Résultat de planification » : `scheduleResult` porte désormais une
solution unique, `selectedSolutionIndex`/`solutionStates` n'existent plus. **Ne pas** entreprendre
la remise à niveau générale du fichier (il parle encore de `useSchedulerStore`, renommé depuis en
`useProjectStore`) : hors périmètre, ne corriger que les lignes rendues fausses par ce plan.

### 3.9 Ordre de travail suggéré

1. §3.1 + §3.2 + §3.3 (payload et UI de config — indépendants du reste, testables seuls).
2. §3.4 puis §3.5/§3.6/§3.7 en s'appuyant sur `npm run typecheck --workspace=packages/scheduler-client` :
   le passage `solutions[]` → `solution` fait remonter mécaniquement chaque site d'appel restant.
3. §3.8 en dernier.

## 4. CHECKPOINT feu-vert (obligatoire — s'arrêter ici)

Faire valider par Frédéric **avant** d'écrire le moindre test :

- diff complet, limité à `packages/scheduler-client` (zéro fichier modifié dans `scheduler-core`,
  `scheduler-common`, `scheduler-api` — le vérifier explicitement et le dire) ;
- sortie de `npm run typecheck --workspace=packages/scheduler-client` (attendu : propre) ;
- sortie de `grep -rn "selectedSolutionIndex\|solutionStates\|SolutionState\|maxSolutions" packages/scheduler-client --exclude-dir=node_modules --exclude-dir=.next`
  (attendu : **une seule** occurrence de `maxSolutions`, celle de `_buildPayload` ; zéro pour les
  trois autres) ;
- les trois points de mise en page / formulation signalés : grille du dialog (§3.3.4), texte
  `maxPlacement` (§3.3.5), alignement de la barre d'outils (§3.7) ;
- le résultat du grep `runScheduleRequestFromData` et ce qui en a été conclu (§3.4).

## 5. Validation (dimensionnée à ce que le changement peut affecter)

Ce changement touche l'étape « résultat » du planning et le dialog de config. Il ne touche ni le
moteur, ni la préparation, ni la persistance du Projet. La validation est calibrée là-dessus.

### 5.1 Non-régression automatisée
- `npm run test --workspace=packages/scheduler-client` (vitest) et
  `npm run lint --workspace=packages/scheduler-client`. Aucun test existant ne référence
  `selectedSolutionIndex` ni `solutionStates` — la suite sert de garde sur le reste, pas de preuve
  sur ce changement. Rapporter les compteurs avant/après.
- Ne **pas** lancer `test:e2e` comme critère : `e2e/schedule.spec.ts` intercepte `/api/schedule`,
  route que le flux réel (`/api/schedule/v2/async`) n'emprunte pas — ces tests ne couvrent pas ce
  chemin. Si tu les lances quand même, rapporter le résultat brut sans en tirer de conclusion.

### 5.2 Test ciblé à écrire (nouveau)
Un test sur `buildScheduleStatus` (`lib/api/scheduleApi.ts`), fonction pure et seul endroit où le
repli change une chaîne visible par l'utilisateur. Couvrir : solution complète ; solution
incomplète avec neutralisées ; `tasks: []` → branche « Aucune solution trouvée » ;
`provenOptimal` avec et sans `rootBound.lb > 0`. Vérifier qu'aucun message ne mentionne plus un
nombre de solutions.

### 5.3 Passe manuelle sur le projet réel (obligatoire)
**RE-EXPORTER d'abord le projet réel** (les snapshots vieillissent), le charger dans le client,
puis sur une semaine chargée :
1. ouvrir les paramètres du moteur → le champ « Nombre max de solutions » a disparu, les autres
   champs se pré-remplissent et s'enregistrent normalement ;
2. planifier → vérifier dans l'onglet réseau que le payload contient `options.maxSolutions === 1` ;
3. le calendrier s'affiche, la barre d'outils n'a plus de boutons de solution, « Statistiques »
   et « ↺ Réinitialiser » fonctionnent ;
4. déplacer une tâche, en neutraliser une, en replacer une depuis la pioche, répartir une
   Autonomie — puis « ↺ Réinitialiser » : tout revient à l'état moteur ;
5. changer de semaine et revenir : comportement identique à avant ce changement (la solution est
   perdue — c'est le comportement actuel, la phase 2 le corrigera) ;
6. « ← Retour à la préparation » : la préparation (groupes, impositions, zones, pré-neutralisées)
   est intacte.

Rapporter chaque point comme observé, y compris ce qui diffère de l'attendu.

## 6. Fichiers touchés (récapitulatif)

| Fichier | Nature |
|---|---|
| `lib/api/scheduleApi.ts` | §3.1 forçage, §3.4 repli du type + `buildScheduleStatus` + suppression code mort |
| `store/useAppConfigStore.ts` | §3.2 version 2 + migrate |
| `components/planning/modals/SchedulerConfigDialog.tsx` | §3.3 retrait du champ |
| `store/usePlanningStore.ts` | §3.5 suppression index/états par solution |
| `store/types.ts` | §3.6 suppression `SolutionState` |
| `app/planning/page.tsx` | §3.7 suppression du sélecteur |
| `store/README.md`, `README.md` | §3.8 + §3.4 mentions |
| tests vitest | §5.2 nouveau test `buildScheduleStatus` |

## 7. Ce que l'exécution rapporte

Écrire un **STATUT** en tête de ce document à la fin : faits bruts uniquement — diff conforme ou
non au plan et où il s'en écarte, compteurs de tests avant/après, sorties de grep, observations
de la passe manuelle point par point. **Ne pas** écrire « vérifié », « validé », « corrigé » ni
attribuer un gain : les conclusions sont écrites au retour par le relecteur (Opus, Fable ou
Frédéric).
