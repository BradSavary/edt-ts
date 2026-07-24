# Plan — Brancher le moteur CP-SAT (2e moteur user-facing)

**Public : agent d'implémentation (Sonnet).** Ce plan est prescriptif. Les décisions
d'architecture sont **déjà tranchées** (voir §0) — ne pas les rouvrir. Exécuter étape par
étape ; chaque étape a des critères d'acceptation vérifiables. Travailler **exclusivement sur
la branche `feature/cpsat-solve-contract`** : aucun merge dans `master` tant que le bout-en-bout
(§1→§5) n'est pas vert.

## 0. Contexte et décisions verrouillées

Le moteur CP-SAT est **déjà consolidé** en `spikes/cpsat/cpsat_engine.py` :
`solve(raw: RawScheduleData, config) -> list[ScheduleSolutionJSON]`, parité prouvée avec le
spike (S38 110/110, S39 102/101, optima prouvés). Il parle déjà le contrat
`@edt-ts/scheduler-common` (`solutions`/`isComplete`/`score`/`provenOptimal`/`neutralizedTasks`).
Reste à le **relier** au reste du monorepo.

Décisions (Frédéric, 2026-07-24) — **NE PAS rouvrir** :

1. **Objectif = 2e moteur offert à l'utilisateur, PAS un oracle de complétude.** Ne pas forcer
   CP-SAT à répliquer la sémantique de scheduler-core. Features core-only écartées côté CP-SAT :
   pause **flottante**, `Autonomie` (pré-neutralisée). Voir mémoire `cpsat-second-engine`.
2. **Topologie = passerelle côté serveur.** `scheduler-api` route un flag `engine` vers un
   **subprocess Python** (`ortools` officiel). PAS d'API publique séparée appelée par le client
   (garde `scheduler-client` à origine unique, pas de CORS). C++ écarté.
3. **Emplacement du moteur Python : `packages/scheduler-cpsat/`** (nouveau package « de prod »,
   sort le code de `spikes/` jetable).
4. **Flag moteur : champ `engine?: 'core' | 'cpsat'` dans `SchedulerConfig`** (transite déjà via
   `options`, persiste avec les réglages, piloté par le panneau de config).

Chemin d'appel réel à connaître : le client passe **toujours par la file de jobs async**
(`submitJobAsync` → `POST /api/schedule/v2/async` → `JobQueue` → `scheduler.worker.ts` dans un
`worker_threads`). Le handler **sync** `POST /api/schedule/v2` existe mais n'est pas le chemin
utilisateur — il faut quand même le brancher pour cohérence et tests.

---

## 1. Package Python `packages/scheduler-cpsat/`

**But :** loger le moteur + un runner CLI que Node invoque en subprocess (JSON sur stdin/stdout).

- [x] `git mv spikes/cpsat/cpsat_engine.py packages/scheduler-cpsat/cpsat_engine.py`.
      Déplacer aussi `requirements.txt`. **Supprimer** `spikes/cpsat/run_stress.py` et le README
      du spike, ou les convertir (voir tests §6). Après ce déplacement, `spikes/cpsat/` peut être
      retiré entièrement (le `.venv` était git-ignoré).
- [x] Créer `packages/scheduler-cpsat/cpsat_runner.py` — **frontière process** :
  - lit **tout** stdin, `payload = json.loads(...)` ; attend `{ "raw": RawScheduleData, "config": SchedulerConfig }`.
  - appelle `solve(payload["raw"], _map_config(payload["config"]))`.
  - écrit `json.dumps(solutions)` sur **stdout** et rien d'autre (aucun `print` de debug sur stdout ;
    diagnostics éventuels sur **stderr**). Sortie process 0 si OK.
  - en cas d'exception : message sur stderr + `sys.exit(1)`.
  - `_map_config(SchedulerConfig) -> cpsat_config` : traduit uniquement les champs pertinents —
    `lunchBreak` (seuls `fixed`/`none` ; **`floating` → lever une erreur explicite**
    « pause flottante non supportée par le moteur CP-SAT »), `ignoreDailyLimits`, `timeoutSeconds`.
    Ignorer silencieusement les champs core-only (`maxEliminations`, `comboBranching`, `postRepair`,
    `conflictOrderingSearch`, `conflictSetExact`, `searchStrategy`, `maxIterations`, `maxSolutions`).
    Ne PAS activer `earliest` (rester sur l'optimum de placement prouvé rapide).
- [x] `packages/scheduler-cpsat/README.md` : rôle du package, contrat stdin/stdout, comment créer
      le venv, la note « floating/Autonomie hors périmètre ». Reprendre l'essentiel de l'actuel
      README du spike (fidélité de modélisation, tableau de résultats).
- [x] `packages/scheduler-cpsat/.gitignore` : `.venv/`, `__pycache__/`.
- [x] **Ne pas** ajouter ce package au workspace pnpm/npm Node (c'est du Python). Documenter dans
      le README racine du repo qu'un package Python existe et comment provisionner son venv.

**Acceptance §1 :**
`echo '{"raw": <RawScheduleData S38>, "config": {"lunchBreak":{"type":"fixed","from":"12:00","to":"13:30"}}}' | python cpsat_runner.py`
renvoie sur stdout un JSON `[{solutions:[…110…], isComplete:false, provenOptimal:true, neutralizedTasks:[…]}]`,
exit 0. Une config `lunchBreak.type=floating` → exit 1 + message clair sur stderr.

---

## 2. Passerelle Node → Python dans `scheduler-api`

**But :** un module qui prend `(RawScheduleData, SchedulerConfig)` et rend `ScheduleSolutionJSON[]`
en pilotant le subprocess Python. Réutilisé par le handler sync ET le worker.

- [x] Créer `packages/scheduler-api/src/cpsatGateway.ts` :
  - `runCpsat(raw: RawScheduleData, config?: SchedulerConfig): Promise<ScheduleSolutionJSON[]>`.
  - Résout l'interpréteur Python et le script via **variables d'env** (mêmes conventions que
    `SCHEDULER_WORKER_PATH`) : `CPSAT_PYTHON` (chemin de l'exécutable venv, défaut : `python3`),
    `CPSAT_RUNNER` (chemin de `cpsat_runner.py`, défaut : résolu relativement au package).
  - `spawn(pythonPath, [runnerPath])`, écrit `JSON.stringify({ raw, config })` sur **stdin**, ferme
    stdin, agrège **stdout** et **stderr** séparément.
  - **Timeout** : `(config?.timeoutSeconds ?? 30) + marge` → `child.kill('SIGKILL')` et rejet clair.
  - Exit ≠ 0 → rejeter avec le contenu stderr. Exit 0 → `JSON.parse(stdout)` et retourner.
  - Gérer `spawn ENOENT` (Python absent) → erreur explicite « moteur CP-SAT indisponible
    (Python/ortools non provisionné) ».
- [x] Créer `packages/scheduler-api/src/runEngine.ts` — **point de branchement unique** :
  - `async function runEngine(payload: RawScheduleData & { options?: SchedulerConfig }): Promise<ScheduleSolutionJSON[]>`.
  - `if (payload.options?.engine === 'cpsat') return runCpsat(payload, payload.options);`
  - sinon : extraire la logique core actuelle (Loader.loadFromRawData → createScheduler →
    solveWithElimination → postRepair → serialize → provenOptimal/rootBound) **inchangée** dans ce
    module, et l'appeler. Objectif : `scheduleController` et `scheduler.worker` deviennent de
    simples enveloppes autour de `runEngine`.
- [x] Refactor `scheduleController.schedulerV2Handler` : remplacer le corps métier par
      `const response = await runEngine(body);` (garder la validation 400 et le try/catch 500).
- [x] Refactor `scheduler.worker.ts` : remplacer le corps par `const result = await runEngine(payload)`
      puis `postMessage({type:'done', …})`. **Attention** : le worker est bundlé par esbuild
      (`JobQueue._getWorkerCode`) avec `bundle:true` — `spawn`/`node:child_process` doit rester
      **externe** (déjà couvert par `external: ['node:*']`, mais vérifier que `child_process` est
      importé en `node:child_process`). Le subprocess Python tourne donc bien depuis le worker
      thread — c'est OK (un worker peut spawn un process).

**Décision de robustesse :** ne PAS ajouter de warmup Python bloquant dans `index.ts`. Préférer un
échec **au moment du run** avec message clair (l'utilisateur core ne doit pas être pénalisé si
Python n'est pas installé). Optionnel : étendre `GET /api/schedule/health` pour rapporter
`cpsatAvailable: boolean` (probe `spawn` non bloquant), utile au client (§4) — à implémenter si peu coûteux.

**Acceptance §2 :** `POST /api/schedule/v2` avec `options.engine='cpsat'` sur une charge S38 renvoie
le même JSON que le runner en §1. Avec `engine='core'` (ou absent) : comportement **strictement
identique** à aujourd'hui (diff de réponse nul sur un jeu de test). `POST …/v2/async` avec
`engine='cpsat'` : le job passe `done` avec le résultat CP-SAT.

---

## 3. Contrat partagé : `engine` dans `SchedulerConfig`

- [x] `packages/scheduler-common/src/types.ts` : ajouter à `SchedulerConfig` :
      `/** Moteur de planification (défaut 'core'). 'cpsat' = 2e moteur OR-Tools (passerelle Python). */`
      `engine?: 'core' | 'cpsat';`
- [x] `DEFAULT_SCHEDULER_CONFIG` : `engine: 'core'`.
- [x] Vérifier que `Required<SchedulerConfig>` reste satisfait (le défaut couvre le nouveau champ).

**Acceptance §3 :** `tsc` vert sur `scheduler-common`, `scheduler-api`, `scheduler-client`.

---

## 4. Panneau de config engine-aware (`scheduler-client`)

**But :** choisir le moteur et **masquer les réglages sans effet** quand `engine==='cpsat'`.

Fichier : `packages/scheduler-client/components/planning/modals/SchedulerConfigDialog.tsx`.
Store : `useAppConfigStore` / `SchedulerConfig` (le champ `engine` transite déjà via `_buildPayload`
qui *spread* `schedulerConfig` — **aucune** modif de `scheduleApi.ts` nécessaire pour l'acheminement).

- [x] Ajouter `engine` au `Draft` + `configToDraft`/`draftToConfig` (défaut `'core'`).
- [x] En tête du dialog, un sélecteur **Moteur** (2 radios : « Élimination / Placement (core) » vs
      « CP-SAT (OR-Tools) — optimum prouvé »). Court texte explicatif par option.
- [x] Quand `engine==='cpsat'`, **masquer ou désactiver** les sections/champs core-only :
      `searchStrategy`, `maxEliminations`, `conflictOrderingSearch`, `conflictSetExact`, `postRepair`,
      `maxIterations`. Laisser visibles : `timeoutSeconds`, `ignoreDailyLimits`, pause méridienne
      **sans l'onglet Flottante** (désactiver `TabsTrigger value="floating"` + si le draft était
      `floating`, basculer sur `none` avec un hint « non supporté par CP-SAT »).
- [x] Afficher une note contextuelle « CP-SAT prouve l'optimum du nombre de cours placés ».
- [x] `migrate` de `useAppConfigStore` (version 2 → 3) : injecter `engine:'core'` si absent, pour ne
      pas casser les configs persistées existantes.

**Acceptance §4 :** ouvrir le dialog, choisir CP-SAT → les champs core-only disparaissent, l'onglet
Flottante est désactivé ; Valider → un run part avec `options.engine='cpsat'` (vérifiable dans le
log réseau `_buildPayload`). Rebasculer sur core → l'UI complète revient. Une config persistée
d'avant la migration se charge sans erreur.

---

## 5. Affichage du résultat CP-SAT

`buildScheduleStatus` (`scheduleApi.ts`) gère **déjà** `provenOptimal` — CP-SAT le renseigne, donc
le message « optimum prouvé » s'affiche sans code neuf. Points à vérifier / ajuster :

- [x] Les `neutralizedTasks` CP-SAT (dont les `Autonomie` avec `reason` « exclu ») s'affichent
      correctement dans l'UI des non-placés (pas de champ manquant : `eliminationRound`/`failureCount`
      sont présents à 0). Vérifier le composant qui rend les neutralisées.
- [x] `rootBound` est **absent** côté CP-SAT (spécifique maxPlacement/core) — s'assurer que l'UI
      tolère son absence (le code actuel teste `best.rootBound &&` → OK).
- [x] Optionnel : nuancer le libellé si `engine==='cpsat'` (« optimum CP-SAT prouvé » vs la preuve
      relative au modèle du moteur core).

**Acceptance §5 :** un run CP-SAT sur S39/pause 14:00 affiche « ⚠️ Incomplète — 2 cours non placé(s)
— optimum prouvé » et liste R1.04/TD + R1.16/TD dans les non-placés.

---

## 6. Tests

- [x] **Python** (`packages/scheduler-cpsat/`) : `test_solve.py` (pytest) — cas jouet CM/TD/TP
      (3/4 placées, intégrité de chaîne, provenOptimal), + un cas `lunchBreak floating` → erreur.
      Convertir `run_stress.py` en `test_stress.py` (ou le garder comme script de mesure hors CI) qui
      rejoue S38/S39 et **assert** la parité (110/110, 102, 101). Ajouter `requirements-dev.txt` (pytest).
- [x] **API** (`packages/scheduler-api/__tests__/`) : `cpsatGateway.test.ts` — mock/inject un faux
      runner (ou un script Python de test) pour vérifier : acheminement stdin/stdout, timeout,
      ENOENT → message clair, exit≠0 → rejet. `runEngine.test.ts` — `engine='core'` inchangé,
      `engine='cpsat'` route vers la passerelle. **Gate CI** : si Python/ortools indisponible en CI,
      marquer les tests d'intégration bout-en-bout `skip` conditionnel, garder les tests de routage
      (mock) toujours actifs.
- [x] **Client** : test du dialog — `engine='cpsat'` masque les champs core-only et désactive
      Flottante ; `draftToConfig` renvoie bien `engine`. Suivre les conventions de test existantes
      du package (voir `__tests__/`).

**Acceptance §6 :** `npm test` (ou l'équivalent workspace) vert pour scheduler-api et
scheduler-client ; `pytest` vert dans `packages/scheduler-cpsat/`.

---

## 7. Provisionnement / déploiement (documenter, ne pas automatiser aveuglément)

- [x] README racine + README du package : comment créer le venv de prod et fixer `CPSAT_PYTHON`.
- [ ] **Question ouverte à porter à Frédéric AVANT tout déploiement** : disponibilité de Python 3 +
      `ortools` sur la cible de prod (OVH/Apache actuel). Si absent → le moteur core reste le défaut
      et CP-SAT n'est offert que là où le runtime est provisionné. Ne PAS bloquer les étapes §1→§6
      là-dessus (tout est testable en local). Consigner la réponse dans la mémoire projet.

---

## Ordre d'exécution conseillé

§3 (type, trivial, débloque le typage) → §1 (package Python + runner) → §2 (passerelle + runEngine,
le gros morceau) → §6 tests Python+API → §4 (UI) → §5 (affichage) → §6 tests client → §7 (doc).
Commits atomiques par étape sur `feature/cpsat-solve-contract`. **Pas de merge master** avant §1→§5 verts.

## Invariants à ne pas casser

- Le chemin **core** doit rester bit-à-bit identique (refactor `runEngine` = extraction pure).
- Origine unique client (pas de nouvelle URL/CORS) — le client ne parle qu'à `scheduler-api`.
- Le worker reste bundlé esbuild ; `node:child_process` externe.
- Aucune régression de la file de jobs (un seul job actif par client, cancel, TTL).
