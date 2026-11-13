import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The "craft lost" screen's Resume (audit 2026-11-10, FX-10; wave 3.3): it resumes the flight that was lost, never
// another's. A Ranger's entry point is not offered after a new flight (the F-35 placed since); an aircraft, which never
// "enters" the air, gets recent points (every 10 s of steady flight) and resumes as itself from the newest at least 15 s old. The
// loss is raised through the game's own hook (camera.onCraftLost — the air's limits call it), the entry through
// camera.onAirEntry (piloting.ts calls it in thin air above 1 km/s). Over the Atlantic, the tiles and IGN blocked (no relief
// needed; the IGN's one load at a time belongs to the rendering session's measures).
// Done when: the Ranger's point refused to the F-35, the F-35 resumed as an F-35 15–25 s back. Duration: ~1 min.

const OUT = "remote-results/resume-point";

describe.skipIf(!E2E)("the craft lost: Resume goes back in the same flight", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ hash: "scene=game:artemis" });
    // (no national geodata either: nothing here stands on the ground)
    await app.cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*", "*geopf.fr*", "*ign.fr*"],
    });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const lostButtons = () => app.js<string[]>(`[...document.querySelectorAll(".craft-lost button")].map((b) => b.textContent ?? "")`);
  const toF35OverSea = () =>
    app.js<string>(`(() => {
      __bh.freeze(true); __bh.settings.animate = true; __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.wind = 0;
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      if (__bh.fleet.active !== "f35") return "not switched: " + __bh.fleet.active;
      // (the Atlantic west of Portugal, 3 000 m over the sea, east, 220 m/s; then the holds)
      __bh.game.flyAt(38.5, -14, 3000, 90, 220);
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      const c = __bh.camera;
      c.apSet({ ap: true, athr: true, alt: Math.round(c.geoNow().alt), spd: 220 });
      return __bh.fleet.active; })()`);

  test("a Ranger's entry point is not offered to the F-35 placed since", async () => {
    // (the Ranger in its orbit: the entry's hook, as piloting.ts raises it in thin air above 1 km/s)
    expect(await app.js<string>("__bh.fleet.active")).toBe("ranger");
    await app.js(`(__bh.camera.onAirEntry?.(), true)`);
    expect(await toF35OverSea()).toBe("f35");
    await app.js(`(__bh.camera.onCraftLost?.("test: a load past the structure"), true)`);
    await app.waitFor(`!!document.querySelector(".craft-lost")`, 5000);
    const b = await lostButtons();
    console.log(`  buttons: ${b.join(" · ")}`);
    await Bun.sleep(300);
    await app.shot(`${OUT}/1-ranger-point-after-f35.png`);
    // (before: "Resume before the entry" — and taking it put the player back in the Ranger, before its entry)
    expect(b.some((x) => /before the entry|avant la rentrée/i.test(x))).toBe(false);
    await app.click(".craft-lost button:last-child");
    await app.waitFor(`!document.querySelector(".craft-lost")`, 5000);
  });

  test("an F-35 lost after 35 s of steady flight resumes as itself, 15–25 s back", async () => {
    expect(await toF35OverSea()).toBe("f35");
    const start = await app.js<{ lon: number }>(`(() => { const g = __bh.camera.geoNow(); return { lon: g.lon }; })()`);
    // (35 s of flight, stepped in chunks)
    for (let k = 0; k < 7; k++)
      await app.js(`(() => { for (let i = 0; i < 150; i++) __bh.step(1 / 30); return __bh.camera.airFlight.failure; })()`);
    const before = await app.js<{ lon: number; alt: number; fuel: number }>(
      `(() => { const g = __bh.camera.geoNow(); return { lon: g.lon, alt: g.alt, fuel: __bh.fleet.fuel.f35 ?? -1 }; })()`,
    );
    console.log(
      `  flown east ${(before.lon - start.lon).toFixed(3)}° in 35 s, at ${Math.round(before.alt)} m; fuel ${Math.round(before.fuel)} kg`,
    );
    await app.js(`(__bh.camera.onCraftLost?.("test: a load past the structure"), true)`);
    await app.waitFor(`!!document.querySelector(".craft-lost")`, 5000);
    const b = await lostButtons();
    console.log(`  buttons: ${b.join(" · ")}`);
    await Bun.sleep(300);
    await app.shot(`${OUT}/2-f35-lost.png`);
    // (before: none — an aircraft had no point to resume from)
    expect(b[0]).toMatch(/earlier|plus tôt/i);
    const ago = Number(/(\d+) s/.exec(b[0] ?? "")?.[1]);
    expect(ago).toBeGreaterThanOrEqual(15);
    expect(ago).toBeLessThan(25);
    await app.click(".craft-lost .cl-main");
    await app.waitFor(`!document.querySelector(".craft-lost")`, 5000);
    const back = await app.js<{ vessel: string; lon: number; alt: number; alt0: number; anim: boolean }>(
      `(() => { const alt0 = __bh.camera.geoNow().alt; for (let i = 0; i < 5; i++) __bh.step(1 / 30); const g = __bh.camera.geoNow();
        return { vessel: __bh.fleet.active, lon: g.lon, alt: g.alt, alt0, anim: __bh.settings.animate }; })()`,
    );
    console.log(`  altitude at the resume ${Math.round(back.alt0)} m, 5 steps on ${Math.round(back.alt)} m`);
    console.log(
      `  resumed: ${back.vessel}, ${(back.lon - start.lon).toFixed(3)}° east of the start, ${Math.round(back.alt)} m, running ${back.anim}`,
    );
    await app.js(`(__bh.refresh(), __bh.camera.viewReset?.(), true)`);
    await app.shot(`${OUT}/3-f35-resumed.png`);
    expect(back.vessel).toBe("f35");
    expect(back.anim).toBe(true);
    // (between the start and the loss: some 30 s back, not the placement's start)
    expect(back.lon).toBeGreaterThan(start.lon + 0.001);
    expect(back.lon).toBeLessThan(before.lon - 0.001);
    // (at the height it flew — taken mid-step, the point once put it 470 m low)
    expect(Math.abs(back.alt - before.alt)).toBeLessThan(60);
    expect(app.cdp.errors).toEqual([]);
  });
});
