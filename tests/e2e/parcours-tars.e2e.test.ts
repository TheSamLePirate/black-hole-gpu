import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { CRUISE, expectFlight, flightState } from "./lib/flight-state";
// PLAN-J6 J6-7 — the journey « command TARS during a transition » (strategy §19.13): the F-35 lined up at Edwards (tiles off), its automatic
// take-off started by the real key U; during its run the pilot types to TARS « Cap 270, 2 500 m, 150 m/s » — the model simulated in the page
// (openrouter.ai answered by a script, as tars-agent: no key): it calls jet_autopilot { hdgDeg 270, alt 2500, spd 150, ap, athr }, then its
// words repeat what the tool gave back. Asserted: the tool's result says the truth of the state — « armed », held at the take-off's end, not
// « selected » (no success announced without its effect: before 15 Nov 2026 the holds engaged mid-run were lost at its end) —; at the
// take-off's end the holds are the ones asked; the jet climbing.
// Rule 13 (E2E-VOLS): no placement left gliding at idle (its holds engaged after each flyAt); the state flown asserted at the take-off's
// end and after the undo — the craft taken back as a pilot would (its holds engaged again).
// Duration: ~1 min on kerr-mini.
// Then a command gone stale: « Monte à 4000 m » asked of the F-35 in flight, the model's answer slow (3 s), the craft changed to the Ranger
// meanwhile — the call checked against the state when it runs: refused, said, nothing engaged.
// Then the undo as its checkpoint covers it: « Emmène-moi au-dessus de Paris » (place_ship — the game saved first as « Before TARS »), then
// « Annule » (saves undo): the place, the fuel, the gear and the flaps as before the turn.
// Done when: the take-off ended and the holds read; the stale command answered; the teleport undone.
const MODEL = `(() => {
  window.__or = [];
  const real = window.fetch.bind(window);
  const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  window.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith("https://openrouter.ai/")) return real(url, init);
    const body = init?.body ? JSON.parse(init.body) : null;
    window.__or.push({ u, body });
    if (!u.endsWith("/chat/completions")) return Response.json({ answers: { speak: { type: "noul", noul: 0 } } });
    const msgs = body.messages;
    const q = [...msgs].reverse().find((m) => m.role === "user").content.split("Pilot: ").at(-1);
    const tools = msgs.filter((m) => m.role === "tool");
    const reply = (m) => Response.json({ choices: [{ message: m }], usage: { cost: 0.0001 } });
    if (/Cap 270/.test(q)) {
      if (!tools.length) {
        window.__tools = (body.tools ?? []).map((t) => t.function.name);
        return reply({ content: null, tool_calls: [call("j", "jet_autopilot", { hdgDeg: 270, alt: 2500, spd: 150, ap: true, athr: true })] });
      }
      return reply({ content: "Retour : " + tools[0].content });
    }
    // (a slow answer — 3 s —: the state may change before the call runs; the words repeat what the tool gave back)
    if (/Monte à 4000/.test(q)) {
      if (!tools.length) {
        await new Promise((r) => setTimeout(r, 3000));
        return reply({ content: null, tool_calls: [call("s", "jet_autopilot", { alt: 4000, ap: true })] });
      }
      return reply({ content: "Retour : " + tools[0].content });
    }
    if (/Emmène-moi au-dessus de Paris/.test(q)) {
      if (!tools.length) return reply({ content: null, tool_calls: [call("p", "place_ship", { mode: "fly", body: "earth", lat: 48.85, lon: 2.35, aglM: 1500, headingDeg: 0, speedMs: 180 })] });
      return reply({ content: "Placé : " + tools[0].content });
    }
    if (/Annule/.test(q)) {
      if (!tools.length) return reply({ content: null, tool_calls: [call("u", "saves", { action: "undo" })] });
      return reply({ content: "Annulé : " + tools[0].content });
    }
    return reply({ content: "Rien à signaler." });
  };
  return true;
})()`;
afterAll(stopServer);
describe.skipIf(!E2E)("J6-7: TARS during the automatic take-off — the truth of the state, the holds at its end", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({
      width: 1280,
      height: 800,
      lang: "fr",
      hash: "scene=game:artemis",
      tiles: false,
      initScript: `try { localStorage.setItem("kerr.openrouter.key", "sk-or-v1-simulated000000042"); localStorage.removeItem("kerr.tars.memory"); } catch {}`,
    });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(__bh.settings.voice = false, __bh.settings.tarsRemarks = false, true)`);
    await app.js(MODEL);
  }, 240_000);
  afterAll(() => app?.close());

  test("« Cap 270, 2 500 m, 150 m/s » during the take-off's run: armed, said so, held at its end", async () => {
    await app.js(`(() => { Object.assign(__bh.settings, { vessel: "f35", damage: false, wind: 0 }); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.lineUp("Edwards"); return 1; })()`);
    await Bun.sleep(1500);
    await app.press("KeyU", "u");
    await app.waitFor(`!!__bh.camera.rwyRun`, 5_000);
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.type("Cap 270, 2 500 m, 150 m/s.");
    await app.press("Enter");
    await app.waitFor(`(__bh.tars.agent.lastText ?? "").startsWith("Retour")`, 20_000);
    const r = await app.js<{ text: string; inRun: boolean; tools: string[] }>(
      `({ text: __bh.tars.agent.lastText, inRun: !!__bh.camera.rwyRun, tools: window.__tools ?? [] })`,
    );
    console.log(`  TARS during the run: ${JSON.stringify({ ...r, tools: r.tools.includes("jet_autopilot") })}`);
    // (the take-off's end: its run let go — 45 s at most)
    await app.waitFor(`!__bh.camera.rwyRun`, 45_000);
    await Bun.sleep(2000);
    const end = await app.js<{ holds: unknown; vs: number; gear: boolean }>(`(() => { const c = __bh.camera, m = c.jetModes;
      return { holds: [m.alt && Math.round(m.alt), m.hdg && Math.round(m.hdg * 180 / Math.PI), m.spd], vs: +(c.geoNow().vs ?? 0).toFixed(1), gear: c.gearDown }; })()`);
    console.log(`  at the take-off's end: ${JSON.stringify(end)}`);
    expect(r.tools).toContain("jet_autopilot");
    expect(r.text).toMatch(/armed|armé/i);
    expect(r.text).not.toMatch(/selected|sélectionné/i);
    expect(end.holds).toEqual([2500, 270, 150]);
    expect(end.vs).toBeGreaterThan(2);
    expect(end.gear).toBe(false);
    // (rule 13: the holds applied — the engine giving thrust, the airspeed, a climb's attitude, gear up)
    expectFlight(await flightState(app), "after the automatic take-off", { ...CRUISE, aglMin: 50 });
  }, 120_000);

  test("a command gone stale: « Monte à 4000 m » asked of the F-35, the craft changed to the Ranger before the call runs — refused, nothing changed", async () => {
    // (rule 13: placed, then flown — its holds and autothrottle engaged, not a glide at idle while TARS thinks)
    await app.js(`(() => { __bh.game.flyAt(34.9, -117.9, 2000, 90, 180); for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      const c = __bh.camera; c.apSet({ ap: true, athr: true, alt: Math.round(c.geoNow().alt), hdg: Math.PI / 2, spd: 180 }); return 1; })()`);
    await Bun.sleep(1500);
    expectFlight(await flightState(app), "placed for the stale command", { ...CRUISE, aglMin: 500 });
    await app.type("Monte à 4000 m.");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.busy`, 10_000);
    // (while the model thinks: the craft changed — the jet's autopilot no more the one flown)
    await app.js(`(() => { __bh.settings.vessel = "ranger"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "ranger"`, 20_000);
    await app.waitFor(`(__bh.tars.agent.lastText ?? "").startsWith("Retour")`, 20_000);
    const r = await app.js<{ text: string; holds: unknown; vessel: string }>(`(() => { const m = __bh.camera.jetModes;
      return { text: __bh.tars.agent.lastText, holds: [m.alt, m.hdg, m.spd], vessel: __bh.fleet.active }; })()`);
    console.log(`  the stale command: ${JSON.stringify(r)}`);
    // (the call checked against the state when it runs: the jet's systems refused on the Ranger — said, nothing engaged)
    expect(r.vessel).toBe("ranger");
    expect(r.text).not.toMatch(/sélectionnée|selected|armée|armed/i);
    expect(r.holds).toEqual([null, null, null]);
    // (the reason the true one — the craft —, not « in the air »)
    expect(r.text).toMatch(/F-35/);
  }, 120_000);

  test("undone as the checkpoint covers it: « Emmène-moi au-dessus de Paris », then « Annule » — the place, the fuel, the gear and the flaps back", async () => {
    await app.js(`(() => { __bh.settings.vessel = "f35"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 20_000);
    const before = await app.js<{ lat: number; lon: number; fuel: number; gear: boolean; flaps: number }>(`(() => {
      __bh.game.flyAt(34.9, -117.9, 2000, 90, 180); const c = __bh.camera; for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      c.apSet({ ap: true, athr: true, alt: Math.round(c.geoNow().alt), hdg: Math.PI / 2, spd: 160 });
      __bh.fleet.fuel.f35 = 3000; c.gearInit = true; c.gearDown = true; c.gearExt = 1; c.airFlight.cfg.flaps = 0.5;
      const g = c.geoNow(); return { lat: g.lat, lon: g.lon, fuel: Math.round(__bh.fleet.fuel.f35), gear: c.gearDown, flaps: c.airFlight.cfg.flaps }; })()`);
    await Bun.sleep(1000);
    await app.type("Emmène-moi au-dessus de Paris.");
    await app.press("Enter");
    await app.waitFor(`(__bh.tars.agent.lastText ?? "").startsWith("Placé")`, 30_000);
    const there = await app.js<{ lat: number; lon: number; fuel: number; text: string }>(
      `(() => { const g = __bh.camera.geoNow(); return { lat: g.lat, lon: g.lon, fuel: Math.round(__bh.fleet.fuel.f35), text: __bh.tars.agent.lastText }; })()`,
    );
    await app.type("Annule.");
    await app.press("Enter");
    await app.waitFor(`(__bh.tars.agent.lastText ?? "").startsWith("Annulé")`, 30_000);
    await Bun.sleep(1500);
    const back = await app.js<{ lat: number; lon: number; fuel: number; gear: boolean; flaps: number; text: string }>(`(() => {
      const c = __bh.camera, g = c.geoNow(); return { lat: g.lat, lon: g.lon, fuel: Math.round(__bh.fleet.fuel.f35), gear: c.gearDown, flaps: c.airFlight.cfg.flaps,
        text: __bh.tars.agent.lastText }; })()`);
    console.log(`  undo: before ${JSON.stringify(before)}; at Paris ${JSON.stringify(there)}; back ${JSON.stringify(back)}`);
    // (Paris reached, then back where the turn found it — a few km of flight meanwhile —, its craft as the save covers it)
    expect(Math.abs(there.lat - 48.85)).toBeLessThan(0.2);
    expect(Math.abs(back.lat - before.lat)).toBeLessThan(0.1);
    expect(Math.abs(back.lon - before.lon)).toBeLessThan(0.1);
    expect(Math.abs(back.fuel - before.fuel)).toBeLessThan(60);
    expect(back.gear).toBe(true);
    expect(back.flaps).toBe(0.5);
    expect(back.text).not.toMatch(/undo: none/);
    // (rule 13: after the undo the craft taken back as a pilot would — its holds engaged again — and flying: thrust, airspeed, attitude)
    // (its speed now the hold's — at another, the autothrottle at idle slows it, as a pilot's would)
    await app.js(
      `(() => { const c = __bh.camera; c.apSet({ ap: true, athr: true, alt: Math.round(c.geoNow().alt), hdg: Math.PI / 2, spd: Math.round(c.airInfo().speed) }); return 1; })()`,
    );
    await Bun.sleep(3000);
    expectFlight(await flightState(app), "taken back after the undo", { ...CRUISE, gear: undefined, aglMin: 500 });
  }, 120_000);
});
