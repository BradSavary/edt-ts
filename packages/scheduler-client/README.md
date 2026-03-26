# scheduler-client

Application web de visualisation et de test du planificateur EDT-TS.  
Construite avec **Next.js 16 (App Router)**, TypeScript strict, Tailwind CSS v4 et FullCalendar v6.

---

## Rôle dans le monorepo

```
scheduler-client  ──(HTTP POST /api/schedule)──►  scheduler-api  ──►  scheduler-core
scheduler-client  ──(types partagés)           ──►  scheduler-common
```

Le client **ne connaît ni `scheduler-core` ni `scheduler-api`** directement.  
Toute communication avec le moteur passe par des appels HTTP, proxifiés par Next.js vers l'API Express sur le port 3000.

---

## Stack technique

| Élément | Version | Rôle |
|---|---|---|
| Next.js (App Router) | 16.2 | Framework React SSR/SPA |
| React | 19 | UI |
| TypeScript | strict | Typage statique |
| Tailwind CSS | v4 | Styles utilitaires |
| shadcn/ui | new-york | Composants UI (Radix) |
| FullCalendar | 6.1 | Grille calendrier interactive |
| Vitest + Testing Library | — | Tests unitaires |
| Playwright | — | Tests E2E |

---

## Architecture & structure

```
packages/scheduler-client/
│
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Layout racine (HTML, body, Tailwind)
│   ├── globals.css               # Variables CSS OKLCH shadcn + Tailwind
│   ├── page.tsx                  # Page principale : formulaire + calendrier
│   └── api/
│       └── schedule/
│           ├── route.ts          # Proxy POST /api/schedule → API Express (timeout 5 min)
│           └── elimination/
│               └── route.ts     # Proxy POST /api/schedule/elimination (timeout 10 min)
│
├── components/                   # Composants métier
│   ├── ScheduleCalendar.tsx     # Calendrier FullCalendar principal
│   ├── CourseCard.tsx            # Carte draggable d'un cours (sidebar gauche)
│   ├── CourseGroupList.tsx       # Liste groupée de cours (par code ou enseignant)
│   ├── EnforceModal.tsx          # Modal de sélection des ressources à l'imposition
│   ├── TaskEditModal.tsx         # Modal d'édition des ressources d'une tâche placée
│   └── ui/                       # Composants shadcn/ui (générés)
│       ├── button.tsx, card.tsx, dialog.tsx, select.tsx
│       ├── tabs.tsx, badge.tsx, input.tsx, label.tsx
│       ├── separator.tsx, scroll-area.tsx, alert.tsx
│
├── lib/                          # Utilitaires framework-agnostic
│   ├── utils.ts                  # cn() (clsx + tailwind-merge)
│   ├── calendarUtils.ts          # Helpers FullCalendar (dates, conflits)
│   ├── blockedZones.ts           # Logique zones bloquées + contraintes ressources
│   ├── parseCsvCourses.ts        # Parsing CSV de ventilation horaire
│   └── scheduleApi.ts            # Appel API (construction payload + normalisation réponse)
│
├── hooks/
│   └── useNeutralizedDraggable.ts  # Draggable FullCalendar pour tâches non placées
│
├── data/                         # Fichiers de données d'exemple
│   ├── data-ventilation.csv      # CSV de cours (semestre, code, enseignant, groupes, salles…)
│   ├── resources.json            # Ressources disponibles (enseignants, salles, groupes)
│   └── contraintes.json          # Disponibilités des ressources par semaine
│
├── __tests__/                    # Tests unitaires Vitest
│   ├── calendarUtils.test.ts
│   ├── CourseCard.test.tsx
│   ├── EnforceModal.test.tsx
│   ├── page.test.tsx
│   └── parseCsvCourses.test.ts
│
├── e2e/
│   └── schedule.spec.ts          # Tests E2E Playwright
│
├── next.config.ts                # Proxy rewrites /api/* → localhost:3000
├── vitest.config.ts
└── playwright.config.ts
```

---

## Fonctionnalités

### 1. Chargement et parsing des données

| Fichier | Format | Traitement |
|---|---|---|
| Ressources | JSON `ResourceGroupData[]` | Chargé en mémoire dès la sélection du fichier |
| Cours | CSV colonnes semaines (Sx) | Parsé par `parseCsvCourses(text, week)` à chaque changement de semaine ou de fichier |
| Contraintes | JSON `ConstraintsData` | Chargé en mémoire, utilisé pour les zones bloquées et la mise en évidence au drag |

Le parsing CSV détecte la colonne de la semaine demandée (`S35`…`S52`, `S1`…`S28`) et retourne un `CourseTaskData[]`. Les salles multiples (séparées par `, `) sont converties en liste d'alternatives `[["salle1", "salle2"]]`.

### 2. Modes de planification

Deux boutons déclenchent l'appel API :

- **Planifier** → `POST /api/schedule` — mode standard : cherche le maximum de cours placés simultanément
- **Avec élimination** → `POST /api/schedule/elimination` — élimine itérativement les cours les plus bloquants pour maximiser le placement global

La réponse contient un tableau de solutions. L'interface affiche des onglets si plusieurs solutions sont disponibles.

### 3. Imposition manuelle de cours

Avant de planifier, l'utilisateur peut **glisser-déposer** une carte de cours depuis la sidebar gauche vers un créneau du calendrier.

- **Sans alternatives** : le cours est directement imposé au créneau cible
- **Avec alternatives** (enseignants ou salles multiples) : une modal [`EnforceModal`](#enforcemodal) s'ouvre pour sélectionner les ressources

Les cours imposés (`isEnforced: true`) sont transmis dans le payload, ce qui force le moteur à les respecter. Un compteur d'impositions s'affiche sur le bouton Planifier.

### 4. Tâches neutralisées

Si le moteur renvoie des tâches non placées (`neutralizedTasks`), elles apparaissent dans une **sidebar droite** ambrée. L'utilisateur peut les glisser manuellement sur le calendrier.

### 5. Zones bloquées (vides)

L'utilisateur peut **sélectionner** un bloc horaire sur le calendrier pour le marquer comme "zone vide". Ces zones sont soustraites aux disponibilités de toutes les ressources avant planification (via `applyBlockedZonesToConstraints`). Un clic sur une zone vide la supprime.

### 6. Détection de conflits en temps réel

Pendant le drag d'un événement :
- **Rouge** : enseignant ou groupe en double avec un autre cours du calendrier
- **Orange** : salle en double

Hors drag, les conflits statiques sont aussi colorisés.

Cela s'applique aux trois types de drag :
- Déplacement d'un événement placé (drag interne au calendrier)
- Drag depuis la sidebar droite (tâches neutralisées)
- Drag depuis la sidebar gauche (cours à imposer)

### 7. Mise en évidence des contraintes de ressources au drag

Pendant le drag d'un cours, les **créneaux indisponibles** pour au moins l'une de ses ressources (enseignants, salles, groupes) sont affichés en **fond ambre semi-transparent** sur le calendrier.

- Si aucun fichier de contraintes n'est chargé : rien n'est affiché
- Les indisponibilités sont calculées par `computeConstraintUnavailableZones` : pour chaque jour lun–ven, complément des créneaux disponibles (selon `contraintes.json` et les overrides hebdomadaires) dans la plage 7h–21h, union de toutes les ressources

### 8. Édition des ressources d'une tâche placée

Un clic sur un événement du calendrier ouvre un popup de détail. L'icône **"✏️ Modifier les ressources"** ouvre [`TaskEditModal`](#taskeditmodal), permettant de changer enseignants, groupes ou salles via des selects alimentés par le `resources.json`.

### 9. Retrait d'imposition

Un cours imposé peut être retiré via le popup de détail (bouton "Retirer l'imposition") ou en glissant l'événement hors du calendrier.

---

## Composants détaillés

### `ScheduleCalendar`

Composant central de l'interface. Gère :
- Le rendu FullCalendar (`timeGridWeek`, lun–ven, 7h–21h)
- Les événements placés (solutions API), imposés, neutralisés placés, zones bloquées
- La détection de drag (interne, externe gauche et droite) via les états `dragging` et `externalDragging`
- La coloration des conflits et des contraintes en temps réel
- Les handlers de drop, de clic, de sélection

**Props principales :**

| Prop | Type | Description |
|---|---|---|
| `solutions` | `TaskSolutionJSON[]` | Tâches planifiées par l'API |
| `week` | `number` | Numéro de semaine ISO |
| `parsedCourses` | `CourseTaskData[]` | Cours parsés (pour les impositions) |
| `blockedZones` | `BlockedZone[]` | Zones bloquées à afficher |
| `constraintsData` | `ConstraintsData \| null` | Contraintes pour la mise en évidence au drag |
| `externalDragging` | `{ teachers, groups, rooms } \| null` | Ressources d'un drag externe |
| `resourcesList` | `ResourceGroupData[]` | Options pour les selects d'édition |

### `CourseGroupList`

Liste les cours parsés groupe par groupe (par code ou par enseignant). Chaque groupe est un accordéon qui affiche un `CourseCard` par cours.

### `CourseCard`

Carte draggable d'un cours. Porte les attributs `data-course-key`, `data-title`, `data-duration` utilisés par le Draggable FullCalendar.

### `EnforceModal`

Modal ouverte lors du drop d'un cours avec alternatives. Affiche des selects pour chaque groupe d'alternatives (enseignants, salles). Confirme la sélection → `confirmEnforce`.

### `TaskEditModal`

Modal d'édition des ressources d'une tâche déjà placée. Affiche les enseignants/groupes/salles actuels avec un select par slot, alimenté par la liste complète du `resources.json`.

---

## Utilitaires (`lib/`)

### `calendarUtils.ts`

| Fonction | Rôle |
|---|---|
| `getMondayOfISOWeek(week)` | Calcule le lundi d'une semaine ISO (gestion année universitaire : S≥35 → année N-1) |
| `startTimeToDate(monday, minutes)` | Convertit un `startTime` (minutes depuis lundi 00:00) en `Date` absolue |
| `computeStaticConflicts(events)` | Détecte les chevauchements de ressources entre tous les événements |
| `computeDragHighlights(events, drag)` | Événements en conflit avec la tâche en cours de drag |

### `blockedZones.ts`

| Fonction | Rôle |
|---|---|
| `applyBlockedZonesToConstraints(...)` | Soustrait les zones bloquées des disponibilités de toutes les ressources |
| `computeConstraintUnavailableZones(resourceIds, constraints, week, monday)` | Calcule les plages indisponibles (union) pour un ensemble de ressources — utilisé pour les background events au drag |

### `parseCsvCourses.ts`

Parse le CSV de ventilation horaire. Colonnes attendues : `Semestre, Parcours, Code, Enseignement, Intervenant, Nature, Groupes, Salles, S35…S28`. Retourne `CourseTaskData[]` pour la semaine demandée.

### `scheduleApi.ts`

Construit le payload `RawScheduleData`, applique les impositions et les zones bloquées aux contraintes, appelle l'API et normalise la réponse en `ScheduleResult` (`{ solutions, week }`).

---

## Hooks

### `useNeutralizedDraggable`

Initialise le Draggable FullCalendar sur le conteneur des tâches neutralisées (sidebar droite) et expose les callbacks de drag start/end via des listeners pointer (`pointerdown`, `pointermove`, `pointerup`) pour synchroniser l'état de drag avec `page.tsx`.

---

## Routes API (Next.js Route Handlers)

| Route | Timeout | Description |
|---|---|---|
| `POST /api/schedule` | 5 min | Planification standard |
| `POST /api/schedule/elimination` | 10 min | Planification avec élimination itérative |

Ces route handlers proxifient les requêtes vers `http://localhost:3000` en passant le body brut. Ils contournent la limitation de timeout du middleware Next.js pour les longues computations.

> **Note :** `next.config.ts` configure aussi des `rewrites` `/api/:path* → localhost:3000`, mais les route handlers prennent priorité pour les chemins déclarés.

---

## Flux de données complet

```
[Utilisateur]
     │  1. Renseigne semaine, ressources.json, cours.csv, contraintes.json (optionnel)
     │  2. Glisse éventuellement des cours sur le calendrier (imposition)
     │  3. Clique "Planifier" ou "Avec élimination"
     ▼
[page.tsx]
     │  parseCsvCourses() → CourseTaskData[]
     │  applyBlockedZonesToConstraints() → ConstraintsData enrichi
     │  POST /api/schedule  (payload: RawScheduleData)
     ▼
[Route Handler → scheduler-api → scheduler-core]
     │  Réponse: ScheduleSolutionJSON[]
     ▼
[page.tsx]
     │  normalise → ScheduleResult { solutions[], week }
     ▼
[ScheduleCalendar]
     │  convertit startTime → Date
     │  affiche événements FullCalendar
     │  détecte conflits (rouge/orange)
     │  affiche contraintes (fond ambre) pendant le drag
     ▼
[Utilisateur]
     │  Glisse/repositionne des événements
     │  Ajoute/retire des zones bloquées
     │  Édite les ressources d'une tâche
```

---

## Tests

### Unitaires (Vitest)

```bash
npm run test --workspace=packages/scheduler-client
# ou en watch
npm run test:watch --workspace=packages/scheduler-client
```

Couvre :
- `calendarUtils.ts` : `getMondayOfISOWeek`, `startTimeToDate`, `formatTime`, `formatDate`
- `parseCsvCourses.ts` : parsing CSV, extraction par semaine, salles alternatives
- `CourseCard` : rendu, attributs data-*
- `EnforceModal` : sélection enseignant/salle, confirmation/annulation
- `page.tsx` : rendu initial, chargement de fichiers

### E2E (Playwright)

```bash
npm run test:e2e --workspace=packages/scheduler-client
```

Le fichier `e2e/schedule.spec.ts` teste le flux complet :
- Chargement des fichiers (JSON resources, CSV cours)
- Déclenchement de la planification
- Vérification des événements affichés dans le calendrier

---

## Configuration

### Tailwind CSS v4

Le thème est défini dans `app/globals.css` avec des variables OKLCH shadcn (`--background`, `--foreground`, `--primary`, etc.). Les tokens Tailwind sont mappés via `@theme inline`. Mode sombre activé par la classe `.dark` sur `<html>`.

### shadcn/ui (style `new-york`)

Composants dans `components/ui/`. Pour en ajouter un :

```bash
# Depuis packages/scheduler-client/
# Renommer temporairement pnpm-lock.yaml et pnpm-workspace.yaml avant (conflit npm/pnpm)
npx shadcn@latest add <composant>
```

### Alias d'import

| Alias | Résolution |
|---|---|
| `@/` | Racine du package (`packages/scheduler-client/`) |
| `@edt-ts/scheduler-common` | `packages/scheduler-common/src/index.ts` |

---

## Commandes

```bash
# Développement (port 5173, proxy → API port 3000)
npm run client:dev          # depuis la racine
# ou
npm run dev --workspace=packages/scheduler-client

# Build production
npm run client:build        # depuis la racine

# Typecheck
npm run typecheck --workspace=packages/scheduler-client

# Tests unitaires
npm run test --workspace=packages/scheduler-client

# Tests E2E
npm run test:e2e --workspace=packages/scheduler-client
```

> L'API Express (`scheduler-api`) doit tourner sur le port 3000 pour que le client fonctionne : `npm run api:dev`


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
