---
applyTo: "packages/scheduler-client/**"
---

# Copilot Instructions — scheduler-client

Le package `scheduler-client` est l'application web de test du planificateur. C'est un projet **Next.js 16 (App Router)** avec TypeScript strict, Tailwind CSS, et un proxy vers l'API Express.

## Objectif du package

- Fournir une interface utilisateur pour soumettre des données de planification (resources, cours, contraintes) et visualiser les résultats
- Consommer uniquement `@edt-ts/scheduler-common` pour les types partagés (jamais `scheduler-core` ni `scheduler-api` directement)
- Servir d'application de démonstration et de test de l'API

## Architecture & structure

```
packages/scheduler-client/
  app/                    # Next.js App Router
    layout.tsx            # Layout racine
    page.tsx              # Page principale (formulaire de planification)
    globals.css           # Styles globaux (Tailwind + shadcn CSS vars OKLCH)
    api/                  # Route handlers Next.js (proxy → scheduler-api)
  components/             # Composants métier de l'application
    CourseCard.tsx        # Carte draggable d'un cours (sidebar gauche)
    CourseGroupList.tsx   # Liste groupée de cours (par code ou enseignant)
    EnforceModal.tsx      # Modal de confirmation de placement imposé
    ScheduleCalendar.tsx  # Calendrier FullCalendar principal
    TaskEditModal.tsx     # Modal d'édition des ressources d'une tâche placée
    ui/                   # Composants shadcn/ui (générés automatiquement)
      button.tsx
      card.tsx
      select.tsx
      tabs.tsx
      dialog.tsx
      badge.tsx
      input.tsx
      label.tsx
      separator.tsx
      scroll-area.tsx
      alert.tsx
  lib/                    # Utilitaires (framework-agnostic)
    utils.ts              # Fonction cn() (clsx + tailwind-merge)
    calendarUtils.ts      # Helpers FullCalendar
    blockedZones.ts       # Logique zones bloquées
    parseCsvCourses.ts    # Parsing CSV des cours
  __tests__/              # Tests unitaires (Vitest + Testing Library)
  e2e/                    # Tests E2E (Playwright)
  public/                 # Assets statiques
  components.json         # Config shadcn/ui
  vitest.config.ts        # Config Vitest
  vitest.setup.ts         # Setup jest-dom
  playwright.config.ts    # Config Playwright
  next.config.ts          # Config Next.js (proxy rewrites)
```

## shadcn/ui

- Style : `new-york` (utilise `radix-ui` meta-package)
- Import des composants ui : `import { Button } from '@/components/ui/button'`
- Utilitaire CSS : `import { cn } from '@/lib/utils'` (clsx + tailwind-merge)
- Ajouter un composant : `npx shadcn@latest add <composant>` depuis `packages/scheduler-client/`
  - ⚠️ Renommer temporairement `pnpm-lock.yaml` et `pnpm-workspace.yaml` avant d'exécuter la commande (conflit npm/pnpm)
- Composants disponibles : `button`, `card`, `select`, `tabs`, `dialog`, `badge`, `input`, `label`, `separator`, `scroll-area`, `alert`
- Pattern modal shadcn : `<Dialog open={true} onOpenChange={(open) => !open && onClose()}>`

## Tailwind CSS v4 & thème

- Fichier `globals.css` contient les variables CSS OKLCH shadcn (`--background`, `--foreground`, `--primary`, etc.)
- `@import "tw-animate-css"` remplace `tailwindcss-animate`
- `@custom-variant dark (&:is(.dark *))` pour le support du mode sombre
- `@theme inline` mappe les variables CSS vers les tokens Tailwind
- Mode sombre activé via la classe `.dark` sur `<html>`

## Règles d'import

- Importer uniquement depuis `@edt-ts/scheduler-common` pour les types partagés
- Ne jamais importer depuis `@edt-ts/scheduler-core` ou `@edt-ts/scheduler-api`
- Utiliser le proxy Next.js (`/api/:path* → http://localhost:3000/api/:path*`) pour toutes les requêtes API
- Utiliser l'alias `@/` pour tous les imports internes (résout vers la racine du package)
  - `@/components/...` pour les composants métier
  - `@/components/ui/...` pour les composants shadcn
  - `@/lib/...` pour les utilitaires

## Conventions de code

- `'use client'` requis sur tous les composants qui utilisent des hooks React (`useState`, `useEffect`, etc.)
- TypeScript strict : pas de `any` implicite, typer toutes les réponses API avec les interfaces de `@edt-ts/scheduler-common`
- CSS uniquement via classes Tailwind — pas de styles inline sauf cas exceptionnel
- Composants fonctionnels React uniquement (pas de classes)
- Préférer les composants shadcn aux éléments HTML bruts pour les formulaires et les modales

## Proxy API (next.config.ts)

Le proxy est configuré via `rewrites` dans `next.config.ts` :
- `GET/POST /api/:path*` → `http://localhost:3000/api/:path*`
- L'API Express doit tourner sur le port 3000 (`npm run api:dev`)
- Le client tourne sur le port 5173 (`npm run client:dev`)

## Tests unitaires (Vitest)

- Framework : **Vitest** + **@testing-library/react** + **jsdom**
- Config : `vitest.config.ts` (environment `jsdom`, setup `vitest.setup.ts`)
- Alias configurés dans `vitest.config.ts` :
  - `@edt-ts/scheduler-common` → `../scheduler-common/src/index.ts`
  - `@` → `.` (racine du package, pour `@/components/...`, `@/lib/...`)
- Dossier : `__tests__/`
- Convention de nommage : `<nom>.test.tsx` pour les composants, `<nom>.test.ts` pour les utilitaires
- Les tests doivent importer les matchers via le setup (`@testing-library/jest-dom`)

### Bonnes pratiques tests unitaires

- Tester le rendu des composants avec `render()` + assertions `screen.getBy*`
- Simuler les interactions avec `userEvent` (préférer à `fireEvent`)
- Mocker `fetch` avec `vi.fn()` pour les tests impliquant des appels réseau
- Ne pas tester les internals Next.js (routing, Image, etc.) — se concentrer sur le comportement utilisateur

## Tests E2E (Playwright)

- Framework : **Playwright** (`@playwright/test`)
- Config : `playwright.config.ts` (browser : Chromium, baseURL : `http://localhost:5173`)
- Dossier : `e2e/`
- Convention nommage : `<nom>.spec.ts`
- Le `webServer` Playwright démarre automatiquement `next build && next start` en mode CI

### Bonnes pratiques tests E2E

- Toujours mocker les appels API avec `page.route('/api/schedule', ...)` pour isoler le frontend
- Utiliser `page.getByRole()` et `page.getByLabel()` plutôt que les sélecteurs CSS fragiles
- Mettre les fixtures JSON (resources, courses) dans `e2e/fixtures/` quand les tests s'enrichissent

## Workflows package

- Dev : `npm run client:dev` (port 5173, proxy → API port 3000)
- Build : `npm run client:build`
- Typecheck : `npm run typecheck --workspace=packages/scheduler-client`
- Lint : `npm run lint --workspace=packages/scheduler-client`
- Tests unitaires : `npm run test --workspace=packages/scheduler-client`
- Tests unitaires watch : `npm run test:watch --workspace=packages/scheduler-client`
- Tests E2E : `npm run test:e2e --workspace=packages/scheduler-client`

## CI (GitHub Actions)

Le workflow `scheduler-client-pr.yml` se déclenche sur toute PR touchant `packages/scheduler-client/**` ou `packages/scheduler-common/**`. Jobs :

1. **Lint** (non-bloquant) — `eslint`
2. **Typecheck** — `tsc --noEmit`
3. **Build** — `next build`
4. **Unit Tests** — `vitest run`
5. **E2E Tests** — `playwright test` (avec `npx playwright install --with-deps chromium`)

## Gestion des versions de dépendances

- Next.js : `16.x` (App Router)
- React : `19.x`
- Vitest : `^3.x`
- Playwright : `^1.50`
- @testing-library/react : `^16.x`
