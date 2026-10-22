"""
The A320's flight model's data (docs/PLAN-A320.md, A3), read from FlightGear's A320-family (GPL v2 —
~/Documents/DEV/A320/flightgear-a320, not in the repository): JSBSim's own functions and tables, kept as they are,
evaluated by the game (src/a320/jsbsim.ts) — not rewritten by hand.

  python3 scripts/build-a320-data.py [path/to/flightgear-a320]      → src/a320/fdm-data.ts

  - the aerodynamics (FDE/Config/a320-aerodynamics.xml): each axis's coefficients — LIFT, DRAG, SIDE (wind axes),
    ROLL, PITCH, YAW (body) — and the ground effect's factors, as expression trees;
  - the metrics (a320-metrics.xml): the wing's area, span, chord; the reference points;
  - the masses (FDE/A320-200-CFM.xml): the empty weight and its centre, the inertias, the point masses, the tanks;
  - the engine (Engines/cfm56-5b4_1.xml): its constants, its idle and full ("military") thrust tables, its spool;
  - the FADEC (Systems/a320-cfm56-5b4-engine-fadec.xml): the thrust limits — TOGA, FLEX, MCT, CLB, IDLE, the max
    reverse — as N1 tables, the rated thrust's correction; the thrust levers' detents (A320-main.xml).

An expression: ["value", x] | ["prop", name] | ["table", Table] | [op, ...args] with op one of product, sum,
difference, quotient, pow, abs, toradians, todegrees, floor, min, max, ifthen, eq, nq, lt, le, gt, ge, and, or, not.
A Table: {"vars": [row, col?, table?], "rows": [...], "cols": [...]?, "data": [[...]] | [...], "pages": [{"bp": x,
"table": Table}]?} — JSBSim's lookups (linear between breakpoints, clamped at the ends).
"""
import json, os, re, sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FG = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/DEV/A320/flightgear-a320")
OUT = ROOT + "/src/a320/fdm-data.ts"


def nums(text):
    return [float(x) for x in text.split()]


def table(e):
    vars_ = [v.text.strip().lstrip("/") for v in e.findall("independentVar")]
    kinds = [v.get("lookup", "row") for v in e.findall("independentVar")]
    datas = e.findall("tableData")
    if not datas:
        raise ValueError("a table without data")

    def two(td, nvars):
        lines = [l for l in td.text.strip().split("\n") if l.strip()]
        if nvars == 1:
            rows, data = [], []
            for l in lines:
                a, b = nums(l)
                rows.append(a)
                data.append(b)
            return {"rows": rows, "data": data}
        cols = nums(lines[0])
        rows, data = [], []
        for l in lines[1:]:
            v = nums(l)
            rows.append(v[0])
            data.append(v[1:])
        return {"rows": rows, "cols": cols, "data": data}

    # (the variables in the order row, column, table — whatever their order in the file)
    order = {k: v for k, v in zip(kinds, vars_)}
    vs = [order.get("row"), order.get("column"), order.get("table")]
    vs = [v for v in vs if v]
    if len(datas) == 1 and "table" not in kinds:
        t = two(datas[0], len(vs))
        t["vars"] = vs
        return t
    pages = []
    for td in datas:
        p = two(td, 2)
        p["vars"] = vs[:2]
        pages.append({"bp": float(td.get("breakPoint")), "table": p})
    return {"vars": vs, "pages": pages}


OPS = {"product", "sum", "difference", "quotient", "pow", "abs", "toradians", "todegrees", "floor", "min", "max", "ifthen", "eq", "nq", "lt", "le", "gt", "ge", "and", "or", "not", "sqrt", "sin", "cos", "integer"}


def expr(e):
    t = e.tag
    if t == "value":
        return ["value", float(e.text)]
    if t == "property":
        return ["prop", e.text.strip().lstrip("/")]
    if t == "table":
        return ["table", table(e)]
    if t in OPS:
        return [t, *[expr(k) for k in e if k.tag != "description"]]
    if t == "function":
        kids = [k for k in e if k.tag != "description"]
        return expr(kids[0])
    raise ValueError("JSBSim op " + t)


def fn(e):
    kids = [k for k in e if k.tag != "description"]
    return {"name": e.get("name"), "expr": expr(kids[0])}


# ---- the aerodynamics
A = ET.parse(FG + "/FDE/Config/a320-aerodynamics.xml").getroot()
aero = {"functions": [fn(f) for f in A.findall("function")], "axes": {}}
for ax in A.findall("axis"):
    aero["axes"][ax.get("name")] = [fn(f) for f in ax.findall("function")]

# ---- the metrics, the masses
M = ET.parse(FG + "/FDE/Config/a320-metrics.xml").getroot()
FT = 0.3048


def unit(e, kind):
    u = (e.get("unit") or "").upper()
    v = float(e.text)
    if kind == "len":
        return v * FT if u in ("FT", "") else v
    if kind == "area":
        return v * FT * FT if u in ("FT2", "") else v
    return v


def loc(e):
    u = (e.get("unit") or "IN").upper()
    k = 0.0254 if u == "IN" else FT if u == "FT" else 1.0
    return [float(e.findtext(c)) * k for c in "xyz"]


metrics = {
    "S": unit(M.find("wingarea"), "area"),
    "b": unit(M.find("wingspan"), "len"),
    "c": unit(M.find("chord"), "len"),
}
for l in M.findall("location"):
    metrics[l.get("name")] = loc(l)
F = ET.parse(FG + "/FDE/A320-200-CFM.xml").getroot()
mb = F.find("mass_balance")
SLUGFT2 = 1.3558179
LB = 0.45359237
mass = {
    "Ixx": float(mb.findtext("ixx")) * SLUGFT2,
    "Iyy": float(mb.findtext("iyy")) * SLUGFT2,
    "Izz": float(mb.findtext("izz")) * SLUGFT2,
    "empty": float(mb.findtext("emptywt")) * LB,
    "cg": loc(mb.find("location")),
    "points": [{"name": p.get("name"), "kg": float(p.findtext("weight")) * LB, "at": loc(p.find("location"))} for p in mb.findall("pointmass")],
}
tanks = []
for t in F.find("propulsion").findall("tank"):
    tanks.append({"type": t.get("type"), "at": loc(t.find("location")), "capacityKg": float(t.findtext("capacity")) * LB, "kg": float(t.findtext("contents") or 0) * LB})
engines = []
for e in F.find("propulsion").findall("engine"):
    th = e.find("thruster")
    engines.append({"file": e.get("file"), "at": loc(th.find("location")), "feed": [int(x.text) for x in e.findall("feed")]})

# ---- the engine
E = ET.parse(FG + "/Engines/cfm56-5b4_1.xml").getroot()
engine = {k: float(E.findtext(k)) for k in ("milthrust", "tsfc", "idlen1", "idlen2", "maxn1", "maxn2", "n1spinup", "n2spinup", "n1spindown", "n2spindown", "ignitionn1", "ignitionn2", "n1startrate", "n2startrate")}
for f in E.findall("function"):
    engine[f.get("name")] = fn(f)["expr"]

# ---- the FADEC's limits
X = ET.parse(FG + "/Systems/a320-cfm56-5b4-engine-fadec.xml").getroot()
fadec = {}
want = ["rated-thrust-n1", "milthrust-no-density", "milthrust-density", "toga-table", "flex-table", "mct-table", "climb-table", "idle-table", "mrev-table"]
for f in X.iter("fcs_function"):
    n = f.get("name").split("/")[-1]
    if n in want:
        fadec[n] = expr(f.find("function"))
# (the detents: A320-main.xml's configurable ones)
MAIN = ET.parse(FG + "/A320-main.xml").getroot()
det = MAIN.find("systems/acconfig/options/fadec")
detents = {c.tag: float(c.text) for c in det}

data = {
    "source": "FlightGear A320-family (legoboyvdlp/A320-family, GPL v2): FDE/Config/a320-aerodynamics.xml, a320-metrics.xml, FDE/A320-200-CFM.xml, Engines/cfm56-5b4_1.xml, Systems/a320-cfm56-5b4-engine-fadec.xml, A320-main.xml",
    "metrics": metrics,
    "mass": mass,
    "tanks": tanks,
    "engines": engines,
    "engine": engine,
    "fadec": fadec,
    "detents": detents,
    "aero": aero,
}
body = json.dumps(data, separators=(",", ":"))
with open(OUT, "w") as o:
    o.write(
        "// GENERATED by scripts/build-a320-data.py from FlightGear's A320-family (GPL v2: assets/a320/README.md) — do not edit.\n"
        "// JSBSim's aerodynamics, masses, engine and FADEC tables as expression trees (src/a320/jsbsim.ts evaluates them).\n"
        "import type { FdmData } from \"./jsbsim\";\n\n"
        "export const FDM: FdmData = " + body + ";\n"
    )
print(OUT, os.path.getsize(OUT) // 1024, "kB;", {k: len(v) for k, v in aero["axes"].items()}, "fadec", list(fadec), "tanks", len(tanks))
