"""
Spike CP-SAT — étape 2 : vrai payload (semaine 36, jeu de démo scheduler-core).

Charge les données réelles (`packages/scheduler-core/src/json/{cours,resources,
contraintes}.json`), les traduit en modèle CP-SAT, résout « placer le maximum »,
et MESURE : taille du modèle, temps de résolution, tâches lâchées.

But : voir si la modélisation du spike jouet tient à l'échelle réelle (80 tâches),
et à quel ordre de grandeur de taille/temps. Reste isolé (aucune dépendance au repo
au-delà de la LECTURE des JSON). Fidélité de parsing calquée sur
`scheduler-common/src/availabilityManager.ts` et `taskUnit.bookEnforced()`.

Simplifications assumées (cohérent avec « chaque moteur pour ce qu'il est ») :
pas de lunch, pas de dépendances/groupes (absents de ce jeu : 0 taskGroupId).
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from ortools.sat.python import cp_model

sys.stdout.reconfigure(encoding="utf-8")

WEEK = 36
HORIZON = 7 * 1440
DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
DATA = Path(__file__).resolve().parents[2] / "packages" / "scheduler-core" / "src" / "json"

courses = json.loads((DATA / "cours.json").read_text(encoding="utf-8"))["courses"]
constraints = json.loads((DATA / "contraintes.json").read_text(encoding="utf-8"))

# ---------------------------------------------------------------------------
# Parsing des disponibilités — calqué sur availabilityManager.ts.
# jours FR → index (lundi=0), typo 'jeeudi' gérée ; timestamp = jour*1440 + h*60+m.
# ---------------------------------------------------------------------------
FR_DAY = {"lundi": 0, "mardi": 1, "mercredi": 2, "jeudi": 3, "jeeudi": 3,
          "vendredi": 4, "samedi": 5, "dimanche": 6}


def parse_days(s):
    return [FR_DAY[tok] for tok in re.split(r"[,\s]+", s.strip().lower()) if tok in FR_DAY]


def parse_time(t):
    parts = t.split(":")
    return int(parts[0]) * 60 + (int(parts[1]) if len(parts) > 1 and parts[1] else 0)


def slots_to_windows(slots):
    w = []
    for slot in slots or []:
        for d in parse_days(slot["days"]):
            s, e = d * 1440 + parse_time(slot["from"]), d * 1440 + parse_time(slot["to"])
            if e > s:
                w.append((s, e))
    return w


DEFAULT_SLOTS = constraints["Default"] if isinstance(constraints.get("Default"), list) else []
_missing = set()
_win_cache = {}


def resource_windows(rid):
    """Fenêtres de dispo (semaine 36) d'une ressource — réplique getAvailability(rid, 36)."""
    if rid in _win_cache:
        return _win_cache[rid]
    if rid not in constraints:
        _missing.add(rid)
        base = DEFAULT_SLOTS                       # ressource absente → Default (comme le warn TS)
    else:
        c = constraints[rid]
        if c is None:
            base = DEFAULT_SLOTS                    # null → Default
        elif isinstance(c, list):
            base = c                                # tableau brut → tel quel
        elif isinstance(c, dict):
            wk = c.get(f"S{WEEK}")
            if isinstance(wk, list):
                _win_cache[rid] = slots_to_windows(wk)   # override hebdo prioritaire
                return _win_cache[rid]
            base = c["default"] if isinstance(c.get("default"), list) else DEFAULT_SLOTS
        else:
            base = DEFAULT_SLOTS
    _win_cache[rid] = slots_to_windows(base)
    return _win_cache[rid]


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
    return cp_model.Domain.FromIntervals(ivs) if ivs else cp_model.Domain(1, 0)  # vide


# ---------------------------------------------------------------------------
# Construction du modèle.
# ---------------------------------------------------------------------------
model = cp_model.CpModel()
scheduled, start = {}, {}
uses = {}                                    # (i, slot_idx, rid) -> BoolVar (alternative)
intervals_by_res = defaultdict(list)
n_alt_slots = n_enforced = 0

for i, c in enumerate(courses):
    dur = c["duration"]
    scheduled[i] = model.NewBoolVar(f"sched_{i}")
    start[i] = model.NewIntVar(0, HORIZON, f"start_{i}")

    # --- Tâche imposée (enforced) : start + ressources fixes, ignore la dispo. ---
    if c.get("enforced"):
        n_enforced += 1
        e = c["enforced"]
        model.Add(scheduled[i] == 1)
        model.Add(start[i] == e["startTime"])
        for rid in list(e["teacher"]) + list(e["groups"]) + list(e["rooms"]):
            iv = model.NewOptionalFixedSizeIntervalVar(start[i], dur, scheduled[i], f"iv_{i}_{rid}")
            intervals_by_res[rid].append(iv)
        continue

    # --- Tâche normale : chaque slot est une ressource unique OU des alternatives. ---
    slots = []
    for entry in c.get("teacher", []) + c.get("groups", []) + c.get("rooms", []):
        slots.append(list(entry) if isinstance(entry, list) else [entry])

    fixed = [s[0] for s in slots if len(s) == 1]
    alts = [s for s in slots if len(s) > 1]

    # Début : intersection des dispos des ressources fixes (si la tâche est placée).
    fw = [(0, HORIZON)]
    for rid in fixed:
        fw = intersect(fw, resource_windows(rid))
    model.AddLinearExpressionInDomain(start[i], start_domain(fw, dur)).OnlyEnforceIf(scheduled[i])

    for rid in fixed:
        iv = model.NewOptionalFixedSizeIntervalVar(start[i], dur, scheduled[i], f"iv_{i}_{rid}")
        intervals_by_res[rid].append(iv)

    for si, slot in enumerate(alts):
        n_alt_slots += 1
        lits = []
        for rid in slot:
            lit = model.NewBoolVar(f"use_{i}_{si}_{rid}")
            uses[(i, si, rid)] = lit
            lits.append(lit)
            model.AddLinearExpressionInDomain(start[i], start_domain(resource_windows(rid), dur)) \
                 .OnlyEnforceIf(lit)
            iv = model.NewOptionalFixedSizeIntervalVar(start[i], dur, lit, f"iv_{i}_{si}_{rid}")
            intervals_by_res[rid].append(iv)
        model.Add(sum(lits) == scheduled[i])

for rid, ivs in intervals_by_res.items():
    if len(ivs) > 1:
        model.AddNoOverlap(ivs)

model.Maximize(sum(scheduled.values()))


# ---------------------------------------------------------------------------
# Résolution + rapport.
# ---------------------------------------------------------------------------
def fmt(m):
    d, rem = divmod(m, 1440)
    h, mn = divmod(rem, 60)
    return f"{DAYS_FR[d]} {h:02d}:{mn:02d}" if 0 <= d < 7 else f"j{d} {h:02d}:{mn:02d}"


solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = 30.0
status = solver.Solve(model)

proto = model.Proto()
print("=" * 68)
print(f"Payload : semaine {WEEK} — {len(courses)} tâches "
      f"({n_enforced} enforced, {n_alt_slots} slots à alternatives), "
      f"{len(intervals_by_res)} ressources")
print(f"Modèle  : {len(proto.variables)} variables, {len(proto.constraints)} contraintes")
print("-" * 68)
print(f"Statut  : {solver.StatusName(status)}   "
      f"(optimalité prouvée : {'OUI' if status == cp_model.OPTIMAL else 'non'})")
print(f"Placées : {int(solver.ObjectiveValue())} / {len(courses)}")
print(f"Temps   : {solver.WallTime() * 1000:.0f} ms   |   branches : {solver.NumBranches()}   "
      f"|   conflits : {solver.NumConflicts()}")
print("=" * 68)

if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    dropped = [(i, c) for i, c in enumerate(courses) if not solver.Value(scheduled[i])]
    if dropped:
        print(f"Tâches NON placées ({len(dropped)}) :")
        for i, c in dropped:
            grp = ",".join(str(g) for g in c.get("groups", []))
            print(f"  ❌ {c['code']:12} {c['type']:4} {c['duration']:>4}min  [{grp}]")
    else:
        print("Toutes les tâches sont placées. ✅")

if _missing:
    print("-" * 68)
    print(f"Ressources absentes des contraintes (→ Default) : {sorted(_missing)}")

# --- Diagnostic : l'instance est-elle tendue ou triviale ? -------------------
# Charge = Σ durées des tâches qui utilisent OBLIGATOIREMENT la ressource (slots
# fixes only) ; capacité = Σ largeurs de ses fenêtres de dispo. Un ratio proche de
# (ou > ) 1 prouve que les contraintes mordent — sinon l'instance est un walkover.
load = defaultdict(int)
for c in courses:
    if c.get("enforced"):
        e = c["enforced"]
        for rid in list(e["teacher"]) + list(e["groups"]) + list(e["rooms"]):
            load[rid] += c["duration"]
        continue
    for entry in c.get("teacher", []) + c.get("groups", []) + c.get("rooms", []):
        if not isinstance(entry, list):
            load[entry] += c["duration"]

rows = []
for rid, dem in load.items():
    cap = sum(e - s for s, e in resource_windows(rid))
    rows.append((dem / cap if cap else 99.0, rid, dem, cap))
rows.sort(reverse=True)
print("-" * 68)
print("Ressources les plus chargées (demande ferme / capacité dispo) :")
for ratio, rid, dem, cap in rows[:8]:
    print(f"  {ratio*100:5.0f}%   {rid:18} {dem:>4}min demandés / {cap:>4}min dispo")
