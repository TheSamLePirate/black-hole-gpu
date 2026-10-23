"""
A fixture for tests/a320-rig.test.ts: FlightGear's animations evaluated by scripts/a320/fgrig.py (SimGear's rules)
for a few property sets, each rig node's map in the ship's frame — what src/a320/rig.ts must reproduce.

  python3 scripts/a320/rig-fixture.py        → tests/data/a320-rig.json
"""
import json, os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.argv = [sys.argv[0]]
# (the build's graph and rig, without writing anything: its module run up to the export)
src = open(ROOT + "/scripts/build-a320.py").read()
src = src.split("# ---------------------------------------------------------------------------- 2. the surfaces")[0]
g = {"__file__": ROOT + "/scripts/build-a320.py", "__name__": "fixture"}
exec(compile(src, "build-a320.py", "exec"), g)
fgrig, G, RIG, to_ship, FG2SHIP, OFFSET = g["fgrig"], g["G"], g["RIG"], g["to_ship"], g["FG2SHIP"], g["OFFSET"]

F = np.eye(4)
F[:3, :3] = FG2SHIP
T = np.eye(4)
T[:3, 3] = OFFSET
Tb = np.eye(4)
Tb[1, 3] = g["BELLY"]
S = Tb @ F @ T
Si = np.linalg.inv(S)
SETS = [
    {},
    {"gear/gear[0]/position-norm": 1, "gear/gear[1]/position-norm": 1, "gear/gear[2]/position-norm": 1, "sim/multiplay/generic/float[12]": 0.5, "sim/multiplay/generic/float[11]": 0.7, "systems/fcs/spoiler-l3/final-deg": 35, "sim/multiplay/generic/float[6]": 12, "gear/gear[1]/compression-norm": 0.4, "sim/multiplay/generic/float[1]": 0.5, "engines/engine[3]/n1": 80},
    {"gear/gear[0]/position-norm": 0.5, "gear/gear[1]/position-norm": 0.45, "gear/gear[2]/position-norm": 0.55, "systems/hydraulic/gear/door-left": 1, "systems/hydraulic/gear/door-right": 1, "systems/hydraulic/gear/door-nose": 1, "engines/engine[0]/reverser-pos-norm": 1, "sim/model/door-positions/doorl1/position-norm": 0.7},
    {"gear/gear[0]/position-norm": 0.0, "gear/gear[1]/position-norm": 0.0, "gear/gear[2]/position-norm": 0.0, "sim/multiplay/generic/int[12]": 1},
]
out = []
for props in SETS:
    fgrig.evaluate(G, props, iterations=6)
    out.append({"props": props, "maps": [np.round((S @ n.M @ Si)[:3].ravel(), 6).tolist() for n, _ in RIG]})
os.makedirs(ROOT + "/tests/data", exist_ok=True)
json.dump(out, open(ROOT + "/tests/data/a320-rig.json", "w"))
print("written", len(out), "sets ×", len(RIG), "nodes")
