// Contract: the OBC telemetry schema (`/obc/telemetry.json`, v1) is declared four times — the host's TypeScript type
// (src/obc/types.ts `ObcTelemetry`), the Rust guest crate (obc-core/src/telemetry.rs), the Python and the Node guest
// libraries (scripts/obc/lib/obc.py, obc.mjs `TELEMETRY_FIELDS`). This test reads the field names out of each source
// so a field added, renamed or dropped on one side only fails here instead of silently reading 0 in a guest app.
// It also checks the display-unit helpers (metric by default, like src/ui/unitsys.ts) and the Node WGS84 inverse.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { emptyTelemetry } from "../src/obc/protocol";
import { unitsOf as hostUnitsOf } from "../src/ui/unitsys";
// @ts-expect-error — a plain ES module of the guest library (no type declarations)
import { TELEMETRY_FIELDS as JS_FIELDS, unitsOf as guestUnitsOf, wgs84BearingDist, wgs84Inverse } from "../scripts/obc/lib/obc.mjs";

const root = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Dotted leaf paths of `ObcTelemetry`, from the TypeScript AST (nested object literals, `| null` unions included). */
function tsTelemetryPaths(): string[] {
  const src = ts.createSourceFile("types.ts", read("src/obc/types.ts"), ts.ScriptTarget.Latest, true);
  let iface: ts.InterfaceDeclaration | undefined;
  src.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === "ObcTelemetry") iface = n;
  });
  if (!iface) throw new Error("ObcTelemetry not found in src/obc/types.ts");
  const out: string[] = [];
  const literalOf = (t: ts.TypeNode | undefined): ts.TypeLiteralNode | undefined => {
    if (!t) return undefined;
    if (ts.isTypeLiteralNode(t)) return t;
    if (ts.isUnionTypeNode(t)) return t.types.map(literalOf).find(Boolean);
    if (ts.isParenthesizedTypeNode(t)) return literalOf(t.type);
    return undefined;
  };
  const walk = (members: ts.NodeArray<ts.TypeElement>, prefix: string) => {
    for (const m of members) {
      if (!ts.isPropertySignature(m) || !m.name) continue;
      const name = m.name.getText(src);
      const lit = literalOf(m.type);
      if (lit) walk(lit.members, `${prefix}${name}.`);
      else out.push(`${prefix}${name}`);
    }
  };
  walk(iface.members, "");
  return out.sort();
}

/** Dotted leaf paths of the Rust `Telemetry` struct, following nested structs (also inside `Option<…>`). */
function rustTelemetryPaths(): string[] {
  const src = read("rust/obc-suite/crates/obc-core/src/telemetry.rs");
  const structs = new Map<string, { name: string; ty: string }[]>();
  for (const m of src.matchAll(/pub struct (\w+)\s*\{([^}]*)\}/g)) {
    const fields = [...m[2]!.matchAll(/pub (\w+):\s*([^,\n]+),/g)].map((f) => ({ name: f[1]!, ty: f[2]!.trim() }));
    structs.set(m[1]!, fields);
  }
  const out: string[] = [];
  const walk = (struct: string, prefix: string) => {
    for (const f of structs.get(struct) ?? []) {
      const inner = /^Option<(\w+)>$/.exec(f.ty)?.[1] ?? f.ty;
      if (structs.has(inner)) walk(inner, `${prefix}${f.name}.`);
      else out.push(`${prefix}${f.name}`);
    }
  };
  if (!structs.has("Telemetry")) throw new Error("struct Telemetry not found in telemetry.rs");
  walk("Telemetry", "");
  return out.sort();
}

/** The Python library's `TELEMETRY_FIELDS` tuple. */
function pythonFields(): string[] {
  const src = read("scripts/obc/lib/obc.py");
  const block = /TELEMETRY_FIELDS: Tuple\[str, \.\.\.\] = \(([\s\S]*?)\n\)/.exec(src)?.[1];
  if (!block) throw new Error("TELEMETRY_FIELDS not found in obc.py");
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
}

/** Every key the Python `State` reads (`raw.get("…")`, and `pos.get("…")` where `pos = raw.get("position")`). */
function pythonStateReads(): string[] {
  const src = read("scripts/obc/lib/obc.py");
  const body = /class State:[\s\S]*?(?=\nclass )/.exec(src)?.[0] ?? "";
  const alias = new Map<string, string>([["raw", ""]]);
  for (const m of body.matchAll(/(\w+) = raw\.get\("(\w+)"\)/g)) alias.set(m[1]!, `${m[2]}.`);
  const out: string[] = [];
  for (const m of body.matchAll(/(\w+)\.get\("(\w+)"/g)) {
    const prefix = alias.get(m[1]!);
    if (prefix !== undefined) out.push(`${prefix}${m[2]}`);
  }
  return out;
}

/** Dotted leaf paths of a runtime object (null sub-objects are leaves). */
function flatten(o: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test("telemetry schema: TypeScript, Rust, Python and Node declare the same fields", () => {
  const tsPaths = tsTelemetryPaths();
  expect(tsPaths.length).toBeGreaterThan(50);
  expect(tsPaths).toContain("units");
  expect(tsPaths).toContain("nav.runway.dist_m");
  expect(rustTelemetryPaths()).toEqual(tsPaths);
  expect(pythonFields()).toEqual(tsPaths);
  expect([...(JS_FIELDS as string[])].sort()).toEqual(tsPaths);
});

test("telemetry schema: the parsers see a drift (witness on a mutated copy)", () => {
  // Positive witness: the AST reader would report a renamed field, so equality above is meaningful.
  const tsPaths = tsTelemetryPaths();
  const drifted = tsPaths.map((p) => (p === "flight.mach" ? "flight.mach_number" : p));
  expect(rustTelemetryPaths()).not.toEqual(drifted);
});

test("telemetry schema: Python State reads only fields that exist, emptyTelemetry is complete", () => {
  const tsPaths = new Set(tsTelemetryPaths());
  const isPathOrPrefix = (p: string) => tsPaths.has(p) || [...tsPaths].some((t) => t.startsWith(`${p}.`));
  const reads = pythonStateReads();
  expect(reads.length).toBeGreaterThan(25);
  for (const r of reads) expect({ field: r, known: isPathOrPrefix(r) }).toEqual({ field: r, known: true });
  // The host's boot-time frame carries every non-null leaf, and metric units by default.
  const empty = emptyTelemetry();
  expect(empty.units).toBe("metric");
  for (const p of flatten(empty as unknown as Record<string, unknown>)) {
    expect({ field: p, known: isPathOrPrefix(p) }).toEqual({ field: p, known: true });
  }
});

test("guest units: metric by default, imperial on request, the same strings as src/ui/unitsys.ts", () => {
  const prev = process.env.OBC_UNITS;
  delete process.env.OBC_UNITS;
  try {
    for (const sys of ["metric", "imperial"] as const) {
      const host = hostUnitsOf(sys);
      const guest = guestUnitsOf(sys);
      expect(guest.fSpd(240)).toBe(host.fSpd(240));
      expect(guest.fAlt(4500)).toBe(host.fAlt(4500));
      expect(guest.fDist(12_345)).toBe(host.fDist(12_345));
      expect(guest.alt(1828.8)).toBeCloseTo(host.alt(1828.8), 6);
      expect(guest.spd(205.778)).toBeCloseTo(host.spd(205.778), 3);
      expect(guest.vs(5.08)).toBeCloseTo(host.vs(5.08), 6);
    }
    expect(guestUnitsOf(undefined).sys).toBe("metric");
    expect(guestUnitsOf("bogus").sys).toBe("metric");
    process.env.OBC_UNITS = "imperial";
    expect(guestUnitsOf("metric").sys).toBe("imperial");
  } finally {
    if (prev === undefined) delete process.env.OBC_UNITS;
    else process.env.OBC_UNITS = prev;
  }
});

test("obc.mjs wgs84Inverse: Vincenty on the WGS84 ellipsoid (geodesic reference), not a sphere", () => {
  const dms = (d: number, m: number, s: number) => Math.sign(d) * (Math.abs(d) + m / 60 + s / 3600);
  // Vincenty (1975) / Geoscience Australia test line: Flinders Peak -> Buninyong, 54 972.271 m, azimuth 306°52'05.37".
  const r = wgs84Inverse(dms(-37, 57, 3.7203), dms(144, 25, 29.5244), dms(-37, 39, 10.1561), dms(143, 55, 35.3839));
  expect(r.approx).toBe(false);
  expect(Math.abs(r.distM - 54_972.271)).toBeLessThan(0.01);
  expect(Math.abs(r.bearingDeg - dms(306, 52, 5.37))).toBeLessThan(1e-4);
  // Along a meridian, 1° of latitude centred on 45° is 111 131.78 m on WGS84 (111 132.954 − 559.822 cos 2φ + 1.175 cos 4φ);
  // a sphere of mean radius gives 111 195 m.
  const m = wgs84BearingDist(44.5, 3, 45.5, 3);
  expect(Math.abs(m.distM - 111_131.78)).toBeLessThan(0.05);
  expect(m.bearingDeg).toBeCloseTo(0, 6);
  // Nearly antipodal: the documented fallback, flagged.
  const anti = wgs84Inverse(0, 0, 0.5, 179.7);
  expect(anti.distM).toBeGreaterThan(19_900_000);
  expect(wgs84Inverse(10, 20, 10, 20).distM).toBe(0);
});
