# `scheduler-cpsat` — moteur CP-SAT (2e moteur user-facing)

Moteur de planification alternatif basé sur [OR-Tools CP-SAT](https://developers.google.com/optimization),
consolidé depuis le spike de faisabilité (`spikes/cpsat/`, voir historique git). Parle le contrat
partagé `@edt-ts/scheduler-common` :

```python
from cpsat_engine import solve
solutions = solve(raw, config)   # raw: RawScheduleData ; config: sous-ensemble de SchedulerConfig
```

- **Entrée** `RawScheduleData` (`types.ts`) : `{ week, resources, courses, constraints?, groups? }`.
- **Sortie** `list[ScheduleSolutionJSON]` — un seul élément (la meilleure solution) :
  `{ solutions, isComplete, score, provenOptimal, neutralizedTasks? }`.
- **`config`** (tout optionnel) : `lunchBreak` (`{type:'fixed',from,to}` ou `{type:'none'}` ;
  `floating` **non supporté** — feature core-only), `ignoreDailyLimits`, `timeoutSeconds`,
  `excludeTypes` (défaut `['Autonomie']`), `earliest` (défaut `False`).

Décision produit (cf. mémoire `cpsat-second-engine`) : **2e moteur offert à l'utilisateur**, PAS un
oracle de complétude pour `scheduler-core`. Il maximise le nombre de tâches placées et **prouve**
l'optimalité de ce nombre, sur son propre modèle — pas de réplication forcée de la sémantique core.

## Fidélité de modélisation (calquée sur scheduler-common / scheduler-core)

| Aspect | Source TS répliquée | Pattern CP-SAT |
|---|---|---|
| Disponibilités | `AvailabilityManager.getAvailability` (override hebdo + Default) | domaine de `start` restreint aux fenêtres |
| Ressources alternatives | `ResourceEntry = string \| string[]` | intervalle optionnel par (tâche, ressource) + `exactly-one` |
| Non-chevauchement | occupation ressource | `AddNoOverlap` par ressource |
| Enforced | `startTime` + ressources fixes, ignore la dispo | `start` fixé, `scheduled = 1` |
| Dépendances CM→TD→TP | `SchedulerData._determineDependencies` (par code, inclusion des groupes) | précédence conditionnée + **intégrité de chaîne** (`scheduled[dep] ⇒ scheduled[pre]`) |
| taskGroups | `RawScheduleData.groups` + `CourseTaskData.taskGroupId` | parallèle = départs égaux ; séquentiel = enchaînement sans gap ; tout-ou-rien |
| `maxDailyMinutes` | plafond par ressource (contrat : fixe, pas d'override hebdo) | réification `on_day` par (ressource, jour) |
| Pause fixe | `scheduler._applyLunchBreak` | fenêtres des seuls GROUP amputées, lun-ven |

**Hors périmètre** (features core-only écartées, décision « chaque moteur pour ce qu'il est ») :
pause **flottante** ; tâches `Autonomie` (pré-neutralisées en pratique) exclues et rapportées dans
`neutralizedTasks`.

**Overlays `weekSaves` — état :** `manualEnforcedMap` (enforced) **est modélisé** (fusionné dans
`CourseTaskData.enforced`, cf. `cpsatGateway`/client). `manualBlockedZones` (zones bloquées
manuelles) **n'est PAS encore modélisé** — côté core, elles sont appliquées via
`applyBlockedZonesToConstraints` avant l'envoi du payload ; côté CP-SAT elles sont ignorées pour
l'instant. **TODO** (non prioritaire) : soit les rabattre sur les `constraints` en amont (comme le
client le fait déjà), soit les modéliser comme indisponibilités de ressources.

## `cpsat_runner.py` — frontière process

Invoqué en subprocess par `scheduler-api` (`cpsatGateway.ts`) :

- lit **tout stdin** : `{ "raw": RawScheduleData, "config": SchedulerConfig }` ;
- appelle `solve(raw, _map_config(config))` — `_map_config` ne traduit que les champs pertinents
  (`lunchBreak`, `ignoreDailyLimits`, `timeoutSeconds`) et lève une erreur explicite si
  `lunchBreak.type === 'floating'` ; ignore silencieusement les champs core-only
  (`maxEliminations`, `comboBranching`, `postRepair`, `conflictOrderingSearch`, `conflictSetExact`,
  `searchStrategy`, `maxIterations`, `maxSolutions`) ;
- écrit `json.dumps(solutions)` sur **stdout uniquement** (aucun `print` de debug côté stdout ;
  diagnostics sur **stderr**) ; exit 0 si OK ;
- toute exception → message sur stderr + exit 1.

```
echo '{"raw": {...}, "config": {"lunchBreak":{"type":"fixed","from":"12:00","to":"13:30"}}}' \
  | python cpsat_runner.py
```

## Provisionnement du venv

```powershell
cd packages\scheduler-cpsat
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

(bash/macOS/Linux : `source .venv/bin/activate`.) Pour les tests : `pip install -r requirements-dev.txt`
puis `pytest`.

Ce package n'est **pas** intégré au workspace pnpm/npm (c'est du Python pur) — voir le README racine
du repo pour la variable d'environnement `CPSAT_PYTHON` qui pointe `scheduler-api` vers l'interpréteur
de ce venv en production.

## Résultats de parité (mesure de référence, `test_stress.py`)

Rejeu des semaines 38/39 du projet réel — optimum **prouvé** dans les 6 cas (~1 s chacun) :

| Semaine | Pause | Placées / plaçables | Optimum |
|---|---|---|---|
| S38 | aucune / 12:00–13:30 / 12:00–14:00 | **110 / 110** | prouvé |
| S39 | aucune / 12:00–13:30 | **102 / 103** (R3.04 ou R1.04/TD évincé) | prouvé |
| S39 | 12:00–14:00 | **101 / 103** (R1.04 + R1.16/TD) | prouvé |

Les `Autonomie` (3/sem.) sont exclues et comptées comme neutralisées (d'où `isComplete: false` :
elles ne sont pas « plaçables »).

## Note sur `earliest`

« Placer le maximum » ne désigne pas UNE solution : plusieurs optima au même compte existent.
`earliest=True` ajoute un objectif secondaire lexicographique « démarrer au plus tôt » qui
**départage** de façon déterministe — mais transforme un optimum de placement souvent trivial
(0 branche, ~1 s) en une vraie optimisation combinatoire (bien plus lente). Défaut `False` : on
garde la propriété « optimum de placement prouvé rapidement ». La passerelle Node n'active jamais
`earliest`.
