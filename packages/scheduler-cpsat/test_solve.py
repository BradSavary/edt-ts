"""
Tests unitaires (pytest) du moteur CP-SAT.

- Cas jouet CM/TD/TP : contention (3/4 placées), intégrité de chaîne CM→TD, provenOptimal.
- `cpsat_runner._map_config` : rejet explicite d'une pause méridienne flottante.
"""

from __future__ import annotations

import pytest
from ortools.sat.python import cp_model

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


def test_enforced_ignores_max_daily_minutes_no_collapse():
    """
    Régression : deux enforced sur la même ressource/jour dépassant à eux seuls son
    maxDailyMinutes ne doivent PAS rendre le modèle INFEASIBLE — réplique bookEnforced()
    côté core, qui n'appelle jamais _addDailyUsage() (un enforced est sous la
    responsabilité de l'utilisateur, dépassements compris).
    """
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1", "maxDailyMinutes": 180}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}, {"id": "R2"}]},
    ]
    raw = {"week": 1, "resources": resources, "courses": [
        {"week": 1, "code": "X", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 480, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "Y", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R2"],
         "enforced": {"startTime": 600, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R2"]}},
    ], "constraints": {r: ALL_DAY for r in ("T1", "G1", "R1", "R2")}}

    sol = solve(raw)[0]
    assert len(sol["solutions"]) == 2, "les enforced ne doivent pas effondrer la semaine malgré le dépassement"
    by = {t["code"]: t for t in sol["solutions"]}
    assert by["X"]["startTime"] == 480
    assert by["Y"]["startTime"] == 600


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


# ── Préférences douces enseignant (compacité / moins de jours) — passe 2 lexicographique ─────────

def test_compact_half_days_removes_gap_within_block():
    """
    Compacité : 2 cours d'un même enseignant contraints à une seule matinée (dispo lundi 08:00-11:00,
    180 min pour 2×60) → un trou de 60 min est POSSIBLE sans l'option ; avec, les cours sont collés.
    """
    monday_morning = [{"days": "lundi", "from": "08:00", "to": "11:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": "C1", "type": "CM", "name": "C1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "C2", "type": "CM", "name": "C2", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": monday_morning, "G1": monday_morning, "R1": monday_morning}}

    sol = solve(raw, {"timeoutSeconds": 10, "compactTeacherHalfDays": True,
                      "lunchBreak": {"type": "fixed", "from": "12:00", "to": "13:30"}})[0]

    assert len(sol["solutions"]) == 2
    starts = sorted(t["startTime"] for t in sol["solutions"])
    assert starts[1] - starts[0] == 60, "les 2 cours doivent être collés (aucun temps mort)"


def test_compact_allows_morning_and_afternoon_same_day():
    """
    Compacité n'interdit PAS d'être présent matin ET après-midi : 2 cours qui ne tiennent pas dans
    une seule demi-journée (maxDailyMinutes n'est pas en cause ici — c'est la pause qui coupe) sont
    placés sans erreur, l'un le matin l'autre l'après-midi si besoin, sans pénalité parasite.
    """
    monday_all_day = [{"days": "lundi", "from": "08:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    # Deux blocs de 4h : ne peuvent pas cohabiter dans une même demi-journée (pause 12:00-13:30).
    courses = [
        {"week": 1, "code": "C1", "type": "CM", "name": "C1", "duration": 240,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "C2", "type": "CM", "name": "C2", "duration": 240,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": monday_all_day, "G1": monday_all_day, "R1": monday_all_day}}

    sol = solve(raw, {"timeoutSeconds": 10, "compactTeacherHalfDays": True,
                      "lunchBreak": {"type": "fixed", "from": "12:00", "to": "13:30"}})[0]
    assert len(sol["solutions"]) == 2, "matin + après-midi le même jour doit rester placé"


def test_minimize_days_packs_into_fewer_days():
    """
    Moins de jours : un enseignant dispo lundi ET mardi, 2 cours déplaçables, aucune limite
    quotidienne bloquante → avec l'option, les 2 cours atterrissent le MÊME jour (1 journée au
    lieu de 2).
    """
    mon_tue = [{"days": "lundi, mardi", "from": "08:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": "C1", "type": "CM", "name": "C1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "C2", "type": "CM", "name": "C2", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": mon_tue, "G1": mon_tue, "R1": mon_tue}}

    sol = solve(raw, {"timeoutSeconds": 10, "minimizeTeacherDays": True})[0]
    assert len(sol["solutions"]) == 2
    days = {t["startTime"] // 1440 for t in sol["solutions"]}
    assert len(days) == 1, "les 2 cours doivent être concentrés sur une seule journée"


def test_soft_teacher_prefs_never_sacrifice_placement():
    """
    maxDailyMinutes de T1 assez bas pour ne tenir qu'un seul cours par jour, sur son unique jour
    dispo : le placement optimal est 1 (contention dure). Les deux préférences douces combinées ne
    doivent pas le faire chuter (garantie « ne supplante jamais le placement »).
    """
    monday_only = [{"days": "lundi", "from": "08:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1", "maxDailyMinutes": 60}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": "C1", "type": "CM", "name": "C1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "C2", "type": "CM", "name": "C2", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": monday_only, "G1": monday_only, "R1": monday_only}}

    without = solve(raw, {"timeoutSeconds": 10})[0]
    with_opt = solve(raw, {"timeoutSeconds": 10,
                           "compactTeacherHalfDays": True, "minimizeTeacherDays": True})[0]

    assert len(without["solutions"]) == 1, "prérequis du test : contention dure sur maxDailyMinutes"
    assert len(with_opt["solutions"]) == len(without["solutions"])


def test_soft_teacher_prefs_off_is_default_unchanged():
    """Options absentes vs explicitement False : résultat identique (placement, provenOptimal)."""
    raw = _toy_raw()
    without_field = solve(raw, {"timeoutSeconds": 10})[0]
    with_false = solve(raw, {"timeoutSeconds": 10,
                             "compactTeacherHalfDays": False, "minimizeTeacherDays": False})[0]
    assert len(with_false["solutions"]) == len(without_field["solutions"])
    assert with_false["provenOptimal"] == without_field["provenOptimal"]


def test_runner_map_config_passes_soft_teacher_flags():
    mapped = cpsat_runner._map_config({"compactTeacherHalfDays": True, "minimizeTeacherDays": True})
    assert mapped.get("compactTeacherHalfDays") is True
    assert mapped.get("minimizeTeacherDays") is True


# ── Équilibrage charge quotidienne (balanceTeacherDailyLoad) — passe 3 lexicographique ──────────

def test_balance_reduces_peak():
    """
    T1 : 5 cours de 2h (10h au total), maxDailyMinutes=480 (8h), dispo lundi+mardi toute la
    journée → 10h > 8h impose 2 jours. Le pic minimal possible est 6h (6h/4h). Avec l'option,
    aucun jour ne doit dépasser 360 min.
    """
    mon_tue = [{"days": "lundi, mardi", "from": "08:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1", "maxDailyMinutes": 480}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": f"C{i}", "type": "CM", "name": f"C{i}", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
        for i in range(5)
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": mon_tue, "G1": mon_tue, "R1": mon_tue}}

    sol = solve(raw, {"timeoutSeconds": 10, "balanceTeacherDailyLoad": True})[0]
    assert len(sol["solutions"]) == 5

    load_by_day: dict[int, int] = {}
    for t in sol["solutions"]:
        day = t["startTime"] // 1440
        load_by_day[day] = load_by_day.get(day, 0) + t["duration"]
    assert max(load_by_day.values()) <= 360, "pic quotidien attendu ≤ 360 min (6h/4h)"


def test_balance_never_adds_day():
    """
    Garde-fou anti-étalement : T1, 3 cours de 2h (6h au total, ≤ 8h de maxDailyMinutes), dispo
    lundi+mardi+mercredi (3 jours POSSIBLES, 1 seul NÉCESSAIRE). Avec `balanceTeacherDailyLoad`
    SEUL (sans `minimizeTeacherDays`), l'équilibrage ne doit PAS étaler en 2h/2h/2h sur 3 jours :
    les 3 cours doivent rester sur un seul jour distinct.
    """
    mon_tue_wed = [{"days": "lundi, mardi, mercredi", "from": "08:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1", "maxDailyMinutes": 480}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": f"C{i}", "type": "CM", "name": f"C{i}", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
        for i in range(3)
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": mon_tue_wed, "G1": mon_tue_wed, "R1": mon_tue_wed}}

    sol = solve(raw, {"timeoutSeconds": 10, "balanceTeacherDailyLoad": True})[0]
    assert len(sol["solutions"]) == 3
    days = {t["startTime"] // 1440 for t in sol["solutions"]}
    assert len(days) == 1, "l'équilibrage seul ne doit jamais ajouter de jour de présence"


def test_balance_never_sacrifices_placement():
    """
    Instance en tension placement/équilibrage : maxDailyMinutes bas (60) + unique jour dispo →
    contention dure, un seul des 2 cours peut être placé. `balanceTeacherDailyLoad` ne doit pas
    faire chuter ce nombre.
    """
    monday_only = [{"days": "lundi", "from": "08:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1", "maxDailyMinutes": 60}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": "C1", "type": "CM", "name": "C1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "C2", "type": "CM", "name": "C2", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": monday_only, "G1": monday_only, "R1": monday_only}}

    without = solve(raw, {"timeoutSeconds": 10})[0]
    with_opt = solve(raw, {"timeoutSeconds": 10, "balanceTeacherDailyLoad": True})[0]

    assert len(without["solutions"]) == 1, "prérequis du test : contention dure sur maxDailyMinutes"
    assert len(with_opt["solutions"]) == len(without["solutions"])


def test_balance_off_default_unchanged():
    """Sur _toy_raw(), résultat identique (nb placé, provenOptimal) option absente vs False."""
    raw = _toy_raw()
    without_field = solve(raw, {"timeoutSeconds": 10})[0]
    with_false = solve(raw, {"timeoutSeconds": 10, "balanceTeacherDailyLoad": False})[0]
    assert len(with_false["solutions"]) == len(without_field["solutions"])
    assert with_false["provenOptimal"] == without_field["provenOptimal"]


def test_balance_combined_all_three():
    """Les 3 préférences douces combinées ne plantent pas et ne dégradent pas le placement."""
    raw = _toy_raw()
    without = solve(raw, {"timeoutSeconds": 10})[0]
    combined = solve(raw, {
        "timeoutSeconds": 10,
        "compactTeacherHalfDays": True,
        "minimizeTeacherDays": True,
        "balanceTeacherDailyLoad": True,
    })[0]
    assert len(combined["solutions"]) == len(without["solutions"])
    assert combined["provenOptimal"] == without["provenOptimal"]


def test_balance_combined_never_adds_day_vs_minimize_baseline(monkeypatch):
    """
    Repro ciblée de la faille « échange days↔idle » : la passe 3 ne verrouillait que l'AGRÉGAT
    `sum(penalty_terms) <= best_p2` (idle + 240·jours), pas le nombre de jours lui-même. Quand
    `compactTeacherHalfDays` est co-actif, deux répartitions peuvent être à égalité sur cet agrégat
    (ex. 240 min d'idle sur 1 jour == 0 idle mais 1 jour de plus à 240 min/jour) ; la passe 3, qui
    minimise ensuite le pic, pouvait alors préférer la répartition à PLUS de jours (pic plus bas),
    ajoutant un jour de présence — violant l'invariant "n'ajoute jamais de jour".

    Instance : T1/R1/G1 dispo lun+mar 00:00-08:00 seulement ; un cours enforced bloque R1 sur
    02:00-06:00 (240 min) CHAQUE jour, laissant 2 fenêtres de 120 min (2 créneaux) par jour. 4 cours
    de 60 min pour T1 sur R1 :
      - packés sur 1 seul jour → doivent occuper les 2 fenêtres → idle=240, jours=1 → pénalité 480
      - répartis 2+2 sur les 2 jours → chaque paire tient dans UNE fenêtre → idle=0, jours=2 → pénalité 480
    Égalité exacte (480 dans les deux cas) : la passe 3, sans verrou dur sur les jours, peut légitimement
    choisir la variante à 2 jours car son pic (2×60=120) bat celui à 1 jour (4×60=240).

    Repro confirmée manuellement (session correctif, 5 runs) : sans le verrou dur ajouté en passe 3,
    sur CETTE instance, `compactTeacherHalfDays+minimizeTeacherDays` seul (baseline, passe 2
    uniquement) donne 1 jour ({0}, lundi) tandis que le combo à 3 flags (avec balance, donc passe 3
    exécutée) donnait 2 jours ({0, 1}) à chaque fois — le jour ajouté disparaît une fois le verrou
    dur en place (8 runs, {0} à chaque fois).

    L'égalité exacte de l'agrégat rend le CHOIX (1 jour vs 2 jours) sensible au tie-breaking interne
    du solveur CP-SAT, non-déterministe par défaut (portefeuille multi-thread) : la baseline
    elle-même peut occasionnellement retourner 2 jours sans que ce soit un défaut du correctif. Le
    solveur est donc forcé mono-thread + graine fixe ICI (test uniquement, ne touche pas
    `cpsat_engine.solve`) pour un résultat reproductible.
    """
    import cpsat_engine as _eng

    class _DeterministicSolver(cp_model.CpSolver):
        def __init__(self):
            super().__init__()
            self.parameters.num_search_workers = 1
            self.parameters.random_seed = 0

    monkeypatch.setattr(_eng.cp_model, "CpSolver", _DeterministicSolver)

    narrow = [{"days": "lundi, mardi", "from": "00:00", "to": "08:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": f"C{i}", "type": "CM", "name": f"C{i}", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
        for i in range(4)
    ]

    def blk(day_offset: int, start_hour: int) -> dict:
        return {"week": 1, "code": f"BLK{day_offset}", "type": "CM", "name": f"BLK{day_offset}",
                "duration": 240, "rooms": ["R1"],
                "enforced": {"startTime": day_offset * 1440 + start_hour * 60,
                             "teacher": [], "groups": [], "rooms": ["R1"]}}

    raw = {"week": 1, "resources": resources, "courses": [blk(0, 2), blk(1, 2)] + courses,
           "constraints": {"T1": narrow, "G1": narrow, "R1": narrow}}

    def teacher_days(sol, tid="T1"):
        return {t["startTime"] // 1440 for t in sol["solutions"]
                if any(r["id"] == tid for r in t["resources"])}

    baseline = solve(raw, {"timeoutSeconds": 10,
                            "compactTeacherHalfDays": True, "minimizeTeacherDays": True})[0]
    combo = solve(raw, {"timeoutSeconds": 10, "compactTeacherHalfDays": True,
                         "minimizeTeacherDays": True, "balanceTeacherDailyLoad": True})[0]

    assert len(combo["solutions"]) == len(baseline["solutions"]) == 6
    assert len(teacher_days(baseline)) == 1, "prérequis du test : la baseline tient sur 1 seul jour"
    assert len(teacher_days(combo)) <= len(teacher_days(baseline)), \
        "la passe 3 (balance) ne doit jamais ajouter un jour de présence par rapport à la baseline sans balance"


def test_runner_map_config_passes_balance_flag():
    mapped = cpsat_runner._map_config({"balanceTeacherDailyLoad": True})
    assert mapped.get("balanceTeacherDailyLoad") is True


# ── Trou de midi (crossNoonGap) — passe 2 lexicographique, gate pause fixe ────────────────────────

def _midday_gaps(sol: dict, tid: str, half_cut: int = 13 * 60 + 30, lunch_len: int = 90) -> dict[int, int]:
    """
    Trou de midi RÉEL (minutes) par jour, recalculé depuis les `startTime`/`duration` retournés par
    `solve()` — indépendant du modèle CP-SAT, pour vérifier son résultat depuis l'extérieur.
    """
    by_day: dict[int, list[dict]] = {}
    for t in sol["solutions"]:
        if not any(r["id"] == tid for r in t["resources"]):
            continue
        by_day.setdefault(t["startTime"] // 1440, []).append(t)
    gaps: dict[int, int] = {}
    for day, tasks in by_day.items():
        base = day * 1440
        morning_ends = [t["startTime"] + t["duration"] for t in tasks if t["startTime"] - base < half_cut]
        afternoon_starts = [t["startTime"] for t in tasks if t["startTime"] - base >= half_cut]
        if morning_ends and afternoon_starts:
            gaps[day] = min(afternoon_starts) - max(morning_ends) - lunch_len
    return gaps


def test_cross_noon_penalizes_split_day():
    """
    Instance conçue pour forcer une VRAIE contention matin/après-midi (pas d'échappatoire "tout
    d'un côté") : 3 cours de 150 min, fenêtre matin 08h-12h (240 min → capacité 1 seul cours) +
    fenêtre après-midi 13h30-19h (330 min → capacité 2 cours) : exactement 1 cours matin + 2
    après-midi sont nécessaires pour placer les 3.

    `earliest:True` rend le PLACEMENT DE RÉFÉRENCE déterministe ET causal : la passe 1 minimise la
    somme des débuts → cours du matin collé à 8h00 (finit à 10h30) → trou de midi = 90 min. Sans
    `crossNoonGap`, aucune passe 2 ne le déplace → 90. Avec `crossNoonGap`, la passe 2 repousse ce
    cours au plus tard dans sa fenêtre (finit à 12h00 pile) → trou = 0.

    IMPORTANT (preuve de causalité, vérifiée par ablation le 2026-07-26) : `earliest` est
    indispensable ici. SANS lui, la seule PRÉSENCE des variables auxiliaires du bloc Option D suffit
    à faire tomber le solveur sur trou=0 par effet de bord sur son ordre d'exploration, MÊME objectif
    retiré (`penalty_terms.append(gap)` commenté) → le test serait un faux positif. AVEC `earliest`,
    l'ablation de l'objectif redonne 90 (mesuré) : le passage à 0 est donc bien imputable à
    l'objectif crossNoonGap, pas à un artefact de tie-breaking.
    """
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    win = [{"days": "lundi", "from": "08:00", "to": "12:00"},
           {"days": "lundi", "from": "13:30", "to": "19:00"}]
    courses = [
        {"week": 1, "code": f"C{i}", "type": "CM", "name": f"C{i}", "duration": 150,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
        for i in range(3)
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": win, "G1": win, "R1": win}}
    lunch = {"type": "fixed", "from": "12:00", "to": "13:30"}

    without = solve(raw, {"timeoutSeconds": 10, "earliest": True, "lunchBreak": lunch})[0]
    with_opt = solve(raw, {"timeoutSeconds": 10, "earliest": True, "crossNoonGap": True, "lunchBreak": lunch})[0]

    assert len(without["solutions"]) == len(with_opt["solutions"]) == 3
    gap_off = _midday_gaps(without, "T1").get(0)
    gap_on = _midday_gaps(with_opt, "T1").get(0)
    assert gap_off == 90, "prérequis (earliest) : sans l'option, le placement au plus tôt laisse un trou de 90 min"
    assert gap_on == 0, "avec l'option, la passe 2 doit fermer entièrement le trou de midi"


def test_cross_noon_lunch_not_counted():
    """
    Cours matin 11h-12h + après-midi 13h30-14h30 : encadrent EXACTEMENT la pause (12h-13h30) → trou
    réel = 0. La pause elle-même ne doit pas être comptée comme idle (piège si on oublie `lunch_len`
    dans `gap == first_a - last_m - lunch_len`).
    """
    slots = [{"days": "lundi", "from": "11:00", "to": "12:00"},
             {"days": "lundi", "from": "13:30", "to": "14:30"}]
    wide = [{"days": "lundi", "from": "08:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": "C1", "type": "CM", "name": "C1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "C2", "type": "CM", "name": "C2", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": slots, "G1": wide, "R1": wide}}
    lunch = {"type": "fixed", "from": "12:00", "to": "13:30"}

    sol = solve(raw, {"timeoutSeconds": 10, "crossNoonGap": True, "lunchBreak": lunch})[0]
    assert len(sol["solutions"]) == 2
    assert _midday_gaps(sol, "T1") == {0: 0}, "la pause ne doit pas être comptée comme trou de midi"


def test_cross_noon_only_afternoon_no_penalty():
    """2 cours l'après-midi seulement : jamais présent le matin ⇒ `both`=faux ⇒ aucun trou de midi."""
    afternoon_only = [{"days": "lundi", "from": "14:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": "C1", "type": "CM", "name": "C1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "C2", "type": "CM", "name": "C2", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": afternoon_only, "G1": afternoon_only, "R1": afternoon_only}}
    lunch = {"type": "fixed", "from": "12:00", "to": "13:30"}

    sol = solve(raw, {"timeoutSeconds": 10, "crossNoonGap": True, "lunchBreak": lunch})[0]
    assert len(sol["solutions"]) == 2
    assert _midday_gaps(sol, "T1") == {}, "garde-fou OnlyEnforceIf(both) : pas de trou sans présence des 2 côtés"


def test_cross_noon_off_is_noop():
    """Même instance que test_cross_noon_penalizes_split_day, sans le flag : inerte (placement/provenOptimal identiques)."""
    monday_wide = [{"days": "lundi", "from": "08:00", "to": "19:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": "C1", "type": "CM", "name": "C1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "C2", "type": "CM", "name": "C2", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": monday_wide, "G1": monday_wide, "R1": monday_wide}}
    lunch = {"type": "fixed", "from": "12:00", "to": "13:30"}

    without_field = solve(raw, {"timeoutSeconds": 10, "lunchBreak": lunch})[0]
    with_false = solve(raw, {"timeoutSeconds": 10, "crossNoonGap": False, "lunchBreak": lunch})[0]
    assert len(with_false["solutions"]) == len(without_field["solutions"])
    assert with_false["provenOptimal"] == without_field["provenOptimal"]


def test_cross_noon_lunch_none_is_noop():
    """Flag activé mais lunchBreak:{type:'none'} : le gate `lunch is not None` neutralise l'option."""
    raw = _toy_raw()
    without = solve(raw, {"timeoutSeconds": 10, "lunchBreak": {"type": "none"}})[0]
    with_flag_no_lunch = solve(raw, {"timeoutSeconds": 10, "crossNoonGap": True,
                                     "lunchBreak": {"type": "none"}})[0]
    assert len(with_flag_no_lunch["solutions"]) == len(without["solutions"])
    assert with_flag_no_lunch["provenOptimal"] == without["provenOptimal"]


def test_cross_noon_combined_with_compact():
    """
    Intégration : `crossNoonGap` + `compactTeacherHalfDays` actifs simultanément (4 cours de 60 min,
    dispo large 8h-19h) : les deux compacités (intra-bloc ET trou de midi) doivent pouvoir être
    recherchées sans conflit. Pas de valeur exacte figée : on vérifie juste que le solve reste
    FEASIBLE et que le placement n'est pas dégradé.
    """
    monday_wide = [{"days": "lundi", "from": "08:00", "to": "19:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": f"C{i}", "type": "CM", "name": f"C{i}", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
        for i in range(4)
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": monday_wide, "G1": monday_wide, "R1": monday_wide}}
    lunch = {"type": "fixed", "from": "12:00", "to": "13:30"}

    without = solve(raw, {"timeoutSeconds": 10, "lunchBreak": lunch})[0]
    combined = solve(raw, {"timeoutSeconds": 10, "crossNoonGap": True,
                           "compactTeacherHalfDays": True, "lunchBreak": lunch})[0]
    assert len(combined["solutions"]) == len(without["solutions"]) == 4


def test_runner_map_config_passes_cross_noon_flag():
    mapped = cpsat_runner._map_config({"crossNoonGap": True})
    assert mapped.get("crossNoonGap") is True
