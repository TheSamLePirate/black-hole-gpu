import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The show (docs/PLAN-AVIATION-AAA.md, S3): first the Alps as ever; a low pass over the sea off Nice and a guns fight
// kept on the replay's tape; the replay opened — the flight held —, its four cameras (chase, orbit, fly-by, cockpit),
// the director's; closed, the flight on as it was; the trailer (its title, its moments' captions, its end) and its
// draft video begun; a view of exception's photograph framed as the scene says. (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the replay, its cameras, the trailer, the scenes' photographs", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const R = <T>(x: string) => app.js<T>(`__bh.flight.replay.${x}`);
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, f35Invulnerable: true, showFps: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(2500);
    await shot("alps");
  }, 240_000);

  test("a low pass over the sea off Nice, then a zoom climb, kept on the tape", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T16:30:00Z"); __bh.game.flyAt(43.55, 7.35, 60, 80, 240);
      const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 60; c.jetModes.spd = 250; return 1; })()`);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(18_000);
    await app.js(`(() => { __bh.camera.jetModes.alt = 1500; return 1; })()`);
    await Bun.sleep(8000);
    const tape = await R<{ seconds: number; frames: number }>(`tape()`);
    console.log(`  the tape: ${tape.seconds.toFixed(1)} s, ${tape.frames} frames`);
    expect(tape.seconds).toBeGreaterThan(20);
  }, 300_000);

  test("the replay: the flight held, its four cameras and the director's; closed, the flight on as it was", async () => {
    const before = await app.js<{ d: number; inc: number; t: number }>(
      `({ d: __bh.settings.distance, inc: __bh.settings.inclination, t: __bh.sim.time })`,
    );
    expect(await R<string | null>(`open()`)).toBeNull();
    await Bun.sleep(800);
    const st = await R<{ active: boolean; moments: { kind: string }[] }>(`state()`);
    console.log(`  moments: ${st.moments.map((m) => m.kind).join(", ")}`);
    expect(st.active).toBe(true);
    expect(await app.js<boolean>(`!!document.querySelector('[data-testid="replay"]')`)).toBe(true);
    // (nothing of the live flight's interface over the replay)
    const over = await app.js<string[]>(
      `[[150, 175], [800, 20], [800, 600]].flatMap(([x, y]) => document.elementsFromPoint(x, y).filter((e) => e.offsetWidth && getComputedStyle(e).display !== "none").slice(0, 3).map((e) => e.tagName + "." + e.className))`,
    );
    console.log(`  over the view: ${over.join(" | ")}`);
    const said0 = await app.js<number>(`__bh.voice.said.length`);
    for (const m of ["chase", "orbit", "flyby", "cockpit"]) {
      await app.js(`(() => { __bh.flight.replay.shot(${JSON.stringify(m)}); __bh.flight.replay.seek(-14); return 1; })()`);
      await Bun.sleep(m === "flyby" ? 2600 : 1500);
      await shot(`replay-${m}`);
      expect(await R<string>(`state().shot`)).toBe(m);
    }
    await app.js(`(() => { __bh.flight.replay.shot("auto"); __bh.flight.replay.seek(-20); return 1; })()`);
    const seen = new Set<string>();
    for (let i = 0; i < 14; i++) {
      seen.add(await R<string>(`state().shot`));
      await Bun.sleep(1000);
    }
    console.log(`  the director's shots: ${[...seen].join(", ")}`);
    console.log(`  said during the replay: ${JSON.stringify(await app.js(`__bh.voice.said.slice(${said0}).map((x) => x.text ?? x)`))}`);
    expect(seen.size).toBeGreaterThan(1);
    await app.js(`(() => { __bh.flight.replay.close(); return 1; })()`);
    await Bun.sleep(500);
    const after = await app.js<{ d: number; inc: number; t: number }>(
      `({ d: __bh.settings.distance, inc: __bh.settings.inclination, t: __bh.sim.time })`,
    );
    // (put back as it was — the time where it was, the craft too —, then flying on)
    expect(after.d).toBeCloseTo(before.d, 6);
    expect(Math.abs(after.t - before.t)).toBeLessThan(1);
    await Bun.sleep(2000);
    expect(await app.js<number>(`__bh.camera.airInfo().speed`)).toBeGreaterThan(80);
  }, 180_000);

  test("the trailer: its title, its moments' captions, its end; its draft video begun", async () => {
    expect(await R<string | null>(`trailer()`)).toBeNull();
    await Bun.sleep(1200);
    expect(await app.js<boolean>(`document.body.classList.contains("replay-cinema")`)).toBe(true);
    await shot("trailer-title");
    await app.waitFor(`__bh.flight.replay.state().trailer?.card === null`, 10_000);
    await Bun.sleep(1500);
    await shot("trailer-moment");
    const cap = await app.js<string>(`document.querySelector(".rp-lower")?.textContent ?? ""`);
    console.log(`  caption: ${cap}`);
    expect(cap.length).toBeGreaterThan(3);
    const n = await R<number>(`state().trailer.of`);
    await app.waitFor(`!__bh.flight.replay.state().trailer`, 20_000 + n * 10_000);
    expect(await R<boolean>(`state().playing`)).toBe(false);
    // (its video: the scene put back, the trailer rendered as a take — a draft, stopped after a few frames)
    expect(await R<string | null>(`video(true)`)).toBeNull();
    await app.waitFor(`(__bh.flight.replay.videoState()?.frame ?? 0) > 6`, 120_000);
    await shot("trailer-video");
    const v = await app.js<{ frames: number }>(`__bh.flight.replay.videoState()`);
    console.log(`  the draft: ${v.frames} frames`);
    expect(v.frames).toBeGreaterThan(60);
    await app.js(`(() => { __bh.flight.replay.videoStop(); return 1; })()`);
    await app.waitFor(`!__bh.flight.replay.videoState()`, 60_000);
    expect(await R<boolean>(`state().active`)).toBe(false);
  }, 300_000);

  test("a guns fight replayed: the bandit drawn where it was", async () => {
    await app.js(
      `(async () => { const t = __bh.tars.tools().find((x) => x.name === "f35"); await t.run({ action: "fly", id: "guns" }, new AbortController().signal); return 1; })()`,
    );
    await app.waitFor(`__bh.camera.combat?.status === "run"`, 30_000);
    await Bun.sleep(5000);
    await app.js(`(() => { __bh.camera.combatTrigger("lock"); __bh.camera.gunTrigger = true; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { __bh.camera.gunTrigger = false; return 1; })()`);
    await Bun.sleep(2000);
    expect(await R<string | null>(`open()`)).toBeNull();
    const m = await R<{ kind: string; t0: number; t1: number }[]>(`state().moments`);
    console.log(`  moments: ${JSON.stringify(m)}`);
    await app.js(
      `(() => { __bh.flight.replay.shot("orbit"); __bh.flight.replay.seek(-4.5); __bh.flight.replay.play(false); return 1; })()`,
    );
    await Bun.sleep(2500);
    const others = await app.js<number>(`__bh.renderer.combatOthers.length`);
    console.log(`  the others drawn in the replay: ${others}`);
    expect(others).toBeGreaterThan(0);
    await shot("replay-fight");
    await app.js(`(() => { __bh.flight.replay.close(); __bh.camera.combatEnd(); return 1; })()`);
  }, 180_000);

  test("a view of exception's photograph: the photo mode framed as the scene says", async () => {
    console.log(`  ${await app.js<string>(`__bh.flight.views.fly("view-grand-canyon")`)}`);
    await app.waitFor(`__bh.camera.mission?.run.spec.id === "view-grand-canyon"`, 30_000);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(5000);
    await app.js(`(() => { __bh.mode.set("photo"); return 1; })()`);
    await Bun.sleep(3000);
    const s = await app.js<{ mount: string; fov: number; dof: boolean; yaw: number }>(
      `({ mount: __bh.settings.shipMount, fov: __bh.settings.fov, dof: __bh.settings.dof, yaw: __bh.camera.outside.yaw })`,
    );
    console.log(`  the photo: ${JSON.stringify(s)}`);
    expect(s.mount).toBe("around");
    expect(s.fov).toBeCloseTo(60, 0);
    expect(s.dof).toBe(true);
    expect(s.yaw).toBeCloseTo(140, 0);
    await shot("scene-photo");
    await app.press("Escape");
  }, 240_000);
});
