import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { endName, readNavDat, tieLocalizer } from "../scripts/build-approaches";
import { wgs84Inverse } from "../src/system/ellipsoid";
import { type ApproachRecord, approachesOf, BUILT, builtApproach, decodeApproachTile } from "../src/world/approaches";
import { type Airfield, decodeTile, tileKey } from "../src/world/runways";

// The approaches' data (docs/PLAN-APPROCHES.md AP0): nav.dat's ILS tied to our runways — by name, by geometry when renumbered
// since 2013 —, its slopes read right, a closed field left out; every end of every runway an approach, built where nav.dat has
// none, its fixes on the extended centreline at FlightGear's distances.

const FT = 0.3048,
  NM = 1852;
const fields = new Map<string, Airfield>();
const field = (code: string): Airfield => {
  if (!fields.size)
    for (const f of readdirSync("assets/runways/v1"))
      if (/^t-?\d/.test(f))
        for (const a of decodeTile(JSON.parse(readFileSync(`assets/runways/v1/${f}`, "utf8")))) fields.set(a.icao || a.ident, a);
  return fields.get(code)!;
};
const records = (f: Airfield): { cycle: string; records: ApproachRecord[] } => {
  const t = decodeApproachTile(JSON.parse(readFileSync(`assets/approaches/v1/t${tileKey(f.lat, f.lon)}.json`, "utf8")));
  return { cycle: t.cycle, records: t.records.filter((r) => r.f === f.ident) };
};
const of = (code: string) => {
  const f = field(code);
  const r = records(f);
  return approachesOf(f, r.records, r.cycle);
};

test("nav.dat's rows read: a localizer's true course, a glide's slope (300134.020: 3.00°), heights in metres", () => {
  const rows = readNavDat(
    [
      "4  43.44950104  005.19671679     74 11115  27     314.121 MPV  LFML 31R ILS-cat-I",
      "6  43.43247500  005.21898700     31 11115  27  400314.020 MPV  LFML 31R GS",
    ].join("\n"),
  );
  expect(rows[0]).toMatchObject({ type: 4, freq: 111150, extra: 314.121, ident: "MPV", field: "LFML", rwy: "31R" });
  expect(Math.floor(rows[1]!.extra / 1000) / 100).toBe(4);
  expect(rows[1]!.elev).toBeCloseTo(31 * FT, 6);
  expect(endName("09L")).toBe("9L");
});

test("a localizer tied by name, and by geometry when its runway was renumbered (BIKF's 02/20 now 01/19)", () => {
  const bikf = field("BIKF");
  const named = tieLocalizer(
    { type: 4, lat: 0, lon: 0, elev: 0, freq: 0, range: 18, extra: 0, ident: "X", field: "BIKF", rwy: "99", name: "ILS" },
    bikf,
  );
  expect("why" in named).toBe(true);
  const ap = of("BIKF");
  const i01 = ap.find((a) => a.id === "I01")!;
  expect(i01.was).toBe("02");
  expect(i01.loc!.ident).toBe("IKN");
});

test("Marseille: three ILS — 31R's glide 4°, its frequency 111.15 —, a built approach at every end", () => {
  const ap = of("LFML");
  const i31r = ap.find((a) => a.id === "I31R")!;
  expect(i31r.kind).toBe("ILS");
  expect(i31r.loc!.freq).toBe(111150);
  expect(i31r.angle).toBe(4);
  expect(i31r.dh.m).toBeCloseTo(200 * FT, 6);
  expect(
    ap
      .filter((a) => a.source === "navdat")
      .map((a) => a.id)
      .sort(),
  ).toEqual(["I13L", "I13R", "I31R"]);
  const ends = field("LFML").runways.flatMap((r) => [r.le, r.he]);
  for (const e of ends) expect(ap.some((a) => a.rwy === e && a.source === "built")).toBe(true);
});

test("Roissy's eight CAT III ILS; San Francisco's 28R ILS and its LDA; Tegel closed: none", () => {
  const lfpg = of("LFPG").filter((a) => a.kind === "ILS");
  expect(lfpg.length).toBe(8);
  expect(lfpg.every((a) => a.loc!.cat === "III" && a.dh.m < 20)).toBe(true);
  const ksfo = of("KSFO");
  expect(ksfo.some((a) => a.id === "I28R" && a.loc!.cat === "III")).toBe(true);
  expect(ksfo.some((a) => a.kind === "LDA" && a.rwy === "28R")).toBe(true);
  const report = JSON.parse(readFileSync("assets/approaches/v1/report.json", "utf8")) as {
    leftOut: string[];
    tied: number;
    localizers: number;
  };
  expect(report.leftOut.some((l) => l.startsWith("EDDT ") && l.endsWith(": field"))).toBe(true);
  expect(report.tied / report.localizers).toBeGreaterThan(0.9);
});

test("a built approach: IAF 12 NM, IF 8 NM at the threshold + 2 000 ft, the FAF where a 3° glide meets that height, on the centreline", () => {
  const f = field("LFTH");
  const a = builtApproach(f, f.runways[0]!.le)!;
  expect(a.source).toBe("built");
  expect(a.kind).toBe("VIS");
  const [iff, faf, thr] = a.final;
  const d = (p: { lat?: number; lon?: number }) => wgs84Inverse(a.thr.lat, a.thr.lon, p.lat!, p.lon!);
  expect(d(iff!).d).toBeCloseTo(BUILT.ifNm * NM, -1);
  expect(d(faf!).d).toBeCloseTo(((BUILT.ifFt - BUILT.tchFt) * FT) / Math.tan((3 * Math.PI) / 180), -1);
  expect(iff!.alt![0]).toBeCloseTo(a.thr.elev + BUILT.ifFt * FT, 6);
  expect(thr!.fix).toBe(`RW${a.rwy.replace(/^0+(?=\d)/, "")}`);
  // (the IF behind the threshold: on the course flown back)
  const off = Math.abs((((((d(iff!).az * 180) / Math.PI - (a.crs + 180) + 540) % 360) + 360) % 360) - 180);
  expect(off).toBeLessThan(0.1);
  expect(a.missed[0]!.t).toBe("CA");
});

test("every end of every runway of a handful of fields has an approach", () => {
  for (const code of ["LFTH", "LFML", "LFPG", "KSFO", "BIKF", "LSZH", "RJTT"]) {
    const f = field(code);
    const ap = of(code);
    for (const rw of f.runways.filter((r) => r.surface !== "water"))
      for (const e of [rw.le, rw.he]) expect(ap.some((a) => a.rwy === e)).toBe(true);
  }
});
