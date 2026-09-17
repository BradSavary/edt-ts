"""
Moteur CP-SAT — consolidation du spike en un `solve(RawScheduleData)`.

Réunit les trois scripts d'apprentissage épars (`solve.py` jouet, `real_payload.py`
S36, `stress.py` projet réel) en UNE fonction qui parle le vrai contrat partagé
`@edt-ts/scheduler-common` :

    solve(raw: RawScheduleData, config: SchedulerConfig | None) -> list[ScheduleSolutionJSON]

- `RawScheduleData`   : { week, resources, courses, constraints?, groups? }  (types.ts)
- `ScheduleSolutionJSON` : { solutions, isComplete, score?, neutralizedTasks?, provenOptimal? }

C'est le livrable de la décision « CP-SAT = 2e moteur user-facing » (cf. mémoire
`cpsat-second-engine`) : PAS un oracle de complétude de scheduler-core, mais un moteur
autonome qui maximise le nombre de tâches placées et PROUVE l'optimalité de ce nombre.

Fidélité de modélisation (calquée sur scheduler-common / scheduler-core) :
  - disponibilités            → AvailabilityManager.getAvailability (override hebdo + Default)
  - ressources alternatives   → ResourceEntry `string | string[]` : intervalle optionnel + exactly-one
  - non-chevauchement         → AddNoOverlap par ressource
  - enforced                  → start + ressources fixes imposés, ignore la dispo ET maxDailyMinutes
                                (réplique bookEnforced() — sous la responsabilité de l'utilisateur)
  - dépendances CM→TD→TP      → SchedulerData._determineDependencies (par code + inclusion des groupes)
                                + intégrité de chaîne (un dépendant placé exige son prérequis placé)
  - taskGroups                → RawScheduleData.groups + CourseTaskData.taskGroupId
                                (parallel : départs égaux ; sequential : enchaînement sans gap)
  - maxDailyMinutes           → plafond quotidien par ressource (réification on_day) — hors enforced
  - pause méridienne fixe     → scheduler.ts _applyLunchBreak (retirée des seuls GROUP, lun-ven)
  - grille horaire            → début sur un multiple de GRID_MINUTES (30) — cours imposés exemptés
  - préférences douces prof   → hiérarchie à placement fixé, dans cet ordre : moins de jours
                                (minimizeTeacherDays, passe 2) → réduction des demi-journées
                                sous-utilisées (reduceTeacherHalfDays, passe 3) → compacité par
                                jour (compactTeacherDay, passe 4)

Assumé / hors périmètre (features core-only, écartées pour ce moteur) :
  - pause FLOTTANTE (modélise mal en CP-SAT figé) — seul 'fixed' est honoré ;
  - tâches `Autonomie` (pré-neutralisées en pratique) — exclues et rapportées comme neutralisées.
"""

from __future__ import annotations

import re
import sys
import time
from collections import defaultdict
from typing import Any

from ortools.sat.python import cp_model

HORIZON = 7 * 1440  # minutes depuis lundi 00:00, une semaine

# Pas de la grille horaire : un cours ne peut commencer que sur un multiple de cette valeur.
# Sans grille, `start` est un entier libre à la minute et le moteur produit occasionnellement des
# créneaux inexploitables (13h31, 15h01, 17h01 — constaté sur le vrai projet le 2026-09-12, de 1 à
# 5 cours par semaine), simplement parce qu'il est indifférent et choisit une valeur arbitraire.
# En dur plutôt que configurable : la seule granularité utile constatée est la demi-heure, et c'est
# déjà celle du calendrier (slotDuration) comme du sélecteur d'horaires des contraintes.
GRID_MINUTES = 30

# Types de ressources — mêmes chaînes que ResourceType (resource.ts).
TEACHER, ROOM, GROUP = "teacher", "room", "group"

# En dessous de ce budget, une passe ne peut rien produire d'utile : elle est SAUTÉE (et tracée
# sur stderr) plutôt que lancée sur un reliquat. L'ancien `max(1.0, ...)` la lançait quand même,
# avec 1 s au compteur : elle rendait UNKNOWN et l'option demandée restait sans effet, en silence.
MIN_PASS_SECONDS = 0.5

# Charge (minutes) en dessous ou égale à laquelle une demi-journée est considérée SOUS-UTILISÉE par
# `reduceTeacherHalfDays` (passe 3) — cible à reporter ailleurs. Correspond le plus souvent à un
# unique cours isolé sur la demi-journée. Réglable.
HALF_DAY_UNDERUSED_THRESHOLD = 120

# Poids de l'idle intra-bloc (compactTeacherDay, Option A) relatif au trou de midi (Option D, poids
# 1 implicite). DOIT être > 1. Sans ça, rapprocher le PREMIER cours de l'après-midi de la pause de
# Δ minutes, sans bouger les cours suivants, réduit le trou de midi d'EXACTEMENT Δ (Option D) tout
# en créant un trou intra-bloc d'EXACTEMENT Δ entre ce cours et le suivant (Option A) — un échange
# strictement à somme nulle sur `sum(penalty_terms)`. Le solveur est alors indifférent entre
# resserrer en créant un trou et ne rien faire, et peut arbitrairement choisir la première option
# (constaté sur le vrai projet, 2026-09-11 : 2 cours d'après-midi, le premier remonté à la pause,
# le second laissé sur place, trou créé entre eux). Un poids strictement supérieur à 1 sur l'idle
# intra-bloc rend cet échange perdant : resserrer un SEUL cours en créant un trou coûte alors plus
# cher que ce qu'il fait gagner, donc n'est plus jamais préféré à ne rien faire. Ne coûte rien à la
# vraie compaction (déplacer TOUT le bloc ensemble vers la pause reste à idle intra-bloc constant,
# donc toujours gagnant).
COMPACT_DAY_IDLE_WEIGHT = 2

# Fraction de `timeoutSeconds` (le TOTAL, pas le restant) réservée PAR PASSE ACTIVE EN AVAL, avant
# d'allouer le reste à la passe courante. Sans ce plafond, une passe qui ne converge jamais (constaté
# sur l'ex-passe équilibrage, retirée depuis — cf. mémoire — sur un vrai projet chargé) engloutit
# tout le timeout quelle que soit sa générosité — constaté : 360 minutes n'ont pas suffi pour libérer
# la moindre seconde à la passe suivante. Une FRACTION du total (pas une constante absolue en
# secondes) pour rester cohérent aussi bien avec les timeouts courts des tests (10s) qu'avec des
# timeouts réels de plusieurs centaines de secondes.
# Valeur de départ modeste et réglable : garantit que chaque passe active s'exécute au moins une
# fois (même en dégradé), pas qu'elle converge.
#
# Portée à 0.10 le 2026-09-13 : la passe 4 n'obtenait que 9 s sur un timeout de 180 s, alors que son
# profil mesuré la voit converger vers 10-20 s (objectif 43538 -> 30 entre 2 s et 10 s sur S39, et
# OPTIMAL dès 20 s). S'applique aux réserves faites pour les passes 3 et 4 ; la passe 5 a son
# propre forfait (voir PASS5_RESERVE_SECONDS).
DOWNSTREAM_RESERVE_FRACTION = 0.10

# Réserve FORFAITAIRE (secondes) pour la passe 5, au lieu d'une fraction du timeout.
# La passe 5 travaille à placement GELÉ : il ne lui reste qu'un problème d'affectation de salles,
# polynomial, mesuré à 0,05-0,07 s sur le vrai projet quelle que soit la taille de la semaine. Lui
# réserver un pourcentage du timeout revenait à immobiliser 9 s sur 180 pour un besoin ~100x moindre,
# au détriment de la passe 4. Son budget est aussi PLAFONNÉ à cette valeur : contrairement aux autres
# passes, elle n'a aucun usage d'un reliquat, et le lui laisser ne ferait que retarder la réponse.
PASS5_RESERVE_SECONDS = 3.0


def _remaining(deadline: float) -> float:
    """Secondes restantes avant l'échéance globale de `solve()`."""
    return deadline - time.monotonic()


def _pass_budget(deadline: float, label: str, reserve: float = 0.0) -> float:
    """
    Budget allouable à une passe, ou 0.0 (+ diagnostic stderr) s'il ne reste plus rien.

    Se calcule contre l'échéance ABSOLUE de `solve()`, jamais contre le `WallTime()` du solveur
    précédent : ce dernier ne connaît que la durée de SA passe, si bien que retrancher sa valeur
    re-crédite le temps consommé par toutes les passes d'avant (jusqu'à ~2x `timeoutSeconds` au
    total, alors que la passerelle Node tue le process à `timeoutSeconds + 5`).

    `reserve` : secondes à NE PAS allouer à cette passe, gardées pour les passes actives en aval
    (voir `DOWNSTREAM_RESERVE_FRACTION`). La valeur retournée est directement utilisable comme
    `max_time_in_seconds` du solveur de cette passe — pas besoin de recalculer `_remaining(deadline)`
    séparément (piège : les deux calculs divergeraient si le budget ci-dessous plafonne à `reserve`
    près, alors que `_remaining` seul ignorerait la réserve).
    """
    budget = _remaining(deadline) - reserve
    if budget < MIN_PASS_SECONDS:
        print(f"[cpsat] {label} : sautée, budget épuisé "
              f"({budget:.1f}s restantes, {reserve:.1f}s réservées en aval).", file=sys.stderr)
        return 0.0
    return budget


def _log_pass_timing(label: str, solver: cp_model.CpSolver, status: int, budget: float) -> None:
    """
    Trace, pour une passe qui a tourné, le temps RÉELLEMENT consommé face à son budget alloué —
    diagnostic dev pour savoir quelles passes convergent (`WallTime` << budget) et lesquelles
    engloutissent tout leur budget sans jamais prouver l'optimum (`WallTime` ≈ budget, statut
    FEASIBLE plutôt qu'OPTIMAL). Toujours actif (stderr uniquement, jamais renvoyé au client) —
    ce projet n'a pas d'environnement de production distinct de `npm run api:dev`.
    """
    ratio = (solver.WallTime() / budget * 100) if budget > 0 else 0.0
    print(f"[cpsat] {label} : {solver.WallTime():.2f}s / {budget:.2f}s budget "
          f"({ratio:.0f}%) — statut={solver.StatusName(status)}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Parsing des disponibilités — calqué sur availabilityManager.ts.
# ---------------------------------------------------------------------------
FR_DAY = {"lundi": 0, "mardi": 1, "mercredi": 2, "jeudi": 3, "jeeudi": 3,
          "vendredi": 4, "samedi": 5, "dimanche": 6}


def _parse_days(s: str) -> list[int]:
    return [FR_DAY[t] for t in re.split(r"[,\s]+", s.strip().lower()) if t in FR_DAY]


def _parse_time(t: str) -> int:
    p = str(t).split(":")
    return int(p[0]) * 60 + (int(p[1]) if len(p) > 1 and p[1] else 0)


def _slots_to_windows(slots: list[dict] | None) -> list[tuple[int, int]]:
    w = []
    for slot in slots or []:
        for d in _parse_days(slot["days"]):
            s, e = d * 1440 + _parse_time(slot["from"]), d * 1440 + _parse_time(slot["to"])
            if e > s:
                w.append((s, e))
    return w


def _intersect(a, b):
    out = []
    for a0, a1 in a:
        for b0, b1 in b:
            lo, hi = max(a0, b0), min(a1, b1)
            if lo < hi:
                out.append((lo, hi))
    return out


def _carve_lunch(windows, lunch):
    """Retire [from,to] de chaque jour lun-ven — réplique scheduler._applyLunchBreak."""
    if lunch is None:
        return windows
    f, t = lunch
    out = []
    for s, e in windows:
        day = s // 1440
        if day <= 4:
            lf, lt = day * 1440 + f, day * 1440 + t
            if lt <= s or lf >= e:
                out.append((s, e))
            else:
                if s < lf:
                    out.append((s, lf))
                if lt < e:
                    out.append((lt, e))
        else:
            out.append((s, e))
    return out


def _residual_break(busy: list[tuple[int, int]], l0: int, l1: int) -> tuple[int, int]:
    """Plus grand sous-intervalle contigu de [l0,l1] libre des intervalles `busy`.

    `busy` et le retour sont en minutes DEPUIS MINUIT du jour considéré. Retourne (l0,l0)
    — longueur nulle — si la fenêtre est entièrement occupée. Sert à définir la pause
    méridienne RÉELLEMENT disponible d'un (enseignant, jour) quand un cours enforced
    empiète dessus : la pause est écourtée, pas supprimée.
    """
    clipped = sorted((max(s, l0), min(e, l1)) for s, e in busy if s < l1 and e > l0)
    best, cur = (l0, l0), l0
    for s, e in clipped:
        if s - cur > best[1] - best[0]:
            best = (cur, s)
        cur = max(cur, e)
    if l1 - cur > best[1] - best[0]:
        best = (cur, l1)
    return best


def _start_domain(windows, dur):
    """Débuts valides d'une tâche de durée `dur` : [s, e-dur] par fenêtre (vide si aucune)."""
    ivs = [[s, e - dur] for (s, e) in windows if e - dur >= s]
    return cp_model.Domain.FromIntervals(ivs) if ivs else cp_model.Domain(1, 0)


# ---------------------------------------------------------------------------
# Résolution des disponibilités — réplique AvailabilityManager.getAvailability.
# ---------------------------------------------------------------------------
def _make_availability(constraints: dict, week: int, group_ids: set[str], lunch):
    """Retourne rwin(rid) -> fenêtres (semaine `week`), avec cache et pause sur les GROUP."""
    default_slots = constraints.get("Default") if isinstance(constraints.get("Default"), list) else []
    cache: dict[str, list[tuple[int, int]]] = {}

    def base_windows(rid: str):
        if rid not in constraints:
            return _slots_to_windows(default_slots)              # ressource absente → Default
        c = constraints[rid]
        if c is None:
            return _slots_to_windows(default_slots)              # null → Default
        if isinstance(c, list):
            return _slots_to_windows(c)                          # tableau brut → tel quel
        if isinstance(c, dict):
            wk = c.get(f"S{week}")
            if isinstance(wk, list):
                return _slots_to_windows(wk)                     # override hebdo prioritaire
            base = c["default"] if isinstance(c.get("default"), list) else default_slots
            return _slots_to_windows(base)
        return _slots_to_windows(default_slots)

    def rwin(rid: str):
        if rid not in cache:
            w = base_windows(rid)
            if rid in group_ids:                                 # pause retirée des seuls groupes
                w = _carve_lunch(w, lunch)
            cache[rid] = w
        return cache[rid]

    return rwin


# ---------------------------------------------------------------------------
# Dépendances CM→TD→TP — réplique SchedulerData._determineDependencies.
# ---------------------------------------------------------------------------
def _flatten(entries) -> list[str]:
    out = []
    for e in entries or []:
        out.extend(e) if isinstance(e, list) else out.append(e)
    return out


def _determine_dependencies(courses: list[dict]) -> list[tuple[int, int]]:
    """(dependent_idx, prereq_idx). Un dépendant démarre après son prérequis (même code, groupes ⊆)."""
    by_code = defaultdict(list)
    for i, c in enumerate(courses):
        by_code[c["code"]].append(i)

    def groups_of(i):
        return set(_flatten(courses[i].get("groups", [])))

    def find_dep(i, cands):
        gi = groups_of(i)
        if not gi:
            return None
        for j in cands:                          # 1er candidat dont les groupes ⊇ ceux de i
            if gi <= groups_of(j):
                return j
        return None

    deps = []
    for idxs in by_code.values():
        cm = [i for i in idxs if courses[i]["type"] == "CM"]
        td = [i for i in idxs if courses[i]["type"] == "TD"]
        tp = [i for i in idxs if courses[i]["type"] == "TP"]
        for i in td:
            j = find_dep(i, cm)
            if j is not None:
                deps.append((i, j))
        for i in tp:
            j = find_dep(i, td)
            if j is None:
                j = find_dep(i, cm)              # repli TP→CM si aucun TD ne correspond
            if j is not None:
                deps.append((i, j))
    return deps


# ---------------------------------------------------------------------------
# Identité des tâches — réplique SchedulerData.initTasks (id fourni sinon fallback).
# ---------------------------------------------------------------------------
def _task_id(course: dict, counter: int) -> str:
    if course.get("id") is not None:
        return course["id"]
    teacher_ids = "_".join(_flatten(course.get("teacher", [])))
    group_ids = "_".join(_flatten(course.get("groups", [])))
    return f"{course['code']}_{teacher_ids}_{group_ids}_{counter}"


def _task_json(course: dict, tid: str, week: int, start_time: int, resources: list[dict]) -> dict:
    out = {
        "taskId": tid,
        "code": course.get("code", ""),
        "name": course.get("name", ""),
        "type": course.get("type", ""),
        "week": week,
        "duration": course["duration"],
        "startTime": start_time,
        "resources": resources,
    }
    if course.get("taskGroupId") is not None:
        out["taskGroupId"] = course["taskGroupId"]
    return out


class EnforcedConflictError(ValueError):
    """Deux cours enforced se chevauchent sur une ressource partagée (instance incohérente)."""


def _validate_enforced(courses: list[dict]) -> None:
    """
    Réplique Loader.validateEnforcedCourses : le chemin CP-SAT ne passe pas par le Loader Node,
    donc cette cohérence doit être vérifiée ici — sinon deux enforced en conflit rendent le modèle
    INFEASIBLE et effondrent silencieusement toute la semaine, au lieu d'une erreur ciblée.
    (Les alternatives dans un enforced sont déjà interdites côté client ; on ne revalide que les
    chevauchements, seul cas atteignable via l'UI.)
    """
    enforced = [c for c in courses if c.get("enforced")]
    for i in range(len(enforced)):
        a = enforced[i]
        ea = a["enforced"]
        end_a = ea["startTime"] + a["duration"]
        res_a = set(ea["teacher"]) | set(ea["groups"]) | set(ea["rooms"])
        for j in range(i + 1, len(enforced)):
            b = enforced[j]
            eb = b["enforced"]
            end_b = eb["startTime"] + b["duration"]
            if ea["startTime"] < end_b and end_a > eb["startTime"]:
                shared = res_a & (set(eb["teacher"]) | set(eb["groups"]) | set(eb["rooms"]))
                if shared:
                    raise EnforcedConflictError(
                        f'Conflit entre cours enforced "{a.get("code")}" ({a.get("type")}) et '
                        f'"{b.get("code")}" ({b.get("type")}) : ressource(s) partagée(s) '
                        f'[{", ".join(sorted(shared))}] sur le même créneau.'
                    )


def _candidate_resources(course: dict, rtype_of: dict[str, str]) -> list[dict]:
    """Union (dédupliquée, ordre stable) de toutes les ressources candidates — pour le report neutralisé."""
    seen, out = set(), []
    e = course.get("enforced")
    cats = ([(e["teacher"], TEACHER), (e["groups"], GROUP), (e["rooms"], ROOM)] if e else
            [(course.get("teacher", []), TEACHER),
             (course.get("groups", []), GROUP),
             (course.get("rooms", []), ROOM)])
    for entries, default_type in cats:
        for rid in _flatten(entries):
            if rid not in seen:
                seen.add(rid)
                out.append({"id": rid, "type": rtype_of.get(rid, default_type)})
    return out


# ---------------------------------------------------------------------------
# Diagnostic de faisabilité — §3 de docs/PlanDiagnosticEchec.md.
#
# Jumeau Python de `diagnoseCourseSlots` (scheduler-client/lib/courseFeasibilityAnalysis.ts).
# Les deux implémentations sont verrouillées par la fixture docs/fixtures/feasibility-s40.json :
# si elles divergent, un des deux tests casse. Toute modification ici doit être reportée là-bas.
#
# N'intervient JAMAIS dans la construction du modèle — uniquement dans la phase de rapport.
# ---------------------------------------------------------------------------
def _starts_of(windows, duration: int) -> set[int]:
    """Débuts sur la grille de 30 min tels que [t, t+duration] tienne dans une fenêtre libre."""
    out = set()
    for s, e in windows:
        t = -(-s // GRID_MINUTES) * GRID_MINUTES        # ceil vers le multiple supérieur
        while t + duration <= e:
            out.add(t)
            t += GRID_MINUTES
    return out


def _subtract(windows, occupied):
    """`windows` privé des intervalles `occupied` (liste de (start, end, ...))."""
    out = []
    for a, b in windows:
        cur = a
        for occ in sorted(o for o in occupied if o[0] < b and o[1] > a):
            s, e = occ[0], occ[1]
            if s > cur:
                out.append((cur, min(s, b)))
            cur = max(cur, e)
        if cur < b:
            out.append((cur, b))
    return [(a, b) for a, b in out if b > a]


def _enforced_occupancy(courses) -> dict:
    """Occupation de chaque ressource par les cours IMPOSÉS : rid -> [(start, end, code, type)]."""
    occ = defaultdict(list)
    for c in courses:
        e = c.get("enforced")
        if not e:
            continue
        s, end = e["startTime"], e["startTime"] + c["duration"]
        for rid in list(e["teacher"]) + list(e["groups"]) + list(e["rooms"]):
            occ[rid].append((s, end, c.get("code", ""), c.get("type", "")))
    return occ


_DAY_NAMES = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")


def _fmt_slot(start: int, duration: int) -> str:
    """« jeudi 08h30–12h30 » — minutes depuis lundi 00:00."""
    day, off = start // 1440, start % 1440
    end = off + duration
    name = _DAY_NAMES[day] if day < len(_DAY_NAMES) else f"jour {day}"
    return f"{name} {off // 60:02d}h{off % 60:02d}–{end // 60:02d}h{end % 60:02d}"


def _explain_no_slot(diag: dict, duration: int) -> str:
    """
    Message d'un cours sans aucun créneau possible.

    Trois formes, selon ce que la méthode des retraits individuels (§3.2) a pu établir — et la
    troisième est la plus importante : quand aucune ressource ne suffit seule, on ne désigne
    personne. Accuser la dernière ressource rencontrée serait une affirmation fausse.
    """
    if not diag["levers"]:
        tight = sorted(diag["entries"], key=lambda e: e["slotCount"])[:3]
        detail = ", ".join(f'{"|".join(e["ids"])} ({e["slotCount"]} créneau(x))' for e in tight)
        return ("Aucun créneau possible dans l'état actuel, et aucune ressource ne suffit seule à "
                f"débloquer le cours — les contraintes se cumulent. Les plus serrées : {detail}.")

    parts = []
    for lever in diag["levers"]:
        ids = "|".join(lever["entry"]["ids"])
        slots = ", ".join(_fmt_slot(t, duration) for t in lever["slots"][:3])
        more = "…" if len(lever["slots"]) > 3 else ""
        blockers = ", ".join(sorted({f'{b["code"]} {b["type"]} ({_fmt_slot(b["start"], b["end"] - b["start"])})'
                                     for b in lever["blockedBy"]}))
        piece = f"sans {ids}, le cours tiendrait : {slots}{more}"
        if blockers:
            piece += f" — mais {ids} y est occupé par le cours imposé {blockers}"
        # §3.3.1 : sans cette mention, l'utilisateur va chercher une contrainte qui n'existe pas.
        # La ressource est NOMMÉE dans la parenthèse : placée juste après le cours imposé, une
        # mention anonyme se rattache visuellement à lui plutôt qu'à la ressource (remarque Frédéric).
        if lever["entry"]["inheritsDefault"]:
            piece += f" ({ids} n'a pas de contrainte spécifique, hérite des contraintes par Défaut)"
        parts.append(piece)

    # Majuscule sur la première partie : elle ouvre une phrase, après un point.
    joined = " ; ".join(parts)
    head = "Aucun créneau possible dans l'état actuel du calendrier. "
    return head + joined[0].upper() + joined[1:] + "."


def _diagnose_slots(course: dict, rwin, occupancy: dict, constrained_ids: set) -> dict:
    """
    Le cours tient-il quelque part, dans l'état courant du calendrier ?

    Quand la réponse est non, la ressource « coupable » n'est PAS celle qui vide l'ensemble au fil
    de l'intersection (résultat dépendant de l'ordre de parcours, donc arbitraire) : on refait le
    calcul en retirant chaque entrée une par une, et on ne retient que celles dont le retrait rend
    le cours plaçable (§3.2 du plan). Vérifié sur GEA 87 S40 : sur les 12 entrées du CM R3.01, une
    seule ressort — AMPHI B — et c'est bien celle dont le déblocage fait remonter le résultat.

    `rwin` porte déjà le carving de la pause méridienne sur les seuls GROUPES : ne pas le refaire
    ici, et ne surtout pas l'étendre aux enseignants ou aux salles.
    """
    dur = course["duration"]
    raw = []
    for entries, kind in ((course.get("teacher", []), TEACHER),
                          (course.get("groups", []), GROUP),
                          (course.get("rooms", []), ROOM)):
        for entry in entries:
            raw.append((kind, list(entry) if isinstance(entry, list) else [entry]))

    start_sets = []
    for _kind, ids in raw:
        s = set()
        for rid in ids:
            s |= _starts_of(_subtract(rwin(rid), occupancy.get(rid, [])), dur)
        start_sets.append(s)

    entries_json = [
        {"kind": kind, "ids": ids,
         "inheritsDefault": all(rid not in constrained_ids for rid in ids),
         "slotCount": len(start_sets[i])}
        for i, (kind, ids) in enumerate(raw)
    ]

    def inter(skip=None):
        acc = None
        for i, s in enumerate(start_sets):
            if i == skip:
                continue
            acc = set(s) if acc is None else (acc & s)
            if not acc:
                break
        return acc or set()

    feasible = inter()
    if feasible:
        return {"feasible": True, "slotCount": len(feasible), "entries": entries_json, "levers": []}

    levers = []
    for skip in range(len(raw)):
        without = inter(skip)
        if not without:
            continue
        slots = sorted(without)
        blocked = []
        for rid in raw[skip][1]:
            for s, e, code, typ in occupancy.get(rid, []):
                if any(s < t + dur and e > t for t in slots):
                    blocked.append({"resourceId": rid, "start": s, "end": e, "code": code, "type": typ})
        levers.append({"entry": entries_json[skip], "slots": slots, "blockedBy": blocked})

    return {"feasible": False, "slotCount": 0, "entries": entries_json, "levers": levers}


# ---------------------------------------------------------------------------
# Moteur.
# ---------------------------------------------------------------------------
def solve(raw: dict, config: dict | None = None) -> list[dict]:
    """
    Résout une instance `RawScheduleData` avec CP-SAT et retourne une liste
    `ScheduleSolutionJSON` (un seul élément : la meilleure solution, optimum prouvé
    sur le NOMBRE de tâches placées).

    config (sous-ensemble de SchedulerConfig, tout optionnel) :
      - lunchBreak       : { type:'fixed', from:'12:00', to:'13:30' } | { type:'none' }
                           (le type 'floating' n'est PAS supporté par ce moteur → ignoré)
      - ignoreDailyLimits: bool (défaut False)
      - respectCmTdTpOrder: bool (défaut True) — calcule et impose les dépendances de précédence
                           CM→TD→TP entre cours d'un même ensemble (même code RX.XX ou SAE.XXX,
                           groupes compatibles). Si False, `_determine_dependencies` n'est pas
                           consultée : aucune contrainte de précédence n'est posée, le moteur a
                           toute liberté de placement entre CM/TD/TP.
      - timeoutSeconds   : float (défaut 30)
      - excludeTypes     : list[str] (défaut ['Autonomie']) — exclus et rapportés neutralisés
      - earliest         : bool (défaut False) — départage les optima en plaçant au plus tôt.
                           ATTENTION : transforme un optimum de placement souvent trivial (0 branche,
                           ~1 s) en une vraie optimisation combinatoire (bien plus lente). À n'activer
                           que si un placement déterministe « au plus tôt » est requis.
      - minimizeTeacherDays : bool (défaut False) — préférence DOUCE, PRIORITAIRE sur toutes les
                           autres : concentrer les cours d'un enseignant sur le moins de JOURNÉES
                           distinctes possible (remplir matin+après-midi d'un jour plutôt qu'étaler
                           sur plusieurs). Passe 2, à placement FIXÉ, seule et isolée (plus mêlée à
                           `compactTeacherDay` comme avant refonte) : minimise Σ jours de
                           présence, puis VERROUILLE ce total pour toutes les passes suivantes
                           (`sum(day_used) <= best_days`) — aucune passe en aval ne peut plus ajouter
                           de jour, quelle que soit l'option cochée. Ne dégrade jamais le placement ni
                           les contraintes dures. `provenOptimal` reste basé sur la passe 1.
      - reduceTeacherHalfDays : bool (défaut False) — préférence DOUCE : pour chaque demi-journée de
                           présence d'un enseignant dont la charge est ≤ `HALF_DAY_UNDERUSED_THRESHOLD`
                           (120 min — le cas typique est un unique cours isolé), essaie de la reporter
                           sur une autre demi-journée (à l'intérieur des mêmes jours) pour la vider.
                           Objectif : minimiser le nombre de ces demi-journées SOUS-utilisées — une
                           demi-journée déjà bien remplie (> 120 min) n'est jamais une cible à vider,
                           seulement une destination possible. Passe 3, à placement ET jours (si actif)
                           FIGÉS. AUCUN plafond dur sur le pic quotidien — seules les contraintes dures
                           (disponibilité, plafond quotidien) bornent le report ; le pic peut donc se
                           dégrader librement dans cette seule limite. Ne dégrade jamais placement ni
                           contraintes dures, ni le nombre de jours. `provenOptimal` reste basé sur la
                           passe 1.
      - compactTeacherDay : bool (défaut False) — préférence DOUCE, fusion de deux mécanismes
                           auparavant séparés (`compactTeacherHalfDays` + `crossNoonGap`) sous UN
                           seul flag, par jour plutôt que par demi-journée isolée : minimise TOUS
                           les trous entre cours consécutifs d'un enseignant sur une journée, à
                           l'exception de la pause méridienne elle-même (seule autorisée à excéder
                           les autres trous). Aucun seuil, aucun plafond dur : réduit autant que
                           possible, sans jamais pouvoir rendre le modèle infaisable. Passe 4, à
                           placement, jours (si actif) ET demi-journées (si actif) FIGÉS.
                           Techniquement, deux composantes ADDITIVES dans la même passe (implémentées
                           telles quelles, sans réécriture, pour préserver les cas limites déjà
                           validés) :
                             1) trous À L'INTÉRIEUR d'un bloc matin/après-midi (ou de la journée
                                entière si `lunchBreak.type != 'fixed'` — sans pause à protéger, un
                                seul bloc couvre toute la journée, aucun découpage arbitraire) ;
                             2) l'EXCÉDENT du trou de midi au-delà de la pause RÉSIDUELLE réelle de
                                ce (prof, jour) — la portion de pause encore libre après un éventuel
                                `enforced` qui empiète dessus (`_residual_break`), jamais la constante
                                `lunch_len` — pour un enseignant présent matin ET après-midi
                                uniquement. Ignorée si la pause n'est pas fixe. Si un enforced mange
                                la pause en entier, plus de scission : la composante 1 facture la
                                journée entière comme un bloc unique, la composante 2 n'a plus d'objet
                                et se neutralise d'elle-même. Positivité assurée STRUCTURELLEMENT
                                (`AddMaxEquality(gap, [raw_gap, 0])`), pas seulement par construction
                                du domaine — un enforced à cheval peut sinon rendre le trou négatif.
                           Composante 1 pondérée `COMPACT_DAY_IDLE_WEIGHT` (=2) contre 1 pour la
                           composante 2 : sans cet écart, rapprocher le PREMIER cours de l'après-midi
                           de la pause de Δ minutes sans bouger les suivants réduit la composante 2
                           d'exactement Δ tout en créant un trou intra-bloc d'exactement Δ (composante
                           1) — échange à somme nulle qui laissait le solveur resserrer au prix d'un
                           trou ailleurs (repéré sur le vrai projet, 2026-09-11). Le poids >1 rend cet
                           échange perdant sans pénaliser la vraie compaction (déplacer le bloc entier
                           vers la pause reste gagnant, à idle intra-bloc constant).
                           N'interdit ni ne pénalise d'être présent matin ET après-midi, ni sur
                           plusieurs jours. Trou connu (hors périmètre v1) : un cours à cheval sur la
                           pause dont `groups` est VIDE (ni carvé par le groupe ni par un enforced)
                           échappe à cette classification — neutralisé par le `max(0, …)` structurel
                           plutôt que modélisé explicitement.
      - minimizeTeacherRoomChanges : bool (défaut False) — préférence DOUCE de grand confort : pour
                           un enseignant, garder la même salle d'un cours au suivant dans une même
                           demi-journée quand une salle commune existe. Passe 5, tout en bas de la
                           hiérarchie, appliquée à PLACEMENT GELÉ (post-traitement quasi pur) :
                           `scheduled[]`, `start[]` et tous les littéraux non-salle sont figés en dur
                           à la solution des passes précédentes, seul le choix parmi les salles
                           ALTERNATIVES reste libre. Les 3 autres douces ne dépendent que de
                           grandeurs gelées → strictement préservées, aucun verrou dur
                           supplémentaire nécessaire. Fidèle (pénalise les vraies transitions entre
                           cours consécutifs d'une même demi-journée, pas une borne), no-op si aucun
                           cours n'a de salle alternative influençable, coût attendu négligeable.
                           `provenOptimal` reste basé sur la passe 1.
    """
    config = config or {}
    week = raw["week"]
    constraints = raw.get("constraints") or {}
    exclude_types = set(config.get("excludeTypes", ["Autonomie"]))
    ignore_daily = bool(config.get("ignoreDailyLimits", False))
    respect_cm_td_tp_order = bool(config.get("respectCmTdTpOrder", True))
    earliest = bool(config.get("earliest", False))
    compact_teacher_day = bool(config.get("compactTeacherDay", False))
    minimize_days = bool(config.get("minimizeTeacherDays", False))
    reduce_half_days = bool(config.get("reduceTeacherHalfDays", False))
    minimize_rooms = bool(config.get("minimizeTeacherRoomChanges", False))
    # `day_used_by` est construit dès que l'une des deux options en a besoin : minimize_days pour le
    # minimiser (passe 2), reduce_half_days pour verrouiller le nombre de jours pendant qu'elle
    # reporte de la charge entre demi-journées (passe 3).
    include_days = minimize_days or reduce_half_days

    # Métadonnées ressources : type + plafond quotidien.
    rtype_of: dict[str, str] = {}
    max_daily: dict[str, int] = {}
    group_ids: set[str] = set()
    for grp in raw.get("resources", []):
        rtype = grp["resourceType"]
        for r in grp["resources"]:
            rtype_of[r["id"]] = rtype
            if rtype == GROUP:
                group_ids.add(r["id"])
            if not ignore_daily and r.get("maxDailyMinutes") is not None:
                max_daily[r["id"]] = r["maxDailyMinutes"]

    # Pause méridienne fixe (seul mode modélisé).
    lunch = None
    lb = config.get("lunchBreak")
    if isinstance(lb, dict) and lb.get("type") == "fixed":
        lunch = (_parse_time(lb["from"]), _parse_time(lb["to"]))

    # Frontière matin/après-midi pour la compacité par demi-journée.
    half_cut = lunch[1] if lunch is not None else 13 * 60   # fin de pause fixe, sinon 13:00

    rwin = _make_availability(constraints, week, group_ids, lunch)

    # Partition des cours : modélisés vs exclus (Autonomie…).
    all_courses = raw.get("courses", [])
    counters = {}                              # index course -> compteur 1-based (fidélité fallbackId)
    for i, c in enumerate(all_courses):
        counters[i] = i + 1
    courses = [(i, c) for i, c in enumerate(all_courses) if c.get("type") not in exclude_types]
    excluded = [(i, c) for i, c in enumerate(all_courses) if c.get("type") in exclude_types]

    # Cohérence des enforced (le chemin CP-SAT court-circuite le Loader Node qui la vérifie).
    _validate_enforced([c for _, c in courses])

    model = cp_model.CpModel()
    scheduled: dict[int, Any] = {}
    start: dict[int, Any] = {}
    used_literals: dict[int, list[tuple[str, str, Any]]] = defaultdict(list)  # local_idx -> [(rid, rtype, lit)]
    intervals_by_res = defaultdict(list)
    capped: dict[int, list[tuple[str, Any]]] = defaultdict(list)              # local_idx -> [(rid, lit)]
    possible_days: dict[int, list[int]] = {}
    local = {}                                 # global course idx -> local idx dans `courses`

    for li, (gi, c) in enumerate(courses):
        local[gi] = li
        dur = c["duration"]
        scheduled[li] = model.NewBoolVar(f"s{li}")
        start[li] = model.NewIntVar(0, HORIZON, f"t{li}")

        e = c.get("enforced")
        if e:
            # Enforced : start imposé, ressources fixes, ignore la dispo ET le plafond
            # maxDailyMinutes (réplique bookEnforced() côté core, qui n'appelle jamais
            # _addDailyUsage() — un enforced est sous la responsabilité de l'utilisateur,
            # dépassements compris ; ne pas l'ajouter à `capped` sous peine d'INFEASIBLE
            # global dès qu'un enforced dépasse seul un plafond quotidien).
            model.Add(scheduled[li] == 1)
            model.Add(start[li] == e["startTime"])
            possible_days[li] = [e["startTime"] // 1440]
            for entries, rtype in ((e["teacher"], TEACHER), (e["groups"], GROUP), (e["rooms"], ROOM)):
                for rid in entries:
                    used_literals[li].append((rid, rtype_of.get(rid, rtype), scheduled[li]))
                    intervals_by_res[rid].append(
                        model.NewOptionalFixedSizeIntervalVar(start[li], dur, scheduled[li], f"iv{li}_{rid}"))
            continue

        # ── GRILLE HORAIRE : début sur un multiple de GRID_MINUTES.
        # Formulée via une variable de décision `k` à domaine CONTIGU, et NON en énumérant les débuts
        # permis (`Domain.FromValues`) : à ensemble de solutions identique, l'énumération troue le
        # domaine de `start` et coûte cher en propagation (passe 1 mesurée à 16,3 s contre 1,8 s sur
        # S39). Sous cette forme le surcoût est nul (écarts dans le bruit sur 4 semaines).
        # Les cours IMPOSÉS sont déjà sortis par le `continue` ci-dessus, et ce n'est pas un détail :
        # leur start est posé en dur (`start == startTime` avec `scheduled == 1`), donc y ajouter la
        # grille créerait une contradiction arithmétique dès qu'une imposition ne tombe pas sur la
        # grille — et comme le solveur n'a pas le droit de renoncer à ce cours, c'est le modèle
        # ENTIER qui deviendrait INFEASIBLE (aucun cours placé de la semaine). Même raison que pour
        # `maxDailyMinutes`, dont les enforced sont déjà exclus juste au-dessus.
        kgrid = model.NewIntVar(0, HORIZON // GRID_MINUTES, f"kg{li}")
        model.Add(start[li] == GRID_MINUTES * kgrid)

        # Tâche normale : chaque entrée est une ressource fixe (str) ou des alternatives (list).
        cats = ((c.get("teacher", []), TEACHER), (c.get("groups", []), GROUP), (c.get("rooms", []), ROOM))
        fixed: list[tuple[str, str]] = []
        alts: list[tuple[list[str], str]] = []
        for entries, rtype in cats:
            for entry in entries:
                if isinstance(entry, list):
                    alts.append((entry, rtype))
                else:
                    fixed.append((entry, rtype))

        # Début : intersection des dispos des ressources fixes (si placée).
        fw = [(0, HORIZON)]
        for rid, _ in fixed:
            fw = _intersect(fw, rwin(rid))
        model.AddLinearExpressionInDomain(start[li], _start_domain(fw, dur)).OnlyEnforceIf(scheduled[li])
        possible_days[li] = sorted({s // 1440 for s, _ in fw if s // 1440 <= 4}) if fixed else list(range(5))

        for rid, rtype in fixed:
            used_literals[li].append((rid, rtype_of.get(rid, rtype), scheduled[li]))
            intervals_by_res[rid].append(
                model.NewOptionalFixedSizeIntervalVar(start[li], dur, scheduled[li], f"iv{li}_{rid}"))
            if rid in max_daily:
                capped[li].append((rid, scheduled[li]))

        for si, (slot, rtype) in enumerate(alts):
            lits = []
            for rid in slot:
                lit = model.NewBoolVar(f"u{li}_{si}_{rid}")
                lits.append(lit)
                used_literals[li].append((rid, rtype_of.get(rid, rtype), lit))
                model.AddLinearExpressionInDomain(start[li], _start_domain(rwin(rid), dur)).OnlyEnforceIf(lit)
                intervals_by_res[rid].append(
                    model.NewOptionalFixedSizeIntervalVar(start[li], dur, lit, f"iv{li}_{si}_{rid}"))
                if rid in max_daily:
                    capped[li].append((rid, lit))
            model.Add(sum(lits) == scheduled[li])       # exactly-one si placée, zéro sinon

    # Occupation enforced par (enseignant, jour) — sert à calculer la pause méridienne
    # RÉELLEMENT disponible d'un enseignant quand un enforced empiète dessus (pause écourtée,
    # pas supprimée). Portée fonction entière : réutilisé par les préférences douces (Option A/D
    # ci-dessous) ET par la passe 5 (§1.6, cohérence de la frontière demi-journée). Les `start`
    # des enforced sont des constantes Python → aucun coût solveur.
    enf_busy: dict[tuple[str, int], list[tuple[int, int]]] = defaultdict(list)
    if lunch is not None:
        for li, (_gi, c) in enumerate(courses):
            e = c.get("enforced")
            if not e:
                continue
            d, off = e["startTime"] // 1440, e["startTime"] % 1440
            for (rid, rtype, _lit) in used_literals[li]:
                if rtype == TEACHER:
                    enf_busy[(rid, d)].append((off, off + c["duration"]))

    def residual(tid: str, d: int) -> tuple[int, int]:
        """Pause résiduelle (P0,P1) de ce (prof, jour) ; (0,0) si pas de pause fixe."""
        if lunch is None:
            return (0, 0)
        return _residual_break(enf_busy.get((tid, d), []), lunch[0], lunch[1])

    # Non-chevauchement par ressource.
    for rid, ivs in intervals_by_res.items():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    # Dépendances CM→TD→TP : précédence temporelle (conditionnée) + intégrité de chaîne.
    # _determine_dependencies raisonne sur la liste `courses` compacte → indices locaux directs.
    # Désactivable globalement via respectCmTdTpOrder=False : le moteur retrouve alors toute
    # liberté de placement entre CM/TD/TP d'un même ensemble.
    # Conservé au-delà de la construction du modèle : la phase de rapport s'en sert pour dire
    # « ce cours tombe parce que son prérequis n'est pas placé » au lieu d'un motif générique.
    dependency_pairs = _determine_dependencies([c for _, c in courses]) if respect_cm_td_tp_order else []
    if respect_cm_td_tp_order:
        for dep, pre in dependency_pairs:
            # Un dépendant ENFORCED est épinglé par l'utilisateur : son placement est autoritaire et
            # échappe à la chaîne auto-dérivée (fidèle à scheduler-core, où les enforced sont exclus de
            # la vérification de dépendance — _collectDependents / _backtrack). Sans cette exclusion, un
            # cours épinglé ayant un frère de type antérieur (même code/groupes) forcerait ce prérequis
            # avant l'heure figée — souvent impossible → modèle INFEASIBLE, toute la semaine s'effondre.
            # (Un prérequis enforced, lui, reste une contrainte amont valide pour un dépendant normal.)
            if courses[dep][1].get("enforced"):
                continue
            model.Add(start[dep] >= start[pre] + courses[pre][1]["duration"]) \
                 .OnlyEnforceIf([scheduled[dep], scheduled[pre]])
            model.AddImplication(scheduled[dep], scheduled[pre])

    # taskGroups (RawScheduleData.groups + CourseTaskData.taskGroupId) : tout-ou-rien.
    gtype_of = {g["id"]: g["type"] for g in raw.get("groups", [])}
    members_of: dict[str, list[int]] = defaultdict(list)
    for li, (gi, c) in enumerate(courses):
        gid = c.get("taskGroupId")
        if gid in gtype_of:
            members_of[gid].append(li)             # ordre = ordre des cours (séquentiel respecté par construction)
    group_specs = []
    for gid, members in members_of.items():
        if len(members) < 2:
            continue
        gtype = gtype_of[gid]
        group_specs.append((gid, gtype, members))
        m0 = members[0]
        for m in members[1:]:
            model.Add(scheduled[m] == scheduled[m0])                                  # tout-ou-rien
        if gtype == "parallel":
            for m in members[1:]:
                model.Add(start[m] == start[m0])                                      # départs égaux
        elif gtype == "sequential":
            for a, b in zip(members, members[1:]):
                model.Add(start[b] == start[a] + courses[a][1]["duration"])           # sans gap, dans l'ordre

    # Plafonds quotidiens (maxDailyMinutes) — réification on_day (le point « fiddly »).
    on_day_cache = {}

    def on_day(li, d):
        if (li, d) not in on_day_cache:
            lo, hi = d * 1440, (d + 1) * 1440
            ge = model.NewBoolVar(f"ge{li}_{d}")
            model.Add(start[li] >= lo).OnlyEnforceIf(ge)
            model.Add(start[li] <= lo - 1).OnlyEnforceIf(ge.Not())
            lt = model.NewBoolVar(f"lt{li}_{d}")
            model.Add(start[li] <= hi - 1).OnlyEnforceIf(lt)
            model.Add(start[li] >= hi).OnlyEnforceIf(lt.Not())
            od = model.NewBoolVar(f"od{li}_{d}")
            model.AddBoolAnd([ge, lt]).OnlyEnforceIf(od)
            model.AddBoolOr([ge.Not(), lt.Not()]).OnlyEnforceIf(od.Not())
            on_day_cache[(li, d)] = od
        return on_day_cache[(li, d)]

    on_half_cache = {}

    def on_half(li, d, h):
        if (li, d, h) not in on_half_cache:
            base = d * 1440
            lo = base if h == 0 else base + half_cut
            hi = base + half_cut if h == 0 else base + 1440
            ge = model.NewBoolVar(f"hge{li}_{d}_{h}")
            model.Add(start[li] >= lo).OnlyEnforceIf(ge)
            model.Add(start[li] <= lo - 1).OnlyEnforceIf(ge.Not())
            lt = model.NewBoolVar(f"hlt{li}_{d}_{h}")
            model.Add(start[li] <= hi - 1).OnlyEnforceIf(lt)
            model.Add(start[li] >= hi).OnlyEnforceIf(lt.Not())
            oh = model.NewBoolVar(f"oh{li}_{d}_{h}")
            model.AddBoolAnd([ge, lt]).OnlyEnforceIf(oh)
            model.AddBoolOr([ge.Not(), lt.Not()]).OnlyEnforceIf(oh.Not())
            on_half_cache[(li, d, h)] = oh
        return on_half_cache[(li, d, h)]

    on_side_cache = {}

    def on_side(li, d, p0, p1, h):
        """« Le cours li est ENTIÈREMENT du côté h de la pause résiduelle [p0,p1] du jour d ».

        h=0 (matin)  ⟺ base ≤ start ET start + durée ≤ base + p0   ← teste la FIN, pas le début
        h=1 (aprem)  ⟺ base + p1 ≤ start < base + 1440

        Différence clé avec on_half (seuil scalaire sur le seul `start`) : un cours à cheval sur
        la pause n'appartient à AUCUN des deux côtés — littéral constamment faux des deux côtés.
        C'est exactement le cas d'un enforced qui empiète sur la pause, que le seuil scalaire
        rangeait de force d'un côté, cassant l'identité du trou de midi.
        """
        key = (li, d, p0, p1, h)
        if key not in on_side_cache:
            base, dur = d * 1440, courses[li][1]["duration"]
            lo = base if h == 0 else base + p1
            hi = base + p0 - dur if h == 0 else base + 1439      # bornes SUR start, inclusives
            if hi < lo:                                          # ne tient pas de ce côté
                on_side_cache[key] = model.NewConstant(0)
            else:
                ge = model.NewBoolVar(f"sge{li}_{d}_{h}")
                model.Add(start[li] >= lo).OnlyEnforceIf(ge)
                model.Add(start[li] <= lo - 1).OnlyEnforceIf(ge.Not())
                le = model.NewBoolVar(f"sle{li}_{d}_{h}")
                model.Add(start[li] <= hi).OnlyEnforceIf(le)
                model.Add(start[li] >= hi + 1).OnlyEnforceIf(le.Not())
                os_ = model.NewBoolVar(f"os{li}_{d}_{h}")
                model.AddBoolAnd([ge, le]).OnlyEnforceIf(os_)
                model.AddBoolOr([ge.Not(), le.Not()]).OnlyEnforceIf(os_.Not())
                on_side_cache[key] = os_
        return on_side_cache[key]

    by_res_day = defaultdict(list)
    for li in range(len(courses)):
        for rid, lit in capped[li]:
            for d in possible_days[li]:
                od = on_day(li, d)
                z = model.NewBoolVar(f"z{li}_{rid}_{d}")           # z = lit ∧ on_day
                model.AddBoolAnd([lit, od]).OnlyEnforceIf(z)
                model.AddBoolOr([lit.Not(), od.Not()]).OnlyEnforceIf(z.Not())
                by_res_day[(rid, d)].append(courses[li][1]["duration"] * z)
    for (rid, d), terms in by_res_day.items():
        model.Add(sum(terms) <= max_daily[rid])

    # Préférences DOUCES enseignant (chacune derrière son flag ; indépendantes et combinables).
    # `day_terms` isolé (passe 2, minimize_days uniquement) ; `half_terms` = demi-journées
    # sous-utilisées (passe 3, reduce_half_days uniquement) ; `penalty_terms` = compacité + trou de
    # midi, en minutes (passe 4, à passe-3 FIGÉE). Chaque grandeur a son propre niveau
    # lexicographique.
    day_terms: list[Any] = []             # Σ jours de présence (passe 2, minimize_days uniquement)
    penalty_terms: list[Any] = []
    half_terms: list[Any] = []            # Σ demi-journées sous-utilisées (passe 3, reduce_half_days)
    if compact_teacher_day or minimize_days or reduce_half_days:
        # Littéraux enseignant par cours : (tid, li, lit d'utilisation) — enforced inclus
        # (lit == scheduled[li]), alternatives incluses (lit == bool de l'alternative choisie).
        teacher_lits = defaultdict(list)                      # tid -> [(li, lit)]
        for li in range(len(courses)):
            for (rid, rtype, lit) in used_literals[li]:
                if rtype == TEACHER:
                    teacher_lits[rid].append((li, lit))

        # ── Option A : compacité par bloc (minimiser les trous DANS un bloc matin/aprem, ou dans la
        # journée ENTIÈRE si pas de pause fixe à protéger — plus de découpage arbitraire dans ce cas). ──
        # Pour chaque (enseignant, jour, bloc) présent : idle = (fin du dernier cours − début du
        # premier) − somme des durées présentes. Les cours d'un même prof ne se chevauchent pas
        # (NoOverlap sur la ressource) ⇒ idle = temps mort total entre ses cours de ce bloc. Nul si
        # 0/1 cours présent. Être présent matin ET après-midi n'est jamais pénalisé (blocs disjoints).
        # Le bloc n'est PAS toujours "matin/après-midi" : quand la pause est fixe, le partage se fait
        # sur la pause RÉSIDUELLE de ce (prof, jour) — voir `residual()` — pour ne pas facturer en
        # temps mort la portion de pause qu'un enforced a mangée (§0.5/§0.6 du plan).
        if compact_teacher_day:
            for tid, lst in teacher_lits.items():
                days = sorted({d for (li, _) in lst for d in possible_days[li]})
                for d in days:
                    if lunch is None:
                        # Aucune pause à protéger : un seul bloc couvre la journée entière (pas de
                        # scission matin/après-midi arbitraire à 13h00).
                        blocks = [(0, (lambda li: on_day(li, d)))]
                    else:
                        p0, p1 = residual(tid, d)
                        if p1 > p0:
                            blocks = [(h, (lambda li, h=h: on_side(li, d, p0, p1, h))) for h in (0, 1)]
                        else:
                            # Pause entièrement mangée par un enforced : plus de scission — la
                            # journée est un bloc unique, `compact` facture l'intégralité du trou.
                            blocks = [(0, (lambda li: on_day(li, d)))]
                    for bidx, side in blocks:
                        members = []                          # (li, p) candidats de ce bloc
                        for (li, lit) in lst:
                            if d not in possible_days[li]:
                                continue
                            p = model.NewBoolVar(f"cp{tid}_{li}_{d}_{bidx}")
                            oh = side(li)
                            model.AddBoolAnd([lit, oh]).OnlyEnforceIf(p)
                            model.AddBoolOr([lit.Not(), oh.Not()]).OnlyEnforceIf(p.Not())
                            members.append((li, p))
                        if len(members) < 2:
                            continue                          # 0/1 cours ⇒ aucun trou possible
                        base = d * 1440
                        first = model.NewIntVar(base, base + 1440, f"first{tid}_{d}_{bidx}")
                        last = model.NewIntVar(base, base + 1440, f"last{tid}_{d}_{bidx}")
                        busy = []
                        for (li, p) in members:
                            dur = courses[li][1]["duration"]
                            model.Add(first <= start[li]).OnlyEnforceIf(p)       # first ≤ min début présent
                            model.Add(last >= start[li] + dur).OnlyEnforceIf(p)  # last ≥ max fin présente
                            busy.append(dur * p)
                        idle = model.NewIntVar(0, 1440, f"idle{tid}_{d}_{bidx}")
                        model.Add(idle == last - first - sum(busy))              # ≥0 ⇒ 0 si <2 présents
                        penalty_terms.append(COMPACT_DAY_IDLE_WEIGHT * idle)  # en minutes pondérées

        # ── Option D : trou de midi (idle qui traverse la pause déjeuner, au-delà de celle-ci). ──
        # Pour chaque (enseignant, jour) présent matin ET après-midi :
        #   trou = début_1er_aprem − fin_dernier_matin − pause RÉSIDUELLE (p1 − p0, pas la constante
        #   `lunch_len`) — un enforced empiétant sur la pause l'écourte, il ne la supprime pas (§0.6
        #   du plan). Positivité assurée STRUCTURELLEMENT par `AddMaxEquality(gap, [raw_gap, 0])`
        #   ci-dessous, plus par le seul domaine — un enforced à cheval rend l'ancien argument
        #   « pause carvée ⇒ ≥0 » faux, c'est la cause racine de l'INFEASIBLE corrigé ici.
        # Gate : pause fixe uniquement (sinon un cours peut enjamber midi → identité fausse).
        if compact_teacher_day and lunch is not None:
            for tid, lst in teacher_lits.items():
                days = sorted({d for (li, _) in lst for d in possible_days[li]})
                for d in days:
                    p0, p1 = residual(tid, d)
                    if p1 == p0:
                        continue                  # pause entièrement mangée ⇒ plus de scission matin/aprem,
                                                   # `compact` prend le relais sur la journée entière (§1.4)
                    base = d * 1440
                    morn, aft = [], []            # (li, p_m) / (li, p_a)
                    for (li, lit) in lst:
                        if d not in possible_days[li]:
                            continue
                        p_m = model.NewBoolVar(f"cnm{tid}_{li}_{d}")
                        oh0 = on_side(li, d, p0, p1, 0)
                        model.AddBoolAnd([lit, oh0]).OnlyEnforceIf(p_m)
                        model.AddBoolOr([lit.Not(), oh0.Not()]).OnlyEnforceIf(p_m.Not())
                        p_a = model.NewBoolVar(f"cna{tid}_{li}_{d}")
                        oh1 = on_side(li, d, p0, p1, 1)
                        model.AddBoolAnd([lit, oh1]).OnlyEnforceIf(p_a)
                        model.AddBoolOr([lit.Not(), oh1.Not()]).OnlyEnforceIf(p_a.Not())
                        morn.append((li, p_m))
                        aft.append((li, p_a))
                    if not morn or not aft:
                        continue                  # aucun cours possible d'un côté ⇒ jamais de trou
                    # fin_matin = MAX des fins matin présentes (0 si aucune) ; e_i = fin si présent, sinon 0.
                    ends = []
                    for (li, p_m) in morn:
                        dur = courses[li][1]["duration"]
                        e_i = model.NewIntVar(0, base + 1440, f"em{tid}_{li}_{d}")
                        model.Add(e_i == start[li] + dur).OnlyEnforceIf(p_m)
                        model.Add(e_i == 0).OnlyEnforceIf(p_m.Not())
                        ends.append(e_i)
                    last_m = model.NewIntVar(0, base + 1440, f"lm{tid}_{d}")
                    model.AddMaxEquality(last_m, ends)
                    # début_aprem = MIN des débuts aprem présents (BIG si aucun) ; s_i = début si présent, sinon BIG.
                    BIG = base + 1440
                    starts = []
                    for (li, p_a) in aft:
                        s_i = model.NewIntVar(0, BIG, f"sa{tid}_{li}_{d}")
                        model.Add(s_i == start[li]).OnlyEnforceIf(p_a)
                        model.Add(s_i == BIG).OnlyEnforceIf(p_a.Not())
                        starts.append(s_i)
                    first_a = model.NewIntVar(0, BIG, f"fa{tid}_{d}")
                    model.AddMinEquality(first_a, starts)
                    # both = présent matin ET aprem.
                    pm_any = model.NewBoolVar(f"pmA{tid}_{d}")
                    model.AddMaxEquality(pm_any, [p for (_, p) in morn])
                    pa_any = model.NewBoolVar(f"paA{tid}_{d}")
                    model.AddMaxEquality(pa_any, [p for (_, p) in aft])
                    both = model.NewBoolVar(f"both{tid}_{d}")
                    model.AddBoolAnd([pm_any, pa_any]).OnlyEnforceIf(both)
                    model.AddBoolOr([pm_any.Not(), pa_any.Not()]).OnlyEnforceIf(both.Not())
                    # trou = first_a − last_m − pause_résiduelle (p1−p0), seulement si both ; sinon 0.
                    # Positivité NON garantie par construction pour un enforced à cheval (§0.3 du plan)
                    # → structurelle via AddMaxEquality, jamais via le domaine seul.
                    raw_gap = model.NewIntVar(-1440, 1440, f"cnraw{tid}_{d}")
                    model.Add(raw_gap == first_a - last_m - (p1 - p0)).OnlyEnforceIf(both)
                    model.Add(raw_gap == 0).OnlyEnforceIf(both.Not())
                    gap = model.NewIntVar(0, 1440, f"cngap{tid}_{d}")
                    model.AddMaxEquality(gap, [raw_gap, 0])     # ← plus JAMAIS d'infaisabilité par ce terme
                    penalty_terms.append(gap)     # en minutes, poids 1 → passe 4

        # ── Présence-jours enseignant : construite dès que minimize_days ou reduce_half_days la
        # requiert (minimiser Σ jours pour l'une, verrouiller le nombre de jours pour l'autre). ──
        day_used_by = {}                              # (tid, d) -> BoolVar "présent ce jour"
        if include_days:
            for tid, lst in teacher_lits.items():
                for d in sorted({d for (li, _) in lst for d in possible_days[li]}):
                    present = []
                    for (li, lit) in lst:
                        if d not in possible_days[li]:
                            continue
                        q = model.NewBoolVar(f"pd{tid}_{li}_{d}")
                        od = on_day(li, d)
                        model.AddBoolAnd([lit, od]).OnlyEnforceIf(q)
                        model.AddBoolOr([lit.Not(), od.Not()]).OnlyEnforceIf(q.Not())
                        present.append((li, q))
                    if not present:
                        continue
                    day_used = model.NewBoolVar(f"day{tid}_{d}")
                    model.AddMaxEquality(day_used, [q for (_, q) in present])
                    day_used_by[(tid, d)] = day_used
                    if minimize_days:                 # jours pénalisés SEULEMENT si l'option est cochée
                        day_terms.append(day_used)    # → passe 2, isolée

        # ── Demi-journées SOUS-UTILISÉES (≤ HALF_DAY_UNDERUSED_THRESHOLD), candidates à vider vers
        # une autre demi-journée (passe 3, à jours FIGÉS). Même découpage matin/après-midi que
        # l'Option A (résiduel si pause fixe) : ne PAS ouvrir une deuxième définition de « demi-
        # journée » dans ce fichier. Contrairement à l'Option A, un bloc à UN SEUL cours compte (c'est
        # le cas visé : un cours isolé sur une demi-journée) — pas de `if len(members) < 2: continue`.
        if reduce_half_days:
            for tid, lst in teacher_lits.items():
                days = sorted({d for (li, _) in lst for d in possible_days[li]})
                for d in days:
                    if lunch is None:
                        blocks = [(h, (lambda li, h=h: on_half(li, d, h))) for h in (0, 1)]
                    else:
                        p0, p1 = residual(tid, d)
                        if p1 > p0:
                            blocks = [(h, (lambda li, h=h: on_side(li, d, p0, p1, h))) for h in (0, 1)]
                        else:
                            blocks = [(0, (lambda li: on_day(li, d)))]
                    for bidx, side in blocks:
                        members = []                          # (li, p) candidats de ce bloc
                        for (li, lit) in lst:
                            if d not in possible_days[li]:
                                continue
                            p = model.NewBoolVar(f"hu{tid}_{li}_{d}_{bidx}")
                            oh = side(li)
                            model.AddBoolAnd([lit, oh]).OnlyEnforceIf(p)
                            model.AddBoolOr([lit.Not(), oh.Not()]).OnlyEnforceIf(p.Not())
                            members.append((li, p))
                        if not members:
                            continue
                        load = model.NewIntVar(0, 1440, f"hload{tid}_{d}_{bidx}")
                        model.Add(load == sum(courses[li][1]["duration"] * p for (li, p) in members))
                        used = model.NewBoolVar(f"hused{tid}_{d}_{bidx}")
                        model.AddMaxEquality(used, [p for (_, p) in members])
                        light = model.NewBoolVar(f"hlight{tid}_{d}_{bidx}")
                        model.Add(load <= HALF_DAY_UNDERUSED_THRESHOLD).OnlyEnforceIf(light)
                        model.Add(load > HALF_DAY_UNDERUSED_THRESHOLD).OnlyEnforceIf(light.Not())
                        underused = model.NewBoolVar(f"hunder{tid}_{d}_{bidx}")
                        model.AddBoolAnd([used, light]).OnlyEnforceIf(underused)
                        model.AddBoolOr([used.Not(), light.Not()]).OnlyEnforceIf(underused.Not())
                        half_terms.append(underused)

    # ── Passe 1 : optimum du NOMBRE de cours placés (départage « au plus tôt » si earliest). ──
    total_timeout = float(config.get("timeoutSeconds", 30.0))
    deadline = time.monotonic() + total_timeout
    place_term = sum(scheduled.values())
    if earliest and courses:
        weight = HORIZON * len(courses) + 1        # une tâche de plus bat tout gain d'avance
        model.Maximize(weight * place_term - sum(start.values()))
    else:
        model.Maximize(place_term)

    # Non-déterminisme connu : num_search_workers/random_seed non fixés ⇒ recherche portfolio
    # multi-thread par défaut d'OR-Tools. Le nombre de cours placés (place_term, optimum prouvé)
    # est stable, mais LESQUELS peut varier d'un run à l'autre dès qu'il existe plusieurs optima
    # à égalité (créneaux/ressources substituables) — le thread qui remonte l'incumbent gagnant
    # dépend du timing CPU. Fix possible : num_search_workers=1 + random_seed fixe sur chaque
    # CpSolver() (ici et aux passes 2/3/4/5), au prix d'un temps de résolution potentiellement
    # plus long avant timeout. Non appliqué pour l'instant (décision Frédéric, 2026-09-10).
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = total_timeout
    status = solver.Solve(model)
    _log_pass_timing("passe 1 (placement)", solver, status, total_timeout)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Aucune solution (rare : instance vide ou incohérente) — tout est neutralisé.
        return [_empty_solution(all_courses, week, exclude_types, rtype_of, counters, status)]

    placement_proven = status == cp_model.OPTIMAL
    best_placed = int(round(solver.Value(place_term)))

    # Passes réellement actives (flag ET grandeur non vide) — sert à réserver du budget aux passes
    # en aval (voir DOWNSTREAM_RESERVE_FRACTION). `salles` reste sur le seul flag : son no-op éventuel
    # (`same_vars` vide) ne se sait qu'une fois le placement figé, trop tard pour réserver en amont.
    # Pas d'entrée pour `jours` (passe 2) : aucune passe antérieure n'a besoin de réserver en
    # fonction de son activité, elle est la première douce de la séquence.
    demi_journees_active = reduce_half_days and bool(half_terms)
    compacite_active = bool(penalty_terms)
    salles_active = minimize_rooms

    # ── Passe 2 : à placement FIXÉ, minimiser le nombre de jours de présence — isolée, PRIORITAIRE
    # sur compacité (avant refonte : mêlée à la compacité dans une seule somme). ──
    reserve2 = (total_timeout * DOWNSTREAM_RESERVE_FRACTION * (demi_journees_active + compacite_active)
                + PASS5_RESERVE_SECONDS * salles_active)
    budget = (_pass_budget(deadline, "passe 2 (jours)", reserve2)
              if (minimize_days and day_terms) else 0.0)
    if budget >= MIN_PASS_SECONDS:
        model.Add(place_term >= best_placed)          # verrou : jamais moins de cours placés
        # Amorce (warm start) avec la solution de la passe 1 → convergence plus rapide.
        model.ClearHints()
        for li in range(len(courses)):
            model.AddHint(scheduled[li], solver.Value(scheduled[li]))
            model.AddHint(start[li], solver.Value(start[li]))
        model.Minimize(sum(day_terms))
        solver_days = cp_model.CpSolver()
        solver_days.parameters.max_time_in_seconds = budget
        status_days = solver_days.Solve(model)
        _log_pass_timing("passe 2 (jours)", solver_days, status_days, budget)
        if status_days in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            solver = solver_days                      # extraire la solution à jours minimisés
            # Verrou DUR du nombre total de jours de présence pour TOUTES les passes suivantes :
            # aucune ne peut plus jamais ajouter de jour.
            best_days = int(round(sum(solver.Value(v) for v in day_used_by.values())))
            model.Add(sum(day_used_by.values()) <= best_days)
        # provenOptimal reste basé sur placement_proven (passe 1) — voir docstring de solve().

    # ── Passe 3 : à placement ET jours FIGÉS, réduire le nombre de demi-journées SOUS-UTILISÉES en
    # reportant leur charge ailleurs. AUCUN plafond dur sur le pic quotidien : seules les contraintes
    # dures (disponibilité, plafond quotidien) bornent le report. Verrou du nombre de jours conservé
    # (jamais plus de jours qu'à l'issue de la passe précédente). ──
    reserve3 = (total_timeout * DOWNSTREAM_RESERVE_FRACTION * compacite_active
                + PASS5_RESERVE_SECONDS * salles_active)
    budget = (_pass_budget(deadline, "passe 3 (demi-journées)", reserve3)
              if (reduce_half_days and half_terms) else 0.0)
    if budget >= MIN_PASS_SECONDS:
        model.Add(place_term >= best_placed)          # verrou : jamais moins de cours placés
        if day_used_by:
            best_days_p3 = int(round(sum(solver.Value(v) for v in day_used_by.values())))
            model.Add(sum(day_used_by.values()) <= best_days_p3)
        model.ClearHints()
        for li in range(len(courses)):
            model.AddHint(scheduled[li], solver.Value(scheduled[li]))
            model.AddHint(start[li], solver.Value(start[li]))
        model.Minimize(sum(half_terms))
        solver_half = cp_model.CpSolver()
        solver_half.parameters.max_time_in_seconds = budget
        status_half = solver_half.Solve(model)
        _log_pass_timing("passe 3 (demi-journées)", solver_half, status_half, budget)
        if status_half in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            solver = solver_half                      # extraire la solution reportée
        # provenOptimal reste basé sur placement_proven (passe 1).

    # ── Passe 4 : à placement ET passe-3 (demi-journées) FIGÉS, minimiser compacité + trou de midi. ──
    reserve4 = PASS5_RESERVE_SECONDS * salles_active
    budget = _pass_budget(deadline, "passe 4 (compacité)", reserve4) if penalty_terms else 0.0
    if budget >= MIN_PASS_SECONDS:
        model.Add(place_term >= best_placed)          # verrou : jamais moins de cours placés
        # Verrou des DEMI-JOURNÉES : l'en-tête ci-dessus annonce « passe-3 FIGÉS », mais rien ne
        # l'imposait — seul `place_term` était verrouillé, si bien que la compacité pouvait recréer
        # des demi-journées sous-utilisées que la passe 3 venait d'éliminer. MESURÉ sur le vrai
        # projet (2026-09-12) : 2 runs sur 4 dégradent, jusqu'à +5 demi-journées (S48 : 28 → 33).
        # Pourquoi c'est possible : pour un enseignant avec un cours A 8h-10h et un cours B plaçable
        # soit à 11h-12h (un seul bloc, idle intra 60 min × COMPACT_DAY_IDLE_WEIGHT=2 → 120), soit à
        # 13h30 (deux blocs, trou de midi 810−600−90 = 120 × 1 → 120), les deux pénalités sont
        # EXACTEMENT égales : le solveur est indifférent et peut choisir d'ajouter une demi-journée.
        # Posé même si la passe 3 a été sautée faute de budget : il signifie alors « ne pas empirer »,
        # ce que l'option cochée laisse légitimement attendre.
        if reduce_half_days and half_terms:
            best_half = int(round(sum(solver.Value(v) for v in half_terms)))
            model.Add(sum(half_terms) <= best_half)
        # Amorce (warm start) avec la solution de la passe précédente → convergence plus rapide.
        model.ClearHints()
        for li in range(len(courses)):
            model.AddHint(scheduled[li], solver.Value(scheduled[li]))
            model.AddHint(start[li], solver.Value(start[li]))
        model.Minimize(sum(penalty_terms))
        solver4 = cp_model.CpSolver()
        solver4.parameters.max_time_in_seconds = budget
        status4 = solver4.Solve(model)
        _log_pass_timing("passe 4 (compacité)", solver4, status4, budget)
        if status4 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            solver = solver4                          # extraire la solution optimisée
        # provenOptimal reste basé sur placement_proven (passe 1) — voir docstring de solve().

    # ── Passe 5 : à placement ET affectations non-salle FIGÉS, minimiser les changements de salle. ──
    # Post-traitement pur (préférence de grand confort, tout en bas de la hiérarchie). On GÈLE en dur
    # scheduled[], start[] et TOUS les littéraux non-salle aux valeurs de la passe précédente ; seul le
    # choix parmi les salles ALTERNATIVES reste libre. Toutes les douces antérieures ne dépendent que de
    # grandeurs gelées → strictement préservées (aucun verrou agrégé/dur nécessaire). À placement gelé,
    # l'ORDRE des cours de chaque prof est connu : on pénalise les VRAIES transitions entre cours
    # consécutifs d'une même demi-journée (fidèle, pas une borne). No-op si aucun cours n'a de salle
    # alternative influençable. provenOptimal reste basé sur placement_proven (passe 1).
    # Plafonnée à son forfait : polynomiale, elle n'a aucun usage du reliquat des passes amont.
    budget = (min(_pass_budget(deadline, "passe 5 (changements de salle)"), PASS5_RESERVE_SECONDS)
              if minimize_rooms else 0.0)
    if budget >= MIN_PASS_SECONDS:
        def _room_lits(li):                       # {rid: littéral} des salles candidates du cours li
            return {rid: lit for (rid, rtype, lit) in used_literals[li] if rtype == ROOM}

        def _has_alt_room(li):                     # au moins une salle candidate ≠ salle fixe (lit ≠ scheduled)
            return any(lit is not scheduled[li]
                       for (_, rtype, lit) in used_literals[li] if rtype == ROOM)

        # 1) Séquences consécutives par (prof effectif, jour, demi-journée), lues sur la solution GELÉE.
        # Même frontière que §1.3/§1.4 : pause résiduelle par (prof, jour) plutôt que `half_cut`
        # scalaire, pour ne pas ouvrir deux définitions contradictoires de « demi-journée » dans le
        # même fichier. Un straddler tombe côté après-midi (adjacent aux cours d'après-midi, c'est là
        # que la continuité de salle a du sens). Calcul en Python pur sur la solution gelée → aucun
        # coût solveur.
        seq = defaultdict(list)                    # (tid, d, h) -> [(start_val, li)]
        for li in range(len(courses)):
            if not solver.Value(scheduled[li]):
                continue
            sv = solver.Value(start[li])
            d = sv // 1440
            offset = sv - d * 1440
            for (rid, rtype, lit) in used_literals[li]:
                if rtype == TEACHER and solver.Value(lit):
                    if lunch is None:
                        h = 0 if offset < half_cut else 1
                    else:
                        p0, p1 = residual(rid, d)
                        h = 0 if (p1 == p0 or offset <= p0) else 1
                    seq[(rid, d, h)].append((sv, li))   # un cours multi-profs alimente chaque prof

        # 2) Paires consécutives INFLUENÇABLES → un booléen "au moins une salle commune choisie".
        same_vars = []
        for key, items in seq.items():
            items.sort()                            # ordre temporel = ordre réel (placement figé)
            for (_, i), (_, j) in zip(items, items[1:]):
                if not (_has_alt_room(i) or _has_alt_room(j)):
                    continue                        # deux salles fixes → issue constante, rien à optimiser
                ri, rj = _room_lits(i), _room_lits(j)
                shared = set(ri) & set(rj)
                if not shared:
                    continue                        # aucune salle commune → changement forcé (constant, omis)
                prods = []
                for r in shared:
                    b = model.NewBoolVar(f"rprod{i}_{j}_{r}")
                    model.AddBoolAnd([ri[r], rj[r]]).OnlyEnforceIf(b)          # b = (i choisit r) ∧ (j choisit r)
                    model.AddBoolOr([ri[r].Not(), rj[r].Not()]).OnlyEnforceIf(b.Not())
                    prods.append(b)
                same = model.NewBoolVar(f"rsame{i}_{j}")
                model.AddMaxEquality(same, prods)   # OR : au moins une salle commune choisie des deux côtés
                same_vars.append(same)

        if same_vars:                               # sinon rien d'influençable → passe entièrement sautée
            # 3) Gel DUR de tout SAUF les littéraux de salle.
            for li in range(len(courses)):
                model.Add(scheduled[li] == solver.Value(scheduled[li]))
                model.Add(start[li] == solver.Value(start[li]))
                for (rid, rtype, lit) in used_literals[li]:
                    if rtype != ROOM:
                        model.Add(lit == solver.Value(lit))
            # 4) Amorce (warm start) + minimisation du NB de changements = Σ (1 − même salle).
            model.ClearHints()
            for li in range(len(courses)):
                for (rid, rtype, lit) in used_literals[li]:
                    if rtype == ROOM:
                        model.AddHint(lit, solver.Value(lit))
            model.Minimize(len(same_vars) - sum(same_vars))
            solver5 = cp_model.CpSolver()
            solver5.parameters.max_time_in_seconds = budget
            status5 = solver5.Solve(model)
            _log_pass_timing("passe 5 (changements de salle)", solver5, status5, budget)
            if status5 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                solver = solver5                    # extraire la solution ré-affectée en salle

    # ---- Extraction de la solution ----
    placed_solutions = []
    dropped: list[tuple[int, dict]] = []
    for li, (gi, c) in enumerate(courses):
        if solver.Value(scheduled[li]):
            chosen = [{"id": rid, "type": rtype} for (rid, rtype, lit) in used_literals[li]
                      if solver.Value(lit)]
            tid = _task_id(c, counters[gi])
            placed_solutions.append(_task_json(c, tid, week, solver.Value(start[li]), chosen))
        else:
            dropped.append((gi, c))

    # ── Qualification des non-placés (§5.1 du plan). Trois situations, trois gestes différents ;
    #    l'ancien motif unique « contention/dépendance » ne tranchait même pas entre les deux.
    #    Ne tourne que sur les cours non placés — 5 sur 195 dans le cas qui a motivé ce chantier.
    occupancy = _enforced_occupancy(all_courses)
    constrained_ids = {k for k in (constraints or {}) if k != "Default"}
    dropped_local = {local[gi] for gi, _ in dropped}
    prereqs_of = defaultdict(list)
    for dep, pre in dependency_pairs:
        prereqs_of[dep].append(pre)

    neutralized = []
    for gi, c in dropped:
        li = local[gi]

        # 1. Infaisable en soi : aucun créneau ne convient, même sans concurrence des autres cours.
        diag = _diagnose_slots(c, rwin, occupancy, constrained_ids)
        if not diag["feasible"]:
            neutralized.append(_neutralized(c, counters[gi], week, rtype_of, "no-slot",
                                            _explain_no_slot(diag, c["duration"])))
            continue

        # 2. Entraîné : un prérequis CM→TD→TP est lui-même non placé. Le solveur n'avait pas le
        #    droit de placer celui-ci sans l'autre (AddImplication), donc la cause est en amont.
        blocking = [p for p in prereqs_of.get(li, []) if p in dropped_local]
        if blocking:
            pre = courses[blocking[0]][1]
            neutralized.append(_neutralized(
                c, counters[gi], week, rtype_of, "dependency",
                f'Non placé parce que son prérequis {pre.get("code")} {pre.get("type")} ne l\'est pas.'))
            continue

        # 3. Reste la vraie éviction. On annonce le nombre de créneaux candidats — un fait mesuré —
        #    sans prétendre dire lesquels : cela demanderait de rejouer un solve (§5.5, hors périmètre).
        neutralized.append(_neutralized(
            c, counters[gi], week, rtype_of, "contention",
            f'Plaçable en soi ({diag["slotCount"]} créneau(x) candidat(s)), mais le placer en '
            f'coûterait un autre : le moteur a préféré l\'inverse.'))

    for gi, c in excluded:
        neutralized.append(_neutralized(c, counters[gi], week, rtype_of, "excluded-type",
                                        f"Type « {c.get('type')} » exclu du moteur CP-SAT (pré-neutralisé)."))

    result = {
        "solutions": placed_solutions,
        # Complet AU REGARD DES DONNÉES SOUMISES (décision Frédéric, §6.4) : un type exclu du
        # moteur n'a jamais été soumis, il ne peut donc pas rendre le résultat incomplet.
        "isComplete": len(dropped) == 0,
        "score": len(placed_solutions),
        "provenOptimal": placement_proven,
    }
    if neutralized:
        result["neutralizedTasks"] = neutralized
    return [result]


def _neutralized(course, counter, week, rtype_of, reason_slug, reason):
    return {
        "task": _task_json(course, _task_id(course, counter), week, -1,
                           _candidate_resources(course, rtype_of)),
        "reason": reason,
        # Le slug était calculé puis jeté : le client en a besoin pour décider du rangement entre
        # NEUTRALISÉS et NON PLACÉS sans analyser une phrase (§5.2 de PlanDiagnosticEchec.md).
        "reasonSlug": reason_slug,
    }


def _empty_solution(all_courses, week, exclude_types, rtype_of, counters, status):
    """
    Aucune solution rendue. Deux situations OPPOSÉES que l'ancien message confondait (§5.3) :

    - `INFEASIBLE` : contradiction PROUVÉE. Allonger le délai n'y changera rien — il faut relâcher
      quelque chose. Seuls les cours imposés peuvent en être la cause : tous les autres portent un
      `scheduled` librement à 0, le solveur peut donc toujours renoncer à les placer.
    - `UNKNOWN` (ou toute autre issue) : budget épuisé avant d'avoir trouvé quoi que ce soit. Là,
      un délai plus long peut suffire.
    """
    infeasible = status == cp_model.INFEASIBLE
    if infeasible:
        reason = ("Aucune solution : les contraintes sont contradictoires (prouvé). Seuls les cours "
                  "imposés peuvent produire ce blocage — vérifiez leurs créneaux et leurs ressources.")
    else:
        reason = (f"Aucune solution trouvée dans le temps imparti "
                  f"({cp_model.CpSolver().StatusName(status)}) : le moteur n'a pas prouvé qu'il n'y "
                  f"en avait pas. Réessayez avec un délai plus long.")
    neutralized = [
        _neutralized(c, counters[i], week, rtype_of, "no-solution", reason)
        for i, c in enumerate(all_courses)
    ]
    return {"solutions": [], "isComplete": False, "score": 0,
            "provenOptimal": False,
            "noSolutionStatus": "infeasible" if infeasible else "unknown",
            "neutralizedTasks": neutralized}
