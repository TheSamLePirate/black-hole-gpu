import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The air refuelling (game/aar.ts, controller/aar.ts): over the Mediterranean at 6 000 m, light turbulence, the F-35B
// behind TEXACO 11 set close by — the A330 MRTT's grey, its two pods, their hoses and baskets trailed —; the probe out,
// the systems flying it into the right basket, the fuel taken to full, back out, cleared to depart. The views: the
// tanker from the side, its hoses; pre-contact from the cockpit (the HUD's basket, the probe, the gap); the contact
// from outside (the pod's green light). (Measured headless: tests/aar.test.ts.) (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the air refuelling", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const view = async (mount: string, o?: { yaw: number; pitch: number; dist: number }) => {
    await app.js(`(() => { __bh.settings.shipMount = ${JSON.stringify(mount)}; return 1; })()`);
    await Bun.sleep(300);
    if (o) await app.js(`(() => { Object.assign(__bh.camera.outside, ${JSON.stringify(o)}); return 1; })()`);
    await Bun.sleep(900);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the tanker set close by: an A330 MRTT's grey, its hoses trailed; joined behind its right hose", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z");
      Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0, f35Variant: "B", f35Assist: "realistic", f35AarMode: "auto" });
      __bh.game.flyAt(43.0, 6.2, 6000, 90, 215); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
      c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("athr"); __bh.fleet.fuel.f35 = 4600; return 1; })()`);
    await Bun.sleep(1500);
    console.log(`  ${await app.js<string>(`__bh.camera.tankerStart({ near: true })`)}`);
    await app.waitFor(`__bh.camera.aar?.stage === "hose"`, 120_000);
    await Bun.sleep(3000);
    // (from behind and to the left, above: the tanker ahead, its right hose to us)
    await view("around", { yaw: -35, pitch: 10, dist: 55 });
    await shot("tanker-side");
    const mesh = await app.js<string>(`__bh.camera.combat.world.targets.find((q) => q.name === "TEXACO 11")?.mesh`);
    expect(mesh).toBe("mrtt");
  }, 240_000);

  test("pre-contact from the cockpit: the basket, the probe, the gap on the HUD; cleared", async () => {
    await view("cockpit");
    await app.waitFor(`__bh.camera.aar?.s.cleared === true`, 90_000);
    await shot("precontact-cockpit");
    const hud = await app.js<{ phase: string; gap: number[] } | null>(
      `(() => { const h = __bh.camera.flightInfo?.().aar; return h && { phase: h.phase, gap: h.gap }; })()`,
    );
    console.log(`  HUD: ${JSON.stringify(hud)}`);
    expect(hud?.phase ?? "").toMatch(/CLEARED|PRE-CONTACT|CONTACT|FUEL/);
  }, 120_000);

  test("the contact, the fuel taken to full; back out, cleared to depart", async () => {
    await app.waitFor(`__bh.camera.aar?.s.phase === "contact"`, 120_000);
    const contactAt = Date.now();
    await Bun.sleep(2500);
    await view("around", { yaw: 150, pitch: 6, dist: 16 });
    await shot("contact-outside");
    await view("cockpit");
    await shot("contact-cockpit");
    await app.waitFor(`!__bh.camera.aar`, 360_000);
    console.log(`  the contact made ${((Date.now() - contactAt) / 1000).toFixed(1)} s before the end`);
    const fuel = await app.js<number>(`__bh.fleet.fuel.f35`);
    console.log(`  after the refuelling: ${fuel.toFixed(0)} kg aboard`);
    expect(fuel).toBeGreaterThan(5700);
    // (the TCAS in TA ONLY while refuelling: no resolution advisory said against the tanker — 14 Nov 2026, "Climb, climb!" through the
    // contact before)
    // (each said with its age [s] at the refuelling's end: before the contact, through it, or as the TA ONLY was let go)
    const said = await app.js<{ text: string; ageS: number }[]>(
      `__bh.voice.said.filter((l) => /Climb, climb|Descend, descend|Montez, montez|Descendez, descendez/.test(l.text))
        .map((l) => ({ text: l.text, ageS: +((performance.now() - l.at) / 1000).toFixed(1) }))`,
    );
    console.log(`  resolution advisories said: ${said.length}${said.map((l) => ` · "${l.text}" ${l.ageS} s before the end`).join("")}`);
    expect(said.map((l) => l.text)).toEqual([]);
  }, 500_000);
});
