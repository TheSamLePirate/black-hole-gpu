"""
An AC3D node's polygons as triangles (docs/PLAN-A320.md, A1, A5): fanned, their corners' normals smoothed within the
node's crease angle (AC3D's: the faces about a vertex within it, area-weighted; flat faces their own), their UVs as the
file has them (v up). FlightGear's model frame (fgac.py). Pure Python + numpy.
"""
import math

import numpy as np


def triangles(geo):
    """→ None, or a dict: pos (n, 3, 3), nrm (n, 3, 3), uv (n, 3, 2), mat (n,) — the AC3D material's index —, flags (n,)."""
    if geo is None or not geo["surfs"]:
        return None
    V = geo["verts"]
    crease = math.radians(geo["crease"])
    tris = []
    for flags, mi, refs in geo["surfs"]:
        if len(refs) < 3:
            continue
        for k in range(1, len(refs) - 1):
            tris.append((flags, mi, (refs[0], refs[k], refs[k + 1])))
    if not tris:
        return None
    vi = np.array([[r[0] for r in t[2]] for t in tris])
    uv = np.array([[(r[1], r[2]) for r in t[2]] for t in tris], float)
    pos = V[vi]
    fn = np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0])
    area = np.linalg.norm(fn, axis=1)
    keep = area > 1e-12
    fnu = fn / np.maximum(area, 1e-30)[:, None]
    smooth = np.array([(t[0] & 0x10) != 0 for t in tris])
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
        acc = (fns @ fns.T >= cosc - 1e-6).astype(float) @ fn[fs]
        acc /= np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-30)
        for j, f in enumerate(fs):
            for c in range(3):
                if vi[f, c] == v:
                    nrm[f, c] = acc[j]
    mat = np.array([t[1] for t in tris])
    flags = np.array([t[0] for t in tris])
    out = {"pos": pos[keep], "nrm": nrm[keep], "uv": uv[keep], "mat": mat[keep], "flags": flags[keep]}
    # (the two-sided faces — AC3D's 0x20 —: their backs too, wound the other way, their normals turned)
    two = (out["flags"] & 0x20) != 0
    if two.any():
        rev = [0, 2, 1]
        out = {
            "pos": np.concatenate([out["pos"], out["pos"][two][:, rev]]),
            "nrm": np.concatenate([out["nrm"], -out["nrm"][two][:, rev]]),
            "uv": np.concatenate([out["uv"], out["uv"][two][:, rev]]),
            "mat": np.concatenate([out["mat"], out["mat"][two]]),
            "flags": np.concatenate([out["flags"], out["flags"][two]]),
        }
    return out


def dedupe(P, N, UV, M, PT):
    """Triangle corners → shared vertices (position, normal, UV, material, part) and indices."""
    corner = np.concatenate([P.reshape(-1, 3), N.reshape(-1, 3), UV.reshape(-1, 2), np.repeat(M, 3)[:, None], np.repeat(PT, 3)[:, None]], 1)
    key = np.round(corner * np.array([1e4] * 3 + [1e3] * 3 + [1e5] * 2 + [1, 1]))
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    V = corner[first]
    V[:, 3:6] /= np.maximum(np.linalg.norm(V[:, 3:6], axis=1, keepdims=True), 1e-12)
    return V, inv.reshape(-1).astype(np.uint32)


def bake_ao(V_P, V_N, tris_solid, rays=48, reach=3.0, seed=7):
    """Ambient occlusion per vertex (Blender's BVH: rays over each normal's hemisphere); 1 without Blender."""
    AO = np.ones(len(V_P), np.float32)
    try:
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
    except ImportError:
        return AO, False
    bvh = BVHTree.FromPolygons([tuple(p) for p in V_P], [tuple(t) for t in tris_solid], all_triangles=True)
    rng = np.random.default_rng(seed)
    dirs = rng.normal(size=(rays, 3))
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    for i in range(len(V_P)):
        n = V_N[i]
        o = Vector(V_P[i] + n * 0.002)
        hit = 0.0
        for d in dirs:
            if d @ n <= 0:
                d = -d
            loc, _, _, dist = bvh.ray_cast(o, Vector(d), reach)
            if loc is not None:
                hit += 1 - dist / reach
        AO[i] = 1 - hit / rays
    return AO, True
