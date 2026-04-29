# Système de Timestamps - Documentation

## Vue d'ensemble

Le système utilise des **timestamps en minutes** représentant le temps écoulé depuis **lundi minuit d'une semaine type de 7 jours**.

## Format des timestamps

### Principe de base
```
timestamp = dayIndex * 1440 + minutes_depuis_minuit
```

Où :
- `dayIndex` : Index du jour dans la semaine (0-6)
- `1440` : Nombre de minutes dans une journée (24h × 60min)
- `minutes_depuis_minuit` : Minutes écoulées depuis minuit du jour (0-1439)

### Mapping des jours

| Jour | Index | Plage de timestamps | Exemple |
|------|-------|-------------------|---------|
| **Lundi** | 0 | 0 → 1439 | Lundi 08:00 = 480 min |
| **Mardi** | 1 | 1440 → 2879 | Mardi 14:30 = 2310 min |
| **Mercredi** | 2 | 2880 → 4319 | Mercredi 09:15 = 3435 min |
| **Jeudi** | 3 | 4320 → 5759 | Jeudi 16:45 = 5325 min |
| **Vendredi** | 4 | 5760 → 7199 | Vendredi 13:30 = 6570 min |
| **Samedi** | 5 | 7200 → 8639 | Samedi 11:00 = 7860 min |
| **Dimanche** | 6 | 8640 → 10079 | Dimanche 20:00 = 9840 min |

## Exemples de calcul

### Conversion jour/heure → timestamp
```typescript
// Vendredi 13:30
const dayIndex = 4;           // Vendredi
const hours = 13;
const minutes = 30;
const timestamp = dayIndex * 1440 + hours * 60 + minutes;
// = 4 * 1440 + 13 * 60 + 30
// = 5760 + 780 + 30
// = 6570 minutes
```

### Conversion timestamp → jour/heure
```typescript
// timestamp = 6570 minutes
const dayIndex = Math.floor(6570 / 1440);        // = 4 (Vendredi)
const timeInDay = 6570 % 1440;                   // = 810 minutes
const hours = Math.floor(810 / 60);              // = 13
const minutes = 810 % 60;                        // = 30
// Résultat : Vendredi 13:30
```

## Avantages du système

1. **Simplicité arithmétique** : Les calculs de durée, intersection, etc. sont de simples opérations sur des entiers
2. **Tri naturel** : Les timestamps s'ordonnent naturellement par ordre chronologique
3. **Semaine abstraite** : La même semaine type peut être appliquée à n'importe quelle semaine réelle
4. **Overrides faciles** : Possibilité de définir des exceptions pour des semaines spécifiques (S36, S37, etc.)

## Utilisation dans le code

### Classes principales

- **`Availability`** (`packages/scheduler-common/src/availability.ts`) : gère la liste triée d'intervalles de disponibilité d'une ressource. Expose `addAvailability`, `removeAvailability`, `isAvailable`, `getTotalAvailableTime` et `displaySchedule` (debug console).
- **`AvailabilityManager`** (`packages/scheduler-common/src/availabilityManager.ts`) : construit les objets `Availability` à partir d'un `ConstraintsData`. S'instancie directement — pas de singleton global. Méthode principale : `getAvailability(resourceId, weekNumber?)`.

La conversion timestamps ↔ jours/heures est encapsulée dans ces deux classes ; il n'existe pas de classe utilitaire publique dédiée (`TimestampUtils` n'existe pas).

### Conversion dans le code

```typescript
// Construire un timestamp (utilisé dans AvailabilityManager._createFromSlots)
const startTimestamp = dayIndex * 24 * 60 + startMinutes; // dayIndex * 1440 + mm

// Décomposer un timestamp (utilisé dans Availability.displaySchedule)
const dayIndex  = Math.floor(ts / (24 * 60));       // index 0-6
const timeInDay = ts % (24 * 60);                   // minutes depuis minuit du jour
const hour      = Math.floor(timeInDay / 60);
const minute    = timeInDay % 60;
```

### Affichage lisible (debug)

```typescript
// Affiche tous les créneaux d'une Availability dans la console
availability.displaySchedule();
// ➜  📅 Créneaux de disponibilité:
//       Lundi: 08:00 - 18:00
//       Mercredi: 09:00 - 17:00
//       📊 Total: 19h00 (1140 minutes)
```

## Gestion des semaines spécifiques

Le système supporte des **overrides hebdomadaires** :
- **Semaine par défaut** : Contraintes de base définies dans `contraintes.json`
- **Semaines spécifiques** : Modifications pour S36, S37, etc. qui remplacent la semaine par défaut

Exemple :
```json
{
  "GILLET Anthony": {
    "default": [...],  // Semaine type
    "S36": [...]       // Override pour la semaine 36
  }
}
```

## Debugging et diagnostic

Les timestamps incorrects se manifestent souvent par :
- Affichages erronés type "Jeudi 01:00:06" au lieu de "Vendredi 13:30"
- Durées aberrantes (0.0015 min au lieu de 90 min)
- Échecs de planification inexpliqués

**Cause commune** : Utilisation de `new Date(timestamp)` qui interprète le timestamp comme des millisecondes depuis 1970 au lieu de minutes depuis lundi minuit.

**Solution** : Toujours travailler en minutes entières et utiliser `Availability.displaySchedule()` pour le debug, ou reproduire la décomposition arithmétique ci-dessus.