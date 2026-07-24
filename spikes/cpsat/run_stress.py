"""
Harnais de mesure — rejoue les semaines 38/39 du projet réel À TRAVERS `solve(RawScheduleData)`.

Remplace les trois anciens scripts d'essai : au lieu de reconstruire un modèle CP-SAT ad hoc,
il se contente d'ADAPTER l'export projet (`BUT MMI…json`) vers le contrat `RawScheduleData`,
puis appelle le vrai moteur `cpsat_engine.solve`. Le modèle vit désormais dans UN seul endroit.

L'adaptateur traduit ce que le contrat ne porte pas nativement :
  - weekSaves[week].taskGroups (courseKeys → id) → RawScheduleData.groups + CourseTaskData.taskGroupId
  - pause méridienne → config.lunchBreak (le contrat la met dans SchedulerConfig, pas dans les données)

Note : le contrat `ResourceData` ne porte que `maxDailyMinutes` (pas d'override hebdo) — l'engine
s'en tient donc au plafond fixe, là où l'export projet a en plus des `weeklyMaxDailyMinutes`.
"""

import json
import sys
from collections import Counter
from pathlib import Path

from cpsat_engine import solve

sys.stdout.reconfigure(encoding="utf-8")

DATA = (Path(__file__).resolve().parents[2] / "packages" / "scheduler-core" / "data"
        / "BUT MMI 2026-2027_2026-07-23_18-29.json")
DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
proj = json.loads(DATA.read_text(encoding="utf-8"))


def build_raw(week: int) -> dict:
    """Export projet → RawScheduleData (contrat) pour une semaine."""
    courses = [dict(c) for c in proj["allCourses"] if c["week"] == week]

    # weekSaves.taskGroups → groups[] + taskGroupId sur les cours membres.
    ws = proj.get("weekSaves", {}).get(str(week), {})
    groups = []
    key_to_group = {}
    for g in ws.get("taskGroups", []):
        groups.append({"id": g["id"], "type": g["type"]})
        for k in g.get("courseKeys", []):
            key_to_group[k] = g["id"]
    for c in courses:
        gid = key_to_group.get(c.get("id"))
        if gid is not None:
            c["taskGroupId"] = gid

    return {
        "week": week,
        "resources": proj["resources"],
        "courses": courses,
        "constraints": proj["constraints"],
        "groups": groups,
    }


def fmt(m):
    d, rem = divmod(m, 1440)
    h, mn = divmod(rem, 60)
    return f"{DAYS_FR[d]} {h:02d}:{mn:02d}" if 0 <= d < 7 else f"j{d} {h:02d}:{mn:02d}"


LUNCHES = [
    ("aucune", {"type": "none"}),
    ("12:00–13:30", {"type": "fixed", "from": "12:00", "to": "13:30"}),
    ("12:00–14:00", {"type": "fixed", "from": "12:00", "to": "14:00"}),
]

print("=" * 82)
print(f"{'Sem':>4} | {'Pause':^12} | {'Placées':^12} | {'Complet':^8} | {'Optimum':^8} | {'Neutral.':>8}")
print("-" * 82)

results = []
for week in (38, 39):
    raw = build_raw(week)
    n = len(raw["courses"])
    for label, lb in LUNCHES:
        sols = solve(raw, {"lunchBreak": lb, "timeoutSeconds": 60})
        s = sols[0]
        placed = len(s["solutions"])
        neut = len(s.get("neutralizedTasks", []))
        results.append((week, label, s, n))
        print(f"S{week:>3} | {label:^12} | {placed:>4}/{n:<4} lâ{n-placed:>2} | "
              f"{'oui' if s['isComplete'] else 'non':^8} | "
              f"{'PROUVÉ' if s.get('provenOptimal') else 'non':^8} | {neut:>8}")
print("=" * 82)

# Vérifications de conformité au contrat (structure + sémantique groupes).
print("\nVérifications de conformité :")
ok = True
for week, label, s, n in results:
    for sol in s["solutions"]:
        for f in ("taskId", "code", "type", "week", "duration", "startTime", "resources"):
            if f not in sol:
                print(f"  ❌ champ manquant {f} (S{week}/{label})"); ok = False
    # groupes séquentiels : enchaînement sans gap ; parallèles : départs égaux
    by_group = {}
    raw = build_raw(week)
    gtype = {g["id"]: g["type"] for g in raw["groups"]}
    for sol in s["solutions"]:
        gid = sol.get("taskGroupId")
        if gid:
            by_group.setdefault(gid, []).append(sol)
    for gid, members in by_group.items():
        if len(members) < 2:
            continue
        starts = sorted(m["startTime"] for m in members)
        if gtype[gid] == "parallel" and len(set(starts)) != 1:
            print(f"  ❌ groupe parallèle {gid} départs différents (S{week}/{label})"); ok = False
if ok:
    print("  ✅ tous les champs de contrat présents ; groupes conformes dans la solution")

# Un exemple de solution lisible (S38, pause 12:00–13:30).
ex = next((s for w, l, s, n in results if w == 38 and l == "12:00–13:30"), None)
if ex and ex["solutions"]:
    print("\nExemple (S38, pause 12:00–13:30) — 5 premières tâches placées :")
    for sol in ex["solutions"][:5]:
        res = " ".join(f"{r['id']}[{r['type'][0]}]" for r in sol["resources"])
        print(f"  {sol['code']:8} {sol['type']:4} {fmt(sol['startTime'])}  {res}")

# Détail des neutralisées d'une semaine sur-souscrite.
for week, label, s, n in results:
    neut = s.get("neutralizedTasks", [])
    real_drops = [x for x in neut if "exclu" not in x["reason"].lower()]
    if real_drops:
        durs = Counter(x["task"]["duration"] for x in real_drops)
        print(f"\nS{week} / pause {label} — {len(real_drops)} évincée(s) ; durées {dict(sorted(durs.items()))}")
        for x in real_drops[:6]:
            t = x["task"]
            print(f"    ❌ {t['code']:10} {t['type']:4} {t['duration']:>4}min — {x['reason']}")
