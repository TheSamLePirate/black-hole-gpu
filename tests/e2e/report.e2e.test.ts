import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The flight's report (PLAN-HUB HB4): flown from the HUD gallery's states to their end — the final
// approach to its touchdown at Le Bourget, the docking to its capture at the ISS —, the report's card
// comes up: its grade (A … F, out of 20), each figure judged; Escape closes it; the journal says it. The
// Lander put down beside Kennedy's runway (not rolling): graded on its site, not on the runway's axis
// (before: 54 m off it, a D; then on its distance to the last flight's site, Le Bourget — a C); a save loaded closes the last flight's card (before: it stayed over the next).
// The card in the pilot's units (audit FX-17): with the imperial option, its sink in ft/min and its speed in kt (before 13 Nov 2026: m/s).
// Done when: each card comes up graded, Escape closes it, the imperial card writes ft/min and kt.
// Duration: ~3 min.

interface Seen {
  shown: boolean;
  title: string;
  letter: string;
  lines: number;
  labels: string[];
}

describe.skipIf(!E2E)("the flight's report", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const card = async (timeout: number): Promise<Seen> => {
    await app.waitFor(`(() => { const r = document.querySelector("[data-testid=flight-report]"); return !!r && !r.hidden; })()`, timeout);
    return app.js<Seen>(`(() => {
      const r = document.querySelector("[data-testid=flight-report]");
      return { shown: !r.hidden, title: r.querySelector(".fl-rp-what").textContent, letter: r.querySelector(".fl-rp-grade b").textContent,
        lines: r.querySelectorAll(".fl-stgrid b").length, labels: [...r.querySelectorAll(".fl-stgrid span")].map((x) => x.textContent) };
    })()`);
  };
  const fly = async (state: string, timeout: number): Promise<Seen> => {
    const json = await Bun.file(`${import.meta.dir}/../hud/states/${state}.json`).text();
    await app.js(`(__bh.freeze(false), __bh.game.importSave(${JSON.stringify(json)}, false), true)`);
    return card(timeout);
  };
  /** The Lander set hovering 300 m over the ground beside Kennedy's runway and put down by its landing autopilot,
   *  stepped (the HUD gallery's state 09 — the Lander 0.6 m above its contact, 7 Oct 2026 — starts 27 m up since the
   *  ground went over WGS84 and the geoid: a fall at 23 m/s, the gear collapsed, no card) */
  const landLander = async () => {
    const r = await app.js<{ landed: boolean; fail: string | null; active: string; auto: string; alt: number | null }>(`(() => {
      __bh.freeze(true);
      __bh.settings.vessel = "lander";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.hoverOver("earth", 28.6, -80.6, 0.3);
      const c = __bh.camera;
      c.pilot.auto = "none"; c.pilot.setAuto("land");
      for (let i = 0; i < 30 * 200 && !c.ourLanded && !c.airFlight.failure; i++) __bh.step(1 / 30);
      __bh.freeze(false);
      const sf = c.surfaceInfo?.();
      return { landed: !!c.ourLanded, fail: c.airFlight.failure, active: __bh.fleet.active, auto: c.pilot.auto,
        alt: sf ? Math.round(sf.alt) : null, vv: sf ? +sf.vVert.toFixed(1) : null, said: __bh.game.log.events.slice(-3).map((e) => e.text) }; })()`);
    console.log(`  the Lander: ${JSON.stringify(r)}`);
    expect(r).toMatchObject({ landed: true, fail: null, active: "lander" });
    return card(10_000);
  };

  test("a landing: touched down at Le Bourget, graded; Escape closes it", async () => {
    const r = await fly("06-final", 120_000);
    expect(r.title).toContain("Le Bourget");
    // (the autopilot's landing: soft, on the axis — the card's text in the failure: an F seen once in three runs,
    // the runway read within the touchdown's step, its frame not yet the craft's — now graded the frame after)
    const text = await app.js<string>(`document.querySelector("[data-testid=flight-report]").innerText.replace(/\\n/g, " | ")`);
    expect({ letter: r.letter, text }).toMatchObject({ letter: expect.stringMatching(/^[AB]$/) });
    expect(r.lines).toBeGreaterThanOrEqual(5);
    await app.press("Escape");
    await app.waitFor(`document.querySelector("[data-testid=flight-report]").hidden`, 3000);
    expect(await app.js<boolean>(`__bh.game.log.events.some((e) => /Landing · .* — [ABCDF] \\(/.test(e.text))`)).toBe(true);
  }, 180_000);

  test("a landing's card in the pilot's units (audit FX-17): imperial ft/min and kt, the units set back after", async () => {
    // (the Lander put down by its autopilot beside Kennedy — the Ranger's final at Le Bourget, state 06, goes around 1.7 km
    // off the axis since before 13 Nov 2026)
    await app.js(`(__bh.settings.units = "imperial", true)`);
    await landLander();
    const text = await app.js<string>(`document.querySelector("[data-testid=flight-report]").innerText.replace(/\\n/g, " | ")`);
    console.log(`  the card in imperial: ${text}`);
    await app.snap("remote-results/report/imperial.png");
    await app.js(`(__bh.settings.units = "metric", true)`);
    await app.press("Escape");
    expect(text).toMatch(/\d+ ft\/min/);
    expect(text).toMatch(/\d+ kt/);
  }, 180_000);

  test("the Lander put down beside a runway: no runway's axis judged; a save loaded closes its card", async () => {
    const r = await landLander();
    expect(r.labels).not.toContain("Off the axis");
    expect(r.labels).not.toContain("Past the threshold");
    // (nor the last flight's site: Le Bourget, 7 187 km away — a C)
    expect(r.title).not.toContain("Le Bourget");
    expect(r.labels).toContain("Sink rate");
    const json = await Bun.file(`${import.meta.dir}/../hud/states/10-dock.json`).text();
    await app.js(`(__bh.game.importSave(${JSON.stringify(json)}, false), true)`);
    await app.waitFor(`document.querySelector("[data-testid=flight-report]").hidden`, 3000);
  }, 120_000);

  test("a docking: captured at the ISS, graded", async () => {
    const r = await fly("10-dock", 180_000);
    expect(r.title).toContain("ISS");
    expect(r.letter).toBe("A");
    expect(r.lines).toBe(6);
  }, 240_000);
});
