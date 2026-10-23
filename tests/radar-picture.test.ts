import { expect, test } from "bun:test";
import { buildPicture, geoOf, type PicFix, type PicObject, SENSOR, sensed, TrailStore, trailSpan } from "../src/radar/picture";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";

// The tactical picture (PLAN-RADAR-AAA RD2): one track per id — the truth and what the sensors know merged —, the
// missiles and the decoys among them, their places exact over the WGS84 ellipsoid.

const D = Math.PI / 180;
/** A fix over the Alps at 6 000 m, heading north: its local frame the ellipsoid's normal's. */
function fixAt(lat: number, lon: number, alt: number): PicFix {
  const p = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, alt) as [number, number, number];
  const U: [number, number, number] = [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
  const E: [number, number, number] = [-Math.sin(lon * D), Math.cos(lon * D), 0];
  const N: [number, number, number] = [U[1] * E[2] - U[2] * E[1], U[2] * E[0] - U[0] * E[2], U[0] * E[1] - U[1] * E[0]];
  return { p, E, N, U, lat, lon, alt, heading: 0 };
}
const obj = (o: Partial<PicObject> & { id: string; r: [number, number, number] }): PicObject => ({
  v: [0, 200, 0],
  kind: "air",
  iff: "hostile",
  name: o.id,
  squawk: false,
  ...o,
});

test("one track per id: the radar's estimate, the truth beside it, the IFF as known", () => {
  const fix = fixAt(45.9, 6.9, 6000);
  const P = buildPicture({
    t: 10,
    fix,
    objects: [
      obj({ id: "cmb:1", r: [1000, 20_000, 500], known: true }),
      obj({ id: "trf:abc", r: [-5000, 30_000, -1000], iff: "neutral", squawk: true, name: "AFR123" }),
      obj({ id: "ais:9", r: [8000, 40_000, -6000], kind: "sea", iff: "neutral" }),
      obj({ id: "cmb:2", r: [0, 90_000, 0], known: true }),
    ],
    tracks: [{ id: "cmb:1", r: [1010, 19_990, 500], v: [0, 200, 0], iff: "unknown", seenAt: 9.5, datalink: false }],
    lock: "cmb:1",
    selected: null,
    weapons: [],
    mode: "TWS",
    beam: 0,
  });
  expect(P.tracks.length).toBe(4);
  const L = P.byId.get("cmb:1")!;
  expect(L.sensors & SENSOR.RADAR).toBeTruthy();
  expect(L.state).toBe("firm");
  expect(L.iff).toBe("unknown");
  expect(L.side).toBe("hostile");
  expect(L.r).toEqual([1010, 19_990, 500]);
  expect(L.rt).toEqual([1000, 20_000, 500]);
  // (the lock first)
  expect(P.tracks[0]!.id).toBe("cmb:1");
  const A = P.byId.get("trf:abc")!;
  expect(A.side).toBe("traffic");
  expect(A.sensors & SENSOR.TCAS).toBeTruthy();
  expect(A.iff).toBe("neutral");
  expect(sensed(A)).toBe(true);
  expect(P.byId.get("ais:9")!.sensors & SENSOR.AIS).toBeTruthy();
  // (briefed but not seen: the truth's — not on the pilot's screens)
  const far = P.byId.get("cmb:2")!;
  expect(far.state).toBe("truth");
  expect(sensed(far)).toBe(false);
});

test("a track coasts once the radar no longer measures it", () => {
  const fix = fixAt(45.9, 6.9, 6000);
  const P = buildPicture({
    t: 20,
    fix,
    objects: [obj({ id: "cmb:1", r: [0, 20_000, 0] })],
    tracks: [{ id: "cmb:1", r: [0, 20_000, 0], v: [0, 0, 0], iff: "hostile", seenAt: 16, datalink: false }],
    lock: null,
    selected: "cmb:1",
    weapons: [],
    mode: "RWS",
    beam: 0,
  });
  const T = P.byId.get("cmb:1")!;
  expect(T.state).toBe("coast");
  expect(T.selected).toBe(true);
});

test("the missiles and decoys as tracks: who sees them, the time to go, the one at us first", () => {
  const fix = fixAt(45.9, 6.9, 6000);
  const P = buildPicture({
    t: 1,
    fix,
    objects: [obj({ id: "cmb:1", r: [0, 30_000, 0] })],
    tracks: [],
    lock: null,
    selected: null,
    weapons: [
      {
        id: "msl:7",
        name: "AIM-120C",
        kind: "missile",
        r: [0, 10_000, 0],
        v: [0, 1000, 0],
        ours: true,
        seeker: "radar",
        target: "cmb:1",
        motor: false,
      },
      {
        id: "msl:8",
        name: "R-73",
        kind: "missile",
        r: [0, 5000, 0],
        v: [0, -800, 0],
        ours: false,
        seeker: "ir",
        target: "own",
        motor: true,
      },
      { id: "cm:3", name: "FLARE", kind: "flare", r: [0, -200, -20], v: [0, 150, -10], ours: true, life: 4 },
      { id: "cm:4", name: "CHAFF", kind: "chaff", r: [0, -200, -20], v: [0, 150, -10], ours: true, life: 4 },
    ],
    mode: "TWS",
    beam: 0,
  });
  const ours = P.byId.get("msl:7")!;
  expect(ours.sensors & SENSOR.DATALINK).toBeTruthy();
  // (20 km to the target flying away at 200 m/s: closing 800 m/s, 25 s)
  expect(ours.msl!.tti).toBeCloseTo(25, 5);
  const theirs = P.byId.get("msl:8")!;
  expect(theirs.sensors & SENSOR.DAS).toBeTruthy();
  expect(theirs.msl!.tti).toBeCloseTo(5000 / 800, 5);
  expect(P.tracks[0]!.id).toBe("msl:8");
  expect(P.byId.get("cm:3")!.sensors & SENSOR.DAS).toBeTruthy();
  // (chaff behind us: out of the radar's ±60°)
  expect(P.byId.get("cm:4")!.sensors).toBe(0);
});

test("places exact over the ellipsoid: a point's height and latitude round-trip", () => {
  const fix = fixAt(45.9, 6.9, 6000);
  const g = geoOf(fix, [0, 0, 1000]);
  expect(g.lat).toBeCloseTo(45.9, 9);
  expect(g.lon).toBeCloseTo(6.9, 9);
  expect(g.h).toBeCloseTo(7000, 3);
  // (30 km north: its latitude by the ellipsoid's meridian radius, not a sphere's)
  const n = geoOf(fix, [0, 30_000, 0]);
  const q = geodeticToCart(WGS84_A, WGS84_F, n.lat * D, n.lon * D, n.h);
  const back = cartToGeodetic(WGS84_A, WGS84_F, q);
  expect(back.lat / D).toBeCloseTo(n.lat, 9);
  expect(n.lat - 45.9).toBeGreaterThan(0.26);
  expect(n.lat - 45.9).toBeLessThan(0.28);
});

test("the trails (RD7): a point at each radar measure, every 2 s otherwise; the span the settings show", () => {
  const fix = fixAt(45.9, 6.9, 6000);
  const S = new TrailStore();
  for (let k = 0; k < 10; k++) {
    const t = k * 0.5;
    const P = buildPicture({
      t,
      fix,
      objects: [
        obj({ id: "cmb:1", r: [0, 20_000 - 100 * k, 0] }),
        obj({ id: "trf:a", r: [5000, 30_000, 0], squawk: true, iff: "neutral" }),
      ],
      // (the radar's measure each second: seenAt steps)
      tracks: [{ id: "cmb:1", r: [0, 20_000 - 100 * k, 0], v: [0, -200, 0], iff: "hostile", seenAt: Math.floor(t), datalink: false }],
      lock: null,
      selected: null,
      weapons: [],
      mode: "TWS",
      beam: 0,
    });
    S.record(P, t);
    if (k === 9) {
      expect(P.byId.get("cmb:1")!.hist!.length).toBe(5);
      expect(P.byId.get("trf:a")!.hist!.length).toBe(3);
    }
  }
  expect(trailSpan({ kind: "air", locked: false, selected: false }, { radarTrails: "off" })).toBe(0);
  expect(trailSpan({ kind: "air", locked: true, selected: false }, { radarTrails: "off", radarTrailLock: true })).toBe(30);
  expect(trailSpan({ kind: "missile", locked: false, selected: false }, { radarTrails: "off" })).toBe(5);
  expect(trailSpan({ kind: "air", locked: false, selected: false }, { radarTrails: "long" })).toBe(180);
  expect(trailSpan({ kind: "flare", locked: false, selected: false }, { radarTrails: "long" })).toBe(0);
});

test("the DAS and the EOTS (RD4): aircraft by their heat — all round within 30 km, before the nose within 60 km; none unfitted", () => {
  const fix = fixAt(45.9, 6.9, 6000);
  const input = (irst: boolean) =>
    buildPicture({
      t: 10,
      fix,
      objects: [
        obj({ id: "cmb:1", r: [0, -20_000, 0] }),
        obj({ id: "cmb:2", r: [2000, 45_000, 1000] }),
        obj({ id: "cmb:3", r: [0, 90_000, 0] }),
      ],
      tracks: [],
      lock: null,
      selected: null,
      weapons: [],
      mode: null,
      beam: null,
      irst,
    });
  const P = input(true);
  const [behind, ahead, far] = ["cmb:1", "cmb:2", "cmb:3"].map((id) => P.byId.get(id)!);
  expect(behind!.sensors & SENSOR.DAS).toBeTruthy();
  expect(behind!.sensors & SENSOR.EOTS).toBe(0);
  expect(behind!.state).toBe("firm");
  // (no IFF in the heat)
  expect(behind!.iff).toBe("unknown");
  expect(ahead!.sensors & SENSOR.EOTS).toBeTruthy();
  expect(ahead!.sensors & SENSOR.DAS).toBe(0);
  expect(far!.sensors).toBe(0);
  expect(input(false).byId.get("cmb:1")!.sensors).toBe(0);
});
