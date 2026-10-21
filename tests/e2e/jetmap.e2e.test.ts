import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The tactical map (PLAN-RADAR-AAA RD15) — the right panel's in flight, real input: flying the F-35 over the Alps,
// the « Tactical » tab taken by itself, the craft's trace growing and its path ahead drawn; the wheel over it steps its
// range — the camera's field untouched —; its top-left corner dragged makes it larger, kept; then in a room, Ben's F-35
// on Ana's tactical map (the picture's net: track), clicked there: selected. (E2E_SHOTS=<dir>: the map.)

describe.skipIf(!E2E)("the tactical map", () => {
  let a: App;
  let b: App | null = null;
  const shots = process.env.E2E_SHOTS;
  const box = (p: App, sel: string) =>
    p.js<{ x: number; y: number; w: number; h: number } | null>(
      `(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; })()`,
    );
  beforeAll(async () => {
    a = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await a.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.game.flyAt(45.9, 6.9, 4500, 90, 230); const c = __bh.camera;
      c.jetModes.alt = Math.round(c.geoNow().alt); c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("ap"); c.jetToggle("athr");
      __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await a.waitFor(`!!document.querySelector("[data-testid=jetmap]")?.getBoundingClientRect().width`, 20_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("in the air: the tactical tab by itself, the trace growing, the path ahead", async () => {
    await Bun.sleep(4000);
    const r = await a.js<{ trail: number; pred: number; tab: boolean }>(`(() => { const c = __bh.camera;
      return { trail: c.ownTrack.pts.length, pred: c.ownPrediction(120, 10).length,
        tab: document.querySelector(".fl-mapbody")?.classList.contains("tac") ?? false }; })()`);
    console.log(`  ${JSON.stringify(r)}`);
    expect(r.tab).toBe(true);
    expect(r.trail).toBeGreaterThanOrEqual(3);
    expect(r.pred).toBeGreaterThan(5);
    if (shots) await a.shot(`${shots}/jetmap.png`);
  }, 60_000);

  test("the wheel over it steps its range — the camera's field untouched", async () => {
    const m = (await box(a, "[data-testid=jetmap]"))!;
    const k0 = await a.js<number>(`__bh.flight.hud.tacMap.rangeKm`);
    const fov0 = await a.js<number>(`__bh.settings.fov`);
    await a.mouse("move", m.x + m.w / 2, m.y + m.h / 2);
    await a.mouse("wheel", m.x + m.w / 2, m.y + m.h / 2, { deltaY: 120 });
    await Bun.sleep(300);
    const k1 = await a.js<number>(`__bh.flight.hud.tacMap.rangeKm`);
    console.log(`  range ${k0} → ${k1} km`);
    expect(k1).toBeGreaterThan(k0);
    expect(await a.js<number>(`__bh.settings.fov`)).toBe(fov0);
  }, 30_000);

  test("its top-left corner dragged: larger, kept", async () => {
    const g = (await box(a, "[data-testid=map-grip]"))!;
    const s0 = (await box(a, "[data-testid=jetmap]"))!;
    await a.mouse("move", g.x + 6, g.y + 6);
    await a.mouse("down", g.x + 6, g.y + 6);
    for (let k = 1; k <= 8; k++) await a.mouse("move", g.x + 6 - 15 * k, g.y + 6 - 12 * k);
    await a.mouse("up", g.x + 6 - 120, g.y + 6 - 96);
    await Bun.sleep(300);
    const s1 = (await box(a, "[data-testid=jetmap]"))!;
    console.log(`  ${s0.w.toFixed(0)}×${s0.h.toFixed(0)} → ${s1.w.toFixed(0)}×${s1.h.toFixed(0)}`);
    expect(s1.w).toBeGreaterThan(s0.w + 80);
    expect(s1.h).toBeGreaterThan(s0.h + 60);
    expect(await a.js<string | null>(`localStorage.getItem("kerr.map-size")`)).not.toBeNull();
  }, 30_000);

  test("the world's airfields: over Paris, LFPG and LFPB on the map; LFPG's card, added to the plan; KSFO by its code (RD11, RD13)", async () => {
    await a.js(`(() => { __bh.game.flyAt(48.95, 2.45, 2000, 90, 200); const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); const m = __bh.flight.hud.tacMap; m.range = 3; return 1; })()`);
    await a.waitFor(`["LFPG", "LFPB"].every((k) => __bh.flight.hud.tacMap.fieldHitsNow().some((h) => h.code === k))`, 30_000);
    const h = await a.js<{ code: string; x: number; y: number }>(`__bh.flight.hud.tacMap.fieldHitsNow().find((h) => h.code === "LFPG")`);
    const m = (await box(a, "[data-testid=jetmap] canvas"))!;
    await a.js(`(() => { __bh.camera.nav.route.wps.length = 0; return 1; })()`);
    await a.mouse("move", m.x + h.x, m.y + h.y);
    await a.mouse("down", m.x + h.x, m.y + h.y);
    await a.mouse("up", m.x + h.x, m.y + h.y);
    await a.waitFor(`!document.querySelector("[data-testid=jm-card]").hidden`, 3000);
    const card = await a.js<string>(`document.querySelector("[data-testid=jm-card]").textContent`);
    console.log(`  LFPG's card: ${card.slice(0, 160)}`);
    expect(card).toContain("LFPG");
    expect(card).toMatch(/09L|08L|27R|26R/);
    await a.click(`[data-testid=jm-add]`);
    await a.waitFor(`__bh.camera.nav.route.wps.some((w) => w.name === "LFPG")`, 10_000);
    // (any airfield of the world by its code: San Francisco)
    const r = await a.js<{ name: string; lat: number; lon: number } | null>(`(async () => {
      const T = __bh.tars.tools().find((x) => x.name === "flight_plan"); await T.run({ action: "add", query: "KSFO" });
      const w = __bh.camera.nav.route.wps.find((w) => w.name === "KSFO"); return w ? { name: w.name, lat: w.lat, lon: w.lon, field: w.field } : null; })()`);
    console.log(`  KSFO: ${JSON.stringify(r)}`);
    expect(r).not.toBeNull();
    expect(Math.abs(r!.lat - 37.62)).toBeLessThan(0.05);
    if (shots) await a.shot(`${shots}/jetmap-paris.png`);
  }, 120_000);

  test("in a room: Ben's F-35 on Ana's tactical map, clicked there: selected", async () => {
    await a.js(`__bh.net.create("Map")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    const sa = await a.js<number>(`__bh.net.net.room.slot`);
    b = await App.boot({ width: 1200, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.settings.vessel = "f35"; __bh.net.setName("Ben"); return 1; })()`);
    await b.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await b.waitFor(`__bh.net.net.clock.synced`, 30_000);
    // (Ben 8 km ahead of Ana on her heading, at her height, the same way)
    const g = await a.js<{ lat: number; lon: number; alt: number; hdg: number }>(
      `(() => { const g = __bh.camera.geoNow(); return { lat: g.lat, lon: g.lon, alt: g.alt, hdg: __bh.camera.attitudeNow().heading }; })()`,
    );
    const D = Math.PI / 180;
    const lat = g.lat + (Math.cos(g.hdg) * 8000) / 111_195,
      lon = g.lon + (Math.sin(g.hdg) * 8000) / (111_195 * Math.cos(g.lat * D));
    await b.js(`(() => { __bh.game.flyAt(${lat}, ${lon}, ${Math.round(g.alt)}, 230, ${(g.hdg / D).toFixed(1)}); const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); return 1; })()`);
    await b.waitFor(`__bh.net.net.remotes.track(${sa})?.latest?.kind === 3`, 30_000);
    // (Ben in Ana's picture: the room's net: track — or, the free fight on, the fight's target he is taken in as)
    const isBen = `(t) => t.id.startsWith("net:") || /Ben/.test(t.name)`;
    await a.waitFor(`__bh.radar.picture()?.tracks.some(${isBen})`, 30_000);
    const benId = await a.js<string>(`__bh.radar.picture().tracks.find(${isBen}).id`);
    await a.js(`(() => { const m = __bh.flight.hud.tacMap; m.range = 2; return 1; })()`);
    // (the free fight's Ben a foe: on the map once Ana's radar has swept him — a sweep, two seconds)
    console.log(
      `  Ben in Ana's picture: ${await a.js<string>(`(() => { const t = __bh.radar.track(${JSON.stringify(benId)}); return JSON.stringify({ id: t.id, side: t.side, sensors: t.sensors, state: t.state, r: t.r.map(Math.round) }); })()`)}`,
    );
    await a.waitFor(`__bh.flight.hud.tacMap.hitsNow().some((h) => h.id === ${JSON.stringify(benId)})`, 15_000);
    const h = await a.js<{ id: string; x: number; y: number }>(
      `__bh.flight.hud.tacMap.hitsNow().find((h) => h.id === ${JSON.stringify(benId)})`,
    );
    const m = (await box(a, "[data-testid=jetmap] canvas"))!;
    await a.mouse("move", m.x + h.x, m.y + h.y);
    await a.mouse("down", m.x + h.x, m.y + h.y);
    await a.mouse("up", m.x + h.x, m.y + h.y);
    await Bun.sleep(300);
    console.log(`  Ben's track ${h.id} clicked on Ana's map`);
    expect(await a.js<string | null>(`__bh.camera.pictureSelected`)).toBe(h.id);
    if (shots) await a.shot(`${shots}/jetmap-room.png`);
  }, 300_000);
});
