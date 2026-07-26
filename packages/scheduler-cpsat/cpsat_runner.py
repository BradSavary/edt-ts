"""
Frontière process — invoquée par `scheduler-api` (cpsatGateway.ts) en subprocess.

Lit tout stdin (`{ "raw": RawScheduleData, "config": SchedulerConfig }`), appelle
`solve()` et écrit `json.dumps(solutions)` sur stdout (rien d'autre — aucun `print`
de debug sur stdout). Diagnostics éventuels sur stderr. Exit 0 si OK, exit 1 + message
stderr en cas d'exception (y compris config non supportée, ex : pause flottante).
"""

from __future__ import annotations

import json
import sys

from cpsat_engine import solve


def _map_config(config: dict | None) -> dict:
    """Traduit les seuls champs SchedulerConfig pertinents pour CP-SAT ; ignore le reste."""
    config = config or {}
    mapped: dict = {}

    lunch = config.get("lunchBreak")
    if isinstance(lunch, dict):
        if lunch.get("type") == "floating":
            raise ValueError("pause flottante non supportée par le moteur CP-SAT")
        mapped["lunchBreak"] = lunch

    if "ignoreDailyLimits" in config:
        mapped["ignoreDailyLimits"] = config["ignoreDailyLimits"]
    if "timeoutSeconds" in config:
        mapped["timeoutSeconds"] = config["timeoutSeconds"]
    if "compactTeacherHalfDays" in config:
        mapped["compactTeacherHalfDays"] = config["compactTeacherHalfDays"]
    if "minimizeTeacherDays" in config:
        mapped["minimizeTeacherDays"] = config["minimizeTeacherDays"]
    if "balanceTeacherDailyLoad" in config:
        mapped["balanceTeacherDailyLoad"] = config["balanceTeacherDailyLoad"]
    if "crossNoonGap" in config:
        mapped["crossNoonGap"] = config["crossNoonGap"]
    if "minimizeTeacherRoomChanges" in config:
        mapped["minimizeTeacherRoomChanges"] = config["minimizeTeacherRoomChanges"]

    return mapped


def main() -> int:
    payload = json.loads(sys.stdin.read())
    raw = payload["raw"]
    config = _map_config(payload.get("config"))
    solutions = solve(raw, config)
    sys.stdout.write(json.dumps(solutions))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 — frontière process : toute exception → stderr + exit 1
        print(str(exc), file=sys.stderr)
        sys.exit(1)
