// San Francisco's made-up traffic (tests/e2e/traffic-runways.e2e.test.ts, tests/e2e/traffic-cost.e2e.test.ts): the airliners as ADS-B
// would report them against the game's KSFO runways — one landing on 28L, one taking off from 01R, two in cruise, four parked at the
// international terminal's boarding area G —, the traffic's clock the test's, and the free camera's Chase view on one of them.
import { MESH } from "../../../src/game/airtypes";
import { runwayFrame } from "../../../src/game/sites";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../../../src/system/ellipsoid";
import { type Way, waysOf } from "../../../src/traffic/landing";
import type { App } from "./app";

const D = Math.PI / 180;
/** the traffic's clock at the start of the made-up reports [s] (the drawn moment: the clock less the 60 s delay) */
export const T0 = 1_900_000_000;
export const DELAY = 60;
/** KSFO's two runways used (OurAirports, assets/runways/v1 — as world/runways3d.ts frames them) */
const frame = (le: string, lat: number, lon: number, hdg: number, len: number) => {
  const f = runwayFrame({ body: "earth", name: `KSFO ${le}`, lat, lon, runway: true, rwy: hdg }, len, 30.5, 48);
  f.world = { field: "KSFO", measuring: false };
  return f;
};
export const W28L = waysOf(frame("10R", 37.6263, -122.39312, 117.8, 3469))[1]!;
export const W01R = waysOf(frame("1R", 37.60633, -122.38106, 27.81, 2638))[0]!;
/** the A320's wheels under its plain mesh's origin at 37.6 m (game/airtypes.ts MESH.a320t — its gear baked 24 Nov 2026) */
export const WHEELS = (MESH.a320t.wheels * 37.6) / MESH.a320t.len;

export function at(w: Way, a: number, c: number) {
  const q = [0, 1, 2].map((k) => w.o[k]! + w.d[k]! * a + w.r[k]! * c) as [number, number, number];
  const g = cartToGeodetic(WGS84_A, WGS84_F, q);
  return { lat: g.lat / D, lon: g.lon / D };
}
export function onWay(w: Way, lat: number, lon: number) {
  const q = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, 0);
  const v = [q[0] - w.o[0], q[1] - w.o[1], q[2] - w.o[2]];
  return { a: v[0]! * w.d[0] + v[1]! * w.d[1] + v[2]! * w.d[2], c: v[0]! * w.r[0] + v[1]! * w.r[1] + v[2]! * w.r[2] };
}
const glide3 = (x: number) => Math.max(0, x) * Math.tan(3 * D);

export type Plane = Record<string, unknown> & { t: number };
export const base = (id: string, cs: string, reg: string, type = "A320") => ({
  id,
  cs,
  reg,
  type,
  cat: type === "CRJ9" ? "A2" : "A3",
  hdg: null,
  roll: null,
  src: "adsb.lol",
});

/** the landing on 28L: a 3° final from 9 km at 70 m/s, 30 m north of the axis, 25 m high; « ground » from 700 m on; braking 2 m/s² */
export function landing(G: number): Plane[] {
  const out: Plane[] = [];
  let t = T0;
  for (let a = -9000; a < 2600; ) {
    const air = a < 700;
    const gs = a < 300 ? 70 : Math.max(12, Math.sqrt(Math.max(0, 70 * 70 - 4 * (a - 300))));
    out.push({
      ...base("e2e281", "E2E28L", "N28LTS"),
      ...at(W28L, a, 30),
      alt: G + WHEELS + (air ? glide3(300 - a) + 25 : 0),
      gs,
      trk: W28L.hdg,
      vs: a < 300 ? -3.67 : 0,
      gnd: !air,
      t,
    });
    a += gs * 4;
    t += 4;
  }
  return out;
}
/** the take-off from 01R from T0 + 20 s: 2 m/s² from 5 m/s, 15 m east of the axis, lift-off at 75 m/s, climbing 8 m/s reported 20 m high */
export function takeoff(G: number): Plane[] {
  const out: Plane[] = [];
  let t = T0 + 20,
    a = 0,
    gs = 5,
    h = 0;
  for (let k = 0; h < 1200; k++) {
    const air = gs >= 75;
    if (k % 6 === 0)
      out.push({
        ...base("e2e01r", "E2E01R", "N01RTS"),
        ...at(W01R, a, 15),
        alt: G + WHEELS + (air ? h + 20 : 0),
        gs,
        trk: W01R.hdg,
        vs: air ? 8 : 0,
        gnd: !air,
        t,
      });
    a += gs * 0.5;
    if (air) h += 4;
    else gs = Math.min(75, gs + 1);
    t += 0.5;
  }
  return out;
}
/** three parked at the international terminal's boarding area G, on its apron: OpenStreetMap's parking positions G2, G5, G6 (their
 *  lead-in lines' stop, 18 m back along them, the nose on their heading in — Overpass, 24 Nov 2026). Until 24 Nov 2026 they stood at
 *  N796UA's reported place and two beside — on the landside « Arrivals » road under the departures' deck and inside boarding area A's
 *  connector: the deck and the building hid them (parked-above.png), read then as an occlusion fault of the traffic's meshes. */
export const PARKED = [
  { id: "e2ep01", lat: 37.61795, lon: -122.390384, hdg: 207, cs: "UAL501", type: "A320" },
  { id: "e2ep02", lat: 37.618255, lon: -122.391106, hdg: 207, cs: "DAL77", type: "A320" },
  { id: "e2ep03", lat: 37.618556, lon: -122.391837, hdg: 208, cs: "SWA12", type: "B738" },
  // (a CRJ — the plain mesh, its gear baked — beside them, a stand further along the pier)
  { id: "e2ep04", lat: 37.618857, lon: -122.392568, hdg: 208, cs: "SKW5501", type: "CRJ9" },
];
/** two in cruise, drawn plain: American's 737 at 9 000 m 12 km north of the field (the rigged A320 left out by the measuring lever
 *  `trafficRigMax` for its shot: within 4 km of the view it would be the game's A320), SkyWest's CRJ at 4 500 m 8 km south; reports
 *  every 10 s along a straight track */
export function cruise(id: string, cs: string, type: string, lat: number, lon: number, trk: number, alt: number, gs: number): Plane[] {
  const out: Plane[] = [];
  for (let k = 0; k <= 44; k++) {
    const d = gs * 10 * k - gs * 220;
    out.push({
      ...base(id, cs, `N${id.slice(-3)}CR`, type),
      lat: lat + (d * Math.cos(trk * D)) / 111_000,
      lon: lon + (d * Math.sin(trk * D)) / (111_000 * Math.cos(lat * D)),
      alt,
      gs,
      trk,
      vs: 0,
      gnd: false,
      t: T0 + 10 * k,
    });
  }
  return out;
}

/** the moments judged [s after T0]: short final (a ≈ −600 m), rolled out, lift-off + 3 s, gear up */
export const FINAL = (9000 - 600) / 70;
export const ROLLOUT = (9000 + 300) / 70 + 6;
export const LIFTOFF = 20 + 35 + 3;
export const GEARUP = 20 + 35 + 30;

/** the eight airliners' reports: the landing, the take-off, two in cruise, the four parked (each held over 400 s) */
export function sfoPlanes(G28: number, G01: number): Plane[][] {
  return [
    landing(G28),
    takeoff(G01),
    cruise("e2ec01", "AAL100", "B738", 37.72, -122.39, 90, 9000, 230),
    cruise("e2ec02", "SKW3001", "CRJ9", 37.545, -122.36, 270, 4500, 180),
    ...PARKED.map((q) => [
      { ...base(q.id, q.cs, "", q.type), lat: q.lat, lon: q.lon, alt: 0, gs: 0, trk: q.hdg, hdg: q.hdg, vs: 0, gnd: true, t: T0 },
      { ...base(q.id, q.cs, "", q.type), lat: q.lat, lon: q.lon, alt: 0, gs: 0, trk: q.hdg, hdg: q.hdg, vs: 0, gnd: true, t: T0 + 400 },
    ]),
  ];
}

/** the planes given to the camera's traffic (the live feed set aside), its clock the test's — held at T0 until runTo; their count */
export const injectTraffic = (app: App, planes: Plane[][]) =>
  app.js<number>(`(() => {
      const planes = ${JSON.stringify(planes)};
      window.__trf = { t: ${T0 + DELAY}, rate: 0, until: ${T0 + DELAY}, last: performance.now() };
      __bh.camera.trafficClock = () => { const s = window.__trf, n = performance.now(); s.t = Math.min(s.until, s.t + ((n - s.last) / 1000) * s.rate); s.last = n; return s.t; };
      __bh.camera.traffic = { planes: new Map(planes.map((h) => [h[0].id, { p: h.at(-1), prev: h.at(-2) ?? null, hist: h, heard: 1e12 }])),
        ships: new Map(), status: "live", credit: {}, attribution: [], focus: null, asks: { air: 0, sea: 0, trace: 0 } };
      return __bh.camera.traffic.planes.size; })()`);

/** the traffic's clock run in real time up to the moment `m` [s after T0], from 12 s before it; then held */
export async function runTo(app: App, m: number) {
  await app.js(
    `(() => { const s = window.__trf; s.t = ${T0 + DELAY + m - 12}; s.until = ${T0 + DELAY + m}; s.rate = 1; s.last = performance.now(); return 1; })()`,
  );
  const t0 = Date.now();
  for (;;) {
    if (await app.js<boolean>(`window.__trf.t >= window.__trf.until`)) return;
    const k = (Date.now() - t0) / 1000;
    if (k > 45)
      throw new Error(`the traffic's clock did not reach ${m} s within 45 s: ${await app.js<string>(`JSON.stringify(window.__trf)`)}`);
    await app.progress(`horloge du trafic → T0+${m.toFixed(0)} s · ${k.toFixed(0)} / 45 s`);
    await Bun.sleep(1000);
  }
}

/** the camera panel's Chase view on an aircraft (target `trf:…`, camera/subjectcam.ts — no craft flown): turned `yaw` [°] about
 *  it, `pitch` [°] (negative: from above — positive put the camera under it, under the ground on the runway), `zoom` (~90 m a
 *  unit) — the game frames it whatever its place; then the place's data about the new view (a stall said, not fatal) */
export async function frameOn(app: App, id: string, yaw: number, pitch: number, zoom: number) {
  await app.js(`(() => { const vc = __bh.camera.viewController();
      __bh.settings.target = vc.s.target = "trf:${id}"; __bh.settings.subjectView = vc.s.subjectView = "chase";
      vc.subject.yaw = ${yaw}; vc.subject.pitch = ${pitch}; vc.subject.zoom = ${zoom}; return 1; })()`);
  await app.waitFor(
    `(() => { const m = __bh.camera.trafficOverlay((x) => "", __bh.camera.viewController()).find((x) => x.id === "${id}"); return !!m && m.dist < ${zoom * 200 + 300}; })()`,
    30_000,
  );
  // (the place's relief, imagery and scenery in about the new view before the moment is run and shot: drawn on tiles not
  // yet in, the ground stands where it is not — the aircraft hidden under it, 24 Nov 2026 on kerr-mini)
  // (a tile or two stalling: said, not fatal — the moment's judgement reads the contact ground itself, `sys.groundAt`)
  try {
    await app.dataSettled(`SFO's data about ${id}`, { maxMs: 60_000 });
  } catch (e) {
    console.log(`  ⚠ ${String(e)} — shot all the same`);
  }
}
