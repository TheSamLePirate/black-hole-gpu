"""
The International Space Station for the web: NASA's model (assets/iss/ISS2.glb — the station as flown,
its joints named: IGOAL reference frame, in inches; Draco geometry, WebP/PNG textures; 2.7 M triangles,
91 MB, not in the repository) → assets/iss/iss-lod0.bin, assets/iss/iss-lod1.bin.

Run with Blender (its glTF importer decodes Draco and WebP):

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
      --python scripts/build-iss.py [-- path/to/ISS2.glb]

 1. imported; every mesh's vertices in the scene's frame (the file's root carries a negative scale — a
    mirror —, undone below with the axes);
 2. each mesh's colour baked per vertex from its base-colour texture (at its corners' UVs, averaged per
    vertex; the material's colour where it has none), the faces mostly transparent in it dropped
    (the cut-outs);
 3. grouped by the joint that moves it — the solar arrays' alpha joints (SARJ, port and starboard), the
    eight beta gimbals (BGA), the radiators' joints (TRRJ) —, each group decimated (edge collapse) to a
    share of the triangles, its normals smoothed below 40°;
 4. written in the station's own frame, IGOAL in metres: x forward (the velocity, flying +XVV), y
    starboard, z nadir; origin the truss's centre.

Binary (little endian, gzip): "ISS1", u32 version 2, u32 vertex count, u32 index count, u32 joint count,
u32 port count, then per joint 12 f32 — pivot xyz, axis xyz, rest normal xyz (the arrays' blanket, the
radiators' panels; 0 when none), parent index (−1: the station), kind (1 alpha, 2 beta, 3 radiator), 0 —,
per docking port 8 f32 — its ring's centre, its outward axis, 0, 0 (IDA-2, IDA-3) —, then the
vertices (24 bytes: position 3 × f32 [m]; normal 4 × snorm8; colour 4 × unorm8 — sRGB, alpha the
surface kind: 0 hull, 1 solar cells, 2 radiator —; part u8 (0: the station, k + 1: joint k), 3 × u8 0)
and u32 indices.
"""
import bpy, gzip, math, struct, sys, time
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = "/".join(__file__.split("/")[:-2]) if "/" in __file__ else "."
SRC = argv[0] if argv else ROOT + "/assets/iss/ISS2.glb"
OUT = ROOT + "/assets/iss"
# the file's unit: inches scaled by 0.00258168… at its root (the station 73 m long, as it is)
SCALE = 0.0254 / 0.002581682987511158
JOINTS = [
    ("PORT_ALPHA_ROT", None, 1), ("STBD_ALPHA_ROT", None, 1),
    ("PORT_BETA_ROT_2A", "PORT_ALPHA_ROT", 2), ("PORT_BETA_ROT_4A", "PORT_ALPHA_ROT", 2),
    ("PORT_BETA_ROT_2B", "PORT_ALPHA_ROT", 2), ("PORT_BETA_ROT_4B", "PORT_ALPHA_ROT", 2),
    ("STBD_BETA_ROT_1A", "STBD_ALPHA_ROT", 2), ("STBD_BETA_ROT_3A", "STBD_ALPHA_ROT", 2),
    ("STBD_BETA_ROT_1B", "STBD_ALPHA_ROT", 2), ("STBD_BETA_ROT_3B", "STBD_ALPHA_ROT", 2),
    ("PORT_TRRJ_GAMMA_ROT", None, 3), ("STBD_TRRJ_GAMMA_ROT", None, 3),
]
JI = {n: i for i, (n, _, _) in enumerate(JOINTS)}
# triangles kept per level (of the 2.7 M): a coarse one for the distance, a fine one near
LEVELS = [("iss-lod0.bin", 90_000), ("iss-lod1.bin", 520_000)]
TEX = 1024  # textures read at most this size (their mean colour over a triangle is what is kept)

t0 = time.time()
def log(*a):
    print("##", f"{time.time() - t0:6.1f}s", *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
log("imported", len(bpy.data.objects), "objects")

def to_station(p):
    """scene → IGOAL metres (the root's mirror undone: x forward, y starboard, z nadir)"""
    return -SCALE * p

def joint_of(o):
    while o is not None:
        n = o.name.split(".")[0]
        if n in JI:
            return JI[n]
        o = o.parent
    return -1

def kind_of(o):
    n = o.name
    if "Details" in n or "Handrail" in n or "IPA" in n:
        return 0
    if "Array" in n or n.startswith("IROSA_Deployed"):
        return 1
    if "Radiator" in n and "HRS" not in n:
        return 2
    return 0

# ---- textures: the base colour's image of each material (or its colour), read once, at most TEX²
img_cache = {}
def image_px(img):
    if img.name in img_cache:
        return img_cache[img.name]
    w, h = img.size
    if w == 0 or h == 0:
        img_cache[img.name] = None
        return None
    if max(w, h) > TEX:
        img.scale(min(w, TEX), min(h, TEX))
        w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    img_cache[img.name] = (px.reshape(h, w, 4), w, h)
    return img_cache[img.name]

def upstream_image(sock, depth=0):
    if depth > 6 or not sock.links:
        return None
    nd = sock.links[0].from_node
    if nd.type == "TEX_IMAGE" and nd.image:
        return nd.image
    for s in nd.inputs:
        r = upstream_image(s, depth + 1)
        if r:
            return r
    return None

def material_source(m):
    if m is None or not m.use_nodes:
        return None, (0.7, 0.7, 0.7)
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return None, (0.7, 0.7, 0.7)
    bc = bsdf.inputs["Base Color"]
    img = upstream_image(bc)
    return img, tuple(bc.default_value[:3])

# ---- every mesh: its triangles in the station's frame, a colour per vertex, its joint and kind
parts = {}  # joint index → list of (verts, tris, colours, kinds)
port_pts = {}  # the docking adapters' vertices
dropped = 0
total = 0
dg = bpy.context.evaluated_depsgraph_get()
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    me = o.evaluated_get(dg).to_mesh()
    me.calc_loop_triangles()
    nv, nt = len(me.vertices), len(me.loop_triangles)
    if nt == 0:
        o.evaluated_get(dg).to_mesh_clear()
        continue
    co = np.empty(nv * 3, np.float32); me.vertices.foreach_get("co", co)
    M = np.array(o.matrix_world, np.float64)
    P = co.reshape(-1, 3).astype(np.float64) @ M[:3, :3].T + M[:3, 3]
    tri_v = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get("vertices", tri_v); tri_v = tri_v.reshape(-1, 3)
    tri_l = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get("loops", tri_l); tri_l = tri_l.reshape(-1, 3)
    tri_m = np.empty(nt, np.int32); me.loop_triangles.foreach_get("material_index", tri_m)
    uv = None
    if me.uv_layers.active:
        uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
    # colour and alpha per triangle corner
    col = np.zeros((nt, 3, 3), np.float32)
    alpha = np.ones((nt, 3), np.float32)
    for mi, slot in enumerate(o.material_slots or [None]):
        sel = tri_m == mi
        if not sel.any():
            continue
        img, base = material_source(slot.material if slot else None)
        src = image_px(img) if img else None
        if src is None or uv is None:
            col[sel] = base
            continue
        px, w, h = src
        L = tri_l[sel]
        u = uv[L.ravel(), 0]; v = uv[L.ravel(), 1]
        x = np.clip(((u % 1.0) * w).astype(np.int32), 0, w - 1)
        y = np.clip(((v % 1.0) * h).astype(np.int32), 0, h - 1)
        c = px[y, x]
        col[sel] = c[:, :3].reshape(-1, 3, 3)
        alpha[sel] = c[:, 3].reshape(-1, 3)
    # (the cut-outs: triangles mostly transparent in their texture)
    keep = alpha.mean(1) >= 0.4
    dropped += int((~keep).sum())
    total += nt
    tri_v, col = tri_v[keep], col[keep]
    # a colour per vertex: the mean of its corners'
    vc = np.zeros((nv, 3), np.float64); cnt = np.zeros(nv, np.float64)
    np.add.at(vc, tri_v.ravel(), col.reshape(-1, 3)); np.add.at(cnt, tri_v.ravel(), 1)
    vc = (vc / np.maximum(cnt, 1)[:, None]).astype(np.float32)
    j = joint_of(o)
    parts.setdefault(j, []).append((to_station(P), tri_v, vc, kind_of(o)))
    base_name = o.name.split(".")[0]
    if base_name in ("PMA2", "PMA3"):
        port_pts.setdefault(base_name, []).append(to_station(P))
    o.evaluated_get(dg).to_mesh_clear()
log(f"meshes read: {total} triangles, {dropped} transparent dropped; parts", sorted(parts))

# ---- the joints: pivot, axis, rest normal, in the station's frame
def obj(name):
    return bpy.data.objects.get(name) or bpy.data.objects.get(name + ".001")

def pca(P):
    c = P.mean(0)
    w, V = np.linalg.eigh(np.cov((P - c).T))
    return c, V[:, 2], V[:, 0]  # centre, longest axis, thinnest axis

joint_rec = []
for i, (name, parent, kind) in enumerate(JOINTS):
    o = obj(name)
    pivot = to_station(np.array(o.matrix_world.translation, np.float64))
    normal = np.zeros(3)
    if kind == 1:
        axis = np.array([0.0, 1.0, 0.0])  # the truss's axis (starboard)
    else:
        # the wing (or the radiator) it carries: its longest extent from the pivot is the mast (beta),
        # its thinnest the panel's normal; a radiator turns about the truss's axis
        groups = parts.get(i, [])
        sel = [(P, tv, vc, k) for (P, tv, vc, k) in groups if k == (1 if kind == 2 else 2)]
        if not sel:
            sel = groups
        pts = np.concatenate([P[np.unique(tv)] for (P, tv, vc, k) in sel])
        c, longest, thinnest = pca(pts)
        if kind == 2:
            axis = longest if np.dot(longest, c - pivot) > 0 else -longest
        else:
            axis = np.array([0.0, 1.0, 0.0])
        normal = thinnest
    joint_rec.append((pivot, axis / np.linalg.norm(axis), normal, JI[parent] if parent else -1, kind))
    log(name, "pivot", np.round(pivot, 2), "axis", np.round(axis, 3), "normal", np.round(normal, 3))

# ---- the docking ports: the adapters' outer rings — IDA-2 on PMA-2, forward of Harmony (+x); IDA-3
# on PMA-3, its zenith (−z) — their centre and outward axis
ports = []
for name, axis in (("PMA2", np.array([1.0, 0.0, 0.0])), ("PMA3", np.array([0.0, 0.0, -1.0]))):
    P = np.concatenate(port_pts[name])
    d = P @ axis
    ring = P[d > d.max() - 0.06]
    c = ring.mean(0)
    c = c - axis * (c @ axis) + axis * d.max()
    ports.append((c, axis))
    log("port", name, np.round(c, 3), axis)

# ---- each level: every part decimated to its share, smoothed, written
def build(target, out):
    tot = sum(len(tv) for g in parts.values() for (P, tv, vc, k) in g)
    ratio = min(1.0, target / tot)
    V_all, N_all, C_all, K_all, J_all, I_all = [], [], [], [], [], []
    base = 0
    for j, groups in sorted(parts.items()):
        for kind in (0, 1, 2):
            sub = [(P, tv, vc) for (P, tv, vc, k) in groups if k == kind]
            if not sub:
                continue
            # one Blender mesh per part and kind: vertices, faces, a colour attribute
            verts, faces, cols = [], [], []
            off = 0
            for (P, tv, vc) in sub:
                used = np.unique(tv)
                remap = -np.ones(len(P), np.int64); remap[used] = np.arange(len(used))
                verts.append(P[used]); cols.append(vc[used]); faces.append(remap[tv] + off); off += len(used)
            verts = np.concatenate(verts); faces = np.concatenate(faces); cols = np.concatenate(cols)
            me = bpy.data.meshes.new("part")
            me.from_pydata(verts.tolist(), [], faces.tolist())
            attr = me.color_attributes.new("col", "FLOAT_COLOR", "POINT")
            rgba = np.concatenate([cols, np.ones((len(cols), 1), np.float32)], 1).ravel()
            attr.data.foreach_set("color", rgba)
            ob = bpy.data.objects.new("part", me)
            bpy.context.scene.collection.objects.link(ob)
            bpy.context.view_layer.objects.active = ob
            for x in bpy.context.selected_objects:
                x.select_set(False)
            ob.select_set(True)
            # (the solar blankets and radiators are big flat panels: kept whole; the rest decimated)
            r = ratio if kind == 0 else min(1.0, ratio * 3)
            if r < 1.0:
                md = ob.modifiers.new("dec", "DECIMATE"); md.ratio = r; md.use_collapse_triangulate = True
            md2 = ob.modifiers.new("tri", "TRIANGULATE")
            dg2 = bpy.context.evaluated_depsgraph_get()
            em = ob.evaluated_get(dg2).to_mesh()
            em.calc_loop_triangles()
            # normals: smooth across edges flatter than 40°, split elsewhere (per corner)
            em.shade_smooth()
            em.set_sharp_from_angle(angle=math.radians(40))
            nt = len(em.loop_triangles)
            tl = np.empty(nt * 3, np.int32); em.loop_triangles.foreach_get("loops", tl)
            lv = np.empty(len(em.loops), np.int32); em.loops.foreach_get("vertex_index", lv)
            cn = np.empty(len(em.loops) * 3, np.float32); em.corner_normals.foreach_get("vector", cn); cn = cn.reshape(-1, 3)
            co = np.empty(len(em.vertices) * 3, np.float32); em.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
            ca = em.color_attributes.get("col")
            cc = np.empty(len(em.vertices) * 4, np.float32); ca.data.foreach_get("color", cc); cc = cc.reshape(-1, 4)[:, :3]
            # (a vertex per distinct (vertex, normal) pair: the corners merged where smooth)
            nq = np.round(cn * 127).astype(np.int32)
            key = lv.astype(np.int64) * 16777216 + ((nq[:, 0] + 128) * 65536 + (nq[:, 1] + 128) * 256 + (nq[:, 2] + 128))
            uk, inv = np.unique(key, return_inverse=True)
            first = np.zeros(len(uk), np.int64); first[inv] = np.arange(len(key))
            vidx = lv[first]
            # (the mirror: Blender's normals, from the winding, point inwards — turned outwards)
            V_all.append(co[vidx]); N_all.append(-cn[first]); C_all.append(cc[vidx])
            K_all.append(np.full(len(uk), kind, np.uint8)); J_all.append(np.full(len(uk), j + 1, np.uint8))
            tri = inv[tl].reshape(-1, 3)
            # (the mirror undone: the winding turned back)
            I_all.append(tri[:, [0, 2, 1]] + base)
            base += len(uk)
            ob.evaluated_get(dg2).to_mesh_clear()
            bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    V = np.concatenate(V_all).astype(np.float32); N = np.concatenate(N_all); C = np.concatenate(C_all)
    K = np.concatenate(K_all); J = np.concatenate(J_all); I = np.concatenate(I_all).astype(np.uint32)
    nv, ni = len(V), I.size
    vb = np.zeros((nv, 24), np.uint8)
    vb[:, 0:12] = V.view(np.uint8).reshape(nv, 12)
    vb[:, 12:15] = np.clip(np.round(N * 127), -127, 127).astype(np.int8).view(np.uint8)
    srgb = np.clip(C, 0, 1)
    vb[:, 16:19] = np.round(srgb * 255).astype(np.uint8)
    vb[:, 19] = K
    vb[:, 20] = J
    head = struct.pack("<4sIIIII", b"ISS1", 2, nv, ni, len(joint_rec), len(ports))
    jt = b"".join(struct.pack("<12f", *p, *a, *n, float(par), float(k), 0.0) for (p, a, n, par, k) in joint_rec)
    pt = b"".join(struct.pack("<8f", *c, *a, 0.0, 0.0) for (c, a) in ports)
    data = head + jt + pt + vb.tobytes() + I.tobytes()
    with open(OUT + "/" + out, "wb") as f:
        f.write(gzip.compress(data, 9))
    log(out, f"{ni // 3} triangles, {nv} vertices, {len(data) / 1e6:.1f} MB → gzip", f"{len(gzip.compress(data, 9)) / 1e6:.1f} MB")

for out, target in LEVELS:
    build(target, out)
log("done")
