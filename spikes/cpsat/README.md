# Spike CP-SAT — cas CM/TD/TP

**Statut : spike d'apprentissage, code jetable.** Isolé du monorepo, aucune
dépendance à `scheduler-*`. But : *mesurer*, pas livrer. Répond à une seule
question **go/no-go** avant de toucher la moindre infra :

> Notre problème s'exprime-t-il proprement dans l'idiome CP-SAT, à quel ordre de
> grandeur de taille/temps, et le vrai moteur c'est une affaire de jours ou de
> semaines ?

## Lancer

```powershell
cd spikes\cpsat
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python solve.py
```

(Sur bash/macOS/Linux : `source .venv/bin/activate` au lieu du `Activate.ps1`.)

## L'instance

Le CM/TD/TP du §5.6 de [`HeuristiquePriorite-Conception.md`](../../docs/HeuristiquePriorite-Conception.md),
enrichi pour exercer les points non triviaux du triage de faisabilité :

- prof `T1` dispo **seulement mercredi 8h–14h** (360 min) — profil « fenêtre tendue » façon THARAUD ;
- 2 salles candidates `{R01, R02}` → **alternatives de ressources** ;
- chaîne de **précédence** `CM → TD → TP` ;
- une 4ᵉ tâche `X` indépendante qui sature `T1`.

Demande sur `T1` = 120 + 90 + 90 + 150 = **450 min** pour **360 min** de capacité :
tout ne rentre pas. L'optimum place **3 tâches sur 4** — c'est ce que l'objectif
`Maximize(Σ scheduled[t])` doit trouver et **prouver**.

## Ce que le spike démontre (le cœur de l'apprentissage)

| Point du triage | Pattern CP-SAT dans `solve.py` |
|---|---|
| Alternatives `ResourceEntry` | intervalle optionnel par (tâche, salle) + `exactly-one` |
| Non-chevauchement ressource | `AddNoOverlap` par ressource |
| Disponibilités | domaine de la variable de début restreint aux fenêtres |
| Précédence + intégrité de chaîne | `start[b] >= start[a] + dur[a]` (conditionné) **+** `scheduled[b] ⇒ scheduled[a]` |
| Placer le maximum | `Maximize(Σ scheduled[t])`, avec preuve d'optimalité |
| `maxDailyMinutes` (le point fiddly) | canal réifié `on_day` — voir `ENABLE_MAX_DAILY` |

## Questions que le spike a mises en lumière

1. **Précédence + tâche lâchée** — *tranché.* Sans garde, le solveur lâchait `TD`
   (le maillon central) et posait `TP` **avant** `CM` : optimal au compte, absurde
   au métier. Décision retenue : **intégrité de chaîne** — un dépendant présent
   exige son prédécesseur présent (`scheduled[b] ⇒ scheduled[a]`, `AddImplication`).
   Lâcher `TD` force désormais à lâcher `TP`. C'est le spike qui a rendu ce choix
   visible avant qu'il ne coûte cher.
2. **Optima multiples** : plusieurs solutions à 3 tâches existent (lâcher `TP` ou
   lâcher `X`). « Placer le maximum » ne désigne pas UNE solution — un objectif
   secondaire (placer au plus tôt, pondérer certaines tâches) serait un vrai choix
   de conception. Écho direct aux expériences de tie-break du moteur actuel.
3. **Coût du `maxDailyMinutes`** : activer `ENABLE_MAX_DAILY` et regarder combien de
   variables booléennes un seul plafond quotidien réclame (canal `on_day` réifié).
   Dans les vraies données, beaucoup de tâches sont déjà épinglées à un jour par
   leur disponibilité → réification inutile pour celles-là, à exploiter.

## Hors périmètre (délibérément)

Pas d'API/HTTP, pas de jobs async, pas de lecture de vrais payloads, **aucune
comparaison automatisée avec `scheduler-core`**, pas de lunch ni d'`enforced`.
Tout ça, c'est l'étape suivante — et seulement si ce spike est concluant.

## Étape 2 — vrai payload (`real_payload.py`)

Charge les données réelles semaine 36 (`packages/scheduler-core/src/json/`),
les traduit en CP-SAT (parsing dispo calqué sur `availabilityManager.ts`,
enforced sur `taskUnit.bookEnforced()`) et mesure. Lancer :

```powershell
.\.venv\Scripts\python.exe real_payload.py
```

**Résultat mesuré** (80 tâches, 2 enforced, 30 slots à alternatives, 42 ressources) :

| Métrique | Valeur |
|---|---|
| Taille modèle | 240 variables, 602 contraintes |
| Statut | `OPTIMAL` — optimum **prouvé** |
| Placées | **80 / 80** |
| Temps | ~200 ms (0 branche : résolu en presolve) |

Le diagnostic de charge confirme que **les contraintes mordent** (pas un modèle
lâche) : `GILLET Anthony` à **100 %** (dispo 90 min pile, cours de 90 min — zéro
slack, profil « THARAUD » qui neutralisait `scheduler-core` sous timeout court),
groupes à 67–75 %. Instance **tendue mais satisfaisable** : l'optimum vrai est
80/80, et CP-SAT place le cas zéro-slack sans même brancher.

**Limite honnête** : cette semaine est satisfaisable (0 branche) — elle valide la
*modélisation* et la *taille/temps*, pas la tenue de CP-SAT sur une instance
sur-souscrite (où il faut vraiment lâcher des tâches et brancher).

## Étape 3 — stress sur le vrai projet + pause fixe (`stress.py`)

Données : `packages/scheduler-core/data/BUT MMI 2026-2027_*.json` (export réel).
Semaines **38** (113 cours) et **39** (106 cours), chacune avec une **pause
méridienne fixe** — calquée sur `scheduler.ts _applyLunchBreak` (retirée de la dispo
des seules ressources GROUP, lun-ven). Overlays manuels de `weekSaves` non chargés.

```powershell
.\.venv\Scripts\python.exe stress.py
```

Modélise : dispos, ressources alternatives, pause fixe, **dépendances CM→TD→TP**
(précédence par code + intégrité de chaîne, calqué sur
`schedulerData._determineDependencies`), **plafonds quotidiens** `maxDailyMinutes`
(réplique de `scheduler._dailyLimitAllows`, réification par jour) et **groupes de
tâches** (`weekSaves.taskGroups` — parallèle : départs égaux ; séquentiel :
enchaînement sans gap ; tout-ou-rien). Les tâches `Autonomie` (pré-neutralisées en
pratique) sont **écartées**. Autres overlays `weekSaves` (enforced/blocked) non chargés.

**Résultats mesurés** (S38 : 110 cours, ~2376 vars / 4983 contraintes, 39 dépendances,
11 ressources à plafond, 7 taskGroups ; S39 : 103 cours, 36 dépendances, 7 taskGroups) :

| Semaine | Pause | Placées | Statut | Temps | Branches |
|---|---|---|---|---|---|
| S38 | 12:00–13:30 | **110/110** | OPTIMAL prouvé | ~0,9 s | 0 |
| S38 | 12:00–14:00 | **110/110** | OPTIMAL prouvé | ~1,0 s | 0 |
| S39 | 12:00–13:30 | **102/103** | OPTIMAL prouvé | ~0,8 s | 0 |
| S39 | 12:00–14:00 | **101/103** | OPTIMAL prouvé | ~1,2 s | 0 |

**Findings** :
- **S38 entièrement plaçable** (110/110) sous les deux pauses : les 39 précédences
  CM→TD→TP ne forcent aucun lâché.
- **Le gradient de pause reste visible en S39** : pause plus large ⇒ 1→2 lâchés, des
  **vrais TD** (`R1.04/TD`, puis `R1.16/TD`) évincés par contention/pause. `R1.04` est
  justement le cours de l'exemple de dépendances du §5.6.
- **Plafonds quotidiens modélisés mais non-mordants sur S38/S39** : résultat identique
  avec/sans (le planning optimal respecte déjà 480/450/120). Vérifié non-trivial par
  contrôle : serrés à 180 min/j, le placement s'effondre à 55/52 → la contrainte mord
  bien, elle n'est simplement pas saturée ici.
- **Groupes parallèle & séquentiel validés** : les 7 taskGroups/semaine (tout-ou-rien)
  sont modélisés et **vérifiés dans la solution** (départs égaux / enchaînement sans
  gap — ex. séquentiel `R3.12/TP 08:00–10:00 → 10:00–12:00`). Ils décalent le choix de
  l'optimum (le TD lâché en S39 change) sans coût de résolution notable.
- **CP-SAT tient sans effort** : optimum *prouvé* dans les 4 cas, ~1 s, 0 branche —
  même en ajoutant précédences, intégrité de chaîne, réification des plafonds et groupes.

## Prochain jalon

Au choix : (1) rejouer le **même payload sur `scheduler-core`** pour la comparaison
directe « lequel place le plus » (l'objectif premier) ; (2) construire une instance
**sur-souscrite** pour stresser le solveur. Puis seulement statuer sur l'intégration
(passerelle `scheduler-api`, cf. [`MoteurCPSAT-Faisabilite.md`](../../docs/MoteurCPSAT-Faisabilite.md)).
