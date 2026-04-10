# Pause Méridienne

## Vue d'ensemble

La pause méridienne est une contrainte optionnelle configurable via `SchedulerConfig.lunchBreak`.
Elle est appliquée lors de l'initialisation du solveur (`initSolver()`), après le booking des tâches enforced.

Seules les ressources de type `GROUP` sont concernées par ces contraintes.

## Stratégies disponibles

### `none` (défaut)

Aucune contrainte de pause méridienne n'est appliquée.

```ts
configure({ lunchBreak: { type: 'none' } })
```

---

### `fixed`

Soustrait une plage horaire fixe des disponibilités des ressources de type **GROUP**, pour chacun des 5 jours de la semaine. Aucun cours impliquant un groupe ne peut être placé sur cette plage.

```ts
configure({
  lunchBreak: {
    type: 'fixed',
    from: '12:00',
    to: '13:30',
  }
})
```

- `from` / `to` : chaînes au format `"HH:MM"`.
- La plage `[from, to[` est rendue indisponible sur les 5 jours pour tous les groupes.
- Appliqué une fois dans `_applyLunchBreakConstraint()`, avant le début du backtracking.

---

### `floating`

Garantit qu'un bloc libre d'au moins `duration` minutes reste disponible dans une fenêtre `[earliest, latest]` pour chaque ressource de type **GROUP** impliquée dans la tâche candidate. Cela permet à la pause de « flotter » librement dans la fenêtre plutôt que d'être fixée à une heure précise.

```ts
configure({
  lunchBreak: {
    type: 'floating',
    duration: 90,
    earliest: '12:00',
    latest: '14:00',
  }
})
```

- `duration` : durée minimale de la pause en minutes.
- `earliest` / `latest` : bornes de la fenêtre dans laquelle la pause doit pouvoir se placer (format `"HH:MM"`).
- Ne modifie pas les disponibilités des ressources — c'est un **filtre de créneaux** appliqué dans `generatePossibleSlots()`.

#### Mécanisme

Pour chaque créneau candidat `[slotStart, slotEnd]`, le filtre vérifie que chaque ressource GROUP de la tâche conserve, dans sa disponibilité actuelle clipée sur `[winStart, winEnd]`, un sous-intervalle libre d'au moins `duration` minutes en dehors du slot. Le test est purement en lecture seule via `_resourceKeepsFloatingBreak()`.

```
fenêtre jour J : [winStart, winEnd]
                ┌──────────────────────────────────┐
                │  libre ?  │ slot │     libre ?    │
                └──────────────────────────────────┘
                             ↑
                   au moins 1 côté ≥ duration  →  slot accepté
```

Si aucune ressource GROUP n'est associée à la tâche, le filtre est inopérant (slot toujours accepté).

#### Différence avec `fixed`

| | `fixed` | `floating` |
|---|---|---|
| Moment d'application | `initSolver()` (avant backtracking) | `generatePossibleSlots()` (pendant backtracking) |
| Effet sur les disponibilités | Supprime définitivement la plage | Aucun — filtre de lecture seule |
| Ressources concernées | GROUP uniquement | GROUP uniquement |
| Flexibilité | Pause à heure fixe | Pause libre dans la fenêtre |

## Types TypeScript

Définis dans `packages/scheduler-common/src/types.ts` :

```ts
export interface LunchBreakNone     { type: 'none'; }
export interface LunchBreakFixed    { type: 'fixed'; from: string; to: string; }
export interface LunchBreakFloating { type: 'floating'; duration: number; earliest: string; latest: string; }

export type LunchBreakConfig = LunchBreakNone | LunchBreakFixed | LunchBreakFloating;
```
