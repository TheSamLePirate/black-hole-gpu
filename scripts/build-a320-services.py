#!/usr/bin/env python3
"""The A320's ground vehicles (docs/PLAN-A320.md, A14): FlightGear's Models/Services (GPL v2 — the pushback tug from
XPGoodWay's, the stairs, the external power box, the fuel truck, the catering loader stowed and raised, the chocks,
the de-icing truck, the baggage belt loader) turned into the traffic's mesh format for ship.ts (scripts/build-
airliners.ts: "TRFC" v1) — each in its own frame, the ship's axes (x left, y up, z forward), metres; their textures
sampled at each face's middle into the vertex's colour (material 90: the colour packed in the UV, as the carriers'
flat parts — ship.wgsl), so no map is needed. A face's vertices shared with its neighbours of the same colour and about the same normal.

    python3 scripts/build-a320-services.py [~/Documents/DEV/A320/flightgear-a320]
"""

import os
import struct
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "a320"))
from fgac import read_ac  # noqa: E402

ROOT = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/Documents/DEV/A320/flightgear-a320")
SRV = os.path.join(ROOT, "Models", "Services")
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "traffic")

# (FlightGear's model frame — x aft, y right, z up — to the ship's axes: x left, y up, z forward)
FG2SHIP = np.array([[0, -1.0, 0], [0, 0, 1.0], [-1.0, 0, 0]])

# (the catering loader's box — its cargo_box_all group, L_T_VolvoFM-4_5m-set.xml — apart: it rises 3.11 m to the
# door; the stairs' cover and the fuel truck's stowed hose left out: shown by FlightGear on their own options)
CATER_BOX = {"cargo_box", "warning_light_glass", "warning", "platform", "arm_top", "Lights_side"}
MODELS = {
    "gs-tug": ("Pushback/Douglas.ac", None, set()),
    "gs-stairs": ("Stairs/stairs.ac", None, {"cover", "cover-under", "cover-rods"}),
    "gs-gpu": ("External-Power/ext-pwr-box.ac", None, set()),
    "gs-fuel": ("Fuel-Truck/Fuel_Truck_Short_VolvoFM.ac", None, {"fuel_pipe_disconnected"}),
    "gs-catering": ("Catering/Catering_Loader_Truck_VolvoFM-stowed.ac", None, CATER_BOX),
    "gs-catering-box": ("Catering/Catering_Loader_Truck_VolvoFM-stowed.ac", CATER_BOX, set()),
    "gs-chock-nose": ("Chocks/chock_nose.ac", None, set()),
    "gs-chock-left": ("Chocks/chock_left.ac", None, set()),
    "gs-chock-right": ("Chocks/chock_right.ac", None, set()),
    "gs-deice": ("De-Icing/volvo_deicing_truck.ac", None, set()),
    "gs-belt": ("Baggage/cargo_ramp.ac", None, set()),
}


def nodes(node, names=()):
    """every node with its own and its ancestors' names"""
    here = names + ((node["name"],) if node["name"] else ())
    yield node, set(here)
    for k in node["kids"]:
        yield from nodes(k, here)

_images = {}


def image(folder, name):
    path = os.path.join(folder, name)
    if path not in _images:
        _images[path] = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0 if os.path.exists(path) else None
    return _images[path]


def sample(img, u, v):
    h, w = img.shape[:2]
    x = int((u % 1.0) * w) % w
    y = int((1.0 - (v % 1.0)) * h) % h
    return img[y, x]


def build(name, rel, only, skip):
    path = os.path.join(SRV, rel)
    mats, root = read_ac(path)
    folder = os.path.dirname(path)
    verts, idx, keys = [], [], {}
    for node, names in nodes(root):
        if (only is not None and not names & only) or names & skip:
            continue
        V = node["verts"]
        if not len(V) or not node["surfs"]:
            continue
        img = image(folder, node["texture"]) if node["texture"] else None
        ru, rv = node["texrep"]
        ou, ov = node["texoff"]
        for _flags, mat, refs in node["surfs"]:
            if len(refs) < 3:
                continue
            P = np.array([V[r[0]] for r in refs]) @ FG2SHIP.T
            # (its colour: the texture at the face's middle and corners, else its material's)
            if img is not None:
                uv = [(r[1] * ru + ou, r[2] * rv + ov) for r in refs]
                mu = sum(u for u, _ in uv) / len(uv)
                mv = sum(v for _, v in uv) / len(uv)
                cs = [sample(img, mu, mv)] + [sample(img, u, v) for u, v in uv[:4]]
                c = np.mean(cs, axis=0)
                if mats and mat < len(mats):
                    c = c * np.asarray(mats[mat].rgb, float)
            else:
                c = np.asarray(mats[mat].rgb if mats and mat < len(mats) else (0.6, 0.6, 0.6), float)
            # (quantized a little: neighbouring faces of a painted panel share their vertices)
            c8 = tuple(min(int(round(min(max(x, 0.0), 1.0) * 255 / 12)) * 12, 255) for x in c)
            # (a fan of triangles; its normal from the polygon)
            n = np.zeros(3)
            for k in range(1, len(P) - 1):
                n += np.cross(P[k] - P[0], P[k + 1] - P[0])
            ln = np.linalg.norm(n)
            if ln < 1e-12:
                continue
            n /= ln
            nk = tuple(np.round(n * 2.0).astype(int))
            ids = []
            for p in P:
                key = (tuple(np.round(p, 4)), c8, nk)
                if key not in keys:
                    keys[key] = len(verts)
                    verts.append([p, np.zeros(3), c8])
                verts[keys[key]][1] += n * ln
                ids.append(keys[key])
            # (two-sided: FlightGear draws AC3D's surfaces both sides unless flagged — the trucks' thin panels)
            for k in range(1, len(ids) - 1):
                idx += [ids[0], ids[k], ids[k + 1]]
    pos = np.array([v[0] for v in verts], np.float32)
    lo, hi = pos.min(0), pos.max(0)
    buf = bytearray(b"TRFC")
    buf += struct.pack("<III", 1, len(verts), len(idx))
    buf += struct.pack("<6f", *lo, *hi)
    for p, nn, c8 in verts:
        nn = nn / (np.linalg.norm(nn) or 1)
        # (material 90: the colour in the UV — r + 256 g in u, b / 255 in v; sRGB as ship.wgsl decodes it)
        buf += struct.pack("<10f", *p, *nn, 90.0, 1.0, c8[0] + 256.0 * c8[1], c8[2] / 255.0)
    buf += struct.pack(f"<{len(idx)}I", *idx)
    with open(os.path.join(OUT, name + ".bin"), "wb") as f:
        f.write(buf)
    print(f"{name}: {len(verts)} vertices, {len(idx) // 3} triangles, {len(buf) / 1024:.0f} kB, {np.round(hi - lo, 2)} m, lo {np.round(lo, 2)}")


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (rel, only, skip) in MODELS.items():
        build(name, rel, only, skip)


if __name__ == "__main__":
    main()
