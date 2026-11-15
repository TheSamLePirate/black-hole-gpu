import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { approachesOf, decodeApproachTile } from "../src/world/approaches";
import { approachFixes, approachLabel, approachText, drawApproach, holdOf, type MapApproach } from "../src/world/approach-draw";
import { type Airfield, decodeTile, tileKey } from "../src/world/runways";

// The approach drawn (docs/PLAN-APPROCHES.md AP4, world/approach-draw.ts — the tactical map now, the radar and the crew next):
// its card's lines, its fixes by role, its hold; drawn on a context — each part a place to click (the approach on its axis, its
// runway's end), the field's others too.

const field = (code: string): Airfield => {
  for (const n of readdirSync("assets/runways/v1"))
    if (/^t-?\d/.test(n)) {
      const f = decodeTile(JSON.parse(readFileSync(`assets/runways/v1/${n}`, "utf8"))).find((x) => x.icao === code);
      if (f) return f;
    }
  throw new Error(code);
};
const of = (f: Airfield) => {
  const t = decodeApproachTile(JSON.parse(readFileSync(`assets/approaches/v1/t${tileKey(f.lat, f.lon)}.json`, "utf8")));
  return approachesOf(
    f,
    t.records.filter((r) => r.f === f.ident),
    t.cycle,
    t.cifp.filter((r) => r.f === f.ident),
    t.cifpCycle,
  );
};

test("the card's lines and the fixes by role: Marseille's ILS 31R; San Francisco's 28R via ARCHI and its hold", () => {
  const lfml = of(field("LFML"));
  const i31r = lfml.find((a) => a.id === "I31R")!;
  expect(approachText(i31r)).toBe("ILS 31R · 111.15 · 4.0° · CAT I · nav.dat 2013");
  expect(approachLabel(i31r)).toBe("ILS 31R · CAT I · nav.dat 2013");
  expect(approachText(lfml.find((a) => a.id === "C31R")!)).toBe("Built 31R · 3.0°");
  const ksfo = of(field("KSFO"));
  const a = ksfo.find((x) => x.id === "I28R")!;
  const fx = approachFixes(
    a,
    a.transitions.find((t) => t[0]?.fix === "ARCHI"),
  );
  expect(fx.map((f) => `${f.role} ${f.name}`)).toEqual([
    "IAF ARCHI",
    "fix ZILED",
    "fix GIRRR",
    "fix DUMBA",
    "IF CEPIN",
    "FAF AXMUL",
    "MAP RW28R",
  ]);
  expect(holdOf(a)).toMatchObject({ right: true });
});

test("drawn: the parts to click — the approach on its axis, its runway's end, the field's others", () => {
  const f = field("LFML");
  const list = of(f);
  const a = list.find((x) => x.id === "I31R")!;
  const A: MapApproach = {
    id: a.id,
    field: "LFML",
    rwy: a.rwy,
    label: approachLabel(a),
    thr: a.thr,
    crs: a.crs,
    cone: true,
    fixes: approachFixes(a, null),
    missed: a.missed.filter((l) => l.lat !== undefined).map((l) => [l.lat!, l.lon!]),
    hold: null,
    join: [],
    engaged: false,
    profile: null,
    others: list
      .filter((x) => x.id !== a.id && x.source !== "built")
      .map((x) => ({ id: x.id, rwy: x.rwy, label: approachLabel(x), thr: x.thr, crs: x.crs })),
  };
  const calls: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, k) =>
      typeof k === "string" && !["strokeStyle", "fillStyle", "lineWidth", "font", "textAlign", "lineCap"].includes(k)
        ? (...a: unknown[]) => void calls.push(`${k}${a.length}`)
        : undefined,
    set: () => true,
  });
  const hits: { approach?: string; rwy?: string }[] = [];
  // (a flat projection: 1 px a 100 m about the field)
  drawApproach(ctx, A, {
    at: (lat, lon) => [(lon - f.lon) * 1113 * Math.cos((f.lat * Math.PI) / 180), -(lat - f.lat) * 1113],
    hit: (w) => hits.push(w),
  });
  expect(hits.some((h) => h.approach === "I31R")).toBe(true);
  expect(hits.some((h) => h.rwy === "31R")).toBe(true);
  expect(hits.filter((h) => h.approach && h.approach !== "I31R").length).toBe(A.others.length);
  expect(calls.filter((c) => c.startsWith("fillText")).length).toBeGreaterThan(2);
});
