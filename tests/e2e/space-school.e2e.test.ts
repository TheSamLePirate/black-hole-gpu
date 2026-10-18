import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX X9: the space flight school in the real page, real clicks — the school opened in a spacecraft lists
// its fifteen space lessons first; the holds lesson's card, its demonstration: the scene set up (a 400 km orbit), TARS
// flying every step (the SAS, prograde, retrograde, normal, let go), the lesson's report at its end. ~1 min.

describe.skipIf(!E2E)("the space flight school (X9)", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the school: the space lessons first in a spacecraft; the holds lesson demonstrated to its report", async () => {
    await app.js(`(__bh.flight.school.open(), 1)`);
    await app.waitFor(`document.querySelectorAll('[data-testid^="space-lesson-"]').length === 15`, 5000);
    // (in a spacecraft: the space school's heading first)
    const first = await app.js<string>(`document.querySelector('[data-testid="flight-school"] h4')?.textContent ?? ""`);
    expect(first).toBe("The space school");
    await app.click('[data-testid="space-lesson-holds"]');
    await app.waitFor(`!!document.querySelector('[data-testid="space-lesson-card"]')`, 5000);
    await app.click('[data-testid="space-lesson-demo"]');
    await app.waitFor(`!!__bh.camera.spaceCourse`, 15_000);
    const said: string[] = [];
    await app.js(
      `(() => { window.__said = []; const prev = __bh.camera.onLessonSay; __bh.camera.onLessonSay = (w) => { window.__said.push(w); prev?.(w); }; return 1; })()`,
    );
    await app.waitFor(`__bh.camera.spaceCourse === null`, 120_000);
    said.push(...(await app.js<string[]>(`window.__said`)));
    console.log(`  said: ${said.join(" | ")}`);
    await app.waitFor(`!!document.querySelector('[data-testid="flight-report"]:not([hidden])')`, 5000);
    const card = await app.js<string>(`document.querySelector('[data-testid="flight-report"]').textContent`);
    expect(card).toMatch(/Lesson · The holds and the SAS/);
    expect(card).toMatch(/20\.0 \/ 20/);
    expect(app.cdp.errors).toEqual([]);
  }, 180_000);
});
