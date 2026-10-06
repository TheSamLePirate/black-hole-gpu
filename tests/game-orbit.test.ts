import { expect, test } from "bun:test";
import { classify, elements, stateFrom, type Axes } from "../src/game/orbit";

const MU = 398600.4418; // km³/s², the Earth
const R = 6371;

test("elements ↔ state round trip (inclined, eccentric, in tilted axes)", () => {
  const c = Math.cos(0.4),
    s = Math.sin(0.4);
  const axes: Axes = [
    [1, 0, 0],
    [0, c, s],
    [0, -s, c],
  ];
  const spec = { rp: R + 300, ra: R + 20000, i: 51.6, raan: 120, argPe: 40, nu: 75 };
  const { r, v } = stateFrom(MU, spec, axes);
  const el = elements(MU, r, v, axes);
  expect(el.rp).toBeCloseTo(R + 300, 6);
  expect(el.ra).toBeCloseTo(R + 20000, 5);
  expect((el.i * 180) / Math.PI).toBeCloseTo(51.6, 9);
  expect((el.raan * 180) / Math.PI).toBeCloseTo(120, 9);
  expect((el.argPe * 180) / Math.PI).toBeCloseTo(40, 8);
  expect((el.nu * 180) / Math.PI).toBeCloseTo(75, 8);
});

test("times to the apsides: a quarter orbit after periapsis", () => {
  const { r, v } = stateFrom(MU, { rp: R + 400, ra: R + 400, nu: 90 });
  const el = elements(MU, r, v);
  // circular: the node origin stands for the periapsis (ν from it)
  expect(el.tPe / el.period).toBeCloseTo(0.75, 6);
  expect(el.tAp / el.period).toBeCloseTo(0.25, 6);
  const h = stateFrom(MU, { a: -20000, e: 1.5, nu: -30 });
  const eh = elements(MU, h.r, h.v);
  expect(eh.tPe).toBeGreaterThan(0);
  expect(eh.e).toBeCloseTo(1.5, 9);
});

test("classify: orbit, suborbital, flight, escape, hyperbolic, landed", () => {
  const vc = Math.sqrt(MU / (R + 400));
  const at = (rv: [number, number, number], vv: [number, number, number]) => elements(MU, rv, vv);
  const opts = { R, airTop: R + 100, soi: 924000 };
  expect(classify(at([R + 400, 0, 0], [0, vc, 0]), opts)).toBe("orbit");
  expect(classify(at([R + 400, 0, 0], [0, 0.8 * vc, 0]), opts)).toBe("suborbital");
  expect(classify(at([R + 10, 0, 0], [0.2, 0.3, 0]), opts)).toBe("flight");
  expect(classify(at([R + 400, 0, 0], [0, 1.412 * vc, 0]), opts)).toBe("escape");
  expect(classify(at([R + 400, 0, 0], [0, 1.5 * vc, 0]), opts)).toBe("hyperbolic");
  expect(classify(at([R, 0, 0], [0, 0, 0]), { ...opts, landed: true })).toBe("landed");
});

test("placing the Ranger: an orbit around Mars, in its sphere of influence, relative to its equator", async () => {
  const { ourOrbitPose, equatorAxes } = await import("../src/game/place");
  const { solarBody, solarState, M_METRES } = await import("../src/system/solar");
  const t = 1234.5;
  const p = ourOrbitPose({ body: "mars", peKm: 300, apKm: 1200, inc: 30, nu: 75 }, t);
  const b = solarBody("mars")!;
  const B = solarState("mars", t);
  const r = [0, 1, 2].map((i) => p.X[i]! - B.pos[i]!) as [number, number, number];
  const v = [0, 1, 2].map((i) => p.vel[i]! - B.vel[i]!) as [number, number, number];
  const el = elements(b.mass, r, v, equatorAxes("mars"));
  const km = M_METRES / 1e3;
  expect((el.rp - b.radius) * km).toBeCloseTo(300, 3);
  expect((el.ra - b.radius) * km).toBeCloseTo(1200, 3);
  expect((el.i * 180) / Math.PI).toBeCloseTo(30, 8);
  expect(() => ourOrbitPose({ body: "moon", altKm: 200000 }, t)).toThrow();
});

test("a planet frame's turning rate: Hill's equations give n", async () => {
  const { frameRate } = await import("../src/game/place");
  const n = 0.01;
  // (proper matrix of Hill's equations: ẍ = 3n²x + 2n ẏ, ÿ = −2n ẋ)
  const A = [
    [0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 1],
    [3 * n * n, 0, 0, 0, 2 * n, 0],
    [0, 0, 0, -2 * n, 0, 0],
    [0, 0, -n * n, 0, 0, 0],
  ];
  expect(frameRate({ A })).toBeCloseTo(n, 12);
});

test("the HUD's Pe is the orbit's lowest point over the Earth's ellipsoid: under the air's top, the status suborbital", async () => {
  const { rangerStatus } = await import("../src/game/status");
  const { equatorAxes } = await import("../src/game/place");
  const { solarBody, solarState, M_METRES } = await import("../src/system/solar");
  const { WGS84_F } = await import("../src/system/ellipsoid");
  const earth = solarBody("earth")!;
  const b = earth.radius * (1 - WGS84_F);
  const km = 1e3 / M_METRES;
  // (polar, its periapsis over the north pole 106.4 km up — over the air's 102 km —, 15 km of swing: the
  // lowest point, nearer the equator, 92 km up)
  const t = 0;
  const o = stateFrom(earth.mass, { rp: b + 106.4 * km, ra: b + 121.4 * km, i: 90, argPe: 90, nu: 150 }, equatorAxes("earth"));
  const E = solarState("earth", t);
  const info = {
    region: "ours",
    ref: "earth",
    X: o.r.map((x, i) => x + E.pos[i]!),
    V: o.v.map((x, i) => x + E.vel[i]!),
    landed: false,
    target: null,
    ourFree: null,
  } as unknown as Parameters<typeof rangerStatus>[2];
  const st = rangerStatus({ massSolar: 1e8 } as Parameters<typeof rangerStatus>[0], {} as Parameters<typeof rangerStatus>[1], info, t);
  expect(st.status).toBe("suborbital");
  expect(st.orbit!.peKm).toBeLessThan(102);
  expect(st.orbit!.peKm).toBeGreaterThan(90);
  // (and its highest point over the pole the other side, 121.4 km up)
  expect(st.orbit!.apKm).toBeCloseTo(121.4, 3);
});
