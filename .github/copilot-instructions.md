# Copilot Instructions for EDT-TS (Monorepo)

Ce fichier contient les règles globales du workspace. Les règles métier détaillées sont dans les fichiers ciblés par package :

- `.github/instructions/scheduler-common.instructions.md`
- `.github/instructions/scheduler-core.instructions.md`
- `.github/instructions/scheduler-api.instructions.md`

## Structure du repository

- `packages/scheduler-common/` : modèles et logique partagés (framework-agnostic), utilisable browser/Node/API
- `packages/scheduler-core/` : moteur de planification (lib TypeScript, Node.js), consomme `@edt-ts/scheduler-common`
- `packages/scheduler-api/` : API REST (Express) qui consomme `@edt-ts/scheduler-core` et `@edt-ts/scheduler-common`
- `docs/` : documentation fonctionnelle et technique

## Principes globaux

- Respecter strictement la séparation en trois couches :
  - Modèles/logique partagée → `scheduler-common`
  - Moteur de planification → `scheduler-core`
  - Exposition HTTP → `scheduler-api`
- Ne jamais faire dépendre `scheduler-common` de `scheduler-core` ou de `scheduler-api` (acyclique).
- Ne pas dupliquer dans `scheduler-core` ou `scheduler-api` ce qui est déjà dans `scheduler-common`.
- Garder les changements ciblés, minimaux, et compatibles avec l’existant.
- Préférer des corrections à la racine (chemins, types, état statique) plutôt que des contournements.

## Workflows monorepo

- Installation : `npm install` à la racine
- Typecheck global : `npm run typecheck`
- Typecheck common : `npm run typecheck --workspace=packages/scheduler-common`
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
- `.github/instructions/scheduler-common.instructions.md`
