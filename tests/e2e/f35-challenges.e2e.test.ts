import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-F35 F9: the challenges — their panel opened, the Rogers slalom started by its button (the F-35 placed at
// its start, the judge running), flown through its gates by a script on the autopilot's holds (heading and
// height towards each gate in turn), timed, marked, a medal or none, the best kept; the graded landing's final
// set up and its touchdown judged.

describe.skipIf(!E2E)("the F-35's challenges", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS ?? "/tmp";
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.freeze(true); __bh.game.setDate("2067-06-21T17:30"); __bh.settings.vessel = "f35";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30); __bh.game.lineUp("Edwards"); for (let i = 0; i < 5; i++) __bh.step(1 / 30); return 1; })()`);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the Rogers slalom: started from its card, its gates flown, timed and kept", async () => {
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.shot(`${shots}/f35-challenges-panel.png`);
    await app.click(`[data-testid="chp-go-rogers"]`);
    expect(await app.js<string>(`__bh.camera.chal?.status ?? "none"`)).toBe("run");
    const r = await app.js<{ log: string[]; status: string; next: number; missed: number; text: string; best: string }>(`(() => {
      const c = __bh.camera; const log = [];
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.spd = 160;
      // (the script flies on the holds — 30° of bank, a gentle height hold —: the gates raised 100 m for it, the
      // judging the same)
      c.chal.gates.forEach((G) => (G.alt += 100));
      for (let k = 0; k < 240 * 30 && c.chal && c.chal.status === "run"; k++) {
        const C = c.chal, G = C.gates[C.next], g = c.geoNow();
        if (G && g) {
          const e = (G.lon - g.lon) * Math.cos(g.lat * Math.PI / 180), n = G.lat - g.lat;
          c.jetModes.hdg = Math.atan2(e, n);
          const here = __bh.relief("earth", g.lat, g.lon);
          const f = c.jetFigures(); const agl = c.flightInfo().surface?.alt ?? G.agl;
          c.jetModes.alt = f.h + (G.alt - (here + agl));
        }
        __bh.step(1 / 30);
        if (C.say) { log.push(C.t.toFixed(1) + " s " + C.say); C.say = null; }
        if (k === 600) window.__shotNow = 1;
      }
      const C = c.chal;
      return { log, status: C?.status ?? "gone", next: C?.next ?? -1, missed: C?.missed ?? -1, text: C?.result?.text ?? "", best: localStorage.getItem("kerr.challenges") ?? "" };
    })()`);
    console.log(r.log.map((l) => `  ${l}`).join("\n"));
    expect(r.status).toBe("done");
    expect(r.next).toBe(8);
    // (the script's 30° turns are wide for the slalom's — a pilot banks 60–70° —: some gates missed, said which
    // way; the first ones flown straight through)
    expect(r.log.filter((l) => /Gate \d\/8/.test(l)).length).toBeGreaterThanOrEqual(2);
    expect(r.log.some((l) => /missed · \d+ m (right|left|high|low)/.test(l))).toBe(true);
    expect(r.text).toMatch(/\d+\.\d s/);
    expect(JSON.parse(r.best).rogers.score).toBeGreaterThan(0);
  }, 300_000);

  test("the graded landing: its final set up, its touchdown judged", async () => {
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.click(`[data-testid="chp-go-landing"]`);
    const r = await app.js<{ gear: boolean; flaps: number; status: string; text: string; parts: unknown }>(`(() => {
      const c = __bh.camera; for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      const gear = c.gearDown, flaps = c.airFlight.cfg.flaps;
      // (flown down the glide by the holds: the heading of the runway, the height eased down to the ground)
      c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.spd = 74;
      const hdg = c.jetModes.hdg;
      for (let k = 0; k < 400 * 30 && c.chal && c.chal.status === "run"; k++) {
        const f = c.jetFigures(); if (f) c.jetModes.alt = f.h - 40;
        __bh.step(1 / 30);
      }
      const C = c.chal; return { gear, flaps, status: C?.status ?? "gone", text: C?.result?.text ?? "", parts: C?.result?.parts ?? null };
    })()`);
    console.log(`  ${r.text} ${JSON.stringify(r.parts)}`);
    expect(r.gear).toBe(true);
    expect(r.flaps).toBe(1);
    expect(["done", "failed"]).toContain(r.status);
  }, 300_000);
});
