"""Sondeo mgz-fast sobre un replay: age-ups, producción y edificios por jugador.

Uso: python scripts/probe-mgz.py <replay.aoe2record>
"""
import io
import sys
from collections import Counter

from mgz.fast import Action, Operation, meta, operation
from mgz.fast.header import parse as parse_header

AGES = ("dark", "feudal", "castle", "imperial")
FEUDAL, CASTLE, IMPERIAL = 101, 102, 103
VILLAGERS = {83, 123, 124, 209, 224, 225, 226, 357, 358, 672, 673, 674, 700, 781, 921}


def main(path):
    data = open(path, "rb").read()
    buf = io.BytesIO(data)
    header = parse_header(buf)
    body = io.BytesIO(data[buf.tell():])
    de = header.get("de") or {}

    players = {}
    for p in de.get("players", []):
        number = p.get("number", 0)
        if number < 1:
            continue
        raw = p.get("name", b"")
        name = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
        players[number] = {
            "name": name.strip("\x00").strip(),
            "feudal_ms": None,
            "castle_ms": None,
            "imperial_ms": None,
            "units": {a: Counter() for a in AGES},
            "buildings": {a: Counter() for a in AGES},
            "techs": Counter(),
            "production": [],
        }

    age = dict.fromkeys(players, "dark")
    game_ms = 0
    meta(body)
    n_ops = 0
    while True:
        try:
            op, payload = operation(body)
        except EOFError:
            break
        n_ops += 1
        if op == Operation.SYNC:
            game_ms += payload[0]
            continue
        if op != Operation.ACTION:
            continue
        action, a = payload
        player = players.get(a.get("player_id", 0))
        if player is None:
            continue
        current = age.get(a["player_id"], "dark")

        if action == Action.RESEARCH:
            tech = a.get("technology_id", 0)
            if tech == FEUDAL and player["feudal_ms"] is None:
                player["feudal_ms"], current = game_ms, "feudal"
            elif tech == CASTLE and player["castle_ms"] is None:
                player["castle_ms"], current = game_ms, "castle"
            elif tech == IMPERIAL and player["imperial_ms"] is None:
                player["imperial_ms"], current = game_ms, "imperial"
            age[a["player_id"]] = current
            player["techs"][tech] += 1
        elif action in (Action.DE_QUEUE, Action.QUEUE, Action.MULTIQUEUE):
            unit = a.get("unit_id", 0)
            amount = a.get("amount", 1)
            player["production"].append((game_ms, unit, amount, unit in VILLAGERS))
            if unit in VILLAGERS:
                player["units"][current]["villager"] += amount
            else:
                player["units"][current][unit] += amount
        elif action == Action.BUILD:
            player["buildings"][current][a.get("building_id", 0)] += 1

    def fmt(ms):
        return f"{ms // 60000}:{ms % 60000 // 1000:02d}" if ms is not None else "—"

    print(f"ops: {n_ops} | duración: {fmt(game_ms)}")
    for number, p in sorted(players.items()):
        print(f"\n{number}. {p['name']}")
        print(f"   feudal {fmt(p['feudal_ms'])} | castle {fmt(p['castle_ms'])} | imperial {fmt(p['imperial_ms'])}")
        print(f"   units por edad: { {a: dict(c) for a, c in p['units'].items() if c} }")
        print(f"   buildings por edad: { {a: dict(c) for a, c in p['buildings'].items() if c} }")


if __name__ == "__main__":
    main(sys.argv[1])
