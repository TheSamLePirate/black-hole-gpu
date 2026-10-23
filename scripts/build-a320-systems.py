"""
The A320's systems (docs/PLAN-A320.md, A10), read from FlightGear's A320-family (GPL v2 — ~/Documents/DEV/A320/
flightgear-a320, not in the repository): its JSBSim system files kept as they are — their channels, their components in
order, their tests and functions — and run by the game (src/a320/systems/jsbsys.ts) on the property bag the deck shares
(src/a320/systems/types.ts); not rewritten by hand.

  python3 scripts/build-a320-systems.py [path/to/flightgear-a320]      → src/a320/systems/sysdata.json, inputs.md

  - the systems, in the FDE's order (FDE/A320-200-CFM.xml): fuel, electrical, hydraulic, pneumatic, aircond, ignition,
    lights, indicators, engine-fire, adr, apu, oxygen, misc — the flight controls', the FADEC's, the FMGC's, the FWC's
    left out (the game's own: src/a320/fbw.ts, fadec.ts, fmgc/);
  - each component: switch, fcs_function, actuator, pure_gain, sensor, lag_filter, washout_filter, summer, kinematic,
    scheduled_gain — its inputs (a "-" negating one), its outputs (its name's property, then its <output>s), its
    clipto, its own parameters;
  - the <property> declarations with their values.

Every property path as the bag keys it: no leading "/", an index [0] dropped; JSBSim's relative paths (no leading "/")
under "fdm/jsbsim/"; a component named without a "/" under "fdm/jsbsim/fcs/" (JSBSim's FGFCSComponent).

A value (V): a number, or {"p": path} (a property), {"p": path, "neg": true} negated.
A condition: ["and" | "or", ...conditions] (JSBSim's test logic, AND when not said) or ["cmp", op, V, V] with op one of
eq ne lt le gt ge.
An expression: as src/a320/jsbsim.ts's — ["value", x] | ["prop", path] | ["table", Table] | [op, ...args] — with the
system files' own ops too: switch, interpolate1d, log10.
"""
import json, os, re, sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FG = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/DEV/A320/flightgear-a320")
OUT = ROOT + "/src/a320/systems/sysdata.json"
KEEP = ["fuel", "electrical", "hydraulic", "pneumatic", "aircond", "ignition", "lights", "indicators", "engine-fire", "adr", "apu", "oxygen", "misc"]


def path(p):
    """A property's path as the bag keys it."""
    p = p.strip()
    if p.startswith("/"):
        p = p[1:]
    else:
        p = "fdm/jsbsim/" + p
    return re.sub(r"\[0\]", "", p)


def comp_name(n):
    """A component's own property (FGFCSComponent: a name without "/" under fcs/)."""
    n = n.strip()
    if "/" not in n:
        return path("fcs/" + n.lower().replace(" ", "-"))
    return path(n)


def num_or_prop(s):
    s = (s or "").strip()
    try:
        return float(s)
    except ValueError:
        neg = s.startswith("-")
        q = {"p": path(s[1:] if neg else s)}
        if neg:
            q["neg"] = True
        return q


def nums(text):
    return [float(x) for x in text.split()]


def table(e):
    vars_ = [path(v.text) for v in e.findall("independentVar")]
    kinds = [v.get("lookup", "row") for v in e.findall("independentVar")]
    datas = e.findall("tableData")

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

    order = {k: v for k, v in zip(kinds, vars_)}
    vs = [v for v in (order.get("row"), order.get("column"), order.get("table")) if v]
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


def expr(e):
    t = e.tag
    if t in ("value", "v"):
        return ["value", float(e.text)]
    if t in ("property", "p"):
        s = e.text.strip()
        if s.startswith("-"):
            return ["product", ["value", -1.0], ["prop", path(s[1:])]]
        return ["prop", path(s)]
    if t == "table":
        return ["table", table(e)]
    if t == "function":
        kids = list(e)
        return expr(kids[0])
    return [t] + [expr(k) for k in e]


def cond_lines(text):
    out = []
    for l in (text or "").split("\n"):
        l = l.strip()
        if not l:
            continue
        a, op, b = l.split()
        # (JSBSim's words in either case: the FWC's file has an "NE")
        op = {"==": "eq", "!=": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge"}.get(op, op.lower())
        out.append(["cmp", op, num_or_prop(a), num_or_prop(b)])
    return out


def cond(e):
    """A test's (or a <condition>'s) logic tree: its lines and its nested tests."""
    logic = (e.get("logic") or "AND").lower()
    parts = cond_lines(e.text)
    for k in e:
        if k.tag in ("test", "condition"):
            parts.append(cond(k))
        parts += cond_lines(k.tail)
    return [logic] + parts


def clip(c):
    k = c.find("clipto")
    if k is None:
        return None
    return [num_or_prop(k.findtext("min")), num_or_prop(k.findtext("max"))]


def inputs(c):
    return [num_or_prop(i.text) for i in c.findall("input")]


def component(c):
    t = c.tag
    o = {"out": [comp_name(c.get("name"))] + [path(x.text) for x in c.findall("output")]}
    cl = clip(c)
    if cl:
        o["clip"] = cl
    ins = inputs(c)
    if t == "switch":
        o["t"] = "switch"
        d = c.find("default")
        # (FlightGear's own typo "defualt": JSBSim ignores it — the default 0)
        o["default"] = num_or_prop(d.get("value")) if d is not None else 0.0
        o["tests"] = [{"value": num_or_prop(x.get("value")), "cond": cond(x)} for x in c.findall("test")]
    elif t == "fcs_function":
        o["t"] = "fn"
        o["expr"] = expr(c.find("function"))
    elif t == "actuator":
        o["t"] = "act"
        o["in"] = ins[0]
        for r in c.findall("rate_limit"):
            v = num_or_prop(r.text)
            s = r.get("sense")
            if s in (None, "incr"):
                o["incr"] = v
            if s in (None, "decr"):
                o["decr"] = v
        for k in ("lag", "bias", "hysteresis_width", "deadband_width"):
            if c.find(k) is not None:
                o[k] = num_or_prop(c.findtext(k))
    elif t == "pure_gain":
        o["t"] = "gain"
        o["in"] = ins[0]
        o["gain"] = num_or_prop(c.findtext("gain") or "1")
    elif t == "scheduled_gain":
        o["t"] = "sgain"
        o["in"] = ins[0]
        o["table"] = table(c.find("table"))
        if c.find("gain") is not None:
            o["gain"] = num_or_prop(c.findtext("gain"))
    elif t == "summer":
        o["t"] = "sum"
        o["ins"] = ins
        o["bias"] = num_or_prop(c.findtext("bias") or "0")
    elif t in ("lag_filter", "washout_filter"):
        o["t"] = "lag" if t == "lag_filter" else "washout"
        o["in"] = ins[0]
        o["c1"] = num_or_prop(c.findtext("c1"))
    elif t == "sensor":
        o["t"] = "sensor"
        o["in"] = ins[0]
        q = c.find("quantization")
        if q is not None:
            o["quant"] = [float(q.findtext("bits")), float(q.findtext("min")), float(q.findtext("max"))]
        if c.find("lag") is not None:
            o["lag"] = num_or_prop(c.findtext("lag"))
    elif t == "kinematic":
        o["t"] = "kin"
        o["in"] = ins[0]
        o["settings"] = [[float(s.findtext("position")), float(s.findtext("time"))] for s in c.find("traverse").findall("setting")]
        o["noscale"] = c.find("noscale") is not None
    else:
        raise ValueError(f"component {t}")
    return o


systems = []
props = []
for name in KEEP:
    f = f"{FG}/Systems/a320-{name}.xml"
    r = ET.parse(f).getroot()
    for p in r.findall("property"):
        v = p.get("value")
        props.append([path(p.text), float(v) if v is not None else 0.0])
    chans = []
    for ch in r.findall("channel"):
        chans.append({"name": ch.get("name", ""), "rate": int(ch.get("execrate", "1")), "comps": [component(c) for c in ch]})
    systems.append({"name": r.get("name", name), "file": f"Systems/a320-{name}.xml", "channels": chans})



def touched(o, acc):
    """Every property the systems read or write."""
    if isinstance(o, dict):
        if "p" in o:
            acc.add(o["p"])
        for k, v in o.items():
            if k in ("out", "vars"):
                acc.update(v)
            else:
                touched(v, acc)
    elif isinstance(o, list):
        if len(o) == 2 and o[0] == "prop":
            acc.add(o[1])
        for v in o:
            touched(v, acc)


def tree(e, at, out):
    """The -set file's property tree's leaves: path → value (a number, a bool as 0/1; strings left out)."""
    seen = {}
    for k in e:
        if not isinstance(k.tag, str):
            continue
        i = int(k.get("n")) if k.get("n") is not None else seen.get(k.tag, 0)
        seen[k.tag] = i + 1
        p = at + k.tag + (f"[{i}]" if i else "")
        if len(k):
            tree(k, p + "/", out)
            continue
        t, v = k.get("type"), (k.text or "").strip()
        if t == "bool" or v in ("true", "false"):
            out[p] = 1.0 if v in ("1", "true") else 0.0
        elif t in (None, "double", "int", "float", "long"):
            try:
                out[p] = float(v)
            except ValueError:
                pass


# (the initial values the -set files give the properties the systems touch — the batteries' charge, the switches'
# positions…: FlightGear's property tree before the first frame)
used = set()
touched(systems, used)
init = {}
for f in ("A320-main.xml", "A320-200-CFM-set.xml"):
    tree(ET.parse(f"{FG}/{f}").getroot(), "", init)
declared = {k for k, _ in props}
props = [[k, v] for k, v in sorted(init.items()) if k in used and k not in declared] + props

data = {
    "source": "FlightGear A320-family (legoboyvdlp/A320-family, GPL v2): Systems/a320-{" + ",".join(KEEP) + "}.xml",
    "props": props,
    "systems": systems,
}


# ---- What the systems read and nothing in them writes: the inputs the game sets (src/a320/systems/inputs.md)
def reads(o, acc):
    if isinstance(o, dict):
        if "p" in o:
            acc.add(o["p"])
        for k, v in o.items():
            if k == "vars":
                acc.update(v)
            elif k != "out":
                reads(v, acc)
    elif isinstance(o, list):
        if len(o) == 2 and o[0] == "prop":
            acc.add(o[1])
        for v in o:
            reads(v, acc)


written, readers = set(), {}
for sy in systems:
    for ch in sy["channels"]:
        for c in ch["comps"]:
            written.update(c["out"])
            r = set()
            reads(c, r)
            for k in r:
                readers.setdefault(k, set()).add(sy["name"].replace("A320: ", "").rstrip(":"))
# (the channel's step: jsbsys.ts's own, as JSBSim's)
written.add("fdm/jsbsim/simulation/channel-dt")
ext = sorted(k for k in readers if k not in written)
initial = dict((k, v) for k, v in props)
n_ext = len(ext)

# (who sets each one in FlightGear: its Nasal — the other half of A10 —, else the FDM, the deck, an option)
nasal = {}
for d, _, fs in os.walk(FG + "/Nasal"):
    for f in fs:
        if f.endswith(".nas"):
            nasal[os.path.relpath(d + "/" + f, FG + "/Nasal")] = open(d + "/" + f, errors="replace").read()


# (and the system files not run here — the FWC's, the FMGC's, the FBW's, the property rules —, by a component's name or
# an <output>)
for f in os.listdir(FG + "/Systems"):
    if f.endswith(".xml") and f[5:-4] not in KEEP:
        t = open(FG + "/Systems/" + f, errors="replace").read()
        nasal["Systems/" + f] = "\n".join(re.findall(r'name="([^"]+)"|<output>([^<]+)</output>', t) and [a or b for a, b in re.findall(r'name="([^"]+)"|<output>([^<]+)</output>', t)])


def setters(k):
    leaf = "/".join(k.split("/")[-2:])
    alts = [leaf, leaf.split("/")[0] + "[0]/" + leaf.split("/")[-1]] if "[" not in leaf.split("/")[0] else [leaf]
    return sorted(f for f, t in nasal.items() if any(x in t for x in alts))[:3]


GROUPS = [
    ("The engines, the APU (the FADEC's — fadec.ts)", r"^(engines/|systems/ignition/starter|options/ign)"),
    ("The flight model: air data, attitude, speeds, the fuel's contents (the game's — fdm/jsbsim/...)", r"^fdm/jsbsim/"),
    ("The air data, the instruments' readings (the game's)", r"^(instrumentation/(altimeter|airspeed|radar-altimeter)|systems/(pitot|static)|velocities/|position/|environment/|accelerations/)"),
    ("The gear (the game's)", r"^gear/"),
    ("The fuel quantities (the game's tanks: consumables/)", r"^consumables/"),
    ("The time", r"^sim/time/"),
    ("The failures (0: working — a failure the game injects at 1)", r"^systems/failures/"),
    ("The deck's switches, pushbuttons, knobs (rig.ts's commands; FlightGear's -set file's initial value given)", r"^controls/"),
    ("What FlightGear's Nasal writes (systems/nasal/*: the APU, the fire, the ADIRS, the ECAM, the FMGC, the autoflight…), or its system files not run here (the FWC's, FMGC's, FBW's, property rules)", r"."),
]
lines = [
    "# The A320's systems: their inputs",
    "",
    "Generated by `scripts/build-a320-systems.py` from FlightGear's A320-family (GPL v2). What the JSBSim system files",
    "(`sysdata.json`, run by `jsbsys.ts`) read and none of their components writes — for the game to set on the bag",
    "each frame (`sysinputs.ts`), FlightGear's Nasal (`nasal/*`) or the deck. Paths as the bag keys them (no leading",
    '"/", `[0]` dropped). "init" is the value FlightGear\'s `-set` files (or the system files\' `<property>`) give it',
    "before the first frame, put on the bag by `JsbSystems.reset`. (`fdm/jsbsim/simulation/channel-dt`, read too, is",
    "written by `jsbsys.ts` itself: each channel's step.) \"FlightGear's writer\": where FlightGear sets it — a Nasal file,",
    "or one of its system files not run here (its FADEC's, FWC's, FMGC's, FBW's, property rules) —, the first three.",
    "",
    "Key ones:",
    "",
    "- `engines/engine/n2-actual`, `engines/engine[1]/n2-actual` [%]: the engines' N2 — the IDGs (115 V from ≈ 58 %),",
    "  the engine-driven pumps (3 000 psi), the bleed, the ignition's starter cut-off (`systems/ignition/starter-cutoff-n2`).",
    "- (`engines/engine/state` is the ignition file's own: 3 running once N2 ≥ `options/ign-run-n2` (58 %) with the master",
    "  switch on — `controls/engines/engine/cutoff-switch` 0 — and fuel in its feed tank, `fdm/jsbsim/propulsion/",
    "  tank[5]/contents-lbs` (engine 1), `tank[6]` (engine 2) ≥ 1 lb; the blue electric pump runs with an engine at 3.)",
    "- `controls/ignition/start-sw` (0 CRANK, 1 NORM, 2 IGN/START) and `controls/engines/engine/cutoff-switch` (1 = OFF):",
    "  the start; `systems/ignition/starter-engage-n2`, `starter-cutoff-n2` the starter's limits.",
    "- `engines/engine/egt-actual` [°C]: the bleed's temperature.",
    "- `engines/engine[2]/n1` [%]: the APU's speed (APU.nas writes it in FlightGear) — its generator, its bleed;",
    "  `systems/apu/available`, `systems/apu/start`, `systems/apu/fault`, `systems/apu/dc-bat-three-minutes` with it.",
    "- `sim/time/elapsed-sec` [s]: the time since the flight began — the generators' line contactors stay open its first",
    "  10 s (set it, else AC never comes from the IDGs).",
    "- `gear/gear[1]/wow`, `gear/gear[2]/wow`, `fdm/jsbsim/position/wow`, `fdm/jsbsim/gear/unit/WOW`: on the ground (1);",
    "  `gear/gear*/position-norm` (1 down), `gear/gear*/compression-norm`.",
    "- `velocities/airspeed-kt`, `instrumentation/airspeed-indicator/indicated-speed-kt`, `fdm/jsbsim/velocities/vc-kts`:",
    "  the airspeed (the RAT, the emergency generator, the ADRs); `velocities/groundspeed-kt`.",
    "- `position/altitude-ft`, `position/gear-agl-ft`, `instrumentation/altimeter*/…`, `systems/static*/pressure-inhg`,",
    "  `systems/pitot*/measured-total-pressure-inhg`, `fdm/jsbsim/propulsion/tat-c`, `environment/temperature-degc`: the",
    "  air data the ADRs compare and pass on.",
    "- `fdm/jsbsim/propulsion/tank[n]/contents-lbs` and `consumables/fuel/tank[n]/level-*`: the tanks (FlightGear's FDM:",
    "  0, 1 left inner/outer… — see a320-fuel.xml), `fdm/jsbsim/propulsion/engine[n]/fuel-used-lbs`.",
    "- `systems/hydraulic/{blue,green,yellow}-qty-input` [L]: the reservoirs — hydraulics.nas sets 8, 16, 15 at its init;",
    "  0 means no pressure at all.",
    "- `controls/hydraulic/switches/*`, `controls/electrical/switches/*`, `controls/fuel/switches/*`, `controls/pneumatics/",
    "  switches/*`: the pushbuttons (1 = in / ON / AUTO); `controls/electrical/switches/ground-cart` = external power",
    "  connected, `ext-pwr` = its pushbutton.",
    "",
]
for title, rx in GROUPS:
    mine = [k for k in ext if re.search(rx, k)]
    ext = [k for k in ext if k not in mine]
    if not mine:
        continue
    lines += [f"## {title}", "", "| property | read by | init | FlightGear's writer |", "|---|---|---|---|"]
    for k in mine:
        i = initial.get(k)
        w = "" if k.startswith(("controls/", "systems/failures/")) else ", ".join(setters(k))
        lines.append(f"| `{k}` | {', '.join(sorted(readers[k]))} | {'' if i is None else f'{i:g}'} | {w} |")
    lines.append("")
with open(ROOT + "/src/a320/systems/inputs.md", "w") as fo:
    fo.write("\n".join(lines))

with open(OUT, "w") as fo:
    json.dump(data, fo, separators=(",", ":"))
n = sum(len(c["comps"]) for s in systems for c in s["channels"])
print(f"{OUT}: {len(systems)} systems, {n} components, {len(props)} properties, {os.path.getsize(OUT) // 1024} kB; {n_ext} inputs")

# ---- The FWC's own system files (A11 — src/a320/ecam/): its phases and its warnings' logic, timers and flip-flops,
# converted alike into their own file — the ECAM runs them (src/a320/ecam/index.ts) after the systems, on the same bag;
# FlightGear's FDE runs them before the electrics, a frame's lag here (their execrates 4 to 16 frames)
FWC_OUT = ROOT + "/src/a320/ecam/fwcdata.json"
fwc = []
fwc_props = []
for name in ("fwc", "fwc-phases"):
    f = f"{FG}/Systems/a320-{name}.xml"
    r = ET.parse(f).getroot()
    for p in r.findall("property"):
        v = p.get("value")
        fwc_props.append([path(p.text), float(v) if v is not None else 0.0])
    chans = [{"name": ch.get("name", ""), "rate": int(ch.get("execrate", "1")), "comps": [component(c) for c in ch]} for ch in r.findall("channel")]
    fwc.append({"name": r.get("name", name), "file": f"Systems/a320-{name}.xml", "channels": chans})
with open(FWC_OUT, "w") as fo:
    json.dump({"source": "FlightGear A320-family (legoboyvdlp/A320-family, GPL v2): Systems/a320-{fwc,fwc-phases}.xml", "props": fwc_props, "systems": fwc}, fo, separators=(",", ":"))
n = sum(len(c["comps"]) for s in fwc for c in s["channels"])
print(f"{FWC_OUT}: {len(fwc)} systems, {n} components, {os.path.getsize(FWC_OUT) // 1024} kB")
