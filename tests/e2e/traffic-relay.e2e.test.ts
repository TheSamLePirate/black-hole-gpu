import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The real traffic's relay in the game (docs/PLAN-AVIATION-AAA.md, T1): the F-35 over Paris — the dev server's
// relay asked (adsb.lol, live), the aircraft about it in the page's feed, their sources credited on screen; the
// setting off: none asked, the credit gone. (E2E_SHOTS=<dir>: the view.)

describe.skipIf(!E2E)("the real traffic's relay", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.wind = 0; __bh.settings.traffic = true; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(48.85, 2.35, 3000, 90, 220); return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("over Paris: the aircraft about us, live, credited", async () => {
    await app.waitFor(`(__bh.camera.traffic?.planes.size ?? 0) > 5`, 30_000);
    const F = await app.js<{ n: number; status: string; some: string[]; credit: string; shown: boolean }>(`(() => {
      const F = __bh.camera.traffic, el = document.querySelector("[data-testid=traffic-credit]");
      return { n: F.planes.size, status: F.status, some: [...F.planes.values()].slice(0, 5).map((t) => t.p.cs + "/" + t.p.reg + "/" + t.p.type + " " + Math.round(t.p.alt) + " m"),
        credit: el.textContent, shown: !el.hidden };
    })()`);
    console.log(`  ${F.n} aircraft, ${F.status}: ${F.some.join(" · ")} — "${F.credit}"`);
    expect(F.status).toBe("live");
    expect(F.shown).toBe(true);
    expect(F.credit).toContain("adsb.lol");
    const h = await app.js<{ adsbOk: number }>(`fetch("/traffic/health").then((r) => r.json())`);
    expect(h.adsbOk).toBeGreaterThan(0);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/traffic-relay.png`);
    }
  }, 60_000);

  test("the setting off: none asked, the credit gone", async () => {
    await app.js(`(() => { __bh.settings.traffic = false; return 1; })()`);
    await Bun.sleep(500);
    const r = await app.js<{ n: number; shown: boolean; status: string }>(
      `(() => ({ n: __bh.camera.traffic.planes.size, shown: !document.querySelector("[data-testid=traffic-credit]").hidden, status: __bh.camera.traffic.status }))()`,
    );
    expect(r).toEqual({ n: 0, shown: false, status: "off" });
    await app.js(`(() => { __bh.settings.traffic = true; return 1; })()`);
  }, 30_000);
});
