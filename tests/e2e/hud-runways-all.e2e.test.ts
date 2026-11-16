import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { HELD } from "./lib/held";
import { expectFlightPhase } from "./lib/flight-state";

// All the airport's runways on the HUD (docs/PLAN-APPROCHES.md AP7 — Sam, 15 Nov 2026: on by default, toggled from the wheel and the
// Labo, no key): the F-35 on a final to Roissy (four runways), its ILS on 27R engaged; the runway landed on drawn bright, the other
// three toned down with their ends' numbers; the option off: the landing runway alone. Captures with and without.
//
// Done when: the runway's view carries the three other runways (their ends named) with the option on, none with it off; the
// captures taken.
// Duration: about 1 min (the boot, the F-35 placed on 27R's final 12 km out; two captures).

describe.skipIf(!E2E)("all the airport's runways on the HUD", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0, hudAllRunways: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    // (Roissy's field in, its approaches too)
    await app.js(`__bh.sys.approaches("LFPG").then((l) => l.length)`);
    // (on 27R's axis 12 km out, at its slope's height, heading in at 95 m/s; the ILS on 27R)
    await app.js(`(async () => { const l = await __bh.sys.approaches("LFPG"), a = l.find((x) => x.id === "I27R");
      const D = Math.PI / 180, back = (a.crs + 180) * D, d = 12000 / 6371000, la = a.thr.lat * D, lo = a.thr.lon * D;
      const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(back));
      const lon = lo + Math.atan2(Math.sin(back) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
      __bh.game.flyAt(lat / D, lon / D, 640, a.crs, 95); ${HELD} __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await app.waitFor(`!!__bh.camera.geoNow() && __bh.camera.geoNow().gs > 60`, 15_000);
    // (rule 13 of E2E-VOLS: placed as a pilot leaves it — its holds, its thrust, its gear — asserted)
    await expectFlightPhase(app, "approach", {}, "placed");
    await app.js(`(() => { __bh.fleet.fuel.f35 = 3000; return __bh.camera.ilsStart("LFPG", { runway: "27R" }); })()`);
    await app.waitFor(`!!__bh.camera.ilsRun`, 10_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("on (the default): the three other runways, their ends named; off: the landing runway alone", async () => {
    await app.waitFor(`(__bh.camera.runwayView()?.others?.length ?? 0) >= 3`, 15_000);
    const on = await app.js<{ des: string; others: string[] }>(`(() => { const v = __bh.camera.runwayView();
      return { des: v.des ?? String(v.rwy), others: v.others.map((o) => o.le + "/" + o.he) }; })()`);
    console.log(`  on: landing ${on.des}, the others ${on.others.join(" ")}`);
    expect(on.others.length).toBe(3);
    await Bun.sleep(1500);
    await shot("hud-runways-all-on");
    await app.js(`(() => { __bh.settings.hudAllRunways = false; return 1; })()`);
    await app.waitFor(`!__bh.camera.runwayView()?.others`, 5000);
    await Bun.sleep(800);
    await shot("hud-runways-all-off");
    await app.js(`(() => { __bh.settings.hudAllRunways = true; __bh.camera.ilsOff(); return 1; })()`);
  }, 60_000);
});
