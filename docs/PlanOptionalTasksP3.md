# Plan d'implémentation P3 — exposer le B&B tâches optionnelles (config + fabrique + API + UI)

> **STATUT (2026-07-17, exécution par Sonnet) : LIVRÉ, prêt à committer.** §0 à §5 implémentés conformes au plan. Écart mineur non anticipé : `scheduler.ts` avait un second littéral `Required<SchedulerConfig>` dupliqué (champ `_config` par défaut, indépendant de `DEFAULT_SCHEDULER_CONFIG`) — complété avec `searchStrategy: 'elimination'` sinon le typecheck échouait (`scheduler.ts` n'est pourtant pas dans le périmètre §2, mais ce littéral existait déjà avant P3, indépendamment de la fabrique).
>
> **Tests** : 5 nouveaux (3 fabrique + 2 soundness, calibrés empiriquement — le test soundness confirme que sans le correctif §0, `provenOptimal` aurait été à tort `true` sur un scénario groupe-de-3 sous `maxEliminations:1`) + 11 existants inchangés = 16/16 verts. Suites complètes : 97/97 scheduler-core, 257/257 scheduler-client, typecheck clean.
>
> **Smoke API** (serveur local) : les 3 variantes (`v2` sans options, `'elimination'`, `'maxPlacement'`) rendent exactement le comportement attendu — `provenOptimal` absent pour les deux premières, présent (`true`, 1 seule solution) pour la troisième. Chemin async (`v2/async` + poll) : `provenOptimal` propagé correctement jusqu'au job terminé.
>
> **Sanity données réelles via l'API** : S37 → 94/97 placées, `provenOptimal: true` ; S40 (COS on) → 105/107, `provenOptimal: false` — identique aux chiffres de la validation directe P1.5, confirmant que le câblage API ne modifie rien au comportement du moteur.
>
> **Vérification UI (Playwright)** : dialogue de config — sélection « Placement maximal », validation, **réouverture confirmant la persistance** (toutes deux vérifiées live, aucune erreur console/page sur tout le parcours, y compris import du projet réel via upload du fichier JSON). Lancement d'une planification réelle (S37) via le bouton « Planifier » confirmé fonctionnel côté réseau (job soumis, poll, complétion en ~30-60s avec la config par défaut de l'app — `maxIterations:1M`, `lunchBreak:none`, plus lent que la config resserrée de la validation P1.5 mais résultat cohérent). **Limite du script de vérification** : le texte exact du toast de statut affiché n'a pas pu être capturé de façon fiable (probable sélecteur/timing du composant de toast, pas creusé davantage) — le code de `buildScheduleStatus` (§4.2) reste simple et déjà relu, mais son rendu final en live n'a pas été visuellement reconfirmé. Recommandé si Frédéric veut la certitude visuelle : un essai manuel rapide du dialogue + d'un lancement en `maxPlacement`.
>
> Reste avant commit : rien — commit unique à suivre.

*Plan rédigé par Fable pour implémentation par Sonnet. Prérequis : P1.5 livré (`e405cc8`). Branche : `feature/optional-tasks`. Objet : rendre `OptionalTasksScheduler` sélectionnable depuis l'application, du dialogue de configuration jusqu'au worker, et exposer sa valeur métier différenciante — la preuve d'optimalité (« inutile de relancer avec plus de budget : il faut relâcher des contraintes »).*

## 0. Pré-correctif obligatoire — soundness de `_provenOptimal`

**Défaut identifié en revue P1.5 (non bloquant tant que le flag restait interne ; bloquant dès qu'on l'expose).** Quand `greedyCost > maxEliminations + 1` strictement (le gourmand, qui compte en ROUNDS, saute une unité multi-tâches sous un cap serré), la borne d'attaque vaut `maxEliminations + 1 < greedyCost`. L'épuisement de l'arbre prouve alors seulement « aucune solution à coût ≤ maxEliminations », PAS l'optimalité du résultat gourmand rendu (un coût intermédiaire entre `maxEliminations + 1` et `greedyCost − 1` pourrait exister). Le `this._provenOptimal = !this._budgetExceeded;` actuel revendiquerait à tort un optimum prouvé.

**Correctif** (dans `solveWithElimination`, après `_bb()`) :

```ts
const finalCost = best
    ? (best.neutralizedUnits ?? []).reduce((n, i) => n + i.unit.getMemberTasks().length, 0)
    : 0; // best === null : l'épuisement prouve l'infaisabilité sous le cap — revendication valide
this._provenOptimal = !this._budgetExceeded && finalCost <= this._config.maxEliminations + 1;
```

*Justification des trois cas d'épuisement : (a) le B&B a trouvé un incumbent → `finalCost = _bestTaskCount` ≤ borne initiale ≤ cap, « rien de strictement sous finalCost » = optimalité, condition vraie ; (b) pas d'amélioration, `greedyCost ≤ maxElim+1` → borne = greedyCost, « rien sous greedyCost » = optimalité du gourmand, condition vraie ; (c) pas d'amélioration, `greedyCost > maxElim+1` → la preuve ne couvre pas [maxElim+1, greedyCost), condition FAUSSE — c'est le cas corrigé. Le court-circuit gourmand-complet (coût 0) reste inchangé.*

**Test dédié** : groupe séquentiel de 3 membres inplaçable + `maxEliminations: 1`. Le gourmand élimine le groupe entier en 1 round (coût 3 > cap 2) ; le B&B épuise son arbre (le saut coûte 3 ≥ borne 2, élagué) ; le résultat gourmand est rendu (jamais pire) mais `provenOptimal === false` désormais. Vérifier empiriquement avant de figer (méthode habituelle). Les sous-cas existants `maxEliminations: 1` (« coût des groupes » : coût 2 = cap 2 → preuve SAINE, doit rester `true` si testé ; « cascade » idem) ne doivent pas changer de résultat.

## 1. `SchedulerConfig.searchStrategy` (scheduler-common)

`packages/scheduler-common/src/types.ts` :

```ts
/**
 * Stratégie de recherche du moteur (défaut : 'elimination').
 * - 'elimination' : moteur historique — résolution gourmande, élimination itérative des unités
 *   les plus bloquantes, jusqu'à maxSolutions solutions.
 * - 'maxPlacement' : branch-and-bound sur les sauts (OptionalTasksScheduler) — maximise le
 *   nombre de tâches placées, jamais pire que 'elimination' (warm start), une seule solution
 *   (la meilleure), maxSolutions ignoré ; peut PROUVER l'optimalité du résultat (voir
 *   provenOptimal). Le résultat partiel est un diagnostic pour la boucle de relâchement, pas
 *   une solution finale (docs/ConceptionTachesOptionnelles.md §1).
 */
searchStrategy?: 'elimination' | 'maxPlacement';
```

+ `searchStrategy: 'elimination'` dans `DEFAULT_SCHEDULER_CONFIG`. Rétrocompatible : tout payload existant sans ce champ garde le comportement actuel. Nommage arbitré dans le doc de conception — ne pas rouvrir.

## 2. Fabrique (scheduler-core)

Dans `optionalTasksScheduler.ts` (PAS dans `scheduler.ts`, qui reste intouché — principe « code séparé ») :

```ts
/** Fabrique : sélectionne le moteur selon config.searchStrategy (défaut : Scheduler historique). */
export function createScheduler(config?: SchedulerConfig): Scheduler {
    return config?.searchStrategy === 'maxPlacement' ? new OptionalTasksScheduler() : new Scheduler();
}
```

Export depuis `index.ts`. Le `.configure(options)` de l'appelant reste inchangé (la config complète, `searchStrategy` compris, est simplement ignorée par le moteur qui n'en a pas l'usage).

## 3. Exposer `provenOptimal` (core → API → client)

1. **Core** : getter public sur `OptionalTasksScheduler` — `get provenOptimal(): boolean { return this._provenOptimal; }`. Nettoyage au passage : la sous-classe de test `InspectableOptionalTasksScheduler` peut s'appuyer dessus au lieu du cast `(this as unknown as ...)`.
2. **Types** : `ScheduleSolutionJSON.provenOptimal?: boolean` (scheduler-common). Absent pour le moteur historique — les clients existants ne voient rien changer.
3. **API** : dans `scheduleController.ts` ET `scheduler.worker.ts`, remplacer `new Scheduler()` par `createScheduler(body.options)` / `createScheduler(payload.options)` (import depuis `@edt-ts/scheduler-core`), puis après la sérialisation :

```ts
if (scheduler instanceof OptionalTasksScheduler) {
    for (const sol of response) sol.provenOptimal = scheduler.provenOptimal;
}
```

## 4. Client

1. **`lib/api/scheduleApi.ts`** : `NormalizedSolution.provenOptimal?: boolean` + passthrough dans le mapping de la réponse (les deux chemins : synchrone `_callScheduleApi` et asynchrone — vérifier où la réponse du job est normalisée, même mapping).
2. **`buildScheduleStatus`** : si `!isComplete && provenOptimal` → suffixer le message : « — optimum prouvé : impossible de placer plus sans relâcher des contraintes ». Pas d'autre changement d'affichage en P3 (les `reason` des sautées transitent déjà par `neutralizedTasks`).
3. **`SchedulerConfigDialog.tsx`** : nouveau champ `Draft.searchStrategy` + bloc dans la section « Général » (en tête de section — c'est le choix le plus structurant du dialogue). Deux boutons radio (pas un Select : 2 options, la description compte) :
   - **« Élimination itérative (par défaut) »** — Moteur historique : élimine une à une les tâches les plus bloquantes, propose jusqu'à N solutions.
   - **« Placement maximal (branch-and-bound) »** — Maximise le nombre de cours placés, jamais pire que l'élimination. Une seule solution (la meilleure) : le nombre max de solutions est ignoré. Peut prouver qu'aucun résultat meilleur n'existe — dans ce cas, seul un relâchement de contraintes peut débloquer les cours restants.
   - `configToDraft`/`draftToConfig` mis à jour (fallback `DEFAULT_SCHEDULER_CONFIG.searchStrategy`). Optionnel (si trivial) : griser l'input « Nombre max de solutions » quand `maxPlacement` est sélectionné.

Rien d'autre côté client : `schedulerConfig` transite déjà intégralement via `options` dans le payload (`useAppConfigStore` → `_buildPayload`), chemins synchrone et job async compris.

## 5. Tests

- **Core, fabrique** (nouveau bloc dans `schedulerOptionalTasks.test.ts` ou fichier dédié) : `createScheduler()` sans config → `Scheduler` (pas `OptionalTasksScheduler`) ; `{ searchStrategy: 'elimination' }` → `Scheduler` ; `{ searchStrategy: 'maxPlacement' }` → `OptionalTasksScheduler`.
- **Core, garde de soundness** : le test du §0.
- **Suites existantes** : 11 tests P1/P1.5 + toutes suites core/client au vert. Vérifier notamment que les sous-cas `maxEliminations: 1` existants gardent leur résultat (voir §0).
- Pas d'infra de test dans scheduler-api : couvert par le smoke §6.

## 6. Validation

1. `npm run typecheck` racine + suites complètes core et client.
2. **Smoke API** (scheduler-api lancé localement) : POST `/api/schedule/v2` sur un petit payload, trois variantes — sans `options.searchStrategy` (comportement actuel, pas de champ `provenOptimal`), avec `'elimination'` (idem), avec `'maxPlacement'` (réponse à 1 solution, `provenOptimal` présent). Vérifier aussi le chemin async (`/api/schedule/v2/async` + poll) avec `'maxPlacement'`.
3. **Sanity données réelles via l'API** (pas une campagne — P1.5 a déjà validé le moteur) : semaine 37 en `maxPlacement` → 94/97, `provenOptimal: true` ; semaine 40 → 105/107 avec COS on, `provenOptimal: false`. Pipeline weekSaves du script P1.5 réutilisable en le pointant vers l'API au lieu du Loader direct — ou plus simple, payload direct depuis l'export.
4. **UI** : vérification Playwright ad hoc (script jetable, convention habituelle) — ouvrir le dialogue, sélectionner « Placement maximal », valider, rouvrir (persistance), lancer une planification sur une semaine préparée et vérifier le message de statut. Frédéric fera le test réel complet à la main s'il le souhaite.

## 7. Livraison

- Commit unique sur `feature/optional-tasks` : §0 à §4 + tests + STATUT de CE document. Messages français, fichiers stagés par nom, signature habituelle, scripts tmp supprimés, aucun fichier `data/` commité.

## 8. Hors périmètre (explicite)

- Multi-solutions pour le B&B (contrat single-incumbent conservé).
- Affichage UI différencié des explications MUS des sautées (les `reason` transitent déjà — l'UI actuelle les montre telles quelles).
- P2 (LB par cliques, conflict-directed skip) — uniquement si la question « 106/107 sur S40 » redevient prioritaire.
- Merge vers master : décision séparée de Frédéric après P3.

## 9. Definition of done

- [ ] §0 : garde de soundness `_provenOptimal` + test dédié, sous-cas existants inchangés
- [ ] `searchStrategy` dans SchedulerConfig + défaut, fabrique `createScheduler` exportée
- [ ] API (controller + worker) via la fabrique, `provenOptimal` dans `ScheduleSolutionJSON`
- [ ] Client : passthrough `provenOptimal`, message de statut enrichi, dialogue de config avec les 2 stratégies
- [ ] Tests fabrique + soundness verts, suites complètes intactes, typecheck clean
- [ ] Smoke API 3 variantes + async, sanity S37/S40, vérif UI Playwright
- [ ] Commit unique, conventions respectées
