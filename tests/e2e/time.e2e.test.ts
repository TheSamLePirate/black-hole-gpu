import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The date and time (ui/timepanel.ts) by real clicks, from the flight HUD's clock button: thirty days on,
// the ship still on its orbit around the Earth; back to the start of the scene; a date chosen.

describe.skipIf(!E2E)("the date and time", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const open = `!!document.querySelector("[data-testid=time-panel]")`;
  const orbit = () =>
    app.js<{ soi: string; pe: number; ap: number; inc: number }>(
      `(() => { const g = __bh.game.status(); return { soi: g.soi, pe: g.orbit.peKm, ap: g.orbit.apKm, inc: g.orbit.incDeg }; })()`,
    );
  const date = () => app.js<string>("__bh.game.date()");

  test("thirty days on: the ship still on its orbit; back to the start of the scene", async () => {
    await app.js(`__bh.game.orbit("earth", { altKm: 400, inc: 51.6 })`);
    await Bun.sleep(500);
    const before = await orbit();
    const d0 = await date();
    await app.click("[data-testid=time-open]");
    await app.waitFor(open);
    await app.click("[data-testid=time-panel] .pp-quick .k-btn:last-child");
    await Bun.sleep(300);
    const d1 = await date();
    expect(Date.parse(`${d1}Z`) - Date.parse(`${d0}Z`)).toBeGreaterThan(29.9 * 864e5);
    const after = await orbit();
    expect(after.soi).toBe("earth");
    expect(Math.abs(after.pe - before.pe)).toBeLessThan(1);
    expect(Math.abs(after.ap - before.ap)).toBeLessThan(1);
    expect(Math.abs(after.inc - before.inc)).toBeLessThan(0.01);
    await app.click("[data-testid=time-start]");
    await Bun.sleep(300);
    expect(Math.abs(Date.parse(`${await date()}Z`) - Date.parse("2067-01-01T15:00Z"))).toBeLessThan(864e5);
  });

  test("a date chosen, in UTC", async () => {
    await app.js(
      `(() => { const i = document.querySelector("[data-testid=time-panel] .tm-date"); i.value = "2068-07-14T12:00:00"; return 0 })()`,
    );
    await app.click("[data-testid=time-set]");
    await Bun.sleep(300);
    expect((await date()).startsWith("2068-07-14 12:00")).toBe(true);
    await app.press("Escape");
    await app.waitFor(`!${open}`);
  });
});
