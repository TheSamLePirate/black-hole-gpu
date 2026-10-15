import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The missions (docs/PLAN-AVIATION-AAA.md, P1): first the Alps as ever; then the renegade's briefing, started by its
// button (a real click), the airliner set where the mission says (the traffic off), turned away with its transponder
// off — the objectives on screen —, joined (placed beside it) and identified, then sent to Lyon; then the strike in
// Corsica from the Ford: its SAM and truck hit, landed aboard, the mission won and its debrief. (Headless and whole:
// tests/mission.test.ts.) (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the missions", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const state = () =>
    app.js<{ id: string; t: number; state: Record<string, string>; status: string; pending: number } | null>(
      `__bh.flight.missions.state()`,
    );
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("the renegade: briefed, started, turned away, joined and identified, sent to Lyon", async () => {
    await app.js(`(() => { __bh.flight.missions.brief("renegade"); return 1; })()`);
    await app.waitFor(`!!document.querySelector('[data-testid="mission-go"]')`, 5000);
    await shot("renegade-brief");
    await app.click(`[data-testid="mission-go"]`);
    await app.waitFor(`__bh.flight.missions.state()?.id === "renegade"`, 10_000);
    // (its airliner in the fight's world, the transponder off and turned south at 3 s)
    await app.waitFor(`__bh.camera.combat?.world.targets.some((q) => q.kind === "airliner" && q.squawkOff)`, 20_000);
    const turned = `(() => { const q = __bh.camera.combat.world.targets.find((x) => x.kind === "airliner"); return Math.abs((Math.atan2(q.v[0], q.v[1]) * 180 / Math.PI + 360) % 360 - 165) < 8; })()`;
    await app.waitFor(turned, 60_000);
    await shot("renegade-hud");
    // (joined: placed 250 m behind it, 60 m on its right, at its height and speed)
    const q = await app.js<{ lat: number; lon: number; alt: number; agl: number; hdg: number; speed: number }>(`(() => {
      const C = __bh.camera.combat, A = C.def.anchor, q = C.world.targets.find((x) => x.kind === "airliner"), D = Math.PI / 180, R = 6371008.8;
      const hdg = (Math.atan2(q.v[0], q.v[1]) / D + 360) % 360, h = hdg * D;
      const e = q.p[0] + Math.cos(h) * 60 - Math.sin(h) * 250, n = q.p[1] - Math.sin(h) * 60 - Math.cos(h) * 250;
      return { lat: A.lat + n / (D * R), lon: A.lon + e / (D * R * Math.cos(A.lat * D)), alt: q.p[2], agl: q.p[2] - C.world.groundZ(e, n), hdg, speed: Math.hypot(q.v[0], q.v[1]) };
    })()`);
    console.log(`  the renegade: heading ${q.hdg.toFixed(0)}°, ${q.alt.toFixed(0)} m, ${q.speed.toFixed(0)} m/s`);
    expect(Math.abs(q.hdg - 165)).toBeLessThan(20);
    await app.js(`(() => { __bh.game.flyAt(${q.lat}, ${q.lon}, ${q.agl}, ${q.hdg}, ${q.speed}); return 1; })()`);
    await app.waitFor(`__bh.flight.missions.state()?.state.ident === "done"`, 20_000);
    const taken = await app.js<string>(`__bh.camera.combat.world.targets.find((x) => x.kind === "airliner").name`);
    console.log(`  identified: ${taken}`);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
    await shot("renegade-ident");
    // (sent to Lyon: heading for it — its turn at some 2.4°/s)
    const toLyon = `(() => { const C = __bh.camera.combat, A = C.def.anchor, D = Math.PI / 180, q = C.world.targets.find((x) => x.kind === "airliner");
      const e = (5.0811 - A.lon) * D * 6371008.8 * Math.cos(A.lat * D) - q.p[0], n = (45.7256 - A.lat) * D * 6371008.8 - q.p[1];
      const want = Math.atan2(e, n) / D, hdg = Math.atan2(q.v[0], q.v[1]) / D, d = ((hdg - want + 540) % 360) - 180;
      return Math.abs(d) < 10; })()`;
    await app.waitFor(toLyon, 90_000);
    const st = await state();
    expect(st?.state.escort).toBe("active");
    await app.js(`(() => { __bh.flight.missions.abort(); __bh.settings.shipMount = "cockpit"; return 1; })()`);
  }, 180_000);

  test("the Corsica strike: from the Ford, its targets hit, landed aboard — won, debriefed", async () => {
    await app.js(`(() => { __bh.flight.missions.fly("corsica-strike"); return 1; })()`);
    await app.waitFor(`__bh.camera.carrierNow().length > 0 && (__bh.camera.combat?.world.targets.length ?? 0) >= 2`, 20_000);
    await Bun.sleep(2500);
    await shot("corsica-start");
    // (the SAM and the truck hit: their objectives done)
    await app.js(
      `(() => { const W = __bh.camera.combat.world; for (const q of W.targets.filter((x) => x.kind === "sam" || x.kind === "truck")) W.hitTarget(q.id, 999, "jdam"); return 1; })()`,
    );
    await app.waitFor(`__bh.flight.missions.state()?.state.truck === "done" && __bh.flight.missions.state()?.state.sam === "done"`, 10_000);
    // (aboard the Ford: won)
    await app.js(`__bh.camera.carrierLand("ford")`);
    await app.waitFor(`__bh.flight.missions.last()?.status === "won"`, 20_000);
    await app.waitFor(`!!document.querySelector('[data-testid="mission-debrief"]')`, 5000);
    const L = await app.js<{ brief: { twenty: number; letter: string; lines: { state: string }[] } }>(`__bh.flight.missions.last()`);
    console.log(`  Corsica: ${L.brief.twenty}/20 ${L.brief.letter} — ${L.brief.lines.map((l) => l.state).join(", ")}`);
    expect(L.brief.lines.map((l) => l.state)).toEqual(["done", "done", "active", "done"]);
    await Bun.sleep(1000);
    await shot("corsica-debrief");
  }, 180_000);
});
