"""
The A320's ECAM (docs/PLAN-A320.md, A11), read from FlightGear's A320-family (GPL v2 — ~/Documents/DEV/A320/
flightgear-a320, not in the repository): its warnings and memos (Nasal/ECAM/ECAM-messages.nas) and the logic that
raises them (ECAM-logic.nas) translated into TypeScript as they are — not rewritten by hand —, and its property rules
(Systems/ecam-proprules.xml: flip-flops, monostables, filters) as data; the FWC's JSBSim system files are
scripts/build-a320-systems.py's (src/a320/ecam/fwcdata.json).

  python3 scripts/build-a320-fwc.py [path/to/flightgear-a320]
      → src/a320/ecam/messages.ts, logic.ts, proprules.json, inputs.md

The Nasal's property nodes (pts.Controls.Engines.Engine.cutoffSw[0], systems.ELEC.Bus.acEss, warningNodes.Logic.…)
are resolved to their properties by reading where FlightGear defines them (the namespaces of A320-main.xml's <nasal>:
pts, systems, ecam, fbw, fcu, fmgc…): `X.getValue()` becomes `g("path")`, `X.setValue(v)` `s("path", v)`. What does
not resolve to a property — a Nasal object's field (systems.APU.signals.emer, fmgc.FMGCInternal.v1set…), a function —
is read from the bag under its Nasal name, "@systems.APU.signals.emer" (inputs.md lists them, for the game to give).
Paths as the bag keys them: no leading "/", an index [0] dropped.
"""
import json, os, re, subprocess, sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FG = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/DEV/A320/flightgear-a320")
OUT = ROOT + "/src/a320/ecam/"


def norm(p):
    p = p.strip()
    if p.startswith("/"):
        p = p[1:]
    return re.sub(r"\[0\]", "", p)


# ---- Nasal's tokens
TOK = re.compile(
    r"""(?P<ws>\s+)|(?P<com>\#[^\n]*)|(?P<num>0x[0-9a-fA-F]+|\d+\.\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?)"""
    r"""|(?P<str>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?P<id>[A-Za-z_][A-Za-z0-9_]*)"""
    r"""|(?P<op>\.\.\.|==|!=|<=|>=|\+=|-=|\*=|/=|~=|\?\?|[-+*/~!<>=(){}\[\],;:.?])"""
)


def tokens(src):
    out = []
    i = 0
    while i < len(src):
        m = TOK.match(src, i)
        if not m:
            raise SyntaxError(f"at {src[i:i + 40]!r}")
        i = m.end()
        k = m.lastgroup
        if k in ("ws", "com"):
            continue
        v = m.group(k)
        if k == "str":
            q = v[0]
            body = v[1:-1]
            v = re.sub(r"\\(.)", lambda e: {"n": "\n", "t": "\t"}.get(e.group(1), e.group(1)), body) if q == '"' else body.replace("\\'", "'")
            out.append(("str", v))
        elif k == "num":
            out.append(("num", float(int(v, 16)) if v.startswith("0x") else float(v)))
        else:
            out.append((k, v))
    out.append(("eof", None))
    return out


# ---- Where FlightGear defines its nodes: each namespace's top-level `var X = …` — a node, a hash of them, a vector
def namespaces():
    s = open(FG + "/A320-main.xml").read()
    blk = s[s.find("<nasal>") : s.find("</nasal>")]
    ns = {}
    for m in re.finditer(r"<([A-Za-z_0-9-]+)>\s*((?:<file>[^<]*</file>\s*)+)</\1>", blk):
        ns[m.group(1)] = [f.replace("Aircraft/A320-family/", "") for f in re.findall(r"<file>([^<]*)</file>", m.group(2))]
    return ns


def skip_balanced(t, i, stops):
    """Past a value: to the next stop token at depth 0."""
    d = 0
    while t[i][0] != "eof":
        v = t[i][1]
        if t[i][0] == "op":
            if d == 0 and v in stops:
                return i
            if v in "([{":
                d += 1
            elif v in ")]}":
                d -= 1
                if d < 0:
                    return i
        i += 1
    return i


def def_value(t, i):
    """A definition's value: {"node": path} | dict | list | None (anything else, skipped)."""
    if t[i] == ("op", "{"):
        out = {}
        i += 1
        while t[i] != ("op", "}"):
            if t[i][0] in ("id", "str") and t[i + 1] == ("op", ":"):
                key = t[i][1]
                v, i = def_value(t, i + 2)
                if v is not None:
                    out[key] = v
            else:
                i = skip_balanced(t, i, ",}")
            if t[i] == ("op", ","):
                i += 1
        return out, i + 1
    if t[i] == ("op", "["):
        out = []
        i += 1
        while t[i] != ("op", "]"):
            v, i = def_value(t, i)
            out.append(v)
            if t[i] == ("op", ","):
                i += 1
            elif t[i] != ("op", "]"):
                i = skip_balanced(t, i, ",]")
                if t[i] == ("op", ","):
                    i += 1
        return out, i + 1
    if [x[1] for x in t[i : i + 5]] == ["props", ".", "globals", ".", "getNode"] or [x[1] for x in t[i : i + 5]] == ["props", ".", "globals", ".", "initNode"]:
        j = i + 5
        if t[j] == ("op", "(") and t[j + 1][0] == "str":
            p = t[j + 1][1]
            j = skip_balanced(t, j + 1, ")")
            j += 1
            # (a node's method after — .getValue(): not a node)
            if t[j] == ("op", "."):
                return None, skip_balanced(t, j, ",;}]")
            return {"node": norm(p)}, j
    return None, skip_balanced(t, i, ",;}]")


def definitions(files):
    defs = {}
    for f in files:
        try:
            t = tokens(open(FG + "/" + f, errors="replace").read())
        except (OSError, SyntaxError):
            continue
        i, d = 0, 0
        while t[i][0] != "eof":
            if d == 0 and t[i] == ("id", "var") and t[i + 1][0] == "id" and t[i + 2] == ("op", "="):
                name = t[i + 1][1]
                v, i = def_value(t, i + 3)
                if v is not None:
                    defs[name] = v
                continue
            if t[i][0] == "op":
                if t[i][1] in "([{":
                    d += 1
                elif t[i][1] in ")]}":
                    d -= 1
            i += 1
    return defs


NS = namespaces()
DEFS = {k: definitions(fs) for k, fs in NS.items()}


# ---- The ECAM's messages (ECAM-messages.nas): each vector's warnings, memos, status lines, in order
def messages():
    t = tokens(open(FG + "/Nasal/ECAM/ECAM-messages.nas").read())
    vectors, i, cur = {}, 0, None
    kinds = {"warning": ["msg", "colour", "aural", "light", "isMainMsg", "lastSubmsg", "sdPage", "isMemo"], "memo": ["msg", "colour"], "status": ["msg", "colour"]}
    while t[i][0] != "eof":
        if t[i] == ("id", "var") and t[i + 2] == ("op", "=") and [x[1] for x in t[i + 3 : i + 7]] == ["std", ".", "Vector", "."]:
            cur = t[i + 1][1]
            vectors[cur] = []
            i += 7
            continue
        if cur and t[i] == ("id", "var") and t[i + 2] == ("op", "=") and t[i + 3][1] in kinds and t[i + 5] == ("id", "new"):
            name, kind = t[i + 1][1], t[i + 3][1]
            i += 7
            args, pos = {}, 0
            while t[i] != ("op", ")"):
                if t[i][0] == "id" and t[i + 1] == ("op", ":"):
                    args[t[i][1]] = t[i + 2][1]
                    i += 3
                else:
                    args[kinds[kind][pos]] = t[i][1]
                    pos += 1
                    i += 1
                if t[i] == ("op", ","):
                    i += 1
            d = {"name": name, "kind": kind, "msg": args.get("msg", ""), "colour": args.get("colour", "g")}
            if kind == "warning":
                d.update(aural=int(args.get("aural", 9)), light=int(args.get("light", 9)), isMainMsg=int(args.get("isMainMsg", 0)), sdPage=args.get("sdPage", "nil"), isMemo=int(args.get("isMemo", 0)))
            vectors[cur].append(d)
        i += 1
    return vectors


VECTORS = messages()
MSG = {d["name"] for v in VECTORS.values() for d in v}


# ---- ECAM-logic.nas parsed
class P:
    def __init__(self, t):
        self.t, self.i = t, 0

    def peek(self, k=0):
        return self.t[self.i + k]

    def eat(self, v=None):
        x = self.t[self.i]
        if v is not None and x[1] != v:
            raise SyntaxError(f"expected {v!r}, got {x!r} at token {self.i}: {self.t[self.i - 5 : self.i + 5]}")
        self.i += 1
        return x

    def at(self, v):
        return self.t[self.i][1] == v and self.t[self.i][0] in ("op", "id")

    # statements
    def block(self):
        if self.at("{"):
            self.eat("{")
            out = []
            while not self.at("}"):
                out.append(self.stmt())
            self.eat("}")
            return out
        return [self.stmt()]

    def stmt(self):
        if self.at(";"):
            self.eat()
            return ("nop",)
        if self.at("if"):
            self.eat()
            self.eat("(")
            c = self.expr()
            self.eat(")")
            then = self.block()
            els = None
            if self.at("elsif"):
                self.t[self.i] = ("id", "if")
                els = [self.stmt()]
            elif self.at("else"):
                self.eat()
                els = [self.stmt()] if self.at("if") else self.block()
            return ("if", c, then, els)
        if self.at("var"):
            self.eat()
            name = self.eat()[1]
            self.eat("=")
            e = self.expr()
            # (a function's definition may end without its ";")
            if self.at(";") or e[0] != "func":
                self.eat(";")
            return ("var", name, e)
        if self.at("return"):
            self.eat()
            e = None if self.at(";") else self.expr()
            self.eat(";")
            return ("return", e)
        e = self.expr()
        if self.peek()[1] in ("=", "+=", "-=", "~="):
            op = self.eat()[1]
            r = self.expr()
            self.eat(";")
            return ("set", op, e, r)
        if self.at(";"):
            self.eat(";")
        return ("expr", e)

    # expressions, Nasal's precedence
    def expr(self):
        c = self.or_()
        if self.at("?"):
            self.eat()
            a = self.expr()
            self.eat(":")
            b = self.expr()
            return ("?", c, a, b)
        return c

    def or_(self):
        a = self.and_()
        while self.at("or"):
            self.eat()
            a = ("or", a, self.and_())
        return a

    def and_(self):
        a = self.cmp()
        while self.at("and"):
            self.eat()
            a = ("and", a, self.cmp())
        return a

    def cmp(self):
        a = self.add()
        while self.peek()[0] == "op" and self.peek()[1] in ("==", "!=", "<", ">", "<=", ">="):
            op = self.eat()[1]
            a = (op, a, self.add())
        return a

    def add(self):
        a = self.mul()
        while self.peek()[0] == "op" and self.peek()[1] in ("+", "-", "~"):
            op = self.eat()[1]
            a = (op, a, self.mul())
        return a

    def mul(self):
        a = self.unary()
        while self.peek()[0] == "op" and self.peek()[1] in ("*", "/"):
            op = self.eat()[1]
            a = (op, a, self.unary())
        return a

    def unary(self):
        if self.peek() == ("op", "!"):
            self.eat()
            return ("!", self.unary())
        if self.peek() == ("op", "-"):
            self.eat()
            return ("neg", self.unary())
        return self.postfix()

    def postfix(self):
        x = self.primary()
        while True:
            if self.at("."):
                self.eat()
                x = ("dot", x, self.eat()[1])
            elif self.at("["):
                self.eat()
                k = self.expr()
                self.eat("]")
                x = ("idx", x, k)
            elif self.at("("):
                self.eat()
                args = []
                while not self.at(")"):
                    args.append(self.expr())
                    if self.at(","):
                        self.eat()
                self.eat(")")
                x = ("call", x, args)
            else:
                return x

    def primary(self):
        k, v = self.eat()
        if k == "num":
            return ("num", v)
        if k == "str":
            return ("str", v)
        if k == "id":
            if v == "nil":
                return ("nil",)
            if v == "func":
                if self.at("("):
                    self.eat("(")
                    self.eat(")")
                return ("func", self.block())
            return ("id", v)
        if v == "(":
            e = self.expr()
            self.eat(")")
            return ("paren", e)
        if v == "[":
            items = []
            while not self.at("]"):
                items.append(self.expr())
                if self.at(","):
                    self.eat()
            self.eat("]")
            return ("vec", items)
        raise SyntaxError(f"primary {k} {v!r} at {self.i}")


def program(src):
    p = P(tokens(src))
    out = []
    while p.peek()[0] != "eof":
        out.append(p.stmt())
    return out


LOGIC = program(open(FG + "/Nasal/ECAM/ECAM-logic.nas").read())

# (the logic's own top-level nodes and variables)
LOCAL_NODES, LOCALS = {}, {}
for s in LOGIC:
    if s[0] == "var" and s[2][0] != "func":
        e = s[2]
        if e[0] == "call" and e[1][0] == "dot" and e[1][2] in ("getNode", "initNode") and e[2] and e[2][0][0] == "str":
            LOCAL_NODES[s[1]] = norm(e[2][0][1])
        else:
            LOCALS[s[1]] = e


def chain(e):
    """An expression as a dotted chain of names and constant indices ("systems.FADEC.detent[0]"), or None."""
    if e[0] == "id":
        return [e[1]]
    if e[0] == "dot":
        c = chain(e[1])
        return c + [e[2]] if c is not None else None
    if e[0] == "idx" and e[2][0] == "num":
        c = chain(e[1])
        return c + [int(e[2][1])] if c is not None else None
    return None


def chain_text(c):
    return "".join((f"[{x}]" if isinstance(x, int) else (("." if k else "") + x)) for k, x in enumerate(c))


def resolve(c):
    """A chain to its node's property, or None."""
    if not c:
        return None
    if chain_text(c) in ALIAS:
        return ALIAS[chain_text(c)]
    if len(c) == 1 and c[0] in LOCAL_NODES:
        return LOCAL_NODES[c[0]]
    roots = []
    if c[0] in DEFS and c[0] not in DEFS["ecam"]:
        roots.append((DEFS[c[0]], c[1:]))
    roots.append((DEFS["ecam"], c))
    if c[0] == "ecam":
        roots.append((DEFS["ecam"], c[1:]))
    for d, rest in roots:
        x = d
        for k in rest:
            if isinstance(x, dict) and isinstance(k, str) and k in x:
                x = x[k]
            elif isinstance(x, list) and isinstance(k, int) and k < len(x):
                x = x[k]
            else:
                x = None
                break
        if isinstance(x, dict) and "node" in x:
            return x["node"]
    return None


UNRESOLVED, READS, WRITES = {}, set(), set()
BOOLS = ("and", "or", "!", "==", "!=", "<", ">", "<=", ">=")


def is_bool(e):
    if e[0] == "call":
        c = chain(e[1])
        return bool(c) and c[-1] == "getBoolValue"
    return e[0] in BOOLS or (e[0] == "paren" and is_bool(e[1]))


# (Nasal objects' fields that are nodes or stand for one — FlightGear makes them in constructors: fire.nas's bottles,
# brakesystem.nas's fans, PERFTO.nas's VMCA/VMCG)
ALIAS = {
    **{f"systems.extinguisherBottles.vector[{i}].lightProp": p for i, p in enumerate(["systems/fire/engine1/disch1", "systems/fire/engine1/disch2", "systems/fire/engine2/disch1", "systems/fire/engine2/disch2", "systems/fire/apu/disch"])},
    "systems.cargoExtinguisherBottles.vector[0].lightProp": "systems/fire/cargo/disch",
    "systems.cargoExtinguisherBottles.vector[1].lightProp": "systems/fire/cargo/disch",
    "systems.BrakeSys.brakeFans": "controls/gear/brake-fans",
    "mcdu.VMCA": "FMGC/internal/vmca-kt",
    "mcdu.VMCG": "FMGC/internal/vmcg-kt",
}


def q(s):
    return json.dumps(s, ensure_ascii=False)


def gen(e, ctx="v"):
    """An expression in TypeScript ("b": a condition — a boolean wanted)."""
    k = e[0]
    if k == "num":
        v = e[1]
        return str(int(v)) if v == int(v) and abs(v) < 1e15 else repr(v)
    if k == "str":
        return q(e[1])
    if k == "nil":
        return "null"
    if k == "paren":
        return f"({gen(e[1], ctx)})"
    if k in ("and", "or"):
        op = "&&" if k == "and" else "||"
        return f"{cond(e[1])} {op} {cond(e[2])}"
    if k == "!":
        x = e[1]
        return f"!({gen(x, 'b')})" if is_bool(x) and x[0] != "paren" else f"!{cond(x)}" if is_bool(x) else f"!t({gen(x)})"
    if k == "neg":
        return f"-{gen(e[1])}"
    if k in ("==", "!="):
        r = f"eq({gen(e[1])}, {gen(e[2])})"
        return r if k == "==" else "!" + r
    if k in ("<", ">", "<=", ">="):
        return f"{gen(e[1])} {k} {gen(e[2])}"
    if k in ("+", "-", "*", "/"):
        return f"{gen(e[1])} {k} {gen(e[2])}"
    if k == "~":
        return f"cat({gen(e[1])}, {gen(e[2])})"
    if k == "?":
        return f"({cond(e[1])} ? {gen(e[2])} : {gen(e[3])})"
    if k == "vec":
        return "[" + ", ".join(gen(x) for x in e[1]) + "]"
    if k == "func":
        return "() => {\n" + body(e[1]) + "}"
    if k == "call":
        f, args = e[1], e[2]
        c = chain(f)
        if c:
            name = chain_text(c)
            if c[-1] in ("getValue", "getBoolValue", "getIntValue") and len(c) > 1:
                p = resolve(c[:-1])
                if p is None:
                    p = "@" + chain_text(c[:-1])
                    UNRESOLVED.setdefault(p, set()).add("read")
                READS.add(p)
                return f"{'b' if c[-1] == 'getBoolValue' else 'g'}({q(p)})"
            if c[-1] in ("setValue", "setBoolValue") and len(c) > 1:
                p = resolve(c[:-1])
                if p is None:
                    p = "@" + chain_text(c[:-1])
                    UNRESOLVED.setdefault(p, set()).add("written")
                WRITES.add(p)
                return f"s({q(p)}, {gen(args[0])})"
            if name == "ECAM_controller.warningReset":
                return f"R({gen(args[0])})"
            if name == "getprop":
                p = norm(args[0][1])
                READS.add(p)
                return f"g({q(p)})"
            if name == "setprop":
                p = norm(args[0][1])
                WRITES.add(p)
                return f"s({q(p)}, {gen(args[1])})"
            if name in ("find", "abs", "math.max", "math.round", "math.min", "size"):
                return f"{name.replace('math.', '')}({', '.join(gen(a) for a in args)})"
            if name == "settimer":
                return f"after({gen(args[1])}, {gen(args[0])})"
            UNRESOLVED.setdefault("@" + name + "()", set()).add("called")
            return f"call({q(name)}{''.join(', ' + gen(a) for a in args)})"
        raise SyntaxError(f"call on {e[1]}")
    if k in ("id", "dot", "idx"):
        c = chain(e)
        if c and c[0] in MSG and c[0] not in LOCALS:
            return "M." + c[0] + "".join("." + x for x in c[1:])
        if c and len(c) == 1 and c[0] in LOCALS:
            return "V." + c[0]
        if k == "idx" and chain(e[1]) and len(chain(e[1])) == 1 and chain(e[1])[0] in LOCALS:
            return f"V.{chain(e[1])[0]}[{gen(e[2])}]"
        if c:
            p = "@" + chain_text(c)
            UNRESOLVED.setdefault(p, set()).add("read")
            READS.add(p)
            return f"g({q(p)})"
        raise SyntaxError(f"value {e}")
    raise SyntaxError(f"expr {e}")


def cond(e):
    return gen(e, "b") if is_bool(e) else f"t({gen(e)})"


def lval(e):
    c = chain(e)
    if c and c[0] in MSG:
        return "M." + ".".join(str(x) for x in c)
    if c and len(c) == 1 and c[0] in LOCALS:
        return "V." + c[0]
    if e[0] == "idx" and chain(e[1]) and chain(e[1])[0] in LOCALS:
        return f"V.{chain(e[1])[0]}[{gen(e[2])}]"
    raise SyntaxError(f"assign to {e}")


def body(stmts, ind=1):
    out = ""
    pad = "  " * ind
    for s in stmts:
        k = s[0]
        if k == "nop":
            continue
        if k == "if":
            out += f"{pad}if ({cond(s[1])}) {{\n{body(s[2], ind + 1)}{pad}}}"
            e = s[3]
            while e:
                if len(e) == 1 and e[0][0] == "if":
                    out += f" else if ({cond(e[0][1])}) {{\n{body(e[0][2], ind + 1)}{pad}}}"
                    e = e[0][3]
                else:
                    b = body(e, ind + 1)
                    if b.strip():
                        out += f" else {{\n{b}{pad}}}"
                    e = None
            out += "\n"
        elif k == "set":
            op = {"=": "=", "+=": "+=", "-=": "-=", "~=": "+="}[s[1]]
            out += f"{pad}{lval(s[2])} {op} {gen(s[3])};\n"
        elif k == "expr":
            out += f"{pad}{gen(s[1])};\n"
        elif k == "var":
            out += f"{pad}V.{s[1]} = {gen(s[2])};\n"
        elif k == "return":
            out += f"{pad}return;\n"
        else:
            raise SyntaxError(k)
    return out


FUNCS = [(s[1], s[2][1]) for s in LOGIC if s[0] == "var" and s[2][0] == "func"]
TSNAME = {
    "messages_priority_3": "priority3",
    "messages_priority_2": "priority2",
    "messages_priority_1": "priority1",
    "messages_priority_0": "priority0",
    "messages_config_memo": "configMemo",
    "messages_memo": "memo",
    "messages_right_memo": "rightMemo",
}

HEAD = """// Generated by scripts/build-a320-fwc.py from FlightGear's A320-family (GPL v2): Nasal/ECAM/ECAM-logic.nas, translated
// as it is — each warning's condition, each procedure line's (an action done: its line gone) — on the systems' bag
// (fwc.ts: g reads a property, b a boolean, s writes one, R resets a warning, M the messages, V the logic's own
// variables). Not edited by hand: run the script again.
"""
ts = HEAD + '\nimport type { Fwc } from "./fwc";\n'
for name, stmts in FUNCS:
    code = body(stmts)
    used = [h for h in ("g", "b", "s", "R", "M", "V", "t", "eq", "cat", "find", "abs", "max", "min", "round", "size", "after", "call") if re.search(r"(?<![\w.\"@])" + h + r"[.(\[]", code)]
    ts += f"\n/** FlightGear's {name} */\nexport function {TSNAME[name]}({'F' if used else '_F'}: Fwc): void {{\n"
    if used:
        ts += f"  const {{ {', '.join(used)} }} = F;\n"
    ts += code + "}\n"
ts += "\n/** the logic's functions, in the order the controller runs them (ECAM-controller.nas loop) */\n"
ts += "export const LOGIC = [" + ", ".join(TSNAME[n] for n, _ in FUNCS) + "];\n"


def lit(e):
    if e[0] == "num":
        return e[1]
    if e[0] == "str":
        return e[1]
    if e[0] == "vec":
        return [lit(x) for x in e[1]]
    return None


ts += "\n/** the logic's own variables at their start (ECAM-logic.nas's top) */\nexport const LOCALS = (): Record<string, unknown> => (" + json.dumps({k: lit(v) for k, v in LOCALS.items()}) + ");\n"
open(OUT + "logic.ts", "w").write(ts)

# ---- the messages
m = """// Generated by scripts/build-a320-fwc.py from FlightGear's A320-family (GPL v2): Nasal/ECAM/ECAM-messages.nas — the
// E/WD's warnings with their procedure lines, the T.O and LDG memos, the left memos, the right memos and special lines,
// the STATUS page's lines; in FlightGear's order (the order they are written in). Not edited by hand.

/** a message as FlightGear defines it: its text, its colour (r a g c w m), its aural (0 CRC, 1 single chime, 2 stall's
 *  cricket, 3 C-chord…, 9 none), its light (0 master warning, 1 master caution, 9 none), a main message (not a procedure
 *  line), the SD page it calls, a memo */
export interface MsgDef {
  name: string;
  kind: "warning" | "memo" | "status";
  msg: string;
  colour: string;
  aural?: number;
  light?: number;
  isMainMsg?: number;
  sdPage?: string;
  isMemo?: number;
}

"""
m += "/** every message's name (FlightGear's variables) */\nexport type MsgName = " + " | ".join(q(n) for n in sorted(MSG)) + ";\n\n"
for vname, items in VECTORS.items():
    m += f"export const {vname}: MsgDef[] = {json.dumps(items, ensure_ascii=False)};\n"
open(OUT + "messages.ts", "w").write(m)

# ---- the property rules (ecam-proprules.xml)
r = ET.parse(FG + "/Systems/ecam-proprules.xml").getroot()


def pcond(e):
    if e.tag == "property":
        return ["p", norm(e.text)]
    if e.tag == "not":
        return ["not", pcond(e[0])]
    if e.tag in ("equals", "not-equals"):
        a = e.find("property")
        v = e.findtext("value")
        c = ["eq", norm(a.text), float(v) if re.match(r"^-?[\d.]+$", v or "") else v]
        return c if e.tag == "equals" else ["not", c]
    if e.tag in ("and", "or"):
        return [e.tag] + [pcond(x) for x in e]
    raise ValueError(e.tag)


rules = []
for e in r:
    if e.tag == "flipflop":
        o = {"t": e.findtext("type"), "out": norm(e.findtext("output"))}
        for s in ("S", "R"):
            x = e.find(s)
            if x is not None:
                o[s] = pcond(x[0])
        if e.find("time") is not None:
            o["time"] = float(e.find("time").findtext("value"))
        if e.find("inverted") is not None:
            o["inv"] = True
        rules.append(o)
    elif e.tag == "filter":
        t = e.findtext("type")
        o = {"t": t, "out": norm(e.findtext("output"))}
        if t == "derivative":
            o["in"] = norm(e.findtext("input"))
            o["tf"] = float(e.findtext("filter-time"))
        else:
            o["gain"] = float(e.findtext("gain") or 1)
            o["ins"] = [{"cond": pcond(i.find("condition")[0]) if i.find("condition") is not None else None, "v": float(i.findtext("value"))} for i in e.findall("input")]
        rules.append(o)
json.dump({"source": "FlightGear A320-family (legoboyvdlp/A320-family, GPL v2): Systems/ecam-proprules.xml", "rules": rules}, open(OUT + "proprules.json", "w"), separators=(",", ":"))

json.dump({"unresolved": {k: sorted(v) for k, v in sorted(UNRESOLVED.items())}, "reads": sorted(READS), "writes": sorted(WRITES)}, open(os.environ.get("ECAM_IO", os.devnull), "w"), indent=1)
subprocess.run(["bunx", "biome", "format", "--write", OUT + "logic.ts", OUT + "messages.ts"], cwd=ROOT, capture_output=True)
n = sum(len(v) for v in VECTORS.values())
print(f"{OUT}: {len(FUNCS)} logic functions ({ts.count(chr(10))} lines), {n} messages, {len(rules)} property rules; {len(UNRESOLVED)} Nasal names unresolved")


# ---- What the ECAM reads that neither it nor the systems (A10) write: its inputs (src/a320/ecam/inputs.md)
def refs(o, acc, outs):
    if isinstance(o, dict):
        if "p" in o:
            acc.add(o["p"])
        for k, v in o.items():
            if k == "out":
                outs.update(v)
            elif k == "vars":
                acc.update(v)
            else:
                refs(v, acc, outs)
    elif isinstance(o, list):
        if len(o) == 2 and o[0] == "prop" and isinstance(o[1], str):
            acc.add(o[1])
        for v in o:
            refs(v, acc, outs)


fwcd = json.load(open(OUT + "fwcdata.json"))
f_reads, f_writes = set(), set()
refs(fwcd["systems"], f_reads, f_writes)
r_reads, r_writes = set(), set()
for x in rules:
    r_writes.add(x["out"])
    for k in ("S", "R"):
        if k in x:
            json.dumps(x[k], default=str)
            for m in re.findall(r'"(?:p|eq)", "([^"]+)"', json.dumps(x[k])):
                r_reads.add(m)
    if "in" in x:
        r_reads.add(x["in"])
    for i in x.get("ins", []):
        if i["cond"]:
            for m in re.findall(r'"(?:p|eq)", "([^"]+)"', json.dumps(i["cond"])):
                r_reads.add(m)
own = set(re.findall(r'"((?:ECAM|it-autoflight|sim/sound)/[^"]+)"', open(OUT + "index.ts").read() + open(OUT + "sd.ts").read()))
ecam_writes = f_writes | r_writes | WRITES | own
sysd = json.load(open(ROOT + "/src/a320/systems/sysdata.json"))
s_reads, s_writes = set(), set()
refs(sysd["systems"], s_reads, s_writes)
lit = set()
for d, _, fs in os.walk(ROOT + "/src/a320/systems"):
    for f in fs:
        if f.endswith(".ts"):
            lit.update(re.findall(r'["`]([a-zA-Z][\w-]*(?:/[\w\-\[\]${}.]+)+)["`]', open(d + "/" + f).read()))
# (their templates — adirs.ts's "…-#", sysinputs.ts's `${E}/…`, `gear/gear${k}/…` — expanded over the indices they take)
SUBS = ["", "[1]", "[2]", "[3]", "[4]", "[5]", "1", "2", "3", "engines/engine", "engines/engine[1]"]
by_sys = set(s_writes)
for k in lit:
    if "$" in k or "#" in k:
        for x in SUBS:
            by_sys.add(re.sub(r"\$\{[^}]*\}|#", x, k))
    else:
        by_sys.add(k)
reads = (f_reads | r_reads | READS) - ecam_writes
ins = sorted(k for k in reads if k not in by_sys)
given = sorted(k for k in reads if k in by_sys)
who = {}
for k in f_reads:
    who.setdefault(k, set()).add("FWC")
for k in r_reads:
    who.setdefault(k, set()).add("rules")
for k in READS:
    who.setdefault(k, set()).add("logic")
EGROUPS = [
    ("The Nasal objects' fields (the game's modules give them: index.ts bind() writes the fire's, the ADIRS's, the APU's)", r"^@"),
    ("The engines (the FADEC's — fadec.ts: oil, vibrations, the levers' detents, the reversers)", r"^(engines/|systems/fadec/|controls/engines/)"),
    ("The flight controls and their computers (FlightGear's a320-fbw.xml, a320-fcs.xml — the game's fbw.ts / fcs.ts)", r"^(systems/fcs/|systems/fbw/|fdm/jsbsim/fcs|fdm/jsbsim/fbw|it-fbw/|controls/flight/|systems/failures/(elevator|aileron|spoiler|rudder|elac|sec|fac|flap|slat))"),
    ("The autoflight and the FMGC (the game's fmgc/: its modes, its FMS's data)", r"^(it-autoflight/|FMGC/|it-fmgc|autopilot/|instrumentation/(fmc|mcdu)|fmgc)"),
    ("The air data, the instruments, the radios, TCAS, GPWS (the game's)", r"^(instrumentation/|systems/navigation/|systems/radio|position/|velocities/|environment/|orientation/)"),
    ("The gear, the brakes", r"^(gear/|systems/gear/|controls/gear/|systems/hydraulic/brakes|controls/autobrake)"),
    ("The failures the game injects (0 working)", r"^systems/failures/"),
    ("The deck's switches", r"^controls/"),
    ("The rest", r"."),
]
L = [
    "# The A320's ECAM: its inputs",
    "",
    "Generated by `scripts/build-a320-fwc.py`. What FlightGear's FWC files (`fwcdata.json`), its property rules",
    "(`proprules.json`) and its ECAM logic (`logic.ts`) read that none of them nor the systems (A10: `sysdata.json`,",
    "`systems/nasal`, `sysinputs.ts`) write — for the game to set on the bag. Unset, a property reads 0 (a Nasal",
    "object's field — `@…` — too): an engine's oil pressure at 0 is ENG OIL LO PR, the elevators' pressure switches",
    "at 0 F/CTL L+R ELEV FAULT; `ecamInputs()` (inputs.ts) gives them from the game's state until its own systems do.",
    "\"read by\": the FWC's files, the property rules, the logic.",
    "",
]
rest = ins
for title, rx in EGROUPS:
    mine = [k for k in rest if re.search(rx, k)]
    rest = [k for k in rest if k not in mine]
    if not mine:
        continue
    L += [f"## {title}", "", "| property | read by |", "|---|---|"]
    L += [f"| `{k}` | {', '.join(sorted(who.get(k, {'logic'})))} |" for k in mine]
    L.append("")
L += ["## Read from the systems (A10 writes them)", "", ", ".join(f"`{k}`" for k in given), ""]
open(OUT + "inputs.md", "w").write("\n".join(L))
print(f"inputs.md: {len(ins)} inputs, {len(given)} from the systems")
