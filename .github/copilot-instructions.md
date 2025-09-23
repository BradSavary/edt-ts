# Copilot Instructions for EDT-TS

Ce document guide les agents IA pour une productivité immédiate sur le projet EDT-TS (gestion d'emploi du temps en TypeScript pour Node.js).

## Architecture & Composants Clés
- **src/schedule.ts** : Planificateur principal (backtracking, propagation de contraintes)
- **src/scheduleExp.ts** : Version expérimentale optimisée
- **src/scheduleMR.ts** : Multi-Rooms (flexibilité des salles)
- **src/task.ts** : Modélisation des tâches (type, semaine, niveau)
- **src/resource.ts** : Gestion des ressources (enseignants, salles, groupes)
- **src/bookable.ts** : Système de réservation de créneaux
- **src/lib/loader.ts** : Chargement JSON, extraction automatique des dépendances
- **src/resourcesManager.ts** : Indexation centralisée O(1)
- **src/constraintsManager.ts** : Application des contraintes temporelles

## Données & Flux
- Les données sont chargées automatiquement depuis `src/json/teachers.json`, `groups.json`, `rooms.json`, `cours.json`, `contraintes.json`.
- Les dépendances CM → TD → TP sont déduites automatiquement par code de cours.
- Les contraintes sont hiérarchisées : Default → spécifique → override hebdomadaire.

## Workflows Développeur
- **Build/TypeScript** : `npm run build` (erreurs non-bloquantes parfois tolérées)
- **Tests/Planification** :
  - Standard : `npx tsx src/Claude/test-standard-schedule.ts`
  - Expérimental : `npx tsx src/Claude/test-exp-scheduling.ts`
  - Multi-Rooms + iCal : `npx tsx src/Claude/test-mr-ical.ts`
  - Autres scripts : voir `src/Claude/`
- **Export iCal** : via `scheduler.export2ICal()` (fichiers dans `src/ical/`)
- **Régénération des enseignants** : `Loader.regenerateTeachersFile()` ou version synchrone

## Conventions Spécifiques
- Les identifiants de ressources sont indexés pour accès O(1).
- Les contraintes de groupes exigent l'inclusion stricte des groupes dépendants.
- Les algorithmes détectent et propagent les conflits en temps réel.
- Les scripts de test affichent systématiquement : tâches planifiées, taux de réussite, conflits, complétude, stats par ressource.
- Les exports iCal sont nommés par niveau (R1, R3, R5).

## Points d'Intégration
- Les managers (ResourcesManager, ConstraintsManager) sont le point d'entrée pour toute manipulation de ressources ou contraintes.
- Les données JSON sont modifiables et régénérables via scripts utilitaires (`extract-data.ts`, méthodes Loader).

## Exemples
```typescript
import { Schedule } from './src/schedule';
const scheduler = new Schedule();
const solution = scheduler.solve();
console.log(`Tâches planifiées: ${solution.solutions.length}`);
scheduler.export2ICal();
```

## Références
- Voir `README.md` pour détails d'installation, usage et scripts.
- Voir `docs/ConstraintsManager.md` pour l'API des contraintes.

---

Pour toute ambiguïté, se référer aux scripts de test dans `src/Claude/` et à la documentation dans `docs/`.
