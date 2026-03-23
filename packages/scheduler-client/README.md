# scheduler-client

Application web de test et de visualisation du planificateur EDT-TS.  
Construite avec **Next.js 16 (App Router)**, TypeScript strict et Tailwind CSS.

---

## Rôle dans le monorepo

```
scheduler-client  →  (HTTP /api/schedule)  →  scheduler-api
scheduler-client  →  (types partagés)       →  scheduler-common
```

Le client **ne connaît ni `scheduler-core` ni `scheduler-api`** directement.  
Toute communication avec le moteur de planification passe par des appels HTTP vers l'API Express, proxifiés par Next.js.

---

## Architecture

```
packages/scheduler-client/
  app/
    layout.tsx            # Layout racine Next.js (HTML, body, Tailwind)
    globals.css           # Import Tailwind
    page.tsx              # Page principale — formulaire + résultats
    ScheduleCalendar.tsx  # Composant calendrier (FullCalendar)
  lib/
    parseCsvCourses.ts    # Parsing du CSV de ventilation horaire
  data/
    data-ventilation.csv  # Exemple de fichier CSV
  __tests__/
    page.test.tsx         # Tests unitaires (Vitest + Testing Library)
  e2e/
    schedule.spec.ts      # Tests E2E (Playwright)
  next.config.ts          # Proxy rewrites → API port 3000
  vitest.config.ts
  playwright.config.ts
```

---

## Flux de données

### 1. Saisie utilisateur (`page.tsx`)

L'utilisateur renseigne trois entrées via un formulaire :

| Champ | Format | Obligatoire |
|---|---|---|
| Numéro de semaine ISO | Entier 1–53 | ✅ |
| Fichier ressources | JSON (`resources[]`) | ✅ |
| Fichier cours | CSV (ventilation horaire) | ✅ |
| Fichier contraintes | JSON (`constraints`) | ❌ |

### 2. Parsing CSV (`lib/parseCsvCourses.ts`)

Le CSV de ventilation horaire est parsé **côté client** par `parseCsvCourses(csvText, week)` :
- Détecte la colonne de la semaine demandée (`S35`…`S52`, `S1`…`S28`)
- Extrait pour chaque ligne : semestre, parcours, code, nom, intervenant, nature, groupes, salles, durée
- Retourne un tableau `CourseTaskData[]` (type issu de `@edt-ts/scheduler-common`)
- Les salles multiples (séparées par `, `) sont transmises comme liste d'alternatives au planificateur

### 3. Appel à l'API (`POST /api/schedule`)

Le payload `RawScheduleData` (type de `@edt-ts/scheduler-common`) est envoyé via `fetch` :

```ts
const payload: RawScheduleData = { week, resources, courses, constraints? };
fetch('/api/schedule', { method: 'POST', body: JSON.stringify(payload) });
```

Le proxy Next.js (`next.config.ts`) redirige `/api/:path*` → `http://localhost:3000/api/:path*`.  
L'API Express (`scheduler-api`) reçoit la requête, fait tourner `scheduler-core`, et répond avec :

```ts
{
  isComplete: boolean;
  scheduledCount: number;
  conflictCount: number;
  solutions: TaskSolutionJSON[];
}
```

### 4. Affichage du calendrier (`ScheduleCalendar.tsx`)

Le composant reçoit `solutions: TaskSolutionJSON[]` et `week: number`.  
Il convertit chaque solution en événement FullCalendar :
- Calcule le lundi de la semaine ISO cible (avec gestion de l'année universitaire : semaines ≥ 35 → année N‑1 si janvier–août)
- Traduit `startTime` (minutes depuis lundi minuit) en `Date` absolue
- Affiche une vue **grille horaire semaine** (`timeGridWeek`) avec code cours, nom, groupes et salles

---

## Proxy API

Configuré dans [next.config.ts](next.config.ts) :

```ts
rewrites() {
  return [{ source: '/api/:path*', destination: 'http://localhost:3000/api/:path*' }];
}
```

- L'API Express doit tourner sur le **port 3000** (`npm run api:dev` à la racine)
- Le client Next.js tourne sur le **port 5173** (`npm run client:dev` à la racine)

---

## Types partagés

Tous les types métier sont importés depuis **`@edt-ts/scheduler-common`** :

| Type | Usage |
|---|---|
| `RawScheduleData` | Payload envoyé à `POST /api/schedule` |
| `CourseTaskData` | Une tâche cours parsée depuis le CSV |
| `TaskSolutionJSON` | Une solution retournée par le planificateur |

---

## Commandes

| Commande | Description |
|---|---|
| `npm run client:dev` | Démarre Next.js en dev (port 5173) |
| `npm run client:build` | Build de production |
| `npm run typecheck --workspace=packages/scheduler-client` | Vérification TypeScript |
| `npm run lint --workspace=packages/scheduler-client` | ESLint |
| `npm run test --workspace=packages/scheduler-client` | Tests unitaires (Vitest) |
| `npm run test:e2e --workspace=packages/scheduler-client` | Tests E2E (Playwright) |

---

## Tests

### Unitaires (Vitest + Testing Library)

- Environnement `jsdom`, setup `vitest.setup.ts`
- L'alias `@edt-ts/scheduler-common` est résolu vers `../scheduler-common/src/index.ts`
- `fetch` est mocké via `vi.fn()` pour isoler les tests des appels réseau

### E2E (Playwright)

- Navigateur : Chromium, `baseURL: http://localhost:5173`
- Les appels API sont interceptés avec `page.route('/api/schedule', ...)`
- Le serveur Next.js est démarré automatiquement par Playwright en mode CI
