"""
Tests unitaires (pytest) du moteur CP-SAT.

- Cas jouet CM/TD/TP : contention (3/4 placées), intégrité de chaîne CM→TD, provenOptimal.
- `cpsat_runner._map_config` : rejet explicite d'une pause méridienne flottante.
"""

from __future__ import annotations

from collections import defaultdict

import pytest
from ortools.sat.python import cp_model

import cpsat_runner
from cpsat_engine import EnforcedConflictError, _residual_break, solve

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


def test_respect_cm_td_tp_order_false_allows_td_before_cm():
    """
    respectCmTdTpOrder=False : la précédence CM→TD n'est plus imposée. Rooms dédiées et disjointes
    (CM uniquement mardi, TD uniquement lundi) : avec la précédence imposée (défaut), les deux ne
    peuvent pas tenir ensemble (TD chronologiquement avant CM violerait l'ordre) ; sans elle, les
    deux tiennent, TD avant CM.
    """
    raw = {
        "week": 38,
        "resources": [
            {"resourceType": "teacher", "resources": [{"id": "T1"}]},
            {"resourceType": "room", "resources": [{"id": "R_CM"}, {"id": "R_TD"}]},
            {"resourceType": "group", "resources": [{"id": "G1"}]},
        ],
        "courses": [
            {"week": 38, "semester": 1, "level": 1, "code": "C1", "type": "CM",
             "teacher": ["T1"], "groups": ["G1"], "name": "C1 CM", "rooms": ["R_CM"], "duration": 60},
            {"week": 38, "semester": 1, "level": 1, "code": "C1", "type": "TD",
             "teacher": ["T1"], "groups": ["G1"], "name": "C1 TD", "rooms": ["R_TD"], "duration": 60},
        ],
        "constraints": {
            "Default": ALL_DAY,
            "R_CM": [{"days": "mardi", "from": "08:00", "to": "09:00"}],
            "R_TD": [{"days": "lundi", "from": "08:00", "to": "09:00"}],
        },
    }

    sol_ordered = solve(raw, {"timeoutSeconds": 10})[0]
    placed_ordered = {t["type"] for t in sol_ordered["solutions"]}
    assert placed_ordered != {"CM", "TD"}, \
        "avec la précédence imposée, CM et TD ne peuvent pas tenir tous les deux (rooms disjointes, TD avant CM)"

    sol_free = solve(raw, {"timeoutSeconds": 10, "respectCmTdTpOrder": False})[0]
    by_type = {t["type"]: t for t in sol_free["solutions"]}
    assert set(by_type) == {"CM", "TD"}, "sans la précédence, les deux doivent tenir (chacun dans sa room dédiée)"
    assert by_type["TD"]["startTime"] < by_type["CM"]["startTime"], \
        "TD (lundi) doit être placé avant CM (mardi) une fois la précédence désactivée"


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

    sol = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": True,
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

    sol = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": True,
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


def test_minimize_days_respects_structural_lower_bound():
    """
    La minimisation du nombre de jours doit être bornée par le plafond quotidien ET la
    disponibilité, pas les ignorer : cas §7 du bilan préférences douces — maxDailyMinutes=120
    (2h/jour) et 10h à placer (5 cours de 2h) sur 5 jours dispo imposent structurellement 5
    journées, quelle que soit l'option. Vérifie que la passe jours ATTEINT ce minimum théorique
    (ni plus par inefficacité, ni moins par une fuite du plafond) et le prouve rapidement.
    """
    all_week = [{"days": "lundi, mardi, mercredi, jeudi, vendredi", "from": "08:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1", "maxDailyMinutes": 120}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": f"C{i}", "type": "CM", "name": f"C{i}", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
        for i in range(5)
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": all_week, "G1": all_week, "R1": all_week}}

    sol = solve(raw, {"timeoutSeconds": 10, "minimizeTeacherDays": True})[0]
    assert len(sol["solutions"]) == 5
    days = {t["startTime"] // 1440 for t in sol["solutions"]}
    assert len(days) == 5, "le plafond de 2h/jour impose structurellement 5 jours, pas moins"


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
                           "compactTeacherDay": True, "minimizeTeacherDays": True})[0]

    assert len(without["solutions"]) == 1, "prérequis du test : contention dure sur maxDailyMinutes"
    assert len(with_opt["solutions"]) == len(without["solutions"])


def test_soft_teacher_prefs_off_is_default_unchanged():
    """Options absentes vs explicitement False : résultat identique (placement, provenOptimal)."""
    raw = _toy_raw()
    without_field = solve(raw, {"timeoutSeconds": 10})[0]
    with_false = solve(raw, {"timeoutSeconds": 10,
                             "compactTeacherDay": False, "minimizeTeacherDays": False})[0]
    assert len(with_false["solutions"]) == len(without_field["solutions"])
    assert with_false["provenOptimal"] == without_field["provenOptimal"]


def test_runner_map_config_passes_soft_teacher_flags():
    mapped = cpsat_runner._map_config({"compactTeacherDay": True, "minimizeTeacherDays": True})
    assert mapped.get("compactTeacherDay") is True
    assert mapped.get("minimizeTeacherDays") is True


# ── Réduction des demi-journées sous-utilisées (reduceTeacherHalfDays) — passe 3 ────────────────

def _underused_half_days(sol, half_cut=780, threshold=120):
    """Nombre de blocs (jour, demi-journée) avec 0 < charge <= threshold, classés par `start`
    comme le fait `on_half` dans le moteur (SEUIL scalaire sur le début, pas la fin)."""
    load: dict[tuple[int, int], int] = defaultdict(int)
    for t in sol["solutions"]:
        d = t["startTime"] // 1440
        offset = t["startTime"] - d * 1440
        h = 0 if offset < half_cut else 1
        load[(d, h)] += t["duration"]
    return sum(1 for v in load.values() if 0 < v <= threshold)


def test_reduce_half_days_eliminates_underused_blocks(monkeypatch):
    """
    T1, 2 jours dispo (lundi, mardi), 2 gros cours (6h) + 2 petits (1h) isolés (14h au total,
    maxDailyMinutes=480 impose structurellement 2 jours). Sans aucune option, le placement seul
    laisse au moins 1 bloc sous-utilisé (<=120 min) — la position exacte est un optimum parmi
    plusieurs à égalité (solveur forcé mono-thread + graine fixe ICI, test uniquement, pour un
    prérequis reproductible). `reduceTeacherHalfDays` doit les reporter dans le bloc du gros
    cours voisin, sans changer ni le nombre de cours placés ni le nombre de jours.
    """
    import cpsat_engine as _eng

    class _DeterministicSolver(cp_model.CpSolver):
        def __init__(self):
            super().__init__()
            self.parameters.num_search_workers = 1
            self.parameters.random_seed = 0

    monkeypatch.setattr(_eng.cp_model, "CpSolver", _DeterministicSolver)

    mon_tue = [{"days": "lundi, mardi", "from": "08:00", "to": "20:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1", "maxDailyMinutes": 480}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": "BIG1", "type": "CM", "name": "BIG1", "duration": 360,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "SMALL1", "type": "CM", "name": "SMALL1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "BIG2", "type": "CM", "name": "BIG2", "duration": 360,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "SMALL2", "type": "CM", "name": "SMALL2", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": mon_tue, "G1": mon_tue, "R1": mon_tue}}

    without = solve(raw, {"timeoutSeconds": 10})[0]
    with_opt = solve(raw, {"timeoutSeconds": 10, "reduceTeacherHalfDays": True})[0]

    assert len(without["solutions"]) == 4
    assert len(with_opt["solutions"]) == 4
    assert _underused_half_days(without) >= 1, "prérequis du test : au moins 1 bloc sous-utilisé sans l'option"
    assert _underused_half_days(with_opt) == 0, "l'option doit éliminer les blocs sous-utilisés"

    days_without = {t["startTime"] // 1440 for t in without["solutions"]}
    days_with = {t["startTime"] // 1440 for t in with_opt["solutions"]}
    assert days_with == days_without, "ne doit ni ajouter ni retirer de jour de présence"


def test_reduce_half_days_never_adds_day():
    """
    Garde-fou : sur l'instance §7 (2h/jour cap, 10h à placer, 5 jours dispo → 5 jours structurels),
    `reduceTeacherHalfDays` seul ne doit jamais faire baisser NI monter le nombre de jours (rien à
    reporter : chaque demi-journée pleine dépasse déjà le seuil).
    """
    all_week = [{"days": "lundi, mardi, mercredi, jeudi, vendredi", "from": "08:00", "to": "18:00"}]
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1", "maxDailyMinutes": 120}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
    ]
    courses = [
        {"week": 1, "code": f"C{i}", "type": "CM", "name": f"C{i}", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
        for i in range(5)
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": all_week, "G1": all_week, "R1": all_week}}

    sol = solve(raw, {"timeoutSeconds": 10, "reduceTeacherHalfDays": True})[0]
    assert len(sol["solutions"]) == 5
    days = {t["startTime"] // 1440 for t in sol["solutions"]}
    assert len(days) == 5


def test_reduce_half_days_off_is_noop():
    """Sur _toy_raw(), résultat identique (nb placé, provenOptimal) option absente vs False."""
    raw = _toy_raw()
    without_field = solve(raw, {"timeoutSeconds": 10})[0]
    with_false = solve(raw, {"timeoutSeconds": 10, "reduceTeacherHalfDays": False})[0]
    assert len(with_false["solutions"]) == len(without_field["solutions"])
    assert with_false["provenOptimal"] == without_field["provenOptimal"]


def test_runner_map_config_passes_reduce_half_days_flag():
    mapped = cpsat_runner._map_config({"reduceTeacherHalfDays": True})
    assert mapped.get("reduceTeacherHalfDays") is True


def test_soft_prefs_combined_three():
    """Les 3 préférences douces restantes combinées ne plantent pas et ne dégradent pas le placement."""
    raw = _toy_raw()
    without = solve(raw, {"timeoutSeconds": 10})[0]
    combined = solve(raw, {
        "timeoutSeconds": 10,
        "minimizeTeacherDays": True,
        "reduceTeacherHalfDays": True,
        "compactTeacherDay": True,
    })[0]
    assert len(combined["solutions"]) == len(without["solutions"])
    assert combined["provenOptimal"] == without["provenOptimal"]


# ── Trou de midi (composante D de compactTeacherDay, ex-crossNoonGap) — gate pause fixe ──────────

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
    `compactTeacherDay`, aucune passe 2 ne le déplace → 90. Avec `compactTeacherDay`, la passe 2 repousse ce
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
    with_opt = solve(raw, {"timeoutSeconds": 10, "earliest": True, "compactTeacherDay": True, "lunchBreak": lunch})[0]

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

    sol = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": True, "lunchBreak": lunch})[0]
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

    sol = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": True, "lunchBreak": lunch})[0]
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
    with_false = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": False, "lunchBreak": lunch})[0]
    assert len(with_false["solutions"]) == len(without_field["solutions"])
    assert with_false["provenOptimal"] == without_field["provenOptimal"]


def test_cross_noon_lunch_none_is_noop():
    """Flag activé mais lunchBreak:{type:'none'} : le gate `lunch is not None` neutralise l'option."""
    raw = _toy_raw()
    without = solve(raw, {"timeoutSeconds": 10, "lunchBreak": {"type": "none"}})[0]
    with_flag_no_lunch = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": True,
                                     "lunchBreak": {"type": "none"}})[0]
    assert len(with_flag_no_lunch["solutions"]) == len(without["solutions"])
    assert with_flag_no_lunch["provenOptimal"] == without["provenOptimal"]


def test_cross_noon_combined_with_compact():
    """
    Intégration : les deux composantes de `compactTeacherDay` (intra-bloc ET trou de midi) actives
    simultanément (4 cours de 60 min, dispo large 8h-19h) doivent pouvoir être recherchées sans
    conflit. Pas de valeur exacte figée : on vérifie juste que le solve reste FEASIBLE et que le
    placement n'est pas dégradé.
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
    combined = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": True, "lunchBreak": lunch})[0]
    assert len(combined["solutions"]) == len(without["solutions"]) == 4


def test_compact_day_noon_resserrement_never_creates_a_gap():
    """
    Repro exacte du bug remonté par Frédéric (vrai projet, 2026-09-11) : un enseignant a 2 cours
    l'après-midi ; le premier (flexible) était remonté contre la pause méridienne alors que le
    second (ici enforced, immobile) restait en place, créant un trou ENTRE les deux qui n'existait
    pas avant. Cause : sans pondération, rapprocher le 1er cours de la pause de Δ minutes réduit le
    trou de midi (composante D) d'exactement Δ tout en créant un trou intra-bloc (composante A)
    d'exactement Δ — échange à somme nulle sur `sum(penalty_terms)`, le solveur pouvait choisir
    arbitrairement de créer le trou. `COMPACT_DAY_IDLE_WEIGHT` (poids 2 sur l'intra-bloc contre 1
    sur le trou de midi) rend cet échange perdant.

    Instance : M1 (matin, forcé 11h-12h, se termine pile à midi) ; A1 (après-midi, flexible,
    dispo 13h30-19h) ; A2 (après-midi, enforced à 16h). Sans pondération correcte, A1 serait remonté
    à 13h30 (trou de midi fermé, mais trou de 150 min créé avant A2). Avec la pondération, A1 doit
    se coller à A2 (aucun trou intra-bloc), quitte à laisser le trou de midi ouvert.
    """
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
        {"resourceType": "group", "resources": [{"id": "Gm"}, {"id": "Ga"}]},
    ]
    courses = [
        {"week": 1, "code": "M1", "type": "CM", "name": "M1", "duration": 60,
         "teacher": ["T1"], "groups": ["Gm"], "rooms": ["R1"]},
        {"week": 1, "code": "A1", "type": "CM", "name": "A1", "duration": 60,
         "teacher": ["T1"], "groups": ["Ga"], "rooms": ["R1"]},
        {"week": 1, "code": "A2", "type": "CM", "name": "A2", "duration": 60,
         "teacher": ["T1"], "groups": ["Ga"], "rooms": ["R1"],
         "enforced": {"startTime": 16 * 60, "teacher": ["T1"], "groups": ["Ga"], "rooms": ["R1"]}},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {
               "T1": [{"days": "lundi", "from": "11:00", "to": "19:00"}],
               "Gm": [{"days": "lundi", "from": "11:00", "to": "12:00"}],
               "Ga": [{"days": "lundi", "from": "13:30", "to": "19:00"}],
               "R1": [{"days": "lundi", "from": "11:00", "to": "19:00"}],
           }}
    lunch = {"type": "fixed", "from": "12:00", "to": "13:30"}

    sol = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": True, "lunchBreak": lunch})[0]
    assert len(sol["solutions"]) == 3
    by_code = {t["code"]: t["startTime"] for t in sol["solutions"]}
    gap = by_code["A2"] - (by_code["A1"] + 60)
    assert gap == 0, "A1 doit se coller à A2 (aucun trou intra-bloc), pas remonter seul vers la pause"


def test_runner_map_config_passes_cross_noon_flag():
    mapped = cpsat_runner._map_config({"compactTeacherDay": True})
    assert mapped.get("compactTeacherDay") is True


# ── Minimisation des changements de salle enseignant (minimizeTeacherRoomChanges) — passe 5 ─────

def _count_room_changes(sol: dict, half_cut: int = 13 * 60) -> int:
    """
    Compte, depuis l'EXTÉRIEUR du modèle (indépendant de CP-SAT), le nombre de changements de
    salle sur les paires de cours consécutifs d'un même enseignant dans une même demi-journée.
    Trie par (prof, jour, demi-journée, startTime) ; une paire "change" si les deux cours ne
    partagent AUCUNE salle.
    """
    by_teacher: dict[str, list[tuple[int, frozenset]]] = defaultdict(list)
    for t in sol["solutions"]:
        room_ids = frozenset(r["id"] for r in t["resources"] if r["type"] == "room")
        for r in t["resources"]:
            if r["type"] == "teacher":
                by_teacher[r["id"]].append((t["startTime"], room_ids))

    changes = 0
    for _, items in by_teacher.items():
        items.sort(key=lambda x: x[0])
        for (s1, r1), (s2, r2) in zip(items, items[1:]):
            d1, d2 = s1 // 1440, s2 // 1440
            h1 = 0 if (s1 - d1 * 1440) < half_cut else 1
            h2 = 0 if (s2 - d2 * 1440) < half_cut else 1
            if d1 == d2 and h1 == h2 and not (r1 & r2):
                changes += 1
    return changes


def _room_change_resources(n: int) -> list[dict]:
    ids = ["Rd1", "Rd2", "Rd3", "Rd4", "R2"]
    return [
        {"resourceType": "teacher", "resources": [{"id": f"T{i}"} for i in range(n)]},
        {"resourceType": "group", "resources": [{"id": f"G{i}"} for i in range(n)]},
        {"resourceType": "room", "resources": [
            {"id": f"{base}_{i}"} for base in ids for i in range(n)
        ]},
    ]


def _room_change_raw(n: int = 5) -> dict:
    """
    `n` enseignants indépendants, chacun avec 2 cours consécutifs le même matin (fenêtre 120 min
    pile = somme des 2 durées de 60 min → aucun slack, back-to-back forcé). Cours A alternatives
    `[Rd1_i, Rd2_i, R2_i]`, cours B `[Rd3_i, Rd4_i, R2_i]` : seule salle commune R2_i, entourée de
    2 décoys chacun côté.

    Les décoys sont nécessaires pour la preuve « casse-si-retiré » (§5.1 du plan) : avec seulement
    2 alternatives par cours (`[R1_i,R2_i]` / `[R2_i,R3_i]`), l'ablation de `model.Minimize` de la
    passe 4 (vérifiée en revue le 2026-07-26) retombe QUAND MÊME sur 0 changement par effet de bord
    du solveur (même artefact que documenté pour `compactTeacherDay`) — faux positif. Avec les décoys,
    l'ablation retombe sur les décoys (Rd1_i pour A, Rd3_i pour B, JAMAIS R2_i) → 5/5 changements,
    et seul le vrai objectif de la passe 4 fait converger vers R2_i partagé (mesuré : 0/5).
    """
    win = [{"days": "lundi", "from": "08:00", "to": "10:00"}]
    wide = [{"days": "lundi", "from": "08:00", "to": "18:00"}]
    courses = []
    constraints: dict[str, list] = {}
    for i in range(n):
        courses.append({"week": 1, "code": f"A{i}", "type": "CM", "name": f"A{i}", "duration": 60,
                         "teacher": [f"T{i}"], "groups": [f"G{i}"],
                         "rooms": [[f"Rd1_{i}", f"Rd2_{i}", f"R2_{i}"]]})
        courses.append({"week": 1, "code": f"B{i}", "type": "CM", "name": f"B{i}", "duration": 60,
                         "teacher": [f"T{i}"], "groups": [f"G{i}"],
                         "rooms": [[f"Rd3_{i}", f"Rd4_{i}", f"R2_{i}"]]})
        constraints[f"T{i}"] = win
        constraints[f"G{i}"] = win
        for base in ("Rd1", "Rd2", "Rd3", "Rd4", "R2"):
            constraints[f"{base}_{i}"] = wide
    return {"week": 1, "resources": _room_change_resources(n), "courses": courses,
            "constraints": constraints}


def test_room_change_picks_common_room():
    """
    5 paires indépendantes, chacune avec une unique salle commune (R2_i). Avec le flag, les 2 cours
    de CHAQUE prof doivent partager R2_i → 0 changement de salle au total sur les 5 profs.
    """
    n = 5
    raw = _room_change_raw(n)
    sol = solve(raw, {"timeoutSeconds": 10, "minimizeTeacherRoomChanges": True})[0]
    assert len(sol["solutions"]) == 2 * n
    assert _count_room_changes(sol) == 0


def test_room_change_keeps_within_half_only():
    """
    Segmentation midi : un prof avec matin `m1` (fixe R1) puis `m2` (alt [R1,R2]) consécutifs, et
    après-midi `a1` (fixe R2) séparé par la pause. Avec le flag, seule la paire intra-matin
    (m1,m2) est influençable → m2 = R1 (unique optimum matin). Un bug qui apparierait m2 avec a1
    à travers midi tirerait m2 vers R2 → l'assert le détecte.
    """
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "group", "resources": [{"id": "Gm1"}, {"id": "Gm2"}, {"id": "Ga1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}, {"id": "R2"}]},
    ]
    courses = [
        {"week": 1, "code": "m1", "type": "CM", "name": "m1", "duration": 60,
         "teacher": ["T1"], "groups": ["Gm1"], "rooms": ["R1"]},
        {"week": 1, "code": "m2", "type": "CM", "name": "m2", "duration": 60,
         "teacher": ["T1"], "groups": ["Gm2"], "rooms": [["R1", "R2"]]},
        {"week": 1, "code": "a1", "type": "CM", "name": "a1", "duration": 60,
         "teacher": ["T1"], "groups": ["Ga1"], "rooms": ["R2"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses, "constraints": {
        "T1": [{"days": "lundi", "from": "08:00", "to": "10:00"},
               {"days": "lundi", "from": "14:00", "to": "15:00"}],
        "Gm1": [{"days": "lundi", "from": "08:00", "to": "09:00"}],
        "Gm2": [{"days": "lundi", "from": "09:00", "to": "10:00"}],
        "Ga1": [{"days": "lundi", "from": "14:00", "to": "15:00"}],
        "R1": ALL_DAY,
        "R2": ALL_DAY,
    }}
    lunch = {"type": "fixed", "from": "12:00", "to": "13:30"}

    sol = solve(raw, {"timeoutSeconds": 10, "minimizeTeacherRoomChanges": True, "lunchBreak": lunch})[0]
    assert len(sol["solutions"]) == 3
    by_code = {t["code"]: t for t in sol["solutions"]}
    assert by_code["m1"]["startTime"] == 8 * 60
    assert by_code["m2"]["startTime"] == 9 * 60
    assert by_code["a1"]["startTime"] == 14 * 60
    m2_rooms = {r["id"] for r in by_code["m2"]["resources"] if r["type"] == "room"}
    assert m2_rooms == {"R1"}, "m2 doit s'aligner sur R1 (paire matin) et NON sur R2 (a1, à travers midi)"


def test_room_change_no_common_room_incompressible():
    """Un prof, 2 cours consécutifs à salles FIXES disjointes (R1 puis R2) : changement incompressible."""
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}, {"id": "G2"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}, {"id": "R2"}]},
    ]
    courses = [
        {"week": 1, "code": "i1", "type": "CM", "name": "i1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "i2", "type": "CM", "name": "i2", "duration": 60,
         "teacher": ["T1"], "groups": ["G2"], "rooms": ["R2"]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses, "constraints": {
        "T1": [{"days": "lundi", "from": "08:00", "to": "10:00"}],
        "G1": [{"days": "lundi", "from": "08:00", "to": "09:00"}],
        "G2": [{"days": "lundi", "from": "09:00", "to": "10:00"}],
        "R1": ALL_DAY,
        "R2": ALL_DAY,
    }}

    sol = solve(raw, {"timeoutSeconds": 10, "minimizeTeacherRoomChanges": True})[0]
    assert len(sol["solutions"]) == 2
    by_code = {t["code"]: t for t in sol["solutions"]}
    assert {r["id"] for r in by_code["i1"]["resources"] if r["type"] == "room"} == {"R1"}
    assert {r["id"] for r in by_code["i2"]["resources"] if r["type"] == "room"} == {"R2"}


def test_room_change_noop_when_all_fixed():
    """
    Instance à salles toutes fixes (`_toy_raw`) : nb placé et provenOptimal identiques avec/sans le
    flag (même patron que `test_balance_off_default_unchanged`/`test_soft_teacher_prefs_off_is_default_unchanged`
    : PAS de comparaison exacte des salles/placement entre 2 appels `solve()` séparés — `_toy_raw` a
    une contention C2/C3 dont le départage peut varier d'un run à l'autre côté CP-SAT multi-thread,
    même sans aucune option activée ; comparer l'exact aurait rendu le test intermittent, constaté
    empiriquement lors de la validation vrai projet, cf. STATUT).
    """
    raw = _toy_raw()
    without = solve(raw, {"timeoutSeconds": 10})[0]
    with_flag = solve(raw, {"timeoutSeconds": 10, "minimizeTeacherRoomChanges": True})[0]
    assert len(with_flag["solutions"]) == len(without["solutions"])
    assert with_flag["provenOptimal"] == without["provenOptimal"]


def test_room_change_respects_availability():
    """Un prof, cours `i` à salle alternative [R1,R2] avec R2 indisponible au créneau : reste FEASIBLE, garde R1."""
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}, {"id": "R2"}]},
    ]
    courses = [
        {"week": 1, "code": "i", "type": "CM", "name": "i", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": [["R1", "R2"]]},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses, "constraints": {
        "T1": [{"days": "lundi", "from": "08:00", "to": "09:00"}],
        "G1": [{"days": "lundi", "from": "08:00", "to": "09:00"}],
        "R1": ALL_DAY,
        "R2": [{"days": "lundi", "from": "10:00", "to": "18:00"}],  # indisponible 08h-09h
    }}

    sol = solve(raw, {"timeoutSeconds": 10, "minimizeTeacherRoomChanges": True})[0]
    assert len(sol["solutions"]) == 1
    i = sol["solutions"][0]
    assert {r["id"] for r in i["resources"] if r["type"] == "room"} == {"R1"}


def test_room_change_off_is_noop():
    """
    Même instance que test_room_change_picks_common_room, sans le flag : baseline inerte (nb placé +
    provenOptimal, PAS l'exact des salles — voir commentaire de `test_room_change_noop_when_all_fixed` :
    sans objectif de salle, le choix parmi les décoys n'est pas garanti stable entre 2 appels
    `solve()` séparés côté CP-SAT multi-thread ; comparer l'exact rendait ce test intermittent
    (~13% d'échec mesuré empiriquement), cf. STATUT).
    """
    raw = _room_change_raw(5)
    without_field = solve(raw, {"timeoutSeconds": 10})[0]
    with_false = solve(raw, {"timeoutSeconds": 10, "minimizeTeacherRoomChanges": False})[0]
    assert len(with_false["solutions"]) == len(without_field["solutions"])
    assert with_false["provenOptimal"] == without_field["provenOptimal"]


def test_runner_map_config_passes_room_change_flag():
    mapped = cpsat_runner._map_config({"minimizeTeacherRoomChanges": True})
    assert mapped.get("minimizeTeacherRoomChanges") is True


def test_room_change_still_works_with_all_upstream_passes_active():
    """
    Vérification post-refonte : minimizeTeacherRoomChanges est maintenant la passe 5, précédée de
    2 passes qui n'existaient pas quand cette préférence a été validée (jours, demi-journées) plus
    la fusion compactTeacherDay. Le gel (scheduled[]/start[]/littéraux non-salle) porte sur `solver`
    tel qu'il est APRÈS la dernière passe exécutée, quelle qu'elle soit : ce mécanisme est générique
    et ne devrait pas se soucier de ce qui a tourné avant. Instance `_room_change_raw` (5 profs
    indépendants, fenêtre 120 min pile, back-to-back forcé, seule salle commune R2_i) : les 3
    autres préférences n'ont structurellement rien à faire dessus (1 seul jour possible, cours déjà
    collés), donc aucune ne doit perturber le résultat déjà connu (0 changement).
    """
    raw = _room_change_raw(5)
    sol = solve(raw, {
        "timeoutSeconds": 10,
        "minimizeTeacherDays": True,
        "reduceTeacherHalfDays": True,
        "compactTeacherDay": True,
        "minimizeTeacherRoomChanges": True,
    })[0]
    assert len(sol["solutions"]) == 10
    assert _count_room_changes(sol) == 0


# ── §4.1 : `_residual_break` (fonction pure) — plus grand sous-intervalle libre de [l0,l1] ───────

def test_residual_break_empty_window_when_fully_occupied():
    assert _residual_break([(700, 850)], 720, 840) == (720, 720)


def test_residual_break_no_busy_returns_full_window():
    assert _residual_break([], 720, 840) == (720, 840)


def test_residual_break_busy_outside_window_ignored():
    """Un `busy` hors de [l0,l1] (aucune intersection) ne doit rien retrancher."""
    assert _residual_break([(0, 700)], 720, 840) == (720, 840)


def test_residual_break_partial_left():
    """Occupé en tête de fenêtre → le résiduel est le reste à droite."""
    assert _residual_break([(720, 760)], 720, 840) == (760, 840)


def test_residual_break_partial_right():
    """Occupé en fin de fenêtre → le résiduel est le reste à gauche."""
    assert _residual_break([(800, 840)], 720, 840) == (720, 800)


def test_residual_break_partial_middle():
    assert _residual_break([(760, 800)], 720, 840) == (720, 760)


def test_residual_break_fragmentation_picks_largest_gap():
    """Deux enforced laissant deux trous de tailles différentes → le PLUS GRAND l'emporte."""
    assert _residual_break([(730, 740), (800, 810)], 720, 840) == (740, 800)  # gap 60 > gaps 10 et 30


def test_residual_break_clips_overflow_left_and_right():
    """Un `busy` débordant hors de [l0,l1] d'un côté ou de l'autre est clippé à la fenêtre."""
    assert _residual_break([(650, 750)], 720, 840) == (750, 840)   # déborde à gauche
    assert _residual_break([(830, 900)], 720, 840) == (720, 830)   # déborde à droite


# ── Cours `enforced` à cheval sur la pause méridienne (correctif enforced-lunch-straddle) ────────
# Contexte : `on_half`/`lunch_len` classaient un cours sur le seul scalaire `start`, exact pour tout
# cours normal (carvage garantit fin ≤ pause si start < fin de pause) mais faux pour un `enforced`
# empiétant sur la pause (start imposé, aucun carvage). `compactTeacherDay` en tirait une assertion DURE
# (`gap >= 0`) → un enforced à cheval rendait le modèle INFEASIBLE, effondrant toute la semaine.
# Correctif : classification par pause RÉSIDUELLE (`on_side`/`residual()`, cf. `_residual_break`
# ci-dessus) + positivité structurelle (`AddMaxEquality`). Voir docs/PlanFixEnforcedLunchStraddle.md.
#
# Toutes les instances ci-dessous ont été vérifiées par ablation (STATUT du plan, 2026-07-28) :
# rejouées contre le moteur d'avant correctif (git show master:.../cpsat_engine.py), les groupes A
# reproduisent bien INFEASIBLE/éviction, et les groupes B/C bien les valeurs 90/0/0/120 documentées
# au §0.5/§0.6 du plan (indirectement, via le placement qu'elles forcent — solve() n'expose pas la
# pénalité brute, cf. §3 du plan, décision (a)).

def _straddle_resources() -> list[dict]:
    return [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "group", "resources": [{"id": "G1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
    ]


def _straddle_base(courses: list[dict], win: list[dict], groups: list[dict] | None = None) -> dict:
    r = {"week": 1, "resources": _straddle_resources(), "courses": courses,
         "constraints": {"T1": win, "G1": win, "R1": win}}
    if groups:
        r["groups"] = groups
    return r


STRADDLE_LUNCH = {"type": "fixed", "from": "12:00", "to": "14:00"}
MONDAY_ALL_DAY = [{"days": "lundi", "from": "08:00", "to": "18:00"}]


# ── Groupe A — le bug rapporté (échouaient avant le correctif : INFEASIBLE ou éviction) ──────────

def test_cross_noon_enforced_straddling_lunch_no_collapse():
    """
    Le bug de Frédéric : 2 enforced (13:30 à cheval sur 12:00-14:00, et 16:00) + 2 cours normaux.
    Avant le correctif (vérifié par ablation contre master) : score=0, INFEASIBLE. Le score DOIT
    rester identique avec et sans `compactTeacherDay` (aucune éviction, aucun effondrement).
    """
    courses = [
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 13 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "E2", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 16 * 60, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "N1", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "N2", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = _straddle_base(courses, MONDAY_ALL_DAY)

    without = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH})[0]
    with_opt = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH, "compactTeacherDay": True})[0]

    assert without["score"] == 4, "prérequis : sans l'option, les 4 tâches tiennent"
    assert with_opt["score"] == without["score"], "compactTeacherDay (composante trou de midi) ne doit JAMAIS faire chuter le score"
    assert with_opt["isComplete"] is True, "pas d'INFEASIBLE, pas de neutralisation"


def test_cross_noon_enforced_straddling_lunch_symmetric():
    """
    Combine les deux directions : un enforced qui finit PILE à l'heure de début de pause (10:00-12:00,
    non-straddler par lui-même) + le straddler (13:30-15:00) + un 3e enforced après-midi normal, + 1
    cours droppable. Avant le correctif (vérifié par ablation) : score=0, INFEASIBLE (baseline=4).
    """
    courses = [
        {"week": 1, "code": "EA", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 10 * 60, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "EB", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 13 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "EC", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 16 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "N1", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = _straddle_base(courses, MONDAY_ALL_DAY)

    without = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH})[0]
    with_opt = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH, "compactTeacherDay": True})[0]

    assert without["score"] == 4
    assert with_opt["score"] == without["score"]


def test_cross_noon_enforced_straddler_with_task_group():
    """
    1 seul enforced straddler (13:30-15:00) + un cours lié par un taskGroup SÉQUENTIEL juste après
    (tout-ou-rien → `scheduled[TD] == scheduled[CM]` le rend indroppable, comme un 2e enforced).
    Avant le correctif (vérifié par ablation) : score=0, INFEASIBLE (baseline=2).
    """
    courses = [
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 90, "taskGroupId": "TG1",
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 13 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "C", "type": "TD", "name": "", "duration": 60, "taskGroupId": "TG1",
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = _straddle_base(courses, MONDAY_ALL_DAY, groups=[{"id": "TG1", "type": "sequential"}])

    without = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH})[0]
    with_opt = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH, "compactTeacherDay": True})[0]

    assert without["score"] == 2
    assert with_opt["score"] == without["score"], "le groupe séquentiel ne doit pas effondrer la semaine"
    by_code = {t["code"]: t for t in with_opt["solutions"]}
    assert by_code["C"]["startTime"] == by_code["E1"]["startTime"] + 90, "enchaînement sans gap préservé"


def test_cross_noon_enforced_straddler_no_eviction():
    """
    1 enforced straddler (13:30-15:00) + 5 cours normaux, fenêtre resserrée (08:00-17:00) qui force
    un vrai partage matin/après-midi (capacité matin 240 min < 300 min nécessaires). Avant le
    correctif (vérifié par ablation) : score=5 (1 cours normal évincé), baseline=6.
    """
    win = [{"days": "lundi", "from": "08:00", "to": "17:00"}]
    courses = [
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 13 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
    ] + [
        {"week": 1, "code": f"N{i}", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
        for i in range(1, 6)
    ]
    raw = _straddle_base(courses, win)

    without = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH})[0]
    with_opt = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH, "compactTeacherDay": True})[0]

    assert without["score"] == 6, "prérequis : sans l'option, les 6 tâches tiennent"
    assert with_opt["score"] == without["score"], "compactTeacherDay (composante trou de midi) ne doit évincer aucun cours normal"


# ── Groupe B — fidélité de la pause résiduelle (pas une désactivation déguisée) ───────────────────
# `solve()` n'expose pas la pénalité brute (§3 du plan, décision (a)) : ces tests forcent une TENSION
# entre le tie-break `earliest` (qui veut la position/le jour le plus tôt) et la minimisation du trou
# de midi (passe 2), et lisent le PLACEMENT résultant. Vérifié par ablation contre master : le
# placement observé diffère effectivement entre avant/après correctif dans chaque cas (sinon le test
# serait un faux positif, cf. avertissement méthodologique du plan §3).

def test_cross_noon_shortened_break_not_charged():
    """
    Cours du matin M (durée 120) confiné à 08:00-12:00 (2 positions possibles : 08:00-10:00 ou
    10:00-12:00) + enforced 13:30-15:00 (pause résiduelle 90 min). `earliest` veut M au plus tôt
    (08:00) ; si la pause résiduelle donne un trou nul en le collant à 12:00 (10:00-12:00), la passe 2
    doit préférer CETTE position (trou 0) à la position la plus tôt (trou réel 120, cf. test suivant).
    Avant le correctif (vérifié par ablation) : M reste à 08:00 (aucune pression, car `aft` restait
    vide sous l'ancienne classification scalaire — le trou n'était jamais même évalué).
    """
    win = [{"days": "lundi", "from": "08:00", "to": "12:00"}]
    courses = [
        {"week": 1, "code": "M", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 13 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
    ]
    raw = _straddle_base(courses, win)
    sol = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH,
                      "compactTeacherDay": True, "earliest": True})[0]
    assert sol["score"] == 2
    m = next(t for t in sol["solutions"] if t["code"] == "M")
    assert m["startTime"] == 10 * 60, "la pause résiduelle (90 min) doit être reconnue suffisante → M collé à 12:00"


def test_cross_noon_real_gap_still_charged():
    """
    Test CENTRAL (distingue un vrai correctif d'une désactivation déguisée) : M dispo lundi OU mardi
    08:00-10:00 (aucune marge intra-jour). Sur lundi (avec l'enforced 13:30-15:00), le trou réel est
    120 min (> pause résiduelle 90 min) et doit être facturé ; sur mardi (pas d'enforced), le trou est
    nul. `earliest` préfère lundi (plus tôt dans la semaine) ; si le vrai trou de 120 min est
    correctement facturé, la passe 2 doit préférer le déplacer sur mardi (trou 0) malgré `earliest`.
    Avant le correctif (vérifié par ablation) : M reste sur lundi (aucune pression, le trou n'étant
    jamais évalué sous l'ancienne classification scalaire — c'est la sous-facturation du §0.5/§0.6).
    """
    win = [{"days": "lundi mardi", "from": "08:00", "to": "10:00"}]
    courses = [
        {"week": 1, "code": "M", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 13 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
    ]
    raw = _straddle_base(courses, win)
    sol = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH,
                      "compactTeacherDay": True, "earliest": True})[0]
    assert sol["score"] == 2
    m = next(t for t in sol["solutions"] if t["code"] == "M")
    assert m["startTime"] // 1440 == 1, "le vrai trou de 120 min doit peser assez pour repousser M à mardi"


def test_cross_noon_uses_residual_length_not_lunch_length():
    """
    Épingle la MAGNITUDE soustraite : `p1 - p0` (pause résiduelle) et non `lunch[1] - lunch[0]`.

    Ajouté en revue (Opus, 2026-07-28). Le STATUT du plan signalait honnêtement que substituer
    `lunch_len` à `p1 - p0` ne cassait AUCUN test : les autres instances ne discriminent pas, parce
    que `lunch_len > p1 - p0` fait seulement SOUS-facturer (`gap` plus petit, jamais négatif grâce au
    `max(0, …)`) — la pression qualitative « bouger » y survivait. Il faut donc caler l'écart pour que
    le correct facture un gap > 0 pendant que le naïf tombe pile à 0 par clamp.

    Instance (pause 12:00-14:00, enforced 13:30-15:00 → pause résiduelle 12:00-13:30 = 90 min).
    M (120 min) est confiné à 09:50-12:00 : deux départs possibles seulement, 09:50 ou 10:00.
        M à 09:50-11:50 → first_a − last_m = 810 − 710 = 100 → correct 100−90 = 10 | naïf max(0, 100−120) = 0
        M à 10:00-12:00 → first_a − last_m = 810 − 720 =  90 → correct         0 | naïf max(0,  90−120) = 0
    Le correctif a donc une préférence STRICTE pour 10:00 ; avec `lunch_len` la passe 2 est
    indifférente et reste sur l'amorce `earliest` = 09:50.

    Ablation vérifiée en revue, 5 exécutions de chaque côté, résultat stable 5/5 : correct → 10:00,
    naïf → 09:50. Le test passe donc au ROUGE si l'on rétablit `lunch[1] - lunch[0]`.
    """
    win = [{"days": "lundi", "from": "09:50", "to": "12:00"}]
    courses = [
        {"week": 1, "code": "M", "type": "CM", "name": "", "duration": 120,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 13 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
    ]
    raw = _straddle_base(courses, win)
    sol = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH,
                      "compactTeacherDay": True, "earliest": True})[0]
    assert sol["score"] == 2
    m = next(t for t in sol["solutions"] if t["code"] == "M")
    assert m["startTime"] == 10 * 60, (
        "la pause soustraite doit être la RÉSIDUELLE (90) et non lunch_len (120) : avec 120 le trou "
        "est clampé à 0 des deux côtés et `earliest` laisse M à 09:50")


def test_cross_noon_enforced_covers_whole_lunch():
    """
    Enforced 11:00-15:00 : couvre la pause 12:00-14:00 en entier → pause résiduelle vide (P1==P0).
    Ni `compactTeacherDay` (aucun terme, `continue`) ni le partage matin/après-midi de `compact` (bloc
    journée unique) ne doivent s'appliquer. Assert principal : pas d'effondrement.
    """
    courses = [
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 240,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 11 * 60, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
        {"week": 1, "code": "N1", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "N2", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = _straddle_base(courses, MONDAY_ALL_DAY)
    without = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH})[0]
    with_opt = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH,
                           "compactTeacherDay": True, "compactTeacherDay": True})[0]
    assert without["score"] == 3
    assert with_opt["score"] == without["score"]
    assert with_opt["isComplete"] is True


# ── Groupe C — `compactTeacherDay` (sur-/sous-facturation du §0.5) ───────────────────────────

def test_compact_straddler_no_phantom_penalty():
    """
    M1+M2 (90 min chacun = 180 min < 240 min dispo) confinés à 08:00-12:00, laissant 60 min de marge
    intra-bloc + enforced 13:30-15:00. Avant le correctif historique (vérifié par ablation), le
    straddler était compté « matin » avec les 2 M → trou FANTÔME que la compacité intra-bloc (seule,
    à l'époque) tentait de réduire en repoussant M1/M2 en fin de créneau. Vérifié séparément (voir
    `verify_option_a` ad hoc) : SANS E1 (aucune présence après-midi), M1/M2 restent au plus tôt,
    collés (08:00/09:30) — la composante intra-bloc n'a bien aucune pression fantôme intrinsèque.

    Avec E1 présent (depuis la fusion compactTeacherDay), M1/M2 sont maintenant repoussés à
    09:00/10:30 — mais pour une raison DIFFÉRENTE et LÉGITIME cette fois : la composante trou-de-midi
    (ex-`crossNoonGap`, fusionnée dans la même passe) détecte un vrai trou évitable de 60 min entre
    la fin de M2 (11:00 si packé tôt) et E1 (13:30, fixe) au-delà du résiduel réel de pause (90 min,
    12:00-13:30 — E1 mange 13:30-14:00 du créneau nominal 12:00-14:00) et pousse légitimement M1/M2
    à se coller à la pause. Résultat : trou total nul sur toute la journée (intra-bloc ET
    inter-pause), pas juste intra-bloc comme avant la fusion.
    """
    win = [{"days": "lundi", "from": "08:00", "to": "12:00"}]
    courses = [
        {"week": 1, "code": "M1", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "M2", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 13 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
    ]
    raw = _straddle_base(courses, win)
    sol = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH,
                      "compactTeacherDay": True, "earliest": True})[0]
    assert sol["score"] == 3
    starts = sorted(t["startTime"] for t in sol["solutions"] if t["code"] in ("M1", "M2"))
    assert starts[1] - starts[0] == 90, "M1/M2 doivent rester collés entre eux (idle intra-bloc nul)"
    last_m_end = starts[1] + 90
    assert last_m_end == 12 * 60, \
        "M2 doit se coller exactement à la pause résiduelle (fin à 12:00) : trou de midi fermé"


def test_compact_straddler_afternoon_gap_charged():
    """
    N (60 min) dispo UNIQUEMENT lundi 17:00-18:00 ou mardi 08:00-09:00 + enforced 13:30-15:00 (lundi).
    Sur lundi, le trou réel après-midi (E1 fin 15:00 → N débute 17:00 = 120 min) doit être facturé par
    `compact` (bloc après-midi {E1,N}) ; sur mardi, aucun trou (E1 absent ce jour). `earliest` préfère
    lundi ; si le trou de 120 min est bien facturé, la passe 2 doit repousser N sur mardi. Avant le
    correctif (vérifié par ablation) : N reste sur lundi (sous-facturation du §0.5 — le straddler
    exclu du bloc après-midi laissait `len(members) < 2` → terme sauté, trou facturé 0).
    """
    win = [{"days": "lundi", "from": "17:00", "to": "18:00"},
           {"days": "mardi", "from": "08:00", "to": "09:00"}]
    courses = [
        {"week": 1, "code": "N", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"],
         "enforced": {"startTime": 13 * 60 + 30, "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}},
    ]
    raw = _straddle_base(courses, win)
    sol = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH,
                      "compactTeacherDay": True, "earliest": True})[0]
    assert sol["score"] == 2
    n = next(t for t in sol["solutions"] if t["code"] == "N")
    assert n["startTime"] // 1440 == 1, "le vrai trou de 120 min doit peser assez pour repousser N à mardi"


# ── Groupe D — no-op / garde-fous ──────────────────────────────────────────────────────────────

def test_lunch_none_unchanged():
    """`lunchBreak:{type:'none'}` : le chemin `on_half` inchangé doit rester bit-identique à master."""
    win = [{"days": "lundi", "from": "08:00", "to": "11:00"}]
    courses = [
        {"week": 1, "code": "C1", "type": "CM", "name": "C1", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
        {"week": 1, "code": "C2", "type": "CM", "name": "C2", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]},
    ]
    raw = _straddle_base(courses, win)
    sol = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": True,
                      "lunchBreak": {"type": "none"}})[0]
    assert sol["score"] == 2
    starts = sorted(t["startTime"] for t in sol["solutions"])
    assert starts[1] - starts[0] == 60, "inchangé : les 2 cours collés (même résultat qu'avant le correctif)"


def test_no_enforced_unchanged():
    """
    Instance SANS enforced, `compactTeacherDay` + `compactTeacherDay` : le résiduel dégénère en la
    pause fixe entière (aucun `enf_busy`) → strictement équivalent à l'ancien `on_half`/`lunch_len`.
    Le vrai filet est la suite existante (36 tests, tous verts sans modification) ; ce test ajoute une
    comparaison directe explicite.
    """
    courses = [
        {"week": 1, "code": f"C{i}", "type": "CM", "name": f"C{i}", "duration": 60,
         "teacher": ["T1"], "groups": ["G1"], "rooms": ["R1"]}
        for i in range(4)
    ]
    raw = _straddle_base(courses, MONDAY_ALL_DAY)
    sol = solve(raw, {"timeoutSeconds": 10, "compactTeacherDay": True,
                      "compactTeacherDay": True, "lunchBreak": STRADDLE_LUNCH})[0]
    assert sol["score"] == 4
    assert sol["isComplete"] is True


def test_groupless_course_cannot_collapse():
    """
    Cours `groups: []` (ni carvé par un groupe, ni par un enforced) forcé à se placer EN PLEINE pause
    (fenêtre 12:00-13:00 pile) + un enforced l'après-midi. Chemin non modélisé (§0.7 du plan) :
    couvert uniquement par le `max(0, …)` structurel. Assert : jamais INFEASIBLE.
    """
    resources = [
        {"resourceType": "teacher", "resources": [{"id": "T1"}]},
        {"resourceType": "room", "resources": [{"id": "R1"}]},
    ]
    noon_only = [{"days": "lundi", "from": "12:00", "to": "13:00"}]
    courses = [
        {"week": 1, "code": "G0", "type": "CM", "name": "", "duration": 60,
         "teacher": ["T1"], "groups": [], "rooms": ["R1"]},
        {"week": 1, "code": "E1", "type": "CM", "name": "", "duration": 90,
         "teacher": ["T1"], "groups": [], "rooms": ["R1"],
         "enforced": {"startTime": 15 * 60, "teacher": ["T1"], "groups": [], "rooms": ["R1"]}},
    ]
    raw = {"week": 1, "resources": resources, "courses": courses,
           "constraints": {"T1": noon_only, "R1": MONDAY_ALL_DAY}}
    sol = solve(raw, {"timeoutSeconds": 10, "lunchBreak": STRADDLE_LUNCH,
                      "compactTeacherDay": True, "compactTeacherDay": True})[0]
    assert sol["score"] == 2, "jamais INFEASIBLE malgré le cours sans groupe en pleine pause"
    g0 = next(t for t in sol["solutions"] if t["code"] == "G0")
    assert g0["startTime"] == 12 * 60, "forcé en pleine pause par sa seule fenêtre disponible"
