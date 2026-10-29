import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The relativistic voyage by real keys (docs/PLAN-CAMERA-AAA.md CAM4–CAM6): F3 out of the Ranger, G to Mars — the trip's own pace peaks
// near 0.9 c, the world's clock runs t while the traveller's runs τ < t, the card shows both, the view's speed reaches
// the tracer (β), it arrives at Mars's framing where Mars then is; a drag turns the look off the course on the way;
// Space holds it; G again stops it where it is — the camera sensor sees no jump in any of it.
// Duration: ~3 min here (headless).
// Done when: the voyage to Jupiter is stopped by G and the view stays where it stopped.

const OUT = "remote-results/camera-voyage";

interface Fig {
  name: string;
  T: number;
  Tau: number;
  t: number;
  tau: number;
  beta: number;
  gamma: number;
  betaPeak: number;
  u: number;
  phase: string;
}

describe.skipIf(!E2E)("the relativistic voyage", () => {
  let app: App;
  const fig = () => app.js<Fig | null>(`__bh.voyage()`);
  const faults = () => app.js<{ jump: number; turn: number; fov: number; speed: number }>(`__bh.cam.report().counts`);
  // (the view's speed as the tracer gets it, its look and its distance to a body's centre [m])
  const view = (body: string) =>
    app.js<{ beta: number; fwd: number[]; dir: number[]; d: number }>(`(() => {
      const vc = __bh.camera.viewController(), w = vc.rigWorld(), t = vc.nowTime();
      const C = __bh.ourState(${JSON.stringify(body)}, t).pos;
      const r = [C[0] - w.X[0], C[1] - w.X[1], C[2] - w.X[2]], l = Math.hypot(...r);
      const s = __bh.camera.viewSettings();
      return { beta: Math.hypot(s.velR, s.velT, s.velP), fwd: w.fwd, dir: r.map((x) => x / l), d: l * 1.476625e11 };
    })()`);

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1280, height: 720, hash: "scene=Earth: the Blue Marble", tiles: false });
    await app.waitFor("__bh.renderer.completedFrames > 30", 120_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("G to Mars: ~0.9 c, t and τ apart, the card, arrival at Mars's framing", async () => {
    // (the scene's Ranger flown: F3, the free camera out — in flight G is the gear —, then G)
    await app.press("F3", "F3");
    await app.waitFor(`__bh.camera.spectating`, 10_000);
    await app.js(`(() => { __bh.camera.viewController().s.target = "mars"; __bh.settings.target = "mars"; return 1; })()`);
    await app.js(`__bh.cam.start()`);
    await app.press("KeyG", "g");
    await app.waitFor(`!!__bh.voyage()`, 10_000);
    const f0 = (await fig())!;
    console.log(`  plan: T ${(f0.T / 60).toFixed(1)} min (world), τ ${(f0.Tau / 60).toFixed(1)} min, peak β ${f0.betaPeak.toFixed(3)}`);
    expect(f0.betaPeak).toBeGreaterThan(0.8);
    expect(f0.betaPeak).toBeLessThan(0.97);
    expect(f0.Tau).toBeLessThan(f0.T);
    let peak = 0,
      shot = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const f = await fig();
      if (!f) break;
      const v = await view("mars");
      peak = Math.max(peak, v.beta);
      if (!shot && f.u > 0.45) {
        shot = true;
        await app.shot(`${OUT}/mars-midway.png`);
        expect(await app.js<boolean>(`!document.querySelector('[data-testid="voyage-hud"]').hidden`)).toBe(true);
        console.log(`  midway: β ${f.beta.toFixed(3)}, γ ${f.gamma.toFixed(3)}, t ${f.t.toFixed(0)} s, τ ${f.tau.toFixed(0)} s`);
        expect(f.tau).toBeLessThan(f.t);
      }
      await Bun.sleep(400);
    }
    expect(await fig()).toBeNull();
    // (the tracer got the speed: the view's β near the plan's peak)
    expect(peak).toBeGreaterThan(0.7);
    await Bun.sleep(1000);
    const end = await view("mars");
    const R = 3389.5e3;
    console.log(
      `  arrived ${(end.d / 1e3).toFixed(0)} km from Mars's centre (${(end.d / R).toFixed(2)} radii), β ${end.beta.toExponential(1)}`,
    );
    expect(end.d / R).toBeGreaterThan(2.0);
    expect(end.d / R).toBeLessThan(4.5);
    expect(end.beta).toBeLessThan(1e-3);
    await app.shot(`${OUT}/mars-arrived.png`);
    const c = await faults();
    console.log(`  faults: ${JSON.stringify(c)}`);
    const list = await app.js<{ kind: string; t: number; size: number; h: number; score: number }[]>(
      `(() => { const S = __bh.cam.samples(); const t0 = S[0].t; return __bh.cam.report().faults.map((f) => ({ kind: f.kind, t: Math.round(f.t - t0), size: +f.size.toPrecision(3), h: +f.h.toPrecision(3), score: +f.score.toPrecision(3) })); })()`,
    );
    for (const f of list) console.log(`    ${f.kind} at ${f.t} ms: ${f.size} (×${f.score}), h ${f.h}`);
    expect(c.jump).toBe(0);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("on the way: a drag turns the look off the course, Space holds the voyage, G stops it there", async () => {
    if (!(await app.js<boolean>(`__bh.camera.spectating`))) {
      await app.press("F3", "F3");
      await app.waitFor(`__bh.camera.spectating`, 10_000);
    }
    await app.js(`(() => { __bh.camera.viewController().s.target = "jupiter"; __bh.settings.target = "jupiter"; return 1; })()`);
    await app.press("KeyG", "g");
    await app.waitFor(`!!__bh.voyage() && __bh.voyage().u > 0.02`, 20_000);
    await Bun.sleep(1500);
    const before = await view("jupiter");
    // (a real drag, 300 px to the left)
    await app.mouse("move", 640, 360);
    await app.mouse("down", 640, 360, { button: "left" });
    for (let k = 1; k <= 10; k++) await app.mouse("move", 640 - 30 * k, 360);
    await app.mouse("up", 340, 360, { button: "left" });
    await Bun.sleep(300);
    const after = await view("jupiter");
    // (the turn off the course, in the traveller's own frame — the true directions are aberrated at 0.9 c: the screen's
    // 23° are a far larger angle at rest)
    const yaw = await app.js<number>(`__bh.camera.viewController().voyage.yaw`);
    console.log(`  look off the course: ${yaw.toFixed(1)}° (traveller's frame)`);
    expect(Math.abs(yaw)).toBeGreaterThan(15);
    void before;
    void after;
    await app.shot(`${OUT}/jupiter-look-back.png`);
    // (Space: the time held — the voyage too)
    await app.press("Space", " ");
    await Bun.sleep(300);
    const h0 = (await fig())!;
    await Bun.sleep(1500);
    const h1 = (await fig())!;
    expect(h1.t).toBeCloseTo(h0.t, 3);
    await app.press("Space", " ");
    await app.waitFor(`__bh.voyage() && __bh.voyage().t > ${h1.t + 1}`, 10_000);
    // (G again: stopped where it is)
    await app.js(`__bh.cam.start()`);
    await app.press("KeyG", "g");
    await app.waitFor(`!__bh.voyage()`, 5_000);
    await Bun.sleep(1500);
    const c = await faults();
    console.log(`  after the stop: ${JSON.stringify(c)}`);
    expect(c.jump).toBe(0);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("⇧G: the cinematic voyage — a low pass over the Earth, the voyage, a low pass over the Moon, in one shot", async () => {
    if (!(await app.js<boolean>(`__bh.camera.spectating`))) {
      await app.press("F3", "F3");
      await app.waitFor(`__bh.camera.spectating`, 10_000);
    }
    // (back by the Earth first — a voyage there —, then ⇧G to the Moon)
    await app.js(`__bh.goTo("earth")`);
    await app.waitFor(`!__bh.camera.viewController().voyage`, 90_000);
    await app.js(
      `(() => { __bh.camera.viewController().s.target = "moon"; __bh.settings.target = "moon"; __bh.settings.voyageCine = "sequence"; return 1; })()`,
    );
    await app.js(`__bh.cam.start()`);
    await app.press("KeyG", "G", { shift: true });
    await app.waitFor(`!!__bh.camera.viewController().cineVoyage`, 10_000);
    const legs = await app.js<string[]>(
      `__bh.camera.viewController().cineVoyage.legs.map((l) => l.kind === "skim" ? "skim:" + l.body : "voyage")`,
    );
    console.log(`  legs: ${legs.join(" → ")}`);
    expect(legs).toEqual(["skim:earth", "voyage", "skim:moon"]);
    const shots: Record<string, boolean> = {};
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
      const st = await app.js<{ i: number; t: number } | null>(
        `(() => { const c = __bh.camera.viewController().cineVoyage; return c ? { i: c.i, t: c.t } : null; })()`,
      );
      if (!st) break;
      const key = `leg${st.i}`;
      if (!shots[key] && st.t > (st.i === 1 ? 0 : 5)) {
        shots[key] = true;
        await app.shot(`${OUT}/cine-${key}.png`);
      }
      await Bun.sleep(300);
    }
    expect(await app.js<boolean>(`!__bh.camera.viewController().cineVoyage`)).toBe(true);
    // (low over both worlds: under 3 km at some frame)
    const lows = await app.js<Record<string, number>>(
      `(() => { const o = {}; for (const s of __bh.cam.samples()) { const r = s.ref.split(":")[0]; o[r] = Math.min(o[r] ?? Infinity, s.h); } return o; })()`,
    );
    console.log(`  lowest: ${JSON.stringify(Object.fromEntries(Object.entries(lows).map(([k, v]) => [k, Math.round(v)])))}`);
    expect(lows.earth!).toBeLessThan(3000);
    expect(lows.moon!).toBeLessThan(3000);
    const c = await faults();
    const list = await app.js<{ kind: string; t: number; size: number; h: number }[]>(
      `(() => { const S = __bh.cam.samples(); const t0 = S[0].t; return __bh.cam.report().faults.map((f) => ({ kind: f.kind, t: Math.round(f.t - t0), size: +f.size.toPrecision(3), h: +f.h.toPrecision(3) })); })()`,
    );
    for (const f of list) console.log(`    ${f.kind} at ${f.t} ms: ${f.size}, h ${f.h}`);
    console.log(`  faults: ${JSON.stringify(c)}`);
    expect(c.jump).toBe(0);
    expect(app.cdp.errors).toEqual([]);
  }, 240_000);
});
