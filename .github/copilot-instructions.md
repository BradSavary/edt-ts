# Copilot Instructions for EDT-TS (Monorepo)

Ce fichier contient les règles globales du workspace. Les règles métier détaillées sont dans les fichiers ciblés par package :

- `.github/instructions/scheduler-common.instructions.md`
- `.github/instructions/scheduler-api.instructions.md`
- `.github/instructions/scheduler-client.instructions.md`

## Structure du repository

- `packages/scheduler-common/` : modèles et logique partagés (framework-agnostic), utilisable browser/Node/API
- `packages/scheduler-api/` : API REST (Express) qui consomme `@edt-ts/scheduler-common` et délègue la résolution à `scheduler-cpsat` (Python, sous-processus)
- `packages/scheduler-client/` : application web de test (Vite + TypeScript), consomme `@edt-ts/scheduler-common`
- `packages/scheduler-cpsat/` : moteur de planification (Python, OR-Tools CP-SAT), hors workspace npm
- `docs/` : documentation fonctionnelle et technique

## Dépendances entre packages

```
scheduler-client  -->  scheduler-common
scheduler-api     -->  scheduler-common
scheduler-api     -->  scheduler-cpsat  (sous-processus, pas une dépendance npm)
```

`scheduler-common` n'a aucune dépendance interne (acyclique par conception).

## Principes globaux

- Respecter strictement la séparation en couches :
  - Modèles/logique partagée → `scheduler-common`
  - Moteur de planification → `scheduler-cpsat`
  - Exposition HTTP → `scheduler-api`
  - Interface utilisateur de test → `scheduler-client`
- Ne jamais faire dépendre `scheduler-common` de `scheduler-api` ou `scheduler-client` (acyclique).
- Ne pas dupliquer dans `scheduler-api` ce qui est déjà dans `scheduler-common`.
- `scheduler-client` ne doit importer que depuis `@edt-ts/scheduler-common` (pas depuis `scheduler-api`).
- Garder les changements ciblés, minimaux, et compatibles avec l’existant.
- Préférer des corrections à la racine (chemins, types, état statique) plutôt que des contournements.
- Ne jamais générer plus de code que nécessaire

## Workflows monorepo

- Installation : `npm install` à la racine
- Typecheck global : `npm run typecheck`
- Typecheck par workspace : `npm run typecheck --workspace=packages/<nom>`
- Tests moteur CP-SAT : `cd packages/scheduler-cpsat && .venv/bin/pytest`
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
