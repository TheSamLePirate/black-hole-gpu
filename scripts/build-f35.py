"""
The F-35 for the game (docs/PLAN-F35.md, F1): "F-35A Lightning II" by shangus930 (Sketchfab, CC BY 4.0 —
assets/airplanes/F-35B Lightning II.glb, 128 MB, not in the repository) → assets/f35/f35.bin (gzip) and the
images its texture atlases are made of (assets/airplanes/f35-work/, then scripts/build-f35-maps.py).

Run with Blender (its glTF importer evaluates the gear's skins and its clip):

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
      --python scripts/build-f35.py [-- path/to/model.glb]
  python3 scripts/build-f35-maps.py          (the atlases, KTX2: needs Pillow and basisu)

 1. imported; the clip (7.3 s: the gear, retracted at its first frame, extended at its last, and its six
    doors) sampled — every moving mesh's vertices at 33 instants, an affine map fitted from its extended pose
    to each (least squares: its skin's bones, its node's scale): the tracks;
 2. the meshes taken in their extended pose, a few decimated (the gear legs, the helmet: their detail is
    sub-millimetre); the control surfaces cut out of the airframe along their hinge lines (bmesh bisections:
    the flaperons, the rudders) or taken whole (the stabilators, the leading-edge flaps: loose parts of the
    model); the wheels, the nozzle's petals, the canopy and the pilot made parts of their own;
 3. ambient occlusion baked per vertex (rays against the whole craft);
 4. written in the ship's frame (x to its left, y up, z its nose; metres — the model is 1.87 × the real
    craft: 10.7 m span, 15.4 m long), the belly (gear up) at y = 0.

Binary (little endian, gzip): "F35B", u32 version 2, u32 vertex count, u32 index count, 6 × f32 bounds
(min, max of the extended pose), u32 part count, u32 track samples K; per part 16 f32 — kind (0 still,
1 hinge, 2 track, 3 wheel, 4 petal, 5 a swivel bearing's segment, 6 a fan's stage, 7 a marker: no vertices,
8 the side stick — tilted about its base —, 9 the throttle — slid along its axis by up to a),
parent part (−1: none), pivot xyz, axis xyz, a, b (kind-dependent: a hinge's travel down / up [rad], a wheel's
radius, a petal's ring radius, a bearing's or a stage's turning sense), track index (−1: none), side (+1 left,
−1 right, 0 centre), 0, 0, 0, 0 —; per track K × 12 f32 (an affine map, rows of 3 × 4: extended pose → the pose
at extension k / (K − 1)); u32 byte length then the parts' names (JSON, padded to 4 bytes); then the vertices
(10 × f32: position, normal, material — 30 the airframe's layer, 31 the atlas's, 32 the canopy's glass, 33 the
lights, 34 the visor, 35 a plain dark metal (the lift fan), 36 the panoramic display (UV over it), 37 the
cockpit's dark hardware —, part + ambient occlusion × 0.999, UV in its layer)
and u32 indices.
"""
import bpy, bmesh, gzip, json, math, os, struct, sys, time
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = "/".join(os.path.abspath(__file__).split("/")[:-2])
SRC = argv[0] if argv else ROOT + "/assets/airplanes/F-35B Lightning II.glb"
OUT = ROOT + "/assets/f35"
WORK = ROOT + "/assets/airplanes/f35-work"
# the model's units over metres: its span 20.12 for the real 10.7 m, its length 28.84 for 15.6 m
SCALE = 0.535
K = 33  # track samples over the clip
CLIP_END = 176  # the clip's last key (7.29 s at 24 fps)
AO_RAYS = 48

t0 = time.time()
def log(*a):
    print("##", f"{time.time() - t0:6.1f}s", *a, flush=True)

os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)

# ---- the textures: each material's base colour, metal-roughness, normals, as the file holds them, for the
# atlases (scripts/build-f35-maps.py) — read from the GLB itself (its images are JPEG / PNG)
with open(SRC, "rb") as f:
    glb = f.read()
jlen = struct.unpack_from("<I", glb, 12)[0]
gj = json.loads(glb[20:20 + jlen])
bin0 = 20 + jlen + 8
maps = {}
for m in gj["materials"]:
    pbr = m.get("pbrMetallicRoughness", {})
    rec = {}
    for key, tex in (("base", pbr.get("baseColorTexture")), ("mr", pbr.get("metallicRoughnessTexture")), ("normal", m.get("normalTexture"))):
        if not tex:
            continue
        im = gj["images"][gj["textures"][tex["index"]]["source"]]
        bv = gj["bufferViews"][im["bufferView"]]
        ext = "png" if im["mimeType"] == "image/png" else "jpg"
        name = f"{m['name']}-{key}.{ext}"
        with open(f"{WORK}/{name}", "wb") as o:
            o.write(glb[bin0 + bv.get("byteOffset", 0): bin0 + bv.get("byteOffset", 0) + bv["byteLength"]])
        rec[key] = name
    rec["metal"] = pbr.get("metallicFactor", 1.0)
    rec["rough"] = pbr.get("roughnessFactor", 1.0)
    maps[m["name"]] = rec

# the atlases: layer 0 the airframe's paint alone (4096²); layer 1 the rest, each material in a cell
# (u0, v0, w, h in the layer, glTF's orientation: v down the image)
CELLS = {
    "mat_4": (0, 0.0, 0.0, 1.0, 1.0),        # the airframe
    "mat_9": (1, 0.0, 0.0, 0.5, 0.5),        # the landing gear
    "mat_9.001": (1, 0.0, 0.0, 0.5, 0.5),
    "mat_6": (1, 0.5, 0.0, 0.5, 0.5),        # the pilot
    "mat_5": (1, 0.0, 0.5, 0.5, 0.5),        # the seat, the dashboard, the bays
    "mat_7": (1, 0.5, 0.5, 0.25, 0.25),      # the nozzle
    "mat_10": (1, 0.75, 0.5, 0.25, 0.25),    # the helmet
    "mat_15": (1, 0.5, 0.75, 0.125, 0.25),   # the canopy's glass (512 × 1024)
    "mat_8": (1, 0.625, 0.75, 0.125, 0.125), # the lights
    "mat_14": (1, 0.625, 0.875, 0.03125, 0.03125),  # the visor
}
MATNUM = {"mat_15": 32, "mat_8": 33, "mat_14": 34}
# the panoramic cockpit display: the dashboard's face before the pilot (its map's display region, mirrored on
# the model's two halves) — material 36, UVs over it from where each point is (the pilot's left to right, top to
# bottom: 53 × 20 cm), the game drawing it live (src/f35/pcd.ts)
PCD_BOX = (0.5, 2.895, 3.315)  # (its half width, its bottom and top: model x, z)
with open(f"{WORK}/atlas.json", "w") as o:
    json.dump({"cells": CELLS, "maps": maps}, o, indent=1)
log("textures written", len(maps))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
for o in list(bpy.data.objects):
    if o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)
sc = bpy.context.scene
log("imported", len(bpy.data.objects), "objects")

def to_ship(p):
    """model (Blender's z up, nose −y) → ship frame (x left, y up, z nose) [m]"""
    p = np.asarray(p, np.float64)
    return SCALE * np.stack([p[..., 0], p[..., 2], -p[..., 1]], -1)

def dir_to_ship(d):
    d = np.asarray(d, np.float64)
    return np.stack([d[..., 0], d[..., 2], -d[..., 1]], -1)

# ---- 1. the tracks: each moving mesh's vertices along the clip → affine maps from its extended pose
MOVING = {
    "Object_47": "nose leg", "Object_51": "left leg", "Object_103": "right leg",
    "Object_57": "nose door, right", "Object_65": "nose door, left",
    "Object_73": "left inner door", "Object_81": "right inner door",
    "Object_89": "left outer door", "Object_97": "right outer door",
}
def world_verts(name):
    dg = bpy.context.evaluated_depsgraph_get()
    o = bpy.data.objects[name].evaluated_get(dg)
    me = o.to_mesh()
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    M = np.array(o.matrix_world, np.float64)
    o.to_mesh_clear()
    return co.reshape(-1, 3).astype(np.float64) @ M[:3, :3].T + M[:3, 3]

samples = {n: [] for n in MOVING}
for k in range(K):
    sc.frame_set(round(1 + (CLIP_END - 1) * k / (K - 1)))
    for n in MOVING:
        samples[n].append(to_ship(world_verts(n)))
tracks = {}
for n, S in samples.items():
    end = S[-1]
    A = np.hstack([end, np.ones((len(end), 1))])
    mats = []
    for P in S:
        X, res, *_ = np.linalg.lstsq(A, P, rcond=None)  # P ≈ A X: X is 4 × 3
        mats.append(X.T)  # 3 × 4 rows
        err = np.abs(A @ X - P).max()
        if err > 0.01:
            log(f"  {n}: track sample off by {err:.3f} m (not rigid)")
    tracks[n] = np.array(mats)
log("tracks sampled", len(tracks))
sc.frame_set(CLIP_END)

# ---- 2. the meshes in their extended pose, into one bmesh per source object, then parts
DECIMATE = {"Object_47": 0.18, "Object_51": 0.35, "Object_103": 0.35, "Object_29": 0.3, "Object_21": 0.7}
for name, ratio in DECIMATE.items():
    md = bpy.data.objects[name].modifiers.new("dec", "DECIMATE")
    md.ratio = ratio
    md.use_collapse_triangulate = True

PARTS = []  # (name, kind, parent, pivot, axis, a, b, track, side)
def part(name, kind=0, parent=-1, pivot=(0, 0, 0), axis=(1, 0, 0), a=0.0, b=0.0, track=-1, side=0):
    PARTS.append([name, kind, parent, list(map(float, pivot)), list(map(float, axis)), float(a), float(b), track, side])
    return len(PARTS) - 1
P_AIRFRAME = part("airframe")

TRACKS = []
def track_of(name):
    TRACKS.append(tracks[name])
    return len(TRACKS) - 1

# every triangle corner: position, normal, uv (layer's), material, part
corners = []  # arrays per object: (P [n,3,3], N [n,3,3], UV [n,3,2], mat [n], part [n])

def take(o, _=None):
    """An object's evaluated mesh (world, extended pose) in a bmesh, its corners' normals (the file's) in a
    loop layer "cn", in world axes."""
    dg = bpy.context.evaluated_depsgraph_get()
    oe = o.evaluated_get(dg)
    me = oe.to_mesh()
    cn = np.empty(len(me.loops) * 3, np.float32)
    me.corner_normals.foreach_get("vector", cn)
    M = np.array(oe.matrix_world, np.float64)[:3, :3]
    Nm = np.linalg.inv(M).T
    cn = cn.reshape(-1, 3) @ Nm.T
    cn /= np.maximum(np.linalg.norm(cn, axis=1, keepdims=True), 1e-12)
    at = me.attributes.new("cn", "FLOAT_VECTOR", "CORNER")
    at.data.foreach_set("vector", cn.astype(np.float32).ravel())
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(oe.matrix_world)
    oe.to_mesh_clear()
    return bm

def emit(bm, src_mats, part_ids):
    """bm's triangles (its face layer "part" given) → corners, in the ship's frame."""
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uvl = bm.loops.layers.uv.active
    cnl = bm.loops.layers.float_vector.get("cn")
    pl = bm.faces.layers.int.get("part")
    P, N, UV, MAT, PART = [], [], [], [], []
    for f in bm.faces:
        mname = src_mats[f.material_index] if f.material_index < len(src_mats) else "mat_4"
        layer, u0, v0, w, h = CELLS[mname]
        # (the display's faces: their map's UVs inside its rectangle)
        guv = [(lp[uvl].uv.x, 1.0 - lp[uvl].uv.y) for lp in f.loops] if uvl else []
        # (by where it is alone: the dashboard's face in its plane, towards the pilot — the map's display is
        # mirrored on the model's two halves, its UVs no guide)
        screen = (
            mname == "mat_5"
            and f.normal.y > 0.3
            and all(
                abs(lp.vert.co.x) <= PCD_BOX[0] + 0.01 and PCD_BOX[1] - 0.01 <= lp.vert.co.z <= PCD_BOX[2] + 0.01 and -9.62 < lp.vert.co.y < -9.4
                for lp in f.loops
            )
        )
        for k, lp in enumerate(f.loops):
            P.append(lp.vert.co[:])
            N.append(lp[cnl][:] if cnl else lp.vert.normal[:])
            uv = lp[uvl].uv if uvl else Vector((0, 0))
            if screen:
                q = lp.vert.co
                UV.append((min(max((PCD_BOX[0] - q.x) / (2 * PCD_BOX[0]), 0), 1), min(max((PCD_BOX[2] - q.z) / (PCD_BOX[2] - PCD_BOX[1]), 0), 1)))
            else:
                # (Blender's v up; the atlas in glTF's orientation, v down)
                UV.append((u0 + uv.x * w, v0 + (1.0 - uv.y) * h))
        MAT.append(36 if screen else MATNUM.get(mname, 30 + layer))
        PART.append(f[pl] if pl else part_ids)
    corners.append((to_ship(np.array(P)).reshape(-1, 3, 3), dir_to_ship(np.array(N)).reshape(-1, 3, 3),
                    np.array(UV).reshape(-1, 3, 2), np.array(MAT), np.array(PART)))

def loose_parts(bm):
    """bm's connected pieces: lists of faces."""
    bm.faces.index_update()  # (a bisection leaves the new faces' indices stale)
    bm.faces.ensure_lookup_table()
    seen = set()
    out = []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        st = [f0]
        seen.add(f0.index)
        comp = []
        while st:
            f = st.pop()
            comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        st.append(g)
        out.append(comp)
    return out

def bbox(faces):
    vs = np.array([v.co[:] for f in faces for v in f.verts])
    return vs.min(0), vs.max(0)

def sbox(faces, sx):
    """bbox(faces) with x mirrored by sx (−1: the right side seen as the left)"""
    lo, hi = bbox(faces)
    if sx < 0:
        lo, hi = lo.copy(), hi.copy()
        lo[0], hi[0] = -hi[0], -lo[0]
    return lo, hi

def pick(bm, sx, cond):
    """the faces of bm's loose pieces whose box (x mirrored by sx) meets cond(lo, hi)"""
    return [f for pc in loose_parts(bm) if cond(*sbox(pc, sx)) for f in pc]

def carve(bm, faces, planes, pid):
    """Cuts `faces` (part layer set) by the planes (point, normal: the part kept on the + side of each),
    gives the faces inside them all part pid; detaches them (split edges)."""
    pl = bm.faces.layers.int.get("part")

    tag = bm.faces.layers.int.get("cand")
    for f in bm.faces:
        f[tag] = 0
    for f in faces:
        f[tag] = 1
    for co, no in planes:
        co, no = Vector(co), Vector(no).normalized()
        cand = [f for f in bm.faces if f[tag] == 1]
        geom = list({v for f in cand for v in f.verts}) + list({e for f in cand for e in f.edges}) + cand
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-5)
        for f in bm.faces:
            if f[tag] == 1 and (f.calc_center_median() - co).dot(no) < 0:
                f[tag] = 2  # (outside: it stays with the source part)
    inside = [f for f in bm.faces if f[tag] == 1]
    for f in inside:
        f[pl] = pid
    border = [e for e in bm.edges if len({g[pl] for g in e.link_faces}) > 1 and any(g[pl] == pid for g in e.link_faces)]
    bmesh.ops.split_edges(bm, edges=border)
    for f in bm.faces:
        f[tag] = 0
    return inside

def mid_z(bm, x, y, r=0.25):
    """the wing's mid-thickness under a point (model frame)"""
    zs = [v.co.z for v in bm.verts if abs(v.co.x - x) < r and abs(v.co.y - y) < r and 1.4 < v.co.z < 2.9]
    return (min(zs) + max(zs)) / 2 if zs else 2.2

# -- the airframe (Object_33): its control surfaces
o = bpy.data.objects["Object_33"]
bm = take(o, None)
pl = bm.faces.layers.int.new("part")
bm.faces.layers.int.new("cand")  # (made before any face is held: a new layer drops the held faces)
for f in bm.faces:
    f[pl] = P_AIRFRAME
def model_pivot(p):
    return to_ship(np.array(p))
for side, sx in (("left", 1), ("right", -1)):
    s = +1 if sx > 0 else -1
    # the stabilator: two loose skins (the tail's horizontal plane, aft of y 8.6), all-moving about its spindle
    stab = pick(bm, sx, lambda lo, hi: lo[1] > 8.6 and lo[0] > 1.35 and hi[0] > 5)
    pid = part(f"stabilator {side}", 1, pivot=model_pivot((sx * 1.5, 11.0, 2.33)), axis=(1, 0, 0), a=math.radians(20), b=math.radians(25), side=s)
    for f in stab:
        f[pl] = pid
    # the leading-edge flap: two loose skins along the outer wing's leading edge, hinged at their aft edge
    lef = pick(bm, sx, lambda lo, hi: lo[0] > 4.5 and hi[0] > 9.9 and hi[1] < 4.8 and lo[1] > 0.3)
    vs = np.array([v.co[:] for f in lef for v in f.verts])
    inner = vs[np.argmin(np.abs(vs[:, 0]))]
    outer = vs[np.argmax(np.abs(vs[:, 0]))]
    a_in = vs[np.abs(vs[:, 0] - inner[0]) < 0.08]
    a_out = vs[np.abs(vs[:, 0] - outer[0]) < 0.08]
    h0 = (inner[0], a_in[:, 1].max(), (a_in[:, 2].min() + a_in[:, 2].max()) / 2)
    h1 = (outer[0], a_out[:, 1].max(), (a_out[:, 2].min() + a_out[:, 2].max()) / 2)
    ax = np.array(h1) - np.array(h0)
    pid = part(f"leading-edge flap {side}", 1, pivot=model_pivot(h0), axis=dir_to_ship(ax / np.linalg.norm(ax)) * sx,
               a=math.radians(3), b=math.radians(30), side=s)
    for f in lef:
        f[pl] = pid
    # the flaperon: the outer wing's trailing edge, from its root to 9.2 out, aft of a line ~0.9 forward of it
    wing = pick(bm, sx, lambda lo, hi: lo[0] > 4.5 and hi[0] > 9.9 and hi[1] > 6.5 and lo[1] < 2)
    te = lambda x: 8.178 - (abs(x) - 4.6) * 0.245  # (measured: the trailing edge's line)
    x0, x1 = 4.62, 9.2
    p0 = (sx * x0, te(x0) - 0.95, mid_z(bm, sx * x0, te(x0) - 0.95))
    p1 = (sx * x1, te(x1) - 0.78, mid_z(bm, sx * x1, te(x1) - 0.78))
    d = Vector(p1) - Vector(p0)
    nrm = d.cross(Vector((0, 0, 1))).normalized()
    if nrm.y < 0:
        nrm = -nrm  # (aft)
    pid = part(f"flaperon {side}", 1, pivot=model_pivot(p0), axis=dir_to_ship(np.array(d.normalized())) * sx,
               a=math.radians(30), b=math.radians(30), side=s)
    carve(bm, wing, [(p0, nrm), ((sx * x1, 0, 0), (-sx, 0, 0))], pid)
    # the rudder: the fin's aft ~third, hinged on a line parallel to its trailing edge (the fins cant 23° out)
    fin = pick(bm, sx, lambda lo, hi: lo[1] > 6.5 and hi[2] > 5.9 and lo[0] > 2.0 and hi[0] > 3.9)
    A = Vector((sx * 2.73, 10.34, 3.0))
    B = Vector((sx * 3.99, 11.95, 6.0))
    nfin = Vector((sx * 1.0, 0, -0.42)).normalized()
    nrm = (B - A).cross(nfin).normalized()
    if nrm.y < 0:
        nrm = -nrm
    pid = part(f"rudder {side}", 1, pivot=model_pivot(A), axis=dir_to_ship(np.array((B - A).normalized())),
               a=math.radians(30), b=math.radians(30), side=s)
    carve(bm, fin, [(A, nrm)], pid)
    log(f"  {side}: stabilator {len(stab)}, flap {len(lef)}, wing {len(wing)}, fin {len(fin)} faces")

# -- the F-35B's own (docs/PLAN-F35.md, F4): the lift fan's doors — the big one on the spine behind the canopy,
# hinged at its rear, its front raised into the air; the two auxiliary inlet doors behind it; the two under the
# belly, opened outwards —, the roll posts' doors under the wing roots, the doors of the bay the swivelling
# nozzle swings down through. Each cut out of the airframe's skin where it faces (its normal) and lies.
def skin(lo, hi, up):
    """the airframe's faces (still the airframe's) facing up (or down) whose box meets the box lo…hi — the cut
    then trims them to it (a face larger than the door is taken too)"""
    out = []
    for f in bm.faces:
        facing = f.normal.z > 0.35 if up else f.normal.z < -0.35
        if f[pl] != P_AIRFRAME or not facing:
            continue
        vs = [v.co for v in f.verts]
        if all(max(v[i] for v in vs) >= lo[i] and min(v[i] for v in vs) <= hi[i] for i in range(3)):
            out.append(f)
    return out
FAN = (0.0, -4.9)  # the lift fan's axis (model x, y)
door = skin((-1.0, -6.2, 3.3), (1.0, -3.6, 4.3), True)
pid = part("lift fan door", 1, pivot=model_pivot((0, -3.6, 4.03)), axis=(1, 0, 0), a=0.0, b=math.radians(68))
carve(bm, door, [((0, -6.2, 0), (0, 1, 0)), ((0, -3.6, 0), (0, -1, 0)), ((1.0, 0, 0), (-1, 0, 0)), ((-1.0, 0, 0), (1, 0, 0))], pid)
for sx, side in ((1, "left"), (-1, "right")):
    aux = skin((min(sx * 0.2, sx * 0.8), -3.4, 3.3), (max(sx * 0.2, sx * 0.8), -2.6, 4.3), True)
    pid = part(f"auxiliary inlet door {side}", 1, pivot=model_pivot((sx * 0.5, -2.6, 3.93)), axis=(1, 0, 0), a=0.0, b=math.radians(40), side=sx)
    carve(bm, aux, [((0, -3.4, 0), (0, 1, 0)), ((0, -2.6, 0), (0, -1, 0)), ((sx * 0.2, 0, 0), (sx, 0, 0)), ((sx * 0.8, 0, 0), (-sx, 0, 0))], pid)
    low = skin((min(0, sx * 0.95), -5.9, -0.2), (max(0, sx * 0.95), -3.9, 1.2), False)
    pid = part(f"lift fan lower door {side}", 1, pivot=model_pivot((sx * 0.95, -4.9, 0.42)), axis=(0, 1, 0), a=0.0, b=math.radians(85), side=sx)
    carve(bm, low, [((0, -5.9, 0), (0, 1, 0)), ((0, -3.9, 0), (0, -1, 0)), ((0, 0, 0), (sx, 0, 0)), ((sx * 0.95, 0, 0), (-sx, 0, 0))], pid)
    # (under the wing root, outboard of the intake: its underside from 4.3 out)
    post = skin((min(sx * 4.4, sx * 5.0), 2.5, 1.4), (max(sx * 4.4, sx * 5.0), 3.3, 2.0), False)
    pid = part(f"roll post door {side}", 1, pivot=model_pivot((sx * 5.0, 2.9, 1.78)), axis=(0, 1, 0), a=0.0, b=math.radians(75), side=sx)
    carve(bm, post, [((0, 2.5, 0), (0, 1, 0)), ((0, 3.3, 0), (0, -1, 0)), ((sx * 4.4, 0, 0), (sx, 0, 0)), ((sx * 5.0, 0, 0), (-sx, 0, 0))], pid)
    bay = skin((min(0, sx * 1.3), 9.0, -0.2), (max(0, sx * 1.3), 14.0, 1.6), False)
    pid = part(f"nozzle bay door {side}", 1, pivot=model_pivot((sx * 1.3, 9.8, 1.6)), axis=(0, 1, 0), a=0.0, b=math.radians(100), side=sx)
    carve(bm, bay, [((0, 9.0, 0), (0, 1, 0)), ((0, 0, 0), (sx, 0, 0)), ((sx * 1.3, 0, 0), (-sx, 0, 0))], pid)
log("  the STOVL doors cut")
# -- the airframe's arches under the canopy (its frame as the model has it, in front of the pilot's eyes): a part
# of their own, hidden from the pilot's seat as the pilot is (src/f35/model.ts)
P_ARCH = part("canopy arches")
for f in bm.faces:
    if f[pl] != P_AIRFRAME:
        continue
    c = f.calc_center_median()
    if -11.3 < c.y < -6.9 and abs(c.x) < 0.95 and c.z > 3.45:
        f[pl] = P_ARCH
emit(bm, [s.material.name for s in o.material_slots], None)
bm.free()

# -- the lift fan: its well under the doors (a cylinder from the belly to the spine) and its two counter-rotating
# stages of blades (generated: the model has none) — a plain dark metal, material 35
def add_tris(tris, normals, pid, mat=35):
    P = np.array(tris, np.float64).reshape(-1, 3, 3)
    N = np.array(normals, np.float64).reshape(-1, 3, 3)
    n = len(P)
    corners.append((to_ship(P), dir_to_ship(N), np.zeros((n, 3, 2)), np.full(n, mat), np.full(n, pid)))
R_FAN = 1.15
well_t, well_n = [], []
SEG = 40
for k in range(SEG):
    a0, a1 = 2 * math.pi * k / SEG, 2 * math.pi * (k + 1) / SEG
    p = [(FAN[0] + R_FAN * math.cos(a), FAN[1] + R_FAN * math.sin(a)) for a in (a0, a1)]
    nn = [(-math.cos(a), -math.sin(a), 0) for a in (a0, a1)]
    z0, z1 = 0.45, 3.95
    q = [(p[0][0], p[0][1], z0), (p[1][0], p[1][1], z0), (p[1][0], p[1][1], z1), (p[0][0], p[0][1], z1)]
    well_t += [q[0], q[2], q[1], q[0], q[3], q[2]]
    well_n += [nn[0], nn[1], nn[1], nn[0], nn[0], nn[1]]
P_WELL = part("lift fan well")
add_tris(well_t, well_n, P_WELL)
for stage, z, turn in ((1, 3.05, 1), (2, 2.55, -1)):
    pid = part(f"lift fan stage {stage}", 6, pivot=model_pivot((FAN[0], FAN[1], z)), axis=dir_to_ship(np.array((0, 0, 1.0))), a=turn)
    t, nrm = [], []
    for k in range(28):
        a = 2 * math.pi * k / 28
        tw = math.radians(35) * turn
        for r0, r1 in ((0.32, 1.12),):
            e = lambda r, da, dz: (FAN[0] + r * math.cos(a + da), FAN[1] + r * math.sin(a + da), z + dz)
            w = 0.09
            q = [e(r0, -w / r0, -0.06), e(r1, -w / r1 * 0.6, -0.04), e(r1, w / r1 * 0.6, 0.04), e(r0, w / r0, 0.06)]
            t += [q[0], q[1], q[2], q[0], q[2], q[3]]
            n_ = (math.sin(tw) * -math.sin(a), math.sin(tw) * math.cos(a), math.cos(tw))
            nrm += [n_] * 6
    # (its hub: a disc)
    for k in range(20):
        a0, a1 = 2 * math.pi * k / 20, 2 * math.pi * (k + 1) / 20
        t += [(FAN[0], FAN[1], z + 0.02), (FAN[0] + 0.33 * math.cos(a0), FAN[1] + 0.33 * math.sin(a0), z + 0.02), (FAN[0] + 0.33 * math.cos(a1), FAN[1] + 0.33 * math.sin(a1), z + 0.02)]
        nrm += [(0, 0, 1)] * 3
    add_tris(t, nrm, pid)
log("  the lift fan generated")

# -- the pilot's controls (the model's pilot holds none): the side stick on the right console, the throttle on
# the left — a grip on a boot each, material 37 (the cockpit's dark hardware); the stick tilts about its base
# (pitch, roll), the throttle slides fore and aft along its quadrant
def box(c, half, rot=None):
    """a box's triangles and normals (model frame), centred at c, half-sizes half"""
    cx, cy, cz = c
    hx, hy, hz = half
    V = [(cx + sx * hx, cy + sy * hy, cz + sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    F = [((0, 1, 3, 2), (-1, 0, 0)), ((4, 6, 7, 5), (1, 0, 0)), ((0, 4, 5, 1), (0, -1, 0)), ((2, 3, 7, 6), (0, 1, 0)), ((0, 2, 6, 4), (0, 0, -1)), ((1, 5, 7, 3), (0, 0, 1))]
    t, n = [], []
    for q, nn in F:
        a, b, c_, d = (V[i] for i in q)
        t += [a, b, c_, a, c_, d]
        n += [nn] * 6
    return t, n
STICK = (-0.64, -8.86, 2.56)
P_STICK = part("side stick", 8, pivot=model_pivot(STICK), axis=(1, 0, 0))
t1, n1 = box((STICK[0], STICK[1], STICK[2] + 0.02), (0.07, 0.07, 0.03))
t2, n2 = box((STICK[0], STICK[1] - 0.01, STICK[2] + 0.15), (0.045, 0.055, 0.11))
t3, n3 = box((STICK[0], STICK[1] - 0.035, STICK[2] + 0.27), (0.04, 0.06, 0.025))
add_tris(t2 + t3, n2 + n3, P_STICK, 37)
add_tris(t1, n1, P_AIRFRAME, 37)
THROTTLE = (0.63, -8.98, 2.6)
P_THR = part("throttle", 9, pivot=model_pivot(THROTTLE), axis=dir_to_ship(np.array((0, -1.0, 0))), a=0.16 * SCALE)
t1, n1 = box((THROTTLE[0], THROTTLE[1], THROTTLE[2] - 0.02), (0.05, 0.22, 0.02))
t2, n2 = box((THROTTLE[0], THROTTLE[1] + 0.12, THROTTLE[2] + 0.09), (0.055, 0.07, 0.08))
add_tris(t2, n2, P_THR, 37)
add_tris(t1, n1, P_AIRFRAME, 37)
log("  the stick and the throttle generated")

# -- the landing gear: the legs on their tracks, their wheels turning on them; the doors
WHEELS = {"Object_47": ((-0.05, -7.465, -1.71), 0.47, (-0.22, 0.12)),
          "Object_51": ((4.04, 5.125, -1.475), 0.70, (3.79, 4.26)),
          "Object_103": ((-4.04, 5.125, -1.475), 0.70, (-4.26, -3.79))}
for name in ["Object_47", "Object_51", "Object_103"]:
    o = bpy.data.objects[name]
    bm = take(o, None)
    pl = bm.faces.layers.int.new("part")
    leg = part(MOVING[name], 2, track=track_of(name), side=0 if name == "Object_47" else (1 if name == "Object_51" else -1))
    c, r, (xa, xb) = WHEELS[name]
    wheel = part(MOVING[name].replace("leg", "wheel"), 3, parent=leg, pivot=model_pivot(c), axis=(1, 0, 0), a=r * SCALE)
    for pc in loose_parts(bm):
        lo, hi = bbox(pc)
        inside = lo[0] > xa - 0.01 and hi[0] < xb + 0.01 and math.hypot(max(abs(lo[1] - c[1]), abs(hi[1] - c[1])), max(abs(lo[2] - c[2]), abs(hi[2] - c[2]))) < r * 1.03
        for f in pc:
            f[pl] = wheel if inside else leg
    emit(bm, [s.material.name for s in o.material_slots], None)
    bm.free()
for name in ["Object_57", "Object_65", "Object_73", "Object_81", "Object_89", "Object_97"]:
    o = bpy.data.objects[name]
    bm = take(o, None)
    pl = bm.faces.layers.int.new("part")
    pid = part(MOVING[name], 2, track=track_of(name))
    for f in bm.faces:
        f[pl] = pid
    emit(bm, [s.material.name for s in o.material_slots], None)
    bm.free()

# -- the canopy (its glass, its frame's pieces from the bays' mesh), hinged at its front
P_CANOPY = part("canopy", 1, pivot=model_pivot((0, -10.95, 2.85)), axis=(1, 0, 0), a=0.0, b=math.radians(45))
CANOPY_BOX = ((-0.9, -11.6, 2.9), (0.9, -5.85, 4.2))
def in_canopy(lo, hi):
    return all(lo[i] >= CANOPY_BOX[0][i] for i in range(3)) and all(hi[i] <= CANOPY_BOX[1][i] for i in range(3))
# -- the nozzle: its petals open with the afterburner (each about its forward edge, tangent to the ring)
NOZ_C = np.array((0.0, 10.14, 1.955))
P_PILOT = part("pilot")
for name in ["Object_9", "Object_45", "Object_21", "Object_13", "Object_25", "Object_17", "Object_29", "Object_41", "Object_37"]:
    o = bpy.data.objects[name]
    bm = take(o, None)
    pl = bm.faces.layers.int.new("part")
    bm.faces.layers.int.new("cand")
    if name in ("Object_17", "Object_29", "Object_41"):
        pid = P_PILOT
        for f in bm.faces:
            f[pl] = pid
    elif name == "Object_45":
        for f in bm.faces:
            f[pl] = P_CANOPY
    elif name == "Object_9":
        for pc in loose_parts(bm):
            pid = P_CANOPY if in_canopy(*bbox(pc)) else P_AIRFRAME
            for f in pc:
                f[pl] = pid
    elif name == "Object_21":
        P_NOZZLE = part("nozzle")
        for pc in loose_parts(bm):
            lo, hi = bbox(pc)
            petal = abs(lo[1] - 10.14) < 0.05 and abs(hi[1] - 11.52) < 0.05 and (hi[0] - lo[0]) < 0.75
            if petal:
                c = (lo + hi) / 2
                rad = np.array((c[0], 0, c[2] - NOZ_C[2]))
                rad /= np.linalg.norm(rad)
                tang = np.cross(np.array((0, 1.0, 0)), rad)  # (about it the petal swings out)
                piv = NOZ_C + rad * 1.06
                pid = part("petal", 4, parent=P_NOZZLE, pivot=model_pivot(piv), axis=dir_to_ship(tang), a=1.06 * SCALE)
            else:
                pid = P_NOZZLE
            for f in pc:
                f[pl] = pid
        # the three-bearing swivel module: the nozzle's duct cut by two planes tilted 23.75° from its section
        # (opposite ways); the segment between them turned half a turn about the first's normal, the last
        # back about the second's, the whole about the duct's axis: the exit swings down through 95°, the cuts
        # sealed all the while (src/f35/model.ts)
        PHI = math.radians(23.75)
        cA = (0.0, 9.05, NOZ_C[2])
        cB = (0.0, 9.75, NOZ_C[2])
        nA = (0.0, math.cos(PHI), -math.sin(PHI))
        nB = (0.0, math.cos(PHI), math.sin(PHI))
        P_SEG1 = part("nozzle segment 1", 5, parent=P_NOZZLE, pivot=model_pivot(cA), axis=dir_to_ship(np.array(nA)), a=1)
        duct = [f for f in bm.faces if f[pl] == P_NOZZLE]
        carve(bm, duct, [(cA, nA)], P_SEG1)
        P_SEG2 = part("nozzle segment 2", 5, parent=P_SEG1, pivot=model_pivot(cB), axis=dir_to_ship(np.array(nB)), a=-1)
        carve(bm, [f for f in bm.faces if f[pl] == P_SEG1], [(cB, nB)], P_SEG2)
        for p_ in PARTS:
            if p_[0] == "petal":
                p_[2] = P_SEG2
        # (the exit: its centre and the way the jet leaves — a marker, no vertices: the plume follows it)
        part("nozzle exit", 7, parent=P_SEG2, pivot=model_pivot((0.0, 11.55, NOZ_C[2])), axis=dir_to_ship(np.array((0, 1.0, 0))))
    else:
        for f in bm.faces:
            f[pl] = P_AIRFRAME
    emit(bm, [s.material.name for s in o.material_slots], None)
    bm.free()
log("parts", len(PARTS), "tracks", len(TRACKS), "triangles", sum(len(c[3]) for c in corners))

# ---- 3. the vertices: corners merged where position, normal, uv, material and part agree
P = np.concatenate([c[0] for c in corners]).reshape(-1, 3)
N = np.concatenate([c[1] for c in corners]).reshape(-1, 3)
UV = np.concatenate([c[2] for c in corners]).reshape(-1, 2)
MAT = np.repeat(np.concatenate([c[3] for c in corners]), 3)
PRT = np.repeat(np.concatenate([c[4] for c in corners]), 3)
N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
key = np.hstack([np.round(P * 1e4), np.round(N * 1e3), np.round(UV * 1e5), MAT[:, None], PRT[:, None]]).astype(np.int64)
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
inv = inv.ravel()
V_P, V_N, V_UV, V_M, V_PT = P[first], N[first], UV[first], MAT[first], PRT[first]
IDX = inv.astype(np.uint32)
# (each triangle wound counter-clockwise seen from its normals' side: the mirrored nodes' came inverted)
tri = IDX.reshape(-1, 3)
fn = np.cross(V_P[tri[:, 1]] - V_P[tri[:, 0]], V_P[tri[:, 2]] - V_P[tri[:, 0]])
flip = (fn * (V_N[tri[:, 0]] + V_N[tri[:, 1]] + V_N[tri[:, 2]])).sum(1) < 0
tri[flip] = tri[flip][:, [0, 2, 1]]
IDX = tri.ravel().astype(np.uint32)
log("triangles turned", int(flip.sum()))
# (each hinge's axis turned so that a positive angle moves its part as named: the horizontal surfaces'
# trailing edge down, the rudders' to the left, the canopy's rear up)
for i, p in enumerate(PARTS):
    if p[1] != 1:
        continue
    sel = V_PT == i
    if not sel.any():
        log("  part without vertices:", p[0])
        continue
    c = V_P[sel].mean(0)
    want = np.array((1.0, 0, 0)) if p[0].startswith("rudder") else np.array((0, 1.0, 0)) if p[0] == "canopy" else np.array((0, -1.0, 0))
    if p[0].startswith("leading-edge"):
        want = np.array((0, -1.0, 0))  # (its leading edge, forward of the hinge, down)
    # (the doors open: those on the spine up, those underneath down — and outwards)
    if p[0] in ("lift fan door",) or p[0].startswith("auxiliary"):
        want = np.array((0, 1.0, 0))
    if p[0].startswith(("lift fan lower", "roll post", "nozzle bay")):
        want = np.array((0, -1.0, 0))
    if np.dot(np.cross(np.array(p[4]), c - np.array(p[3])), want) < 0:
        p[4] = [-x for x in p[4]]
log("vertices", len(first), "indices", len(IDX))

# ambient occlusion: rays from each vertex over its hemisphere, against the whole craft (its extended pose);
# the glass lets the light in
tris = IDX.reshape(-1, 3)
solid = V_M[tris[:, 0]] != 32
bvh = BVHTree.FromPolygons([tuple(p) for p in V_P], [tuple(t) for t in tris[solid]], all_triangles=True)
rng = np.random.default_rng(7)
dirs = rng.normal(size=(AO_RAYS, 3))
dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
AO = np.ones(len(V_P), np.float32)
for i in range(len(V_P)):
    n = V_N[i]
    o_ = Vector(V_P[i] + n * 0.004)
    hit = 0
    cnt = 0
    for d in dirs:
        c = d @ n
        if c <= 0:
            d = -d
            c = -c
        cnt += 1
        loc, _, _, dist = bvh.ray_cast(o_, Vector(d), 2.5)
        if loc is not None:
            hit += 1 - dist / 2.5
    AO[i] = 1 - hit / max(cnt, 1)
log("ambient occlusion baked")

lo = V_P.min(0)
hi = V_P.max(0)
out = bytearray()
out += b"F35B" + struct.pack("<3I", 2, len(V_P), len(IDX)) + struct.pack("<6f", *lo, *hi)
out += struct.pack("<2I", len(PARTS), K)
for name, kind, parent, piv, axis, a, b, trk, side in PARTS:
    out += struct.pack("<16f", kind, parent, *piv, *axis, a, b, trk, side, 0, 0, 0, 0)
for T in TRACKS:
    out += np.asarray(T, np.float32).tobytes()
# (v2: the parts' names, JSON, padded to 4 bytes)
names = json.dumps([p[0] for p in PARTS]).encode()
names += b" " * ((4 - len(names) % 4) % 4)
out += struct.pack("<I", len(names)) + names
V = np.zeros((len(V_P), 10), np.float32)
V[:, 0:3] = V_P
V[:, 3:6] = V_N
V[:, 6] = V_M
V[:, 7] = V_PT + np.clip(AO, 0, 1) * 0.999
V[:, 8:10] = V_UV
out += V.tobytes() + IDX.tobytes()
with open(f"{OUT}/f35.bin", "wb") as f:
    f.write(gzip.compress(bytes(out), 9))
with open(f"{WORK}/parts.json", "w") as f:
    json.dump([{"name": p[0], "kind": p[1], "parent": p[2], "pivot": p[3], "axis": p[4], "a": p[5], "b": p[6], "track": p[7], "side": p[8]} for p in PARTS], f, indent=1)
log("written", f"{OUT}/f35.bin", os.path.getsize(f"{OUT}/f35.bin") // 1024, "kB; bounds", lo.round(2), hi.round(2))
