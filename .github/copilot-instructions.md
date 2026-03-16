# Copilot Instructions for EDT-TS (Monorepo)

Ce fichier contient les règles globales du workspace. Les règles métier détaillées sont dans les fichiers ciblés par package :

- `.github/instructions/scheduler-core.instructions.md`
- `.github/instructions/scheduler-api.instructions.md`

## Structure du repository

- `packages/scheduler-core/` : moteur de planification (lib TypeScript)
- `packages/scheduler-api/` : API REST (Express) qui consomme `@edt-ts/scheduler-core`
- `docs/` : documentation fonctionnelle et technique

## Principes globaux

- Respecter strictement la séparation : logique de planification dans `scheduler-core`, exposition HTTP dans `scheduler-api`.
- Ne pas dupliquer la logique métier du core dans l’API.
- Garder les changements ciblés, minimaux, et compatibles avec l’existant.
- Préférer des corrections à la racine (chemins, types, état statique) plutôt que des contournements.

## Workflows monorepo

- Installation : `npm install` à la racine
- Typecheck global : `npm run typecheck`
- Tests moteur : `npm run test-ar` ou `npm run test-standard`
- API : `npm run api:dev` / `npm run api:start`

## Qualité attendue

- TypeScript strict (`noImplicitAny` indirect via `strict`)
- Imports ESM cohérents (extensions `.js` sur imports internes TS)
- Pas de breaking change d’API publique sans demande explicite

## Références

- `README.md`
- `docs/ConstraintsManager.md`
- `docs/LunchBreak.md`
- `docs/Task-Resources.md`
