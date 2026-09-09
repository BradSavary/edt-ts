---
applyTo: "packages/scheduler-api/**"
---

# Copilot Instructions — scheduler-api

Le package `scheduler-api` expose le moteur via HTTP (Express) sans dupliquer la logique métier.

## Objectif du package

- Accepter des payloads JSON de planification
- Convertir/valider les entrées
- Déléguer la résolution à `scheduler-cpsat` (Python, OR-Tools, invoqué en sous-processus via `cpsatGateway.ts`)
- Retourner des résultats JSON sérialisés

## Architecture attendue

- `src/index.ts` : bootstrap serveur + middlewares
- `src/routes/` : routage HTTP
- `src/controllers/` : orchestration request/response
- `src/runEngine.ts` : point d'entrée unique vers `runCpsat` (`cpsatGateway.ts`)

## Règles d'intégration

- Toute logique de planification vit dans `scheduler-cpsat` (Python) ; ce package n'en réimplémente rien
- Les modèles partagés (`RawScheduleData`, `SchedulerConfig`, `ScheduleSolutionJSON`, etc.) viennent de `@edt-ts/scheduler-common`
- `cpsatGateway.ts` est la seule frontière avec le sous-processus Python — pas d'appel direct ailleurs

## Contrat API (principe)

- `POST /api/schedule` : payload complet (`week`, `teachers`, `groups`, `rooms`, `courses`, `constraints?`, `options?`)
- `GET /api/schedule/health` : endpoint de disponibilité
- Toujours renvoyer un JSON exploitable (`isComplete`, `scheduledCount`, `conflictCount`, `solutions[]` ou `error`)

## Qualité & robustesse

- Valider les entrées (minimum shape + types)
- Ne pas renvoyer d’objets de domaine non sérialisables (Map/Set/classes complexes)
- Garder les controllers minces ; extraire les adaptations si elles grossissent
- Éviter les effets de bord globaux hors cycle d’une requête

## Workflows package

- Dev : `npm run api:dev`
- Start : `npm run api:start`
- Typecheck : `npm run typecheck --workspace=packages/scheduler-api`