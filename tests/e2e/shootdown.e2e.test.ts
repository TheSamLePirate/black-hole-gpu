import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A shot and all it brings, from the cockpit, flying low over the sea west of Sardinia: first the Alps as ever; then
// three enemies coming head-on — a drone, an airliner turned hostile, a frigate —, each targeted as a pilot does it
// (Tab: the radar's lock on the nearest; =: the weapon; Enter: fire), the head locked on it (⇧L: the padlock — it
// follows the lock, the missile's target, the wreck falling, its crash, zoomed): the missile away in its smoke, the
// hit, the aircraft out of control trailing smoke, its explosion where it crashes; the frigate burning and sinking.
// The replay's director over the drone's: the launch from behind, then the lens on it to its crash.
// (E2E_SHOTS=<dir>: the views.)

/** A point `km` along 160° from the start (41.9° N, 6.6° E). */
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

describe.skipIf(!E2E)("low over the sea: a drone, an airliner, a frigate — locked, fired at, down; from the cockpit", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const Q = (name: string) => `__bh.camera.combat.world.targets.find((x) => x.name === ${JSON.stringify(name)})`;
  /** a target: its distance [m], alive, down (crashed, or sunk 4 s ago), its height over the sea */
  const tgt = (name: string) =>
    app.js<{ d: number; alive: boolean; down: boolean; z: number }>(`(() => {
      const C = __bh.camera.combat, W = C.world, q = ${Q(name)}, P = C.last;
      return { d: Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]), alive: q.alive, z: q.p[2] - W.groundZ(q.p[0], q.p[1]),
        down: q.kind === "ship" ? !q.alive && W.t - q.diedAt > 4 : !!q.wreck && !Number.isNaN(q.wreck.crashedAt) };
    })()`);
  /** the head and the lens now */
  const head = () =>
    app.js<{ yaw: number; pitch: number; fov: number }>(
      `({ yaw: __bh.settings.shipLookYaw, pitch: __bh.settings.shipLookPitch, fov: __bh.settings.fov })`,
    );
  const locked = () => app.js<string | null>(`(__bh.camera.combat.world.target(__bh.camera.combat.world.lock) ?? {}).name ?? null`);
  /** Targeted as a pilot does: Tab until the radar holds it, = until the weapon is the one wanted, Enter. What was said. */
  const engage = async (name: string, weapon: string) => {
    for (let i = 0; i < 4 && (await locked()) !== name; i++) {
      await app.press("Tab");
      await Bun.sleep(300);
    }
    expect(await locked()).toBe(name);
    for (let i = 0; i < 4 && (await app.js<string>(`__bh.camera.combat.weapon`)) !== weapon; i++) {
      await app.press("Equal", "=");
      await Bun.sleep(200);
    }
    expect(await app.js<string>(`__bh.camera.combat.weapon`)).toBe(weapon);
    const before = await app.js<number>(`__bh.camera.combat.world.missiles.length`);
    fired = await tapeEnd();
    await app.press("Enter");
    await Bun.sleep(300);
    expect(await app.js<number>(`__bh.camera.combat.world.missiles.length`)).toBeGreaterThan(before);
    // (the shot away: the head locked on it, zoomed — ⇧L)
    await padlock(true);
    return `${name} locked, ${weapon} away`;
  };
  /** The head locked on the target (⇧L) or let go — back ahead, the lens as it was. */
  const padlock = async (on: boolean) => {
    if ((await app.js<boolean>(`__bh.camera.padlock`)) !== on) await app.press("KeyL", "L", { shift: true });
    expect(await app.js<boolean>(`__bh.camera.padlock`)).toBe(on);
  };
  /** the tape's clock as the last shot was fired */
  let fired = 0;
  /** The autopilot's heading on a target, each second (null: stopped). */
  const steer = (name: string | null) =>
    app.js(`(() => { clearInterval(window.__steer); if (${JSON.stringify(name)} === null) return 1;
      window.__steer = setInterval(() => { const C = __bh.camera.combat; if (!C?.last) return; const q = ${Q(name ?? "")}, P = C.last;
        if (q) __bh.camera.jetModes.hdg = Math.atan2(q.p[0] - P.p[0], q.p[1] - P.p[1]); }, 1000); return 1; })()`);
  /** The tape's clock now. */
  const tapeEnd = () => app.js<number>(`__bh.flight.replay.tape().end`);
  const near = (name: string, m: number) =>
    `(() => { const C = __bh.camera.combat, q = ${Q(name)}, P = C.last; return Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1]) < ${m}; })()`;
  const crashed = (name: string) => `(() => { const q = ${Q(name)}; return !!q.wreck && !Number.isNaN(q.wreck.crashedAt); })()`;

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, f35Invulnerable: true, f35EnemyMissiles: false, f35AutoProtect: false, showFps: true }); return 1; })()`,
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
    await Bun.sleep(2500);
    await shot("alps");
  }, 240_000);

  test("the drone head-on: locked, the head on it, an AIM-120 — the hit, out of control in smoke, its crash; the replay", async () => {
    console.log(`  ${await app.js<string>(`__bh.flight.missions.fly(${JSON.stringify(SPEC)})`)}`);
    await app.waitFor(
      `__bh.camera.mission?.run.spec.id === "e2e-shootdown" && __bh.camera.combat?.status === "run" && !!__bh.camera.combat.last`,
      60_000,
    );
    await app.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 120; c.jetModes.spd = 220; c.jetModes.hdg = 160 * Math.PI / 180; __bh.settings.shipMount = "cockpit"; return 1; })()`,
    );
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await app.waitFor(near("Drone", 5500), 60_000);
    await shot("drone-0-ahead");
    console.log(`  ${(await tgt("Drone")).d.toFixed(0)} m: ${await engage("Drone", "aim120")}`);
    const t0 = fired;
    await Bun.sleep(1200);
    const h1 = await head();
    console.log(`  the head on it: ${h1.yaw.toFixed(0)}°, ${h1.pitch.toFixed(0)}°, the lens ${h1.fov.toFixed(0)}°`);
    expect(h1.fov).toBeLessThan(40);
    await shot("drone-1-launch");
    await app.waitFor(`!${Q("Drone")}.alive`, 60_000);
    await Bun.sleep(250);
    await shot("drone-2-hit");
    await Bun.sleep(2500);
    const h2 = await head();
    const d2 = await tgt("Drone");
    console.log(
      `  out of control: ${d2.z.toFixed(0)} m over the sea, ${d2.d.toFixed(0)} m off; the head ${h2.yaw.toFixed(0)}°, ${h2.pitch.toFixed(0)}°`,
    );
    await shot("drone-3-falling");
    await app.waitFor(crashed("Drone"), 90_000);
    const tCrash = await tapeEnd();
    await Bun.sleep(300);
    await shot("drone-4-crash");
    expect(await app.js<number>(`__bh.camera.combat.booms.filter((b) => b.size > 2).length`)).toBeGreaterThan(0);
    await Bun.sleep(4000);
    await shot("drone-5-smoke");
    // (down: the head let go, ahead again)
    await padlock(false);
    await Bun.sleep(800);
    const h3 = await head();
    console.log(`  let go: the head ${h3.yaw.toFixed(0)}°, ${h3.pitch.toFixed(0)}°, the lens ${h3.fov.toFixed(0)}°`);
    expect(Math.abs(h3.yaw)).toBeLessThan(1);
    expect(h3.fov).toBeGreaterThan(40);
    // the replay: the director's cinematic from the launch to the crash
    expect(await app.js<string | null>(`__bh.flight.replay.open()`)).toBeNull();
    await app.js(
      `(() => { __bh.flight.replay.shot("auto"); __bh.flight.replay.seek(${t0} - 1 - __bh.flight.replay.tape().end); __bh.flight.replay.play(true); return 1; })()`,
    );
    const seen: string[] = [];
    let booms = 0;
    const done: Record<string, boolean> = {};
    for (let i = 0; i < 500; i++) {
      const x = await app.js<{ t: number; shot: string; booms: number }>(`__bh.flight.replay.state()`);
      if (seen.at(-1) !== x.shot) seen.push(x.shot);
      booms = Math.max(booms, x.booms);
      const now = x.t + (await tapeEnd());
      if (!done.launch && now > t0 + 1) {
        done.launch = true;
        await shot("drone-6-replay-launch");
      }
      if (!done.lens && x.shot === "target" && now > t0 + 3) {
        done.lens = true;
        await shot("drone-7-replay-lens");
      }
      if (!done.crash && now > tCrash + 0.3) {
        done.crash = true;
        await shot("drone-8-replay-crash");
      }
      if (now > tCrash + 2.5) break;
      await Bun.sleep(80);
    }
    // (back to the flight first — whatever is found below)
    await app.js(`(() => { __bh.flight.replay.close(); return 1; })()`);
    console.log(`  the replay's shots: ${seen.join(" → ")}; up to ${booms} explosion(s) drawn`);
    expect(seen[0]).toBe("chase");
    expect(seen).toContain("target");
    expect(booms).toBeGreaterThan(0);
  }, 400_000);

  test("the airliner head-on: Tab to it, the AIM-9X, its fall in smoke, the head following it down, its crash", async () => {
    await steer("Airliner");
    const a0 = await tgt("Airliner");
    console.log(`  the airliner: ${a0.d.toFixed(0)} m, ${a0.z.toFixed(0)} m over the sea, alive ${a0.alive}`);
    await app.waitFor(near("Airliner", 8000), 150_000);
    await steer(null);
    await shot("liner-0-ahead");
    console.log(`  ${(await tgt("Airliner")).d.toFixed(0)} m: ${await engage("Airliner", "aim9x")}`);
    await app.waitFor(`!${Q("Airliner")}.alive`, 60_000);
    await Bun.sleep(250);
    await shot("liner-1-hit");
    await Bun.sleep(4000);
    const h = await head();
    console.log(`  falling, the head ${h.yaw.toFixed(0)}°, ${h.pitch.toFixed(0)}°, the lens ${h.fov.toFixed(0)}°`);
    await shot("liner-2-falling");
    await app.waitFor(crashed("Airliner"), 120_000);
    await Bun.sleep(300);
    await shot("liner-3-crash");
    expect(await app.js<number>(`__bh.camera.combat.booms.filter((b) => b.size > 2).length`)).toBeGreaterThan(0);
    await Bun.sleep(3000);
    await padlock(false);
  }, 300_000);

  test("the frigate ahead: Tab to it, a JSM sea-skimming, the explosion, the frigate burning, sinking", async () => {
    await steer("Frigate");
    await app.waitFor(near("Frigate", 20000), 150_000);
    await steer(null);
    await shot("frigate-0-ahead");
    console.log(`  ${(await tgt("Frigate")).d.toFixed(0)} m: ${await engage("Frigate", "jsm")}`);
    await app.waitFor(`!${Q("Frigate")}.alive`, 150_000);
    // (the mission won: its debrief closed — the frigate burning behind it)
    await Bun.sleep(1200);
    await app.press("Escape");
    await Bun.sleep(300);
    await shot("frigate-1-hit");
    await Bun.sleep(8000);
    const f = await tgt("Frigate");
    console.log(`  sinking: ${f.z.toFixed(1)} m; smoke segments ${await app.js<number>(`__bh.renderer.shipContrails?.n ?? 0`)}`);
    await shot("frigate-2-sinking");
    expect(await app.js<number>(`__bh.renderer.shipContrails?.n ?? 0`)).toBeGreaterThan(0);
    await padlock(false);
    await Bun.sleep(800);
    await shot("frigate-3-ahead-again");
  }, 300_000);
});
