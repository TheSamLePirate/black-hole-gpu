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
    await app.js(`(() => { __bh.game.flyAt(45.9, 6.9, 4500, 230, 90); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
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
