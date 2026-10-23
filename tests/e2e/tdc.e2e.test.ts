import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The designation cursor (TDC — PLAN-RADAR-AAA constat 29), with a pad of the page's own (navigator.getGamepads replaced):
// the F-35 over the Alps against the drones, no mouse. Both bumpers held: the cursor on the HUD's scope (chase view);
// the right stick steered onto a drone's symbol; A: selected (no gun), A again: locked. Then in the cockpit, the head on
// a PCD page showing the drones (the FCR, a TSD): the cursor on that page; steered onto a drone's symbol there; A: selected. Let go: no cursor. A HOTAS's
// button bound to the held « tdc » does the same (its commands' held set). (E2E_SHOTS=<dir>: the cursor on each.)

const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  window.__pad = { id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  return 1;
})()`;

describe.skipIf(!E2E)("the designation cursor (TDC)", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const hold = (n: number, on: boolean) =>
    app.js(`(window.__pad.buttons[${n}].pressed = ${on}, window.__pad.buttons[${n}].value = ${on ? 1 : 0}, 1)`);
  const press = async (n: number, ms = 120) => {
    await hold(n, true);
    await Bun.sleep(ms);
    await hold(n, false);
    await Bun.sleep(200);
  };
  const stick = (x: number, y: number) => app.js(`(window.__pad.axes[2] = ${x}, window.__pad.axes[3] = ${-y}, 1)`);
  /** the right stick steered until the cursor stands on the goal (its place on the cursor's own screen); how far off */
  const steer = async (goal: string) => {
    let off = Infinity;
    for (let i = 0; i < 120; i++) {
      const g = await app.js<{ dx: number; dy: number; k: number } | null>(`(() => {
        const T = __bh.camera.tdc, G = (${goal})();
        if (!T.on || !G) return null;
        // (a PCD page's v goes down the display: the stick up moves the cursor up)
        return { dx: G.x - T.x, dy: G.down ? T.y - G.y : G.y - T.y, k: G.k };
      })()`);
      if (!g) break;
      off = Math.hypot(g.dx, g.dy);
      if (off < g.k) break;
      // (proportional, the stick's curve and dead zone allowed for)
      const sx = Math.max(-1, Math.min(1, (g.dx / g.k) * 0.12)),
        sy = Math.max(-1, Math.min(1, (g.dy / g.k) * 0.12));
      const lift = (v: number) => (v === 0 ? 0 : Math.sign(v) * Math.max(0.2, Math.abs(v)));
      await stick(lift(sx), lift(sy));
      await Bun.sleep(60);
    }
    await stick(0, 0);
    await Bun.sleep(100);
    return off;
  };

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(FAKE_PAD);
    await app.js(`(() => { __bh.game.flyAt(45.9, 6.9, 4500, 90, 230); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
      c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("ap"); c.jetToggle("athr"); __bh.settings.shipMount = "chase";
      __bh.settings.f35Radar = true; __bh.settings.f35RadarRange = "80"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.waitFor(`__bh.camera.radar.tracks.size >= 3`, 30_000);
    await app.waitFor(`!!__bh.camera.jetPadOut`, 10_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the HUD's scope: both bumpers, the cursor; steered onto a drone; A selects (no gun), A again locks", async () => {
    await app.js(`(() => { __bh.camera.radar.unlock(); __bh.radar.select(null); return 1; })()`);
    await app.waitFor(`__bh.radar.hits().some((h) => h.id.startsWith("cmb:"))`, 10_000);
    await hold(4, true);
    await hold(5, true);
    await app.waitFor(`__bh.camera.tdc.on && __bh.camera.tdc.screen?.kind === "scope"`, 5000);
    expect(await app.js<boolean>(`!!__bh.camera.flightInfo().tdc`)).toBe(true);
    const id = await app.js<string>(`__bh.radar.hits().find((h) => h.id.startsWith("cmb:")).id`);
    // (the drone's symbol as a share of the scope's radius: x right, y up; reached within a third of its reach)
    const off = await steer(`() => { const S = __bh.radar.scope(), H = __bh.radar.hits().find((h) => h.id === ${JSON.stringify(id)});
      if (!S.disc || !H) return null; return { x: (H.x - S.disc.x) / S.disc.r, y: -(H.y - S.disc.y) / S.disc.r, k: (H.r / S.disc.r) * 0.4 }; }`);
    console.log(`  the cursor on ${id}: ${off.toFixed(3)} of the scope's radius off`);
    await shot("tdc-scope");
    const shots0 = await app.js<number>(`__bh.camera.combat?.world?.stores?.gun ?? 0`);
    await press(0);
    expect(await app.js<string | null>(`__bh.camera.pictureSelected`)).toBe(id);
    expect(await app.js<number>(`__bh.camera.combat?.world?.stores?.gun ?? 0`)).toBe(shots0);
    await press(0);
    expect(await app.js<string | null>(`__bh.camera.radar.lock`)).toBe(id);
    await hold(4, false);
    await hold(5, false);
    await app.waitFor(`!__bh.camera.tdc.on`, 3000);
    expect(await app.js<unknown>(`__bh.camera.flightInfo().tdc`)).toBeNull();
  }, 120_000);

  test("in the cockpit, the head on a PCD page with the drones: the cursor on that page; steered onto one; A selects it", async () => {
    await app.js(`(() => { __bh.camera.radar.unlock(); __bh.radar.select(null); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    // (the head turned down onto a TSD page by the right stick — the pad's head: where the stick points —, the view's
    // centre on it; then both bumpers: the head stays there, the stick let go)
    let found = false;
    for (const y of [-0.8, -0.9, -1, -0.7, -0.6])
      for (const x of [0, -0.1, 0.1, -0.2, 0.2, -0.3, 0.3]) {
        if (found) break;
        await stick(x, y);
        await Bun.sleep(400);
        // (a page with a drone's symbol on it — the FCR's, a TSD's at its range)
        found = await app.js<boolean>(`(() => { const p = __bh.pcd.pcd, h = __bh.renderer.ship.jetPick(0, 0);
          const R = h?.screen ? p.pageRect(h.screen.u, h.screen.v) : null;
          if (!R || !p.hits) return false;
          for (const list of p.hits.values()) for (const b of list) if (b.r.w === 40) {
            const u = (b.r.x + 20) / p.canvas.width, v = (b.r.y + 20) / p.canvas.height;
            if (u >= R.rect.u0 && u <= R.rect.u1 && v >= R.rect.v0 && v <= R.rect.v1) return true;
          }
          return false; })()`);
      }
    expect(found).toBe(true);
    await app.waitFor(`__bh.pcd.pcd.hits && [...__bh.pcd.pcd.hits.values()].flat().some((b) => b.r.w === 40)`, 15_000);
    await hold(4, true);
    await hold(5, true);
    await stick(0, 0);
    await app.waitFor(`__bh.camera.tdc.on && __bh.camera.tdc.screen?.kind === "pcd"`, 5000);
    const page = await app.js<string>(`__bh.camera.tdc.screen.page`);
    console.log(`  the cursor on the PCD's ${page}`);
    expect(["TSD", "FCR"]).toContain(page);
    // (a drone's symbol on that page — a 40-wide hit within the cursor's page)
    const off = await steer(`() => { const p = __bh.pcd.pcd, T = __bh.camera.tdc, R = T.screen.rect;
      for (const list of p.hits.values()) for (const b of list) if (b.r.w === 40) {
        const u = (b.r.x + 20) / p.canvas.width, v = (b.r.y + 20) / p.canvas.height;
        if (u >= R.u0 && u <= R.u1 && v >= R.v0 && v <= R.v1) return { x: u, y: v, k: 8 / p.canvas.width, down: true };
      }
      return null; }`);
    console.log(`  on a drone's symbol: ${(off * 1000).toFixed(1)} ‰ of the display off`);
    await shot("tdc-pcd");
    await press(0);
    const sel = await app.js<string | null>(`__bh.camera.pictureSelected`);
    console.log(`  selected: ${sel}`);
    expect(sel).not.toBeNull();
    await hold(4, false);
    await hold(5, false);
    await app.waitFor(`!__bh.camera.tdc.on && !__bh.pcd.pcd.tdc`, 3000);
  }, 120_000);

  test("a HOTAS's button bound to the held « tdc »: the cursor; the « designate » action: picks under it", async () => {
    await hold(4, false);
    await hold(5, false);
    await stick(0, 0);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; __bh.camera.setLook(0, 0); __bh.radar.select(null); return 1; })()`);
    await Bun.sleep(800);
    // (the controllers' commands as a HOTAS's would give them: its button held on « tdc »)
    await app.js(`(() => { const P = __bh.camera.padControls; const read = P.read.bind(P);
      P.read = () => { const f = read() ?? { commands: { axes: {}, actions: new Map(), held: new Set() }, pressed: [], devices: [] };
        f.commands.held.add("tdc"); P.last = f; return f; }; window.__hotasRead = read; return 1; })()`);
    await app.waitFor(`__bh.camera.tdc.on && __bh.camera.tdc.screen?.kind === "scope"`, 5000);
    // (the cursor put on a drone's symbol, as the slew would)
    await app.js(`(() => { const S = __bh.radar.scope(), H = __bh.radar.hits().find((h) => h.id.startsWith("cmb:"));
      const T = __bh.camera.tdc; T.x = (H.x - S.disc.x) / S.disc.r; T.y = -(H.y - S.disc.y) / S.disc.r; window.__tdcId = H.id; return 1; })()`);
    const said = await app.js<string>(`__bh.camera.tdcDesignate()`);
    console.log(`  designate: ${said}`);
    expect(await app.js<string | null>(`__bh.camera.pictureSelected`)).toBe(await app.js<string>(`window.__tdcId`));
    await app.js(`(() => { const P = __bh.camera.padControls; P.read = window.__hotasRead; return 1; })()`);
    await app.waitFor(`!__bh.camera.tdc.on`, 3000);
  }, 60_000);
});
