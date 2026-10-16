import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Three shots along the Spanish coast of the Strait of Gibraltar, from the cockpit: first the Alps as ever; then a
// straight run from off Punta Carnero towards Tanger (245°), 300 m over the sea, 2.5 km off the Spanish coast — its
// hills to the right —, past Tarifa, then off the Moroccan coast — Jebel Musa and the Rif to the left —, the real traffic in the strait, a few clouds, a 1.5 m swell. Three enemies head-on, each targeted as a
// pilot does it (Tab, =, Enter), the head locked on it for the shot (⇧L: the zoom follows the missile's target, the
// hit, the fall, the crash), let go once down — ahead again —, then the next: a drone (AIM-120), an airliner (AIM-9X),
// a frigate (JSM). Between them a glance at the hills. (E2E_SHOTS=<dir>: the views.)

/** A point `km` along 245° from the start (2.5 km off Punta Carnero). */
const START = { lat: 36.056, lon: -5.415 };
const along = (km: number) => ({ lat: START.lat - 0.003803 * km, lon: START.lon - 0.010064 * km });
const SPEC = {
  v: 1,
  id: "e2e-gibraltar-shots",
  title: "Trois tirs le long de la côte",
  brief: "D'Algésiras vers Tanger, au ras de l'eau : un drone, un avion de ligne hostile, une frégate, de face.",
  start: { ...START, alt: 300, hdg: 245, speed: 210, variant: "B", loadout: "as" },
  time: { localHour: 11 },
  weather: { preset: "fair", wind: 3, clouds: 0.2, swell: 1.5 },
  units: [
    { id: "drone", kind: "drone", name: "Drone", side: "hostile", at: { ...along(9), alt: 330 }, hdg: 65, speed: 120 },
    { id: "liner", kind: "airliner", name: "Airliner", side: "hostile", at: { ...along(30), alt: 650 }, hdg: 65, speed: 170 },
    { id: "frigate", kind: "ship", name: "Frigate", side: "hostile", at: along(45), hdg: 65, speed: 9 },
  ],
  objectives: [{ id: "all", kind: "destroy", units: ["drone", "liner", "frigate"], text: "Tout détruire" }],
};

describe.skipIf(!E2E)("three shots along the coast of the Strait of Gibraltar, from the cockpit", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const Q = (name: string) => `__bh.camera.combat.world.targets.find((x) => x.name === ${JSON.stringify(name)})`;
  const near = (name: string, m: number) =>
    `(() => { const C = __bh.camera.combat, q = ${Q(name)}, P = C?.last; return !!q && !!P && Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1]) < ${m}; })()`;
  const down = (name: string) =>
    `(() => { const q = ${Q(name)}; return q.kind === "ship" ? !q.alive : !!q.wreck && !Number.isNaN(q.wreck.crashedAt); })()`;
  const locked = () => app.js<string | null>(`(__bh.camera.combat.world.target(__bh.camera.combat.world.lock) ?? {}).name ?? null`);
  const head = () =>
    app.js<{ yaw: number; pitch: number; fov: number }>(
      `({ yaw: __bh.settings.shipLookYaw, pitch: __bh.settings.shipLookPitch, fov: __bh.settings.fov })`,
    );
  const padlock = async (on: boolean) => {
    if ((await app.js<boolean>(`__bh.camera.padlock`)) !== on) await app.press("KeyL", "L", { shift: true });
    expect(await app.js<boolean>(`__bh.camera.padlock`)).toBe(on);
  };
  /** Targeted as a pilot does: Tab until the radar holds it (the real traffic's tracks among them), = until the
   *  weapon wanted, Enter; then the head locked on it. */
  const engage = async (name: string, weapon: string) => {
    for (let i = 0; i < 30 && (await locked()) !== name; i++) {
      await app.press("Tab");
      await Bun.sleep(150);
    }
    if ((await locked()) !== name)
      console.log(
        `  ${name} not locked — tracks: ${await app.js<string>(`[...__bh.camera.radar.tracks.values()].map((t) => t.name).join(", ")`)}`,
      );
    expect(await locked()).toBe(name);
    for (let i = 0; i < 4 && (await app.js<string>(`__bh.camera.combat.weapon`)) !== weapon; i++) {
      await app.press("Equal", "=");
      await Bun.sleep(150);
    }
    expect(await app.js<string>(`__bh.camera.combat.weapon`)).toBe(weapon);
    const n = await app.js<number>(`__bh.camera.combat.world.missiles.length`);
    await app.press("Enter");
    await app.waitFor(`__bh.camera.combat.world.missiles.length > ${n}`, 2000).catch(async () =>
      console.log(
        `  no shot: ${await app.js<string>(`JSON.stringify({ active: document.activeElement?.tagName + "." + document.activeElement?.className, animate: __bh.settings.animate, weapon: __bh.camera.combat.weapon,
        stores: __bh.camera.combat.world.players?.[0]?.stores ?? __bh.camera.combat.last?.stores, said: [...document.querySelectorAll(".toast, .hud-msg, .cb-msg")].map((x) => x.textContent).slice(-3) })`)}`,
      ),
    );
    expect(await app.js<number>(`__bh.camera.combat.world.missiles.length`)).toBeGreaterThan(n);
    await padlock(true);
  };
  /** One enemy: approached, targeted, fired at, followed by the head to its end, the head let go. */
  const sequence = async (name: string, weapon: string, fireAt: number, key: string) => {
    await phase("cruise");
    await app.waitFor(near(name, fireAt), 90_000);
    await shot(`${key}-0-ahead`);
    const d = await app.js<number>(
      `(() => { const C = __bh.camera.combat, q = ${Q(name)}, P = C.last; return Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]); })()`,
    );
    await engage(name, weapon);
    await phase("shot (zoom)");
    await Bun.sleep(1500);
    const h = await head();
    console.log(
      `  ${name}: ${weapon} away at ${(d / 1000).toFixed(1)} km — the head on it ${h.yaw.toFixed(0)}°, ${h.pitch.toFixed(0)}°, the lens ${h.fov.toFixed(1)}°`,
    );
    expect(h.fov).toBeLessThan(30);
    await shot(`${key}-1-zoom`);
    await app.waitFor(`!${Q(name)}.alive`, 120_000);
    // (the last one down ends the mission: its debrief closed at once — the hit seen, not the box)
    if (
      await app.js<boolean>(`!__bh.camera.combat.world.targets.some((q) => q.alive && ["Drone", "Airliner", "Frigate"].includes(q.name))`)
    ) {
      await Bun.sleep(150);
      await app.press("Escape");
    }
    await phase("fall (zoom)");
    await Bun.sleep(300);
    await shot(`${key}-2-hit`);
    await Bun.sleep(3000);
    await shot(`${key}-3-falling`);
    await app.waitFor(down(name), 90_000);
    await phase("crash (zoom)");
    await Bun.sleep(400);
    await shot(`${key}-4-down`);
    await Bun.sleep(2500);
    await phase("cruise");
    await padlock(false);
    await Bun.sleep(600);
    const a = await head();
    expect(Math.abs(a.yaw)).toBeLessThan(1);
    console.log(`  ${name} down; the head ahead again, the lens ${a.fov.toFixed(0)}°`);
  };
  /** Each frame done: the interval since the last one done (the GPU's time per frame while it is what limits),
   *  its submit → done (renderer.lastGpuMs: a queued frame's wait counted — Apple's per-pass timestamps
   *  overlapping), by phase (window.__phase), its block — kept until the end, a table then. */
  const phase = (p: string) => app.js(`(() => { window.__phase = ${JSON.stringify(p)}; return 1; })()`);
  const SAMPLER = `(() => {
    window.__gpu = []; let last = performance.now(), done = __bh.renderer.completedFrames;
    const f = () => {
      if (!window.__gpuOn) return;
      const now = performance.now(), R = __bh.renderer;
      if (R.completedFrames !== done) {
        if (window.__phase) window.__gpu.push([window.__phase, R.lastGpuMs, (now - last) / (R.completedFrames - done), R.realtimeBlockNow]);
        done = R.completedFrames; last = now;
      }
      requestAnimationFrame(f);
    };
    window.__gpuOn = true; requestAnimationFrame(f); return 1; })()`;
  const table = async () => {
    await app.js(`(() => { window.__gpuOn = false; return 1; })()`);
    const S = await app.js<[string, number, number, number][]>(`window.__gpu`);
    const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))] ?? Number.NaN;
    const rows = [...new Set(S.map((x) => x[0]))].map((ph) => {
      const F = S.filter((x) => x[0] === ph);
      const g = F.map((x) => x[1]).filter((x) => x > 0),
        d = F.map((x) => x[2]);
      return `${ph.padEnd(16)} ${String(F.length).padStart(5)}  s→d ${q(g, 0.5).toFixed(1).padStart(5)} / ${q(g, 0.95).toFixed(1).padStart(5)} ms   frame ${q(d, 0.5).toFixed(1).padStart(5)} / ${q(d, 0.95).toFixed(1).padStart(5)} ms  ${((1000 * F.length) / d.reduce((a, b) => a + b, 0)).toFixed(0).padStart(3)} fps  block ${[...new Set(F.map((x) => x[3]))].join("/")}`;
    });
    console.log(`\n  phase            frames  submit→done p50 / p95  frame p50 / p95       fps\n${rows.map((r) => `  ${r}`).join("\n")}`);
    if (shots) await Bun.write(`${shots}/gpu.json`, JSON.stringify(S));
  };
  /** A glance at the hills to the right, and back. */
  const glance = async (key: string) => {
    await app.js(`(() => { __bh.settings.shipLookYaw = 55; __bh.settings.shipLookPitch = 2; return 1; })()`);
    await phase("hills");
    await Bun.sleep(2500);
    await shot(`${key}-hills`);
    await app.js(`(() => { __bh.settings.shipLookYaw = 0; __bh.settings.shipLookPitch = 0; return 1; })()`);
  };

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: true, f35Invulnerable: true, f35EnemyMissiles: false, f35AutoProtect: false, showFps: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(2000);
    await shot("alps");
  }, 240_000);

  test("along the coast: the drone, the airliner, the frigate — targeted, fired at, followed down", async () => {
    await app.js(`(() => { __bh.game.quality("realtime"); return 1; })()`);
    console.log(`  ${await app.js<string>(`__bh.flight.missions.fly(${JSON.stringify(SPEC)})`)}`);
    await app.waitFor(
      `__bh.camera.mission?.run.spec.id === "e2e-gibraltar-shots" && __bh.camera.combat?.status === "run" && !!__bh.camera.combat.last`,
      60_000,
    );
    await app.js(
      `(() => { const c = __bh.camera; c.padlock = false; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        c.jetModes.alt = 300; c.jetModes.spd = 210; c.jetModes.hdg = 245 * Math.PI / 180; __bh.settings.shipMount = "cockpit"; return 1; })()`,
    );
    // (the sea under the line, the hills beside it: the relief along it, every 200 m)
    // (held still while the realtime tracer compiles for the strait's weather: the drone not passed meanwhile)
    await app.js(`(() => { __bh.settings.animate = false; return 1; })()`);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(1500);
    await app.js(`(() => { __bh.settings.animate = true; return 1; })()`);
    const hi =
      await app.js<number>(`(() => { let m = -1e9; for (let k = 0; k <= 275; k++) { const la = ${START.lat} - 0.003803 * k * 0.2, lo = ${START.lon} - 0.010064 * k * 0.2;
      m = Math.max(m, __bh.relief("earth", la, lo)); } return m; })()`);
    console.log(
      `  the highest ground under the run: ${hi.toFixed(0)} m; the drone ${((await app.js<number>(`(() => { const q = ${Q("Drone")}, P = __bh.camera.combat.last; return Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1]); })()`)) / 1000).toFixed(1)} km ahead`,
    );
    await Bun.sleep(1000);
    await shot("0-start");
    await app.js(SAMPLER);
    await sequence("Drone", "aim120", 5000, "1-drone");
    await glance("2");
    await sequence("Airliner", "aim9x", 7000, "3-liner");
    await glance("4");
    await sequence("Frigate", "jsm", 9000, "5-frigate");
    await table();
  }, 600_000);
});
