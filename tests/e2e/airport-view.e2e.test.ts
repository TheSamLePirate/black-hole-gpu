import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-AEROPORT-AAA V12: the airport mode end to end, by the real mouse, on the real traffic — from the title screen, the Airport card,
// KLAX (busy at every hour); the mode on: no HUD, its panel, its caption, the cinema bars; a real movement filmed by the Cinema director
// until its touchdown or its lift-off (three shots at least); a row of its lists clicked: that aircraft followed, its card; clicked
// again: the director's again; the radio's lines asked of the voices; the panel's × : the mode left, the HUD back.
// Duration: ~4 min on kerr-mini (the traffic's own pace).
// Done when: a real movement was filmed past its event, a row followed and let go, the mode left cleanly.

const DIR = "remote-results/airport-view";
mkdirSync(DIR, { recursive: true });

interface St {
  code: string;
  mode: string;
  shot: string;
  current: string | null;
  queue: { id: string; cs: string; eta: number; dep: boolean }[];
}
const STATE = "__bh.airport.state()";

describe.skipIf(!E2E)("the airport mode: KLAX's real movements filmed, its lists, its radio", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 900, tiles: true });
    await app.waitFor(`!!document.querySelector("[data-testid=title-mode-airport]")`, 120_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the title's Airport card, KLAX: the mode on — no HUD, its panel, its caption, the bars", async () => {
    app.step("1. the title's Airport card, KLAX");
    await app.click("[data-testid=title-mode-airport]");
    await app.waitFor(`!!document.querySelector("[data-testid=title-act-airport-KLAX]")`, 10_000);
    await app.shot(`${DIR}/1-airport-screen.png`);
    await app.click("[data-testid=title-act-airport-KLAX]");
    await app.waitFor(`${STATE}?.code === "KLAX"`, 90_000);
    await app.settled(60_000);
    const ui = await app.js<{ mode: boolean; hud: string; panel: boolean; caption: boolean; bars: boolean; dir: string }>(`(() => ({
      mode: document.body.classList.contains("airport-mode"),
      hud: getComputedStyle(document.getElementById("hud")).display,
      panel: !document.querySelector("[data-testid=airport-ui]").hidden,
      caption: !document.querySelector("[data-testid=airport-caption]").hidden,
      bars: !document.querySelector(".airport-bars").hidden,
      dir: __bh.airport.state().mode,
    }))()`);
    console.log(`  2. the mode: ${JSON.stringify(ui)}`);
    await app.shot(`${DIR}/2-mode-on.png`);
    expect(ui).toEqual({ mode: true, hud: "none", panel: true, caption: true, bars: true, dir: "cinema" });
  }, 200_000);

  test("a real movement filmed by Cinema until its touchdown or lift-off: three shots at least", async () => {
    app.step("3. a movement in the queue");
    await app.waitFor(`(${STATE}?.queue.length ?? 0) > 0`, 90_000);
    let S = await app.js<St>(STATE);
    console.log(`  3. queue: ${S.queue.map((q) => `${q.cs}${q.dep ? "↗" : "↘"}${Math.round(q.eta)}`).join(" ")}; filming ${S.current}`);
    app.step("4. filmed to its event");
    // (the one filmed followed until its event has passed — in chunks of a minute at most, the shots noted as they come)
    const shots: string[] = [];
    let id = S.current;
    let passed = false;
    for (let k = 0; k < 240 && !passed; k++) {
      S = await app.js<St>(STATE);
      if (S.current !== id) {
        // (one done or skipped: the next one filmed from its start)
        id = S.current;
        shots.length = 0;
      }
      if (shots.at(-1) !== S.shot) {
        shots.push(S.shot);
        if (shots.length <= 6) await app.shot(`${DIR}/4-${String(shots.length).padStart(2, "0")}-${S.shot}.png`);
      }
      const q = S.queue.find((x) => x.id === S.current);
      if (k % 10 === 0) console.log(`     ${k} s: ${q ? `${q.cs} ${Math.round(q.eta)} s` : "—"} · ${S.shot}`);
      passed = !!q && q.eta < -3 && shots.length >= 3;
      await Bun.sleep(1000);
    }
    console.log(`  4. filmed: ${shots.join(" → ")}`);
    expect(passed).toBeTrue();
    expect(new Set(shots).size).toBeGreaterThanOrEqual(3);
  }, 300_000);

  test("a row clicked: that aircraft followed, its card; clicked again: the director's", async () => {
    app.step("5. a row followed");
    const id = await app.js<string>(
      `document.querySelector("[data-testid^=airport-ui-row-]:not(.on)")?.dataset.testid.replace("airport-ui-row-", "") ?? ""`,
    );
    expect(id).not.toBe("");
    await app.click(`[data-testid="airport-ui-row-${id}"]`);
    await app.waitFor(`__bh.airport.state().current === ${JSON.stringify(id)}`, 5000);
    await app.waitFor(`!!document.querySelector("[data-testid=airport-ui-card]")`, 3000);
    await app.settled(30_000);
    await app.shot(`${DIR}/5-followed.png`);
    const pinned = await app.js<boolean>(
      `document.querySelector('[data-testid="airport-ui-row-${id}"]')?.classList.contains("pin") ?? false`,
    );
    console.log(`  5. ${id} followed, pinned in the list: ${pinned}`);
    expect(pinned).toBeTrue();
    await app.click(`[data-testid="airport-ui-row-${id}"]`);
    await app.waitFor(`!document.querySelector('[data-testid="airport-ui-row-${id}"]')?.classList.contains("pin")`, 5000);
  }, 120_000);

  test("the radio: the tower's and the crews' lines asked of the voices", async () => {
    app.step("6. the radio");
    await app.waitFor(`__bh.voice.asked.some((x) => x.speaker === "tower")`, 90_000);
    const R = await app.js<string[]>(
      `__bh.voice.asked.filter((x) => x.speaker === "tower" || x.speaker === "pilot").slice(-6).map((x) => x.speaker + ": " + x.text)`,
    );
    console.log(`  6. radio:\n${R.map((x) => `     ${x}`).join("\n")}`);
    expect(R.some((x) => /^tower: .*(cleared to land|cleared for takeoff|line up and wait|contact)/.test(x))).toBeTrue();
  }, 120_000);

  test("the panel's ×: the mode left, the HUD back, no page error", async () => {
    app.step("7. the mode left");
    await app.click("[data-testid=airport-ui-quit]");
    await app.waitFor(`!document.body.classList.contains("airport-mode") && !${STATE}`, 5000);
    const hud = await app.js<string>(`getComputedStyle(document.getElementById("hud")).display`);
    console.log(`  7. left: the HUD ${hud}`);
    expect(hud).not.toBe("none");
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
