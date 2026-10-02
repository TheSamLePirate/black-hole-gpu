"""
The Ranger's cockpit, first stage (Blender): the interior's OBJ (assets/Interstellar Ranger One Cockpit,
580 k faces, objects "Ra…" — the floor, the consoles, the seats, the cryo pods, the screens…) → a plain
mesh for scripts/build-cockpit.ts.

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
      --python scripts/cockpit-convert.py -- <obj> <out.bin>

 1. imported with the OBJ's own axes (y up, z towards the nose, x to the left — the ship's frame already);
 2. each object's kind from its name (the glass too: the cabin is drawn alone, from inside); the two
    flight sticks found (the grips beside the front seats: 18 cm, x = ±1.48 m) — a kind of their own, to
    move with the pilot's commands;
 3. each object decimated (edge collapse) to a share of the triangles — the screens and the small parts
    kept whole —, triangulated, its normals smoothed below 35°;
 4. per vertex: its loose part (a connected piece: a seat's cushion, a switch) — the part's size and a hash
    of it, for the shading's variations and the consoles' indicator lights.

Binary (little endian): "CKP0", u32 vertex count, u32 index count, then vertices (11 × f32: position 3,
normal 3, kind, part size [m], part hash 0…1, UV 2) and u32 indices.
"""
import bpy, bmesh, struct, sys, time, math

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
# triangles kept in all (the original's ~1.1 M after triangulation)
BUDGET = 300_000

# the kinds: (prefix, kind) — the first that matches the object's name
KINDS = [
    ("RaGlass", 71),
    ("RaScreens", 68),
    ("laptop", 67),
    ("RaFloor", 60),
    ("RaSideWall", 61), ("RaCeiling", 61), ("RaAirlock", 70), ("ChtAirlock", 70),
    ("RaNavigationConsole", 62), ("RaRearConsole", 62), ("RaSideConsole", 62), ("RaValve", 62), ("RaLightHandle", 62),
    ("RaNavigationSeat", 63),
    ("RaCryoPod", 64),
    ("RaBags", 65),
    ("RaHandle", 66), ("RaMetalBeam", 66),
    ("RaTarsPlatform", 69),
]

t0 = time.time()
def log(*a):
    print("##", f"{time.time() - t0:6.1f}s", *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=SRC, forward_axis="NEGATIVE_Z", up_axis="Y")
obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
log("imported", len(obs), "objects")

def kind_of(name):
    for p, k in KINDS:
        if name.startswith(p):
            return k
    return 62

total = sum(len(o.data.polygons) for o in obs)
verts, idx = [], []
for ob in obs:
    k = kind_of(ob.name)
    if k < 0:
        continue
    keep = k in (67, 68, 71)
    # (the share of the budget: the object's faces' share; the screens, laptops whole)
    ratio = 1.0 if keep else min(1.0, BUDGET / (2.0 * total))
    bpy.context.view_layer.objects.active = ob
    if ratio < 0.999:
        md = ob.modifiers.new("dec", "DECIMATE"); md.ratio = ratio; md.use_collapse_triangulate = True
    ob.modifiers.new("tri", "TRIANGULATE")
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    bm = bmesh.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    # loose parts: their faces, size, hash
    part = {}
    pid = 0
    for f in bm.faces:
        if f.index in part:
            continue
        stack = [f]; part[f.index] = pid
        while stack:
            g = stack.pop()
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in part:
                        part[h.index] = pid; stack.append(h)
        pid += 1
    lo = [[1e9] * 3 for _ in range(pid)]; hi = [[-1e9] * 3 for _ in range(pid)]
    for f in bm.faces:
        p = part[f.index]
        for v in f.verts:
            for c in range(3):
                lo[p][c] = min(lo[p][c], v.co[c]); hi[p][c] = max(hi[p][c], v.co[c])
    size = [math.dist(lo[p], hi[p]) for p in range(pid)]
    # normals: smoothed across edges flatter than 35° (per corner)
    uvl = bm.loops.layers.uv.active
    cosmax = math.cos(math.radians(35))
    key = {}
    base = len(verts)
    # (the flight sticks: the grips beside the front seats)
    stick = set()
    for q in range(pid):
        c = [(lo[q][i] + hi[q][i]) / 2 for i in range(3)]
        if abs(abs(c[0]) - 1.482) < 0.03 and abs(c[1] - 0.84) < 0.04 and abs(c[2] - 3.547) < 0.04 and 0.12 < hi[q][1] - lo[q][1] < 0.24:
            stick.add(q)
            log("stick", q, [round(x, 3) for x in lo[q]], [round(x, 3) for x in hi[q]])
    for f in bm.faces:
        p = part[f.index]
        kf = 72 if p in stick else k
        hsh = ((p * 2654435761 + hash(ob.name)) % 1000003) / 1000003.0
        fn = f.normal
        for lp in f.loops:
            v = lp.vert
            n = [0.0, 0.0, 0.0]
            for g in v.link_faces:
                if g.normal.dot(fn) >= cosmax:
                    a = g.calc_area()
                    n[0] += g.normal.x * a; n[1] += g.normal.y * a; n[2] += g.normal.z * a
            l = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
            n = (n[0] / l, n[1] / l, n[2] / l)
            uv = lp[uvl].uv if uvl else (0.0, 0.0)
            # (imported with the OBJ's own axes: y up, z the nose)
            pos = (v.co.x, v.co.y, v.co.z)
            nn = (n[0], n[1], n[2])
            kk = (v.index, round(nn[0], 3), round(nn[1], 3), round(nn[2], 3), round(uv[0], 4), round(uv[1], 4))
            vi = key.get(kk)
            if vi is None:
                vi = len(verts); key[kk] = vi
                verts.append((*pos, *nn, float(kf), size[p], hsh, uv[0], 1.0 - uv[1]))
            idx.append(vi)
    log(ob.name[:40], "kind", k, "parts", pid, "→", len(verts) - base, "vertices")
    bm.free(); ob.evaluated_get(dg).to_mesh_clear()

with open(OUT, "wb") as fo:
    fo.write(b"CKP0" + struct.pack("<II", len(verts), len(idx)))
    for v in verts:
        fo.write(struct.pack("<11f", *v))
    fo.write(struct.pack(f"<{len(idx)}I", *idx))
log("written", len(verts), "vertices,", len(idx) // 3, "triangles →", OUT)
