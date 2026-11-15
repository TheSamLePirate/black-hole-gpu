import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The approach from the crew (docs/PLAN-APPROCHES.md AP6): an F-35 towards Marseille in a room, the crew console (crew/) in a frame
// of the same page joined as instruments; in its MCP's APP box the field typed — its approaches listed from the same tiles as the
// pilot's (LFML's ILS 31R among them, its source and category) —, the 31R chosen (app.select): the pilot's approach state the same;
// armed (app.arm): the pilot's autopilot flies that one; the box says what is chosen and flown, and why; cancelled.
//
// Done when: the crew's list has I31R (« ILS 31R · 111.15 · 4.0° · CAT I · nav.dat 2013 »); « Choose » sets the pilot's selection to
// LFML I31R (its generation up); « Arm » engages the ILS on 31R (approachLast I31R); the crew's box reads « LFML I31R » chosen and
// flown; « Cancel the ILS » ends it; the crew's snapshot carries the approach drawn and its Approach view shows it; an airfield
// tapped on the crew's radar chooses it on the pilot's side; on the final, armed, the crew is told « glideslope captured ».
// Duration: about 1 min 30 (the boot, the room, the console joined; the orders; a few seconds of a final flown).

describe.skipIf(!E2E)("the approach from the crew", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const crew = (js: string) => `document.querySelector('#crew-frame').contentWindow.${js}`;
  const doc = (sel: string) => `document.querySelector('#crew-frame').contentDocument.querySelector(${JSON.stringify(sel)})`;
  const press = async (selector: string) => {
    await app.js(`(${doc(selector)}.click(), true)`);
    await app.waitFor(`!${crew("__crew.actions.busy")}`, 5000);
  };
  beforeAll(async () => {
    // (the relief's tiles: the slope's check reads it — without them the coarse relief near Marignane refused the 31R)
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0 }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(43.21, 5.53, 2000, 305, 170); return 1; })()`);
    await app.waitFor(`!!__bh.camera.geoNow() && __bh.camera.geoNow().gs > 100`, 15_000);
    await app.js(`(() => { const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      c.approachSelect({ field: "auto" }); return 1; })()`);
    await app.js(`__bh.sys.approaches("LFML").then((l) => l.length)`);
    await app.js("(__bh.net.setName('Ana'), true)");
    await app.js("__bh.net.create('Crew approach')");
    const code = await app.js<string>("__bh.net.net.room.code");
    await app.js(
      `(() => { const f = document.createElement('iframe'); f.id = 'crew-frame'; f.src = '/crew/'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:1100px;height:760px;border:0;z-index:99999'; document.body.append(f); return true; })()`,
    );
    await app.waitFor(`!!document.querySelector('#crew-frame').contentWindow?.__crew`, 20_000);
    await app.js(crew(`__crew.join('${code}', 'Ben')`));
    await app.waitFor(crew("__crew.actions.can('jet').ok"), 15_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the field typed: its approaches listed; the 31R chosen — the pilot's selection the same", async () => {
    // (the MCP's view — its APP box —)
    await app.js(crew("__crew.setView('pfd')"));
    await app.waitFor(`!!${doc("#mcp-app-approach")}`, 5000);
    await app.js(`(() => { const f = ${doc("#mcp-app-field")}; f.value = "LFML"; f.dispatchEvent(new Event("change")); return 1; })()`);
    await app.waitFor(`[...${doc("#mcp-app-approach")}.options].some((o) => o.value === "I31R")`, 15_000);
    const text = await app.js<string>(`[...${doc("#mcp-app-approach")}.options].find((o) => o.value === "I31R").textContent`);
    console.log(`  the crew's list: ${text}`);
    expect(text).toBe("ILS 31R · 111.15 · 4.0° · CAT I · nav.dat 2013");
    const gen0 = await app.js<number>(`__bh.camera.approachGen`);
    await app.js(
      `(() => { ${doc("#mcp-app-approach")}.value = "I31R"; ${doc("#mcp-app-approach")}.dispatchEvent(new Event("change")); return 1; })()`,
    );
    await press("#mcp-app-select");
    const sel = await app.js<{ field: string; approach: string }>(`__bh.camera.approachSel`);
    expect(sel).toMatchObject({ field: "LFML", approach: "I31R" });
    expect(await app.js<number>(`__bh.camera.approachGen`)).toBeGreaterThan(gen0);
  }, 60_000);

  test("armed from the crew: the pilot's autopilot flies the 31R; the box says chosen and flown; cancelled", async () => {
    await press("#mcp-app-arm");
    console.log(`  the crew's board: ${JSON.stringify(await app.js(crew("__crew.actions.board[0]")))}`);
    expect(await app.js<boolean>(crew("__crew.actions.board[0].ok"))).toBe(true);
    await app.waitFor(`!!__bh.camera.ilsRun`, 5000);
    const r = await app.js<{ rwy: string; id: string }>(`({ rwy: __bh.camera.ilsRun.rwy.des, id: __bh.camera.approachLast.approach.id })`);
    expect(r).toEqual({ rwy: "31R", id: "I31R" });
    await app.waitFor(`${doc("#mcp-app-state")}.textContent.includes("LFML ILS 31R")`, 8000);
    const st = await app.js<string>(`${doc("#mcp-app-state")}.textContent`);
    console.log(`  the crew's box: ${st}`);
    expect(st).toMatch(/LFML ILS 31R/);
    // (the crew's instruments: the needles' DME in km — 30 to 40 —, the approach flown in its snapshot)
    const snap = await app.js<{ dme: number; flown: string }>(
      `(() => { const s = document.querySelector('#crew-frame').contentWindow.__crew.model.own().snapshot; return { dme: s.ils.dme, flown: s.appr.flown.id }; })()`,
    );
    console.log(`  the crew's snapshot: ${JSON.stringify(snap)}`);
    expect(snap.flown).toBe("I31R");
    expect(snap.dme).toBeGreaterThan(20);
    expect(snap.dme).toBeLessThan(45);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.js(`(() => { const d = ${doc("#mcp-app-field")}.closest("details"); if (d) d.open = true; return 1; })()`);
      await Bun.sleep(600);
      await app.shot(`${shots}/crew-approach.png`);
    }
    await press("#mcp-ils-off");
    await app.waitFor(`!__bh.camera.ilsRun`, 5000);
  }, 60_000);

  test("the approach drawn for the crew: in its snapshot; its Approach view — plan, fixes, profile", async () => {
    await app.js(`(() => { __bh.camera.approachSelect({ field: "LFML", approach: "I31R" }); return 1; })()`);
    await app.waitFor(`document.querySelector('#crew-frame').contentWindow.__crew.model.own()?.snapshot?.apprMap?.id === "I31R"`, 10_000);
    const m = await app.js<{ fixes: number; others: number; ground: number }>(
      `(() => { const A = document.querySelector('#crew-frame').contentWindow.__crew.model.own().snapshot.apprMap;
        return { fixes: A.fixes.length, others: A.others.length, ground: A.profile.ground.length }; })()`,
    );
    console.log(`  the snapshot's approach: ${JSON.stringify(m)}`);
    expect(m.fixes).toBeGreaterThan(1);
    expect(m.ground).toBe(26);
    await app.js(crew("__crew.setView('approach')"));
    await Bun.sleep(1500);
    if (shots) await app.shot(`${shots}/crew-approach-view.png`);
  }, 30_000);

  test("an airfield tapped on the crew's radar: its approach chosen on the pilot's side", async () => {
    await app.js(`(() => { __bh.camera.approachSelect({ field: "auto" }); return 1; })()`);
    await app.js(crew("__crew.setView('radar')"));
    await app.waitFor(
      `(document.querySelector('#crew-frame').contentWindow.__crew.views.picks ?? []).some((p) => p.field === "LFML")`,
      10_000,
    );
    // (a real click — the page's mouse — on the field's dot: the frame's place, the canvas's, the dot's)
    const q = await app.js<{
      x: number;
      y: number;
    }>(`(() => { const F = document.querySelector('#crew-frame'), fr = F.getBoundingClientRect();
      const V = F.contentWindow.__crew.views, b = V.canvas.getBoundingClientRect();
      const p = V.picks.find((p) => p.field === "LFML" && !p.approach && !p.rwy).point;
      return { x: fr.left + b.left + p[0], y: fr.top + b.top + p[1] }; })()`);
    await app.mouse("move", q.x, q.y);
    await app.mouse("down", q.x, q.y);
    await app.mouse("up", q.x, q.y);
    await app.waitFor(`__bh.camera.approachState().sel.field === "LFML"`, 8000);
    if (shots) await app.shot(`${shots}/crew-approach-radar.png`);
  }, 30_000);

  test("the calls said to the crew: on the final, armed — « glideslope captured »", async () => {
    // (12 km out on 31R's axis at its glideslope, heading in: the localizer and the glideslope met within seconds)
    await app.js(`(() => { const D = Math.PI / 180; __bh.camera.approachSelect({ field: "LFML", approach: "I31R" });
      const a = __bh.camera.approachMapData();
      const back = (a.crs + 180) * D, d = 12000 / 6371000, la = a.thr.lat * D, lo = a.thr.lon * D;
      const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(back));
      const lon = lo + Math.atan2(Math.sin(back) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
      __bh.game.flyAt(lat / D, lon / D, 640, a.crs, 95); __bh.fleet.fuel.f35 = 3000; return 1; })()`);
    await app.waitFor(`!!__bh.camera.geoNow() && __bh.camera.geoNow().gs > 60`, 10_000);
    await app.js(crew("__crew.setView('pfd')"));
    await app.waitFor(`!!${doc("#mcp-app-arm")}`, 5000);
    // (the console allowed the flight's orders again — the craft just placed)
    await app.waitFor(crew("__crew.actions.can('jet').ok"), 10_000);
    await press("#mcp-app-arm");
    await Bun.sleep(4000);
    console.log(
      `  armed on the final: ${JSON.stringify(await app.js(crew("__crew.actions.board[0]")))} · pilot ${await app.js<string>(`String(__bh.camera.ilsRun?.phase)`)} · crew ${await app.js<string>(`String(document.querySelector('#crew-frame').contentWindow.__crew.model.own()?.snapshot?.ils?.phase)`)}`,
    );
    await app.waitFor(
      `/Glide capturé|Glideslope captured/.test(${doc("#notice")}.textContent + ${doc("#mcp-app-state")}.textContent)`,
      40_000,
    );
    const said = await app.js<string>(`${doc("#mcp-app-state")}.textContent`);
    console.log(`  the crew's box: ${said}`);
    await press("#mcp-ils-off");
  }, 90_000);
});
