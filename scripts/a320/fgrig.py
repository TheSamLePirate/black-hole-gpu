"""
FlightGear's model animations, as the A320's XML files write them (docs/PLAN-A320.md, A1): read, installed in a
scene graph the way SimGear installs them, evaluated for a set of property values. Pure Python + numpy.

SimGear's rules kept here:
  - each <animation> becomes one group node spliced between the named nodes and their parent (per parent; the
    children are traversed first), so an object's animations listed first are the OUTERMOST (applied last);
  - an animation without a type but with a <name> only groups its objects under that name (later animations may
    name the group);
  - rotate: about <axis> through <center>, or the axis from (x1, y1, z1) to (x2, y2, z2); angle = factor × value +
    offset-deg, or the <interpolation> table; the right-hand rule; translate: along the normalised <axis>;
    spin: about an axis through a centre (its angle is the game's: rpm × time);
  - locked-track (SGTrackToAnimation): the node turns about <lock-axis> through <center> so that its track axis
    points at the target's centre (taken through the target's own transforms); with a <slave-center> the node and
    its slave are a two-link chain reaching the target: root = atan2 in the (track, up) frame − B0 + SSS(a, d, s),
    slave = SSS(a, s, d) − SSS(a, s, d0), about the lock axis through the slave's centre (in the slave's parent's
    frame);
  - select: shown while its <condition> holds.

The graph's animation nodes are what the game evaluates (src/a320/rig.ts): build-a320.py writes them as JSON.
"""
import math
import xml.etree.ElementTree as ET

import numpy as np

# ---------------------------------------------------------------------------------------------------- reading


def _f(e, tag, default=None):
    t = e.findtext(tag)
    return float(t) if t is not None and t.strip() != "" else default


def _vec(e, prefix=""):
    if e is None:
        return None
    x, y, z = _f(e, prefix + "x", None), _f(e, prefix + "y", None), _f(e, prefix + "z", None)
    if x is None and y is None and z is None:
        x, y, z = _f(e, prefix + "x-m", None), _f(e, prefix + "y-m", None), _f(e, prefix + "z-m", None)
        if x is None and y is None and z is None:
            return None
    return np.array([x or 0.0, y or 0.0, z or 0.0])


def _condition(e):
    """A <condition> → a small expression: ["prop", path] | ["val", x] | [op, a, b] | ["not", c] | ["and"/"or", …]."""
    if e is None:
        return None
    kids = list(e)
    if e.tag == "condition" or e.tag == "and":
        cs = [_condition(k) for k in kids]
        return cs[0] if len(cs) == 1 and e.tag == "condition" else ["and", *cs]
    if e.tag == "or":
        return ["or", *[_condition(k) for k in kids]]
    if e.tag == "not":
        return ["not", _condition(kids[0])]
    if e.tag == "property":
        return ["prop", e.text.strip()]
    if e.tag == "value":
        return ["val", float(e.text)]
    if e.tag in ("greater-than", "less-than", "greater-than-equals", "less-than-equals", "equals", "not-equals"):
        a, b = [_condition(k) for k in kids[:2]]
        return [e.tag, a, b]
    raise ValueError("condition tag " + e.tag)


def read_animations(path):
    """The <animation>s of a model XML file, in order, as dicts."""
    root = ET.parse(path).getroot()
    out = []
    for a in root.findall("animation"):
        t = (a.findtext("type") or "").strip()
        objs = [o.text.strip() for o in a.findall("object-name") if o.text]
        an = {"type": t or "group", "name": (a.findtext("name") or "").strip(), "objects": objs}
        prop = a.findtext("property")
        if prop:
            an["property"] = prop.strip().lstrip("/")
        an["factor"] = _f(a, "factor", 1.0)
        an["offset"] = _f(a, "offset-deg", _f(a, "offset-m", 0.0))
        lo, hi = _f(a, "min-deg", _f(a, "min-m", None)), _f(a, "max-deg", _f(a, "max-m", None))
        if lo is not None:
            an["min"] = lo
        if hi is not None:
            an["max"] = hi
        tab = [(float(e.findtext("ind")), float(e.findtext("dep"))) for e in a.findall("interpolation/entry")]
        if tab:
            an["table"] = tab
        cond = a.find("condition")
        if cond is not None:
            an["condition"] = _condition(cond)
        ax = a.find("axis")
        if ax is not None and ax.find("x1-m") is not None:
            p1 = np.array([_f(ax, "x1-m"), _f(ax, "y1-m"), _f(ax, "z1-m")])
            p2 = np.array([_f(ax, "x2-m"), _f(ax, "y2-m"), _f(ax, "z2-m")])
            an["center"], an["axis"] = p1, p2 - p1
        else:
            an["axis"] = _vec(ax)
            an["center"] = _vec(a.find("center"))
        if t == "locked-track":
            an["lock"] = _vec(a.find("lock-axis"))
            an["track"] = _vec(a.find("track-axis"))
            an["target"] = a.findtext("target-name").strip()
            an["target_center"] = _vec(a.find("target-center"))
            sc = _vec(a.find("slave-center"))
            if sc is not None:
                an["slave_center"] = sc
            sn = a.findtext("slave-name")
            if sn:
                an["slave"] = sn.strip()
        out.append(an)
    return out


# ---------------------------------------------------------------------------------------------------- the graph


class Node:
    __slots__ = ("name", "anim", "kids", "parent", "geom", "id", "M", "slave_of")

    def __init__(self, name, anim=None, geom=None):
        self.name, self.anim, self.geom = name, anim, geom
        self.kids, self.parent, self.id, self.M, self.slave_of = [], None, -1, None, None

    def add(self, k):
        k.parent = self
        self.kids.append(k)


def graph_from_ac(ac_root):
    """The AC file's nodes as a scene graph (geometry kept on each node)."""

    def mk(n):
        g = Node(n["name"], geom=n)
        for k in n["kids"]:
            g.add(mk(k))
        return g

    return mk(ac_root)


def _install(anim, group, created):
    """SimGear's SGAnimation::apply on `group`: children first, then the matching children spliced (once per
    parent) under one new animation node."""
    for k in list(group.kids):
        _install(anim, k, created)
    names = anim["objects"]
    matched = [k for k in group.kids if k.name in names and k.anim is not anim]
    if not matched:
        return
    # (the order of the object names is kept, as SimGear does)
    matched.sort(key=lambda k: names.index(k.name))
    an = Node(anim["name"] if anim["type"] == "group" else "", anim=anim)
    at = group.kids.index(matched[0])
    for k in matched:
        group.kids.remove(k)
    group.kids.insert(at, an)
    an.parent = group
    for k in matched:
        an.add(k)
    created.append(an)


def install(root, anims):
    """Every animation installed in order; → the animation nodes created, per animation."""
    made = []
    for a in anims:
        created = []
        _install(a, root, created)
        made.append(created)
    # (locked-track slaves: a node spliced above the slave group, in its parent; set by its master)
    for a, nodes in zip(anims, made):
        if a["type"] != "locked-track" or "slave" not in a:
            continue
        for master in nodes:
            for s in find(root, a["slave"]):
                sl = Node("", anim={"type": "slave", "objects": [a["slave"]]})
                p = s.parent
                i = p.kids.index(s)
                p.kids[i] = sl
                sl.parent = p
                sl.add(s)
                sl.slave_of = master
                master.slave_of = sl  # (the master knows its slave node)
    return made


def find(root, name):
    out = []

    def rec(n):
        if n.name == name:
            out.append(n)
        for k in n.kids:
            rec(k)

    rec(root)
    return out


# ---------------------------------------------------------------------------------------------------- maths


def rot_about(center, axis, ang):
    """4 × 4: a turn by `ang` (rad, right hand) about the line through `center` along `axis`."""
    a = np.asarray(axis, float)
    a = a / (np.linalg.norm(a) or 1.0)
    x, y, z = a
    c, s, t = math.cos(ang), math.sin(ang), 1 - math.cos(ang)
    R = np.array([[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]])
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = center - R @ center
    return M


def trans(d):
    M = np.eye(4)
    M[:3, 3] = d
    return M


def lookup(tab, x):
    if x <= tab[0][0]:
        return tab[0][1]
    for (x0, y0), (x1, y1) in zip(tab, tab[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0) if x1 != x0 else y1
    return tab[-1][1]


def value(a, props):
    v = props.get(a.get("property", ""), 0.0)
    if "table" in a:
        r = lookup(a["table"], v)
    else:
        r = v * a["factor"] + a["offset"]
    if "min" in a:
        r = max(r, a["min"])
    if "max" in a:
        r = min(r, a["max"])
    return r


def cond(c, props):
    if c is None:
        return True
    op = c[0]
    if op == "prop":
        return props.get(c[1], 0.0)
    if op == "val":
        return c[1]
    if op == "not":
        return not cond(c[1], props)
    if op == "and":
        return all(cond(k, props) for k in c[1:])
    if op == "or":
        return any(cond(k, props) for k in c[1:])
    a, b = cond(c[1], props), cond(c[2], props)
    return {"greater-than": a > b, "less-than": a < b, "greater-than-equals": a >= b, "less-than-equals": a <= b, "equals": a == b, "not-equals": a != b}[op]


def sss(p, q, r):
    """The angle between sides p and q, opposite r (clamped)."""
    c = (p * p + q * q - r * r) / (2 * p * q)
    return math.pi if c <= -1 else 0.0 if c >= 1 else math.acos(c)


class Track:
    """SGTrackToAnimation's constants for one locked-track animation."""

    def __init__(self, a):
        N, T = a["center"], a["target_center"]
        L = a["lock"] if a.get("lock") is not None else np.array([0.0, 1.0, 0.0])
        L = L / (np.linalg.norm(L) or 1)
        S = a.get("slave_center")
        self.N, self.T, self.L, self.S = N, T, L, S
        if S is not None:
            self.a = np.linalg.norm(S - N)
            self.s = np.linalg.norm(T - S)
            d = np.linalg.norm(T - N)
            self.B0 = sss(self.a, d, self.s)
            self.sigma0 = sss(self.a, self.s, d) - math.pi
            t = T - N
        else:
            self.B0 = 0.0
            t = a["track"] if a.get("track") is not None else T - N
        t = t - L * (t @ L)
        if np.linalg.norm(t) < 1e-9:
            t = np.array([1.0, 0, 0]) if abs(L[0]) < 0.1 else np.array([0, 1.0, 0])
        self.t = t / np.linalg.norm(t)
        self.u = np.cross(L, self.t)

    def angles(self, target_local):
        """→ (root angle, slave angle) for the target's centre in the node's frame."""
        d = target_local - self.N
        dist = np.linalg.norm(d)
        dp = d - self.L * (d @ self.L)
        root = -self.B0 + math.atan2(dp @ self.u, dp @ self.t)
        slave = -self.sigma0 if self.S is not None else 0.0
        if self.S is not None and dist < self.a + self.s:
            root += sss(self.a, dist, self.s)
            slave = sss(self.a, self.s, dist) - math.pi - self.sigma0
        return root, slave


def evaluate(root, props, spins=None, iterations=4):
    """Every node's world matrix (4 × 4, node.M) for the property values (and the spin angles by property, rad)."""
    spins = spins or {}
    tracks = {}
    lt = {}  # (locked-track node id → (root angle, slave angle))

    def local(n):
        a = n.anim
        if a is None:
            return np.eye(4)
        t = a["type"]
        if t == "rotate":
            return rot_about(a["center"] if a["center"] is not None else np.zeros(3), a["axis"], math.radians(value(a, props)))
        if t == "translate":
            ax = a["axis"]
            ax = ax / (np.linalg.norm(ax) or 1)
            return trans(ax * value(a, props))
        if t == "spin":
            return rot_about(a["center"] if a["center"] is not None else np.zeros(3), a["axis"], spins.get(a.get("property", ""), 0.0))
        if t == "select":
            return np.eye(4) if cond(a.get("condition"), props) else np.zeros((4, 4))
        if t == "locked-track":
            ang = lt.get(id(n), (0.0, 0.0))[0]
            return rot_about(a["center"], tracks[id(n)].L, ang)
        if t == "slave":
            m = n.slave_of
            ang = lt.get(id(m), (0.0, 0.0))[1]
            tr = tracks[id(m)]
            return rot_about(tr.S, tr.L, ang)
        return np.eye(4)

    def walk(n, W):
        n.M = W @ local(n)
        for k in n.kids:
            walk(k, n.M)

    lts = []

    def collect(n):
        if n.anim is not None and n.anim["type"] == "locked-track":
            tracks[id(n)] = Track(n.anim)
            lts.append(n)
        for k in n.kids:
            collect(k)

    collect(root)
    targets = {id(n): find(root, n.anim["target"]) for n in lts}
    for _ in range(iterations):
        walk(root, np.eye(4))
        for n in lts:
            tg = targets[id(n)]
            if not tg:
                continue
            Tw = tg[0].M @ np.append(n.anim["target_center"], 1.0)
            P = n.parent.M
            Pinv = np.linalg.pinv(P)
            tl = (Pinv @ Tw)[:3]
            lt[id(n)] = tracks[id(n)].angles(tl)
    walk(root, np.eye(4))
    return root
