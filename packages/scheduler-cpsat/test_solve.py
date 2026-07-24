"""
Tests unitaires (pytest) du moteur CP-SAT.

- Cas jouet CM/TD/TP : contention (3/4 placées), intégrité de chaîne CM→TD, provenOptimal.
- `cpsat_runner._map_config` : rejet explicite d'une pause méridienne flottante.
"""

from __future__ import annotations

import pytest

import cpsat_runner
from cpsat_engine import EnforcedConflictError, solve

ALL_DAY = [{"days": "lundi mardi mercredi jeudi vendredi", "from": "08:00", "to": "18:00"}]
MONDAY_MORNING = [{"days": "lundi", "from": "08:00", "to": "09:00"}]  # 60 min pile


def _resources() -> list[dict]:
    return [
        {"resourceType": "teacher", "resources": [{"id": "T1"}, {"id": "T2"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]


def _toy_raw() -> dict:
    """
    C1/CM + C1/TD (dépendance, T1 dispo 08h-18h lun-ven → les deux tiennent) ;
    C2/CM et C3/CM contendent pour l'unique créneau de T2 (60 min, lundi 08h-09h)
    → exactement l'un des deux est évincé. Optimum attendu : 3/4 placées.
    """
    courses = [
        {"week": 38, "semester": 1, "level": 1, "code": "C1", "type": "CM",
         "teacher": ["T1"], "groups": ["G1"], "name": "C1 CM", "rooms": ["R1"], "duration": 60},
        {"week": 38, "semester": 1, "level": 1, "code": "C1", "type": "TD",
         "teacher": ["T1"], "groups": ["G1"], "name": "C1 TD", "rooms": ["R1"], "duration": 60},
        {"week": 38, "semester": 1, "level": 1, "code": "C2", "type": "CM",
         "teacher": ["T2"], "groups": ["G1"], "name": "C2 CM", "rooms": ["R1"], "duration": 60},
        {"week": 38, "semester": 1, "level": 1, "code": "C3", "type": "CM",
         "teacher": ["T2"], "groups": ["G1"], "name": "C3 CM", "rooms": ["R1"], "duration": 60},
    ]
    return {
        "week": 38,
        "resources": _resources(),
        "courses": courses,
        "constraints": {"Default": ALL_DAY, "T2": MONDAY_MORNING},
    }


def test_toy_cm_td_tp_contention_and_proven_optimal():
    raw = _toy_raw()
    sols = solve(raw, {"timeoutSeconds": 10})
    assert len(sols) == 1
    sol = sols[0]

    assert len(sol["solutions"]) == 3
    assert sol["isComplete"] is False
    assert sol["provenOptimal"] is True

    neutralized = sol.get("neutralizedTasks", [])
    assert len(neutralized) == 1
    assert neutralized[0]["reason"].startswith("Non plaçable")

    # C1 (CM+TD) tient entièrement dans la dispo de T1 ; exactement l'un de C2/C3 est
    # évincé par contention sur l'unique créneau de T2.
    placed_codes = [t["code"] for t in sol["solutions"]]
    assert placed_codes.count("C1") == 2
    assert len({"C2", "C3"} & set(placed_codes)) == 1


def test_chain_integrity_dependent_never_placed_without_prerequisite():
    """Intégrité de chaîne : si le TD (C1) est placé, le CM (C1) l'est aussi, après lui."""
    raw = _toy_raw()
    sols = solve(raw, {"timeoutSeconds": 10})
    sol = sols[0]

    by_code_type = {(t["code"], t["type"]): t for t in sol["solutions"]}
    if ("C1", "TD") in by_code_type:
        assert ("C1", "CM") in by_code_type, "TD placé sans son prérequis CM — intégrité de chaîne violée"
        cm, td = by_code_type[("C1", "CM")], by_code_type[("C1", "TD")]
        assert td["startTime"] >= cm["startTime"] + cm["duration"]


# ── Tâches enforced ──────────────────────────────────────────────────────────

def _enforced_resources() -> list[dict]:
    return [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}, {"id": "R2"}]},
    ]


def _enforced_base(courses: list[dict]) -> dict:
    return {"week": 1, "resources": _enforced_resources(), "courses": courses,
            "constraints": {r: ALL_DAY for r in ("T1", "G1", "R1", "R2")}}


def test_enforced_pinned_at_start_and_pushes_normal_task():
    """Un enforced est placé pile à son startTime avec ses ressources ; une normale en conflit bouge."""
    raw = _enforced_base([
        {"week": 1, "code": "X", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 480, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "Y", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": [["R1", "R2"]]},
    ])
    sol = solve(raw)[0]
    by = {(t["code"], t["type"]): t for t in sol["solutions"]}
    assert len(sol["solutions"]) == 2
    assert by[("X", "CM")]["startTime"] == 480
    assert by[("Y", "CM")]["startTime"] != 480  # évincée du créneau enforced


def test_enforced_dependent_ignores_auto_dependency_no_collapse():
    """
    Régression : un TP enforced ayant un TD frère (même code/groupes) ne doit PAS traîner le TD
    dans une chaîne auto qui rendrait le modèle infaisable. Les deux doivent être placés.
    """
    raw = _enforced_base([
        {"week": 1, "code": "M", "type": "TD", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": [["R1", "R2"]]},
        {"week": 1, "code": "M", "type": "TP", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 480, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
    ])
    sol = solve(raw)[0]
    assert len(sol["solutions"]) == 2, "l'enforced ne doit pas effondrer la semaine"
    by = {(t["code"], t["type"]): t for t in sol["solutions"]}
    assert by[("M", "TP")]["startTime"] == 480


def test_enforced_prerequisite_still_constrains_normal_dependent():
    """Un prérequis enforced reste une contrainte amont : le dépendant normal démarre après lui."""
    raw = _enforced_base([
        {"week": 1, "code": "M", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 600, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "M", "type": "TD", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": [["R1", "R2"]]},
    ])
    sol = solve(raw)[0]
    by = {(t["code"], t["type"]): t for t in sol["solutions"]}
    assert by[("M", "CM")]["startTime"] == 600
    assert by[("M", "TD")]["startTime"] >= 600 + 120


def test_conflicting_enforced_raises_clear_error_not_collapse():
    """Deux enforced en conflit dur → erreur ciblée (réplique validateEnforcedCourses), pas d'INFEASIBLE muet."""
    raw = _enforced_base([
        {"week": 1, "code": "X", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 480, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "Z", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 480, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
    ])
    with pytest.raises(EnforcedConflictError, match="Conflit entre cours enforced"):
        solve(raw)


def test_runner_map_config_rejects_floating_lunch_break():
    with pytest.raises(ValueError, match="pause flottante"):
        cpsat_runner._map_config({
            "lunchBreak": {"type": "floating", "duration": 60, "earliest": "12:00", "latest": "14:00"},
        })


def test_runner_map_config_accepts_fixed_lunch_break_and_ignores_core_only_fields():
    mapped = cpsat_runner._map_config({
        "lunchBreak": {"type": "fixed", "from": "12:00", "to": "13:30"},
        "ignoreDailyLimits": True,
        "timeoutSeconds": 42,
        "maxEliminations": 3,       # champ core-only, doit être ignoré silencieusement
        "postRepair": True,         # idem
    })
    assert mapped == {
        "lunchBreak": {"type": "fixed", "from": "12:00", "to": "13:30"},
        "ignoreDailyLimits": True,
        "timeoutSeconds": 42,
    }
