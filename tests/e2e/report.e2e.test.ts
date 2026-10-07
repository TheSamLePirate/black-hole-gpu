import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The flight's report (PLAN-HUB HB4): flown from the HUD gallery's states to their end — the final
// approach to its touchdown at Le Bourget, the docking to its capture at the ISS —, the report's card
// comes up: its grade (A … F, out of 20), each figure judged; Escape closes it; the journal says it. The
// Lander put down on its engines beside Kennedy's runway: graded on its site, not on the runway's axis
// (before: 54 m off it, a D; then on its distance to the last flight's site, Le Bourget — a C); a save loaded closes the last flight's card (before: it stayed over the next).

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
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const fly = async (state: string, timeout: number): Promise<Seen> => {
    const json = await Bun.file(`${import.meta.dir}/../hud/states/${state}.json`).text();
    await app.js(`(__bh.freeze(false), __bh.game.importSave(${JSON.stringify(json)}, false), true)`);
    await app.waitFor(`(() => { const r = document.querySelector("[data-testid=flight-report]"); return !!r && !r.hidden; })()`, timeout);
    return app.js<Seen>(`(() => {
      const r = document.querySelector("[data-testid=flight-report]");
      return { shown: !r.hidden, title: r.querySelector(".fl-rp-what").textContent, letter: r.querySelector(".fl-rp-grade b").textContent,
        lines: r.querySelectorAll(".fl-stgrid b").length, labels: [...r.querySelectorAll(".fl-stgrid span")].map((x) => x.textContent) };
    })()`);
  };

  test("a landing: touched down at Le Bourget, graded; Escape closes it", async () => {
    const r = await fly("06-final", 120_000);
    expect(r.title).toContain("Le Bourget");
    // (the autopilot's landing: soft, on the axis — the card's text in the failure: an F seen once in three runs)
    const text = await app.js<string>(`document.querySelector("[data-testid=flight-report]").innerText.replace(/\\n/g, " | ")`);
    expect({ letter: r.letter, text }).toMatchObject({ letter: expect.stringMatching(/^[AB]$/) });
    expect(r.lines).toBeGreaterThanOrEqual(5);
    await app.press("Escape");
    await app.waitFor(`document.querySelector("[data-testid=flight-report]").hidden`, 3000);
    expect(await app.js<boolean>(`__bh.game.log.events.some((e) => /Landing · .* — [ABCDF] \\(/.test(e.text))`)).toBe(true);
  }, 180_000);

  test("the Lander on its engines: no runway's axis judged; a save loaded closes its card", async () => {
    const r = await fly("09-lander-descent", 60_000);
    expect(r.labels).not.toContain("Off the axis");
    expect(r.labels).not.toContain("Past the threshold");
    // (nor the last flight's site: Le Bourget, 7 187 km away — a C)
    expect(r.title).not.toContain("Le Bourget");
    expect(["A", "B"]).toContain(r.letter);
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
