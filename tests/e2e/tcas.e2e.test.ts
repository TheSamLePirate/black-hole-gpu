import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The TCAS (PLAN-RADAR-AAA RD4): the F-35 on its autopilot over the Alps, an airliner put head-on 22 km ahead, 60 m
// above, 230 m/s — its transponder heard (a source of the radar's own kind: the real traffic's way) —: proximate, a
// TA ("Traffic, traffic") some 40 s from the closest approach, an RA at 25 s ("Descend, descend!": it passes above),
// on the HUD (its advisory, the intruder marked), the scope and the tactical map (the TCAS's symbols); then, gone by,
// "Clear of conflict". (E2E_SHOTS=<dir>: the RA.)

describe.skipIf(!E2E)("the TCAS", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, wind: 0, wingmen: 0, voice: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.9, 6.9, 5000, 0, 230); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
      c.jetModes.hdg = 0; c.jetToggle("ap"); c.jetToggle("athr"); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(2000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("an airliner head-on: proximate, TA, RA (descend), on the HUD, the scope and the map; then clear of conflict", async () => {
    // (its place relative to us carried on by the relative velocity, frame to frame)
    await app.js(`(() => { const c = __bh.camera; const g = c.geoNow(); let r = null, last = 0;
      c.radarSources.set("tst", (fix) => {
        const now = performance.now() / 1000;
        if (!r) { const h = Math.atan2(fix.own.fwd[0], fix.own.fwd[1]); r = [Math.sin(h) * 22000, Math.cos(h) * 22000, 60]; last = now;
          window.__tv = [-Math.sin(h) * 230, -Math.cos(h) * 230, 0]; }
        const dt = Math.min(now - last, 0.2); last = now;
        for (let k = 0; k < 3; k++) r[k] += (window.__tv[k] - fix.own.v[k]) * dt;
        return [{ id: "trf:TST123", r: [...r], v: [...window.__tv], rcs: 40, kind: "air", iff: "neutral", name: "TST123", squawk: true }];
      });
      window.__tc = []; window.__tcI = setInterval(() => { const a = c.tcas.find((x) => x.id === "trf:TST123"); const i = c.flightInfo();
        window.__tc.push({ lvl: a?.level ?? null, sense: a?.sense ?? null, tau: a?.tau ?? null, hud: i.tcas?.level ?? null,
          scope: (i.radar?.contacts ?? []).find((k) => k.id === "trf:TST123")?.tcas ?? null }); }, 100);
      return 1; })()`);
    await app.waitFor(`window.__tc.some((x) => x.lvl === "RA")`, 60_000);
    await Bun.sleep(800);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/tcas-ra.png`);
    }
    await app.waitFor(`__bh.voice.asked.some((l) => l.id === "tcas-clear")`, 60_000);
    // (gone by, going away: proximate a while — within 6 NM —, then none)
    await app.waitFor(`window.__tc.at(-1)?.lvl === "proximate"`, 30_000);
    const tc = await app.js<{ lvl: string | null; sense: string | null; tau: number | null; hud: string | null; scope: string | null }[]>(
      "(clearInterval(window.__tcI), window.__tc)",
    );
    const said = await app.js<string[]>(`__bh.voice.asked.filter((l) => /^tcas-/.test(l.id ?? "")).map((l) => l.id + ": " + l.text)`);
    const first = (lvl: string) => tc.find((x) => x.lvl === lvl);
    console.log(`  TA at ${first("TA")?.tau?.toFixed(1)} s, RA at ${first("RA")?.tau?.toFixed(1)} s (${first("RA")?.sense})`);
    console.log(`  said: ${said.join(" · ")}`);
    expect(tc.some((x) => x.lvl === "proximate")).toBe(true);
    expect(first("TA")!.tau!).toBeGreaterThan(30);
    expect(first("TA")!.tau!).toBeLessThan(42);
    expect(first("RA")!.tau!).toBeLessThan(26);
    expect(first("RA")!.sense).toBe("descend");
    expect(tc.some((x) => x.hud === "RA")).toBe(true);
    expect(tc.some((x) => x.scope === "TA") && tc.some((x) => x.scope === "RA")).toBe(true);
    expect(said.map((s) => s.split(":")[0])).toEqual(["tcas-ta", "tcas-ra", "tcas-clear"]);
    await app.js(`(() => { __bh.camera.radarSources.delete("tst"); return 1; })()`);
  }, 150_000);
});
