import { describe, expect, test } from "bun:test";
import { AIR_RADARS, APG81, detectRange, Radar, RANGER_NOSE, type RadarObject, type RadarOwn, radarHorizon } from "../src/game/radar";

// The F-35's radar (docs/PLAN-AVIATION-AAA.md, C1; game/radar.ts): seen as its beam crosses, by its size's range,
// over the radar's horizon, not behind the ground, not in the Doppler notch; tracked, carried on, dropped; the IFF
// answered, the unknown seen; the datalink's friends; the lock and the modes.

const own = (agl = 6000): RadarOwn => ({ fwd: [0, 1, 0], up: [0, 0, 1], right: [1, 0, 0], v: [0, 250, 0], alt: agl, agl });
const obj = (o: Partial<RadarObject> & { id: string; r: [number, number, number] }): RadarObject => ({
  v: [0, -200, 0],
  rcs: 5,
  kind: "air",
  iff: "hostile",
  name: o.id,
  squawk: false,
  ...o,
});
/** steps for `s` seconds at 30 Hz */
function run(R: Radar, s: number, o: RadarObject[], O = own(), masked = () => false, t0 = 0) {
  for (let i = 0; i < s * 30; i++) R.step(1 / 30, t0 + i / 30, O, o, masked);
}

describe("the APG-81", () => {
  test("its range by the size: 150 km on a fighter's 5 m², ~95 km on a 0.8 m² one", () => {
    expect(detectRange(5)).toBeCloseTo(150_000, 0);
    expect(detectRange(0.8) / 1000).toBeCloseTo(94.7, 0);
  });

  test("a contact ahead seen at the beam's crossing — within a sweep —; beyond its range, never", () => {
    const R = new Radar();
    run(R, 2.2, [obj({ id: "a", r: [10_000, 100_000, 0] }), obj({ id: "far", r: [0, 170_000, 0] })]);
    expect(R.tracks.has("a")).toBe(true);
    expect(R.tracks.has("far")).toBe(false);
  });

  test("behind the scan's ±60°: not seen", () => {
    const R = new Radar();
    run(R, 4.5, [obj({ id: "side", r: [50_000, 10_000, 0] })]);
    expect(R.tracks.has("side")).toBe(false);
  });

  test("the radar's horizon: a low contact at 100 km hidden from 300 m, seen from 6 km", () => {
    expect(radarHorizon(300, 100) / 1000).toBeCloseTo(112.5, 0);
    const low = new Radar();
    run(low, 4.5, [obj({ id: "x", r: [0, 140_000, -200], agl: 100 })], own(300));
    expect(low.tracks.has("x")).toBe(false);
    const high = new Radar();
    run(high, 4.5, [obj({ id: "x", r: [0, 140_000, -5900], agl: 100, v: [0, -200, 0] })], own(6000));
    expect(high.tracks.has("x")).toBe(true);
  });

  test("the notch: looking down at a craft flying across the beam — lost; head-on, seen", () => {
    const across = new Radar();
    run(across, 4.5, [obj({ id: "x", r: [0, 40_000, -3000], v: [220, 0, 0] })]);
    expect(across.tracks.has("x")).toBe(false);
    const hot = new Radar();
    run(hot, 4.5, [obj({ id: "x", r: [0, 40_000, -3000], v: [0, -220, 0] })]);
    expect(hot.tracks.has("x")).toBe(true);
    // (looking up at it: the sky behind, no clutter — seen across too)
    const up = new Radar();
    run(up, 4.5, [obj({ id: "x", r: [0, 40_000, 2000], v: [220, 0, 0] })]);
    expect(up.tracks.has("x")).toBe(true);
  });

  test("behind the ground: masked", () => {
    const R = new Radar();
    run(R, 4.5, [obj({ id: "x", r: [0, 30_000, 0] })], own(), () => true);
    expect(R.tracks.has("x")).toBe(false);
  });

  test("a track carried on between sweeps, dropped once it is no longer seen", () => {
    const R = new Radar();
    const o = obj({ id: "a", r: [0, 60_000, 0], v: [0, -200, 0] });
    run(R, 2.2, [o]);
    const r0 = R.tracks.get("a")!.r[1];
    run(R, 0.5, [], own(), () => false, 2.2);
    // (closing at 450 m/s together: carried 225 m nearer in half a second)
    expect(r0 - R.tracks.get("a")!.r[1]).toBeCloseTo(225, -1);
    run(R, 6, [], own(), () => false, 2.7);
    expect(R.tracks.has("a")).toBe(false);
  });

  test("the IFF: an airliner answers within 120 km (neutral); a silent one stays unknown until seen close", () => {
    const R = new Radar();
    run(R, 2.2, [
      obj({ id: "liner", r: [0, 80_000, 0], iff: "neutral", squawk: true }),
      obj({ id: "bogey", r: [5_000, 60_000, 0], iff: "hostile" }),
      obj({ id: "close", r: [0, 2_500, 0], iff: "hostile" }),
    ]);
    expect(R.tracks.get("liner")!.iff).toBe("neutral");
    expect(R.tracks.get("bogey")!.iff).toBe("unknown");
    expect(R.tracks.get("close")!.iff).toBe("hostile");
  });

  test("the datalink: a friend behind, always known — not lockable", () => {
    const R = new Radar();
    run(R, 0.2, [obj({ id: "wing", r: [-30, -20, 0], iff: "friend", offboard: true })]);
    const T = R.tracks.get("wing")!;
    expect(T.datalink).toBe(true);
    expect(T.iff).toBe("friend");
    expect(R.lockNext()).toBeNull();
  });

  test("the lock: the nearest first, then the next; STT holds it each frame — and loses it out of the cone", () => {
    const R = new Radar();
    const a = obj({ id: "a", r: [0, 30_000, 0] }),
      b = obj({ id: "b", r: [2000, 50_000, 0] });
    run(R, 2.2, [a, b]);
    expect(R.lockNext()).toBe("a");
    expect(R.lockNext()).toBe("b");
    expect(R.nextMode()).toBe("STT");
    const seenAt = R.tracks.get("b")!.seenAt;
    run(R, 0.3, [a, b], own(), () => false, 2.2);
    expect(R.tracks.get("b")!.seenAt).toBeGreaterThan(seenAt);
    // (b swung behind the scan's cone: lost a second on)
    run(R, 1.5, [a, { ...b, r: [50_000, -10_000, 0] }], own(), () => false, 2.5);
    expect(R.lock).toBeNull();
    expect(R.mode).toBe("TWS");
  });

  test("RWS: the contacts alone — no speed; TWS: their speeds", () => {
    const R = new Radar();
    R.mode = "RWS";
    run(R, 2.2, [obj({ id: "a", r: [0, 30_000, 0] })]);
    expect(R.tracks.get("a")!.v).toEqual([0, 0, 0]);
    const T = new Radar();
    run(T, 2.2, [obj({ id: "a", r: [0, 30_000, 0] })]);
    expect(T.tracks.get("a")!.v).toEqual([0, -200, 0]);
  });
});

describe("the Ranger's nose radar (RD4's leftover)", () => {
  test("≈ 60 % of the APG-81's reach, the same ±60° scan; a radar per craft in the air, none for the Lander", () => {
    expect(detectRange(5, RANGER_NOSE) / detectRange(5, APG81)).toBeCloseTo(0.6, 2);
    expect(RANGER_NOSE.az).toBeCloseTo(APG81.az, 9);
    expect(AIR_RADARS.ranger).toBe(RANGER_NOSE);
    expect(AIR_RADARS.f35).toBe(APG81);
    expect(AIR_RADARS.lander).toBeUndefined();
    expect(AIR_RADARS.endurance).toBeUndefined();
  });

  test("a fighter at 120 km: the APG-81's, not the nose's; at 60 km, both", () => {
    const far = [obj({ id: "far", r: [0, 120_000, 0] }), obj({ id: "near", r: [5_000, 60_000, 0] })];
    const big = new Radar(APG81),
      nose = new Radar(RANGER_NOSE);
    run(big, 3, far);
    run(nose, 3, far);
    expect(big.tracks.has("far")).toBe(true);
    expect(nose.tracks.has("far")).toBe(false);
    expect(nose.tracks.has("near")).toBe(true);
  });

  test("its narrower ±30° in elevation: a contact 32° up seen by the APG-81 (±35°) only", () => {
    const up32 = obj({ id: "u", r: [0, 10_000, 10_000 * Math.tan((32 * Math.PI) / 180)] });
    const big = new Radar(APG81),
      nose = new Radar(RANGER_NOSE);
    run(big, 3, [up32]);
    run(nose, 3, [up32]);
    expect(big.tracks.has("u")).toBe(true);
    expect(nose.tracks.has("u")).toBe(false);
  });
});
