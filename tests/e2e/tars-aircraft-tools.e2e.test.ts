import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// TARS's hands on an aircraft (audit 2026-11-10, TA-03 and TA-10; wave 3.7), his tools run in the page as the agent runs
// them (no model): jet_autopilot sets the selectors and engages AP and A/THR through the crew console's own actions — the
// F-35's holds, the A320's FCU —; controls' flaps move the lever: the A320's CONF 1 reachable (before: rounded to ½,
// written straight into the aerodynamics). Near Edwards, 3 000 m; tiles and IGN blocked.
// Done when: the F-35 holds what TARS set, the A320 at CONF 1 then its AP1 engaged on its FCU's selections. Duration: ~1 min.

const OUT = "remote-results/tars-aircraft-tools";

describe.skipIf(!E2E)("TARS flies the aircraft's autopilot and the A320's flaps by the console's actions", () => {
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
  const place = (vessel: string) =>
    app.js<string>(`(() => {
      __bh.freeze(true); __bh.settings.animate = true; __bh.settings.vessel = "${vessel}"; __bh.settings.flightMode = "plane";
      __bh.settings.wind = 0; __bh.settings.damage = false;
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.flyAt(34.75, -117.95, 3000, 45, 150);
      for (let i = 0; i < 15; i++) __bh.step(1 / 30);
      return __bh.fleet.active; })()`);
  /** one of TARS's tools, as the agent runs it */
  const tool = (name: string, args: Record<string, unknown>) =>
    app.js<unknown>(`(async () => {
      const T = __bh.tars.tools().find((t) => t.name === ${JSON.stringify(name)});
      if (!T) return "no tool ${name}";
      return T.run(${JSON.stringify(args)}, new AbortController().signal);
    })()`);

  test("the F-35: jet_autopilot sets ALT, HDG, SPD and engages AP and A/THR", async () => {
    expect(await place("f35")).toBe("f35");
    const r1 = await tool("jet_autopilot", { alt: 2500, hdgDeg: 90, spd: 170 });
    const r2 = await tool("jet_autopilot", { ap: true, athr: true });
    const m = await app.js<{ alt: number | null; hdg: number | null; spd: number | null }>(`(() => {
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      const j = __bh.camera.jetModes; return { alt: j.alt, hdg: j.hdg, spd: j.spd }; })()`);
    console.log(`  said: ${JSON.stringify(r1)} · ${JSON.stringify(r2)}; holds ${JSON.stringify(m)}`);
    await app.js(`(__bh.refresh(), __bh.camera.viewReset?.(), true)`);
    await app.snap(`${OUT}/f35-holds.png`);
    expect(m.alt).toBe(2500);
    expect(m.spd).toBe(170);
    expect(Math.abs((m.hdg ?? 0) - Math.PI / 2)).toBeLessThan(1e-6);
  });

  test("the A320: controls' flaps to CONF 1 (0.25), said; jet_autopilot engages its AP", async () => {
    expect(await place("a320")).toBe("a320");
    const said = await tool("controls", { flaps: 0.25 });
    const flaps = await app.js<number>("__bh.camera.airFlight.cfg.flaps");
    const log = await app.js<string[]>(`__bh.game.log.events.slice(-4).map((e) => e.text)`);
    console.log(`  controls flaps 0.25 → cfg.flaps ${flaps}; said ${JSON.stringify(said)}; journal ${JSON.stringify(log)}`);
    expect(flaps).toBe(0.25);
    expect(log.join(" ")).toMatch(/Flaps 1/);
    // (the A320's AP1 engages 5 s after the lift-off — its rule —: a placed one has flown 0.5 s; 6 s more)
    await app.js(`(() => { for (let i = 0; i < 180; i++) __bh.step(1 / 30); return 1; })()`);
    const ap = await tool("jet_autopilot", { alt: 2500, spd: 140, ap: true });
    console.log(`  jet_autopilot: ${JSON.stringify(ap)}`);
    await app.js(`(__bh.refresh(), __bh.camera.viewReset?.(), true)`);
    await app.snap(`${OUT}/a320-conf1.png`);
    expect(String(ap)).not.toMatch(/^no tool/);
    // (its FMGC's AP1 engaged, the FCU's selections in feet and knots — before: every ask toggled it, « AP off »)
    const fcu = await app.js<{ ap: boolean; alt: number; spd: number }>(`(() => {
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      const F = __bh.camera.a320Fmgc; return { ap: F.ap, alt: F.alt, spd: F.spd }; })()`);
    console.log(`  the A320's FMGC: ${JSON.stringify(fcu)}`);
    expect(fcu.ap).toBe(true);
    expect(fcu.alt).toBe(8200);
    expect(fcu.spd).toBe(272);
    expect(app.cdp.errors).toEqual([]);
  });
});
