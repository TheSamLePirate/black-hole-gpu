import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Selecting a track by a click (PLAN-RADAR-AAA RD9), real mouse events: in a fight over the Alps, from the cockpit, a
// drone's symbol on the HUD's radar scope clicked — selected on all the pilot's screens (the scope's amber ring, its card
// in the view), not locked —; clicked again — locked —; a click in the empty sky lets the selection go, the lock kept;
// a track in the view clicked; a symbol touched on the panoramic display's TSD selected too. Never a body: flying, a
// click on the Earth selects nothing. (E2E_SHOTS=<dir>: the card.)

describe.skipIf(!E2E)("selecting a track by a click", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const hits = () => app.js<{ id: string; x: number; y: number; r: number }[]>(`__bh.radar.hits()`);
  const click = async (x: number, y: number) => {
    await app.mouse("move", x, y);
    await app.mouse("down", x, y);
    await app.mouse("up", x, y);
    await Bun.sleep(250);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.9, 6.9, 4500, 90, 230); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
      c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("ap"); c.jetToggle("athr"); __bh.settings.shipMount = "cockpit";
      __bh.settings.f35Radar = true; __bh.settings.f35RadarRange = "80"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.waitFor(`__bh.camera.radar.tracks.size >= 3`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("a symbol clicked on the HUD's scope: selected, not locked; clicked again: locked", async () => {
    await app.js(`(() => { __bh.camera.radar.unlock(); __bh.radar.select(null); return 1; })()`);
    await app.waitFor(`__bh.radar.hits().some((h) => h.id.startsWith("cmb:"))`, 10_000);
    const H = (await hits()).find((h) => h.id.startsWith("cmb:"))!;
    await click(H.x, H.y);
    const a = await app.js<{ sel: string | null; lock: string | null; card: boolean }>(
      `({ sel: __bh.camera.pictureSelected, lock: __bh.camera.radar.lock, card: !!__bh.camera.flightInfo().pic?.some((p) => p.selected) })`,
    );
    console.log(`  clicked ${H.id}: ${JSON.stringify(a)}`);
    expect(a.sel).toBe(H.id);
    expect(a.lock).toBeNull();
    expect(a.card).toBe(true);
    if (shots) await app.shot(`${shots}/selected.png`);
    const H2 = (await hits()).find((h) => h.id === H.id)!;
    await click(H2.x, H2.y);
    expect(await app.js<string | null>(`__bh.camera.radar.lock`)).toBe(H.id);
  }, 60_000);

  test("a click in the empty sky: the selection let go, the lock kept — never a body selected", async () => {
    const target0 = await app.js<string>(`__bh.settings.target`);
    const lock0 = await app.js<string | null>(`__bh.camera.radar.lock`);
    // (high in the view, far from any symbol)
    const H = await hits();
    let p = { x: 800, y: 120 };
    for (const q of [
      { x: 800, y: 120 },
      { x: 1200, y: 160 },
      { x: 400, y: 160 },
    ])
      if (H.every((h) => Math.hypot(h.x - q.x, h.y - q.y) > h.r + 30)) {
        p = q;
        break;
      }
    await click(p.x, p.y);
    expect(await app.js<string | null>(`__bh.camera.pictureSelected`)).toBeNull();
    expect(await app.js<string | null>(`__bh.camera.radar.lock`)).toBe(lock0);
    expect(await app.js<string>(`__bh.settings.target`)).toBe(target0);
  }, 30_000);

  test("the trails (RD7): off — the lock's alone —; 30 s — every track's past echoes on the scope, the TSD, the map", async () => {
    await app.js(`(() => { __bh.settings.radarTrails = "off"; __bh.settings.radarTrailLock = true; return 1; })()`);
    await Bun.sleep(4500);
    const off = await app.js<{ lock: number; others: number }>(`(() => { const R = __bh.camera.flightInfo().radar;
      return { lock: R.contacts.filter((c) => c.locked).reduce((m, c) => Math.max(m, c.hist?.length ?? 0), 0),
        others: R.contacts.filter((c) => !c.locked && !c.selected).reduce((m, c) => m + (c.hist?.length ?? 0), 0) }; })()`);
    console.log(`  trails off: the lock's ${off.lock} points, the others' ${off.others}`);
    expect(off.lock).toBeGreaterThanOrEqual(2);
    expect(off.others).toBe(0);
    await app.js(`(() => { __bh.settings.radarTrails = "short"; return 1; })()`);
    await Bun.sleep(4500);
    const on = await app.js<number>(`__bh.camera.flightInfo().radar.contacts.filter((c) => (c.hist?.length ?? 0) >= 2).length`);
    console.log(`  trails 30 s: ${on} tracks with a trail`);
    expect(on).toBeGreaterThanOrEqual(3);
  }, 60_000);

  test("P11 — the wheel: over the HUD's scope its range a step a notch, over the TSD its own; the camera's field untouched", async () => {
    await app.js(`(() => { __bh.settings.f35RadarRange = "40"; return 1; })()`);
    await Bun.sleep(400);
    const S = await app.js<{ range: number; disc: { x: number; y: number; r: number } }>(`__bh.radar.scope()`);
    const fov0 = await app.js<number>(`__bh.settings.fov`);
    await app.mouse("move", S.disc.x, S.disc.y);
    // (two notches out: 40 → 80 → 160 km)
    await app.mouse("wheel", S.disc.x, S.disc.y, { deltaY: 100 });
    await Bun.sleep(300);
    const r1 = await app.js<string>(`__bh.settings.f35RadarRange`);
    console.log(`  the scope: 40 → ${r1} km`);
    expect(r1).toBe("160");
    expect(await app.js<number>(`__bh.settings.fov`)).toBe(fov0);
    // (a point of the screen over a TSD page in the cockpit: its range a step in)
    const pt = await app.js<{ x: number; y: number } | null>(`(() => {
      const R = __bh.renderer, p = __bh.pcd.pcd, b = __bh.camera.canvas.getBoundingClientRect();
      for (let j = 0; j < 50; j++) for (let i = 0; i < 80; i++) {
        const x = b.left + ((i + 0.5) / 80) * b.width, y = b.top + b.height * 0.45 + ((j + 0.5) / 50) * b.height * 0.55;
        const h = R.ship.jetPick(((x - b.left) / b.width) * 2 - 1, 1 - ((y - b.top) / b.height) * 2);
        if (h?.screen && p.pageAt(h.screen.u, h.screen.v) === "TSD") return { x, y };
      }
      return null; })()`);
    expect(pt).not.toBeNull();
    const t0 = await app.js<number>(`__bh.pcd.pcd.range`);
    await app.mouse("move", pt!.x, pt!.y);
    await app.mouse("wheel", pt!.x, pt!.y, { deltaY: -50 });
    await Bun.sleep(300);
    const t1 = await app.js<number>(`__bh.pcd.pcd.range`);
    console.log(`  the TSD: ${t0} → ${t1}`);
    expect(t1).toBeLessThan(t0);
    expect(await app.js<number>(`__bh.settings.fov`)).toBe(fov0);
    await app.js(`(() => { __bh.settings.f35RadarRange = "80"; return 1; })()`);
  }, 60_000);

  test("a track touched on the panoramic display's TSD: selected", async () => {
    await app.waitFor(`__bh.pcd.pcd.hits && [...__bh.pcd.pcd.hits.values()].flat().some((b) => b.r.w === 40)`, 15_000);
    const r = await app.js<{ u: number; v: number } | null>(`(() => { const p = __bh.pcd.pcd;
      for (const list of p.hits.values()) for (const b of list) if (b.r.w === 40) return { u: (b.r.x + 20) / ${"p.canvas.width"}, v: (b.r.y + 20) / p.canvas.height };
      return null; })()`);
    expect(r).not.toBeNull();
    const said = await app.js<string | null>(`__bh.pcd.pcd.touch(${r!.u}, ${r!.v})`);
    console.log(`  TSD touched: ${said}`);
    expect(await app.js<string | null>(`__bh.camera.pictureSelected`)).not.toBeNull();
  }, 30_000);
});
