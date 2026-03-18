# EDT-TS Monorepo

Monorepo TypeScript pour la planification d'emploi du temps.

## Structure

```
packages/
  scheduler-common/   modèles et logique partagés (framework-agnostic, browser/Node)
  scheduler-core/     moteur de planification (Node.js), consomme scheduler-common
  scheduler-api/      API REST Express, consomme scheduler-core et scheduler-common
  scheduler-client/   application web de test (Vite), consomme scheduler-common
docs/                 documentation fonctionnelle et technique
```

### Dépendances entre packages

```
scheduler-client  ──►  scheduler-common
scheduler-api     ──►  scheduler-core  ──►  scheduler-common
```

> `scheduler-common` n'a aucune dépendance interne (acyclique par conception).

## Commandes principales

| Commande | Description |
|---|---|
| `npm install` | Installation des dépendances (tous les workspaces) |
| `npm run typecheck` | Vérification TypeScript globale |
| `npm run test-ar` | Test du moteur AR (algorithme de résolution) |
| `npm run test-standard` | Test du moteur standard |
| `npm run api:dev` | Démarre l'API en mode watch (port 3000) |
| `npm run api:start` | Démarre l'API en mode production |
| `npm run client:dev` | Démarre le client web Vite (port 5173) |
| `npm run client:build` | Build de production du client |

### Démarrage en développement

Lancer en parallèle dans deux terminaux :

```bash
npm run api:dev      # Terminal 1 — API sur http://localhost:3000
npm run client:dev   # Terminal 2 — Client sur http://localhost:5173
```

Le client proxy automatiquement `/api/*` vers `http://localhost:3000`.

## Packages

### `@edt-ts/scheduler-common`

Modèles de domaine et types partagés, sans dépendance Node.js ni framework.

Contient : `Resource`, `Task`, `ResourcesManager`, `TasksManager`, `Availability`, `AvailabilityManager`, `SchedulerData`, et les types `RawScheduleData`, `TaskSolutionJSON`, `ConstraintsData`, etc.

Voir [`packages/scheduler-common/README.md`](packages/scheduler-common/README.md) pour la documentation complète.

### `@edt-ts/scheduler-core`

Moteur de planification basé sur un algorithme de retour arrière (Arc-Revising / backtracking).

Contient : `Loader` (chargement des données JSON ou en mémoire), `ScheduleAR` (résolveur), `Schedule`, `ScheduleAnalysis`.

Données d'exemple dans `packages/scheduler-core/src/json/` :
- `resources.json` — `ResourceGroupData[]`
- `cours.json` — objet `{ weeks, courses: CourseTaskData[] }`
- `contraintes.json` — `ConstraintsData`

### `@edt-ts/scheduler-api`

API REST Express exposant le moteur via HTTP.

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/schedule/health` | Vérification de disponibilité |
| `POST` | `/api/schedule` | Planification à partir de données brutes (`RawScheduleData`) |

Le corps de la requête POST doit être un objet JSON `RawScheduleData & { options? }`.  
Voir le JSDoc de `scheduleHandler` dans `packages/scheduler-api/src/controllers/scheduleController.ts` pour un exemple complet.

### `@edt-ts/scheduler-client`

Application web minimaliste (Vite + TypeScript, sans framework) pour tester l'API.

Interface : formulaire de sélection de 3 fichiers JSON (resources, cours, contraintes) + numéro de semaine. Le payload et la réponse sont affichés dans la console du navigateur (F12).

## Instructions Copilot

Le projet utilise un fichier global + des instructions ciblées par package :

- Global : `.github/copilot-instructions.md`
- Common : `.github/instructions/scheduler-common.instructions.md` (`applyTo: packages/scheduler-common/**`)
- Core : `.github/instructions/scheduler-core.instructions.md` (`applyTo: packages/scheduler-core/**`)
- API : `.github/instructions/scheduler-api.instructions.md` (`applyTo: packages/scheduler-api/**`)

Principe : les règles communes (monorepo, qualité, séparation des responsabilités) sont dans le fichier global ; les règles métier/techniques spécifiques sont dans les fichiers package-scoped. En cas de conflit, la règle la plus spécifique au contexte de fichier prévaut.
