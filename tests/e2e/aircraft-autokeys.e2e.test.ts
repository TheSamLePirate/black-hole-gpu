import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// U (take off) and F7 (land) on an aircraft in the air (audit 2026-11-10, FX-02; wave 3.4), by the real keys: near
// Edwards, 2 000 m, the throttle at 60 %. Before 13 Nov 2026 both went to the spacecraft's orbital autopilot, which
// refused at once (« the engine … cannot hold the weight ») and cut the throttle to 0 — in flight. Now F7 flies the ILS
// to the nearest runway (the A320 through its FMGC), U in the air says why not, and neither touches the throttle.
// Tiles and IGN blocked.
// Done when: for the F-35 and the A320, F7 engaged an approach and U refused, the throttle kept. Duration: ~1 min.

const OUT = "remote-results/aircraft-autokeys";

interface Seen {
  thr: number;
  auto: string;
  ils: boolean;
  said: string[];
}

describe.skipIf(!E2E)("U and F7 on an aircraft: its own take-off and landing, never the orbital autopilot", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*", "*geopf.fr*", "*ign.fr*"],
    });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** the craft near Edwards, 2 000 m, 150 m/s, its throttle at 60 %, the page held */
  const place = (vessel: string) =>
    app.js<string>(`(() => {
      __bh.freeze(true); __bh.settings.animate = true; __bh.settings.vessel = "${vessel}"; __bh.settings.flightMode = "plane";
      __bh.settings.wind = 0; __bh.settings.damage = false;
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.flyAt(34.75, -117.95, 2000, 45, 150);
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      __bh.camera.pilot.throttle = 0.6;
      window.__said = [];
      const say = __bh.camera.onPilotMessage;
      __bh.camera.onPilotMessage = (m) => { window.__said.push(m); say?.(m); };
      return __bh.fleet.active; })()`);
  /** a real key, then a second of flight: what the craft does and what was said (pilot messages and toasts) */
  const key = async (code: string): Promise<Seen> => {
    // (the journal's lines — every toast is written there —: those after the key)
    const log0 = await app.js<number>(`__bh.game.log.events.length`);
    await app.press(code);
    return app.js<Seen>(`(() => {
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      const c = __bh.camera;
      const toasts = __bh.game.log.events.slice(${log0}).map((e) => e.text);
      return { thr: Math.round(c.pilot.throttle * 100) / 100, auto: c.pilot.auto, ils: !!c.ilsRun || !!c.a320App,
        said: [...window.__said, ...toasts].slice(-3) }; })()`);
  };

  for (const vessel of ["f35", "a320"])
    test(`${vessel}: U in the air refused and said, F7 an approach — the throttle kept`, async () => {
      expect(await place(vessel)).toBe(vessel);
      const u = await key("KeyU");
      console.log(`  ${vessel} U: ${JSON.stringify(u)}`);
      await app.snap(`${OUT}/${vessel}-U.png`);
      expect(u.thr).toBeGreaterThan(0.5);
      expect(u.auto).toBe("none");
      expect(u.said.join(" ")).not.toMatch(/cannot hold the weight/);
      // (refused, and said)
      expect(u.said.join(" ")).toMatch(/Already in the air|by hand/);
      const f7 = await key("F7");
      console.log(`  ${vessel} F7: ${JSON.stringify(f7)}`);
      await app.snap(`${OUT}/${vessel}-F7.png`);
      expect(f7.said.join(" ")).not.toMatch(/cannot hold the weight/);
      expect(f7.ils).toBe(true);
      expect(f7.thr).toBeGreaterThan(0);
    });

  test("no page error", () => {
    expect(app.cdp.errors).toEqual([]);
  });
});
