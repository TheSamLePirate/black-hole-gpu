#!/usr/bin/env python3
"""The A320's sound (docs/PLAN-A320.md, A12): FlightGear's A320-family (GPL v2) as A320-200-CFM-set.xml plays it —
its sound file Sounds/cfm56-sound.xml (with A320-common-sound.xml, its include) and the property rules that drive its
volumes and pitches (Systems/cfm56-sound.xml, property-rule 100; Systems/sound-common.xml, 101) — into
src/a320/sound/sounddata.json (the rules, the sounds: their conditions, volume and pitch terms as SimGear's
xmlsound.cxx reads them, places and cones in the ship's frame), src/a320/sound/inputs.md (what they read that nothing
of theirs writes), src/a320/sound/assets.ts (each recording's import); and each recording into Opus
(assets/a320/sounds/*.ogg: mono 48 kbps, stereo 64 kbps, 48 kHz — the cabin announcements left out).

    python3 scripts/build-a320-sounds.py [~/Documents/DEV/A320/flightgear-a320]
"""

import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/Documents/DEV/A320/flightgear-a320")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT_DIR = os.path.join(REPO, "src", "a320", "sound")
SND_DIR = os.path.join(REPO, "assets", "a320", "sounds")
PREFIX = "Aircraft/A320-family/"

# (the sound frame — SimGear's: x aft, y left, z up, from the model's origin — into the ship's: x left, y up, z the
# nose, the belly at y = 0 — scripts/build-a320.py's to_ship, FlightGear's model frame being x aft, y right, z up)
OFFSET_Z = 0.83109
BELLY = 2.648 - OFFSET_Z


def to_ship(x, y, z):
    return [round(y, 4), round(z + OFFSET_Z + BELLY, 4), round(-x, 4)]


def dir_ship(x, y, z):
    return [y, z, -x]


def norm_path(q):
    """A property's path as the game keys it: no leading "/", an index [0] dropped."""
    return re.sub(r"\[0\]", "", q.strip().lstrip("/"))


def norm(x):
    if isinstance(x, list):
        if len(x) == 2 and x[0] == "prop" and isinstance(x[1], str):
            return ["prop", norm_path(x[1])]
        return [norm(v) for v in x]
    return x


def _condition(e):
    """A <condition> → ["prop", path] | ["val", x] | ["expr", e] | [op, a, b] | ["not", c] | ["and"/"or", …] — as
    src/a320/rig.ts's, with expressions as operands (SimGear's SGCondition)."""
    kids = list(e)
    if e.tag in ("condition", "and"):
        cs = [_condition(k) for k in kids]
        return cs[0] if len(cs) == 1 and e.tag == "condition" else ["and", *cs]
    if e.tag == "or":
        return ["or", *[_condition(k) for k in kids]]
    if e.tag == "not":
        return ["not", _condition(kids[0])]
    if e.tag == "property":
        return ["prop", norm_path(e.text)]
    if e.tag == "value":
        try:
            return ["val", float(e.text)]
        except ValueError:
            return ["val", e.text.strip()]
    if e.tag == "expression":
        return ["expr", expression_of(e)]
    if e.tag in ("greater-than", "less-than", "greater-than-equals", "less-than-equals", "equals", "not-equals"):
        a, b = [_condition(k) for k in kids[:2]]
        return [e.tag, a, b]
    raise ValueError("condition tag " + e.tag)


def cond(e):
    return _condition(e) if e is not None else None


def num(t, d=None):
    if t is None or t.strip() == "":
        return d
    return float(t)


# ---- SimGear's expressions (SGExpression): a table, a product, a sum…

def expr(e):
    t = e.tag
    kids = list(e)
    if t == "property":
        return ["prop", norm_path(e.text)]
    if t == "value":
        return ["val", float(e.text)]
    if t == "table":
        inp = next(k for k in kids if k.tag != "entry")
        rows = [[float(k.findtext("ind")), float(k.findtext("dep"))] for k in kids if k.tag == "entry"]
        return ["table", expr(inp), rows]
    if t in ("product", "sum", "difference", "quotient", "min", "max", "pow"):
        return [t, *[expr(k) for k in kids]]
    if t in ("abs", "sqrt", "sqr", "neg", "ln", "log10", "exp"):
        return [t, expr(kids[0])]
    raise ValueError("expression " + t)


def expression_of(e):
    """an <expression>'s content"""
    kids = list(e)
    return expr(kids[0])


# ---- the property rules (FlightGear's autopilot/property-rule format): gain filters, noise-spike, logic

def rule_input(i):
    """A filter's <input>: its condition, its source (a property, a value, an expression), scale and offset."""
    out = {"cond": cond(i.find("condition"))}
    if len(i) == 0:
        out["src"] = ["val", float(i.text)]
        return out
    if i.find("expression") is not None:
        out["src"] = expression_of(i.find("expression"))
    elif i.find("property") is not None:
        out["src"] = ["prop", norm_path(i.findtext("property"))]
    elif i.find("value") is not None:
        out["src"] = ["val", float(i.findtext("value"))]
    else:
        out["src"] = ["val", float(i.text)]
    for k in ("scale", "offset", "min", "max"):
        if i.find(k) is not None:
            out[k] = float(i.findtext(k))
    return out


def rules(path):
    out = []
    for r in ET.parse(path).getroot():
        if r.tag == "filter":
            t = (r.findtext("type") or "gain").strip()
            o = {"t": t, "in": [rule_input(i) for i in r.findall("input")], "out": [norm_path(x.text) for x in r.findall("output")]}
            g = r.find("gain")
            if g is not None:
                o["gain"] = expression_of(g.find("expression")) if g.find("expression") is not None else ["val", float(g.text)]
            if t == "noise-spike":
                o["rate"] = float(r.findtext("max-rate-of-change"))
            elif t != "gain":
                raise ValueError("filter type " + t)
            out.append(o)
        elif r.tag == "logic":
            inp = r.find("input")
            # (its input holds a condition's elements themselves)
            out.append({"t": "logic", "cond": _condition(_as_condition(inp)), "out": [norm_path(x.text) for x in r.findall("output")]})
    return out


def _as_condition(e):
    c = ET.Element("condition")
    for k in e:
        c.append(k)
    return c


# ---- the sounds (SimGear's SGXmlSound)

FN = {"inv", "abs", "sqrt", "log", "ln", "sqr", "pow3"}


def term(e):
    """A <volume> or <pitch> term: its source (a property, an internal timer — dt_play, dt_stop —, an expression), its
    function, factor (a negative one: SimGear's "subtract"), offset, min, max."""
    o = {}
    if e.find("expression") is not None:
        o["src"] = expression_of(e.find("expression"))
    elif e.find("property") is not None:
        o["src"] = ["prop", norm_path(e.findtext("property"))]
    elif e.find("internal") is not None:
        o["src"] = ["internal", e.findtext("internal").strip()]
    t = (e.findtext("type") or "").strip()
    if t:
        if t not in FN:
            raise ValueError("sound function " + t)
        o["fn"] = t
    f = num(e.findtext("factor"), 1.0)
    if f < 0:
        o["sub"] = True
        f = -f
    o["factor"] = f
    o["offset"] = num(e.findtext("offset"), 0.0)
    if e.find("min") is not None:
        o["min"] = float(e.findtext("min"))
    if e.find("max") is not None:
        o["max"] = float(e.findtext("max"))
    return o


def polarity(c, want):
    """+1 if the condition needs one of `want` true, −1 if it needs it false, 0 if it does not read it."""
    if not c:
        return 0
    if c[0] == "prop":
        return 1 if c[1] in want else 0
    if c[0] == "not":
        return -polarity(c[1], want)
    if c[0] in ("and", "or"):
        ps = [polarity(k, want) for k in c[1:]]
        return next((p for p in ps if p), 0)
    if c[0] in ("equals", "not-equals"):
        a, b = c[1], c[2]
        if a and a[0] == "prop" and a[1] in want and b and b[0] == "val":
            s = 1 if b[1] else -1
            return s if c[0] == "equals" else -s
    return 0


# (the volumes behind a property rule a view gates: the cabin's rolling and its packs, heard inside only)
WHERE = {
    "roll1c": "inside",
    "roll2c": "inside",
    "roll3c": "inside",
    "roll1": "inside",
    "roll2": "inside",
    "roll3": "inside",
    "air conditioning": "inside",
}

INSIDE = {"sim/current-view/internal", "sim/sound/internal-custom", "sim/sound/wingview"}
OUTSIDE = {"sim/sound/external-custom"}


def where_of(s):
    """Heard inside the hull, outside, or both: the recordings' own (the cockpit's, the wings' cabin, the
    outside's), the condition's view, the volume's view (a volume × the internal view: inside), the avionics' (the
    cockpit's speakers)."""
    p = s["path"]
    if s["name"] in WHERE:
        return WHERE[s["name"]]
    if "/external/" in p:
        return "outside"
    if "/cockpit/" in p or "/start/" in p or "/wingaft/" in p or "/wingfwd/" in p:
        return "inside"
    pc = polarity(s.get("cond"), INSIDE) or -polarity(s.get("cond"), OUTSIDE)
    if pc:
        return "inside" if pc > 0 else "outside"
    for t in s["volume"]:
        src = t.get("src")
        if src and src[0] == "prop" and (src[1] in INSIDE or src[1].startswith("sim/sound/cockpit/") or src[1].startswith("sim/sound/wing")):
            return "inside"
        if src and src[0] == "prop" and (src[1] in OUTSIDE or src[1].startswith("sim/sound/external/")):
            return "outside"
    if s.get("avionics"):
        return "inside"
    return "both"


def flat(path):
    """a recording's name in assets/a320/sounds: its path below Sounds/, flattened, lowercased"""
    rel = path.replace(PREFIX + "Sounds/", "")
    return re.sub(r"[^a-z0-9]+", "-", os.path.splitext(rel)[0].lower()).strip("-")


def sounds(path):
    root = ET.parse(path).getroot()
    inc = root.get("include")
    out = []
    if inc:
        out += sounds(os.path.join(os.path.dirname(path), inc))
    fx = root.find("fx")
    for g in fx if fx is not None else []:
        p = (g.findtext("path") or "").strip()
        if not p or "Announce/" in p:
            continue
        # (a path without the aircraft's: below Sounds/, SimGear's search path)
        if not p.startswith(PREFIX):
            p = PREFIX + "Sounds/" + p
        s = {
            "group": g.tag,
            "name": (g.findtext("name") or "").strip(),
            "mode": (g.findtext("mode") or "looped").strip(),
            "path": p,
            "file": flat(p),
            # (SimGear reads the first <condition> — cfm56-sound.xml's external sounds carry two: the view's counts)
            "cond": cond(g.find("condition")),
            "volume": [term(v) for v in g.findall("volume")],
            "pitch": [term(v) for v in g.findall("pitch")],
        }
        if g.find("property") is not None:
            s["prop"] = norm_path(g.findtext("property"))
        if (g.findtext("type") or "").strip() == "avionics":
            s["avionics"] = True
        if g.find("delay-sec") is not None:
            s["delay"] = float(g.findtext("delay-sec"))
        pos = g.find("position")
        if pos is not None:
            s["pos"] = to_ship(*(num(pos.findtext(k), 0.0) for k in ("x", "y", "z")))
        o = g.find("orientation")
        if o is not None:
            d = dir_ship(*(num(o.findtext(k), 0.0) for k in ("x", "y", "z")))
            s["cone"] = {
                "dir": d,
                "inner": num(o.findtext("inner-angle"), 360.0),
                "outer": num(o.findtext("outer-angle"), 360.0),
                "outerGain": num(o.findtext("outer-gain"), 0.0),
            }
        for k, n in (("reference-dist", "refDist"), ("max-dist", "maxDist")):
            if g.find(k) is not None:
                s[n] = float(g.findtext(k))
        s["where"] = where_of(s)
        out.append(s)
    return out


# ---- the properties read: what nothing here writes (the game's, the systems', the deck's)

def props_in(x, acc):
    if isinstance(x, list):
        if len(x) == 2 and x[0] == "prop" and isinstance(x[1], str):
            acc.add(x[1])
        else:
            for v in x:
                props_in(v, acc)
    elif isinstance(x, dict):
        for v in x.values():
            props_in(v, acc)


def convert(files):
    """Each recording to Opus (its channels kept: mono 48 kbps, stereo 64 kbps; 48 kHz)."""
    os.makedirs(SND_DIR, exist_ok=True)
    total = 0
    for name, path in sorted(files.items()):
        src = os.path.join(ROOT, path.replace(PREFIX, ""))
        dst = os.path.join(SND_DIR, name + ".ogg")
        if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
            ch = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", src],
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            rate = "64k" if ch == "2" else "48k"
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", src, "-c:a", "libopus", "-b:a", rate, "-ar", "48000", "-map_metadata", "-1", dst],
                check=True,
            )
        total += os.path.getsize(dst)
    return total


def ident(name):
    p = re.split(r"-", name)
    s = p[0] + "".join(x[:1].upper() + x[1:] for x in p[1:])
    return ("s" + s) if s[0].isdigit() else s


def main():
    rl = rules(os.path.join(ROOT, "Systems", "sound-common.xml")) + rules(os.path.join(ROOT, "Systems", "cfm56-sound.xml"))
    sd = sounds(os.path.join(ROOT, "Sounds", "cfm56-sound.xml"))
    files = {s["file"]: s["path"] for s in sd}
    # (the EGPWS's warnings: FlightGear's mk-viii plays them from C++, not from the sound files — the game's callouts do,
    # src/a320/sound/callouts.ts)
    for w in ("pull-up", "terrain", "sink-rate", "too-low-gear", "too-low-flaps", "too-low-terrain", "dont-sink", "glideslope", "bank-angle"):
        files.setdefault(flat(PREFIX + "Sounds/GPWS/" + w + ".wav"), PREFIX + "Sounds/GPWS/" + w + ".wav")
    written = {o for r in rl for o in r["out"]}
    read = set()
    props_in([r for r in rl], read)
    props_in([[s.get("cond"), s["volume"], s["pitch"], ["prop", s["prop"]] if "prop" in s else None] for s in sd], read)
    inputs = sorted(read - written)
    # (the values FlightGear's A320-main.xml gives the sound's properties before the first frame: the gear's volume,
    # the warnings' gate)
    init = {}
    snd = ET.parse(os.path.join(ROOT, "A320-main.xml")).getroot().find("sim/sound")
    for k in snd if snd is not None else []:
        t = (k.get("type") or "").strip()
        v = (k.text or "").strip()
        init["sim/sound/" + k.tag] = (1.0 if v.lower() == "true" else 0.0 if v.lower() == "false" else float(v)) if t in ("bool", "double", "int") else v
    data = {
        "source": "FlightGear A320-family (legoboyvdlp/A320-family, GPL v2): Sounds/cfm56-sound.xml, A320-common-sound.xml; "
        "Systems/sound-common.xml, cfm56-sound.xml (property rules 101, 100)",
        "init": init,
        "rules": rl,
        "sounds": sd,
    }
    with open(os.path.join(OUT_DIR, "sounddata.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    size = convert(files)
    # (the recordings' imports: the bundler gives each its URL)
    lines = [
        "// The A320's recordings (docs/PLAN-A320.md, A12 — FlightGear's Sounds/, GPL v2, in Opus): generated by",
        "// scripts/build-a320-sounds.py — each one's URL by its name in sounddata.json.",
        "",
    ]
    names = sorted(files)
    for n in names:
        lines.append(f'import {ident(n)} from "../../../assets/a320/sounds/{n}.ogg";')
    lines += ["", "export const SOUND_URL: Record<string, string> = {"]
    lines += [f'  "{n}": {ident(n)},' for n in names]
    lines += ["};", ""]
    with open(os.path.join(OUT_DIR, "assets.ts"), "w") as f:
        f.write("\n".join(lines))
    # (the inputs: by their kind)
    groups = [
        ("The engines, the APU (the FADEC's — fadec.ts; sysinputs.ts)", r"^engines/"),
        ("The view (the game's camera: main.ts — soundinputs.ts)", r"^sim/current-view/"),
        ("The gear, the wheels, the surfaces (the game's)", r"^(gear/|surface-positions/|controls/flight/|controls/gear/)"),
        ("The air, the speeds, the heights (the game's)", r"^(velocities/|position/|environment/|instrumentation/)"),
        ("The ECAM's and the deck's sound triggers (src/a320/ecam, the deck's bindings: sim/sound/*)", r"^(sim/sound/|ECAM/)"),
        ("The systems (src/a320/systems)", r"^(systems/|controls/)"),
        ("The flight guidance (FMGC — controller/a320ap.ts)", r"^(FMGC/|it-autoflight/)"),
    ]
    md = [
        "# The A320's sounds: their inputs",
        "",
        "Generated by `scripts/build-a320-sounds.py` from FlightGear's A320-family (GPL v2). What its sound files and their",
        "property rules (`sounddata.json`, evaluated by `model.ts`) read and none of their rules writes — for the game to",
        "set on the systems' bag each frame (`soundinputs.ts`, the A10 systems, the ECAM, the deck). Paths as the bag keys",
        "them (no leading \"/\", `[0]` dropped).",
        "",
    ]
    left = list(inputs)
    for title, rx in groups:
        mine = [p for p in left if re.search(rx, p)]
        left = [p for p in left if p not in mine]
        if mine:
            md += [f"## {title}", ""] + [f"- `{p}`" for p in mine] + [""]
    if left:
        md += ["## Others", ""] + [f"- `{p}`" for p in left] + [""]
    with open(os.path.join(OUT_DIR, "inputs.md"), "w") as f:
        f.write("\n".join(md))
    loops = sum(1 for s in sd if s["mode"] == "looped")
    print(
        f"{len(rl)} rules, {len(sd)} sounds ({loops} looped, {sum(1 for s in sd if s['mode'] == 'once')} once, "
        f"{sum(1 for s in sd if s['mode'] == 'in-transit')} in transit), {len(files)} recordings, {size / 1e6:.2f} MB; "
        f"{len(inputs)} inputs"
    )


if __name__ == "__main__":
    main()
