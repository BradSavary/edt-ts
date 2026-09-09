# Plan d'implémentation — Correction du bug d'élimination d'une unité à dépendants

*Plan rédigé par Fable (audit du 15/07/2026, cf. `docs/AuditBackjumping.md` §5) pour implémentation par Sonnet. Branche cible : `feature/backtracking`. Toutes les décisions de conception sont déjà arbitrées par Frédéric — ne pas les rouvrir. À faire AVANT le chantier COS (`docs/PlanConflictOrderingSearch.md`).*

## 1. Le bug

`Scheduler.solveWithElimination()` (`packages/scheduler-core/src/scheduler.ts`, lignes ~190-228) élimine l'unité la plus blâmée par `this._units.splice(targetIdx, 1)` **sans se préoccuper de ses dépendants**. Or le graphe de dépendances CM→TD→TP (câblé automatiquement par `_determineDependencies` dans `scheduler-common/src/schedulerData.ts`, reporté sur les unités dans `initSolver`) fait qu'un dépendant orphelin reste dans `_units` : au round suivant, `_dynamicSort` le classe « notReady » pour toujours, et quand `_backtrack` finit par l'atteindre, la garde lève :

```
Error: Unité '…' : dépendance '…' non encore planifiée — vérifiez que le graphe…
```

L'exception remonte à travers `solveWithElimination` et **crashe toute la planification**. La configuration actuelle n'y échappe que par chance : sur les données réelles testées, le blâme n'a jamais désigné en premier une unité ayant des dépendants. Le crash a été observé pendant l'audit dès qu'un ordre d'exploration différent a déplacé le blâme (élimination d'un TD `R3.Crea.09` → son TP orphelin → throw). Toute évolution du blâme peut y exposer les vraies semaines.

## 2. Sémantique retenue (décision Frédéric — ne pas changer)

**Neutraliser aussi les dépendants, transitivement.** Quand l'unité éliminée a des dépendants (directs ou en chaîne : CM éliminé → TD → TP), toute la chaîne est retirée de `_units` et reportée dans `neutralizedUnits` avec une raison explicite distincte. Justification : cohérence pédagogique (pas de TP placé alors que son TD/CM n'existe plus cette semaine) et transparence côté utilisateur.

Précisions d'arbitrage :
- **Un round d'élimination = une décision** : la chaîne entière (cible + dépendants) compte pour UN round de `maxEliminations`, pas un par unité.
- **Les dépendants enforced ne sont PAS neutralisés** : une unité enforced est pré-placée par l'utilisateur, ne passe jamais par la vérification de dépendance de `_backtrack` (elle n'a pas de frame), donc ne cause pas de crash — et sa présence relève de la responsabilité de l'utilisateur. On la laisse en place.
- `failureCount` du dépendant neutralisé = son propre compteur de blâme (`counts.get(id) ?? 0`), souvent 0 — c'est normal et informatif.

## 3. Implémentation

### 3.1 `packages/scheduler-core/src/scheduler.ts` — `solveWithElimination()`

Remplacer le bloc d'élimination (actuellement `neutralizedList.push({...}); this._units.splice(targetIdx, 1);`) par :

1. Calculer la **fermeture transitive des dépendants non-enforced** de l'unité cible :

```ts
/** Dépendants transitifs (non enforced) d'une unité — pour neutralisation en chaîne. */
private _collectDependents(root: ISchedulingUnit): ISchedulingUnit[] {
    const out: ISchedulingUnit[] = [];
    const stack = [...root.getDependentUnits()];
    while (stack.length > 0) {
        const u = stack.pop()!;
        if (u.isEnforced || out.includes(u)) continue;
        out.push(u);
        stack.push(...u.getDependentUnits());
    }
    return out;
}
```

(`getDependentUnits()` existe sur `TaskUnit` — `taskUnit.ts:167` — et sur `TaskGroupUnit` ; le lien inverse est maintenu par `setDependsOn`/`_addDependentUnit`. La fermeture fonctionne au niveau `ISchedulingUnit`, groupes compris.)

2. Pousser dans `neutralizedList` : la cible avec la raison actuelle inchangée, puis chaque dépendant avec :

```ts
neutralizedList.push({
    unit: dep,
    eliminationRound: round + 1,               // même round que la cible
    failureCount: counts.get(dep.id) ?? 0,
    reason: `Dépend de « ${eliminated.id} », neutralisée ce round — chaîne CM/TD/TP incomplète`,
});
```

3. Retirer cible + dépendants de `_units` en **une seule passe** (remplacer le `splice`) :

```ts
const removed = new Set<string>([eliminated.id, ...dependents.map(d => d.id)]);
this._units = this._units.filter(u => !removed.has(u.id));
```

`_firstNonEnforcedIndex` reste valide : toutes les unités retirées sont non-enforced, donc situées après cet index (les dépendants enforced sont exclus par construction en 3.1).

4. Adapter le log console : mentionner le nombre de dépendants neutralisés en chaîne s'il y en a.

**Ne rien changer d'autre** : ni le blâme, ni `_backtrack`, ni la sérialisation (`NeutralizedUnitInfo.reason` transite tel quel jusqu'au client via `serializeNeutralizedUnit`).

### 3.2 Garde-fou complémentaire (défense en profondeur)

Dans la boucle de sélection de la cible (`for (let j = this._firstNonEnforcedIndex; ...)`), rien à changer : la cible peut légitimement être une unité à dépendants, c'est désormais géré. **Ne pas** implémenter de « skip des unités à dépendants » (option explicitement rejetée par Frédéric : elle reporterait l'élimination sur des victimes).

## 4. Tests (`packages/scheduler-core/__tests__/schedulerEliminationDependents.test.ts`, nouveau)

Suivre les conventions des suites existantes (`schedulerFailureBlame.test.ts` : scénarios `RawScheduleData` construits, `Loader.loadFromRawData`, classe `InspectableScheduler` si besoin). **Écrire le test 1 AVANT le correctif et vérifier qu'il crashe (rouge), puis corriger (vert).**

1. **Cas principal — TD blâmé avec TP dépendant** : cours de même code `X1` : un CM (enforced ou placé facilement), un TD « occupant gourmand » (calqué sur le scénario OCCEND de `schedulerFailureBlame.test.ts` : 180 min sur une ressource de 240 min partagée avec une victime de 90 min → le TD accumule tout le blâme et est éliminé au round 1), et un TP 60 min dépendant du TD (même code, groupe inclus → dépendance auto-câblée ; vérifier avec `getDependsOn()` que le câblage attendu est bien en place avant d'asserter la suite). Assertions : pas d'exception ; `neutralizedUnits` contient le TD **et** le TP (même `eliminationRound`), pas le CM ni la victime ; la `reason` du TP mentionne l'id du TD ; `isComplete === true` pour le reste.
2. **Non-régression — cible sans dépendants** : rejouer le scénario OCCEND/VICEND de `schedulerFailureBlame.test.ts` tel quel : comportement strictement inchangé (OCCEND seule neutralisée).
3. **Chaîne transitive** : faire du CM la cible du blâme (le CM devient l'occupant gourmand), avec TD dépendant du CM et TP dépendant du TD → les trois (CM, TD, TP) neutralisés au même round.

## 5. Vérification et livraison

- `npm run typecheck` (racine) + suite complète `packages/scheduler-core` (66 tests existants + les nouveaux) au vert.
- Contrôle rapide de non-régression sur le projet réel (`packages/scheduler-core/data/Planification MMI.json`, **gitignoré — ne jamais commiter ce fichier ni le dossier `data/`**) : semaines 37/38/39 + 40 (pour 38/39, reproduire le pipeline weekSaves complet — voir la mémoire de session `feedback_validate_on_full_real_project` ; pour 37/40, filtre simple par semaine, 40 sans les cours type `Autonomie`). Config de test standard : `maxSolutions:1, maxEliminations:6, timeoutSeconds:10, maxIterations:1_000_000, lunchBreak flottante 90min [12:00,14:00]`. Résultats attendus **identiques à l'existant** (le chemin corrigé ne se déclenche pas sur ces données). Script jetable dans `examples/*-tmp.ts`, supprimé après usage.
- Commit sur `feature/backtracking`, fichiers stagés explicitement par nom (jamais `git add -A`), message en français expliquant bug + sémantique retenue, signature `Co-Authored-By` habituelle. Commentaires de code en français, style du fichier.

## 6. Definition of done

- [ ] Test 1 écrit d'abord, crash reproduit, puis vert après correctif
- [ ] 3 tests nouveaux verts + suite existante intacte + typecheck monorepo propre
- [ ] Semaines 37-40 réelles : résultats identiques à avant le correctif
- [ ] Aucun fichier de `data/` commité ; scripts tmp supprimés
- [ ] Commit unique, message français, `feature/backtracking`
