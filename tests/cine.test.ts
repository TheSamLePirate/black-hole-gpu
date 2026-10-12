import { describe, expect, test } from "bun:test";
import { CineBrain, type CineContext, holdFor, lensFor, PLAYLIST, phaseOf } from "../src/cine/brain";
import { dot3, fbm, len3, Spring3, sub3, type V3 } from "../src/cine/rig";

// (a craft flying east — x — level, up z, 250 m/s, 300 m over the ground)
const ctx = (o: Partial<CineContext> = {}): CineContext => ({
  ax: [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ],
  centre: [0, 0, 0],
  size: 42,
  vel: [250, 0, 0],
  up: [0, 0, 1],
  body: { dir: [0, 0, -1], dist: 6.37e6, radius: 6.37e6 },
  sun: [0, 1, 0],
  target: null,
  agl: 300,
  q: 30000,
  mach: 0.75,
  throttle: 0.6,
  boost: 1,
  inAir: true,
  landed: false,
  launch: false,
  time: 0,
  ...o,
});
const ask = { shot: "auto" as const, fov: 60, shake: 0, dynamicFov: true, zoom: 1 };

describe("the rig", () => {
  test("a critically damped spring: no overshoot, settled in a few times its time", () => {
    const s = new Spring3();
    s.reset([0, 0, 0]);
    let peak = 0;
    let x: V3 = [0, 0, 0];
    for (let k = 0; k < 200; k++) {
      x = s.step([10, 0, 0], 0.3, 1 / 60);
      peak = Math.max(peak, x[0]);
    }
    expect(peak).toBeLessThanOrEqual(10 + 1e-9);
    expect(x[0]).toBeCloseTo(10, 2);
  });
  test("stable whatever the step (a long frame)", () => {
    const s = new Spring3();
    s.reset([0, 0, 0]);
    const x = s.step([10, 0, 0], 0.05, 2);
    expect(Math.abs(x[0] - 10)).toBeLessThan(1e-6);
  });
  test("the noise: smooth and within ±1", () => {
    let m = 0;
    for (let t = 0; t < 20; t += 0.01) m = Math.max(m, Math.abs(fbm(t, 3, 1)));
    expect(m).toBeLessThanOrEqual(1);
    expect(Math.abs(fbm(1, 3, 1) - fbm(1.001, 3, 1))).toBeLessThan(0.05);
  });
});

describe("the director's phases and playlists", () => {
  test("phases", () => {
    expect(phaseOf(ctx({ landed: true }))).toBe("ground");
    expect(phaseOf(ctx({ launch: true }))).toBe("launch");
    expect(phaseOf(ctx())).toBe("low");
    expect(phaseOf(ctx({ agl: 9000 }))).toBe("air");
    expect(phaseOf(ctx({ inAir: false, agl: 4e5, body: { dir: [0, 0, -1], dist: 6.8e6, radius: 6.37e6 } }))).toBe("orbit");
    expect(phaseOf(ctx({ inAir: false, agl: Number.NaN, body: null }))).toBe("deep");
  });
  test("the launch opens on the tracking camera, an orbit on the planet's limb", () => {
    expect(PLAYLIST.launch[0]).toBe("tracking");
    expect(PLAYLIST.orbit[0]).toBe("planet");
  });
  test("each shot held 8 … 20 s", () => {
    for (const s of ["chase", "orbit", "pass", "tracking", "planet", "system"] as const)
      for (let n = 0; n < 10; n++) {
        expect(holdFor(s, n)).toBeGreaterThanOrEqual(8);
        expect(holdFor(s, n)).toBeLessThanOrEqual(20);
      }
  });
});

describe("the shots", () => {
  test("the chase: behind the way it goes, above, the craft ahead in the frame", () => {
    const b = new CineBrain();
    let o = b.update(ctx(), { ...ask, shot: "chase" }, 1 / 60);
    for (let k = 0; k < 300; k++) o = b.update(ctx(), { ...ask, shot: "chase" }, 1 / 60);
    expect(o.shot).toBe("chase");
    expect(o.eye[0]).toBeLessThan(-30);
    expect(o.eye[2]).toBeGreaterThan(5);
    const look = sub3(o.aim, o.eye);
    expect(look[0]).toBeGreaterThan(0);
  });
  test("the chase lags a turn and catches up (damped, no snap)", () => {
    const b = new CineBrain();
    for (let k = 0; k < 300; k++) b.update(ctx(), { ...ask, shot: "chase" }, 1 / 60);
    // (a turn: the way now north — y)
    const turned = ctx({ vel: [0, 250, 0] });
    const o1 = b.update(turned, { ...ask, shot: "chase" }, 1 / 60);
    expect(o1.eye[0]).toBeLessThan(-30);
    let o = o1;
    for (let k = 0; k < 300; k++) o = b.update(turned, { ...ask, shot: "chase" }, 1 / 60);
    expect(o.eye[1]).toBeLessThan(-30);
  });
  test("the lens widens with the speed and the afterburner; held when off", () => {
    const run = (c: CineContext, dyn: boolean) => {
      const b = new CineBrain();
      let o = b.update(c, { ...ask, shot: "chase", dynamicFov: dyn }, 1 / 60);
      for (let k = 0; k < 300; k++) o = b.update(c, { ...ask, shot: "chase", dynamicFov: dyn }, 1 / 60);
      return o.fov;
    };
    const slow = run(ctx({ mach: 0.2 }), true),
      fast = run(ctx({ mach: 1.3 }), true),
      ab = run(ctx({ mach: 1.3, boost: 1.5 }), true);
    expect(slow).toBeCloseTo(60, 3);
    expect(fast).toBeGreaterThan(66);
    expect(ab).toBeGreaterThan(fast);
    expect(run(ctx({ mach: 1.3, boost: 1.5 }), false)).toBeCloseTo(60, 3);
  });
  test("the fly-by: a camera still in the world, the craft passing it; the lens long while it is far", () => {
    const b = new CineBrain();
    const dt = 1 / 30;
    const o0 = b.update(ctx(), { ...ask, shot: "pass" }, dt);
    const o1 = b.update(ctx(), { ...ask, shot: "pass" }, dt);
    // (about the craft, the eye moves back by the craft's own way)
    expect(o1.eye[0] - o0.eye[0]).toBeCloseTo(-250 * dt, 6);
    expect(o0.fov).toBeLessThan(40);
  });
  test("the tracking camera: on the ground aside, its lens closing as the craft climbs away", () => {
    const b = new CineBrain();
    const up = (h: number) => ctx({ launch: true, agl: h, vel: [0, 0, 80], q: 0, mach: 0 });
    const o0 = b.update(up(10), { ...ask, shot: "tracking" }, 1 / 30);
    // (2 m over the ground: 8 m under the craft — then the craft's first frame of climb away from it)
    expect(o0.eye[2]).toBeCloseTo(-8 - 80 / 30, 6);
    let o = o0;
    for (let k = 0; k < 30 * 30; k++) o = b.update(up(10 + (80 * k) / 30), { ...ask, shot: "tracking" }, 1 / 30);
    expect(o.fov).toBeLessThan(o0.fov);
    expect(o.fov).toBeGreaterThanOrEqual(0.6);
  });
  test("the planet's limb: the camera on the far side from the world, looking a little down across the craft", () => {
    const b = new CineBrain();
    const c = ctx({ inAir: false, agl: 4e5, q: 0, mach: 0, vel: [7700, 0, 0] });
    let o = b.update(c, { ...ask, shot: "planet" }, 1 / 60);
    for (let k = 0; k < 300; k++) o = b.update(c, { ...ask, shot: "planet" }, 1 / 60);
    expect(o.eye[2]).toBeGreaterThan(0);
    const f = sub3(o.aim, o.eye);
    const down = Math.asin(-f[2] / len3(f)) * (180 / Math.PI);
    expect(down).toBeGreaterThan(8);
    expect(down).toBeLessThan(35);
  });
  test("the system shot: the destination behind the craft", () => {
    const b = new CineBrain();
    const c = ctx({ inAir: false, body: null, up: null, target: [0, 1, 0], vel: [0, 0, 0], q: 0, mach: 0 });
    let o = b.update(c, { ...ask, shot: "system" }, 1 / 60);
    for (let k = 0; k < 300; k++) o = b.update(c, { ...ask, shot: "system" }, 1 / 60);
    const f = sub3(o.aim, o.eye);
    expect(dot3(f, [0, 1, 0]) / len3(f)).toBeGreaterThan(0.9);
  });
});

describe("the director", () => {
  test("cycles its shots, each held a while; blends the moving ones", () => {
    const b = new CineBrain();
    const seen: string[] = [];
    let prev = "";
    for (let k = 0; k < 60 * 90; k++) {
      const o = b.update(ctx({ time: k / 60 }), ask, 1 / 60);
      if (o.shot !== prev) seen.push((prev = o.shot));
    }
    expect(seen[0]).toBe("chase");
    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(new Set(seen).size).toBeGreaterThanOrEqual(3);
  });
  test("no jump on a blend: the eye moves continuously into the next moving shot", () => {
    const b = new CineBrain();
    for (let k = 0; k < 120; k++) b.update(ctx({ time: k / 60 }), { ...ask, shot: "chase" }, 1 / 60);
    const a = b.update(ctx({ time: 2 }), { ...ask, shot: "chase" }, 1 / 60);
    const c = b.update(ctx({ time: 2 + 1 / 60 }), { ...ask, shot: "orbit" }, 1 / 60);
    expect(len3(sub3(c.eye, a.eye))).toBeLessThan(2);
  });
  test("the noise: none asked, none; asked, the aim trembles within a degree in the air", () => {
    const still = new CineBrain(),
      shaken = new CineBrain();
    let maxDeg = 0;
    for (let k = 0; k < 600; k++) {
      const c = ctx({ time: k / 60, q: 40000, mach: 0.95 });
      const a = still.update(c, { ...ask, shot: "chase" }, 1 / 60);
      const b = shaken.update(c, { ...ask, shot: "chase", shake: 1 }, 1 / 60);
      const fa = sub3(a.aim, a.eye),
        fb = sub3(b.aim, b.eye);
      const cos = dot3(fa, fb) / (len3(fa) * len3(fb));
      maxDeg = Math.max(maxDeg, (Math.acos(Math.min(1, cos)) * 180) / Math.PI);
    }
    expect(maxDeg).toBeGreaterThan(0.05);
    expect(maxDeg).toBeLessThan(1.5);
  });
});

describe("the lens for a subject", () => {
  test("a 20 m craft 1 km away filling a third of the frame: ~3.4°", () => {
    expect(lensFor(20, 1000, 1 / 3, 0.5, 60)).toBeCloseTo(3.44, 1);
  });
});
