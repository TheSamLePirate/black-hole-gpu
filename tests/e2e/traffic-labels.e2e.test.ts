import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { at, frameOn, GEARUP, injectTraffic, runTo, sfoPlanes, W01R, W28L } from "./lib/sfo-traffic";

// The traffic's labels hidden behind what hides their object (Sam's coordinator, 25 Nov 2026 — « labels drawn over buildings and
// terrain that hide their object »): ui/overlay.ts asks the renderer about each mark (renderer.labelAsk), which reads the scene's
// occlusion depth at five points over its object after the frame (renderer.labelSeen) — no pass of its own —, the label and the lights
// faded out where the scene holds something nearer. At San Francisco (lib/sfo-traffic.ts), United's A320 parked at boarding area G
// framed from the apron (seen: its label shown), then from behind the pier's building (hidden: its label gone), then from the apron
// again (shown again).
// Steps: 1 boot · 2 SFO and its traffic · 3 seen from the apron · 4 hidden behind the pier · 5 seen again.
// Shots: TL_OUT (remote-results/traffic-labels): seen-from-the-apron.png, hidden-behind-the-pier.png, seen-again.png.
// Earth data: the e2e disk cache (SFO: USGS/NAIP, no IGN).
// Duration: ~2.5 min (boot and SFO's tiles ~1.5 min, each framing ≤ 60 s for its data).
// Done when: the label is seen from the apron, hidden behind the building, seen again — each within 5 s of the view held.

const OUT = process.env.TL_OUT ?? "remote-results/traffic-labels";
const ID = "e2ep01";

describe.skipIf(!E2E)("the traffic's labels: hidden behind what hides their aircraft", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    app.steps(["boot", "SFO and its traffic", "seen from the apron", "hidden behind the pier", "seen again"]);
    app.estimate(150);
    await app.step("boot");
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { Object.assign(__bh.settings, { traffic: true, autosave: false, trafficDelay: 60 }); return 1; })()`);
    await app.js(`__bh.game.setDate("2026-11-24T20:30:00Z")`);
    await app.stepDone("booted");
    await app.step("SFO and its traffic");
    await app.js(`(() => { __bh.settings.ship = false; __bh.refresh(); return 1; })()`);
    await app.waitFor("!__bh.camera.piloting && !__bh.camera.spectating", 20_000);
    const P0 = at(W28L, 1200, -500);
    await app.js(`(() => __bh.viewAt(${P0.lat}, ${P0.lon}, { altM: 400, heading: 300, pitch: -12, fov: 50 }) ?? null)()`);
    await app.waitFor(`__bh.sys.runways().filter((r) => r.world?.field === "KSFO").length >= 4`, 45_000);
    await app.dataSettled("SFO's relief and imagery", { maxMs: 90_000 });
    const t28 = at(W28L, 0, 0),
      t01 = at(W01R, 0, 0);
    const G28 = await app.js<number>(`__bh.sys.groundAt(${t28.lat}, ${t28.lon})`);
    const G01 = await app.js<number>(`__bh.sys.groundAt(${t01.lat}, ${t01.lon})`);
    expect(await injectTraffic(app, sfoPlanes(G28, G01))).toBe(8);
    await runTo(app, GEARUP + 2);
    await app.stepDone("8 avions de ligne");
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** the label's answer once the view is held: seen or hidden, waited for up to 5 s; and the other marks' */
  const seenAfter = async (want: boolean) => {
    const t0 = Date.now();
    let v: boolean | null = null;
    while (Date.now() - t0 < 5000) {
      v = await app.js<boolean | null>(`(() => { __bh.touch(); return __bh.renderer.labelSeen.get("${ID}") ?? null; })()`);
      if (v === want) break;
      await Bun.sleep(250);
    }
    const all = await app.js<Record<string, boolean>>(`Object.fromEntries(__bh.renderer.labelSeen)`);
    return { v, all };
  };
  const view = async (name: string, yaw: number, want: boolean) => {
    await app.step(name);
    await frameOn(app, ID, yaw, 0.5, 1.5);
    await app.settled(60_000);
    await Bun.sleep(1500);
    const r = await seenAfter(want);
    await Bun.sleep(400);
    await app.shot(`${OUT}/${name.replace(/ /g, "-")}.png`);
    console.log(`  ${name} (yaw ${yaw}°): ${ID} ${r.v}; all marks ${JSON.stringify(r.all)}`);
    expect(r.v).toBe(want);
    await app.stepDone(`${ID} ${r.v ? "visible" : "caché"}`);
  };

  test("seen from the apron, hidden behind the pier's building, seen again", async () => {
    await view("seen from the apron", -30, true);
    await view("hidden behind the pier", 150, false);
    await view("seen again", -30, true);
    expect(app.cdp.errors).toEqual([]);
  }, 360_000);
});
