# Async Job Queue — Planification longue durée

## Contexte

Le moteur de planification peut nécessiter plusieurs heures de calcul. Ce document décrit l'architecture à mettre en place pour permettre à un client de soumettre un job, de l'interroger périodiquement, et de récupérer le résultat quand il est prêt.

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

## Nouvelles routes HTTP

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/schedule/v2/async` | Soumet un job → `202 { jobId }` |
| `GET` | `/api/schedule/jobs/:id` | Statut + résultat si `done` |
| `DELETE` | `/api/schedule/jobs/:id` | Annule ou supprime un job |

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

### Nouveaux fichiers

```
packages/scheduler-api/src/
  jobs/
    JobStore.ts           # Stockage en mémoire + TTL
    JobQueue.ts           # File FIFO + pool de workers
    scheduler.worker.ts   # Script worker_thread (moteur isolé)
  controllers/
    jobsController.ts     # Handlers HTTP pour les routes /jobs
```

### Fichiers modifiés

```
packages/scheduler-api/src/
  routes/
    schedule.ts           # Ajout des nouvelles routes
  index.ts                # Initialisation du JobQueue au démarrage
```

---

## Détail des composants

### `JobStore.ts`

Stockage en mémoire (`Map<string, JobEntry>`) avec TTL de 7 jours.

```ts
interface JobEntry {
  id: string;
  clientId: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  result?: ScheduleSolutionJSON[];
  error?: string;
}
```

**Fonctions exposées :**

| Fonction | Signature | Description |
|---|---|---|
| `createJob` | `(clientId, payload) → JobEntry` | Crée un job avec un UUID v4 |
| `getJob` | `(id) → JobEntry \| undefined` | Lecture d'un job |
| `updateJob` | `(id, partial) → void` | Mise à jour partielle |
| `deleteJob` | `(id) → boolean` | Suppression immédiate |
| `hasActiveJobForClient` | `(clientId) → boolean` | Vérifie si un job `pending`/`running` existe pour ce client |
| `startTTLCleanup` | `(intervalMs?) → void` | Lance le `setInterval` de purge automatique (défaut : 1h) |

**TTL :** Un `setInterval` toutes les heures supprime les jobs dont `finishedAt` > 7 jours.

---

### `JobQueue.ts`

File FIFO avec un pool de workers limité à `os.cpus().length`.

```ts
class JobQueue {
  private queue: string[];           // IDs de jobs en attente
  private activeWorkers: Map<string, Worker>; // jobId → Worker actif
  private maxWorkers: number;        // os.cpus().length

  enqueue(jobId: string): void       // Ajoute à la file, démarre si slot dispo
  cancel(jobId: string): void        // Retire de la file ou termine le worker
  private processNext(): void        // Dépile et lance un worker
  private runWorker(jobId): void     // Crée le worker_thread, gère les messages
}
```

**Gestion de la concurrence :**
- Si `activeWorkers.size < maxWorkers` → démarre immédiatement
- Sinon → reste en `pending` dans la file FIFO
- À chaque fin de worker → `processNext()` est appelé

---

### `scheduler.worker.ts`

Script exécuté dans chaque `worker_thread`. L'état statique (`ConstraintsManager`, `Loader`) est **isolé par thread** (chaque thread a son propre module scope).

```ts
// Reçoit via workerData: { jobId, payload }
// Exécute Loader.reload() + ConstraintsManager.reset() + Scheduler.run()
// Envoie via parentPort.postMessage({ type: 'done', result }) ou { type: 'error', error }
```

**Points d'attention :**
- La communication payload/résultat passe uniquement par `postMessage` (sérialisation JSON — pas d'objets `Map`/`Set`/classes complexes)
- Le worker doit importer le moteur avec les chemins ESM (extension `.js`)
- En cas de `worker.terminate()` (annulation), le job passe en `cancelled`

---

### `jobsController.ts`

Handlers Express minces qui délèguent à `JobStore` et `JobQueue`.

| Handler | Route | Logique |
|---|---|---|
| `submitJobHandler` | `POST /v2/async` | Valide le payload, vérifie `hasActiveJobForClient`, crée le job, enqueue, retourne `202 { jobId }` |
| `getJobHandler` | `GET /jobs/:id` | Retourne le job (sans le `result` si `status != 'done'`) |
| `cancelJobHandler` | `DELETE /jobs/:id` | Annule/supprime le job, `queue.cancel(id)` |

---

## Identification du client

Le client est identifié par le header HTTP `X-Client-Id` (chaîne arbitraire fournie par le client). En l'absence de ce header, l'API retourne `400`.

**Règle :** un même `clientId` ne peut pas avoir deux jobs `pending` ou `running` simultanément → `409 Conflict`.

---

## Cycle de vie complet

```
POST /v2/async
  → valider payload
  → vérifier pas de job actif pour ce clientId  (sinon 409)
  → JobStore.createJob()                         → status: 'pending'
  → JobQueue.enqueue(jobId)
  → 202 { jobId }

  [slot worker disponible]
  → JobQueue.processNext()
  → JobStore.updateJob({ status: 'running', startedAt })
  → new Worker(scheduler.worker.ts, { workerData: { jobId, payload } })

  [worker terminé avec succès]
  → JobStore.updateJob({ status: 'done', result, finishedAt })
  → JobQueue.processNext()

  [worker terminé en erreur]
  → JobStore.updateJob({ status: 'error', error, finishedAt })
  → JobQueue.processNext()

DELETE /jobs/:id
  → si 'pending'  → retire de la file, status: 'cancelled'
  → si 'running'  → worker.terminate(), status: 'cancelled'
  → si 'done'/'error'/'cancelled' → supprime du store
  → 204

GET /jobs/:id (polling client)
  → si 'done'   → { status, result }   puis client fait DELETE
  → sinon       → { status }
```

---

---

## Ajouts dans `scheduler-common`

`scheduler-common` est le seul endroit où l'API (producteur) et le client (consommateur) partagent des types. Les DTOs du système de jobs doivent y être définis — dans `types.ts` et exportés depuis `index.ts`.

### Types à ajouter dans `types.ts`

```ts
/** Statuts possibles d'un job de planification asynchrone. */
export type JobStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

/**
 * Réponse à POST /api/schedule/v2/async.
 * Retournée immédiatement après soumission du job.
 */
export interface JobSubmitResponse {
  jobId: string;
}

/**
 * Réponse à GET /api/schedule/jobs/:id.
 * Le champ `result` n'est présent que si status === 'done'.
 */
export interface JobStatusResponse {
  jobId: string;
  clientId: string;
  status: JobStatus;
  week: number;          // Semaine concernée (utile au client pour le routage)
  createdAt: string;     // ISO 8601
  startedAt?: string;
  finishedAt?: string;
  result?: ScheduleSolutionJSON[];   // Uniquement si status === 'done'
  error?: string;                    // Uniquement si status === 'error'
}
```

**Champ `week` dans `JobStatusResponse` :** le client en a besoin pour savoir vers quelle semaine rediriger l'utilisateur depuis la page d'accueil.

### Exports à ajouter dans `index.ts`

```ts
export type { JobStatus, JobSubmitResponse, JobStatusResponse } from './types.ts';
```

### Ce qui n'a pas besoin d'aller dans `common`

| Élément | Emplacement |
|---|---|
| `JobEntry` (stockage interne) | `scheduler-api/src/jobs/JobStore.ts` uniquement |
| `JobQueue`, `scheduler.worker.ts` | `scheduler-api` uniquement |
| `getClientId()` | `scheduler-client/lib/api/clientId.ts` uniquement |
| Logique de polling (`setInterval`) | `scheduler-client/store/usePlanningStore.ts` |

---

## Modifications côté client (`scheduler-client`)

### Vue d'ensemble

Le client passe d'un appel `fetch` bloquant (quelques secondes max) à un cycle **soumission → polling → récupération**. La logique de planification reste dans `usePlanningStore.ts` via `runSchedule`.

Le polling est **toujours actif** une fois un job soumis (même si l'utilisateur navigue). La récupération du résultat (application au store) se fait uniquement quand les conditions sont réunies.

### Fichiers à modifier / créer

```
packages/scheduler-client/
  lib/api/
    scheduleApi.ts          # Nouvelles fonctions async (submitJobAsync, pollJob, cancelJob)
    clientId.ts             # Nouveau : génération/lecture du clientId
  store/
    usePlanningStore.ts     # État job + runSchedule modifié + cancelCurrentJob
    types.ts                # Ajout JobStatus (depuis common)
  components/planning/
    (composant bouton)      # Bouton "Annuler" visible pendant le job
  app/
    (page d'accueil / NavBar)  # Notification + bouton redirection si job terminé
```

---

### `lib/api/clientId.ts` — nouveau fichier

```ts
// Identifiant client persisté dans localStorage.
// Rôle : empêcher la double soumission côté serveur uniquement.
export function getClientId(): string {
  const KEY = 'edt-client-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
```

---

### `scheduleApi.ts` — nouvelles fonctions

Trois fonctions s'ajoutent à côté de `runScheduleRequestFromData` :

| Fonction | Description |
|---|---|
| `submitJobAsync(payload, clientId)` | `POST /api/schedule/v2/async` avec header `X-Client-Id` → `JobSubmitResponse` |
| `pollJob(jobId)` | `GET /api/schedule/jobs/:id` → `JobStatusResponse` |
| `cancelJob(jobId)` | `DELETE /api/schedule/jobs/:id` → void |

**`submitJobAsync`** construit le payload exactement comme `_callScheduleApi` (enforcedMap, blockedZones, etc.) mais appelle `/api/schedule/v2/async` au lieu de `/api/schedule/v2`.

Les types `JobSubmitResponse` et `JobStatusResponse` sont importés depuis `@edt-ts/scheduler-common`.

---

### `usePlanningStore.ts` — état et actions

**Nouvel état à ajouter :**

```ts
// Dans PlanningStore
currentJobId: string | null;            // ID du job en cours (null si aucun)
currentJobStatus: JobStatusResponse | null; // Dernier statut polled
cancelCurrentJob: () => Promise<void>;  // Annule le job en cours + arrête le polling
```

**Modification de `runSchedule` :**

```
set isLoading, currentJobId: null
→ submitJobAsync(payload, clientId) → { jobId }
→ set currentJobId: jobId
→ démarrer setInterval (ex : toutes les 5 secondes)
    → pollJob(jobId) → JobStatusResponse
    → set currentJobStatus
    → si 'done'
        → clearInterval
        → set currentJobId: null, isLoading: false
        → si on est sur /planning ET selectedWeek === jobStatus.week
            → normaliser et appliquer result au store (comme aujourd'hui)
        → sinon : stocker le résultat en attente (pendingJobResult)
    → si 'error'
        → clearInterval
        → set currentJobId: null, isLoading: false, status erreur
    → si 'cancelled'
        → clearInterval
        → set currentJobId: null, isLoading: false
```

**Résultat en attente (`pendingJobResult`) :**

Si le job se termine alors que l'utilisateur n'est pas sur `/planning` à la bonne semaine, le résultat est stocké dans `pendingJobResult: { week, result }`. À l'arrivée sur `/planning`, le composant vérifie ce champ et l'applique automatiquement (puis vide `pendingJobResult`).

**`cancelCurrentJob` :**

```
si currentJobId
  → cancelJob(currentJobId)
  → clearInterval
  → set isLoading: false, currentJobId: null, currentJobStatus: null
```

---

### Notification sur la page d'accueil `/`

Quand un job est terminé (`currentJobStatus.status === 'done'`) et que l'utilisateur se trouve sur `/`, afficher un bandeau ou une alerte :

```tsx
// Dans NavBar.tsx ou layout.tsx
{currentJobStatus?.status === 'done' && !resultApplied && (
  <div role="alert">
    Planification semaine {currentJobStatus.week} terminée !
    <Button onClick={() => router.push(`/planning?week=${currentJobStatus.week}`)}>
      Voir le résultat
    </Button>
  </div>
)}
```

Le bouton redirige vers `/planning` avec la semaine en query param. À l'arrivée sur la page, `runSchedule` (ou un `useEffect`) détecte `pendingJobResult` pour la bonne semaine et applique le résultat.

---

### Bouton "Annuler" dans la vue planification

Dans le composant qui contient le bouton "Planifier" :

```tsx
// Bouton planifier → désactivé si job en cours
<Button disabled={currentJobId !== null} onClick={runSchedule}>
  Planifier
</Button>

// Statut du job
{currentJobId && (
  <span>{currentJobStatus?.status === 'pending' ? 'En attente de worker…' : 'Planification en cours…'}</span>
)}

// Bouton annuler → visible si job actif
{currentJobId && (
  <Button variant="destructive" onClick={cancelCurrentJob}>
    Annuler
  </Button>
)}
```

---

## Dépendances Node.js nécessaires

| Module | Nature | Usage |
|---|---|---|
| `node:worker_threads` | Built-in Node.js | Exécution parallèle isolée du moteur |
| `node:os` | Built-in Node.js | `os.cpus().length` pour la taille du pool |
| `node:crypto` | Built-in Node.js | `crypto.randomUUID()` pour les job IDs |

Aucune dépendance externe (ni Redis, ni BullMQ) — stockage 100% en mémoire. Si la persistance survit au redémarrage serveur devient nécessaire, migrer vers Redis + BullMQ.

---

## Limites de l'approche en mémoire

- Les jobs sont perdus au redémarrage du serveur
- Pas de partage d'état entre plusieurs instances du serveur (pas de scale horizontal)
- Adapté pour un serveur unique hébergeant le moteur (cas décrit)

---

## Exemple de réponses HTTP

**`POST /api/schedule/v2/async`** → `202`
```json
{ "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479" }
```

**`GET /api/schedule/jobs/:id`** → `200` (en cours)
```json
{ "jobId": "f47ac10b-...", "status": "running", "createdAt": "...", "startedAt": "..." }
```

**`GET /api/schedule/jobs/:id`** → `200` (terminé)
```json
{
  "jobId": "f47ac10b-...",
  "status": "done",
  "createdAt": "...",
  "startedAt": "...",
  "finishedAt": "...",
  "result": [ { "solutions": [...], "isComplete": true, "score": 42 } ]
}
```

**`DELETE /api/schedule/jobs/:id`** → `204` (pas de body)

**`409 Conflict`** (double soumission même client)
```json
{ "error": "Un job est déjà en cours pour ce client.", "existingJobId": "f47ac10b-..." }
```
