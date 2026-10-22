"""
AC3D (.ac, "AC3Db") reader for the A320's FlightGear models (docs/PLAN-A320.md, A1) — pure Python + numpy, so
it runs in Blender's Python and in a plain one.

FlightGear loads an .ac file turned into its model frame: x aft, y right, z up (AC3D's y up):
    model = (ac.x, −ac.z, ac.y)
Everything this module returns is already in that frame.

A node: {name, kind ("world" | "poly" | "group"), verts (n × 3, model frame, the node's own loc/rot applied with
its parents'), texture, crease (deg), surfs: [(flags, mat, [(vertex, u, v), …])], kids: [node]}. Line surfaces
(SURF type 1, 2) are dropped; polygons stay polygons (the caller triangulates).
"""
import numpy as np

AC_TO_MODEL = np.array([[1.0, 0, 0], [0, 0, -1.0], [0, 1.0, 0]])


class Material:
    __slots__ = ("name", "rgb", "amb", "emis", "spec", "shi", "trans")

    def __init__(self, name, rgb, amb, emis, spec, shi, trans):
        self.name, self.rgb, self.amb, self.emis, self.spec, self.shi, self.trans = name, rgb, amb, emis, spec, shi, trans


def _tokens_material(line):
    # MATERIAL "name" rgb r g b  amb r g b  emis r g b  spec r g b  shi n  trans t
    q1 = line.index('"')
    q2 = line.index('"', q1 + 1)
    name = line[q1 + 1 : q2]
    t = line[q2 + 1 :].split()
    d = {}
    i = 0
    while i < len(t):
        k = t[i]
        if k in ("rgb", "amb", "emis", "spec"):
            d[k] = tuple(float(x) for x in t[i + 1 : i + 4])
            i += 4
        else:
            d[k] = float(t[i + 1])
            i += 2
    return Material(name, d.get("rgb", (1, 1, 1)), d.get("amb", (0.2,) * 3), d.get("emis", (0,) * 3), d.get("spec", (0,) * 3), d.get("shi", 0), d.get("trans", 0))


def read_ac(path):
    """→ (materials, root node). Coordinates in FlightGear's model frame (metres)."""
    with open(path, "r", encoding="latin-1") as f:
        lines = f.read().split("\n")
    pos = 0
    mats = []

    def nxt():
        nonlocal pos
        l = lines[pos]
        pos += 1
        return l

    head = nxt()
    if not head.startswith("AC3D"):
        raise ValueError("not an AC3D file: " + path)
    while lines[pos].startswith("MATERIAL"):
        mats.append(_tokens_material(nxt()))

    def read_object(parent_rot, parent_loc):
        kind = nxt().split()[1]
        node = {"name": "", "kind": kind, "verts": np.zeros((0, 3)), "texture": None, "crease": 61.0, "surfs": [], "kids": [], "texrep": (1.0, 1.0), "texoff": (0.0, 0.0)}
        rot = np.eye(3)
        loc = np.zeros(3)
        raw = None
        while True:
            l = nxt().strip()
            if not l:
                continue
            w = l.split(None, 1)
            k = w[0]
            if k == "name":
                node["name"] = w[1].strip().strip('"')
            elif k == "data":
                n = int(w[1])
                # (the data's n characters, on the next line(s))
                got = 0
                while got < n:
                    got += len(nxt()) + 1
            elif k == "texture":
                node["texture"] = w[1].strip().strip('"')
            elif k == "texrep":
                node["texrep"] = tuple(float(x) for x in w[1].split())
            elif k == "texoff":
                node["texoff"] = tuple(float(x) for x in w[1].split())
            elif k == "crease":
                node["crease"] = float(w[1])
            elif k == "rot":
                rot = np.array([float(x) for x in w[1].split()]).reshape(3, 3)
            elif k == "loc":
                loc = np.array([float(x) for x in w[1].split()])
            elif k == "url" or k == "subdiv" or k == "hidden" or k == "locked" or k == "folded":
                pass
            elif k == "numvert":
                n = int(w[1])
                raw = np.array([[float(x) for x in nxt().split()[:3]] for _ in range(n)]).reshape(-1, 3)
            elif k == "numsurf":
                n = int(w[1])
                for _ in range(n):
                    flags = int(nxt().split()[1], 0)
                    mat = 0
                    l2 = nxt().split()
                    if l2[0] == "mat":
                        mat = int(l2[1])
                        l2 = nxt().split()
                    nref = int(l2[1])
                    refs = []
                    for _r in range(nref):
                        t = nxt().split()
                        refs.append((int(t[0]), float(t[1]) if len(t) > 1 else 0.0, float(t[2]) if len(t) > 2 else 0.0))
                    if flags & 0x0F == 0:  # (a polygon; 1 closed line, 2 line strip)
                        node["surfs"].append((flags, mat, refs))
            elif k == "kids":
                n = int(w[1])
                # AC3D: a kid's rot/loc are relative to its parent (the full chain applies)
                R = parent_rot @ rot
                L = parent_rot @ loc + parent_loc
                if raw is not None and len(raw):
                    node["verts"] = (raw @ R.T + L) @ AC_TO_MODEL.T
                node["kids"] = [read_object(R, L) for _ in range(n)]
                return node
            else:
                raise ValueError(f"{path}:{pos}: unknown AC3D token {k!r}")

    root = read_object(np.eye(3), np.zeros(3))
    return mats, root


def walk(node, parent=None):
    """Every node with its parent, depth first."""
    yield node, parent
    for k in node["kids"]:
        yield from walk(k, node)


def by_name(root):
    """name → [nodes] (names repeat: FlightGear animates every node of a name)."""
    out = {}
    for n, _p in walk(root):
        if n["name"]:
            out.setdefault(n["name"], []).append(n)
    return out
