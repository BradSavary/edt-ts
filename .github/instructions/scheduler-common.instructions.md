---
applyTo: "packages/scheduler-common/**"
---

# Copilot Instructions — scheduler-common

Le package `scheduler-common` contient les modèles de données et la logique métier partagés entre tous les packages du monorepo. Il doit rester **framework-agnostic** (pas de Node.js, pas d'Express, pas de filesystem).

## Objectif du package

- Définir les modèles de domaine réutilisables : `Resource`, `Task`, `ConstraintsManager`, `AvailabilityManager`, etc.
- Exposer les types TypeScript partagés (`TimeSlot`, `ConstraintsData`, `CourseTaskData`, …)
- Être utilisable dans un contexte browser (Next.js, client) **et** Node.js (scheduler-core, scheduler-api)

## Architecture & composants clés

- `src/bookable.ts` : disponibilité/réservation de créneaux (`TimeInterval`, `AvailabilityManager`, utilitaires timestamps)
- `src/resource.ts` : modèle ressource + logique pause méridienne groupe (`Resource`, `ResourceType`)
- `src/task.ts` : modèle tâche + ressources alternatives (`Task`, `TaskStatus`, `TaskScheduleResult`)
- `src/resourcesManager.ts` : indexation O(1) des ressources (`ResourcesManager`)
- `src/constraintsManager.ts` : contraintes + cache statique (`ConstraintsManager`)
- `src/types.ts` : interfaces JSON partagées (`TimeSlot`, `ConstraintsData`, `CourseTaskData`, …)
- `src/index.ts` : point d'entrée unique — tout export passe par ici

## Règles d'implémentation

- **Aucune dépendance** vers `scheduler-core` ou `scheduler-api` (graphe acyclique)
- **Aucun import** de modules Node.js (`fs`, `path`, `url`, etc.)
- Utiliser des imports ESM avec extension `.ts` sur les imports internes (cohérence monorepo)
- Tout nouveau modèle ou type partagé doit être ajouté ici, pas dans les packages consommateurs
- Exporter systématiquement via `src/index.ts`

## Workflows package

- Typecheck : `npm run typecheck --workspace=packages/scheduler-common`
