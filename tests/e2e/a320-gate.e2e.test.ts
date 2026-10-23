import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320 A14 (the ground): the A320 started at a stand of Paris-CDG's terminal 2 — its ground network
// OpenStreetMap's (game/airportfetch.ts: the Overpass answer of tests/fixtures/osm-lfpg-t2.json put in the browser's
// cache first, the run not waiting on the public servers) —: on its stand (its nose wheel on the stop, its nose on the
// stand's heading, the parking brake set), its route out to the runway in use made; the ND's airport map (the taxiways,
// the route in magenta); pushed back, the brake let go: the tower's clearance, the guidance in the view (the route
// ahead on the ground, the next turn's panel).

const shots = process.env.E2E_SHOTS;
const shot = (app: App, name: string) => (shots ? app.shot(`${shots}/${name}.png`) : Promise.resolve());

describe.skipIf(!E2E)("the A320 at the gate", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    const fx = await Bun.file("tests/fixtures/osm-lfpg-t2.json").json();
    await app.js(`(async () => {
      const c = await caches.open("kerr-airportnet-v1");
      await c.put("https://kerr.invalid/airportnet/LFPG", new Response(${JSON.stringify(JSON.stringify(fx.elements))}, { headers: { "content-type": "application/json" } }));
      __bh.settings.vessel = "a320";
      __bh.settings.a320Start = "ready";
      __bh.settings.weather = "fair";
      __bh.refresh();
      __bh.game.setDate("2067-06-01T09:30:00");
      return true;
    })()`);
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("at stand C07: on its stop and heading, the brake set, the route out made", async () => {
    const note = await app.js<string>(`__bh.game.atStand("LFPG", "C07")`);
    console.log(`  ${note}`);
    await app.waitFor("!!__bh.camera.a320Sys", 60_000);
    await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
    const r = await app.js<{ via: string[]; len: number; rwy: string | null; park: boolean; d: number; dh: number }>(`(() => {
      const c = __bh.camera, T = c.a320Taxi, s = T.stand, g = c.geoNow();
      const D = Math.PI / 180;
      // (the reference point 13.65 m behind the stop, on the heading in)
      const n = (s.lat - g.lat) * 111132.95, e = (s.lon - g.lon) * 111319.49 * Math.cos(s.lat * D);
      const hdg = ((c.attitudeNow().heading / D) % 360 + 360) % 360;
      return { via: T.route?.via ?? [], len: T.route?.len ?? 0, rwy: T.rwy, park: c.a320Park, d: Math.hypot(n, e), dh: Math.abs(((hdg - s.hdg + 540) % 360) - 180) };
    })()`);
    console.log(
      `  route out to ${r.rwy}: ${r.len.toFixed(0)} m via ${r.via.join(", ")}; ${r.d.toFixed(1)} m from the stop, heading off ${r.dh.toFixed(1)}°`,
    );
    expect(r.via.length).toBeGreaterThan(0);
    expect(r.park).toBeTrue();
    expect(Math.abs(r.d - 13.65)).toBeLessThan(2.5);
    expect(r.dh).toBeLessThan(3);
    await app.js(
      `(__bh.settings.shipMount = "quarter", __bh.settings.shipLookYaw = 0, __bh.settings.shipLookPitch = -8, __bh.refresh(), true)`,
    );
    await Bun.sleep(4000);
    await shot(app, "a320-gate-stand");
  }, 400_000);

  test("the ND's airport map: the taxiways, the route in magenta", async () => {
    await app.js(`(() => {
      __bh.settings.shipMount = "cockpit"; __bh.refresh();
      __bh.camera.a320Props["instrumentation/efis/inputs/range-nm"] = 10;
      __bh.camera.setLook(8, -14);
      return true;
    })()`);
    await app.waitFor("!!__bh.renderer.a320Du", 60_000);
    await Bun.sleep(3000);
    const lit = await app.js<{ magenta: number; png: string }>(`(async () => {
      const cv = __bh.renderer.a320Du.canvasOf("ND1");
      const x = cv.getContext("2d").getImageData(0, 0, 1024, 1024).data;
      let m = 0; for (let i = 0; i < x.length; i += 4) if (x[i] > 200 && x[i + 1] < 120 && x[i + 2] > 200) m++;
      const b = await cv.convertToBlob({ type: "image/png" });
      const u = new Uint8Array(await b.arrayBuffer());
      let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
      return { magenta: m, png: btoa(s) };
    })()`);
    console.log(`  ND1: ${lit.magenta} magenta pixels`);
    expect(lit.magenta).toBeGreaterThan(500);
    if (shots) await Bun.write(`${shots}/a320-gate-nd.png`, Buffer.from(lit.png, "base64"));
    await shot(app, "a320-gate-cockpit-nd");
  }, 120_000);

  test("the tug pushes the A320 back from its stand, along the network's path, by the End key", async () => {
    const h0 = await app.js<number>(`((__bh.camera.attitudeNow().heading ?? 0) * 180) / Math.PI`);
    await app.press("End");
    await app.waitFor(`__bh.camera.a320Push?.phase === "connected"`, 60_000);
    // (the parking brake off — the tug waits for it —, then the push)
    await app.js(`(__bh.camera.a320Park = false, __bh.camera.a320Props["controls/gear/brake-parking"] = 0, true)`);
    await app.press("End");
    await app.waitFor(`__bh.camera.a320Push?.phase === "pushing"`, 10_000);
    // (moving back at the tug's walking pace)
    await app.waitFor(`Math.abs(__bh.camera.geoNow()?.gs ?? 0) > 1`, 20_000);
    await app.js(`(__bh.settings.shipMount = "quarter", __bh.settings.shipLookPitch = -12, __bh.refresh(), true)`);
    await Bun.sleep(2500);
    await shot(app, "a320-gate-pushing");
    await app.waitFor(`__bh.camera.a320Push?.phase === "stopped"`, 150_000);
    const h1 = await app.js<number>(`((__bh.camera.attitudeNow().heading ?? 0) * 180) / Math.PI`);
    const turned = Math.abs(((h1 - h0 + 540) % 360) - 180);
    console.log(`  pushed: heading ${h0.toFixed(0)}° → ${h1.toFixed(0)}° (${turned.toFixed(0)}° turned)`);
    expect(turned).toBeGreaterThan(60);
    await app.press("End");
    await app.js(`(__bh.camera.a320Park = true, __bh.settings.shipMount = "cockpit", __bh.refresh(), true)`);
  }, 300_000);

  test("pushed back, the brake let go: the clearance, the guidance in the view", async () => {
    const said: string[] = [];
    await app.js(`(() => {
      window.__said = [];
      const c = __bh.camera, f = c.onRadio;
      c.onRadio = (t, r) => (window.__said.push(t), f?.(t, r));
      __bh.game.pushedBack();
      return true;
    })()`);
    await Bun.sleep(1500);
    await app.js(`(__bh.camera.a320Park = false, true)`);
    await app.waitFor(`window.__said.length > 0`, 20_000);
    said.push(...(await app.js<string[]>(`window.__said`)));
    console.log(`  tower: ${said.join(" | ")}`);
    expect(said[0]).toMatch(/via/i);
    await app.js(`(__bh.camera.a320Park = true, __bh.settings.shipMount = "cockpit", __bh.refresh(), __bh.camera.setLook(0, -6), true)`);
    await Bun.sleep(3000);
    const g = await app.js<{ panel: string; shown: boolean; next: string | null }>(`({
      panel: document.querySelector("[data-testid=taxi-panel]").textContent,
      shown: getComputedStyle(document.querySelector("[data-testid=taxi-line]")).display !== "none",
      next: __bh.camera.a320Taxi.cue?.next?.name ?? null,
    })`);
    console.log(`  panel: ${g.panel}`);
    expect(g.shown).toBeTrue();
    expect(g.panel.length).toBeGreaterThan(4);
    await shot(app, "a320-gate-guidance");
    await app.js(`(__bh.settings.shipMount = "quarter", __bh.settings.shipLookPitch = -10, __bh.refresh(), true)`);
    await Bun.sleep(2500);
    await shot(app, "a320-gate-guidance-outside");
  }, 120_000);
});
