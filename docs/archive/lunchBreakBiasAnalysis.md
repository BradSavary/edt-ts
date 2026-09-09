# Analyse — biais de la pause méridienne flottante sur disponibilité scindée

**Statut : ANALYSE — aucune modification de code effectuée.**
**Branche :** feature/lunchBreakBias
**Date :** 2026-07-18

## 1. Symptôme observé

Semaine 38, projet réel, planification 100 % avec pause flottante 90 min entre 12:00 et 14:00.

Les contraintes de groupe sont normalement données avec un intervalle unique de disponibilité par jour (ex. 8:00–19:30). En remplaçant cet intervalle unique par deux intervalles séparés par un trou d'indisponibilité — ex. 8:00–12:30 et 13:30–19:30 (trou de 60 min à l'heure du déjeuner) — la planification échoue à placer 2 tâches qui se plaçaient sans problème avec l'intervalle unique.

Intuition de Frédéric : l'absence de disponibilité entre 12:30 et 13:30 ne devrait pas changer le résultat, puisque ce trou constitue déjà les 2/3 de la pause requise. Le moteur semble au contraire exiger 90 minutes de **disponibilité déclarée** libre dans la fenêtre, plutôt que de vérifier que l'**écart réel** entre le dernier cours du matin et le premier de l'après-midi est ≥ 90 min.

## 2. Localisation du code

Deux implémentations distinctes coexistent, avec des rôles différents :

| Rôle | Fichier | Fonction |
|---|---|---|
| **Contrainte réelle (bloque le placement)** | `packages/scheduler-core/src/scheduler.ts` | `_applyLunchBreak()` (l.546-569), `_floatingLBAllows()` (l.576-588), `_resourceKeepsFloatingBreak()` (l.595-633) |
| **Score MCV / propagation de deadline (n'affecte jamais le placement réel)** | `packages/scheduler-core/src/priorityMeasure.ts` (`splitFloatingLunchBreak`, l.83-98) et `packages/scheduler-core/src/taskScheduling.ts` (`intersectResourcesForScoring`, l.67-83) | utilisées par `TaskUnit._computeEffectiveProfile` / `TaskGroupUnit._computeOwnAnchors` |

Le gate qui peut réellement faire échouer un placement est `_resourceKeepsFloatingBreak`.

## 3. Mécanisme exact de la contrainte réelle

```ts
// scheduler.ts, l.595-633
private _resourceKeepsFloatingBreak(resource, slotStart, slotEnd, winStart, winEnd, duration): boolean {
    const intervals = resource.availability.getAvailableIntervals();

    // garde-fou : si le total de dispo DÉCLARÉE dans la fenêtre est déjà < duration,
    // la contrainte est jugée « structurellement inapplicable » → toujours autorisée
    let totalOverlap = 0;
    for (const interval of intervals) {
        const clipStart = Math.max(interval.start, winStart);
        const clipEnd = Math.min(interval.end, winEnd);
        if (clipStart < clipEnd) totalOverlap += clipEnd - clipStart;
    }
    if (totalOverlap < duration) return true;

    for (const interval of intervals) {
        const clipStart = Math.max(interval.start, winStart);
        const clipEnd   = Math.min(interval.end,   winEnd);
        if (clipStart >= clipEnd) continue;

        // bloc contigu de dispo AVANT le slot testé
        const leftEnd = Math.min(clipEnd, slotStart);
        if (leftEnd > clipStart && leftEnd - clipStart >= duration) return true;

        // bloc contigu de dispo APRÈS le slot testé
        const rightStart = Math.max(clipStart, slotEnd);
        if (rightStart < clipEnd && clipEnd - rightStart >= duration) return true;
    }
    return false;
}
```

Point capital : `intervals = resource.availability.getAvailableIntervals()` ne contient **que les créneaux déclarés libres**. Le trou d'indisponibilité (ex. 12:30–13:30) n'apparaît jamais dans cette liste — il est structurellement invisible pour le calcul. La boucle cherche un **bloc de disponibilité déclarée strictement contigu ≥ `duration`**, entièrement avant ou entièrement après le créneau testé, à l'intérieur de la fenêtre — elle ne recolle jamais deux morceaux de dispo séparés par un trou d'indisponibilité pour reconstituer une pause commune.

## 4. Deux manifestations selon la taille du trou

Le garde-fou (l.605-617) a été ajouté pour un cas précis : une journée trop courte pour contenir la pause (ex. jeudi 8h–12h30 face à une fenêtre 12h–14h) ne doit pas être exclue en permanence. Mais ce même garde-fou produit un comportement différent selon la taille du trou d'indisponibilité :

- **Trou ≥ (largeur fenêtre − duration)**, ex. trou de 60 min sur une fenêtre de 120 min avec duration=90 : total de dispo déclarée restant dans la fenêtre = 60 min < 90 → **garde-fou déclenché** → contrainte désactivée ce jour-là (comportement permissif, pas bloquant).
- **Trou plus petit**, ex. 30 min : total de dispo déclarée restant = 90 min ≥ 90 → garde-fou **non déclenché**, mais réparti en deux blocs de 45 min chacun, aucun n'atteint seul 90 min → **blocage total** de tout placement ce jour-là pour ce groupe, y compris des cours n'ayant rien à voir avec l'heure du déjeuner — alors qu'un écart réel matin/après-midi de 90 minutes existe bel et bien (45 dispo + 30 trou + 15 dispo, par exemple).

### Vérification empirique (scripts one-off, lecture seule)

- Disponibilité continue 8:00–19:30, pause flottante 12:00–14:00/90min, 1 tâche TD de 60 min → 6 solutions, succès immédiat.
- Disponibilité scindée 8:00–12:45 / 13:15–19:30 (trou de 30 min), même tâche, mêmes autres ressources → **0 solution**, échec total ; la même tâche se planifie sans problème (6 solutions) si on repasse `lunchBreak` à `{type:'none'}` sur exactement ce même scénario scindé.
- Avec les chiffres exacts de l'exemple de Frédéric (trou de 60 min, 8:00–12:30/13:30–19:30, fenêtre 12:00–14:00, duration 90) : le garde-fou se déclenche (60 < 90) → contrainte permissive ce jour-là pour ce cas précis isolé. Le blocage des 2 tâches du projet réel provient donc vraisemblablement d'autres groupes/jours de la semaine 38 dont le trou tombe dans la zone « bloquante » (juste en dessous du seuil du garde-fou), pas de l'exemple exact cité.

## 5. Verdict

**Hypothèse confirmée dans son principe**, avec une nuance sur le mécanisme exact :

Le moteur vérifie une contrainte de type *« trouver 90 minutes contiguës de disponibilité **déclarée** dans la fenêtre »*, et non *« l'écart réel entre le dernier cours du matin et le premier de l'après-midi ≥ 90 minutes, peu importe si cet écart est composé de disponibilité déclarée inutilisée ou d'indisponibilité déclarée »*. L'indisponibilité déclarée du groupe n'est jamais comptée comme contribuant à la pause.

Selon la taille exacte du trou par rapport à la fenêtre et à la durée de pause, ce défaut se manifeste de deux façons opposées mais dues à la même cause racine : soit un garde-fou désactive complètement la contrainte (permissif à tort), soit la contrainte devient impossible à satisfaire et bloque tout un jour pour un groupe (bloquant à tort). Le second cas correspond vraisemblablement aux 2 tâches non placées du projet réel.

## 6. Effet secondaire (score uniquement, ne bloque jamais un placement)

```ts
// priorityMeasure.ts, l.83-98
export function splitFloatingLunchBreak(profile: Availability, window: FloatingLunchWindow): Availability {
  const DAY = 24 * 60;
  const result = profile.copy();
  for (let day = 0; day < 5; day++) {
    const dayEarliest = day * DAY + window.earliestMin;
    const dayLatest = day * DAY + window.latestMin;
    for (const interval of result.getAvailableIntervals()) {
      const overlapStart = Math.max(interval.start, dayEarliest);
      const overlapEnd = Math.min(interval.end, dayLatest);
      if (overlapStart >= overlapEnd) continue;
      const mid = (overlapStart + overlapEnd) / 2;
      result.removeAvailability(mid - window.duration / 2, mid + window.duration / 2);
    }
  }
  return result;
}
```

Cette fonction alimente le score MCV et la propagation de deadline aux dépendants (CM→TD→TP). Elle itère sur *chaque* intervalle de disponibilité déclarée chevauchant la fenêtre et retire `duration` minutes *par intervalle*, au lieu d'une seule fois pour la fenêtre entière. Avec une disponibilité scindée en 2, elle retire donc 180 min au lieu de 90 du profil de score.

Ceci ne bloque jamais directement `earlySchedule()` (le placement réel passe par `intersectResources`, volontairement tenu à l'écart de cette logique — cf. commentaire `taskScheduling.ts` l.59-65), mais peut fausser l'ordre de recherche MCV et, via la propagation de deadline aux prédécesseurs d'une chaîne CM/TD/TP, aggraver l'échec en pratique sur un planning réel de grande taille (mauvais ordre → épuisement de `maxIterations`/`timeoutSeconds` avant de trouver une solution qui existe pourtant).

## 7. Pistes de solution (aucun code modifié à ce stade)

1. **Corriger `_resourceKeepsFloatingBreak`** pour raisonner sur l'écart réel plutôt que sur la disponibilité déclarée brute : reconstruire, pour le jour concerné, l'ensemble `{indisponibilité déclarée} ∪ {temps déjà réservé}` comme « occupé », puis chercher un bloc occupé-ou-indisponible contigu ≥ `duration` chevauchant la fenêtre. Le trou déclaré compterait alors naturellement comme une partie (ou la totalité) de la pause, conformément à la sémantique « écart réel » attendue. Le garde-fou actuel (l.605-617) deviendrait inutile, la contrainte ne se retrouvant plus jamais dans une situation structurellement impossible à tort.
2. **Harmoniser `splitFloatingLunchBreak`** pour ne retirer qu'une seule fois `duration` minutes par jour (fusionner d'abord tous les intervalles chevauchant la fenêtre — ou raisonner sur le total de l'union avant de choisir un point médian — plutôt que d'itérer indépendamment sur chaque intervalle du snapshot), afin que le profil de score reflète la même règle que la contrainte réelle une fois corrigée au point 1, et cesse de pénaliser doublement les groupes à disponibilité scindée dans le calcul MCV/deadline.

## 8. Références

- Reproduction empirique : scripts one-off dans le scratchpad de session (non conservés dans le dépôt).
- Fichiers concernés : `packages/scheduler-core/src/scheduler.ts`, `packages/scheduler-core/src/priorityMeasure.ts`, `packages/scheduler-core/src/taskScheduling.ts`.
