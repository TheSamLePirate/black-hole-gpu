import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The approach chosen automatically (docs/PLAN-APPROCHES.md AP1): the F-35 placed 40 km from Toulon-Hyères on each of its four
// sides, flying towards it, calm; the ILS engaged by the airfield's name — the end whose approach comes from that side taken (23
// from the east, 31 from the south, 05 from the west; from the north the built 13 is left out for the relief — its slope over the
// hills north-west of Hyères, PLAN-APPROCHES AP2 — and 23 taken), its reason said —; engaged without a name, the nearest
// ahead; a windy day: the end with the wind ahead whatever the side; the A320 its 2 000 m kept; the approach state the same everywhere
// (`approachState`). Before 15 Nov 2026 the first end was always taken in fair weather: from the other side, the jet flew over.
//
// Done when: the four sides take 23 (13 out: « relief »), 23, 31, 05; a selection (LFTH C23) flown from the south and kept through a save; LFML's list
// has its real ILS 31R; unnamed from the west takes LFTH 05; the « windy » weather takes an end with the wind ahead from the
// west; the A320 from the south takes 05 or 23 (31, 1 900 m, short for it); the state names what was flown; KSFO's list has the
// FAA's published ILS 28R (its four transitions) and RNAV 28R-Z (AP0b).
// Duration: about 1 min 30 (four placings and engagements, a craft switched; no flight flown out).

describe.skipIf(!E2E)("the approach chosen automatically", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const LFTH = { lat: 43.0973, lon: 6.14603 };
  /** placed `km` from the field on bearing `from` [°], flying towards it, 2 000 m up, 140 m/s */
  const place = async (from: number, km = 40) => {
    await app.js(`(() => {
      const D = Math.PI / 180, R = 6371000, d = ${km * 1000} / R, b = ${from} * D, la = ${LFTH.lat} * D, lo = ${LFTH.lon} * D;
      const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
      const lon = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
      __bh.camera.ilsOff();
      __bh.game.flyAt(lat / D, lon / D, 2000, ${(from + 180) % 360}, 140);
      return 1; })()`);
    // (the flight running, the new place taken: its geodetic track towards the field)
    await app.waitFor(`(() => { const g = __bh.camera.geoNow(); return !!g && g.gs > 100; })()`, 15_000);
  };
  /** the ILS engaged (by the field's name or none): the end flown, once its data are in */
  const engage = async (name: string | null) => {
    const arg = name ? JSON.stringify(name) : "";
    const said = await app.js<string>(`__bh.camera.ilsStart(${arg})`);
    await app.waitFor(`!!(__bh.camera.ilsRun || __bh.camera.a320App)`, 20_000);
    const r = await app.js<{ rwy: string; field: string; state: unknown }>(
      `(() => { const R = __bh.camera.ilsRun?.rwy ?? __bh.camera.a320App?.rwy; return { rwy: R.des, field: R.icao, state: __bh.camera.approachState() }; })()`,
    );
    const table = await app.js<string>(
      `(__bh.camera.approachLast?.choice?.table ?? []).map((s) => s.a.id + ":" + (s.out ?? s.score.toFixed(1))).join(" ")`,
    );
    console.log(`  ${said} → ${r.field} ${r.rwy} [${table}]`);
    return r;
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0 }); __bh.game.setDate("2026-07-10T11:00:00Z"); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("calm, from each side of Toulon-Hyères: the end whose approach comes from there", async () => {
    // (from the north the built 13 out for the relief — 15 Nov 2026, AP2 —: its slope's least clearance said)
    const want: Record<number, string> = { 0: "23", 90: "23", 180: "31", 270: "05" };
    for (const from of [0, 90, 180, 270]) {
      await place(from);
      const r = await engage("LFTH");
      expect(`${from}: ${r.field} ${r.rwy}`).toBe(`${from}: LFTH ${want[from]}`);
      if (from === 0) {
        const c13 = await app.js<{ out: string | null; clear: number | undefined }>(`(() => {
          const s = __bh.camera.approachLast.choice.table.find((x) => x.a.id === "C13");
          const e = __bh.camera.ilsRunways("LFTH")?.ends.find((x) => x.id === "13");
          return { out: s?.out ?? null, clear: e?.clearM }; })()`);
        console.log(`  C13 from the north: ${c13.out}, its slope's least clearance ${c13.clear?.toFixed(0)} m`);
        expect(c13.out).toBe("relief");
      }
    }
    await shot("approach-auto-west");
  }, 180_000);

  test("unnamed: the nearest ahead, its end by the way in; the state says why", async () => {
    await place(270, 30);
    const r = await engage(null);
    expect(r.field).toBe("LFTH");
    expect(r.rwy).toBe("05");
    const st = r.state as { resolved: { field: string; approach: string; fieldWhy: string; source: string } };
    expect(st.resolved).toMatchObject({ field: "LFTH", approach: "C05", fieldWhy: "ahead", source: "built" });
  }, 60_000);

  test("windy: the end with the wind ahead, though the craft comes from the other side", async () => {
    await app.js(`(() => { Object.assign(__bh.settings, { weather: "windy", wind: 3 }); return 1; })()`);
    await place(270);
    const r = await engage("LFTH");
    const why = (r.state as { resolved: { why: { wind: { head: number; cross: number } | null } } }).resolved.why;
    console.log(`  the wind on the end flown: ${JSON.stringify(why?.wind)}`);
    // (the weather's wind, wherever it blows from today: counted — 5 kt and more —, and ahead on the end flown)
    expect(why?.wind).not.toBeNull();
    expect(why!.wind!.head).toBeGreaterThan(0);
    await app.js(`(() => { Object.assign(__bh.settings, { weather: "fair", wind: 0 }); return 1; })()`);
  }, 60_000);

  test("the A320 from the south: its 2 000 m kept — 13/31 (1 900 m) out —, the other runway flown by its FMGC", async () => {
    await app.js(`(() => { __bh.camera.ilsOff(); __bh.settings.vessel = "a320"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "a320"`, 30_000);
    await place(180);
    const r = await engage("LFTH");
    expect(["05", "23"]).toContain(r.rwy);
    expect(await app.js<boolean>("!!__bh.camera.a320App")).toBe(true);
    const out = await app.js<string | null>(`__bh.camera.approachLast.choice.table.find((s) => s.a.rwy === "31").out`);
    expect(out).toBe("short");
  }, 90_000);

  test("selected: checked, flown, kept through a save; an airfield's list with its real ILS", async () => {
    expect(await app.js<string>(`__bh.camera.approachSelect({ field: "LFTH", rwy: "99" })`)).toMatch(/no runway 99/);
    expect(await app.js<string>(`__bh.camera.approachSelect({ field: "LFTH", approach: "C23" }, "test")`)).toMatch(/LFTH C23/);
    // (from the south — where the automatic choice would take 31 —: the selection flown)
    await place(180);
    const r = await engage(null);
    expect(`${r.field} ${r.rwy}`).toBe("LFTH 23");
    const save = await app.js<string>(`JSON.stringify(__bh.game.snapshot("approach-test"))`);
    await app.js(`(() => { __bh.camera.approachSelect({ field: "auto" }); return 1; })()`);
    await app.js(`__bh.game.load(${save}, { quiet: true })`);
    await app.waitFor(`__bh.camera.approachState().sel.approach === "C23"`, 10_000);
    const lfml = await app.js<{ id: string; kind: string; source: string; loc?: { freq: number } }[]>(`__bh.sys.approaches("LFML")`);
    const i31r = lfml.find((a) => a.id === "I31R");
    expect(i31r).toMatchObject({ kind: "ILS", source: "navdat" });
    expect(i31r!.loc!.freq).toBe(111150);
    // (in the US the FAA's published approaches, served in the same tiles — AP0b: KSFO's ILS 28R whole, its RNAV ones)
    const ksfo = await app.js<{ id: string; source: string; transitions: unknown[] }[]>(`__bh.sys.approaches("KSFO")`);
    const pub = ksfo.find((a) => a.id === "I28R");
    console.log(`  KSFO: ${ksfo.filter((a) => a.source === "cifp").length} published (CIFP), I28R ${pub?.transitions.length} transitions`);
    expect(pub).toMatchObject({ source: "cifp" });
    expect(pub!.transitions.length).toBe(4);
    expect(ksfo.some((a) => a.id === "R28R-Z" && a.source === "cifp")).toBe(true);
    await app.js(`(() => { __bh.camera.approachSelect({ field: "auto" }); return 1; })()`);
  }, 120_000);
});
