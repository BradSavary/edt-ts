# Plan d'implémentation — pause flottante par « trou sans cours »

**Branche :** feature/lunchBreakBias (déjà dédiée — ne pas travailler sur master)
**Analyse de référence :** [lunchBreakBiasAnalysis.md](./lunchBreakBiasAnalysis.md)
**Rôle :** conception validée (Fable/Frédéric) → exécution Sonnet.
**Statut :** IMPLÉMENTÉ ET VALIDÉ (2026-07-18). Diff §3.1+§3.2 conforme au plan, checkpoint
feu-vert §4 validé par Frédéric. §5.1 : 7/7 cas unitaires ciblés passent (109/109 tests
scheduler-core, aucune régression). §5.2 : projet réel S38 (export 2026-07-16, config réelle
DEFAULT_SCHEDULER_CONFIG + pause flottante 90/12-14) — non-régression confirmée sur 3 scénarios
de trou (60min, 30min×2 positions) appliqués à tous les groupes/tous les jours : 100% (110/110,
zéro STOP) avant ET après correctif sur ce dataset précis — la reproduction exacte des « 2 tâches
non placées » de Frédéric (groupe/jour non précisés) n'a pas pu être isolée, jugé suffisant par
Frédéric au vu de la preuve unitaire sans ambiguïté + absence de régression réelle. §5.3 non
déclenché (§6/score non rouvert, conforme au non-objectif §2).

## 1. Objectif

Corriger le biais de la pause méridienne flottante sur disponibilité scindée. Le gate
actuel (`_resourceKeepsFloatingBreak`) exige un bloc de **disponibilité déclarée** libre
≥ `duration` contigu, ce qui (a) ne compte jamais une indisponibilité déclarée comme
faisant partie de la pause et (b) bloque tout un jour pour un groupe quand la fenêtre est
scindée en morceaux < `duration`.

Nouveau modèle, validé avec Frédéric : **la pause existe s'il reste, dans la fenêtre
`[winStart, winEnd]`, un intervalle contigu ≥ `duration` libre de tout cours réservé.**
On raisonne uniquement sur les cours déjà placés (`_solution`) + le slot hypothétique,
**jamais** sur `resource.availability`. L'indisponibilité déclarée n'a donc pas à être
représentée : n'étant pas un cours, elle reste automatiquement dans le complément et
compte comme pause. Un cours qui déborde de la fenêtre ne consomme que sa portion
intra-fenêtre (clipping) → glissement de ±(largeur fenêtre − duration) de la pause.

## 2. Non-objectifs (ne pas toucher à ce stade)

- **NE PAS** modifier `splitFloatingLunchBreak` / `intersectResourcesForScoring`
  (`priorityMeasure.ts`, `taskScheduling.ts`) — c'est du score uniquement (§6 de
  l'analyse), traité séparément *après* validation de la contrainte dure. Rien ne prouve
  qu'il cause les 2 tâches non placées.
- NE PAS toucher au chemin de placement réel (`intersectResources`) ni à `book()`.
- NE PAS introduire de snapshot de disponibilité d'origine : inutile avec ce modèle.

## 3. Changements de code

Tout est dans `packages/scheduler-core/src/scheduler.ts`.

### 3.1 Raccourci hors-fenêtre dans `_floatingLBAllows` (l.576-588)

Si le slot n'intersecte pas la fenêtre du jour, le placement ne peut pas consommer de
temps de pause → autoriser sans calcul. Valide car chaque cours déjà placé a été vérifié
à son propre placement : l'invariant « il reste une pause » est maintenu à chaque étape,
et un cours hors fenêtre ne peut pas le casser.

Ajouter, juste après le calcul de `winStart`/`winEnd` et avant le `return result.resources…` :

```ts
// Le slot ne touche pas la fenêtre de pause → ne peut rien consommer de la pause.
if (Math.max(slotStart, winStart) >= Math.min(slotEnd, winEnd)) return true;
```

### 3.2 Réécriture complète de `_resourceKeepsFloatingBreak` (l.595-633)

Remplacer intégralement le corps. La méthode ne lit plus `resource.availability` : elle
balaye `this._solution` pour reconstruire les cours du groupe `resource` chevauchant la
fenêtre, y ajoute le slot hypothétique, et cherche un trou libre ≥ `duration`.

```ts
private _resourceKeepsFloatingBreak(
    resource: Resource,
    slotStart: number,
    slotEnd: number,
    winStart: number,
    winEnd: number,
    duration: number,
): boolean {
    // Garde-fou résiduel SAIN (fondé sur la fenêtre, pas sur la dispo) : si la fenêtre
    // est structurellement trop courte pour contenir la pause, la contrainte est
    // inapplicable — ne bloque pas tout le jour sur une config incohérente.
    if (winEnd - winStart < duration) return true;

    // Cours occupant ce groupe et chevauchant la fenêtre, clippés à [winStart,winEnd].
    // Le slot hypothétique n'est pas encore dans _solution (book() vient après le check)
    // → l'ajouter explicitement. Les tâches enforced sont déjà dans _solution.
    const busy: Array<[number, number]> = [];
    const pushClip = (start: number, end: number): void => {
        const cs = Math.max(start, winStart);
        const ce = Math.min(end, winEnd);
        if (cs < ce) busy.push([cs, ce]);
    };
    pushClip(slotStart, slotEnd);
    for (const { unit, result } of this._solution) {
        if (!result.resources.some(r => r.id === resource.id)) continue;
        pushClip(result.start, result.start + unit.duration);
        // (les cours d'un autre jour se clippent à vide → ignorés naturellement)
    }

    // Plus grand trou libre dans [winStart,winEnd] \ busy ≥ duration ?
    busy.sort((a, b) => a[0] - b[0]);
    let cursor = winStart;
    for (const [s, e] of busy) {
        if (s - cursor >= duration) return true; // trou libre avant ce cours
        if (e > cursor) cursor = e;              // fusion des chevauchements
    }
    return winEnd - cursor >= duration;          // trou libre après le dernier cours
}
```

Le garde-fou par `totalOverlap` (ancien l.605-617), fondé sur la disponibilité déclarée,
**disparaît** : le jour court (groupe indispo l'après-midi) est géré nativement — aucun
cours dans la fenêtre → complément = fenêtre entière ≥ `duration` → autorisé.

### 3.3 Vérifier l'accès à `this._solution`

`_resourceKeepsFloatingBreak` est une méthode de `Scheduler` : `this._solution`
(array de `{ unit, result }`) est accessible. Confirmer le type et que `result.resources`
+ `unit.duration` + `result.start` sont bien disponibles (ils le sont : cf. `book()` et
`_addDailyUsage`). Aucun changement de signature nécessaire.

## 4. CHECKPOINT feu-vert (obligatoire avant de passer aux tests)

S'arrêter ici et faire valider par Frédéric :
- diff de `scheduler.ts` (les deux modifications ci-dessus, rien d'autre),
- confirmation que `_floatingLBAllows` reste bien appelé sur le chemin `earlySchedule`
  (l.323 et l.413) et dans `optionalTasksScheduler.ts` (l.278/302) — ces call sites ne
  changent pas mais héritent du nouveau comportement.

## 5. Validation (dimensionnée au changement)

Config de test scheduler-core par défaut sauf indication : `maxSolutions:1`,
`maxEliminations:6`, `timeoutSeconds:10`, `maxIterations:1_000_000`, pause flottante
90 min 12:00–14:00. **Un seul batch loggé, un seul réveil à la fin.**

### 5.1 Tests unitaires ciblés (nouveaux, sur `_floatingLBAllows`)
Cas à couvrir (fenêtre 12:00–14:00, duration 90) :
1. Dispo continue, aucun cours → autorisé.
2. Dispo scindée par indispo 12:30–13:30 (trou 60), aucun cours → autorisé (l'indispo
   compte comme pause). **C'est le cas qui échouait.**
3. Dispo scindée par indispo 12:45–13:15 (trou 30), cours placé à 15:00 (hors fenêtre)
   → autorisé (bug catastrophique corrigé).
4. Cours 11:00–12:30 (empiète 30 min) → autorisé, complément 12:30–14:00 = 90.
5. Cours 13:30–15:00 (empiète 30 min), matin fini à 12:00 → autorisé, complément
   12:00–13:30 = 90.
6. Fenêtre saturée : cours 12:00–13:00 + 13:00–14:00 → refusé (plus de trou ≥ 90).
7. Jour court (groupe indispo tout l'après-midi) → autorisé (pas de pause à protéger).

### 5.2 Validation projet réel (obligatoire)
- **RE-EXPORTER d'abord** le projet réel semaine 38 (les snapshots vieillissent).
- Rejouer la planification 100 % avec pause flottante 90/12–14 sur disponibilités
  scindées et vérifier que les **2 tâches non placées reviennent**, zéro STOP.
- Contrôler qu'aucune régression n'apparaît sur une semaine à disponibilité continue
  (le comportement doit être inchangé hors indispo dans la fenêtre).

### 5.3 Décision §6 (score)
Seulement **si** les 2 tâches ne reviennent pas avec la seule correction dure : rouvrir
`splitFloatingLunchBreak` (piste déficit `max(0, duration − indispo_dans_fenêtre)`),
sinon ne pas y toucher.

## 6. Perf (note, pas d'action d'emblée)

Le balayage de `this._solution` à chaque check est O(n) par placement → O(n²) global.
Négligeable attendu sur un projet réel de taille modérée. Si un profiling montre que ça
mord : maintenir un index incrémental `(resource.id, jour) → intervalles réservés` sur le
modèle de `_dailyBookedMinutes`, mis à jour dans `book()`/`unBook()`. **À ne faire que
si mesuré.**

## 7. Résumé des fichiers touchés

- `packages/scheduler-core/src/scheduler.ts` — §3.1 + §3.2 (seul fichier de prod modifié).
- Tests unitaires scheduler-core — §5.1 (nouveaux cas).
