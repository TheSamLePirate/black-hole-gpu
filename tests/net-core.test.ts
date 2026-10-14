import { describe, expect, test } from "bun:test";
import { NetClock } from "../src/net/clock";
import { type CraftSample, decodeCraft, emptyVisual, encodeCraft, roomTime } from "../src/net/proto";
import { RemoteRegistry, RemoteTrack } from "../src/net/remote";

// PLAN-RESEAU R0: the protocol's samples, the clock under a made-up network, the others read between and
// beyond their samples.

const sample = (t: number, p: [number, number, number], v: [number, number, number], o: Partial<CraftSample> = {}): CraftSample => ({
  slot: 2,
  seq: 0,
  t,
  frame: 0,
  body: 0,
  kind: 3,
  flags: 0,
  p,
  v,
  q: [0, 0, 0, 1],
  w: [0, 0, 0],
  a: [0, 0, 0],
  vis: emptyVisual(),
  ...o,
});

describe("the craft's sample", () => {
  test("104 bytes round trip: float64 positions exact, the rest within its steps", () => {
    const s = sample(812_345_678.123456, [-2_430_601.8273, -4_702_442.1102, 3_546_587.3561], [231.5, -12.25, 3.125], {
      q: [0.1, -0.2, 0.3, Math.sqrt(1 - 0.14)],
      w: [0.01, 0.2, -0.3],
      a: [1, 2, -9.8],
      flags: 9,
      vis: {
        ...emptyVisual(),
        throttle: 0.85,
        boost: 1.4,
        gear: 1,
        stovl: 0.5,
        nozzle: 0.6,
        roll: -0.3,
        yaw: 0.5,
        steer: -1,
        comp: 0.12,
        alpha: 7.25,
        cl: 0.62,
        mach: 0.93,
      },
    });
    const b = encodeCraft(s);
    expect(b.byteLength).toBe(104);
    const r = decodeCraft(b)!;
    expect(r.t).toBe(s.t);
    expect(r.p).toEqual(s.p);
    expect(r.flags).toBe(9);
    for (let k = 0; k < 3; k++) expect(Math.abs(r.v[k]! - s.v[k]!)).toBeLessThan(1e-4);
    for (let k = 0; k < 4; k++) expect(Math.abs(r.q[k]! - s.q[k]!)).toBeLessThan(1e-4);
    expect(Math.abs(r.vis.throttle - 0.85)).toBeLessThan(0.004);
    expect(r.vis.boost).toBeCloseTo(1.4, 2);
    expect(r.vis.nozzle).toBeCloseTo(0.6, 2);
    expect(r.vis.alpha).toBeCloseTo(7.25, 2);
    expect(r.vis.mach).toBeCloseTo(0.93, 3);
    expect(r.vis.roll).toBeCloseTo(-0.3, 2);
    expect(r.vis.yaw).toBeCloseTo(0.5, 2);
    expect(r.vis.steer).toBe(-1);
    expect(r.vis.comp).toBeCloseTo(0.12, 2);
    expect(decodeCraft(new Uint8Array(50))).toBeNull();
  });

  test("the room's clock", () => {
    expect(roomTime({ t0: 100, h0: 5000, warp: 4 }, 7000)).toBe(108);
  });
});

describe("the clock", () => {
  // a server whose clock runs 12 345 ms ahead; each way 100 ± 60 ms, 5 % of the exchanges lost
  const run = (seed: number, jit = 60) => {
    // (mulberry32: an LCG's draws in a row are correlated — the up and down legs were)
    let x = seed >>> 0;
    const rand = () => {
      x = (x + 0x6d2b79f5) >>> 0;
      let r = Math.imul(x ^ (x >>> 15), 1 | x);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
    const c = new NetClock();
    let now = 0;
    const errs: number[] = [];
    for (let k = 0; k < 120; k++) {
      now += 500;
      if (rand() < 0.05) continue;
      const up = 100 + (rand() * 2 - 1) * jit,
        down = 100 + (rand() * 2 - 1) * jit;
      const s = now + up + 12_345;
      c.onPong(now, s, now + up + down);
      if (k > 30) errs.push(Math.abs(c.offset - 12_345));
    }
    return Math.max(...errs);
  };
  // (uniform ±60 ms each way is the worst a line does: the asymmetry of the fastest exchanges is the limit)
  test("holds within ~12 ms at 200 ms round trips, ±60 ms each way and 5 % lost", () => {
    for (const seed of [1, 7, 42, 99]) expect(run(seed)).toBeLessThan(15);
  });
  test("within 1.5 ms on a calm line (±5 ms each way)", () => {
    for (const seed of [1, 7, 42, 99]) expect(run(seed, 5)).toBeLessThan(1.5);
  });
  test("an exchange slowed by a busy page moves nothing; a real change is followed", () => {
    const c = new NetClock();
    for (let k = 0; k < 40; k++) c.onPong(k * 100, k * 100 + 20 + 1000, k * 100 + 40);
    expect(c.offset).toBeCloseTo(1000, 6);
    // (a page frozen 300 ms: a slow exchange — not among the fastest, ignored)
    c.onPong(4000, 4000 + 20 + 1000, 4340);
    expect(c.offset).toBeCloseTo(1000, 6);
  });
});

describe("the others read", () => {
  // a craft turning: 3 km round at 200 m/s, sampled at 30 Hz
  const R = 3000,
    V = 200,
    om = V / R;
  const at = (t: number): [number, number, number] => [R * Math.cos(om * t), R * Math.sin(om * t), 1000];
  const vel = (t: number): [number, number, number] => [-V * Math.sin(om * t), V * Math.cos(om * t), 0];
  const acc = (t: number): [number, number, number] => [-V * om * Math.cos(om * t), -V * om * Math.sin(om * t), 0];

  test("between samples: the Hermite within a centimetre of the true circle", () => {
    const tr = new RemoteTrack(1);
    for (let t = 0; t <= 2; t += 1 / 30) tr.push(sample(t, at(t), vel(t)));
    let worst = 0;
    for (let t = 0.1; t < 1.9; t += 0.007) {
      const s = tr.raw(t)!;
      worst = Math.max(worst, Math.hypot(s.p[0] - at(t)[0], s.p[1] - at(t)[1], s.p[2] - at(t)[2]));
    }
    expect(worst).toBeLessThan(0.01);
  });

  test("beyond the last sample: carried by its acceleration (0.1 s ahead: within 2 cm), then a ghost", () => {
    const tr = new RemoteTrack(1);
    for (let t = 0; t <= 1; t += 1 / 30) tr.push(sample(t, at(t), vel(t), { a: acc(t) }));
    const last = tr.latest!.t;
    const s = tr.raw(last + 0.1)!;
    const e = Math.hypot(...[0, 1, 2].map((k) => s.p[k]! - at(last + 0.1)[k]!));
    expect(e).toBeLessThan(0.02);
    expect(s.ahead).toBeCloseTo(0.1, 6);
    expect(tr.raw(last + 2)!.ghost).toBe(false);
    expect(tr.raw(last + 4.5)!.ghost).toBe(true);
  });

  test("a disagreement taken in smoothly, not a jump", () => {
    const tr = new RemoteTrack(1, { smooth: 0.15, maxAhead: 0.25 });
    tr.push(sample(0, [0, 0, 0], [100, 0, 0]));
    tr.push(sample(0.1, [10, 0, 0], [100, 0, 0]));
    // shown ahead to 0.2 (x = 20), then the truth says it stopped at 12
    const shown = tr.at(0.2)!.p[0];
    expect(shown).toBeCloseTo(20, 6);
    tr.push(sample(0.2, [12, 0, 0], [0, 0, 0]));
    const next = tr.at(0.2 + 1 / 60)!.p[0];
    expect(Math.abs(next - shown)).toBeLessThan(2);
    expect(Math.abs(tr.at(1)!.p[0] - 12)).toBeLessThan(0.1);
  });

  test("the delay follows the lateness and the spacing of the samples", () => {
    const reg = new RemoteRegistry();
    for (let k = 0; k < 120; k++) reg.push(sample(k / 30, at(k / 30), vel(k / 30)), 0.04 + (k % 5) * 0.004);
    // (40–56 ms late, 33 ms apart: the next sample there ~90 ms after its time)
    expect(reg.delay).toBeGreaterThan(0.08);
    expect(reg.delay).toBeLessThan(0.11);
    expect(reg.states(4).length).toBe(1);
  });
});

describe("the bot's flight", () => {
  test("on its circle: velocity, acceleration and attitude agree", async () => {
    const { botState, EDWARDS } = await import("../src/net/bot");
    const a = botState(10),
      b = botState(10.001);
    const dv = [0, 1, 2].map((k) => (b.p[k]! - a.p[k]!) / 0.001);
    for (let k = 0; k < 3; k++) expect(Math.abs(dv[k]! - a.v[k]!)).toBeLessThan(0.05);
    expect(Math.hypot(...a.v)).toBeCloseTo(EDWARDS.speed, 6);
    expect(Math.hypot(...a.a)).toBeCloseTo(EDWARDS.speed ** 2 / EDWARDS.radius, 6);
    // (the quaternion turns forward — x — onto the velocity)
    const [x, y, z, w] = a.q;
    const fwd = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
    const vn = a.v.map((c) => c / EDWARDS.speed);
    expect(fwd[0]! * vn[0]! + fwd[1]! * vn[1]! + fwd[2]! * vn[2]!).toBeCloseTo(1, 6);
  });
});
