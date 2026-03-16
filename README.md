# EDT-TS Monorepo

Monorepo TypeScript pour la planification d'emploi du temps.

## Structure

- `packages/scheduler-core/` : moteur de planification (librairie)
- `packages/scheduler-api/` : API REST Express qui consomme le moteur
- `docs/` : documentation fonctionnelle et technique

## Commandes principales

- Installation : `npm install`
- Typecheck global : `npm run typecheck`
- Test moteur (AR) : `npm run test-ar`
- Test moteur (standard) : `npm run test-standard`
- API dev : `npm run api:dev`
- API start : `npm run api:start`

## Instructions Copilot

Le projet utilise un fichier global + des instructions ciblées par package :

- Global : `.github/copilot-instructions.md`
- Core : `.github/instructions/scheduler-core.instructions.md` (`applyTo: packages/scheduler-core/**`)
- API : `.github/instructions/scheduler-api.instructions.md` (`applyTo: packages/scheduler-api/**`)

Principe :

- Les règles communes (monorepo, qualité, séparation des responsabilités) sont dans le fichier global.
- Les règles métier/techniques spécifiques sont dans les fichiers package-scoped.
- En cas de conflit, la règle la plus spécifique au contexte de fichier doit être privilégiée.
