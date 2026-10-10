import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { addEphemeris } from "../src/system/de440";
import { lunarEclipses, solarEclipses, solarLocal, solarPath } from "../src/eclipse/earth-moon";
import { phenomena, transits, worldEclipses } from "../src/eclipse/moons";

// PLAN-CIEL C5: the eclipse calculator against NASA's (F. Espenak's) figures. Its times are in TD with a
// predicted ΔT; ours are UTC: NASA's TD less the ΔT that came (69.2 s in 2024–2026). Our magnitudes, from
// the Moon's mean radius (NASA's umbra a k of 0.272281), run ~0.001 higher.

beforeAll(() => {
  for (const f of ["de440.bin", "jup365.bin"]) {
    const b = readFileSync(`assets/ephemeris/${f}`);
    addEphemeris(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
});

const S = 1000;
const TD = (iso: string) => Date.parse(`${iso}Z`) - 69.2 * S;

test("the solar eclipses of 2024–2027: types, greatest moments, gamma, magnitudes, paths, saros", () => {
  const es = solarEclipses(Date.UTC(2024, 0, 1), Date.UTC(2028, 0, 1));
  expect(es.map((e) => `${new Date(e.t).toISOString().slice(0, 10)} ${e.type}`)).toEqual([
    "2024-04-08 total",
    "2024-10-02 annular",
    "2025-03-29 partial",
    "2025-09-21 partial",
    "2026-02-17 annular",
    "2026-08-12 total",
    "2027-02-06 annular",
    "2027-08-02 total",
  ]);
  const [apr24, , , , , aug26, , aug27] = es;
  // (2024 Apr 08: greatest 18:18:26 TD, γ 0.3432, magnitude 1.0565, 25°17.5′N 104°07.2′W, 4m28s, 197.5 km)
  expect(Math.abs(apr24!.t - TD("2024-04-08T18:18:26"))).toBeLessThan(10 * S);
  expect(apr24!.gamma).toBeCloseTo(0.3432, 3);
  expect(apr24!.magnitude).toBeCloseTo(1.0565, 2);
  expect(apr24!.greatest.lat).toBeCloseTo(25.29, 1);
  expect(apr24!.greatest.lon).toBeCloseTo(-104.12, 1);
  expect(Math.abs(apr24!.greatest.duration - 268)).toBeLessThan(6);
  expect(Math.abs(apr24!.greatest.width - 197.5)).toBeLessThan(8);
  expect(apr24!.saros).toBe(139);
  // (2026 Aug 12: γ 0.8977, saros 126, over Iceland's sea; 2027 Aug 02: 6m23s, the century's longest near)
  expect(aug26!.gamma).toBeCloseTo(0.8977, 3);
  expect(aug26!.saros).toBe(126);
  expect(aug27!.gamma).toBeCloseTo(0.1421, 3);
  expect(Math.abs(aug27!.greatest.duration - 383)).toBeLessThan(6);
  // (partial ones: gamma beyond 1)
  expect(Math.abs(es[2]!.gamma)).toBeGreaterThan(1);
  expect(es[2]!.magnitude).toBeCloseTo(0.9376, 2);
});

test("the path of 2026 Aug 12 crosses Spain; Burgos sees it total, near sunset", () => {
  const e = solarEclipses(Date.UTC(2026, 7, 10), Date.UTC(2026, 7, 14))[0]!;
  const p = solarPath(e, 60e3);
  expect(p.centre.length).toBeGreaterThan(50);
  // (the central line's last points over Spain, west to east, before the Mediterranean)
  expect(p.centre.some(([la, lo]) => la > 40 && la < 44 && lo > -6 && lo < 0)).toBe(true);
  const D = Math.PI / 180;
  const burgos = solarLocal(42.34 * D, -3.7 * D, 860, e.t);
  expect(burgos.type).toBe("total");
  expect(burgos.sunAlt).toBeGreaterThan(5);
  expect(burgos.sunAlt).toBeLessThan(15);
  const c2 = burgos.contacts.find((c) => c.name === "C2")!.t,
    c3 = burgos.contacts.find((c) => c.name === "C3")!.t;
  expect((c3 - c2) / S).toBeGreaterThan(60);
  expect((c3 - c2) / S).toBeLessThan(120);
  // (Paris: a deep partial one)
  const paris = solarLocal(48.86 * D, 2.35 * D, 35, e.t);
  expect(paris.type).toBe("partial");
  expect(paris.magnitude).toBeGreaterThan(0.9);
});

test("the lunar eclipses of 2024–2026 (Danjon's shadow): magnitudes, gamma, durations, saros", () => {
  const es = lunarEclipses(Date.UTC(2024, 0, 1), Date.UTC(2027, 0, 1));
  expect(es.map((e) => `${new Date(e.t).toISOString().slice(0, 10)} ${e.type}`)).toEqual([
    "2024-03-25 penumbral",
    "2024-09-18 partial",
    "2025-03-14 total",
    "2025-09-07 total",
    "2026-03-03 total",
    "2026-08-28 partial",
  ]);
  // (2025 Sep 07: greatest 18:12:57.9 TD, umbral 1.3619, penumbral 2.3440, γ −0.2752, totality 82m06s, saros 128)
  const sep = es[3]!;
  expect(Math.abs(sep.t - TD("2025-09-07T18:12:57.9"))).toBeLessThan(10 * S);
  expect(sep.umbral).toBeCloseTo(1.3619, 2);
  expect(sep.penumbral).toBeCloseTo(2.344, 2);
  expect(sep.gamma).toBeCloseTo(-0.2752, 3);
  expect(Math.abs(sep.total - 4926)).toBeLessThan(60);
  expect(sep.saros).toBe(128);
  expect(sep.contacts.map((c) => c.name)).toEqual(["P1", "U1", "U2", "U3", "U4", "P4"]);
  expect(es[5]!.umbral).toBeCloseTo(0.93, 2);
});

test("Mercury's and Venus's transits: 2032, 2039, 2049; 2117, 2125", () => {
  const m = transits("mercury", Date.UTC(2030, 0, 1), Date.UTC(2050, 0, 1));
  expect(m.map((x) => new Date(x.t).toISOString().slice(0, 13))).toEqual(["2032-11-13T08", "2039-11-07T08", "2049-05-07T14"]);
  const v = transits("venus", Date.UTC(2100, 0, 1), Date.UTC(2130, 0, 1));
  expect(v.map((x) => new Date(x.t).toISOString().slice(0, 10))).toEqual(["2117-12-11", "2125-12-08"]);
});

test("Jupiter's moons: Io eclipsed ~2 h 15 every 1.77 day; each moon's four phenomena in turn", () => {
  const ph = phenomena("jupiter", Date.UTC(2050, 0, 1), Date.UTC(2050, 0, 15));
  const io = ph.filter((p) => p.moon === "io" && p.what === "ecl" && !Number.isNaN(p.start) && !Number.isNaN(p.end));
  expect(io.length).toBeGreaterThanOrEqual(7);
  for (const e of io) expect((e.end - e.start) / 60e3).toBeGreaterThan(120);
  for (let i = 1; i < io.length; i++) expect((io[i]!.start - io[i - 1]!.start) / 86400e3).toBeCloseTo(1.769, 1);
  for (const w of ["ecl", "occ", "tra", "sha"] as const) expect(ph.some((p) => p.what === w && p.moon === "ganymede")).toBe(true);
});

test("eclipses from other worlds: the Earth hiding the Sun from the Moon at its eclipses; Titan's shadow on Saturn in 2025", () => {
  const m = worldEclipses("moon", "earth", Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1));
  expect(m.map((x) => new Date(x.t).toISOString().slice(0, 10))).toEqual(["2025-03-14", "2025-09-07"]);
  expect(m.every((x) => x.type === "total")).toBe(true);
  expect(worldEclipses("saturn", "titan", Date.UTC(2025, 0, 1), Date.UTC(2025, 6, 1)).length).toBeGreaterThan(5);
});
