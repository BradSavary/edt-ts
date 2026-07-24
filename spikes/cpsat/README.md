# Moteur CP-SAT — `solve(RawScheduleData)`

Consolidation du spike d'apprentissage en **un seul moteur** parlant le vrai contrat
partagé `@edt-ts/scheduler-common`. Objectif tranché (cf. mémoire `cpsat-second-engine`) :
un **2e moteur user-facing** en alternative à `scheduler-core`, **pas** un oracle de
complétude. Il maximise le nombre de tâches placées et **prouve** l'optimalité de ce nombre.

> Historique : ce dossier contenait trois scripts d'essai épars (`solve.py` jouet CM/TD/TP,
> `real_payload.py` S36, `stress.py` projet réel S38/S39) qui ont répondu au go/no-go de
> faisabilité. Ils sont désormais **subsumés** par `cpsat_engine.solve()` — voir l'historique
> git pour le triage d'origine et les mesures détaillées.

## Contrat

```python
from cpsat_engine import solve
solutions = solve(raw, config)   # raw: RawScheduleData ; config: sous-ensemble de SchedulerConfig
```

- **Entrée** `RawScheduleData` (`types.ts`) : `{ week, resources, courses, constraints?, groups? }`.
- **Sortie** `list[ScheduleSolutionJSON]` — un seul élément (la meilleure solution) :
  `{ solutions, isComplete, score, provenOptimal, neutralizedTasks? }`.
- **`config`** (tout optionnel) : `lunchBreak` (`{type:'fixed',from,to}` ou `{type:'none'}` ;
  `floating` **non supporté** — feature core-only), `ignoreDailyLimits`, `timeoutSeconds`,
  `excludeTypes` (défaut `['Autonomie']`), `earliest` (défaut `False` — voir plus bas).

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

**Assumé / hors périmètre** (features core-only écartées, décision « chaque moteur pour ce qu'il
est ») : pause flottante ; tâches `Autonomie` (pré-neutralisées en pratique) exclues et rapportées
dans `neutralizedTasks`. Overlays manuels de `weekSaves` (enforced/blocked) non modélisés.

## Lancer le harnais de mesure

Rejoue les semaines 38/39 du projet réel **à travers `solve()`** (adaptateur export → `RawScheduleData`) :

```powershell
cd spikes\cpsat
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
.\.venv\Scripts\python.exe run_stress.py
```

(bash/macOS/Linux : `source .venv/bin/activate`.)

### Résultats (optimum **prouvé** dans les 6 cas, ~1 s chacun)

| Semaine | Pause | Placées / plaçables | Optimum |
|---|---|---|---|
| S38 | aucune / 12:00–13:30 / 12:00–14:00 | **110 / 110** | prouvé |
| S39 | aucune / 12:00–13:30 | **102 / 103** (R3.04 ou R1.04/TD évincé) | prouvé |
| S39 | 12:00–14:00 | **101 / 103** (R1.04 + R1.16/TD) | prouvé |

Parité exacte avec les mesures du spike d'origine. Les `Autonomie` (3/sem.) sont exclues et
comptées comme neutralisées (d'où `isComplete: false` : elles ne sont pas « plaçables »).

## Note sur `earliest`

« Placer le maximum » ne désigne pas UNE solution : plusieurs optima au même compte existent
(question soulevée par le spike jouet). `earliest=True` ajoute un objectif secondaire lexicographique
« démarrer au plus tôt » qui **départage** de façon déterministe — mais transforme un optimum de
placement souvent trivial (0 branche, ~1 s) en une vraie optimisation combinatoire (bien plus lente).
Défaut `False` : on garde la propriété « optimum de placement prouvé rapidement ».

## Prochain jalon

Brancher `solve()` via la **passerelle `scheduler-api`** (subprocess Python, flag `engine`), puis
rendre le panneau de config `scheduler-client` engine-aware. Cf. mémoire `cpsat-second-engine` et
[`../../docs/MoteurCPSAT-Faisabilite.md`](../../docs/MoteurCPSAT-Faisabilite.md).
