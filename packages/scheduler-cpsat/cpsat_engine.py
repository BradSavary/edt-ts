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
  - enforced                  → start + ressources fixes imposés, ignore la dispo ET maxDailyMinutes
                                (réplique bookEnforced() — sous la responsabilité de l'utilisateur)
  - dépendances CM→TD→TP      → SchedulerData._determineDependencies (par code + inclusion des groupes)
                                + intégrité de chaîne (un dépendant placé exige son prérequis placé)
  - taskGroups                → RawScheduleData.groups + CourseTaskData.taskGroupId
                                (parallel : départs égaux ; sequential : enchaînement sans gap)
  - maxDailyMinutes           → plafond quotidien par ressource (réification on_day) — hors enforced
  - pause méridienne fixe     → scheduler.ts _applyLunchBreak (retirée des seuls GROUP, lun-ven)
  - préférences douces prof   → passe 2 (à placement fixé) : compacité par demi-journée
                                (compactTeacherHalfDays) et/ou moins de jours (minimizeTeacherDays)
                                et/ou équilibrage de la charge quotidienne (balanceTeacherDailyLoad,
                                passe 3, min-max des pics à placement ET passe-2 figés)

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

# Poids (en « minutes-équivalent ») d'une journée de présence d'un enseignant en trop, pour l'option
# douce minimizeTeacherDays. Sert uniquement à mettre les deux préférences douces sur une échelle
# commune quand elles sont combinées avec compactTeacherHalfDays (l'idle est en minutes) : une
# journée de présence supplémentaire « coûte » autant que 240 min de trous. Réglable.
DAY_PRESENCE_PENALTY = 240

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


def _residual_break(busy: list[tuple[int, int]], l0: int, l1: int) -> tuple[int, int]:
    """Plus grand sous-intervalle contigu de [l0,l1] libre des intervalles `busy`.

    `busy` et le retour sont en minutes DEPUIS MINUIT du jour considéré. Retourne (l0,l0)
    — longueur nulle — si la fenêtre est entièrement occupée. Sert à définir la pause
    méridienne RÉELLEMENT disponible d'un (enseignant, jour) quand un cours enforced
    empiète dessus : la pause est écourtée, pas supprimée.
    """
    clipped = sorted((max(s, l0), min(e, l1)) for s, e in busy if s < l1 and e > l0)
    best, cur = (l0, l0), l0
    for s, e in clipped:
        if s - cur > best[1] - best[0]:
            best = (cur, s)
        cur = max(cur, e)
    if l1 - cur > best[1] - best[0]:
        best = (cur, l1)
    return best


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


class EnforcedConflictError(ValueError):
    """Deux cours enforced se chevauchent sur une ressource partagée (instance incohérente)."""


def _validate_enforced(courses: list[dict]) -> None:
    """
    Réplique Loader.validateEnforcedCourses : le chemin CP-SAT ne passe pas par le Loader Node,
    donc cette cohérence doit être vérifiée ici — sinon deux enforced en conflit rendent le modèle
    INFEASIBLE et effondrent silencieusement toute la semaine, au lieu d'une erreur ciblée.
    (Les alternatives dans un enforced sont déjà interdites côté client ; on ne revalide que les
    chevauchements, seul cas atteignable via l'UI.)
    """
    enforced = [c for c in courses if c.get("enforced")]
    for i in range(len(enforced)):
        a = enforced[i]
        ea = a["enforced"]
        end_a = ea["startTime"] + a["duration"]
        res_a = set(ea["teacher"]) | set(ea["groups"]) | set(ea["rooms"])
        for j in range(i + 1, len(enforced)):
            b = enforced[j]
            eb = b["enforced"]
            end_b = eb["startTime"] + b["duration"]
            if ea["startTime"] < end_b and end_a > eb["startTime"]:
                shared = res_a & (set(eb["teacher"]) | set(eb["groups"]) | set(eb["rooms"]))
                if shared:
                    raise EnforcedConflictError(
                        f'Conflit entre cours enforced "{a.get("code")}" ({a.get("type")}) et '
                        f'"{b.get("code")}" ({b.get("type")}) : ressource(s) partagée(s) '
                        f'[{", ".join(sorted(shared))}] sur le même créneau.'
                    )


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
      - compactTeacherHalfDays : bool (défaut False) — préférence DOUCE : dans chaque demi-journée
                           où un enseignant est présent, coller ses cours (minimiser les trous À
                           L'INTÉRIEUR d'un bloc matin/après-midi). N'interdit ni ne pénalise d'être
                           présent matin ET après-midi, ni sur plusieurs jours : seuls les temps
                           morts intra-bloc comptent. Si la pause est fixe et qu'un cours `enforced`
                           empiète dessus, le bloc n'est plus « matin/après-midi » au sens scalaire
                           mais délimité par la pause RÉSIDUELLE de ce (prof, jour) — la portion de
                           pause encore libre après l'enforced (voir `crossNoonGap` ci-dessous pour
                           le détail) — pour ne pas facturer la pause écourtée comme du temps mort.
                           Si l'enforced mange la pause en entier, plus de scission : la journée est
                           un bloc unique et son temps mort réel est facturé intégralement. Trou
                           connu : un cours à cheval sur la pause dont `groups` est VIDE (ni carvé
                           par le groupe ni par un enforced) échappe à cette classification — non
                           modélisé en v1, neutralisé par le `max(0, …)` structurel de `crossNoonGap`
                           plutôt que modélisé explicitement.
      - minimizeTeacherDays : bool (défaut False) — préférence DOUCE : concentrer les cours d'un
                           enseignant sur le moins de JOURNÉES distinctes possible (remplir
                           matin+après-midi d'un jour plutôt qu'étaler sur plusieurs).
                           Les deux options ci-dessus sont indépendantes et combinables.
                           Résolution en deux passes : passe 1 maximise le nombre de cours placés
                           (comme sans option) ; passe 2, à ce nombre FIXÉ, minimise la pénalité
                           douce combinée. Ne dégrade jamais le placement ni les contraintes dures.
                           `provenOptimal` reste basé sur la passe 1 (l'optimum doux peut ne pas
                           être prouvé sous le timeout).
      - balanceTeacherDailyLoad : bool (défaut False) — préférence DOUCE : équilibrer la charge
                           quotidienne d'un enseignant entre ses jours de présence (min-max de la
                           charge par jour). N'ajoute jamais de jour : force la présence-jours en
                           passe 2 (comme minimizeTeacherDays) puis équilibre en passe 3, à
                           placement ET pénalité passe-2 FIGÉS. Ne dégrade jamais placement ni
                           contraintes dures. `provenOptimal` reste basé sur la passe 1.
                           ATTENTION COÛT : la passe 3 est une vraie optimisation combinatoire
                           min-max (contrairement au placement souvent quasi-trivial des passes 1-2)
                           — surcoût notable mesuré ~2s→18s sur S48. Utilisable en interactif, mais
                           bien plus lourde que les autres douces.
      - crossNoonGap     : bool (défaut False) — préférence DOUCE : pénalise le trou de midi d'un
                           enseignant présent matin ET après-midi, au-delà de la pause déjeuner
                           (limite les journées à faible ratio cours/amplitude, ex. 8h+18h). Le
                           terme est en minutes, dans la même échelle que l'idle de
                           `compactTeacherHalfDays`, et rejoint la même passe 2 (aucune passe
                           supplémentaire, aucun surcoût façon `balanceTeacherDailyLoad`). Ignorée
                           si la pause n'est pas fixe (`lunchBreak.type != 'fixed'`) : sans pause
                           fixe, la découpe matin/après-midi est arbitraire et la positivité du
                           trou n'est plus garantie.
                           Un `enforced` empiétant sur la pause (ex. 13:30 sur 12:00–14:00) est
                           épinglé sans domaine de disponibilité (fidèle à `bookEnforced()`) : le
                           trou est calculé contre la pause RÉSIDUELLE de ce (prof, jour) — le plus
                           grand sous-intervalle de la pause encore libre des enforced de cet
                           enseignant ce jour-là (`_residual_break`), pas la constante `lunch_len`.
                           Si la pause est mangée en entier par un ou plusieurs enforced, aucune
                           scission matin/après-midi : le terme est sauté pour ce (prof, jour), et
                           `compactTeacherHalfDays` (s'il est actif) facture le temps mort de la
                           journée entière comme un bloc unique — la notion de « trou de midi » n'a
                           plus d'objet. Positivité du terme assurée STRUCTURELLEMENT
                           (`AddMaxEquality(gap, [raw_gap, 0])`), plus seulement par construction du
                           domaine : un enforced à cheval peut rendre `raw_gap` négatif (le proxy
                           scalaire d'origine le classait à tort d'un seul côté), et cette préférence
                           DOUCE ne doit jamais pouvoir rendre le modèle INFEASIBLE. Trou connu (hors
                           périmètre v1) : un cours à cheval dont `groups` est VIDE n'est carvé ni
                           par un groupe ni par un enforced et peut se placer en pleine pause avec un
                           `start` variable — non couvert par la partition ci-dessus, neutralisé par
                           le `max(0, …)` plutôt que modélisé explicitement.
      - minimizeTeacherRoomChanges : bool (défaut False) — préférence DOUCE de grand confort : pour
                           un enseignant, garder la même salle d'un cours au suivant dans une même
                           demi-journée quand une salle commune existe. Passe 4, tout en bas de la
                           hiérarchie, appliquée à PLACEMENT GELÉ (post-traitement quasi pur) :
                           `scheduled[]`, `start[]` et tous les littéraux non-salle sont figés en dur
                           à la solution des passes précédentes, seul le choix parmi les salles
                           ALTERNATIVES reste libre. Les 4 autres douces ne dépendent que de
                           grandeurs gelées → strictement préservées, aucun verrou dur
                           supplémentaire nécessaire. Fidèle (pénalise les vraies transitions entre
                           cours consécutifs d'une même demi-journée, pas une borne), no-op si aucun
                           cours n'a de salle alternative influençable, coût attendu négligeable.
                           `provenOptimal` reste basé sur la passe 1.
    """
    config = config or {}
    week = raw["week"]
    constraints = raw.get("constraints") or {}
    exclude_types = set(config.get("excludeTypes", ["Autonomie"]))
    ignore_daily = bool(config.get("ignoreDailyLimits", False))
    earliest = bool(config.get("earliest", False))
    compact_half_days = bool(config.get("compactTeacherHalfDays", False))
    minimize_days = bool(config.get("minimizeTeacherDays", False))
    balance_load = bool(config.get("balanceTeacherDailyLoad", False))
    cross_noon = bool(config.get("crossNoonGap", False))
    minimize_rooms = bool(config.get("minimizeTeacherRoomChanges", False))
    # L'équilibrage ancre le nombre de jours : il force la présence-jours dans la passe 2.
    include_days = minimize_days or balance_load

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

    # Frontière matin/après-midi pour la compacité par demi-journée.
    half_cut = lunch[1] if lunch is not None else 13 * 60   # fin de pause fixe, sinon 13:00

    rwin = _make_availability(constraints, week, group_ids, lunch)

    # Partition des cours : modélisés vs exclus (Autonomie…).
    all_courses = raw.get("courses", [])
    counters = {}                              # index course -> compteur 1-based (fidélité fallbackId)
    for i, c in enumerate(all_courses):
        counters[i] = i + 1
    courses = [(i, c) for i, c in enumerate(all_courses) if c.get("type") not in exclude_types]
    excluded = [(i, c) for i, c in enumerate(all_courses) if c.get("type") in exclude_types]

    # Cohérence des enforced (le chemin CP-SAT court-circuite le Loader Node qui la vérifie).
    _validate_enforced([c for _, c in courses])

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
            # Enforced : start imposé, ressources fixes, ignore la dispo ET le plafond
            # maxDailyMinutes (réplique bookEnforced() côté core, qui n'appelle jamais
            # _addDailyUsage() — un enforced est sous la responsabilité de l'utilisateur,
            # dépassements compris ; ne pas l'ajouter à `capped` sous peine d'INFEASIBLE
            # global dès qu'un enforced dépasse seul un plafond quotidien).
            model.Add(scheduled[li] == 1)
            model.Add(start[li] == e["startTime"])
            possible_days[li] = [e["startTime"] // 1440]
            for entries, rtype in ((e["teacher"], TEACHER), (e["groups"], GROUP), (e["rooms"], ROOM)):
                for rid in entries:
                    used_literals[li].append((rid, rtype_of.get(rid, rtype), scheduled[li]))
                    intervals_by_res[rid].append(
                        model.NewOptionalFixedSizeIntervalVar(start[li], dur, scheduled[li], f"iv{li}_{rid}"))
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

    # Occupation enforced par (enseignant, jour) — sert à calculer la pause méridienne
    # RÉELLEMENT disponible d'un enseignant quand un enforced empiète dessus (pause écourtée,
    # pas supprimée). Portée fonction entière : réutilisé par les préférences douces (Option A/D
    # ci-dessous) ET par la passe 4 (§1.6, cohérence de la frontière demi-journée). Les `start`
    # des enforced sont des constantes Python → aucun coût solveur.
    enf_busy: dict[tuple[str, int], list[tuple[int, int]]] = defaultdict(list)
    if lunch is not None:
        for li, (_gi, c) in enumerate(courses):
            e = c.get("enforced")
            if not e:
                continue
            d, off = e["startTime"] // 1440, e["startTime"] % 1440
            for (rid, rtype, _lit) in used_literals[li]:
                if rtype == TEACHER:
                    enf_busy[(rid, d)].append((off, off + c["duration"]))

    def residual(tid: str, d: int) -> tuple[int, int]:
        """Pause résiduelle (P0,P1) de ce (prof, jour) ; (0,0) si pas de pause fixe."""
        if lunch is None:
            return (0, 0)
        return _residual_break(enf_busy.get((tid, d), []), lunch[0], lunch[1])

    # Non-chevauchement par ressource.
    for rid, ivs in intervals_by_res.items():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    # Dépendances CM→TD→TP : précédence temporelle (conditionnée) + intégrité de chaîne.
    # _determine_dependencies raisonne sur la liste `courses` compacte → indices locaux directs.
    for dep, pre in _determine_dependencies([c for _, c in courses]):
        # Un dépendant ENFORCED est épinglé par l'utilisateur : son placement est autoritaire et
        # échappe à la chaîne auto-dérivée (fidèle à scheduler-core, où les enforced sont exclus de
        # la vérification de dépendance — _collectDependents / _backtrack). Sans cette exclusion, un
        # cours épinglé ayant un frère de type antérieur (même code/groupes) forcerait ce prérequis
        # avant l'heure figée — souvent impossible → modèle INFEASIBLE, toute la semaine s'effondre.
        # (Un prérequis enforced, lui, reste une contrainte amont valide pour un dépendant normal.)
        if courses[dep][1].get("enforced"):
            continue
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

    on_half_cache = {}

    def on_half(li, d, h):
        if (li, d, h) not in on_half_cache:
            base = d * 1440
            lo = base if h == 0 else base + half_cut
            hi = base + half_cut if h == 0 else base + 1440
            ge = model.NewBoolVar(f"hge{li}_{d}_{h}")
            model.Add(start[li] >= lo).OnlyEnforceIf(ge)
            model.Add(start[li] <= lo - 1).OnlyEnforceIf(ge.Not())
            lt = model.NewBoolVar(f"hlt{li}_{d}_{h}")
            model.Add(start[li] <= hi - 1).OnlyEnforceIf(lt)
            model.Add(start[li] >= hi).OnlyEnforceIf(lt.Not())
            oh = model.NewBoolVar(f"oh{li}_{d}_{h}")
            model.AddBoolAnd([ge, lt]).OnlyEnforceIf(oh)
            model.AddBoolOr([ge.Not(), lt.Not()]).OnlyEnforceIf(oh.Not())
            on_half_cache[(li, d, h)] = oh
        return on_half_cache[(li, d, h)]

    on_side_cache = {}

    def on_side(li, d, p0, p1, h):
        """« Le cours li est ENTIÈREMENT du côté h de la pause résiduelle [p0,p1] du jour d ».

        h=0 (matin)  ⟺ base ≤ start ET start + durée ≤ base + p0   ← teste la FIN, pas le début
        h=1 (aprem)  ⟺ base + p1 ≤ start < base + 1440

        Différence clé avec on_half (seuil scalaire sur le seul `start`) : un cours à cheval sur
        la pause n'appartient à AUCUN des deux côtés — littéral constamment faux des deux côtés.
        C'est exactement le cas d'un enforced qui empiète sur la pause, que le seuil scalaire
        rangeait de force d'un côté, cassant l'identité du trou de midi.
        """
        key = (li, d, p0, p1, h)
        if key not in on_side_cache:
            base, dur = d * 1440, courses[li][1]["duration"]
            lo = base if h == 0 else base + p1
            hi = base + p0 - dur if h == 0 else base + 1439      # bornes SUR start, inclusives
            if hi < lo:                                          # ne tient pas de ce côté
                on_side_cache[key] = model.NewConstant(0)
            else:
                ge = model.NewBoolVar(f"sge{li}_{d}_{h}")
                model.Add(start[li] >= lo).OnlyEnforceIf(ge)
                model.Add(start[li] <= lo - 1).OnlyEnforceIf(ge.Not())
                le = model.NewBoolVar(f"sle{li}_{d}_{h}")
                model.Add(start[li] <= hi).OnlyEnforceIf(le)
                model.Add(start[li] >= hi + 1).OnlyEnforceIf(le.Not())
                os_ = model.NewBoolVar(f"os{li}_{d}_{h}")
                model.AddBoolAnd([ge, le]).OnlyEnforceIf(os_)
                model.AddBoolOr([ge.Not(), le.Not()]).OnlyEnforceIf(os_.Not())
                on_side_cache[key] = os_
        return on_side_cache[key]

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

    # Préférences DOUCES enseignant (chacune derrière son flag ; indépendantes et combinables).
    # Toutes deux minimisées en passe 2, à placement FIXÉ. `penalty_terms` agrège des termes déjà
    # ramenés à une échelle commune « minutes » (l'idle est en minutes ; une journée de présence en
    # trop vaut DAY_PRESENCE_PENALTY minutes), de sorte qu'une simple somme les concilie sans qu'une
    # option n'écrase l'autre quand les deux sont actives.
    penalty_terms: list[Any] = []
    peak_terms: list[Any] = []            # Σ pic quotidien (passe 3, balance_load uniquement)
    if compact_half_days or minimize_days or balance_load or (cross_noon and lunch is not None):
        # Littéraux enseignant par cours : (tid, li, lit d'utilisation) — enforced inclus
        # (lit == scheduled[li]), alternatives incluses (lit == bool de l'alternative choisie).
        teacher_lits = defaultdict(list)                      # tid -> [(li, lit)]
        for li in range(len(courses)):
            for (rid, rtype, lit) in used_literals[li]:
                if rtype == TEACHER:
                    teacher_lits[rid].append((li, lit))

        # ── Option A : compacité par demi-journée (minimiser les trous DANS un bloc matin/aprem). ──
        # Pour chaque (enseignant, jour, bloc) présent : idle = (fin du dernier cours − début du
        # premier) − somme des durées présentes. Les cours d'un même prof ne se chevauchent pas
        # (NoOverlap sur la ressource) ⇒ idle = temps mort total entre ses cours de ce bloc. Nul si
        # 0/1 cours présent. Être présent matin ET après-midi n'est jamais pénalisé (blocs disjoints).
        # Le bloc n'est PAS toujours "matin/après-midi" au sens du seuil scalaire `on_half` : quand la
        # pause est fixe, le partage se fait sur la pause RÉSIDUELLE de ce (prof, jour) — voir
        # `residual()` — pour ne pas facturer en temps mort la portion de pause qu'un enforced a
        # mangée (§0.5/§0.6 du plan). `lunch is None` garde `on_half` tel quel (chemin inerte).
        if compact_half_days:
            for tid, lst in teacher_lits.items():
                days = sorted({d for (li, _) in lst for d in possible_days[li]})
                for d in days:
                    if lunch is None:
                        blocks = [(h, (lambda li, h=h: on_half(li, d, h))) for h in (0, 1)]
                    else:
                        p0, p1 = residual(tid, d)
                        if p1 > p0:
                            blocks = [(h, (lambda li, h=h: on_side(li, d, p0, p1, h))) for h in (0, 1)]
                        else:
                            # Pause entièrement mangée par un enforced : plus de scission — la
                            # journée est un bloc unique, `compact` facture l'intégralité du trou.
                            blocks = [(0, (lambda li: on_day(li, d)))]
                    for bidx, side in blocks:
                        members = []                          # (li, p) candidats de ce bloc
                        for (li, lit) in lst:
                            if d not in possible_days[li]:
                                continue
                            p = model.NewBoolVar(f"cp{tid}_{li}_{d}_{bidx}")
                            oh = side(li)
                            model.AddBoolAnd([lit, oh]).OnlyEnforceIf(p)
                            model.AddBoolOr([lit.Not(), oh.Not()]).OnlyEnforceIf(p.Not())
                            members.append((li, p))
                        if len(members) < 2:
                            continue                          # 0/1 cours ⇒ aucun trou possible
                        base = d * 1440
                        first = model.NewIntVar(base, base + 1440, f"first{tid}_{d}_{bidx}")
                        last = model.NewIntVar(base, base + 1440, f"last{tid}_{d}_{bidx}")
                        busy = []
                        for (li, p) in members:
                            dur = courses[li][1]["duration"]
                            model.Add(first <= start[li]).OnlyEnforceIf(p)       # first ≤ min début présent
                            model.Add(last >= start[li] + dur).OnlyEnforceIf(p)  # last ≥ max fin présente
                            busy.append(dur * p)
                        idle = model.NewIntVar(0, 1440, f"idle{tid}_{d}_{bidx}")
                        model.Add(idle == last - first - sum(busy))              # ≥0 ⇒ 0 si <2 présents
                        penalty_terms.append(idle)            # en minutes

        # ── Option D : trou de midi (idle qui traverse la pause déjeuner, au-delà de celle-ci). ──
        # Pour chaque (enseignant, jour) présent matin ET après-midi :
        #   trou = début_1er_aprem − fin_dernier_matin − pause RÉSIDUELLE (p1 − p0, pas la constante
        #   `lunch_len`) — un enforced empiétant sur la pause l'écourte, il ne la supprime pas (§0.6
        #   du plan). Positivité assurée STRUCTURELLEMENT par `AddMaxEquality(gap, [raw_gap, 0])`
        #   ci-dessous, plus par le seul domaine — un enforced à cheval rend l'ancien argument
        #   « pause carvée ⇒ ≥0 » faux, c'est la cause racine de l'INFEASIBLE corrigé ici.
        # Gate : pause fixe uniquement (sinon un cours peut enjamber midi → identité fausse).
        if cross_noon and lunch is not None:
            for tid, lst in teacher_lits.items():
                days = sorted({d for (li, _) in lst for d in possible_days[li]})
                for d in days:
                    p0, p1 = residual(tid, d)
                    if p1 == p0:
                        continue                  # pause entièrement mangée ⇒ plus de scission matin/aprem,
                                                   # `compact` prend le relais sur la journée entière (§1.4)
                    base = d * 1440
                    morn, aft = [], []            # (li, p_m) / (li, p_a)
                    for (li, lit) in lst:
                        if d not in possible_days[li]:
                            continue
                        p_m = model.NewBoolVar(f"cnm{tid}_{li}_{d}")
                        oh0 = on_side(li, d, p0, p1, 0)
                        model.AddBoolAnd([lit, oh0]).OnlyEnforceIf(p_m)
                        model.AddBoolOr([lit.Not(), oh0.Not()]).OnlyEnforceIf(p_m.Not())
                        p_a = model.NewBoolVar(f"cna{tid}_{li}_{d}")
                        oh1 = on_side(li, d, p0, p1, 1)
                        model.AddBoolAnd([lit, oh1]).OnlyEnforceIf(p_a)
                        model.AddBoolOr([lit.Not(), oh1.Not()]).OnlyEnforceIf(p_a.Not())
                        morn.append((li, p_m))
                        aft.append((li, p_a))
                    if not morn or not aft:
                        continue                  # aucun cours possible d'un côté ⇒ jamais de trou
                    # fin_matin = MAX des fins matin présentes (0 si aucune) ; e_i = fin si présent, sinon 0.
                    ends = []
                    for (li, p_m) in morn:
                        dur = courses[li][1]["duration"]
                        e_i = model.NewIntVar(0, base + 1440, f"em{tid}_{li}_{d}")
                        model.Add(e_i == start[li] + dur).OnlyEnforceIf(p_m)
                        model.Add(e_i == 0).OnlyEnforceIf(p_m.Not())
                        ends.append(e_i)
                    last_m = model.NewIntVar(0, base + 1440, f"lm{tid}_{d}")
                    model.AddMaxEquality(last_m, ends)
                    # début_aprem = MIN des débuts aprem présents (BIG si aucun) ; s_i = début si présent, sinon BIG.
                    BIG = base + 1440
                    starts = []
                    for (li, p_a) in aft:
                        s_i = model.NewIntVar(0, BIG, f"sa{tid}_{li}_{d}")
                        model.Add(s_i == start[li]).OnlyEnforceIf(p_a)
                        model.Add(s_i == BIG).OnlyEnforceIf(p_a.Not())
                        starts.append(s_i)
                    first_a = model.NewIntVar(0, BIG, f"fa{tid}_{d}")
                    model.AddMinEquality(first_a, starts)
                    # both = présent matin ET aprem.
                    pm_any = model.NewBoolVar(f"pmA{tid}_{d}")
                    model.AddMaxEquality(pm_any, [p for (_, p) in morn])
                    pa_any = model.NewBoolVar(f"paA{tid}_{d}")
                    model.AddMaxEquality(pa_any, [p for (_, p) in aft])
                    both = model.NewBoolVar(f"both{tid}_{d}")
                    model.AddBoolAnd([pm_any, pa_any]).OnlyEnforceIf(both)
                    model.AddBoolOr([pm_any.Not(), pa_any.Not()]).OnlyEnforceIf(both.Not())
                    # trou = first_a − last_m − pause_résiduelle (p1−p0), seulement si both ; sinon 0.
                    # Positivité NON garantie par construction pour un enforced à cheval (§0.3 du plan)
                    # → structurelle via AddMaxEquality, jamais via le domaine seul.
                    raw_gap = model.NewIntVar(-1440, 1440, f"cnraw{tid}_{d}")
                    model.Add(raw_gap == first_a - last_m - (p1 - p0)).OnlyEnforceIf(both)
                    model.Add(raw_gap == 0).OnlyEnforceIf(both.Not())
                    gap = model.NewIntVar(0, 1440, f"cngap{tid}_{d}")
                    model.AddMaxEquality(gap, [raw_gap, 0])     # ← plus JAMAIS d'infaisabilité par ce terme
                    penalty_terms.append(gap)     # en minutes → passe 2

        # ── Présence-jours enseignant (partagée : pénalité "moins de jours" + équilibrage). ──
        # Construite dès qu'une des deux options la requiert (minimize_days OU balance_load).
        present_q = defaultdict(list)                 # (tid, d) -> [(li, q)] avec q = lit ∧ on_day
        day_used_by = {}                              # (tid, d) -> BoolVar "présent ce jour"
        if include_days:
            for tid, lst in teacher_lits.items():
                for d in sorted({d for (li, _) in lst for d in possible_days[li]}):
                    present = []
                    for (li, lit) in lst:
                        if d not in possible_days[li]:
                            continue
                        q = model.NewBoolVar(f"pd{tid}_{li}_{d}")
                        od = on_day(li, d)
                        model.AddBoolAnd([lit, od]).OnlyEnforceIf(q)
                        model.AddBoolOr([lit.Not(), od.Not()]).OnlyEnforceIf(q.Not())
                        present.append((li, q))
                        present_q[(tid, d)].append((li, q))
                    if not present:
                        continue
                    day_used = model.NewBoolVar(f"day{tid}_{d}")
                    model.AddMaxEquality(day_used, [q for (_, q) in present])
                    day_used_by[(tid, d)] = day_used
                    if include_days:                  # jours pénalisés dès que minimize_days OU balance
                        penalty_terms.append(DAY_PRESENCE_PENALTY * day_used)

        # ── Équilibrage : min-max de la charge quotidienne par enseignant (passe 3). ──
        # `peak_terms` n'entre PAS dans `penalty_terms` (passe 2) : son propre niveau lexicographique
        # (passe 3). `1440` = borne physique (une journée ≤ 24 h de minutes), sûre même si
        # `ignoreDailyLimits`. `balance_load ⇒ include_days`, donc `present_q` est toujours peuplé ici.
        if balance_load:
            for tid, lst in teacher_lits.items():
                days = sorted({d for (li, _) in lst for d in possible_days[li]})
                loads = []
                for d in days:
                    qs = present_q.get((tid, d), [])
                    if not qs:
                        continue
                    loads.append(sum(courses[li][1]["duration"] * q for (li, q) in qs))
                if len(loads) < 2:
                    continue                          # ≤1 jour possible ⇒ rien à équilibrer
                peak = model.NewIntVar(0, 1440, f"peak{tid}")
                model.AddMaxEquality(peak, loads)     # peak = charge quotidienne max
                peak_terms.append(peak)

    # ── Passe 1 : optimum du NOMBRE de cours placés (départage « au plus tôt » si earliest). ──
    total_timeout = float(config.get("timeoutSeconds", 30.0))
    place_term = sum(scheduled.values())
    if earliest and courses:
        weight = HORIZON * len(courses) + 1        # une tâche de plus bat tout gain d'avance
        model.Maximize(weight * place_term - sum(start.values()))
    else:
        model.Maximize(place_term)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = total_timeout
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Aucune solution (rare : instance vide ou incohérente) — tout est neutralisé.
        return [_empty_solution(all_courses, week, exclude_types, rtype_of, counters, status)]

    placement_proven = status == cp_model.OPTIMAL
    best_placed = int(round(solver.Value(place_term)))

    # ── Passe 2 : à placement FIXÉ, minimiser la pénalité douce enseignant (compacité / jours). ──
    if penalty_terms:
        model.Add(place_term >= best_placed)          # verrou : jamais moins de cours placés
        # Amorce (warm start) avec la solution de la passe 1 → convergence plus rapide.
        model.ClearHints()
        for li in range(len(courses)):
            model.AddHint(scheduled[li], solver.Value(scheduled[li]))
            model.AddHint(start[li], solver.Value(start[li]))
        model.Minimize(sum(penalty_terms))
        remaining = max(1.0, total_timeout - solver.WallTime())
        solver2 = cp_model.CpSolver()
        solver2.parameters.max_time_in_seconds = remaining
        status2 = solver2.Solve(model)
        if status2 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            solver = solver2                          # extraire la solution optimisée
        # provenOptimal reste basé sur placement_proven (passe 1) — voir docstring de solve().

    # ── Passe 3 : à placement ET pénalité passe-2 FIGÉS, équilibrer (min Σ pic quotidien). ──
    if balance_load and peak_terms:
        model.Add(place_term >= best_placed)          # placement toujours verrouillé
        if penalty_terms:
            best_p2 = int(round(solver.Value(sum(penalty_terms))))
            model.Add(sum(penalty_terms) <= best_p2)  # fige compacité + jours acquis en passe 2
        # Verrou DUR du nombre total de jours de présence : empêche la passe 3 d'ajouter un jour
        # en le "finançant" par une baisse d'idle (échange days↔idle autorisé par le seul lock agrégé
        # quand compactTeacherHalfDays est co-actif). Rend l'invariant "n'ajoute jamais de jour" étanche.
        if day_used_by:
            best_days = int(round(sum(solver.Value(v) for v in day_used_by.values())))
            model.Add(sum(day_used_by.values()) <= best_days)
        model.ClearHints()
        for li in range(len(courses)):
            model.AddHint(scheduled[li], solver.Value(scheduled[li]))
            model.AddHint(start[li], solver.Value(start[li]))
        model.Minimize(sum(peak_terms))
        remaining = max(1.0, total_timeout - solver.WallTime())
        solver3 = cp_model.CpSolver()
        solver3.parameters.max_time_in_seconds = remaining
        status3 = solver3.Solve(model)
        if status3 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            solver = solver3                          # extraire la solution équilibrée
        # provenOptimal reste basé sur placement_proven (passe 1).

    # ── Passe 4 : à placement ET affectations non-salle FIGÉS, minimiser les changements de salle. ──
    # Post-traitement pur (préférence de grand confort, tout en bas de la hiérarchie). On GÈLE en dur
    # scheduled[], start[] et TOUS les littéraux non-salle aux valeurs de la passe précédente ; seul le
    # choix parmi les salles ALTERNATIVES reste libre. Toutes les douces antérieures ne dépendent que de
    # grandeurs gelées → strictement préservées (aucun verrou agrégé/dur nécessaire). À placement gelé,
    # l'ORDRE des cours de chaque prof est connu : on pénalise les VRAIES transitions entre cours
    # consécutifs d'une même demi-journée (fidèle, pas une borne). No-op si aucun cours n'a de salle
    # alternative influençable. provenOptimal reste basé sur placement_proven (passe 1).
    if minimize_rooms:
        def _room_lits(li):                       # {rid: littéral} des salles candidates du cours li
            return {rid: lit for (rid, rtype, lit) in used_literals[li] if rtype == ROOM}

        def _has_alt_room(li):                     # au moins une salle candidate ≠ salle fixe (lit ≠ scheduled)
            return any(lit is not scheduled[li]
                       for (_, rtype, lit) in used_literals[li] if rtype == ROOM)

        # 1) Séquences consécutives par (prof effectif, jour, demi-journée), lues sur la solution GELÉE.
        # Même frontière que §1.3/§1.4 : pause résiduelle par (prof, jour) plutôt que `half_cut`
        # scalaire, pour ne pas ouvrir deux définitions contradictoires de « demi-journée » dans le
        # même fichier. Un straddler tombe côté après-midi (adjacent aux cours d'après-midi, c'est là
        # que la continuité de salle a du sens). Calcul en Python pur sur la solution gelée → aucun
        # coût solveur.
        seq = defaultdict(list)                    # (tid, d, h) -> [(start_val, li)]
        for li in range(len(courses)):
            if not solver.Value(scheduled[li]):
                continue
            sv = solver.Value(start[li])
            d = sv // 1440
            offset = sv - d * 1440
            for (rid, rtype, lit) in used_literals[li]:
                if rtype == TEACHER and solver.Value(lit):
                    if lunch is None:
                        h = 0 if offset < half_cut else 1
                    else:
                        p0, p1 = residual(rid, d)
                        h = 0 if (p1 == p0 or offset <= p0) else 1
                    seq[(rid, d, h)].append((sv, li))   # un cours multi-profs alimente chaque prof

        # 2) Paires consécutives INFLUENÇABLES → un booléen "au moins une salle commune choisie".
        same_vars = []
        for key, items in seq.items():
            items.sort()                            # ordre temporel = ordre réel (placement figé)
            for (_, i), (_, j) in zip(items, items[1:]):
                if not (_has_alt_room(i) or _has_alt_room(j)):
                    continue                        # deux salles fixes → issue constante, rien à optimiser
                ri, rj = _room_lits(i), _room_lits(j)
                shared = set(ri) & set(rj)
                if not shared:
                    continue                        # aucune salle commune → changement forcé (constant, omis)
                prods = []
                for r in shared:
                    b = model.NewBoolVar(f"rprod{i}_{j}_{r}")
                    model.AddBoolAnd([ri[r], rj[r]]).OnlyEnforceIf(b)          # b = (i choisit r) ∧ (j choisit r)
                    model.AddBoolOr([ri[r].Not(), rj[r].Not()]).OnlyEnforceIf(b.Not())
                    prods.append(b)
                same = model.NewBoolVar(f"rsame{i}_{j}")
                model.AddMaxEquality(same, prods)   # OR : au moins une salle commune choisie des deux côtés
                same_vars.append(same)

        if same_vars:                               # sinon rien d'influençable → passe entièrement sautée
            # 3) Gel DUR de tout SAUF les littéraux de salle.
            for li in range(len(courses)):
                model.Add(scheduled[li] == solver.Value(scheduled[li]))
                model.Add(start[li] == solver.Value(start[li]))
                for (rid, rtype, lit) in used_literals[li]:
                    if rtype != ROOM:
                        model.Add(lit == solver.Value(lit))
            # 4) Amorce (warm start) + minimisation du NB de changements = Σ (1 − même salle).
            model.ClearHints()
            for li in range(len(courses)):
                for (rid, rtype, lit) in used_literals[li]:
                    if rtype == ROOM:
                        model.AddHint(lit, solver.Value(lit))
            model.Minimize(len(same_vars) - sum(same_vars))
            remaining = max(1.0, total_timeout - solver.WallTime())
            solver4 = cp_model.CpSolver()
            solver4.parameters.max_time_in_seconds = remaining
            status4 = solver4.Solve(model)
            if status4 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                solver = solver4                    # extraire la solution ré-affectée en salle

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
        "provenOptimal": placement_proven,
    }
    if neutralized:
        result["neutralizedTasks"] = neutralized
    return [result]


def _neutralized(course, counter, week, rtype_of, reason_slug, reason):
    return {
        "task": _task_json(course, _task_id(course, counter), week, -1,
                           _candidate_resources(course, rtype_of)),
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
