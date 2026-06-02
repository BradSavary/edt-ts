# Async Job Queue — Planification longue durée

## Contexte

Le moteur de planification peut nécessiter plusieurs heures de calcul. Ce document décrit l'architecture mise en place pour permettre à un client de soumettre un job, de l'interroger périodiquement, et de récupérer le résultat quand il est prêt.

---

## Flux général

```
POST /api/schedule/v2/async  →  202 { jobId: "abc-123" }
GET  /api/schedule/jobs/abc-123  →  { status: "pending" }
GET  /api/schedule/jobs/abc-123  →  { status: "running", startedAt: "..." }
GET  /api/schedule/jobs/abc-123  →  { status: "done", result: {...} }
DELETE /api/schedule/jobs/abc-123  →  204
```

---

## Routes HTTP

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/schedule/v2/async` | Soumet un job → `202 { jobId }` |
| `GET` | `/api/schedule/jobs/:id` | Statut + résultat si `done` |
| `DELETE` | `/api/schedule/jobs/:id` | Annule ou supprime un job |

Ces routes s'ajoutent dans le même router Express que `/v2` (préfixe `/api/schedule`).

---

## Statuts d'un job

| Statut | Description |
|---|---|
| `pending` | En file d'attente, pas encore démarré |
| `running` | En cours d'exécution dans un worker |
| `done` | Terminé avec succès, résultat disponible |
| `error` | Terminé en erreur, message disponible |
| `cancelled` | Annulé par le client |

---

## Architecture des fichiers

```
packages/scheduler-api/src/
  serializeScheduler.ts         # Fonctions de sérialisation partagées (controller + worker)
  jobs/
    JobStore.ts                 # Stockage en mémoire + TTL
    JobQueue.ts                 # File FIFO + worker unique (esbuild lazy)
    scheduler.worker.ts         # Script worker_thread (moteur isolé)
  controllers/
    jobsController.ts           # Handlers HTTP pour les routes /jobs
  routes/
    schedule.ts                 # +3 routes async (POST /v2/async, GET/DELETE /jobs/:id)
  index.ts                      # +startTTLCleanup() avant app.listen()

packages/scheduler-client/
  lib/api/
    scheduleApi.ts              # +_buildPayload() + submitJobAsync, pollJob, cancelJob
    clientId.ts                 # Génération/lecture du clientId (localStorage)
  store/
    usePlanningStore.ts         # État job + persistance localStorage + polling
  app/
    NavBar.tsx                  # +banner résultat en attente
    planning/page.tsx           # +useEffect auto-application pendingJobResult
    api/schedule/
      v2/async/route.ts         # Proxy Next.js → API Express (POST)
      jobs/[id]/route.ts        # Proxy Next.js → API Express (GET + DELETE)
  components/planning/sidebar/
    SidebarPreparation.tsx      # +bouton Annuler + texte d'attente + désactivation

packages/scheduler-common/src/
  types.ts                      # +JobStatus, JobSubmitResponse, JobStatusResponse
  index.ts                      # +exports des types job
```

---

## Détail des composants API

### `JobStore.ts`

Stockage en mémoire (`Map<string, JobEntry>`) avec TTL de 7 jours.

```ts
interface JobEntry {
  id: string;
  clientId: string;
  week: number;          // Extrait de payload.week au moment de createJob()
  status: JobStatus;
  payload: RawScheduleData & { options?: SchedulerConfig };
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  result?: ScheduleSolutionJSON[];
  error?: string;
}
```

| Fonction | Signature | Description |
|---|---|---|
| `createJob` | `(clientId, payload) → JobEntry` | Crée un job avec UUID v4 |
| `getJob` | `(id) → JobEntry \| undefined` | Lecture |
| `updateJob` | `(id, partial) → void` | Mise à jour partielle |
| `deleteJob` | `(id) → boolean` | Suppression immédiate |
| `hasActiveJobForClient` | `(clientId) → string \| undefined` | ID du job actif (`pending`/`running`) pour ce client, ou `undefined` |
| `startTTLCleanup` | `(intervalMs?) → void` | Purge automatique toutes les heures (défaut) |

---

### `JobQueue.ts`

File FIFO avec **un seul worker actif à la fois**. L'objectif n'est pas de paralléliser les calculs, mais de ne pas bloquer le thread principal Express.

> **Pourquoi un seul worker ?** Le moteur est CPU-intensif. Lancer plusieurs workers n'apporte pas un gain proportionnel (context switching, pression mémoire). L'objectif premier est de libérer le thread principal Node.js pour les requêtes de polling.

```ts
class JobQueue {
  private queue: string[];             // IDs de jobs en attente (FIFO)
  private activeWorker: Worker | null; // worker en cours
  private activeJobId: string | null;

  enqueue(jobId: string): void   // Ajoute à la file, démarre si aucun worker actif
  cancel(jobId: string): void    // Retire de la file ou terminate() le worker actif
  private processNext(): void    // Dépile et lance le worker suivant
  private runWorker(jobId): void // Crée le worker_thread, gère les événements
}
```

**Gestion des événements worker :**
- `'message'` — guard `if (this.activeWorker !== worker) return` pour ignorer les messages in-flight d'un worker annulé
- `'error'` — même guard ; marque le job en `error` et passe au suivant
- `'exit'` — guard `status === 'running'` pour catcher les sorties inattendues sans message préalable

---

### `scheduler.worker.ts`

Script exécuté dans chaque `worker_thread`. Reçoit `{ jobId, payload }` via `workerData`, exécute `Loader.reload()` + `Scheduler.solveWithElimination()`, et renvoie le résultat via `parentPort.postMessage`.

Les fonctions de sérialisation (`serializeUnitSolutions`, `serializeNeutralizedUnit`, `serializeSchedulerSolution`) sont importées depuis `../serializeScheduler.js` — voir ci-dessous.

---

### `serializeScheduler.ts`

Module partagé entre `scheduleController.ts` (route sync `/v2`) et `scheduler.worker.ts` (route async). Exporte `serializeUnitSolutions`, `serializeNeutralizedUnit`, `serializeSchedulerSolution`.

---

### TypeScript + `worker_threads` : bundling esbuild

`scheduler-api` utilise `tsx` (pas de compilation préalable). Un `new Worker(file)` démarre un contexte Node.js isolé **sans** le loader tsx.

**Solution retenue : bundler le worker avec esbuild** (devDependency `esbuild: "*"`). Le bundle est produit **paresseusement** au premier appel à `runWorker()` (pas au démarrage du serveur) pour ne pas bloquer `app.listen()` :

```ts
// Dans JobQueue.ts
let _workerCode: string | null = null;

function _getWorkerCode(): string {
  if (_workerCode === null) {
    const { outputFiles } = buildSync({
      entryPoints: [WORKER_TS_PATH],
      bundle: true, format: 'cjs', platform: 'node',
      write: false, external: ['node:*'], logLevel: 'warning',
    });
    _workerCode = outputFiles[0].text;
  }
  return _workerCode;
}

// new Worker(_getWorkerCode(), { eval: true, workerData: { jobId, payload } })
```

Le bundle inline (`eval: true`) contient le worker et toutes ses dépendances locales (y compris `serializeScheduler.ts`). Les built-ins Node (`node:*`) sont externalisés.

---

### `jobsController.ts`

| Handler | Route | Logique |
|---|---|---|
| `submitJobHandler` | `POST /v2/async` | Valide payload, vérifie `hasActiveJobForClient` (→ 409), crée le job, enqueue, retourne `202 { jobId }` |
| `getJobHandler` | `GET /jobs/:id` | Retourne la réponse complète (`result` inclus si `done`) |
| `cancelJobHandler` | `DELETE /jobs/:id` | Si `pending`/`running` → `queue.cancel(id)` ; si terminal → `deleteJob(id)` ; → 204 |

---

## Identification du client

Le client s'identifie via le header HTTP `X-Client-Id`. En l'absence de ce header, l'API retourne `400`. Un même `clientId` ne peut pas avoir deux jobs `pending` ou `running` simultanément → `409 Conflict`.

---

## Cycle de vie complet

```
POST /v2/async
  → valider payload
  → hasActiveJobForClient ?  (sinon 409)
  → JobStore.createJob()                         → status: 'pending'
  → JobQueue.enqueue(jobId)
  → 202 { jobId }

  [slot worker disponible]
  → JobQueue.processNext()
  → JobStore.updateJob({ status: 'running', startedAt })
  → new Worker(_getWorkerCode(), { eval: true, workerData: { jobId, payload } })

  [worker terminé avec succès]
  → JobStore.updateJob({ status: 'done', result, finishedAt })
  → JobQueue.processNext()

  [worker terminé en erreur]
  → JobStore.updateJob({ status: 'error', error, finishedAt })
  → JobQueue.processNext()

DELETE /jobs/:id
  → si 'pending'                → retire de la file, status: 'cancelled'
  → si 'running'                → worker.terminate(), status: 'cancelled'
  → si 'done'/'error'/'cancelled' → deleteJob(id)
  → 204

GET /jobs/:id (polling client)
  → retourne le job complet (result inclus si done)
  → client fait DELETE après avoir récupéré le résultat
```

---

## Types partagés (`scheduler-common`)

```ts
export type JobStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobSubmitResponse {
  jobId: string;
}

export interface JobStatusResponse {
  jobId: string;
  clientId: string;
  status: JobStatus;
  week: number;           // Semaine concernée — permet au client de router vers la bonne semaine
  createdAt: string;      // ISO 8601
  startedAt?: string;
  finishedAt?: string;
  result?: ScheduleSolutionJSON[];  // Uniquement si status === 'done'
  error?: string;                   // Uniquement si status === 'error'
}
```

---

## Côté client (`scheduler-client`)

### Vue d'ensemble

Le client passe d'un `fetch` bloquant à un cycle **soumission → polling → récupération**. La logique reste dans `usePlanningStore.ts` via `runSchedule`. Le polling continue même si l'utilisateur navigue ; le résultat est appliqué quand les conditions sont réunies.

**Règle d'exclusivité :** `runSchedule` est bloqué si `currentJobId !== null` (job actif) **ou** `pendingJobResult !== null` (résultat non encore récupéré). L'utilisateur doit cliquer "Voir le résultat" avant de pouvoir relancer une planification.

---

### `lib/api/clientId.ts`

```ts
export function getClientId(): string {
  const KEY = 'edt-client-id';
  let id = localStorage.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
  return id;
}
```

---

### `scheduleApi.ts`

`_buildPayload()` (non exportée) est partagée par `_callScheduleApi` et `submitJobAsync` pour éviter la duplication de la logique d'encodage (enforcedMap, résolution de `constraints.Default`, `applyBlockedZonesToConstraints`).

| Fonction | Description |
|---|---|
| `_buildPayload(...)` | Construit `RawScheduleData & { options? }` depuis les params store |
| `submitJobAsync(params, clientId)` | `POST /api/schedule/v2/async` avec `X-Client-Id` → `JobSubmitResponse` |
| `pollJob(jobId)` | `GET /api/schedule/jobs/:id` → `JobStatusResponse` (lève si non-ok) |
| `cancelJob(jobId)` | `DELETE /api/schedule/jobs/:id` — fire-and-forget (les erreurs réseau ne bloquent pas l'UI) |

`runScheduleRequestFromData` et `_callScheduleApi` sont conservés (route sync `/v2` reste disponible).

---

### `usePlanningStore.ts` — état job

```ts
// Champs ajoutés à PlanningStore
currentJobId: string | null;
currentJobStatus: JobStatusResponse | null;
pendingJobResult: {
  week: number;
  result: ScheduleResult;
  syntheticNeutralized: NeutralizedTaskInfoJSON[];   // tâches pré-neutralisées (hors moteur)
} | null;
runSchedule: () => Promise<void>;
cancelCurrentJob: () => Promise<void>;
applyPendingResult: () => void;   // applique pendingJobResult au store et le vide
```

**`runSchedule` :**
1. Guard : retour anticipé si `currentJobId !== null` ou `pendingJobResult !== null`
2. Calcule `syntheticNeutralized` (tâches pré-neutralisées hors moteur)
3. `submitJobAsync` → obtient `jobId`
4. `_saveJobToStorage(jobId, syntheticNeutralized)` — persiste en localStorage
5. `_startPolling(jobId, syntheticNeutralized)` — démarre l'intervalle de 5 s

**`_startPolling` :** fonction module-level qui gère tout le cycle polling :
- `done` → `setState({ pendingJobResult })` **puis** `void cancelJob(jobId)` (fire-and-forget)
- `error` → idem (setState d'abord, cancelJob en arrière-plan)
- `cancelled` → `setState`, vide le storage

**`cancelCurrentJob` :** `clearInterval` + `cancelJob` + `_clearJobFromStorage` + `setState`

**`applyPendingResult` :** applique `pendingJobResult` comme `scheduleResult` courant, met `selectedWeek` à `pendingJobResult.week`, vide `pendingJobResult`.

**`resetScheduleResult` / `reset` :** appellent `clearInterval(_pollingInterval)` avant le `set({})`.

---

### Persistance du job en cours (survie au rechargement)

À la soumission, `{ jobId, syntheticNeutralized }` est persisté dans `localStorage` (`edt-pending-job`). Au chargement de la page (`typeof window !== 'undefined'`), `_resumePendingJob()` est appelée :

```
_resumePendingJob()
  → _loadJobFromStorage()  →  rien : fin
  → pollJob(jobId)
      → done     : setState({ pendingJobResult }), void cancelJob(), _clearJobFromStorage()
      → pending/running : setState({ currentJobId, isLoading: true }), _startPolling()
      → error/cancelled : _clearJobFromStorage()
      → erreur réseau (404, serveur redémarré) : _clearJobFromStorage()
```

Le storage est vidé dès que le job atteint un état terminal ou qu'il disparaît du serveur.

---

### Notification dans `NavBar.tsx`

La banner est intégrée directement dans `NavBar.tsx` (pas de composant séparé) :

```tsx
{pendingJobResult && (
  <div className="ml-auto flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
    <span>✅ Semaine {pendingJobResult.week} planifiée</span>
    <Button size="sm" variant="outline" onClick={handleViewResult}>
      Voir le résultat
    </Button>
  </div>
)}
```

`handleViewResult` appelle `applyPendingResult()` puis `router.push('/planning')`.

---

### `planning/page.tsx` — auto-application

```tsx
useEffect(() => {
  if (pendingJobResult && pendingJobResult.week === selectedWeek) {
    applyPendingResult();
  }
}, [pendingJobResult, selectedWeek, applyPendingResult]);
```

Si l'utilisateur arrive sur `/planning` avec la bonne semaine déjà sélectionnée, le résultat s'applique automatiquement sans passer par la NavBar.

---

### `SidebarPreparation.tsx` — bouton Planifier

```tsx
<Button
  disabled={isLoading || pendingJobResult !== null}
  onClick={() => runSchedule()}
>
  {isLoading
    ? (currentJobStatus?.status === 'pending' ? 'En attente…' : 'Planification…')
    : 'Planifier'}
</Button>

{currentJobId && (
  <Button variant="destructive" onClick={() => cancelCurrentJob()}>Annuler</Button>
)}

{pendingJobResult !== null && !isLoading && (
  <p className="text-xs text-muted-foreground">
    Résultat semaine {pendingJobResult.week} en attente — récupérez-le via la barre de navigation.
  </p>
)}
```

---

### Proxies Next.js

Les appels `fetch` du client visent les routes Next.js locales (pas directement Express) :

| Route Next.js | Cible Express |
|---|---|
| `POST /api/schedule/v2/async` | `POST /api/schedule/v2/async` (propage `X-Client-Id`) |
| `GET /api/schedule/jobs/[id]` | `GET /api/schedule/jobs/:id` |
| `DELETE /api/schedule/jobs/[id]` | `DELETE /api/schedule/jobs/:id` |

---

## Dépendances

| Module | Nature | Usage |
|---|---|---|
| `node:worker_threads` | Built-in Node.js | Exécution isolée du moteur |
| `node:crypto` | Built-in Node.js | `randomUUID()` pour les job IDs |
| `esbuild` | devDependency (`scheduler-api`) | Bundle `scheduler.worker.ts` → CJS inline au premier job |

Aucune dépendance externe de queue (ni Redis, ni BullMQ) — stockage 100% en mémoire.

---

## Limites de l'approche en mémoire

- Les jobs sont perdus au redémarrage du serveur (le client détecte un 404 au polling et vide son storage)
- Pas de partage d'état entre plusieurs instances du serveur (pas de scale horizontal)
- Adapté pour un serveur unique hébergeant le moteur

---

## Exemples de réponses HTTP

**`POST /api/schedule/v2/async`** → `202`
```json
{ "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479" }
```

**`GET /api/schedule/jobs/:id`** → `200` (en cours)
```json
{ "jobId": "f47ac10b-...", "clientId": "...", "status": "running", "week": 12, "createdAt": "...", "startedAt": "..." }
```

**`GET /api/schedule/jobs/:id`** → `200` (terminé)
```json
{
  "jobId": "f47ac10b-...", "clientId": "...", "status": "done", "week": 12,
  "createdAt": "...", "startedAt": "...", "finishedAt": "...",
  "result": [ { "solutions": [...], "isComplete": true, "score": 42 } ]
}
```

**`DELETE /api/schedule/jobs/:id`** → `204` (pas de body)

**`409 Conflict`** (double soumission même client)
```json
{ "error": "Un job est déjà en cours pour ce client.", "existingJobId": "f47ac10b-..." }
```
