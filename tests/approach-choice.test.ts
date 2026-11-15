import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type Asker, chooseApproach, chooseField, type Wind } from "../src/game/approach-choice";
import { wgs84Direct } from "../src/system/ellipsoid";
import { approachesOf, decodeApproachTile } from "../src/world/approaches";
import { type Airfield, decodeTile, type Runway, tileKey } from "../src/world/runways";

// The automatic choice (docs/PLAN-APPROCHES.md §4.3, AP1): from the four quadrants, calm and with a strong wind, on fields of one,
// two and three runways — calm, the end whose approach comes from the craft's side; windy, the end into the wind wherever it
// comes from —; a real field's ILS taken; a tail wind over 10 kt left out; the field ahead before the one behind.

const KT = 0.514444;
const C = { lat: 43.1, lon: 6.15 };
const rwy = (le: string, he: string, hdg: number, len = 2500): Runway => {
  const a = wgs84Direct(C.lat, C.lon, ((hdg + 180) * Math.PI) / 180, len / 2),
    b = wgs84Direct(C.lat, C.lon, (hdg * Math.PI) / 180, len / 2);
  return {
    le,
    he,
    lat1: a.lat,
    lon1: a.lon,
    lat2: b.lat,
    lon2: b.lon,
    hdg,
    len,
    wid: 45,
    surface: "paved",
    lit: true,
    elev1: 10,
    elev2: 10,
    approx: false,
  };
};
const field = (runways: Runway[]): Airfield => ({
  ident: "XTST",
  icao: "XTST",
  iata: "",
  name: "Test",
  kind: "medium",
  lat: C.lat,
  lon: C.lon,
  elev: 10,
  city: "",
  scheduled: true,
  runways,
});
const at = (from: number, km = 40): Asker => {
  const p = wgs84Direct(C.lat, C.lon, (from * Math.PI) / 180, km * 1000);
  // (flying towards the field)
  return { ...p, track: (from + 180) % 360, minLen: 1800, paved: true, xwind: 30 * KT };
};
const calm: Wind = { from: 0, spd: 0 };
const pick = (f: Airfield, a: Asker, w: Wind) => chooseApproach(f, approachesOf(f, []), a, w)!.a.rwy;

const one = field([rwy("05", "23", 50)]);
const two = field([rwy("05", "23", 50), rwy("16", "34", 160)]);
const three = field([rwy("05", "23", 50), rwy("16", "34", 160), rwy("10", "28", 100)]);

test("calm: the end whose approach comes from the craft's side — 1, 2 and 3 runways, from N, E, S, W", () => {
  const want: Record<string, Record<number, string>> = {
    one: { 0: "23", 90: "23", 180: "05", 270: "05" },
    two: { 0: "16", 90: "23", 180: "34", 270: "05" },
    three: { 0: "16", 90: "28", 180: "34", 270: "10" },
  };
  for (const [name, f] of Object.entries({ one, two, three }))
    for (const from of [0, 90, 180, 270])
      expect(`${name} ${from}: ${pick(f, at(from), calm)}`).toBe(`${name} ${from}: ${want[name]![from]}`);
});

test("a strong wind (20 kt from 230°): the end into it, from every side", () => {
  const w: Wind = { from: 230, spd: 20 * KT };
  for (const f of [one, two, three]) for (const from of [0, 90, 180, 270]) expect(pick(f, at(from), w)).toBe("23");
});

test("a tail wind over 10 kt left out — the end into it taken though it is behind; its reason said", () => {
  const w: Wind = { from: 230, spd: 12 * KT };
  const c = chooseApproach(one, approachesOf(one, []), at(50), w)!;
  expect(c.a.rwy).toBe("23");
  expect(c.why.wind!.head).toBeGreaterThan(5);
  expect(c.table.find((s) => s.a.rwy === "05")!.out).toBe("tail wind");
});

test("the player's tail-wind limit (the Labo — PLAN-APPROCHES AP8): 12 kt behind accepted with 15, left out with 10 or 5", () => {
  const w: Wind = { from: 230, spd: 12 * KT };
  const out = (kt: number) =>
    chooseApproach(one, approachesOf(one, []), { ...at(50), tailMax: kt * KT }, w)!.table.find((s) => s.a.rwy === "05")!.out;
  expect(out(15)).toBeNull();
  expect(out(10)).toBe("tail wind");
  expect(out(5)).toBe("tail wind");
});

test("Marseille, calm: from the south-east its 31R ILS, from the north-west its 13L CAT III", () => {
  const raw = readFileSync("assets/runways/v1/t8_1.json", "utf8");
  const lfml = decodeTile(JSON.parse(raw)).find((f) => f.icao === "LFML")!;
  const tile = decodeApproachTile(JSON.parse(readFileSync(`assets/approaches/v1/t${tileKey(lfml.lat, lfml.lon)}.json`, "utf8")));
  const list = approachesOf(
    lfml,
    tile.records.filter((r) => r.f === "LFML"),
  );
  const from = (brg: number) => {
    const p = wgs84Direct(lfml.lat, lfml.lon, (brg * Math.PI) / 180, 40_000);
    return { ...p, track: (brg + 180) % 360, minLen: 1800, paved: true, xwind: 30 * KT };
  };
  const se = chooseApproach(lfml, list, from(135), calm)!;
  expect(se.a.id).toBe("I31R");
  expect(se.why.aid).toBe("ILS CAT I");
  expect(chooseApproach(lfml, list, from(315), calm)!.a.id).toBe("I13L");
});

test("the field ahead before a nearer one behind; none ahead: the nearest", () => {
  const ahead = { ...field([rwy("05", "23", 50)]), ident: "AHEAD", lat: 43.5, lon: 6.15 };
  const behind = { ...field([rwy("05", "23", 50)]), ident: "BEHIND", lat: 43.0, lon: 6.15 };
  const asker = { lat: 43.1, lon: 6.15, track: 0, minLen: 1800, paved: true, xwind: 15 };
  expect(chooseField([ahead, behind], asker)!.f.ident).toBe("AHEAD");
  expect(chooseField([behind], asker)).toMatchObject({ ahead: false });
});

test("Le Bourget, the A320 (2 000 m): never its 09/27 of 1 854 m — overrun there with its ILS 27 taken, 15 Nov 2026", () => {
  const lfpb = decodeTile(JSON.parse(readFileSync("assets/runways/v1/t9_0.json", "utf8"))).find((f) => f.icao === "LFPB")!;
  const tile = decodeApproachTile(JSON.parse(readFileSync(`assets/approaches/v1/t${tileKey(lfpb.lat, lfpb.lon)}.json`, "utf8")));
  const list = approachesOf(
    lfpb,
    tile.records.filter((r) => r.f === "LFPB"),
  );
  for (const brg of [0, 90, 180, 270]) {
    const p = wgs84Direct(lfpb.lat, lfpb.lon, (brg * Math.PI) / 180, 30_000);
    const c = chooseApproach(lfpb, list, { ...p, track: (brg + 180) % 360, minLen: 2000, paved: true, xwind: 38 * KT }, calm)!;
    expect(`${brg}: ${c.a.rwy === "27" || c.a.rwy === "09"}`).toBe(`${brg}: false`);
  }
});

test("a built approach whose slope is not clear of the relief left out (« relief ») — Nice's 22R over Mont Agel, 15 Nov 2026", () => {
  // (from the east, calm: 23 in line; its slope « thin » over a ridge: 05 taken, 23 said out for the relief)
  const list = approachesOf(one, []);
  const thin = (a: { rwy: string }) => a.rwy === "23";
  const c = chooseApproach(one, list, at(50), calm, thin)!;
  expect(c.a.rwy).toBe("05");
  expect(c.table.find((s) => s.a.rwy === "23")!.out).toBe("relief");
  // (a real approach is published clear: never left out by it)
  expect(
    chooseApproach(
      one,
      list.map((a) => ({ ...a, source: "navdat" as const })),
      at(50),
      calm,
      thin,
    )!.a.rwy,
  ).toBe("23");
});

test("the runway's level: the data's, unless the relief stands over it by more than 150 m (OurAirports' 0 m at Minsk — AP10)", async () => {
  const { runwayOfApproach } = await import("../src/controller/approach");
  const f = field([rwy("05", "23", 50)]);
  const a = approachesOf(f, [])[0]!;
  const at = (g: number) => runwayOfApproach({ ...f }, { ...a, thr: { ...a.thr, elev: 0 } }, () => g).elev;
  expect(at(100)).toBe(0);
  expect(at(149)).toBe(0);
  expect(at(205)).toBe(205);
});
