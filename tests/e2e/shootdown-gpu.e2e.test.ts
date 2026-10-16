import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The shot's GPU cost (tests/e2e/shootdown.e2e.test.ts's scene, from the cockpit): the quality "RT max" (realtime) at
// each fixed subsampling — ×8, ×6, ×4, ×3, ×2 (SUBS="8,6,4,3,2") —, the whole scene flown again for each: low over the
// sea, the drone, the airliner, the frigate locked (Tab), fired at (=, Enter), the head locked on each shot (⇧L), let
// go once down. Each frame: the GPU's time (renderer.lastGpuMs: submit → done) and the frame's interval, by phase —
// the cruise, each shot (fire → hit), each fall (hit → crash), each crash's 5 s, the frigate sinking. A table at the
// end; E2E_SHOTS=<dir>: the views at each drone's crash, and gpu.json.

const SUBS = (process.env.SUBS ?? "8,6,4,3,2").split(",").map(Number);
const along = (km: number) => ({ lat: 41.9 - 0.008455 * km, lon: 6.6 + 0.004126 * km });
const SPEC = {
  v: 1,
  id: "e2e-shootdown",
  title: "Tirs en vol bas",
  brief: "Un drone, un avion de ligne devenu hostile, une frégate, de face : verrouiller, tirer.",
  start: { lat: 41.9, lon: 6.6, alt: 120, hdg: 160, speed: 220, variant: "B", loadout: "as" },
  time: { localHour: 11 },
  weather: { preset: "fair", wind: 1, clouds: 0.1 },
  units: [
    { id: "drone", kind: "drone", name: "Drone", side: "hostile", at: { ...along(7), alt: 160 }, hdg: 340, speed: 120 },
    { id: "liner", kind: "airliner", name: "Airliner", side: "hostile", at: { ...along(30), alt: 450 }, hdg: 340, speed: 170 },
    { id: "frigate", kind: "ship", name: "Frigate", side: "hostile", at: along(45), hdg: 340, speed: 9 },
  ],
  objectives: [{ id: "all", kind: "destroy", units: ["drone", "liner", "frigate"], text: "Tout détruire" }],
};

type Row = {
  sub: number;
  phase: string;
  n: number;
  gpu50: number;
  gpu95: number;
  dt50: number;
  dt95: number;
  fps: number;
  block: string;
  size: string;
};

describe.skipIf(!E2E)("the shot's GPU cost, RT max at ×8, ×6, ×4, ×3, ×2", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const rows: Row[] = [];
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const Q = (name: string) => `__bh.camera.combat.world.targets.find((x) => x.name === ${JSON.stringify(name)})`;
  const near = (name: string, m: number) =>
    `(() => { const C = __bh.camera.combat, q = ${Q(name)}, P = C.last; return Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1]) < ${m}; })()`;
  const crashed = (name: string) => `(() => { const q = ${Q(name)}; return !!q.wreck && !Number.isNaN(q.wreck.crashedAt); })()`;
  const phase = (p: string) => app.js(`(() => { window.__phase = ${JSON.stringify(p)}; return 1; })()`);
  const locked = () => app.js<string | null>(`(__bh.camera.combat.world.target(__bh.camera.combat.world.lock) ?? {}).name ?? null`);
  const padlock = async (on: boolean) => {
    if ((await app.js<boolean>(`__bh.camera.padlock`)) !== on) await app.press("KeyL", "L", { shift: true });
  };
  const engage = async (name: string, weapon: string) => {
    for (let i = 0; i < 4 && (await locked()) !== name; i++) {
      await app.press("Tab");
      await Bun.sleep(300);
    }
    for (let i = 0; i < 4 && (await app.js<string>(`__bh.camera.combat.weapon`)) !== weapon; i++) {
      await app.press("Equal", "=");
      await Bun.sleep(200);
    }
    await app.press("Enter");
    await padlock(true);
  };
  /** Each frame's GPU time and interval, its phase (window.__phase), its block and size — until stopped. */
  const SAMPLER = `(() => {
    window.__gpu = []; let last = performance.now();
    const f = () => {
      if (!window.__gpuOn) return;
      const now = performance.now(), R = __bh.renderer;
      if (window.__phase) window.__gpu.push([window.__phase, R.lastGpuMs, now - last, R.realtimeBlockNow, (R.size?.width ?? 0) + "x" + (R.size?.height ?? 0)]);
      last = now;
      requestAnimationFrame(f);
    };
    window.__gpuOn = true; requestAnimationFrame(f); return 1; })()`;

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, f35Invulnerable: true, f35EnemyMissiles: false, f35AutoProtect: false, showFps: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(async () => {
    // the table: each phase, each subsampling
    const out = rows.map(
      (r) =>
        `${String(r.sub).padStart(2)}  ${r.phase.padEnd(15)} ${String(r.n).padStart(5)}  GPU ${r.gpu50.toFixed(1).padStart(5)} / ${r.gpu95.toFixed(1).padStart(5)} ms   frame ${r.dt50.toFixed(1).padStart(5)} / ${r.dt95.toFixed(1).padStart(5)} ms  ${r.fps.toFixed(0).padStart(3)} fps  block ${r.block}  ${r.size}`,
    );
    console.log(`\nsub phase            frames  GPU p50 / p95          frame p50 / p95       fps\n${out.join("\n")}`);
    if (shots) await Bun.write(`${shots}/gpu.json`, JSON.stringify(rows, null, 1));
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(2500);
    await app.shot(`${shots ?? "/tmp"}/alps.png`).catch(() => {});
  }, 240_000);

  for (const sub of SUBS)
    test(`RT max ×${sub}: the drone, the airliner, the frigate`, async () => {
      await app.js(`(() => { __bh.game.quality("realtime"); __bh.game.set("realtimeSubsampling", ${sub}); return 1; })()`);
      console.log(`  ×${sub}: ${await app.js<string>(`__bh.flight.missions.fly(${JSON.stringify(SPEC)})`)}`);
      await app.waitFor(
        `__bh.camera.mission?.run.spec.id === "e2e-shootdown" && __bh.camera.combat?.status === "run" && !!__bh.camera.combat.last`,
        60_000,
      );
      await app.js(
        `(() => { const c = __bh.camera; c.padlock = false; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 120; c.jetModes.spd = 220; c.jetModes.hdg = 160 * Math.PI / 180; __bh.settings.shipMount = "cockpit"; return 1; })()`,
      );
      await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
      await Bun.sleep(2000);
      expect(await app.js<number | string>(`__bh.settings.realtimeSubsampling`)).toBe(sub);
      await app.js(SAMPLER);
      await phase("cruise");
      await app.waitFor(near("Drone", 5500), 60_000);
      // the drone
      await engage("Drone", "aim120");
      await phase("drone shot");
      await app.waitFor(`!${Q("Drone")}.alive`, 60_000);
      await phase("drone fall");
      await app.waitFor(crashed("Drone"), 90_000);
      await phase("drone crash");
      await Bun.sleep(300);
      await shot(`x${sub}-drone-crash`);
      await Bun.sleep(4700);
      await padlock(false);
      await phase("cruise 2");
      // the airliner
      await app.waitFor(near("Airliner", 8000), 150_000);
      await engage("Airliner", "aim9x");
      await phase("liner shot");
      await app.waitFor(`!${Q("Airliner")}.alive`, 60_000);
      await phase("liner fall");
      await app.waitFor(crashed("Airliner"), 120_000);
      await phase("liner crash");
      await Bun.sleep(5000);
      await padlock(false);
      await phase("cruise 3");
      // the frigate
      await app.waitFor(near("Frigate", 20000), 150_000);
      await engage("Frigate", "jsm");
      await phase("frigate shot");
      await app.waitFor(`!${Q("Frigate")}.alive`, 150_000);
      await Bun.sleep(1200);
      await app.press("Escape");
      await phase("frigate sinking");
      await Bun.sleep(8000);
      await padlock(false);
      await app.js(`(() => { window.__gpuOn = false; window.__phase = null; return 1; })()`);
      const S = await app.js<[string, number, number, number, string][]>(`window.__gpu`);
      const q = (v: number[], p: number) => {
        const s = [...v].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? Number.NaN;
      };
      for (const ph of [...new Set(S.map((x) => x[0]))]) {
        const F = S.filter((x) => x[0] === ph);
        const g = F.map((x) => x[1]).filter((x) => x > 0),
          d = F.map((x) => x[2]);
        const blocks = [...new Set(F.map((x) => x[3]))].join("/");
        rows.push({
          sub,
          phase: ph,
          n: F.length,
          gpu50: q(g, 0.5),
          gpu95: q(g, 0.95),
          dt50: q(d, 0.5),
          dt95: q(d, 0.95),
          fps: (1000 * F.length) / d.reduce((a, b) => a + b, 0),
          block: blocks,
          size: F[0]?.[4] ?? "",
        });
      }
      const r = rows.filter((x) => x.sub === sub);
      console.log(`  ×${sub}: ${r.map((x) => `${x.phase} ${x.gpu50.toFixed(1)} ms`).join(" · ")}`);
      // (the mission done: the next run flies it again)
      await app.js(`(() => { __bh.camera.missionAbort?.(); return 1; })()`);
    }, 600_000);
});
