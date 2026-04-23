# Copilot Instructions for EDT-TS (Monorepo)

Ce fichier contient les règles globales du workspace. Les règles métier détaillées sont dans les fichiers ciblés par package :

- `.github/instructions/scheduler-common.instructions.md`
- `.github/instructions/scheduler-core.instructions.md`
- `.github/instructions/scheduler-api.instructions.md`
- `.github/instructions/scheduler-client.instructions.md`

## Structure du repository

- `packages/scheduler-common/` : modèles et logique partagés (framework-agnostic), utilisable browser/Node/API
- `packages/scheduler-core/` : moteur de planification (lib TypeScript, Node.js), consomme `@edt-ts/scheduler-common`
- `packages/scheduler-api/` : API REST (Express) qui consomme `@edt-ts/scheduler-core` et `@edt-ts/scheduler-common`
- `packages/scheduler-client/` : application web de test (Vite + TypeScript), consomme `@edt-ts/scheduler-common`
- `docs/` : documentation fonctionnelle et technique

## Dépendances entre packages

```
scheduler-client  -->  scheduler-common
scheduler-api     -->  scheduler-core  -->  scheduler-common
```

`scheduler-common` n'a aucune dépendance interne (acyclique par conception).

## Principes globaux

- Respecter strictement la séparation en quatre couches :
  - Modèles/logique partagée → `scheduler-common`
  - Moteur de planification → `scheduler-core`
  - Exposition HTTP → `scheduler-api`
  - Interface utilisateur de test → `scheduler-client`
- Ne jamais faire dépendre `scheduler-common` de `scheduler-core`, `scheduler-api` ou `scheduler-client` (acyclique).
- Ne pas dupliquer dans `scheduler-core` ou `scheduler-api` ce qui est déjà dans `scheduler-common`.
- `scheduler-client` ne doit importer que depuis `@edt-ts/scheduler-common` (pas depuis `scheduler-core` ni `scheduler-api`).
- Garder les changements ciblés, minimaux, et compatibles avec l’existant.
- Préférer des corrections à la racine (chemins, types, état statique) plutôt que des contournements.
- Ne jamais générer plus de code que nécessaire

## Workflows monorepo

- Installation : `npm install` à la racine
- Typecheck global : `npm run typecheck`
- Typecheck par workspace : `npm run typecheck --workspace=packages/<nom>`
- Tests moteur : `npm run test-ar` ou `npm run test-standard`
- API dev : `npm run api:dev` (port 3000)
- Client dev : `npm run client:dev` (port 5173, proxy `/api` --> port 3000)
- Build client : `npm run client:build`

## Qualité attendue

- TypeScript strict (`noImplicitAny` indirect via `strict`)
- Imports ESM cohérents (extensions `.js` sur imports internes TS)
- Pas de breaking change d’API publique sans demande explicite

## Références

- `README.md`
- `packages/scheduler-common/README.md`
- `docs/ConstraintsManager.md`
- `docs/LunchBreak.md`
- `docs/Task-Resources.md`
- `.github/instructions/scheduler-common.instructions.md`

## Fonctionnalité : Vacances scolaires & jours fériés

Implémentée dans `scheduler-client` uniquement. Ne concerne pas `scheduler-common` ni `scheduler-core`.

### Architecture

- **`lib/schoolHolidays.ts`** : types (`HolidayPeriod`, `SchoolYearConfig`), fonction `fetchSchoolHolidayConfig` (appel vers `/api/holidays`), `computeHolidayZonesForWeek` (calcul des `BlockedZone[]` pour une semaine ISO), `getAvailableSchoolYears`.
- **`app/api/holidays/route.ts`** : route Next.js GET `/api/holidays?year=YYYY-YYYY&zone=A|B|C`. Proxifie vers :
  - `data.education.gouv.fr` (vacances scolaires, filtré par zone et année scolaire)
  - `calendrier.api.gouv.fr` (jours fériés, métropole uniquement, pour les deux années civiles de l'année scolaire)
- **`store/useSchedulerStore.ts`** : champ `schoolYearConfig: SchoolYearConfig | null` persisté en localStorage.
- **`store/usePlanningStore.ts`** : `setSelectedWeek` pré-peuple `blockedZones` avec `computeHolidayZonesForWeek` si une config est chargée.
- **`lib/blockedZones.ts`** : `BlockedZone` étendu avec `label?: string` et `source?: 'manual' | 'vacation' | 'public-holiday'`.
- **`components/config/SchoolYearBlock.tsx`** : bloc UI sur `/config` (sélecteur d'année + zone A/B/C + bouton charger).
- **`hooks/useCalendarCore.ts`** : `blockEvts` utilise `source` pour différencier les couleurs (bleu = vacances, violet = férié, rouge = manuel). Transmet `blockedZoneSource` et `blockedZoneLabel` via `extendedProps`.
- **`components/planning/ScheduleCalendar.tsx`** : `renderEventContent` affiche 🏖️/🎌/🚫 et le libellé selon la source.

### Comportement

- Les zones vacances/fériés sont générées automatiquement à chaque `setSelectedWeek` depuis les données en store.
- Elles sont visuelles et non bloquantes (supprimables par clic comme les zones manuelles).
- Elles disparaissent si l'utilisateur les supprime, et réapparaissent au prochain changement de semaine.
- Jours fériés : métropole uniquement. Zones scolaires : A, B, C (France).
