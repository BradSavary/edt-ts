# AvailabilityManager - Documentation

## Vue d'ensemble

`AvailabilityManager` (`packages/scheduler-common/src/availabilityManager.ts`) est la classe qui traduit un objet `ConstraintsData` (contraintes horaires JSON) en objets `Availability` prêts à être affectés aux ressources. Elle est instanciée directement — **pas de singleton global**.

> **Note** : L'ancienne classe `ConstraintsManager` (statique, singleton) n'existe plus. Elle a été remplacée par `AvailabilityManager` lors de la refonte de l'architecture.

## Types de données (`types.ts`)

```typescript
interface TimeSlot {
  days: string;  // "lundi, mardi, jeudi"
  from: string;  // "08:00"
  to:   string;  // "18:00"
}

interface ResourceConstraints {
  default?: TimeSlot[];
  [weekKey: string]: TimeSlot[] | undefined; // "S36", "S47", etc.
}

interface ConstraintsData {
  Default?: TimeSlot[];
  [resourceId: string]: TimeSlot[] | ResourceConstraints | undefined;
}
```

## Structure d'un `ConstraintsData`

```json
{
  "Default": [
    { "days": "lundi, mardi, jeudi, vendredi", "from": "08:00", "to": "18:00" }
  ],
  "DUPONT Jean": null,
  "MARTIN Sophie": [
    { "days": "lundi, mercredi", "from": "09:00", "to": "17:00" }
  ],
  "MEUNIER Sandrine": {
    "default": [{ "days": "lundi, mardi, jeudi", "from": "08:00", "to": "18:00" }],
    "S38": [{ "days": "lundi", "from": "08:00", "to": "12:00" }]
  }
}
```

### Règles de résolution

| Valeur pour `resourceId`    | Disponibilité appliquée                    |
|-----------------------------|--------------------------------------------|
| `null`                      | Créneaux `Default`                         |
| `TimeSlot[]`                | Ces créneaux (pas de `Default`)            |
| `{ default, S36, ... }`     | `default` en base ; `SXX` si override      |
| Absent des clés             | `Default` (avec warning console)           |

## API publique

### Constructeur

```typescript
const am = new AvailabilityManager(data: ConstraintsData);
```

Construit et met en cache tous les `Availability` au moment de l'instanciation.

### `getAvailability(resourceId, weekNumber?): Availability | null`

Retourne l'`Availability` pour une ressource :
- Avec `weekNumber` : retourne l'override `SXX` si disponible, sinon le `default` de la ressource
- Sans `weekNumber` : retourne le `default` de la ressource
- Si la ressource est inconnue : retourne les créneaux `Default` avec un warning console

## Intégration avec `ResourcesManager`

`ResourcesManager` expose une méthode dédiée :

```typescript
resourcesManager.applyConstraintsForWeek(weekNumber: number, am: AvailabilityManager): void
```

Elle parcourt toutes les ressources et appelle `am.getAvailability(resource.id, weekNumber)` pour affecter l'`Availability` à chaque `Resource`.

## Intégration dans le flux de planification

Le payload envoyé à l'API (`RawScheduleData`) peut inclure directement l'objet `constraints` ; aucun
fichier JSON externe n'est lu par l'API. Côté moteur, `_make_availability`
(`packages/scheduler-cpsat/cpsat_engine.py`) construit les fenêtres de disponibilité de chaque
ressource directement depuis ce même objet `constraints`.

## Parsing des créneaux

- **Jours** : chaîne `"lundi, mardi, jeudi"` — séparateurs virgule et/ou espace, insensible à la casse. Les variantes (`jeeudi`) sont tolérées.
- **Heures** : format `"HH:MM"` → converti en minutes depuis minuit.
- **Timestamp** : `dayIndex * 1440 + minutes` (voir `docs/TIMESTAMPS.md`).

## Limitations

- Format d'override semaine fixe : `SXX` (ex: `S36`, `S47`)
- Pas de validation des créneaux horaires (chevauchements, valeurs hors bornes)
- Pas de support des jours fériés ou exceptions ponctuelles
- L'état est immuable après construction (pas de rechargement partiel)
