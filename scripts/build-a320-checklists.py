#!/usr/bin/env python3
"""The A320's checklists (docs/PLAN-A320.md, A11): FlightGear's A32X-Checklists.xml (GPL v2) — its groups (the full
procedures, the normal checklists), each checklist's pages and items (a name, the value to check) and the items'
markers (the control to look at, in the flight deck's frame: turned into the ship's as the deck is —
scripts/build-a320-cockpit.py to_ship) — into src/a320/checklists.json.

    python3 scripts/build-a320-checklists.py [~/Documents/DEV/A320/flightgear-a320]
"""

import json
import os
import sys
import xml.etree.ElementTree as ET

import numpy as np

ROOT = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/Documents/DEV/A320/flightgear-a320")
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "a320", "checklists.json")

# (the deck's place, as scripts/build-a320-cockpit.py)
DECK = np.array([-16.47411, -0.00015, -0.09483])
OFFSET = np.array([0.0, 0.0, 0.83109])
BELLY = 2.648 - OFFSET[2]
FG2SHIP = np.array([[0, -1.0, 0], [0, 0, 1.0], [-1.0, 0, 0]])


def to_ship(p):
    return (np.asarray(p, float) + DECK + OFFSET) @ FG2SHIP.T + np.array([0.0, BELLY, 0.0])


def text(e, tag, d=""):
    c = e.find(tag)
    return (c.text or "").strip() if c is not None and c.text else d


def item(e):
    out = {"name": text(e, "name"), "value": text(e, "value")}
    m = e.find("marker")
    if m is not None:
        p = to_ship([float(text(m, k, "0")) for k in ("x-m", "y-m", "z-m")])
        out["marker"] = [round(float(x), 4) for x in p]
        out["scale"] = float(text(m, "scale", "1"))
    return out


def main():
    tree = ET.parse(os.path.join(ROOT, "A32X-Checklists.xml"))
    groups = []
    for g in tree.getroot().findall("group"):
        lists = []
        for c in g.findall("checklist"):
            pages = c.findall("page") or [c]
            items = [item(i) for p in pages for i in p.findall("item")]
            lists.append({"title": text(c, "title"), "items": items})
        groups.append({"name": text(g, "name"), "checklists": lists})
    data = {
        "source": "FlightGear A320-family (legoboyvdlp/A320-family, GPL v2): A32X-Checklists.xml",
        "groups": groups,
    }
    with open(OUT, "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    n = sum(len(c["items"]) for g in groups for c in g["checklists"])
    print(f"{OUT}: {len(groups)} groups, {sum(len(g['checklists']) for g in groups)} checklists, {n} items")


if __name__ == "__main__":
    main()
