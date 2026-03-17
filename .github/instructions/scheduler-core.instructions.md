---
applyTo: "packages/scheduler-core/**"
---

# Copilot Instructions — scheduler-core

Le package `scheduler-core` contient le moteur de planification pur. Il doit rester indépendant de tout framework HTTP.

## Dépendances

- Consomme `@edt-ts/scheduler-common` pour les modèles partagés (`Resource`, `Task`, `ConstraintsManager`, `AvailabilityManager`, etc.)
- Ne doit pas réimplémenter ce qui est déjà dans `scheduler-common`

## Architecture & composants clés

- `src/schedule.ts` : planificateur principal (backtracking + propagation)
- `src/scheduleAR.ts` : scheduler à ressources alternatives (classe minimale exposée)
- `src/lib/loader.ts` : chargement JSON + chargement brut (`loadFromRawData`)
- Les modèles (`Resource`, `Task`, `ResourcesManager`, `ConstraintsManager`, `AvailabilityManager`) proviennent de `@edt-ts/scheduler-common`

## Données & flux

- JSON embarqués : `src/json/teachers.json`, `groups.json`, `rooms.json`, `cours.json`, `contraintes.json`
- iCal généré dans `ical/`
- Dépendances pédagogiques CM → TD → TP déduites automatiquement
- Contraintes hiérarchisées : `Default` → spécifique ressource → override semaine

## Workflows package

- Typecheck : `npm run typecheck --workspace=packages/scheduler-core`
- Smoke test AR : `npm run test-ar --workspace=packages/scheduler-core`
- Smoke test standard : `npm run test-standard --workspace=packages/scheduler-core`
- Scripts exemples : `packages/scheduler-core/examples/`

## Règle métier clé : ressources alternatives

Structure `Task.resources` :

```ts
resources: { [K in ResourceType]: Resource[][] }
```

Sémantique : une tâche nécessite **une ressource par groupe alternatif**.

Toujours respecter le workflow :

1. `task.getApplicableResources()`
2. tester chaque combinaison
3. `task.appliedResources = combinaisonChoisie`
4. réserver/libérer précisément cette combinaison

## Pause méridienne groupes

- Contrôle appliqué aux ressources de type `GROUP`
- Pause flottante 90 min entre 12:00 et 14:00
- Non applicable aux enseignants

## Règles d’implémentation

- Ne pas introduire de logique Express/HTTP dans ce package
- Préserver le comportement déterministe de `ScheduleAR`
- Si usage serveur/API : réinitialiser l’état statique (`ConstraintsManager.reset()`, `Loader.reload()`) entre runs
- Favoriser des APIs exportées via `src/index.ts` plutôt que des imports profonds