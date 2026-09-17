# -*- coding: utf-8 -*-
"""
§5.1, §5.3 et §6.4 de docs/PlanDiagnosticEchec.md — ce que le moteur RAPPORTE sur ses échecs.

Aucun de ces tests ne porte sur le placement lui-même : le chantier ne doit rien y changer.
Les assertions visent le `reasonSlug` (stable, destiné aux machines) plutôt que la phrase,
qui est de l'affichage et a vocation à évoluer.
"""

from __future__ import annotations

from cpsat_engine import solve

ALL_DAY = [{"days": "lundi mardi mercredi jeudi vendredi", "from": "08:00", "to": "18:00"}]
MONDAY_MORNING = [{"days": "lundi", "from": "08:00", "to": "09:00"}]

CONFIG = {"timeoutSeconds": 10}


def _resources() -> list[dict]:
    return [
        {"resourceType": "teacher", "resources": [{"id": "T1"}, {"id": "T2"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}, {"id": "G2"}]},
    ]


def _course(code: str, ctype: str, duration: int, teacher: str = "T1", **extra) -> dict:
    base = {"week": 38, "semester": 1, "level": 1, "code": code, "type": ctype,
            "name": f"{code} {ctype}", "teacher": [teacher], "groups": ["G1"],
            "rooms": ["R1"], "duration": duration}
    base.update(extra)
    return base


def _slugs(solution: dict) -> dict[str, str]:
    return {n["task"]["code"] + " " + n["task"]["type"]: n["reasonSlug"]
            for n in solution.get("neutralizedTasks", [])}


# ---------------------------------------------------------------------------
# §6.4 — complet AU REGARD DES DONNÉES SOUMISES (décision Frédéric 2026-09-17).
# ---------------------------------------------------------------------------
def test_excluded_type_does_not_make_result_incomplete():
    """Une Autonomie n'a jamais été soumise : elle ne peut pas rendre le résultat incomplet."""
    raw = {"week": 38, "resources": _resources(),
           "courses": [_course("C1", "CM", 60), _course("A1", "Autonomie", 60)],
           "constraints": {"Default": ALL_DAY}}
    sol = solve(raw, CONFIG)[0]

    assert len(sol["solutions"]) == 1
    assert sol["isComplete"] is True
    assert _slugs(sol) == {"A1 Autonomie": "excluded-type"}


def test_real_failure_still_makes_result_incomplete():
    """Garde-fou de la précédente : un vrai échec moteur doit toujours faire basculer isComplete."""
    raw = {"week": 38, "resources": _resources(),
           "courses": [_course("C2", "CM", 60, teacher="T2"),
                       _course("C3", "CM", 60, teacher="T2")],
           "constraints": {"Default": ALL_DAY, "T2": MONDAY_MORNING}}
    sol = solve(raw, CONFIG)[0]

    assert len(sol["solutions"]) == 1
    assert sol["isComplete"] is False


# ---------------------------------------------------------------------------
# §5.1 — trois situations, trois motifs. L'ancien moteur les confondait toutes.
# ---------------------------------------------------------------------------
def test_no_slot_names_the_enforced_course_holding_the_room():
    """
    Tout le monde n'a qu'un créneau (lundi 08h-09h) et un imposé y occupe l'unique salle.
    Le seul levier est donc la SALLE, et le message doit nommer le cours imposé qui la tient —
    c'est là toute la valeur ajoutée : le geste à faire est visible sans chercher.
    """
    only_slot = [{"days": "lundi", "from": "08:00", "to": "09:00"}]
    enforced = _course("BLOQ", "CM", 60, teacher="T1")
    enforced["enforced"] = {"startTime": 8 * 60, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
    raw = {"week": 38, "resources": _resources(),
           "courses": [enforced, _course("C2", "CM", 60, teacher="T2", groups=["G2"])],
           "constraints": {"Default": only_slot}}
    sol = solve(raw, CONFIG)[0]

    assert _slugs(sol) == {"C2 CM": "no-slot"}
    message = sol["neutralizedTasks"][0]["reason"]
    assert "Aucun créneau possible" in message
    assert "R1" in message                 # la ressource-levier
    assert "BLOQ CM" in message            # le cours imposé qui l'occupe


def test_dependency_slug_when_prerequisite_is_unplaced():
    """
    Le CM n'a aucun créneau ; son TD tombe avec lui par AddImplication. Le TD doit dire POURQUOI
    — « son prérequis n'est pas placé » — et non répéter un motif de contention générique.
    """
    # Le TD, lui, est parfaitement plaçable (T1 et G1 sont libres du mardi au vendredi) : s'il
    # ressort non placé, c'est UNIQUEMENT à cause de son CM. C'est ce que le motif doit dire.
    enforced = _course("BLOQ", "CM", 60, teacher="T1")
    enforced["enforced"] = {"startTime": 8 * 60, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
    raw = {"week": 38, "resources": _resources(),
           "courses": [enforced,
                       _course("C2", "CM", 60, teacher="T2"),
                       _course("C2", "TD", 60, teacher="T1")],
           "constraints": {"Default": ALL_DAY, "T2": MONDAY_MORNING}}
    sol = solve(raw, CONFIG)[0]

    assert _slugs(sol) == {"C2 CM": "no-slot", "C2 TD": "dependency"}
    td = next(n for n in sol["neutralizedTasks"] if n["task"]["type"] == "TD")
    assert "prérequis" in td["reason"]
    assert "C2 CM" in td["reason"]


def test_contention_slug_when_course_is_placeable_but_evicted():
    """Deux cours pour un seul créneau : le perdant est plaçable en soi, donc `contention`."""
    raw = {"week": 38, "resources": _resources(),
           "courses": [_course("C2", "CM", 60, teacher="T2"), _course("C3", "CM", 60, teacher="T2")],
           "constraints": {"Default": ALL_DAY, "T2": MONDAY_MORNING}}
    sol = solve(raw, CONFIG)[0]

    assert list(_slugs(sol).values()) == ["contention"]
    assert "Plaçable en soi" in sol["neutralizedTasks"][0]["reason"]
