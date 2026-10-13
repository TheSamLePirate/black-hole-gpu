import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-F35 F8: a flight plan made by hand — ⇧O opens its panel, clicks on the map add its waypoints, an airfield
// from the list —, then flown by NAV (⇧N): each point passed in turn, the altitudes and speeds of the plan
// flown, its end reached over Edwards; the route and the bingo on the cockpit's display.

describe.skipIf(!E2E)("the F-35's flight plan", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.freeze(true); __bh.game.setDate("2067-06-21T17:30"); __bh.settings.vessel = "f35";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      // (in the air north-east of Edwards, heading 040° away from it: the plan flies it round and home)
      __bh.game.glideTo("Edwards", 30, 3.0, 230);
      const c = __bh.camera; c.pilot.setAuto("none"); c.pilot.auto = "none"; c.pilot.throttle = 0.7; c.pilot.engineNow = 0.7;
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      return 1; })()`);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("⇧O: the panel; clicks on the map add waypoints, the airfield list the arrival", async () => {
    await app.press("KeyO", "O", { shift: true });
    await app.waitFor(`!!document.querySelector("[data-testid=route-panel]")`, 5000);
    await app.click("[data-testid=rp-here]");
    // (two clicks on the map, apart: two user points — the map centred on the craft at zoom 7, ~1 km a pixel)
    const r = await app.hit(".rp-map canvas");
    for (const [dx, dy] of [
      [45, -50],
      [-55, -25],
    ] as const) {
      await app.mouse("move", r.x + dx, r.y + dy);
      await app.mouse("down", r.x + dx, r.y + dy);
      await app.mouse("up", r.x + dx, r.y + dy);
      await Bun.sleep(120);
    }
    await app.js(`(() => { const s = document.querySelector(".rp-sel"); s.value = "Edwards Air Force Base"; return 1; })()`);
    await app.click("[data-testid=rp-addfield]");
    const names = await app.js<string[]>(`__bh.camera.nav.route.wps.map((w) => w.name)`);
    console.log(`  route: ${names.join(" → ")}`);
    expect(names.length).toBe(4);
    expect(names[1]).toBe("WP01");
    expect(names[3]).toBe("KEDW");
    expect(await app.js<number>(`document.querySelectorAll(".rp-row[data-testid^=rp-wp-]").length`)).toBe(4);
    await app.shot(`${process.env.E2E_SHOTS ?? "/tmp"}/f35-route-panel.png`);
    await app.press("Escape");
  }, 60_000);

  test("⇧N: NAV flies it — each point passed, the arrival's altitude and speed, its end over the field", async () => {
    await app.js(`(() => { const R = __bh.camera.nav.route; R.wps[3].alt = 2500; R.wps[3].spd = 160; __bh.camera.routeChanged(); return 1; })()`);
    await app.press("KeyN", "N", { shift: true });
    expect(await app.js<boolean>(`__bh.camera.nav.on.l && __bh.camera.nav.on.v`)).toBe(true);
    const r = await app.js<{ log: string[]; passed: number[]; end: number; alt: number; spd: number; ann: string }>(`(() => {
      const c = __bh.camera; const log = [], passed = []; let t = 0, ann = "";
      for (let k = 0; k < 1500 * 30; k++) {
        __bh.step(1 / 30); t += 1 / 30;
        const o = c.nav.last.l; if (o && o.passed >= 0) passed.push(o.passed);
        if (c.nav.say) { log.push(Math.round(t) + " s " + c.nav.say); c.nav.say = null; }
        if (k === 300) ann = JSON.stringify([c.nav.on.l, c.nav.on.v]);
        if (!c.nav.on.l) break;
      }
      const g = c.geoNow(); const R = c.nav.route.wps; const f = R[R.length - 1];
      const end = Math.hypot((g.lat - f.lat) * 111e3, (g.lon - f.lon) * 111e3 * Math.cos(f.lat * Math.PI / 180));
      return { log, passed, end, alt: g.alt, spd: c.airFlight.last.speed, ann };
    })()`);
    console.log(r.log.map((l) => `  ${l}`).join("\n"));
    expect(r.passed).toEqual([1, 2]);
    expect(r.end).toBeLessThan(600);
    expect(Math.abs(r.alt - 2500)).toBeLessThan(400);
    expect(Math.abs(r.spd - 160)).toBeLessThan(20);
  }, 300_000);
});
