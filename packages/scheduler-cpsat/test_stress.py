"""
Test de parité (pytest) — rejoue les semaines 38/39 du projet réel À TRAVERS `solve()` et
vérifie les résultats de référence mesurés lors du spike (README §Résultats de parité).

Hors CI par défaut si les données réelles sont absentes (`skip` conditionnel) — voir
`DATA.exists()` ci-dessous. Sinon, exécuté par `pytest` comme les autres tests unitaires.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cpsat_engine import solve

# Export de référence des mesures de parité S38/S39 (README §Résultats de parité). Local et
# gitignoré : absent en CI et sur les postes qui ont mis à jour leurs données → les tests qui en
# dépendent se skippent INDIVIDUELLEMENT (décorateur ci-dessous), et non plus au niveau module —
# sinon un skip global masquerait aussi les tests basés sur un autre export (ex. S48 plus bas).
DATA = (Path(__file__).resolve().parents[2] / "packages" / "scheduler-core" / "data"
        / "BUT MMI 2026-2027_2026-07-23_18-29.json")

_skip_if_no_data = pytest.mark.skipif(not DATA.exists(), reason=f"données réelles absentes : {DATA}")


def _build_raw(proj: dict, week: int) -> dict:
    """
    Export projet → RawScheduleData (contrat) pour une semaine, tel que le client l'envoie.

    Réplique fidèlement `scheduleApi.ts::_buildPayload`, y compris deux étapes indispensables sur
    les exports récents (sans effet — idempotentes — sur les anciens où elles ne s'appliquent pas) :
      - filtre des `preNeutralizedKeys` (cours exclus manuellement, jamais envoyés au moteur) ;
      - résolution du `Default` par-semaine (dict `{Sxx, default}` → tableau plat pour `week`).
    Sans la 2e étape, les ressources dont la dispo retombe sur `Default` reçoivent des fenêtres
    vides et « disparaissent » → faux sous-placement (piège documenté, mémoire `cpsat-second-engine`).
    """
    courses = [dict(c) for c in proj["allCourses"] if c["week"] == week]

    # weekSaves.taskGroups → groups[] + taskGroupId sur les cours membres.
    ws = proj.get("weekSaves", {}).get(str(week), {})

    # preNeutralizedKeys → cours exclus manuellement, retirés avant envoi (comme le client).
    pre_neutralized = set(ws.get("preNeutralizedKeys", []))
    courses = [c for c in courses if c.get("id") not in pre_neutralized]

    groups = []
    key_to_group = {}
    for g in ws.get("taskGroups", []):
        groups.append({"id": g["id"], "type": g["type"]})
        for k in g.get("courseKeys", []):
            key_to_group[k] = g["id"]

    # weekSaves.manualEnforcedMap → CourseTaskData.enforced (fusion par id, comme _buildPayload client).
    enforced_map = ws.get("manualEnforcedMap", {}) or {}
    for c in courses:
        gid = key_to_group.get(c.get("id"))
        if gid is not None:
            c["taskGroupId"] = gid
        e = enforced_map.get(c.get("id"))
        if e is not None:
            c["enforced"] = e

    # Default par-semaine (dict) → tableau plat pour `week` (no-op si déjà un tableau).
    constraints = dict(proj["constraints"])
    default = constraints.get("Default")
    if default is not None and not isinstance(default, list):
        constraints["Default"] = default.get(f"S{week}") or default.get("default") or []

    return {
        "week": week,
        "resources": proj["resources"],
        "courses": courses,
        "constraints": constraints,
        "groups": groups,
    }


@pytest.fixture(scope="module")
def project() -> dict:
    return json.loads(DATA.read_text(encoding="utf-8"))


# (semaine, libellé pause, config lunchBreak, placées attendues)
# Référence : README §Résultats de parité. `courses` inclut les `Autonomie` (exclues du modèle,
# cf. `excludeTypes`) — le nombre TOTAL de cours exportés n'est donc pas l'invariant testé ici ;
# ce sont les compteurs PLACÉES qui font foi (stables, indépendants du volume d'Autonomie exporté).
CASES = [
    (38, "aucune",       {"type": "none"},                                 110),
    (38, "12:00-13:30",  {"type": "fixed", "from": "12:00", "to": "13:30"}, 110),
    (38, "12:00-14:00",  {"type": "fixed", "from": "12:00", "to": "14:00"}, 110),
    (39, "aucune",       {"type": "none"},                                 102),
    (39, "12:00-13:30",  {"type": "fixed", "from": "12:00", "to": "13:30"}, 102),
    (39, "12:00-14:00",  {"type": "fixed", "from": "12:00", "to": "14:00"}, 101),
]


@_skip_if_no_data
@pytest.mark.parametrize("week,label,lunch,expected_placed", CASES)
def test_parity_with_spike_measurements(project, week, label, lunch, expected_placed):
    raw = _build_raw(project, week)

    sols = solve(raw, {"lunchBreak": lunch, "timeoutSeconds": 60})
    sol = sols[0]

    assert len(sol["solutions"]) == expected_placed, f"S{week} / {label}"
    assert sol["provenOptimal"] is True, f"S{week} / {label} — optimum non prouvé"


@_skip_if_no_data
@pytest.mark.parametrize("week", [38, 39])
def test_contract_fields_and_group_semantics(project, week):
    raw = _build_raw(project, week)
    sols = solve(raw, {"lunchBreak": {"type": "fixed", "from": "12:00", "to": "13:30"}, "timeoutSeconds": 60})
    sol = sols[0]

    required_fields = ("taskId", "code", "type", "week", "duration", "startTime", "resources")
    for task in sol["solutions"]:
        for field in required_fields:
            assert field in task

    gtype_of = {g["id"]: g["type"] for g in raw["groups"]}
    by_group: dict[str, list[dict]] = {}
    for task in sol["solutions"]:
        gid = task.get("taskGroupId")
        if gid:
            by_group.setdefault(gid, []).append(task)

    for gid, members in by_group.items():
        if len(members) < 2:
            continue
        starts = sorted(m["startTime"] for m in members)
        if gtype_of[gid] == "parallel":
            assert len(set(starts)) == 1, f"groupe parallèle {gid} : départs différents"


# ── Parité groupTeacherHalfDays sur données réelles (S48) ───────────────────────────────────────
# Hors CI par défaut si les données réelles sont absentes — même patron de skip que ci-dessus,
# fichier distinct car issu d'un export projet postérieur (2026-07-24_23-19).

DATA_S48 = (Path(__file__).resolve().parents[2] / "packages" / "scheduler-core" / "data"
            / "BUT MMI 2026-2027_2026-07-24_23-19.json")


@pytest.mark.skipif(not DATA_S48.exists(), reason=f"données réelles absentes : {DATA_S48}")
@pytest.mark.parametrize("group_teacher", [False, True])
def test_parity_group_teacher_half_days_s48(group_teacher):
    """
    Rejoue S48 avec et sans `groupTeacherHalfDays` : le nombre de cours placés doit rester
    120 (inchangé) et l'optimum de placement rester prouvé, avec ou sans la préférence douce.
    """
    project = json.loads(DATA_S48.read_text(encoding="utf-8"))
    raw = _build_raw(project, 48)

    sols = solve(raw, {"timeoutSeconds": 60, "groupTeacherHalfDays": group_teacher})
    sol = sols[0]

    assert len(sol["solutions"]) == 120
    assert sol["provenOptimal"] is True
