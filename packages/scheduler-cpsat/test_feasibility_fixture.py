# -*- coding: utf-8 -*-
"""
Verrou de la duplication TS/Python — §3.3 de docs/PlanDiagnosticEchec.md.

Jumeau de `scheduler-client/__tests__/courseSlotFeasibility.test.ts` : les deux consomment la
MÊME fixture. Si les deux implémentations du calcul de faisabilité divergent, l'un des deux casse.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cpsat_engine import (
    _diagnose_slots,
    _enforced_occupancy,
    _explain_no_slot,
    _make_availability,
    _parse_time,
)

FIXTURE = Path(__file__).resolve().parents[2] / "docs" / "fixtures" / "feasibility-s40.json"


@pytest.fixture(scope="module")
def fx() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def ctx(fx):
    rwin = _make_availability(
        fx["constraints"], fx["week"], set(fx["groupIds"]),
        (_parse_time(fx["lunch"]["from"]), _parse_time(fx["lunch"]["to"])),
    )
    occupancy = _enforced_occupancy(fx["courses"])
    constrained = {k for k in fx["constraints"] if k != "Default"}
    by_id = {c["id"]: c for c in fx["courses"]}
    return rwin, occupancy, constrained, by_id


def _diag(ctx, course_id):
    rwin, occupancy, constrained, by_id = ctx
    return by_id[course_id], _diagnose_slots(by_id[course_id], rwin, occupancy, constrained)


def test_fixture_cases_match_expected(fx, ctx):
    """Chaque cas de la fixture, verdict et leviers compris."""
    for case in fx["cases"]:
        _course, diag = _diag(ctx, case["courseId"])
        expected = case["expected"]
        assert diag["feasible"] is expected["feasible"], case["label"]
        assert diag["slotCount"] == expected["slotCount"], case["label"]

        got = [{"kind": l["entry"]["kind"], "ids": l["entry"]["ids"],
                "inheritsDefault": l["entry"]["inheritsDefault"], "slots": l["slots"],
                "blockedBy": [{"code": b["code"], "type": b["type"],
                               "start": b["start"], "end": b["end"]} for b in l["blockedBy"]]}
               for l in diag["levers"]]
        assert got == expected["levers"], case["label"]


def test_no_lever_case_accuses_nobody(ctx):
    """§3.2 — aucune ressource ne suffit seule : ne désigner personne est la seule réponse juste."""
    course, diag = _diag(ctx, "synth-no-lever")
    assert diag["feasible"] is False
    assert diag["levers"] == []

    message = _explain_no_slot(diag, course["duration"])
    assert "aucune ressource ne suffit seule" in message
    assert "sans " not in message          # « sans X, le cours tiendrait » serait faux ici


def test_inherits_default_is_reported(ctx):
    """§3.3.1 — nommer l'héritage, sinon l'utilisateur cherche une contrainte inexistante."""
    course, diag = _diag(ctx, "19zf4jd")
    assert len(diag["levers"]) == 1
    lever = diag["levers"][0]
    assert lever["entry"]["ids"] == ["AMPHI B"]
    assert lever["entry"]["inheritsDefault"] is True
    # La ressource doit être NOMMÉE : la parenthèse suit le cours imposé, donc une formulation
    # anonyme se rattache visuellement à lui (retour de test Frédéric).
    assert ("AMPHI B n'a pas de contrainte spécifique, hérite des contraintes par Défaut"
            in _explain_no_slot(diag, course["duration"]))


def test_second_sentence_starts_with_a_capital(ctx):
    course, diag = _diag(ctx, "19zf4jd")
    assert "calendrier. Sans " in _explain_no_slot(diag, course["duration"])


def test_blocking_enforced_course_is_named(ctx):
    course, diag = _diag(ctx, "19zf4jd")
    message = _explain_no_slot(diag, course["duration"])
    assert "AMPHI B" in message
    assert "jeudi 08h30–12h30" in message
    assert "R3.GEMA.14 CM" in message


def test_lunch_break_carved_on_groups_only():
    """
    §3.1 — la pause ne réduit QUE les groupes (`if rid in group_ids`). Divergence la plus probable
    avec le client, parce qu'elle est contre-intuitive : la tester des deux côtés.
    """
    constraints = {"Default": [{"days": "lundi", "from": "08:00", "to": "18:00"}]}
    course = {"code": "X", "name": "X", "type": "CM", "duration": 240,
              "teacher": ["PROF"], "groups": [], "rooms": []}
    lunch = (_parse_time("12:00"), _parse_time("13:30"))

    as_teacher = _make_availability(constraints, 40, set(), lunch)
    as_group = _make_availability(constraints, 40, {"PROF"}, lunch)

    teacher_diag = _diagnose_slots(course, as_teacher, {}, set())
    group_diag = _diagnose_slots(course, as_group, {}, set())

    assert teacher_diag["slotCount"] == 13          # 08:00 → 14:00 par pas de 30 min
    assert group_diag["slotCount"] < teacher_diag["slotCount"]
