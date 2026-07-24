"""
Spike d'apprentissage — modélisation CP-SAT du cas CM/TD/TP.

But : mesurer, PAS livrer. Code jetable, isolé du monorepo (aucune dépendance à
scheduler-*). On répond à une seule question go/no-go : le problème s'exprime-t-il
proprement dans l'idiome CP-SAT, à quel ordre de grandeur de taille/temps ?

Ce que ce script démontre volontairement :
  - alternatives de ressources (ResourceEntry « salle ∈ {R01, R02} ») : un intervalle
    optionnel par (tâche, salle) + exactly-one → pattern flexible job-shop ;
  - disponibilités : restriction du domaine de la variable de début ;
  - précédence CM → TD → TP (conditionnée à la présence des deux tâches) ;
  - « placer le maximum de tâches » : objectif Maximize(Σ scheduled[t]).

Ce qu'il ne fait PAS (hors périmètre du spike) : API/HTTP, jobs async, lecture de
vrais payloads, comparaison automatisée avec scheduler-core, lunch, enforced.
Le maxDailyMinutes (le seul point fiddly du triage) est présent mais désactivé
par défaut — voir ENABLE_MAX_DAILY plus bas.
"""

import sys

from ortools.sat.python import cp_model

# Console Windows en cp1252 par défaut : on force UTF-8 pour les accents/emoji.
sys.stdout.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# Modèle temporel : minutes depuis lundi 00:00 (comme scheduler-common).
# Lundi = jour 0. Mercredi = jour 2 → 8:00 = 2*1440 + 8*60 = 3360.
# ---------------------------------------------------------------------------
HORIZON = 7 * 1440  # une semaine
DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]


def wed(h, m=0):
    """Instant du mercredi (jour 2) à h:m, en minutes depuis lundi 00:00."""
    return 2 * 1440 + h * 60 + m


# ---------------------------------------------------------------------------
# Instance (CM/TD/TP du §5.6 de HeuristiquePriorite-Conception.md, enrichie).
#
# Le prof T1 n'est dispo que mercredi 8h-14h (360 min) — profil « fenêtre tendue »
# façon THARAUD. Les 4 tâches passent toutes par T1, or 120+90+90+150 = 450 > 360 :
# on ne peut pas tout placer. L'optimum en place 3, en lâche 1 → c'est exactement
# ce que « placer le maximum » doit trouver.
# ---------------------------------------------------------------------------
resources = {
    "T1":      {"type": "teacher", "avail": [(wed(8), wed(14))]},   # 360 min
    "BUT3-G3": {"type": "group",   "avail": [(wed(8), wed(18))]},
    "R01":     {"type": "room",    "avail": [(wed(8), wed(18))]},
    "R02":     {"type": "room",    "avail": [(wed(8), wed(18))]},
}

tasks = {
    #        durée  ressources toujours utilisées   salles alternatives (une seule choisie)
    "CM": {"dur": 120, "fixed": ["T1", "BUT3-G3"], "rooms": ["R01", "R02"]},
    "TD": {"dur": 90,  "fixed": ["T1", "BUT3-G3"], "rooms": ["R01", "R02"]},
    "TP": {"dur": 90,  "fixed": ["T1", "BUT3-G3"], "rooms": ["R01", "R02"]},
    "X":  {"dur": 150, "fixed": ["T1", "BUT3-G3"], "rooms": ["R01"]},  # indépendante
}

# Précédences : le suivant ne démarre pas avant la fin du précédent.
precedences = [("CM", "TD"), ("TD", "TP")]

# Démonstration du point fiddly (désactivé par défaut : ne change rien à CETTE
# instance, il est là pour être inspecté / activé, pas pour fausser le résultat).
ENABLE_MAX_DAILY = False
MAX_DAILY = {"T1": 400}  # plafond quotidien en minutes, par ressource


# ---------------------------------------------------------------------------
# Helpers disponibilité → domaine de la variable de début.
# ---------------------------------------------------------------------------
def intersect(wins_a, wins_b):
    out = []
    for a0, a1 in wins_a:
        for b0, b1 in wins_b:
            lo, hi = max(a0, b0), min(a1, b1)
            if lo < hi:
                out.append((lo, hi))
    return out


def start_domain(windows, dur):
    """Débuts valides pour une tâche de durée `dur` : [s, e-dur] par fenêtre."""
    ivs = [[s, e - dur] for (s, e) in windows if e - dur >= s]
    return cp_model.Domain.FromIntervals(ivs) if ivs else cp_model.Domain(1, 0)  # vide


# ---------------------------------------------------------------------------
# Construction du modèle.
# ---------------------------------------------------------------------------
model = cp_model.CpModel()

scheduled = {}          # t -> BoolVar : la tâche est-elle placée ?
start = {}              # t -> IntVar  : instant de début (partagé par toutes ses ressources)
uses_room = {}          # (t, r) -> BoolVar : la tâche t utilise-t-elle la salle r ?
intervals_by_res = {rid: [] for rid in resources}  # ressource -> [intervalles optionnels]

for t, td in tasks.items():
    dur = td["dur"]
    scheduled[t] = model.NewBoolVar(f"sched_{t}")
    start[t] = model.NewIntVar(0, HORIZON, f"start_{t}")

    # Disponibilité des ressources FIXES : le début doit y tenir (si la tâche est placée).
    fixed_windows = [(0, HORIZON)]
    for f in td["fixed"]:
        fixed_windows = intersect(fixed_windows, resources[f]["avail"])
    model.AddLinearExpressionInDomain(start[t], start_domain(fixed_windows, dur)) \
         .OnlyEnforceIf(scheduled[t])

    # Un intervalle optionnel par ressource fixe (toujours présent si la tâche est placée).
    for f in td["fixed"]:
        iv = model.NewOptionalFixedSizeIntervalVar(start[t], dur, scheduled[t], f"iv_{t}_{f}")
        intervals_by_res[f].append(iv)

    # Alternatives de salle : exactly-one si placée, zéro sinon.
    lits = []
    for r in td["rooms"]:
        lit = model.NewBoolVar(f"use_{t}_{r}")
        uses_room[(t, r)] = lit
        lits.append(lit)
        # Si cette salle est retenue, le début doit tenir dans SA disponibilité.
        model.AddLinearExpressionInDomain(start[t], start_domain(resources[r]["avail"], dur)) \
             .OnlyEnforceIf(lit)
        iv = model.NewOptionalFixedSizeIntervalVar(start[t], dur, lit, f"iv_{t}_{r}")
        intervals_by_res[r].append(iv)
    model.Add(sum(lits) == scheduled[t])  # 1 salle si placée, 0 sinon

# Non-chevauchement par ressource (le cœur de CP-SAT).
for rid, ivs in intervals_by_res.items():
    if ivs:
        model.AddNoOverlap(ivs)

# Précédence CM → TD → TP, en deux temps :
#   (1) contrainte temporelle : le dépendant démarre après la fin du prédécesseur,
#       conditionnée à la présence des deux tâches ;
#   (2) INTÉGRITÉ DE CHAÎNE : un dépendant présent EXIGE son prédécesseur présent
#       (scheduled[b] ⇒ scheduled[a]). Lâcher TD force donc à lâcher TP — fini le
#       « TP avant CM » quand le maillon central saute. Choix retenu (Frédéric) :
#       le plus cohérent métier, un TP n'a pas de sens sans le TD dont il dépend.
for a, b in precedences:
    model.Add(start[b] >= start[a] + tasks[a]["dur"]) \
         .OnlyEnforceIf([scheduled[a], scheduled[b]])
    model.AddImplication(scheduled[b], scheduled[a])

# maxDailyMinutes — LE point fiddly : le jour dépend de `start`, donc il faut réifier
# l'appartenance à un jour. (Dans les vraies données, beaucoup de tâches sont déjà
# épinglées à un jour par leur disponibilité → réification inutile pour celles-là.)
if ENABLE_MAX_DAILY:
    ndays = HORIZON // 1440
    for rid, cap in MAX_DAILY.items():
        users = [t for t, td in tasks.items() if rid in td["fixed"] or rid in td["rooms"]]
        for d in range(ndays):
            lo, hi = d * 1440, (d + 1) * 1440
            day_terms = []
            for t in users:
                # Canal RÉIFIÉ complet on_day ⟺ (lo <= start < hi). C'est CE bloc,
                # multiplié par (ressource × jour × tâche), qui fait le coût « fiddly ».
                b_ge = model.NewBoolVar(f"{t}_{rid}_ge_d{d}")   # start >= lo
                model.Add(start[t] >= lo).OnlyEnforceIf(b_ge)
                model.Add(start[t] <= lo - 1).OnlyEnforceIf(b_ge.Not())
                b_lt = model.NewBoolVar(f"{t}_{rid}_lt_d{d}")   # start < hi
                model.Add(start[t] <= hi - 1).OnlyEnforceIf(b_lt)
                model.Add(start[t] >= hi).OnlyEnforceIf(b_lt.Not())
                on_day = model.NewBoolVar(f"{t}_{rid}_on_d{d}")
                model.AddBoolAnd([b_ge, b_lt]).OnlyEnforceIf(on_day)
                model.AddBoolOr([b_ge.Not(), b_lt.Not()]).OnlyEnforceIf(on_day.Not())
                # used = scheduled ET on_day → contribue la durée au plafond du jour.
                used = model.NewBoolVar(f"{t}_{rid}_used_d{d}")
                model.AddBoolAnd([scheduled[t], on_day]).OnlyEnforceIf(used)
                model.AddBoolOr([scheduled[t].Not(), on_day.Not()]).OnlyEnforceIf(used.Not())
                day_terms.append(tasks[t]["dur"] * used)
            model.Add(sum(day_terms) <= cap)

# Objectif : placer le maximum de tâches.
model.Maximize(sum(scheduled.values()))


# ---------------------------------------------------------------------------
# Résolution + rapport.
# ---------------------------------------------------------------------------
def fmt(minutes):
    d, rem = divmod(minutes, 1440)
    h, mn = divmod(rem, 60)
    return f"{DAYS_FR[d]} {h:02d}:{mn:02d}"


solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = 10.0
status = solver.Solve(model)

print("=" * 64)
print(f"Statut solveur : {solver.StatusName(status)}")
print(f"Tâches placées : {int(solver.ObjectiveValue())} / {len(tasks)}")
print(f"Temps résolution : {solver.WallTime() * 1000:.1f} ms   |   branches : {solver.NumBranches()}")
proto = model.Proto()
print(f"Taille modèle : {len(proto.variables)} variables, {len(proto.constraints)} contraintes")
print("=" * 64)

if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    for t in tasks:
        if solver.Value(scheduled[t]):
            room = next(r for (tt, r), lit in uses_room.items() if tt == t and solver.Value(lit))
            s = solver.Value(start[t])
            print(f"  ✅ {t:3}  {fmt(s)}–{fmt(s + tasks[t]['dur'])}  salle {room}")
        else:
            print(f"  ❌ {t:3}  NON PLACÉE")
    is_opt = status == cp_model.OPTIMAL
    print("-" * 64)
    print(f"Optimalité prouvée : {'OUI' if is_opt else 'non (limite de temps atteinte)'}")
    print("Note : demande sur T1 = 450 min pour 360 min de capacité → au moins une")
    print("tâche est structurellement non plaçable. Plusieurs optima à 3 tâches")
    print("existent (lâcher TP ou lâcher X) : le solveur en choisit un. Départager")
    print("(objectif secondaire, pondération) serait un choix de conception.")
else:
    print("Aucune solution.")
