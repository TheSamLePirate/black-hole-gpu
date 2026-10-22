"""
The A320's flight deck (docs/PLAN-A320.md, A5): FlightGear's A320-family (GPL v2 — ~/Documents/DEV/A320/flightgear-a320,
not in the repository) → assets/a320/a320-cockpit.bin (gzip): its cockpit (Models/FlightDeck/res/fd_complete.ac — the
overhead, the glareshield and its FCU, the main panel, the pedestal, the side consoles, the seats, the side sticks, the
thrust levers…) with its displays' screens (Models/Instruments/*/res/*.ac: the PFDs, the NDs, the E/WD, the SD, the
ISIS; the MCDUs' and DCDUs' in the deck), placed where FlightGear places them (Models/A320-interior.xml), its
animations (Models/FlightDeck/a320.flightdeck.xml: every switch, knob, lever, guard, the sticks, the levers, the lights
shown or hidden) as a rig the game evaluates (src/a320/rig.ts), its controls (their clicks, drags and wheels — the
pick and knob animations: their bindings and tooltips) for the game to act on.

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
      --python scripts/build-a320-cockpit.py [-- path/to/flightgear-a320]
  python3 scripts/build-a320-maps.py cockpit        (its texture layers)

Binary (little endian, gzip): "A32C", u32 version 1, u32 vertex count, u32 index count, 6 × f32 bounds; u32 byte length
then the JSON (the rig's nodes; the controls; the objects' names; the screens; the source), padded to 4 bytes; the
vertices (10 × f32, as a320.bin's: material 120–139 — ship.wgsl's cockpit block —, part + AO, UV in its layer); the
indices (u32); then per triangle its object's index (u16, the names' list: what a click meets).

Materials: 120 the panels (fd_main), 121 (fd_other), 122 the glareshield, its fabric, the visors (fd_glare), 123 the
knobs and buttons (the atlas: fd_buttons), 124 the lights of the push-buttons and the annunciators (fd_buttons,
emissive), 125 the leather (the atlas), 126 a display's screen (the displays' atlas — src/a320/du —, its cell in the
UV), 127 the windows' glass, 128 the HUD's combiner, 129 the ECAM's bezel glass, 130 a plain colour (rgb in the UV),
131 the INOP placards (emissive), 132 the FCU's and the radios' displays (emissive: their texture's), 133 the rest of
the atlas (the checklist, the carpet, the pedestal's details, the glare switches).
"""
import gzip, json, math, os, struct, sys, time
import xml.etree.ElementTree as ET

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT + "/scripts/a320")
from fgac import read_ac  # noqa: E402
import fgrig  # noqa: E402
from fgmesh import bake_ao, dedupe, triangles  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
FG = argv[0] if argv else os.path.expanduser("~/Documents/DEV/A320/flightgear-a320")
MOD = FG + "/Models"
OUT = ROOT + "/assets/a320"
WORK = ROOT + "/assets/airplanes/a320-work"
os.makedirs(WORK, exist_ok=True)
t0 = time.time()


def log(*a):
    print("##", f"{time.time() - t0:6.1f}s", *a, flush=True)


# the deck in the model's frame (A320-interior.xml), then the ship's (build-a320.py: the models' offset, the belly)
DECK = np.array([-16.47411, -0.00015, -0.09483])
OFFSET = np.array([0.0, 0.0, 0.83109])
BELLY = 2.648 - OFFSET[2]
FG2SHIP = np.array([[0, -1.0, 0], [0, 0, 1.0], [-1.0, 0, 0]])


def to_ship(p):
    return (np.asarray(p, float) + DECK + OFFSET) @ FG2SHIP.T + np.array([0.0, BELLY, 0.0])


def dir_to_ship(d):
    return np.asarray(d, float) @ FG2SHIP.T


# ---------------------------------------------------------------------------- the deck, its screens, the rig
mats, deck = read_ac(MOD + "/FlightDeck/res/fd_complete.ac")
deck["kind"] = "group"
deck["name"] = "FlightDeck model"
# (the displays' screens: FlightGear's sub-models, named as the deck's XML names them)
SCREENS = [
    ("PFD1", "Instruments/PFD/res/PFD1.ac"),
    ("PFD2", "Instruments/PFD/res/PFD2.ac"),
    ("ND1", "Instruments/ND/res/ND.ac"),
    ("ND2", "Instruments/ND/res/ND_R.ac"),
    ("UECAM", "Instruments/Upper-ECAM/res/Upper-ECAM.ac"),
    ("LECAM", "Instruments/Lower-ECAM/res/Lower-ECAM.ac"),
    ("IESI", "Instruments/IESI/res/IESI.ac"),
]
subs = []
sub_mats = {}
for name, path in SCREENS:
    m, r = read_ac(MOD + "/" + path)
    r["kind"] = "group"
    r["name"] = name
    sub_mats[name] = m
    subs.append(r)
world = {"name": "", "kind": "world", "verts": np.zeros((0, 3)), "texture": None, "crease": 61.0, "surfs": [], "kids": [deck, *subs]}
G = fgrig.graph_from_ac(world)
XML = MOD + "/FlightDeck/a320.flightdeck.xml"
ALL = fgrig.read_animations(XML)
# (the axes given by line objects — 223 of them: the sticks, the levers, the knobs —, as SimGear reads them)
AXES = fgrig.resolve_axes(G, ALL)
# (the rig's: what moves or hides; knobs turn as rotations do — their own property, factor and axis)
for a in ALL:
    if a["type"] == "knob":
        a["type"] = "rotate" if a.get("axis") is not None and "property" in a else "group"
RIGGED = [a for a in ALL if a["type"] in ("rotate", "translate", "select", "group")]
fgrig.install(G, RIGGED)
log("animations", len(ALL), "rigged", len(RIGGED), "axis objects", len(AXES))

RIG = []
index = {}


def rig_walk(n, parent):
    me = parent
    if n.anim is not None and n.anim["type"] != "group":
        index[id(n)] = len(RIG)
        RIG.append((n, parent))
        me = len(RIG) - 1
    n.id = me
    for k in n.kids:
        rig_walk(k, me)


rig_walk(G, -1)


def vec(v):
    return [round(float(x), 6) for x in v]


def export_node(n, parent):
    a = n.anim
    t = a["type"]
    o = {"type": t, "parent": parent, "objects": a.get("objects", [])[:4]}
    if a.get("name"):
        o["name"] = a["name"]
    if "property" in a:
        o["prop"] = a["property"]
    if t in ("rotate", "translate"):
        if a.get("table"):
            o["table"] = [[float(x), float(y)] for x, y in a["table"]]
        else:
            o["factor"] = a["factor"]
            o["offset"] = a["offset"]
        for k in ("min", "max"):
            if k in a:
                o[k] = a[k]
        ax = a["axis"] if a.get("axis") is not None else np.array([1.0, 0, 0])
        o["axis"] = vec(dir_to_ship(ax / (np.linalg.norm(ax) or 1)))
        if t != "translate":
            o["center"] = vec(to_ship(a["center"] if a["center"] is not None else np.zeros(3)))
    if t == "select" or "condition" in a:
        o["cond"] = a.get("condition")
    return o


nodes = [export_node(n, p) for n, p in RIG]
log("rig nodes", len(nodes))

# ---------------------------------------------------------------------------- the controls (picks, knobs)


def binding(b):
    out = {"command": (b.findtext("command") or "").strip()}
    for k in ("property", "step", "min", "max", "wrap", "factor", "offset", "script", "value"):
        vs = [x.text.strip() for x in b.findall(k) if x.text]
        if vs:
            out[k] = vs if (k == "value" and len(vs) > 1) else vs[0]
    cond = b.find("condition")
    if cond is not None:
        out["condition"] = fgrig._condition(cond)
    return out


controls = []
for a in ET.parse(XML).getroot().findall("animation"):
    t = (a.findtext("type") or "").strip()
    if t not in ("pick", "knob", "slider"):
        continue
    c = {"type": t, "objects": [o.text.strip() for o in a.findall("object-name") if o.text]}
    if t == "knob":
        c["prop"] = (a.findtext("property") or "").strip().lstrip("/")
        c["drag"] = (a.findtext("drag-direction") or "").strip()
    acts = []
    for act in a.findall("action"):
        x = {"button": [int(b.text) for b in act.findall("button") if b.text], "repeatable": (act.findtext("repeatable") or "false").strip() in ("true", "1")}
        x["bindings"] = [binding(b) for b in act.findall("binding")]
        up = act.find("mod-up")
        if up is not None:
            x["up"] = [binding(b) for b in up.findall("binding")]
        acts.append(x)
    for k in ("increase", "decrease"):
        e = a.find(k)
        if e is not None:
            acts.append({"button": [], "kind": k, "bindings": [binding(b) for b in e.findall("binding")]})
    c["actions"] = acts
    lab = a.find("hovered/binding/label")
    if lab is not None and lab.text:
        c["label"] = lab.text.strip()
        prop = a.find("hovered/binding/property")
        if prop is not None and prop.text:
            c["labelProp"] = prop.text.strip().lstrip("/")
    controls.append(c)
log("controls", len(controls))

# ---------------------------------------------------------------------------- the surfaces
# the atlas (layer 3 of the deck's: build-a320-maps.py places them so): texture → (x, y, w, h) in its 4096² image
ATLAS = {
    "fd_buttons.png": (0, 0, 2048, 2048),
    "fd_leather.png": (2048, 0, 2048, 2048),
    "hud_box_grid.png": (0, 2048, 512, 512),
    "MCDU_screen.png": (512, 2048, 256, 256),
    "dcdu-screen.png": (768, 2048, 256, 256),
    "inop.png": (512, 2304, 256, 256),
    "fcu.png": (0, 2560, 512, 64),
    "fcu2.png": (0, 2624, 512, 64),
    "ECAM.png": (2048, 2048, 1024, 1024),
    "Radio.jpg": (3072, 2048, 1024, 1024),
    "carpet2.png": (2048, 3072, 1024, 1024),
    "checklist.png": (3072, 3072, 1024, 512),
    "glare_sw.png": (3584, 3584, 512, 512),
    "hud.png": (3072, 3584, 512, 512),
    "dcdu.png": (1024, 2048, 512, 512),
}
FULL = {"fd_main.png": 0, "fd_other.png": 1, "fd_glare.png": 2}
# the displays' atlas (src/a320/du: 4096 × 4096, the cells' places) — a screen's quad its cell
DU = {
    "PFD1": (0, 0, 1024, 1024),
    "ND1": (1024, 0, 1024, 1024),
    "UECAM": (2048, 0, 1024, 1024),
    "LECAM": (3072, 0, 1024, 1024),
    "ND2": (0, 1024, 1024, 1024),
    "PFD2": (1024, 1024, 1024, 1024),
    "MCDU1": (2048, 1024, 1024, 864),
    "MCDU2": (3072, 1024, 1024, 864),
    "IESI": (0, 2048, 1024, 1024),
    "DCDU1": (1024, 2048, 1024, 683),
    "DCDU2": (2048, 2048, 1024, 683),
}
# (the textures sampled at one place — a plain colour then: the pedestal's lower part, the fabric's tiny tile)
FLAT_TEX = {"Pedestal_low.png", "fabric2.png"}
_means = {}


def tex_mean(tex):
    if tex not in _means:
        try:
            from PIL import Image

            im = Image.open(f"{MOD}/FlightDeck/res/{tex}").convert("RGB")
            _means[tex] = tuple(np.asarray(im, float).reshape(-1, 3).mean(0) / 255)
        except Exception:
            _means[tex] = (0.5, 0.5, 0.5)
    return _means[tex]


def screen_of(obj):
    """A display's screen: its atlas cell's name."""
    o = obj.lower()
    if o.startswith("pfd1"):
        return "PFD1"
    if o.startswith("pfd2"):
        return "PFD2"
    if o == "nd.screen":
        return "ND1"
    if o.startswith("nd_r"):
        return "ND2"
    if o.startswith("uecam"):
        return "UECAM"
    if o.startswith("lecam"):
        return "LECAM"
    if o.startswith("iesi.screen"):
        return "IESI"
    if o.startswith("mcdu1.screen"):
        return "MCDU1"
    if o.startswith("mcdu2.screen"):
        return "MCDU2"
    if o == "dcduscreenl":
        return "DCDU1"
    if o == "dcduscreenr":
        return "DCDU2"
    return None


def material(obj, tex, m):
    """(material id, how the UV maps: ("layer", k) | ("atlas", cell) | ("du", cell) | ("flat", rgb))"""
    scr = screen_of(obj)
    if scr:
        return 126, ("du", DU[scr])
    name = m.name
    if name.startswith("glass"):
        return 127, ("layer", 2)
    if name.startswith("HUDscreen"):
        return 128, ("atlas", ATLAS["hud.png"])
    if name.startswith("ecam_trans"):
        return 129, ("atlas", ATLAS["ECAM.png"])
    if tex is None:
        return 130, ("flat", m.rgb)
    if tex in FLAT_TEX:
        return 130, ("flat", tuple(c * k for c, k in zip(tex_mean(tex), m.rgb)))
    if tex in FULL:
        return (120, 121, 122)[FULL[tex]], ("layer", FULL[tex])
    if tex == "fd_buttons.png":
        return (124 if name in ("fd_buttons", "fd_fire_buttons_inner", "fd_fire_buttons_cover") else 123), ("atlas", ATLAS[tex])
    if tex == "fd_leather.png":
        return 125, ("atlas", ATLAS[tex])
    if tex == "inop.png":
        return 131, ("atlas", ATLAS[tex])
    if tex in ("fcu.png", "fcu2.png", "Radio.jpg", "MCDU_screen.png", "dcdu-screen.png"):
        return 132, ("atlas", ATLAS[tex])
    if tex in ATLAS:
        return 133, ("atlas", ATLAS[tex])
    raise ValueError(f"texture {tex} on {obj}")


P, N, UV, M, PT, OB = [], [], [], [], [], []
names = []


def take(node, mats_of):
    geo = node.geom
    tri = triangles(geo)
    if tri is None:
        return
    nm = node.name or geo["name"]
    oi = len(names)
    names.append(nm)
    mm = mats_of
    ids = []
    uv = tri["uv"].copy()
    for f in range(len(tri["mat"])):
        mid, how = material(nm, geo["texture"], mm[tri["mat"][f]])
        ids.append(mid)
        kind, arg = how
        u, v = uv[f, :, 0], 1.0 - uv[f, :, 1]
        if kind == "layer":
            uv[f, :, 0], uv[f, :, 1] = u, v
        elif kind in ("atlas", "du"):
            x, y, w, h = arg
            S = 4096.0
            uv[f, :, 0] = (x + np.clip(u, 0.0005, 0.9995) * w) / S
            uv[f, :, 1] = (y + np.clip(v, 0.0005, 0.9995) * h) / S
        else:
            r, g, b = arg
            uv[f, :, 0] = round(255 * r) + 256 * round(255 * g)
            uv[f, :, 1] = b
    P.append(to_ship(tri["pos"]))
    N.append(dir_to_ship(tri["nrm"]))
    UV.append(uv)
    M.append(np.array(ids))
    PT.append(np.full(len(ids), node.id + 1))
    OB.append(np.full(len(ids), oi))


def walk(n, mats_of):
    take(n, mats_of)
    for k in n.kids:
        walk(k, mats_of)


g_deck = G.kids[0]
walk(g_deck, mats)
for k, (name, _) in zip(G.kids[1:], SCREENS):
    walk(k, sub_mats[name])
P = np.concatenate(P)
N = np.concatenate(N)
UV = np.concatenate(UV)
M = np.concatenate(M)
PT = np.concatenate(PT)
OB = np.concatenate(OB)
log("triangles", len(P), "materials", dict(zip(*np.unique(M, return_counts=True))))
VTX, IDX = dedupe(P, N, UV, M, PT)
V_P, V_N, V_UV, V_M, V_PT = VTX[:, 0:3], VTX[:, 3:6], VTX[:, 6:8], VTX[:, 8], VTX[:, 9]
log("vertices", len(VTX), "indices", len(IDX))

tris = IDX.reshape(-1, 3)
solid = ~np.isin(V_M[tris[:, 0]], (127, 128, 129))
AO, baked = bake_ao(V_P, V_N, tris[solid], rays=24, reach=0.6)
log("ambient occlusion", "baked" if baked else "left out (no Blender)")

screens = {k: [x / 4096 for x in v] for k, v in DU.items()}
meta = {
    "source": "FlightGear A320-family (legoboyvdlp/A320-family, GPL v2), Models/FlightDeck/res/fd_complete.ac, Models/Instruments/*/res/*.ac, Models/FlightDeck/a320.flightdeck.xml",
    "frame": "ship: x left, y up, z nose (as a320.bin's)",
    "nodes": nodes,
    "controls": controls,
    "objects": names,
    "screens": screens,
    "atlas": {k: [x / 4096 for x in v] for k, v in ATLAS.items()},
}
lo, hi = V_P.min(0), V_P.max(0)
out = bytearray()
out += b"A32C" + struct.pack("<3I", 1, len(V_P), len(IDX)) + struct.pack("<6f", *lo, *hi)
js = json.dumps(meta, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
out += struct.pack("<I", len(js)) + js
V = np.zeros((len(V_P), 10), np.float32)
V[:, 0:3] = V_P
V[:, 3:6] = V_N
V[:, 6] = V_M
V[:, 7] = V_PT + np.clip(AO, 0, 1) * 0.999
V[:, 8:10] = V_UV
out += V.tobytes() + IDX.tobytes()
ob = OB.astype(np.uint16).tobytes()
ob += b"\0" * ((4 - len(ob) % 4) % 4)
out += ob
with open(f"{OUT}/a320-cockpit.bin", "wb") as f:
    f.write(gzip.compress(bytes(out), 9))
with open(f"{WORK}/cockpit-meta.json", "w") as f:
    json.dump(meta, f, indent=1)
log("written", f"{OUT}/a320-cockpit.bin", os.path.getsize(f"{OUT}/a320-cockpit.bin") // 1024, "kB; bounds", lo.round(2), hi.round(2))
