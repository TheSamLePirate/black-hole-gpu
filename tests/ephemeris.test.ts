import { test, expect } from "bun:test";
import { bodyAxes, EPOCH_DATE, M_METRES, M_SECONDS, seenFrom, solarBody, solarState, sunShare } from "../src/system/solar";
import { addEphemeris } from "../src/system/de440";
import { J2000_MS, tdbOf } from "../src/system/timescale";
import { bodyFixedOf, fromBodyFixed } from "../src/system/our-surface";

type V = number[];
const sub = (a: V, b: V) => a.map((x, i) => x - b[i]!);
const dot = (a: V, b: V) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const ang = (a: V, b: V) => (Math.acos(Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b)))) * 180) / Math.PI;
const tOf = (iso: string | number) => ((typeof iso === "number" ? iso : Date.parse(iso)) - EPOCH_DATE) / 1000 / M_SECONDS;
const from = (obs: string, x: string, t: number) => sub(solarState(x, t).pos, solarState(obs, t).pos);
const sep = (a: string, b: string, iso: string) => ang(from("earth", a, tOf(iso)), from("earth", b, tOf(iso)));

test("time scales: TDB − UTC in 2026 is the leap seconds and 32.184 s", () => {
  const u = Date.parse("2026-08-12T18:00:00Z");
  expect(tdbOf(u) - (u - J2000_MS) / 1000).toBeCloseTo(69.184, 2);
  // (before the leap second of 2012-07-01: 34 s)
  const u2 = Date.parse("2012-06-06T00:00:00Z");
  expect(tdbOf(u2) - (u2 - J2000_MS) / 1000).toBeCloseTo(66.184, 2);
});

// (before DE440 is read: the analytic models — the Moon's epoch once 1.5 days off, 20° on the sky)
test("the models alone: the eclipses of 2024–2045 within a tenth of a degree of their geometry", () => {
  // the geocentric Sun–Moon separation at greatest eclipse ≈ γ × the Moon's parallax (~0.95°)
  for (const [iso, gamma] of [["2024-04-08T18:17:20Z", 0.3431], ["2026-08-12T17:46:06Z", 0.8977], ["2027-08-02T10:07:50Z", 0.1421], ["2045-08-12T17:42:39Z", 0.2116]] as const) {
    expect(Math.abs(sep("sun", "moon", iso) - gamma * 0.97)).toBeLessThan(0.1);
  }
});

test("DE440: the planets where they were", async () => {
  const dir = new URL("../assets/ephemeris/", import.meta.url).pathname;
  for (const f of ["de440.bin", "jup365.bin"]) addEphemeris(await Bun.file(dir + f).arrayBuffer());
  // the great conjunction of 2020 (0.10°), Mars' closest approach (62.07 Mkm), the transit of Venus
  expect(sep("jupiter", "saturn", "2020-12-21T18:00:00Z")).toBeCloseTo(0.102, 2);
  expect(Math.hypot(...from("earth", "mars", tOf("2020-10-06T14:18:00Z"))) * M_METRES / 1e9).toBeCloseTo(62.07, 1);
  expect(sep("sun", "venus", "2012-06-06T01:29:00Z")).toBeLessThan(0.17);
});

/** The Moon's shadow axis meets the Earth (WGS84): where, at a UTC instant [ms] — the light's delays in. */
function umbra(ms: number) {
  const t = tOf(ms);
  const E = solarState("earth", t).pos;
  const S = sub(seenFrom("sun", t, E).pos, E), M = sub(seenFrom("moon", t, E).pos, E);
  const n = sub(M, S).map((x, _, a) => x / Math.hypot(...a));
  const RE = 6378.137e3 / M_METRES, k = 1 / (1 - 1 / 298.257223563);
  const Ax = bodyAxes(solarBody("earth")!, t);
  const Mf = Ax.map((a) => dot(M, a)), nf = Ax.map((a) => dot(n, a));
  const Ms = [Mf[0]!, Mf[1]!, Mf[2]! * k], ns = [nf[0]!, nf[1]!, nf[2]! * k];
  const a2 = dot(ns, ns), b2 = 2 * dot(Ms, ns), c2 = dot(Ms, Ms) - RE * RE;
  const s = (-b2 - Math.sqrt(b2 * b2 - 4 * a2 * c2)) / (2 * a2);
  const P = Mf.map((x, i) => x + s * nf[i]!);
  const gamma = Math.hypot(...sub(M, n.map((x) => x * dot(M, n)))) / RE;
  const lat = (Math.atan(Math.tan(Math.atan2(P[2]!, Math.hypot(P[0]!, P[1]!))) * k * k) * 180) / Math.PI;
  return { gamma, lat, lon: (Math.atan2(P[1]!, P[0]!) * 180) / Math.PI };
}

test("the total eclipse of 12 August 2026: NASA's path (its UT: ΔT 71.4 s — UTC − 2.2 s)", () => {
  // greatest eclipse: 17:45:53.8 UT = 17:45:56.0 UTC, γ 0.8977, 65°13.5′N 25°13.7′W
  let best = { ms: 0, g: 9 };
  const t0 = Date.parse("2026-08-12T17:45:00Z");
  for (let s = 0; s < 120; s++) {
    const g = umbra(t0 + s * 1000).gamma;
    if (g < best.g) best = { ms: t0 + s * 1000, g };
  }
  expect(Math.abs(best.ms - Date.parse("2026-08-12T17:45:56Z"))).toBeLessThanOrEqual(3000);
  expect(best.g).toBeCloseTo(0.8977, 3);
  const at = umbra(Date.parse("2026-08-12T17:45:56Z"));
  expect(Math.abs(at.lat - 65.225)).toBeLessThan(0.03);
  expect(Math.abs(at.lon + 25.228)).toBeLessThan(0.05);
  // the central line at 18:26:00 UT (18:26:02.2 UTC): 44°42.8′N 8°23.9′W — the shadow 2 km/s over Galicia
  const c = umbra(Date.parse("2026-08-12T18:26:02.2Z"));
  expect(Math.abs(c.lat - 44.713)).toBeLessThan(0.05);
  expect(Math.abs(c.lon + 8.398)).toBeLessThan(0.08);
});

test("Burgos: 1 min 42 s of totality, the Sun wholly covered at 18:29 UTC, uncovered two minutes before", () => {
  const q = bodyFixedOf("earth", 42.34, -3.7, 900);
  const share = (iso: string) => {
    const t = tOf(iso);
    return sunShare(fromBodyFixed("earth", q, t), t);
  };
  expect(share("2026-08-12T18:29:01Z")).toBe(0);
  expect(share("2026-08-12T18:27:00Z")).toBeGreaterThan(0.001);
  expect(share("2026-08-12T18:10:00Z")).toBeGreaterThan(0.1);
  expect(share("2026-08-12T16:00:00Z")).toBe(1);
});

test("the Moon shows the Earth its near side (librations: ±10°); Io faces Jupiter", () => {
  for (const d of ["2026-08-12T00:00Z", "2067-01-10T00:00Z", "2067-03-01T00:00Z"]) {
    const t = tOf(d);
    expect(ang(bodyAxes(solarBody("moon")!, t)[0], from("moon", "earth", t))).toBeLessThan(11);
    expect(ang(bodyAxes(solarBody("io")!, t)[0], from("io", "jupiter", t))).toBeLessThan(0.1);
  }
});
