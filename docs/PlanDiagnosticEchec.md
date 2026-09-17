# Plan d'implémentation — expliquer les échecs de placement

## STATUT

Rédigé par Opus le 2026-09-17. **Non implémenté.** Origine : GEA 87 semaine 40, où 5 cours
ressortent non placés avec un message identique et sans information exploitable.

Branche dédiée : `feature/diagnostic-echec`. Jamais sur `master`.

---

## 1. Objectif

Trois manques, constatés sur un cas réel (GEA 87 S40, 195 cours dont 85 imposés) :

1. **Avant le run**, l'alerte « Cours impossibles à placer » ne signale **rien** sur cette semaine,
   alors que le CM `R3.01` (240 min, 10 groupes, `AMPHI B`) n'a **aucun** créneau possible. Elle
   raisonne ressource par ressource sur la seule disponibilité déclarée ; l'infaisabilité vient de
   leur **intersection**, une fois retirés les cours déjà imposés.
2. **Après le run**, les 5 cours non placés portent tous la même phrase — « Non plaçable : évincée
   par contention/dépendance (optimum CP-SAT) » — alors qu'ils relèvent de trois situations
   distinctes (infaisable, entraîné par dépendance, évincé par contention).
3. **Dans la sidebar**, les cours neutralisés par l'utilisateur et ceux que le moteur n'a pas pu
   placer sont mélangés sous « Non placés », ce qui contredit visuellement le compteur du moteur.

### 1.1 Le cas de référence, à garder sous la main

- `R3.01 CM` — seul cours infaisable de la semaine. Dernier créneau survivant : jeudi 08h30–12h30,
  occupé en `AMPHI B` par l'imposé `R3.GEMA.14 CM` (jeudi 08h30–10h30).
- `R3.01 TD` ×3 — entraînés par `AddImplication(scheduled[dep], scheduled[pre])`.
- `R5.GCFF.10 TP` — réellement évincé par contention (27 créneaux candidats).
- Déplacer le seul imposé `R3.GEMA.14` hors du jeudi matin fait passer le résultat de **190 à
  194 cours placés** (vérifié).
- Dans l'onglet « Contraintes » actuel, `R3.01 CM` est classé **🟠 Tendu à 65 %**, au milieu de
  **79 autres « Tendu »**, avec exactement le même score que `R5.01 CM` qui, lui, est plaçable.

## 2. Non-objectifs

- **Ne pas** chercher à reproduire le « ❌ Aucune solution trouvée » signalé initialement : il n'est
  pas reproductible sur les données exportées (190/195, `provenOptimal`, ~9 s, stable sur 3 runs et
  6 variantes de config). Le §5 traite le cas `INFEASIBLE`/`UNKNOWN` parce qu'il est mal rapporté,
  pas parce qu'on l'a observé.
- **Ne pas** toucher au modèle CP-SAT ni aux préférences douces. Aucun changement ne doit modifier
  un seul placement. C'est l'invariant central de ce chantier.
- **Ne pas** créer de nouvel écran. Les deux points d'affichage existent déjà
  (`UnschedulableCoursesDialog`, section « Non placés » de `SidebarAnalysis`).
- **Ne pas** rendre l'analyse de tension (`fillRatio`) plus juste. Elle reste ce qu'elle est ; on
  ajoute un niveau au-dessus.

---

## 3. Le calcul partagé — faisabilité exacte d'un cours

C'est le cœur du chantier : les volets §4 et §5.1 en dépendent tous les deux.

### 3.1 L'algorithme

Pour un cours `C` de durée `d`, dans l'état courant du calendrier :

1. Pour chaque **entrée de ressource** de `C` (enseignant, groupes, salles — une entrée peut être
   un id fixe ou une liste d'alternatives) :
   - fenêtres = disponibilité de la ressource pour la semaine, **moins la pause méridienne
     — uniquement si la ressource est un GROUPE**, et **moins l'occupation par les cours imposés**
     portant cette ressource ;

     ⚠️ Le carving de la pause sur les seuls groupes n'est pas un détail : `_make_availability`
     (`cpsat_engine.py:262`) l'applique sous `if rid in group_ids`, pas aux enseignants ni aux
     salles. Carver partout côté client donnerait un verdict plus pessimiste que le moteur, donc
     des cours signalés « impossibles » que le moteur place sans difficulté.
   - pour une entrée à alternatives, **union** des ensembles de débuts des alternatives ;
   - ensemble des débuts possibles = multiples de 30 min (`GRID_MINUTES`) tels que `[t, t+d]` tient
     dans une fenêtre libre.
2. Intersection de tous ces ensembles. Vide ⇒ le cours est **infaisable dans l'état actuel**.

### 3.2 Désigner la ressource responsable — méthode imposée

**Ne pas** désigner la ressource qui vide l'ensemble au fil de l'intersection : le résultat dépend
de l'ordre de parcours, donc il est arbitraire.

**Méthode retenue** : quand l'intersection est vide, refaire le calcul en **retirant chaque entrée
une par une**. Toute entrée dont le retrait rend le cours plaçable est un **levier réel**. Vérifié
sur le cas de référence : sur les 12 entrées du `R3.01 CM`, une seule est désignée — `AMPHI B` —
et c'est bien la bonne (le déplacement de l'imposé qui l'occupe débloque 4 cours).

Coût : `N+1` intersections au lieu d'une, uniquement sur les cours infaisables (1 sur 110 ici).

Trois cas à gérer explicitement :

| cas | message |
|---|---|
| exactement un levier | « sans *X*, le cours redeviendrait plaçable (créneau : …) » |
| plusieurs leviers | les lister tous — c'est une bonne nouvelle, l'utilisateur choisit |
| **aucun levier** | aucune ressource ne suffit seule ⇒ ne désigner personne. Replier sur le nombre de créneaux restants par entrée, sans coupable. **Ce cas doit être testé** : c'est celui où un message trop affirmatif mentirait. |

### 3.3 La duplication TS / Python — assumée, et verrouillée

Ce calcul doit tourner **côté client en TypeScript** (avant le run, recalculé à chaque
glisser-déposer : impossible de passer par une API) **et côté moteur en Python** (après le run,
pour renseigner les motifs). Deux implémentations, donc.

C'est le principal risque architectural du plan. Il est accepté plutôt que :
- faire appeler le moteur par le client à chaque interaction (latence, et le moteur n'est pas
  disponible en préparation) ;
- faire calculer le client après le run (il n'a pas le graphe de dépendances du moteur).

**Verrou obligatoire** : une fixture JSON commune, versionnée dans `docs/fixtures/`, extraite de la
S40 (le `R3.01 CM` + ses ressources + les imposés qui le bloquent), avec le résultat attendu. Un
test de chaque côté la consomme. Si les deux implémentations divergent, un des deux tests casse.

Sources de divergence à surveiller nommément :
- **le carving de la pause méridienne** — groupes seulement (§3.1). C'est la divergence la plus
  probable, parce qu'elle est contre-intuitive ;
- **l'arrondi sur la grille de 30 min** ;
- **une entrée de contrainte présente mais au tableau vide**. À distinguer d'une ressource absente :
  `VILKAS Catherine` a `default: []` *et* un override `S40`, donc aucune disponibilité hors des
  semaines surchargées. Le moteur traite le tableau vide comme « aucune fenêtre »
  (`cpsat_engine.py:252`) et `courseFeasibilityAnalysis` fait déjà pareil ; mais
  `taskConstraintAnalysis.getEntryAvailability` fait l'inverse — il traite une dispo vide comme
  « non contrainte, aucune restriction ». Ne pas reprendre cette convention-là dans le nouveau
  niveau.

### 3.3.1 Héritage de `Default` — acquis, et à afficher

L'héritage est **déjà correct des deux côtés** et n'est pas une question ouverte :
`AvailabilityManager.getAvailability` (`availabilityManager.ts:155`) retombe sur `Default` quand la
ressource n'a pas d'entrée propre, exactement comme `base_windows` côté moteur
(`cpsat_engine.py:246`). Il n'y a rien à corriger — seulement à ne pas casser.

Ce qui manque est **l'affichage**. Sur la S40, **79 des ressources citées n'ont aucune contrainte
spécifique** : quand le diagnostic nomme l'une d'elles comme bloquante, l'utilisateur va chercher
une contrainte qui n'existe pas. Le calcul doit donc remonter, pour chaque ressource citée, si elle
a une entrée propre, et le message ajouter dans le cas contraire :

> *Pas de contrainte spécifique, hérite des contraintes par Défaut.*

C'est une information par ressource nommée, pas un niveau de diagnostic séparé.

### 3.4 Où le code atterrit

- TS : `packages/scheduler-client/lib/courseFeasibilityAnalysis.ts`, en **second niveau** à côté de
  `getCourseUnschedulableReasons` (qui reste — il capte le cas « cette ressource seule n'a jamais
  assez de place », que le nouveau niveau ne remplace pas).
- Python : `packages/scheduler-cpsat/cpsat_engine.py`, fonction privée appelée uniquement dans la
  phase de rapport, **jamais** dans la construction du modèle.

Rien dans `scheduler-common` au-delà des types du contrat (§5.2) : la règle d'archi tient.

---

## 4. Volet A — l'onglet « Attention »

`SidebarPreparation.tsx`, `CourseConstraintList.tsx`, `taskConstraintAnalysis.ts`.

### 4.1 Renommage et nouveau niveau

- Onglet `Contraintes` → **`Attention`**.
- `ConstraintLevel` passe de `'critical' | 'tight' | 'ok'` à
  `'impossible' | 'critical' | 'tight' | 'ok'`, `impossible` en tête de `LEVEL_CONFIG` et de
  l'ordre d'affichage.
- Un cours `impossible` n'apparaît **qu'une fois**, dans cette section, quel que soit son
  `fillRatio`. C'est le cas général et non l'exception : `R3.01 CM` est `🟠 Tendu` par `fillRatio`
  et pourtant infaisable — les deux échelles ne mesurent pas la même chose.

### 4.2 Section `🟢 OK` repliée par défaut

Sinon le nom « Attention » coiffe 116 cours sans problème et perd tout sens. Compteur visible,
contenu fermé, dépliable.

### 4.3 Sous-titre

`Seulement basée sur les disponibilités des enseignants` reste vrai pour Tendu/Critique mais est
faux pour `impossible`. Deux phrases, une par niveau, placées au bon endroit — pas une phrase
globale qui mentirait sur la moitié de la liste.

### 4.4 Badge de l'onglet

Aujourd'hui `⚠` orange sur `hasOverload || critical`. Il était **déjà allumé** sur la S40 (79
« Tendu ») et n'apprenait donc rien. Ajouter un marqueur distinct `⛔` rouge, prioritaire, quand au
moins un cours est `impossible`.

### 4.5 La popup automatique

`UnschedulableCoursesDialog` est conservée — un onglet non ouvert ne prévient personne — mais
réduite à un **résumé + bouton « Voir dans Attention »**, pour ne pas maintenir deux rendus du même
contenu. Elle se déclenche sur `impossible` en plus de ses cas actuels.

### 4.6 Recalcul

Le niveau `impossible` dépend des impositions : il doit se recalculer au glisser-déposer,
contrairement au `fillRatio`. Le `useMemo` de `app/planning/page.tsx:95` dépend déjà de
`enforcedMap` — vérifier que la dépendance suffit, et **mesurer** (§8.4) : le coût n'a été constaté
qu'en Python hors navigateur, jamais en TS avec re-render React.

Risque annexe à vérifier pendant cette mesure : `AvailabilityManager.getAvailability` émet un
`console.warn` à **chaque** appel pour une ressource héritant de `Default`
(`availabilityManager.ts:155`). Elles sont 79 sur la S40 ; multiplié par 110 cours et par un
recalcul à chaque glisser-déposer, la console peut devenir inutilisable. Si c'est le cas, le
signalement doit être dédupliqué par ressource — pas supprimé.

---

## 5. Volet B — les motifs renvoyés par le moteur

### 5.1 Qualifier chaque cours non placé

Dans la phase de rapport de `solve()` (`cpsat_engine.py`, boucle sur `dropped`), remplacer le motif
unique par trois cas, dans cet ordre de priorité :

| ordre | test | slug | message |
|---|---|---|---|
| 1 | §3 dit infaisable | `no-slot` | « Aucun créneau possible : le dernier (jeudi 08h30–12h30) est pris par R3.GEMA.14 CM (imposé) en AMPHI B. » |
| 2 | prérequis non placé dans `_determine_dependencies` | `dependency` | « Non placé parce que son prérequis R3.01 CM ne l'est pas. » |
| 3 | sinon | `contention` | « Plaçable en soi (27 créneaux candidats), mais le placer en coûterait un autre. » |

Le cas 2 est gratuit : le graphe est déjà construit par le moteur, il est simplement jeté.
Le cas 3 n'affirme rien qu'on n'ait vérifié — il annonce un nombre de créneaux, pas une cause.

### 5.2 Remonter le slug dans le contrat

`NeutralizedTaskInfoJSON` (`scheduler-common/src/types.ts`) ne transporte aujourd'hui que
`reason: string`. Le slug est calculé côté moteur (`_neutralized(... reason_slug ...)`) puis
**jeté**. L'ajouter :

```ts
interface NeutralizedTaskInfoJSON {
  task: TaskSolutionJSON;
  reason: string;                    // inchangé — texte affichable, compat ascendante
  reasonSlug?: 'no-slot' | 'dependency' | 'contention' | 'excluded-type' | 'no-solution';
}
```

Optionnel ⇒ aucune migration. Le volet C en a besoin de toute façon (§6.2), ce qui rend l'ajout
utile même si le §5.1 était reporté.

### 5.3 Distinguer `INFEASIBLE` de `UNKNOWN`

`_empty_solution` (`cpsat_engine.py:1219`) confond aujourd'hui deux situations opposées :
contradiction prouvée d'un côté, budget épuisé de l'autre. « Augmentez le temps de calcul » n'a de
sens que dans le second cas. Deux messages distincts, et remonter le statut brut dans la réponse.

Rappel utile pour calibrer l'effort : sur la S40, `INFEASIBLE` est structurellement inatteignable —
seuls les imposés ont `scheduled == 1` forcé, ils sont exemptés de grille et de `maxDailyMinutes`,
il n'y a aucun groupe de tâches, et deux imposés en conflit lèvent `EnforcedConflictError` avec un
message déjà explicite. Le cas réellement atteignable est `UNKNOWN`.

### 5.4 MUS par hypothèses — sur un vrai `INFEASIBLE`

Réifier les contraintes de chaque cours imposé sur un littéral d'hypothèse
(`model.AddAssumption`) et, sur `INFEASIBLE`, appeler
`solver.SufficientAssumptionsForInfeasibility()` (disponible dans l'ortools 9.15 du venv) pour
obtenir le **sous-ensemble minimal d'impositions en cause**, au lieu de neutraliser les 195 cours
avec un message identique.

Contrainte technique : impose `num_search_workers=1` sur cette passe. Acceptable — elle ne tourne
qu'en cas d'échec, jamais sur le chemin nominal.

**Découpable.** Si le chantier déborde, §5.4 saute sans rien casser du reste.

### 5.5 Le niveau « contention » détaillé — hors périmètre initial

Relancer un mini-solve en forçant `scheduled == 1` sur un cours pour dire **au prix de quels
autres** il serait plaçable. Coût non mesuré, et nécessite une route API dédiée. À mettre derrière
un bouton « Pourquoi ? », dans un second chantier. Le §5.1 cas 3 donne déjà l'essentiel sans ça.

---

## 6. Volet C — sections NEUTRALISÉS / NON PLACÉS

`SidebarAnalysis.tsx`, `store/usePlanningStore.ts`.

### 6.1 Deux sections

| origine | section | sens |
|---|---|---|
| `user-pre` | **NEUTRALISÉS** | écarté avant le run |
| `user-post` | **NEUTRALISÉS** | retiré du calendrier après un run |
| `engine` | **NON PLACÉS** | le moteur n'a pas pu |

Cette frontière n'est pas inventée ici : `runSchedule` (`usePlanningStore.ts:509`) exclut déjà
`user-pre` **et** `user-post` du prochain envoi au moteur et réenvoie les `engine`. On rend visible
une règle que le code applique déjà.

Les deux sections restent des sources de glisser-déposer. Badge propre à chacune.

### 6.2 Le piège des types exclus

Les cours de type `Autonomie` reviennent dans `neutralizedTasks` avec le motif « Type « Autonomie »
exclu du moteur CP-SAT (pré-neutralisé) » (`cpsat_engine.py:1198`), donc avec `origin: 'engine'`.
Un routage naïf `engine → NON PLACÉS` les y rangerait alors qu'ils n'ont **jamais été soumis** — le
même défaut de lisibilité, simplement déplacé.

Router sur `reasonSlug === 'excluded-type'` (§5.2) vers **NEUTRALISÉS**.

Aucune `Autonomie` dans GEA 87 (0 sur 2320 cours) : **le cas ne se teste que sur MMI ou sur une
fixture dédiée.** Ne pas conclure « ça marche » depuis GEA 87.

### 6.3 Le compteur du cas « zéro placé »

`applyPendingResult` additionne `userPre.length` aux `neutralizedTasks` du moteur dans le message
« N cours neutralisé(s) » quand aucun cours n'est placé. C'est exactement le mélange qu'on
supprime ailleurs — à corriger dans le même mouvement, sinon l'incohérence est juste déplacée.

### 6.4 `isComplete` — tranché : complet au regard des données soumises

**Décision Frédéric, 2026-09-17** : le moteur rend un résultat complet au regard des données qui
lui ont été fournies ; les tâches neutralisées n'en font pas partie.

```python
"isComplete": len(dropped) == 0,          # au lieu de : len(dropped) == 0 and len(excluded) == 0
```

`isComplete` n'a qu'un seul consommateur — `buildScheduleStatus` (`scheduleApi.ts:107-112`), pour
le libellé et le `kind`. Le changement est donc circonscrit.

**Mais il ne suffit pas seul.** `neutralizedMsg` compte `best.neutralizedTasks.length`, qui inclut
les types exclus : on obtiendrait `✅ Planification complète — 3 cours non placé(s)`, une phrase
qui se contredit. Le compteur du message doit lui aussi exclure les `reasonSlug === 'excluded-type'`.

C'est la même règle que §6.1, §6.2 et §6.3, et il faut l'écrire une fois pour toutes :

> **Ce que l'utilisateur a écarté — avant le run, après le run, ou par type exclu du moteur — n'est
> jamais un échec du moteur.** Ça vaut pour les sections de la sidebar, pour le compteur du message
> de statut, et pour `isComplete`.

Les quatre sous-volets du §6 appliquent cette phrase à quatre endroits différents. S'ils divergent,
l'incohérence se déplace au lieu de disparaître.

---

## 7. CHECKPOINT feu-vert — s'arrêter ici

À l'issue de l'implémentation (§3 à §6), **arrêt complet**. Aucun test au-delà du typecheck, aucune
mesure, aucune conclusion écrite. Rapporter les faits bruts :

- `npm run typecheck --workspaces` propre ;
- liste des fichiers touchés, écarts au plan compris ;
- pour chaque point laissé en suspens, ce qui a été fait et pourquoi.

Plus aucune décision n'est en attente : §3.3 et §6.4 ont été tranchés par Frédéric le 2026-09-17.

Rappel de la règle : l'exécutant rapporte des faits, jamais « vérifié / validé / corrigé ». Les
conclusions sont écrites au retour par le relecteur.

---

## 8. Validation — après feu vert seulement

Dimensionnée sur ce que le changement peut affecter. Il ne touche **aucun placement** : pas de
campagne de non-régression moteur.

### 8.1 Non-régression automatisée
- `npm test --workspace=packages/scheduler-client`. **Attendu : 9 échecs préexistants sous Node 25**
  (`storage.setItem is not a function` dans `SchedulerConfigDialog`, 3 dates `icalExport`). Ne
  jamais les imputer à ce chantier ; vérifier par worktree en cas de doute.
- `pytest` dans `packages/scheduler-cpsat`.

### 8.2 Tests ciblés à écrire
- **Fixture partagée §3.3**, consommée des deux côtés : même verdict, même levier désigné.
- Méthode B, cas « aucun levier » (§3.2) — celui où un message affirmatif mentirait.
- Routage des trois origines vers les deux sections (§6.1), **plus** le cas `excluded-type`
  (§6.2) sur fixture dédiée, puisque GEA 87 ne le contient pas.
- Un cours `impossible` au `fillRatio` `ok`/`tight` n'apparaît qu'une fois, en tête (§4.1).
- §6.4 : un résultat où seuls des types exclus manquent donne `isComplete: true` **et** un message
  sans « N cours non placé(s) ». Les deux dans le même test — c'est leur incohérence qu'on prévient.
- §3.1 : la pause méridienne ne réduit pas les fenêtres d'un enseignant ni d'une salle. Un test
  direct, sinon la divergence passe inaperçue jusqu'au premier faux « impossible ».
- §3.3.1 : une ressource sans entrée propre est diagnostiquée sur les créneaux de `Default` et
  porte la mention d'héritage.

### 8.3 Invariant à vérifier explicitement
Sur la S40 réelle, **avant / après le chantier, à config identique : 190 placés, 5 non placés, mêmes
identifiants de cours.** À mesurer dans un seul run de chaque côté (empreinte avant/après), jamais
par comparaison d'égalité exacte entre deux `solve()` séparés — le solveur est multi-thread et non
déterministe, ce piège a déjà coûté un chantier.

### 8.4 Mesure §4.6
Coût du recalcul `impossible` au glisser-déposer, dans le navigateur, sur la S40 (110 cours non
imposés). Chiffre brut, pas de conclusion.

### 8.5 Passe manuelle (Frédéric)
Sur la S40 du projet réel **ré-exporté** (les snapshots vieillissent) : l'onglet Attention signale
bien `R3.01 CM` en tête ; déplacer `R3.GEMA.14` hors du jeudi matin le fait disparaître et le run
remonte à 194 placés.

---

## 9. Fichiers touchés

| Fichier | Volet |
|---|---|
| `scheduler-client/lib/courseFeasibilityAnalysis.ts` | §3.4 — second niveau |
| `scheduler-client/lib/taskConstraintAnalysis.ts` | §4.1 — niveau `impossible` |
| `scheduler-client/components/planning/courses/CourseConstraintList.tsx` | §4.1, §4.2 |
| `scheduler-client/components/planning/sidebar/SidebarPreparation.tsx` | §4.1, §4.3, §4.4 |
| `scheduler-client/components/planning/modals/UnschedulableCoursesDialog.tsx` | §4.5 |
| `scheduler-client/app/planning/page.tsx` | §4.5, §4.6 |
| `scheduler-client/components/planning/sidebar/SidebarAnalysis.tsx` | §6.1 |
| `scheduler-client/store/usePlanningStore.ts` | §6.2, §6.3 |
| `scheduler-client/lib/calendar/unplaced.ts` | §6.2 — propagation du slug |
| `scheduler-client/lib/api/scheduleApi.ts` | §6.4 — compteur du message de statut |
| `scheduler-common/src/types.ts` | §5.2 — `reasonSlug` |
| `scheduler-cpsat/cpsat_engine.py` | §3.4, §5.1, §5.3, §5.4 |
| `docs/fixtures/` | §3.3 — fixture partagée |

## 10. Ordre d'exécution

1. **§3** — le calcul partagé, des deux côtés, avec sa fixture. Rien d'autre ne marche sans lui.
2. **§5.2** — `reasonSlug` dans le contrat (débloque §5.1 et §6.2).
3. **§6** — les deux sections. Volet le plus court, gain immédiat.
4. **§4** — l'onglet Attention.
5. **§5.1, §5.3** — les motifs qualifiés.
6. **§5.4** — le MUS. Découpable : saute en premier si le chantier déborde.
