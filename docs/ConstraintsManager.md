# ConstraintsManager - Documentation

## Vue d'ensemble

Le `ConstraintsManager` est une classe statique qui gère le chargement et l'application des contraintes de disponibilité depuis le fichier `contraintes.json`. Il fournit une interface centralisée pour obtenir les `AvailabilityManager` appropriés pour chaque ressource selon les contraintes par défaut et les overrides hebdomadaires.

## Architecture des contraintes

### Structure du fichier contraintes.json

```json
{
  "Default": [
    // Contraintes par défaut pour toutes les ressources sans contraintes spécifiques
  ],
  "ResourceID": null, // Utilise les contraintes "Default"
  "ResourceID": {
    "default": [...], // Contraintes par défaut pour cette ressource
    "S38": [...],     // Override pour la semaine 38
    "S40": [...]      // Override pour la semaine 40
  }
}
```

### Hiérarchie des contraintes

1. **Contraintes Default** : S'appliquent aux ressources avec `null`
2. **Contraintes default** : Contraintes spécifiques à une ressource
3. **Overrides hebdomadaires** : Remplacent les contraintes par défaut pour des semaines spécifiques (format `SXX`)

## API Principale

### `getAvailabilityManager(resourceId: string, weekNumber?: number)`

Obtient l'`AvailabilityManager` approprié pour une ressource :
- Sans `weekNumber` : retourne les contraintes par défaut
- Avec `weekNumber` : retourne l'override de la semaine ou les contraintes par défaut

### `getAllResourceIds()`

Retourne tous les identifiants de ressources avec contraintes définies.

### `hasResource(resourceId: string)`

Vérifie si une ressource a des contraintes définies.

### `getOverrideWeeks(resourceId: string)`

Retourne les numéros de semaines ayant des overrides pour une ressource.

### `getStats()`

Fournit des statistiques sur les contraintes chargées :
- Nombre total de ressources
- Ressources avec overrides
- Total des overrides

## Intégration avec ResourcesManager

Le `ResourcesManager` a été étendu avec des méthodes d'intégration :

### `applyConstraints()`

Applique les contraintes par défaut à toutes les ressources gérées.

### `applyConstraintsForWeek(weekNumber: number)`

Applique les contraintes spécifiques à une semaine donnée.

### `getConstraintsStats()`

Retourne des statistiques sur l'application des contraintes aux ressources gérées.

## Format des créneaux horaires

Les créneaux horaires sont définis avec :
- `days` : Jours de la semaine (ex: "lundi, mardi, mercredi")
- `from` : Heure de début au format "HH:MM"
- `to` : Heure de fin au format "HH:MM"

## Conversion en timestamps

Le système convertit automatiquement :
- Les jours en indices (lundi=0, mardi=1, ...)
- Les heures en minutes depuis minuit
- Combine les deux en timestamps pour une semaine type

## Gestion des commentaires JSON

Le système supprime automatiquement les commentaires JavaScript (`//`) du fichier JSON pour permettre une documentation inline.

## Exemple d'utilisation

```typescript
import { Loader } from './lib/loader.js';
import { ConstraintsManager } from './constraintsManager.js';

// Charger les ressources
const manager = Loader.loadResources();

// Appliquer les contraintes par défaut
manager.applyConstraints();

// Obtenir une disponibilité spécifique pour la semaine 38
const availability = ConstraintsManager.getAvailabilityManager('MEUNIER Sandrine', 38);

// Appliquer les contraintes de la semaine 40
manager.applyConstraintsForWeek(40);
```

## Avantages

1. **Séparation des préoccupations** : Les contraintes sont gérées indépendamment des ressources
2. **Flexibilité temporelle** : Support des overrides hebdomadaires
3. **Performance** : Cache des `AvailabilityManager` pré-calculés
4. **Intégration transparente** : Interface simple avec le `ResourcesManager` existant
5. **Fallbacks intelligents** : Hiérarchie de contraintes avec valeurs par défaut

## Limitations actuelles

- Format de semaine fixe (SXX)
- Pas de validation des créneaux horaires
- Pas de support des jours fériés ou exceptions ponctuelles
- Contraintes statiques (rechargement requis pour modifications)
