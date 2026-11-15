import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { cifpEnd } from "../scripts/build-approaches";
import { chooseApproach } from "../src/game/approach-choice";
import { wgs84Direct } from "../src/system/ellipsoid";
import { coord, kindOfLetter, procRunway, readCifp } from "../scripts/cifp";
import { approachesOf, decodeApproachTile } from "../src/world/approaches";
import { type Airfield, decodeTile, tileKey } from "../src/world/runways";

// The FAA's CIFP (docs/PLAN-APPROCHES.md AP0b): ARINC 424 read at its columns — KSFO's ILS 28R from the cycle 2611's own records
// (tests/fixtures/cifp-ksfo.txt, public domain): its localizer (CAT III, 111.70, its course true by the variation), its four
// transitions, the final from CEPIN « at or above 3 000 ft », the missed approach to VIKYU and its hold; a circling procedure left
// out. Then the tiles: the US's published approaches on our runways, preferred at their end, nav.dat's kept for another kind.

const FT = 0.3048;

test("the codes: a place in degrees-minutes-seconds, a procedure's runway and kind", () => {
  expect(coord("N37374636")).toBeCloseTo(37 + 37 / 60 + 46.36 / 3600, 9);
  expect(coord("W122234312")).toBeCloseTo(-(122 + 23 / 60 + 43.12 / 3600), 9);
  expect(procRunway("I28R")).toEqual({ rwy: "28R", sfx: "" });
  expect(procRunway("R19RZ")).toEqual({ rwy: "19R", sfx: "Z" });
  expect(procRunway("R12-Y")).toEqual({ rwy: "12", sfx: "Y" });
  expect(procRunway("VOR-A")).toBeNull();
  expect(kindOfLetter("H")).toBe("RNAV");
  expect(kindOfLetter("S")).toBe("VOR");
  expect(kindOfLetter("B")).toBeNull();
});

test("KSFO's ILS 28R read whole: localizer, transitions, final, missed approach; a circling one left out", () => {
  const d = readCifp(readFileSync("tests/fixtures/cifp-ksfo.txt", "latin1"));
  expect(d.cycle).toBe("2611");
  expect(d.report.left["circling (no runway)"]).toBe(1);
  const p = d.procs.find((x) => x.field === "KSFO" && x.id === "I28R")!;
  expect(p.kind).toBe("ILS");
  expect(p.loc).toMatchObject({ ident: "IGWQ", freq: 111_700, cat: "III" });
  // (283.8° magnetic, 14° east: 297.8° true — the runway's own heading)
  expect(p.loc!.crs).toBeCloseTo(297.8, 1);
  expect(p.loc!.gs!.angle).toBe(3);
  expect(p.transitions.map((t) => t.name).sort()).toEqual(["ARCHI", "DUMBA", "EDDYY", "SIDBY"]);
  expect(p.final.map((l) => l.fix)).toEqual(["CEPIN", "AXMUL", "RW28R"]);
  // (CEPIN: J — at or above 3 000 ft, the glide met at 1 800)
  expect(p.final[0]!.alt).toEqual([Math.round(3000 * FT), null]);
  expect(p.final[0]!.lat).toBeCloseTo(37.536, 3);
  expect(p.missed.map((l) => `${l.t} ${l.fix}`)).toEqual(["CF VIKYU", "HM VIKYU"]);
  expect(p.missed[0]!.alt![0]).toBe(Math.round(3000 * FT));
});

const fields = new Map<string, Airfield>();
const field = (code: string): Airfield => {
  if (!fields.size)
    for (const f of readdirSync("assets/runways/v1"))
      if (/^t-?\d/.test(f))
        for (const a of decodeTile(JSON.parse(readFileSync(`assets/runways/v1/${f}`, "utf8")))) fields.set(a.icao || a.ident, a);
  return fields.get(code)!;
};
const of = (code: string) => {
  const f = field(code);
  const t = decodeApproachTile(JSON.parse(readFileSync(`assets/approaches/v1/t${tileKey(f.lat, f.lon)}.json`, "utf8")));
  return approachesOf(
    f,
    t.records.filter((r) => r.f === f.ident),
    t.cycle,
    t.cifp.filter((r) => r.f === f.ident),
    t.cifpCycle,
  );
};

test("San Francisco from the tiles: the CIFP's ILS 28R preferred to nav.dat's, its RNAV ones, the LDA kept, every end built", () => {
  const ksfo = of("KSFO");
  const i28r = ksfo.filter((a) => a.rwy === "28R" && a.kind === "ILS");
  expect(i28r.length).toBe(1);
  expect(i28r[0]).toMatchObject({ id: "I28R", source: "cifp", cycle: "2611" });
  expect(i28r[0]!.transitions.length).toBe(4);
  expect(i28r[0]!.missed.at(-1)!.t).toBe("HM");
  const rnav = ksfo.find((a) => a.id === "R28R-Z")!;
  expect(rnav.kind).toBe("RNAV");
  // (an RNAV with its vertical path: 250 ft, said)
  expect(rnav.dh.why).toMatch(/vertical path/);
  expect(ksfo.some((a) => a.kind === "LDA" && a.rwy === "28R" && a.source === "navdat")).toBe(true);
  for (const rw of field("KSFO").runways)
    for (const end of [rw.le, rw.he]) expect(ksfo.some((a) => a.rwy === end && a.source === "built")).toBe(true);
});

test("the CIFP tied: 99 % of its approaches on our runways, small fields by K + their identifier, renumbered ends on their course", () => {
  const r = JSON.parse(readFileSync("assets/approaches/v1/report.json", "utf8")) as {
    cifp: { cycle: string; tied: number; renamed: number; read: { kept: number }; left: Record<string, number> };
  };
  expect(r.cifp.cycle).toBe("2611");
  expect(r.cifp.tied / r.cifp.read.kept).toBeGreaterThan(0.99);
  // (a renumbered end, a side letter missing at ours)
  const pabt = field("PABT");
  expect(cifpEnd(pabt, "02")).toBe(pabt.runways[0]!.le);
  expect(of("K02A").some((a) => a.source === "cifp" && a.kind === "RNAV")).toBe(true);
});

test("the automatic choice reads them: San Francisco from the south-east, calm — a published ILS 28, its source the CIFP", () => {
  const f = field("KSFO");
  const p = wgs84Direct(f.lat, f.lon, (120 * Math.PI) / 180, 40_000);
  const c = chooseApproach(f, of("KSFO"), { ...p, track: 300, minLen: 1500, paved: true, xwind: 15 }, { from: 0, spd: 0 })!;
  expect(c.a.kind).toBe("ILS");
  expect(c.a.rwy).toMatch(/^28[LR]$/);
  expect(c.a.source).toBe("cifp");
});
