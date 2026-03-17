---
applyTo: "packages/scheduler-api/**"
---

# Copilot Instructions — scheduler-api

Le package `scheduler-api` expose le moteur via HTTP (Express) sans dupliquer la logique métier.

## Objectif du package

- Accepter des payloads JSON de planification
- Convertir/valider les entrées
- Déléguer la résolution à `@edt-ts/scheduler-core`
- Retourner des résultats JSON sérialisés

## Architecture attendue

- `src/index.ts` : bootstrap serveur + middlewares
- `src/routes/` : routage HTTP
- `src/controllers/` : orchestration request/response

## Règles d'intégration

- Toute logique de planification reste dans `@edt-ts/scheduler-core`
- Les modèles partagés (`Resource`, `Task`, `ConstraintsManager`, etc.) viennent de `@edt-ts/scheduler-common`
- Ne pas réimporter depuis `@edt-ts/scheduler-core` ce qui est déjà exposé par `@edt-ts/scheduler-common`
- Utiliser `Loader.loadFromRawData()` pour charger les données requête
- Réinitialiser l’état statique avant résolution :
  - `ConstraintsManager.reset()`
  - `Loader.reload()`
- Utiliser `ScheduleAR` comme scheduler par défaut tant qu’aucune autre stratégie n’est demandée

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