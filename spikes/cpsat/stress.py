"""
Spike CP-SAT — étape 3 : stress sur le VRAI projet (BUT MMI 2026-2027).

Données : packages/scheduler-core/data/BUT MMI 2026-2027_*.json (export projet réel).
On planifie les semaines 38 et 39, chacune avec une PAUSE MÉRIDIENNE FIXE
(12:00–13:30, puis 12:00–14:00) → 4 planifications.

Pause fixe : calquée sur scheduler.ts `_applyLunchBreak` — retirée de la dispo des
seules ressources GROUP, lundi→vendredi. Comme tout cours occupe un groupe, plus rien
ne tourne pendant la pause pour ce groupe.

Modélisé : dispos ressources, ressources alternatives, pause fixe, dépendances
CM→TD→TP par code (calqué sur schedulerData._determineDependencies : TD→CM et
TP→TD/CM par inclusion des groupes, + intégrité de chaîne), et PLAFONDS QUOTIDIENS
(maxDailyMinutes, réplique de scheduler._dailyLimitAllows, réification par jour). Les
tâches `Autonomie` sont ÉCARTÉES (pré-neutralisées en pratique, implaçables par nature).
Les `taskGroups` de weekSaves (parallèle : départs égaux ; séquentiel : sans gap) sont
modélisés en tout-ou-rien.

Non modélisé (assumé) : autres overlays manuels de weekSaves (manualEnforcedMap,
manualBlockedZones). Aucune dépendance au repo hors lecture JSON.
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from ortools.sat.python import cp_model

sys.stdout.reconfigure(encoding="utf-8")

HORIZON = 7 * 1440
DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
DATA = (Path(__file__).resolve().parents[2] / "packages" / "scheduler-core" / "data"
        / "BUT MMI 2026-2027_2026-07-23_18-29.json")

proj = json.loads(DATA.read_text(encoding="utf-8"))
ALL_COURSES = proj["allCourses"]
CONSTRAINTS = proj["constraints"]
GROUP_IDS = {r["id"] for g in proj["resources"] if g["resourceType"] == "group"
             for r in g["resources"]}
RES_META = {r["id"]: r for g in proj["resources"] for r in g["resources"]}
DEFAULT_SLOTS = CONSTRAINTS["Default"] if isinstance(CONSTRAINTS.get("Default"), list) else []


def daily_cap(rid, week):
    """Limite quotidienne effective — réplique resolveMaxDailyMinutes(r, week)."""
    m = RES_META.get(rid)
    if not m:
        return None
    return (m.get("weeklyMaxDailyMinutes") or {}).get(f"S{week}", m.get("maxDailyMinutes"))

FR_DAY = {"lundi": 0, "mardi": 1, "mercredi": 2, "jeudi": 3, "jeeudi": 3,
          "vendredi": 4, "samedi": 5, "dimanche": 6}


def parse_days(s):
    return [FR_DAY[t] for t in re.split(r"[,\s]+", s.strip().lower()) if t in FR_DAY]


def parse_time(t):
    p = str(t).split(":")
    return int(p[0]) * 60 + (int(p[1]) if len(p) > 1 and p[1] else 0)


def slots_to_windows(slots):
    w = []
    for slot in slots or []:
        for d in parse_days(slot["days"]):
            s, e = d * 1440 + parse_time(slot["from"]), d * 1440 + parse_time(slot["to"])
            if e > s:
                w.append((s, e))
    return w


def base_windows(rid, week):
    """Réplique AvailabilityManager.getAvailability(rid, week)."""
    if rid not in CONSTRAINTS:
        return slots_to_windows(DEFAULT_SLOTS)
    c = CONSTRAINTS[rid]
    if c is None:
        return slots_to_windows(DEFAULT_SLOTS)
    if isinstance(c, list):
        return slots_to_windows(c)
    if isinstance(c, dict):
        wk = c.get(f"S{week}")
        if isinstance(wk, list):
            return slots_to_windows(wk)
        return slots_to_windows(c["default"] if isinstance(c.get("default"), list) else DEFAULT_SLOTS)
    return slots_to_windows(DEFAULT_SLOTS)


def carve_lunch(windows, lunch):
    """Retire [from,to] de chaque jour lun-ven (removeAvailability sur les groupes)."""
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


def intersect(a, b):
    out = []
    for a0, a1 in a:
        for b0, b1 in b:
            lo, hi = max(a0, b0), min(a1, b1)
            if lo < hi:
                out.append((lo, hi))
    return out


def start_domain(windows, dur):
    ivs = [[s, e - dur] for (s, e) in windows if e - dur >= s]
    return cp_model.Domain.FromIntervals(ivs) if ivs else cp_model.Domain(1, 0)


def flatten(entries):
    out = []
    for e in entries or []:
        out.extend(e) if isinstance(e, list) else out.append(e)
    return out


def build_deps(courses):
    """Réplique schedulerData._determineDependencies : (dependent_idx, prereq_idx)."""
    by_code = defaultdict(list)
    for i, c in enumerate(courses):
        by_code[c["code"]].append(i)

    def groups_of(i):
        return set(flatten(courses[i].get("groups", [])))

    def find_dep(i, cands):
        gi = groups_of(i)
        if not gi:
            return None
        for j in cands:                       # premier candidat dont les groupes ⊇ ceux de i
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
                j = find_dep(i, cm)          # repli TP→CM si aucun TD ne correspond
            if j is not None:
                deps.append((i, j))
    return deps


def run(week, lunch, time_limit=60.0):
    # Autonomie écartée (pré-neutralisée en pratique, implaçable par nature).
    courses = [c for c in ALL_COURSES if c["week"] == week and c.get("type") != "Autonomie"]
    CAP = {rid: daily_cap(rid, week) for rid in RES_META if daily_cap(rid, week) is not None}
    cache = {}

    def rwin(rid):
        if rid not in cache:
            w = base_windows(rid, week)
            if rid in GROUP_IDS:
                w = carve_lunch(w, lunch)
            cache[rid] = w
        return cache[rid]

    model = cp_model.CpModel()
    scheduled, start = {}, {}
    intervals_by_res = defaultdict(list)
    uses_capped = defaultdict(list)    # i -> [(rid, use_literal)] pour ressources à plafond
    possible_days = {}                 # i -> jours (0-4) où la tâche peut démarrer

    for i, c in enumerate(courses):
        dur = c["duration"]
        scheduled[i] = model.NewBoolVar(f"s{i}")
        start[i] = model.NewIntVar(0, HORIZON, f"t{i}")

        slots = []
        for entry in c.get("teacher", []) + c.get("groups", []) + c.get("rooms", []):
            slots.append(list(entry) if isinstance(entry, list) else [entry])
        fixed = [s[0] for s in slots if len(s) == 1]
        alts = [s for s in slots if len(s) > 1]

        fw = [(0, HORIZON)]
        for rid in fixed:
            fw = intersect(fw, rwin(rid))
        model.AddLinearExpressionInDomain(start[i], start_domain(fw, dur)).OnlyEnforceIf(scheduled[i])
        possible_days[i] = sorted({s // 1440 for s, _ in fw if s // 1440 <= 4}) if fixed else list(range(5))
        for rid in fixed:
            intervals_by_res[rid].append(
                model.NewOptionalFixedSizeIntervalVar(start[i], dur, scheduled[i], f"iv{i}_{rid}"))
            if rid in CAP:
                uses_capped[i].append((rid, scheduled[i]))

        for si, slot in enumerate(alts):
            lits = []
            for rid in slot:
                lit = model.NewBoolVar(f"u{i}_{si}_{rid}")
                lits.append(lit)
                model.AddLinearExpressionInDomain(start[i], start_domain(rwin(rid), dur)).OnlyEnforceIf(lit)
                intervals_by_res[rid].append(
                    model.NewOptionalFixedSizeIntervalVar(start[i], dur, lit, f"iv{i}_{si}_{rid}"))
                if rid in CAP:
                    uses_capped[i].append((rid, lit))
            model.Add(sum(lits) == scheduled[i])

    for rid, ivs in intervals_by_res.items():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    # Dépendances CM→TD→TP : précédence temporelle + intégrité de chaîne
    # (un dépendant placé exige son prérequis placé).
    deps = build_deps(courses)
    for dep, pre in deps:
        model.Add(start[dep] >= start[pre] + courses[pre]["duration"]) \
             .OnlyEnforceIf([scheduled[dep], scheduled[pre]])
        model.AddImplication(scheduled[dep], scheduled[pre])

    # Plafonds quotidiens (maxDailyMinutes) — réplique scheduler._dailyLimitAllows :
    # par ressource à plafond et par jour, Σ durées des tâches l'utilisant ce jour ≤ cap.
    # Jour = floor(start/1440) ⇒ réification on_day (le point « fiddly » annoncé).
    on_day_cache = {}

    def on_day(i, d):
        if (i, d) not in on_day_cache:
            lo, hi = d * 1440, (d + 1) * 1440
            ge = model.NewBoolVar(f"ge{i}_{d}")
            model.Add(start[i] >= lo).OnlyEnforceIf(ge)
            model.Add(start[i] <= lo - 1).OnlyEnforceIf(ge.Not())
            lt = model.NewBoolVar(f"lt{i}_{d}")
            model.Add(start[i] <= hi - 1).OnlyEnforceIf(lt)
            model.Add(start[i] >= hi).OnlyEnforceIf(lt.Not())
            od = model.NewBoolVar(f"od{i}_{d}")
            model.AddBoolAnd([ge, lt]).OnlyEnforceIf(od)
            model.AddBoolOr([ge.Not(), lt.Not()]).OnlyEnforceIf(od.Not())
            on_day_cache[(i, d)] = od
        return on_day_cache[(i, d)]

    by_res_day = defaultdict(list)
    for i in range(len(courses)):
        for rid, lit in uses_capped[i]:
            for d in possible_days[i]:
                od = on_day(i, d)
                z = model.NewBoolVar(f"z{i}_{rid}_{d}")            # z = lit ∧ on_day
                model.AddBoolAnd([lit, od]).OnlyEnforceIf(z)
                model.AddBoolOr([lit.Not(), od.Not()]).OnlyEnforceIf(z.Not())
                by_res_day[(rid, d)].append(courses[i]["duration"] * z)
    for (rid, d), terms in by_res_day.items():
        model.Add(sum(terms) <= CAP[rid])

    # Groupes de tâches (weekSaves.taskGroups) : parallèle = départs égaux ; séquentiel =
    # enchaînement sans gap (ordre = courseKeys) ; placés en TOUT-OU-RIEN (l'unité).
    idmap = {c.get("id"): i for i, c in enumerate(courses)}
    group_specs = []
    for g in proj["weekSaves"].get(str(week), {}).get("taskGroups", []):
        members = [idmap[k] for k in g.get("courseKeys", []) if k in idmap]
        if len(members) < 2:
            continue
        group_specs.append((g["type"], members))
        m0 = members[0]
        for m in members[1:]:
            model.Add(scheduled[m] == scheduled[m0])                       # tout-ou-rien
        if g["type"] == "parallel":
            for m in members[1:]:
                model.Add(start[m] == start[m0])                          # départs égaux
        elif g["type"] == "sequential":
            for a, b in zip(members, members[1:]):
                model.Add(start[b] == start[a] + courses[a]["duration"])  # sans gap, dans l'ordre

    model.Maximize(sum(scheduled.values()))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    status = solver.Solve(model)

    dropped = [c for i, c in enumerate(courses) if not solver.Value(scheduled[i])]

    # Vérification : dans la solution, les groupes placés respectent-ils leur sémantique ?
    groups_ok, example = True, None
    for gtype, members in group_specs:
        if not all(solver.Value(scheduled[m]) for m in members):
            continue
        starts = [solver.Value(start[m]) for m in members]
        if gtype == "parallel":
            ok = len(set(starts)) == 1
        else:
            ok = all(starts[k + 1] == starts[k] + courses[members[k]]["duration"]
                     for k in range(len(members) - 1))
        groups_ok = groups_ok and ok
        if gtype == "sequential":       # on garde le séquentiel comme exemple parlant
            example = (gtype, [(courses[m]["code"], courses[m]["type"],
                               courses[m]["duration"], starts[j]) for j, m in enumerate(members)])

    proto = model.Proto()
    return {
        "groups_ok": groups_ok, "example": example,
        "week": week, "lunch": lunch, "n": len(courses),
        "placed": int(solver.ObjectiveValue()), "status": solver.StatusName(status),
        "optimal": status == cp_model.OPTIMAL,
        "ms": solver.WallTime() * 1000, "branches": solver.NumBranches(),
        "conflicts": solver.NumConflicts(),
        "vars": len(proto.variables), "cons": len(proto.constraints),
        "deps": len(deps), "caps": len(CAP), "groups": len(group_specs), "dropped": dropped,
    }


def fmt(m):
    d, rem = divmod(m, 1440)
    h, mn = divmod(rem, 60)
    return f"{DAYS_FR[d]} {h:02d}:{mn:02d}" if 0 <= d < 7 else f"j{d} {h:02d}:{mn:02d}"


def lunch_label(lunch):
    if lunch is None:
        return "aucune"
    f, t = lunch
    return f"{f//60:02d}:{f%60:02d}–{t//60:02d}:{t%60:02d}"


LUNCHES = [(parse_time("12:00"), parse_time("13:30")),
           (parse_time("12:00"), parse_time("14:00"))]

results = []
for week in (38, 39):
    for lunch in LUNCHES:
        print(f"⏳ Résolution S{week} / pause {lunch_label(lunch)} …", flush=True)
        results.append(run(week, lunch))

print("\n" + "=" * 78)
print(f"{'Sem':>4} | {'Pause':^12} | {'Placées':^11} | {'Statut':^9} | {'Temps':>8} | "
      f"{'branch':>7} | {'confl':>6}")
print("-" * 78)
for r in results:
    print(f"S{r['week']:>3} | {lunch_label(r['lunch']):^12} | "
          f"{r['placed']:>3}/{r['n']:<3} lâ{r['n']-r['placed']:>2} | "
          f"{'OPT' if r['optimal'] else r['status'][:9]:^9} | {r['ms']:>6.0f}ms | "
          f"{r['branches']:>7} | {r['conflicts']:>6}")
print("=" * 78)
print(f"(Autonomie écartée ; S38 ~ {results[0]['vars']} vars / {results[0]['cons']} contraintes, "
      f"{results[0]['deps']} dépendances CM→TD→TP, {results[0]['caps']} ressources à plafond, "
      f"{results[0]['groups']} taskGroups ; S39 : {results[2]['deps']} dép., {results[2]['groups']} taskGroups)")

allok = all(r["groups_ok"] for r in results)
print(f"Vérif. groupes dans la solution (départs égaux / enchaînés) : "
      f"{'✅ tous conformes' if allok else '❌ VIOLATION'}")
ex = next((r["example"] for r in results if r["example"]), None)
if ex:
    _, members = ex
    chain = "  →  ".join(f"{code}/{typ} [{fmt(st)}, {fmt(st+dur)}]" for code, typ, dur, st in members)
    print(f"Exemple séquentiel (enchaînement sans gap) : {chain}")

# Détail des tâches lâchées : distinguer « trop longues » (infaisables par nature)
# des évictions par contention/pause.
for r in results:
    drp = r["dropped"]
    if not drp:
        continue
    durs = Counter(c["duration"] for c in drp)
    longs = [c for c in drp if c["duration"] >= 690]   # > plus large journée dispo
    print(f"\nS{r['week']} / pause {lunch_label(r['lunch'])} — {len(drp)} lâchée(s) ; "
          f"durées {dict(sorted(durs.items()))}")
    if longs:
        print(f"    dont {len(longs)} structurellement trop longue(s) (≥690min) : "
              f"{', '.join(sorted({c['code'] for c in longs}))}")
    autres = [c for c in drp if c["duration"] < 690]
    if autres:
        ex = ", ".join(f"{c['code']}/{c['type']}({c['duration']})" for c in autres[:8])
        print(f"    évincées par contention/pause : {ex}{' …' if len(autres) > 8 else ''}")
