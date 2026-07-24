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
  - enforced                  → start + ressources fixes imposés, ignore la dispo
  - dépendances CM→TD→TP      → SchedulerData._determineDependencies (par code + inclusion des groupes)
                                + intégrité de chaîne (un dépendant placé exige son prérequis placé)
  - taskGroups                → RawScheduleData.groups + CourseTaskData.taskGroupId
                                (parallel : départs égaux ; sequential : enchaînement sans gap)
  - maxDailyMinutes           → plafond quotidien par ressource (réification on_day)
  - pause méridienne fixe     → scheduler.ts _applyLunchBreak (retirée des seuls GROUP, lun-ven)

Assumé / hors périmètre (features core-only, écartées pour ce moteur) :
  - pause FLOTTANTE (modélise mal en CP-SAT figé) — seul 'fixed' est honoré ;
  - tâches `Autonomie` (pré-neutralisées en pratique) — exclues et rapportées comme neutralisées.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from ortools.sat.python import cp_model

HORIZON = 7 * 1440  # minutes depuis lundi 00:00, une semaine

# Types de ressources — mêmes chaînes que ResourceType (resource.ts).
TEACHER, ROOM, GROUP = "teacher", "room", "group"


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
      - timeoutSeconds   : float (défaut 30)
      - excludeTypes     : list[str] (défaut ['Autonomie']) — exclus et rapportés neutralisés
      - earliest         : bool (défaut False) — départage les optima en plaçant au plus tôt.
                           ATTENTION : transforme un optimum de placement souvent trivial (0 branche,
                           ~1 s) en une vraie optimisation combinatoire (bien plus lente). À n'activer
                           que si un placement déterministe « au plus tôt » est requis.
    """
    config = config or {}
    week = raw["week"]
    constraints = raw.get("constraints") or {}
    exclude_types = set(config.get("excludeTypes", ["Autonomie"]))
    ignore_daily = bool(config.get("ignoreDailyLimits", False))
    earliest = bool(config.get("earliest", False))

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

    rwin = _make_availability(constraints, week, group_ids, lunch)

    # Partition des cours : modélisés vs exclus (Autonomie…).
    all_courses = raw.get("courses", [])
    counters = {}                              # index course -> compteur 1-based (fidélité fallbackId)
    for i, c in enumerate(all_courses):
        counters[i] = i + 1
    courses = [(i, c) for i, c in enumerate(all_courses) if c.get("type") not in exclude_types]
    excluded = [(i, c) for i, c in enumerate(all_courses) if c.get("type") in exclude_types]

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
            # Enforced : start imposé, ressources fixes, ignore la dispo.
            model.Add(scheduled[li] == 1)
            model.Add(start[li] == e["startTime"])
            possible_days[li] = [e["startTime"] // 1440]
            for entries, rtype in ((e["teacher"], TEACHER), (e["groups"], GROUP), (e["rooms"], ROOM)):
                for rid in entries:
                    used_literals[li].append((rid, rtype_of.get(rid, rtype), scheduled[li]))
                    intervals_by_res[rid].append(
                        model.NewOptionalFixedSizeIntervalVar(start[li], dur, scheduled[li], f"iv{li}_{rid}"))
                    if rid in max_daily:
                        capped[li].append((rid, scheduled[li]))
            continue

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

    # Non-chevauchement par ressource.
    for rid, ivs in intervals_by_res.items():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    # Dépendances CM→TD→TP : précédence temporelle (conditionnée) + intégrité de chaîne.
    for gdep, gpre in _determine_dependencies([c for _, c in courses]):
        # _determine_dependencies raisonne sur la liste `courses` compacte → indices locaux directs.
        dep, pre = gdep, gpre
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

    # Objectif : maximiser le nombre de tâches placées ; départage lexicographique « au plus tôt ».
    place_term = sum(scheduled.values())
    if earliest and courses:
        weight = HORIZON * len(courses) + 1        # une tâche de plus bat tout gain d'avance
        model.Maximize(weight * place_term - sum(start.values()))
    else:
        model.Maximize(place_term)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(config.get("timeoutSeconds", 30.0))
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Aucune solution (rare : instance vide ou incohérente) — tout est neutralisé.
        return [_empty_solution(all_courses, week, exclude_types, rtype_of, counters, status)]

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

    neutralized = []
    for gi, c in dropped:
        neutralized.append(_neutralized(c, counters[gi], week, rtype_of, "cpsat-dropped",
                                        "Non plaçable : évincée par contention/dépendance (optimum CP-SAT)."))
    for gi, c in excluded:
        neutralized.append(_neutralized(c, counters[gi], week, rtype_of, "excluded-type",
                                        f"Type « {c.get('type')} » exclu du moteur CP-SAT (pré-neutralisé)."))

    result = {
        "solutions": placed_solutions,
        "isComplete": len(dropped) == 0 and len(excluded) == 0,
        "score": len(placed_solutions),
        "provenOptimal": status == cp_model.OPTIMAL,
    }
    if neutralized:
        result["neutralizedTasks"] = neutralized
    return [result]


def _neutralized(course, counter, week, rtype_of, reason_slug, reason):
    return {
        "task": _task_json(course, _task_id(course, counter), week, -1,
                           _candidate_resources(course, rtype_of)),
        "eliminationRound": 0,     # CP-SAT n'a pas d'élimination itérative ; champ conservé pour le contrat
        "failureCount": 0,
        "reason": reason,
    }


def _empty_solution(all_courses, week, exclude_types, rtype_of, counters, status):
    neutralized = [
        _neutralized(c, counters[i], week, rtype_of, "no-solution",
                     f"Aucune solution CP-SAT ({cp_model.CpSolver().StatusName(status)}).")
        for i, c in enumerate(all_courses)
    ]
    return {"solutions": [], "isComplete": False, "score": 0,
            "provenOptimal": False, "neutralizedTasks": neutralized}
