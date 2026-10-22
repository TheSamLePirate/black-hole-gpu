"""
The A320 for the game (docs/PLAN-A320.md, A1): FlightGear's A320-family (legoboyvdlp/A320-family, GPL v2 —
~/Documents/DEV/A320/flightgear-a320, not in the repository) → assets/a320/a320.bin (gzip): the A320-214's
airframe (Models/Fuselage/res/A320-216.ac) and its CFM56-5B4s (CFM56.ac), with every moving part FlightGear
animates — its gear and their linkages, doors, flaps, slats, spoilers, ailerons, elevators, stabiliser, rudder,
reversers, fans, passenger and cargo doors, RAT, APU flap, wipers, AoA vanes, landing lights — as FlightGear's
own animations (Fuselage/fuselage.xml, a320.cfm.xml, A320-common.xml) evaluated by the game (src/a320/rig.ts).

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
      --python scripts/build-a320.py [-- path/to/flightgear-a320]
  python3 scripts/build-a320-maps.py       (the texture layers and the liveries, KTX2)

(Blender only for its ray casts — the ambient occlusion; run by a plain python3 the AO is left out.)

 1. the AC3D files read (scripts/a320/fgac.py) and FlightGear's animations installed over their nodes as SimGear
    does (scripts/a320/fgrig.py): each animation a node of the rig, the objects under it its part;
 2. the polygons triangulated, their normals smoothed within each object's crease angle (AC3D's), their UVs
    turned to the images' (v down), each surface's material picked from its texture, its AC3D material and
    the effect FlightGear gives its object (the paint glossy or matte, chrome, glass, lenses, decals);
 3. ambient occlusion baked per vertex (rays against the whole craft, gear down, everything at rest);
 4. written in the ship's frame (x to its left, y up, z its nose; metres): FlightGear's model frame (x aft, y
    right, z up) turned — ship = (−y, z, −x) — and raised by the models' offset (0.83109 m, the JSBSim frame's:
    the gear's contacts, the centre of gravity — FDE/*.xml), then by 1.817 m: the belly at y = 0, as every craft's.

Binary (little endian, gzip): "A320", u32 version 1, u32 vertex count, u32 index count, 6 × f32 bounds; u32 byte
length then the rig (JSON, padded to 4 bytes: its animation nodes — type, parent, the property driving it and how,
centre, axis, the locked-track's constants, the target's and slave's nodes —, the lamps, the source); then the
vertices (10 × f32: position, normal, material — scripts/a320/README in ship.wgsl's A320 block, 100–119 —,
part + ambient occlusion × 0.999 — the part is its rig node + 1, 0 the still airframe —, UV in its image) and
u32 indices.
"""
import gzip, json, math, os, struct, sys, time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT + "/scripts/a320")
from fgac import read_ac  # noqa: E402
import fgrig  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
FG = argv[0] if argv else os.path.expanduser("~/Documents/DEV/A320/flightgear-a320")
MOD = FG + "/Models"
OUT = ROOT + "/assets/a320"
# (the CFM model's and A320-common's <offsets>: the whole model raised)
OFFSET = np.array([0.0, 0.0, 0.83109])
AO_RAYS = 48

t0 = time.time()


def log(*a):
    print("##", f"{time.time() - t0:6.1f}s", *a, flush=True)


os.makedirs(OUT, exist_ok=True)

# FlightGear's model frame → the ship's
FG2SHIP = np.array([[0, -1.0, 0], [0, 0, 1.0], [-1.0, 0, 0]])
# (the game's craft have their belly at y = 0 — vessels.ts, gear.ts —: the fuselage's lowest point, FlightGear's
# z = −2.648 m, raised there)
BELLY = 2.648 - OFFSET[2]


def to_ship(p):
    return (np.asarray(p, float) + OFFSET) @ FG2SHIP.T + np.array([0.0, BELLY, 0.0])


def dir_to_ship(d):
    return np.asarray(d, float) @ FG2SHIP.T


# ---------------------------------------------------------------------------- 1. the models and the rig
mats_fus, fus = read_ac(MOD + "/Fuselage/res/A320-216.ac")
mats_eng, eng = read_ac(MOD + "/Fuselage/res/CFM56.ac")
for n in (fus, eng):
    n["kind"] = "group"
fus["name"], eng["name"] = "Fuselage model", "Engines model"
world = {"name": "", "kind": "world", "verts": np.zeros((0, 3)), "texture": None, "crease": 61.0, "surfs": [], "kids": [fus, eng]}
G = fgrig.graph_from_ac(world)
g_fus, g_eng = G.kids
# (each file's animations over its own model; A320-common's over the whole — its selects: the sharklets, antennas)
skip = ("pick", "material", "noshadow", "dist-scale", "scale")
A_fus = [a for a in fgrig.read_animations(MOD + "/Fuselage/fuselage.xml") if a["type"] not in skip]
A_eng = [a for a in fgrig.read_animations(MOD + "/Fuselage/a320.cfm.xml") if a["type"] not in skip]
A_com = [a for a in fgrig.read_animations(MOD + "/A320-common.xml") if a["type"] not in skip]
fgrig.install(g_fus, A_fus)
fgrig.install(g_eng, A_eng)
fgrig.install(G, A_com)
log("animations installed", len(A_fus), len(A_eng), len(A_com))


# (the effect each object has: its finish)
def effects(path):
    import xml.etree.ElementTree as ET

    out = {}
    for e in ET.parse(path).getroot().findall("effect"):
        kind = e.findtext("inherits-from").split("/")[-1]
        for o in e.findall("object-name"):
            out[o.text.strip()] = kind
    return out


EFFECT = {**effects(MOD + "/Fuselage/fuselage.xml"), **effects(MOD + "/Fuselage/a320.cfm.xml")}

# the rig's nodes: every animation node (no-op groups dropped), parents before children; a geometry's part is
# its innermost animation node's index + 1
RIG = []
index = {}


def rig_walk(n, parent):
    me = parent
    a = n.anim
    if a is not None and a["type"] not in ("group",):
        index[id(n)] = len(RIG)
        RIG.append((n, parent))
        me = len(RIG) - 1
    n.id = me
    for k in n.kids:
        rig_walk(k, me)


rig_walk(G, -1)
log("rig nodes", len(RIG))


def node_of(name):
    """The rig node carrying a named node (its innermost animation ancestor): −1 still."""
    f = fgrig.find(G, name)
    return f[0].id if f else -1


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
    if t in ("rotate", "translate", "spin"):
        if a.get("table"):
            o["table"] = [[float(x), float(y)] for x, y in a["table"]]
        else:
            o["factor"] = a["factor"]
            o["offset"] = a["offset"]
        for k in ("min", "max"):
            if k in a:
                o[k] = a[k]
        o["axis"] = vec(dir_to_ship(a["axis"] / (np.linalg.norm(a["axis"]) or 1)))
        if t != "translate":
            o["center"] = vec(to_ship(a["center"] if a["center"] is not None else np.zeros(3)))
    if t == "select" or "condition" in a:
        o["cond"] = a.get("condition")
    if t == "locked-track":
        tr = fgrig.Track(a)
        o["center"] = vec(to_ship(tr.N))
        o["lock"] = vec(dir_to_ship(tr.L))
        o["t"] = vec(dir_to_ship(tr.t))
        o["u"] = vec(dir_to_ship(tr.u))
        o["targetCenter"] = vec(to_ship(a["target_center"]))
        o["target"] = node_of(a["target"])
        o["B0"] = tr.B0
        if tr.S is not None:
            o["slaveCenter"] = vec(to_ship(tr.S))
            o["a"], o["s"], o["sigma0"] = float(tr.a), float(tr.s), float(tr.sigma0)
        o["slave"] = index.get(id(n.slave_of), -1) if n.slave_of is not None else -1
    if t == "slave":
        o["master"] = index[id(n.slave_of)]
    return o


nodes = [export_node(n, p) for n, p in RIG]
# (a locked-track's target named by the node: when the target IS the node the track rides, its own frame without
# its rotation — SimGear's target path ends at the target group, under its animations)

# ---------------------------------------------------------------------------- 2. the surfaces
# materials (ship.wgsl, the A320's block): the livery's paint glossy (100) or matte (101: the wing), the static
# elements' (102), the engine's paint (103), its bare metal (104), the decals (105, alpha-tested), the windshield
# (106), the lenses red, green, white (107–109), a plain colour (110: rgb in the UV), the gear's paint (112) and
# chrome (113), the engine's matte parts (114), the fan's blur disc (115)
LENS = {"glass.red": 107, "glass.green": 108, "glass.white": 109}


def material(obj, tex, acmat):
    eff = EFFECT.get(obj, "")
    if acmat.name in LENS:
        return LENS[acmat.name]
    if acmat.name == "glass" or eff == "glass":
        return 106
    if tex is None:
        return 110
    if tex == "placards.png":
        return 105
    if tex == "Static-Elements.png":
        return 102
    if tex == "LandingGears.png":
        return 113 if "chrome" in eff and "Fitting" not in obj else 112
    if tex.startswith("engine-"):
        if acmat.name.endswith("fanTransparency"):
            return 115
        return 104 if "chrome" in eff else 114 if "matt" in eff else 103
    if tex == "Fuse-Main.png":
        return 101 if "matt" in eff else 100
    raise ValueError(f"unknown texture {tex} on {obj}")


P, N, UV, M, PT = [], [], [], [], []


def take(node, mats):
    """A node's polygons → triangles (corners: position, normal, uv, material, part)."""
    geo = node.geom
    if geo is None or not geo["surfs"]:
        return
    V = geo["verts"]
    crease = math.radians(geo["crease"])
    tris = []
    for flags, mi, refs in geo["surfs"]:
        if len(refs) < 3:
            continue
        for k in range(1, len(refs) - 1):
            tris.append((flags, mi, (refs[0], refs[k], refs[k + 1])))
    if not tris:
        return
    vi = np.array([[r[0] for r in t[2]] for t in tris])
    uv = np.array([[(r[1], r[2]) for r in t[2]] for t in tris], float)
    pos = V[vi]
    fn = np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0])
    area = np.linalg.norm(fn, axis=1)
    keep = area > 1e-12
    fnu = fn / np.maximum(area, 1e-30)[:, None]
    smooth = np.array([(t[0] & 0x10) != 0 for t in tris])
    # (the corners' normals: the faces about each vertex within the crease angle of the corner's own face,
    # area-weighted; flat faces their own)
    nrm = np.repeat(fnu[:, None, :], 3, axis=1)
    by_v = {}
    for f in range(len(tris)):
        if keep[f] and smooth[f]:
            for c in range(3):
                by_v.setdefault(vi[f, c], []).append(f)
    cosc = math.cos(crease)
    for v, fs in by_v.items():
        fs = np.array(fs)
        fns = fnu[fs]
        w = fn[fs]
        dots = fns @ fns.T
        acc = (dots >= cosc - 1e-6).astype(float) @ w
        acc /= np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-30)
        for j, f in enumerate(fs):
            for c in range(3):
                if vi[f, c] == v:
                    nrm[f, c] = acc[j]
    m = np.array([material(node.name or geo["name"], geo["texture"], mats[t[1]]) for t in tris])
    # (a plain colour's rgb in the UV: r, g packed in u — 0…255 each —, b in v; the images' v down)
    flat = m == 110
    uv[:, :, 1] = 1.0 - uv[:, :, 1]
    for f in np.nonzero(flat)[0]:
        c = mats[tris[f][1]].rgb
        uv[f, :, 0] = round(255 * c[0]) + 256 * round(255 * c[1])
        uv[f, :, 1] = c[2]
    for f in np.nonzero(m >= 107)[0]:
        if m[f] <= 109:
            uv[f] = 0.0
    sel = keep
    P.append(to_ship(pos[sel]))
    N.append(dir_to_ship(nrm[sel]))
    UV.append(uv[sel])
    M.append(m[sel])
    PT.append(np.full(sel.sum(), node.id + 1))


def walk(n, mats):
    take(n, mats)
    for k in n.kids:
        walk(k, mats)


walk(g_fus, mats_fus)
walk(g_eng, mats_eng)
P = np.concatenate(P)
N = np.concatenate(N)
UV = np.concatenate(UV)
M = np.concatenate(M)
PT = np.concatenate(PT)
# (ship frame flips nothing: FG2SHIP is a rotation — the winding stays counter-clockwise from the normals' side;
# AC3D's polygons are wound counter-clockwise already)
log("triangles", len(P), "materials", dict(zip(*np.unique(M, return_counts=True))))

# shared corners → vertices
corner = np.concatenate([P.reshape(-1, 3), N.reshape(-1, 3), UV.reshape(-1, 2), np.repeat(M, 3)[:, None], np.repeat(PT, 3)[:, None]], 1)
key = np.round(corner * np.array([1e4] * 3 + [1e3] * 3 + [1e5] * 2 + [1, 1]))
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
VTX = corner[first]
IDX = inv.reshape(-1).astype(np.uint32)
V_P, V_N, V_UV, V_M, V_PT = VTX[:, 0:3], VTX[:, 3:6], VTX[:, 6:8], VTX[:, 8], VTX[:, 9]
V_N /= np.maximum(np.linalg.norm(V_N, axis=1, keepdims=True), 1e-12)
log("vertices", len(VTX), "indices", len(IDX))

# ---------------------------------------------------------------------------- 3. ambient occlusion
AO = np.ones(len(V_P), np.float32)
try:
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    tris = IDX.reshape(-1, 3)
    # (the rest pose: the selects' alternatives — the sharklet and the fence, the fan's blur disc — drawn one at a
    # time; the glass, the lenses, the decals let the light through)
    solid = ~np.isin(V_M[tris[:, 0]], (105, 106, 107, 108, 109, 115))
    bvh = BVHTree.FromPolygons([tuple(p) for p in V_P], [tuple(t) for t in tris[solid]], all_triangles=True)
    rng = np.random.default_rng(7)
    dirs = rng.normal(size=(AO_RAYS, 3))
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    reach = 3.0
    for i in range(len(V_P)):
        n = V_N[i]
        o_ = Vector(V_P[i] + n * 0.004)
        hit = 0.0
        for d in dirs:
            if d @ n <= 0:
                d = -d
            loc, _, _, dist = bvh.ray_cast(o_, Vector(d), reach)
            if loc is not None:
                hit += 1 - dist / reach
        AO[i] = 1 - hit / AO_RAYS
    log("ambient occlusion baked")
except ImportError:
    log("no Blender: ambient occlusion left out")

# ---------------------------------------------------------------------------- 4. the lamps, the rig, the file
# FlightGear's light models (A320-common.xml: their offsets, model frame) — the game's lamps (ship-lights.ts)
LAMPS = [
    ("nav", "red", (1.89364, -16.6504, 0.317012), "fence"),
    ("nav", "red", (1.54364, -16.38, 0.317012), "sharklet"),
    ("nav", "green", (1.89364, 16.648, 0.317018), "fence"),
    ("nav", "green", (1.54364, 16.38, 0.317012), "sharklet"),
    ("nav", "white", (18.8029, 0.0495674, 0.670205), ""),
    ("strobe", "white", (2.03967, -16.7246, 0.319212), "fence"),
    ("strobe", "white", (2.31, -17.1, 0.69), "sharklet"),
    ("strobe", "white", (2.03967, 16.7222, 0.319218), "fence"),
    ("strobe", "white", (2.31, 17.1, 0.69), "sharklet"),
    ("strobe", "white", (18.8029, -0.0495674, 0.670205), ""),
    ("beacon", "red", (-3.58595, -0.001033, 1.94988), ""),
    ("beacon", "red", (-3.97011, -0.001032, -2.50394), ""),
    ("wing", "white", (-9.99483, -1.97792, -0.202625), ""),
    ("wing", "white", (-9.99483, 1.97792, -0.202625), ""),
    ("landing", "white", (-2.080, -2.22016, -1.69034), "LightWingL"),
    ("landing", "white", (-2.080, 2.22016, -1.69034), "LightWingR"),
    ("taxi", "white", (-13.5119, -0.185175, -2.30747), "NLGFitting"),
    ("taxi", "white", (-13.461, 0.20414, -2.28819), "NLGFitting"),
    ("turnoff", "white", (-13.5034, -0.20993, -2.83921), "NLGFitting"),
    ("turnoff", "white", (-13.5034, 0.208994, -2.83921), "NLGFitting"),
]
lamps = []
for kind, colour, p, on in LAMPS:
    rec = {"kind": kind, "colour": colour, "p": vec(to_ship(p))}
    if on in ("fence", "sharklet"):
        rec["wingtip"] = on
    elif on:
        rec["node"] = node_of(on)
    lamps.append(rec)

rig = {
    "source": "FlightGear A320-family (legoboyvdlp/A320-family, GPL v2), Models/Fuselage/res/A320-216.ac + CFM56.ac, fuselage.xml, a320.cfm.xml, A320-common.xml",
    "frame": "ship: x left, y up, z nose; FlightGear model (x aft, y right, z up) + 0.83109 m up",
    "nodes": nodes,
    "lamps": lamps,
}
lo, hi = V_P.min(0), V_P.max(0)
out = bytearray()
out += b"A320" + struct.pack("<3I", 1, len(V_P), len(IDX)) + struct.pack("<6f", *lo, *hi)
js = json.dumps(rig, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
out += struct.pack("<I", len(js)) + js
V = np.zeros((len(V_P), 10), np.float32)
V[:, 0:3] = V_P
V[:, 3:6] = V_N
V[:, 6] = V_M
V[:, 7] = V_PT + np.clip(AO, 0, 1) * 0.999
V[:, 8:10] = V_UV
out += V.tobytes() + IDX.tobytes()
with open(f"{OUT}/a320.bin", "wb") as f:
    f.write(gzip.compress(bytes(out), 9))
with open(f"{OUT}/rig.json", "w") as f:
    json.dump(rig, f, indent=1)
log("written", f"{OUT}/a320.bin", os.path.getsize(f"{OUT}/a320.bin") // 1024, "kB; bounds", lo.round(2), hi.round(2))
