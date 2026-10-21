import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { wgs84Inverse } from "../../src/system/ellipsoid";
import { App, E2E, stopServer } from "./lib/app";
import { CrewFrame } from "./lib/crew";

// RD0 — the probe of PLAN-RADAR-AAA (docs/PLAN-RADAR-AAA.md, "Définition de « parfait »"): a pilot in the drone hunt
// and a crew console in the same page (the same instant read on both sides), the criteria P1–P11 measured as they are —
// not asserted: the figures are the plan's starting point and each phase's (docs/progress/radar/). The table is printed
// and written to remote-results/radar-sync.json.
//   P1 same picture: the crew's Sensor list against the pilot's radar (ids), its tracks born < 300 ms aside
//   P2 same place: each contact drawn by the crew against the pilot's truth (25 m + 0.05 s × its speed, p95)
//   P3 no jump: frame to frame, a contact moving more than 2 × its speed × the frame's interval
//   P4 pause and warp: in pause nothing moves; at ×4, four times as fast
//   P8 the events: the largest instruments event, the bytes a second
//   P9 missiles and decoys: on the crew's lists while they fly
//   P5, P6, P7, P10, P11: said as they stand (palettes, runways, cost, click, wheel)
describe.skipIf(!E2E)("RD0 — the radar's picture, pilot and crew", () => {
  let app: App;
  let crew: CrewFrame;
  const out: Record<string, unknown> = {};
  const shots = process.env.E2E_SHOTS ?? "remote-results";

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; __bh.settings.wind = 0; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.85, 6.75, 3000, 110, 200); return 1; })()`);
    await app.js("(__bh.net.setName('Ana'), true)");
    await app.js("__bh.net.create('Radar sync')");
    const code = await app.js<string>("__bh.net.net.room.code");
    // (the pilot's instruments events measured as they leave: their sizes, their times)
    await app.js(`(() => { const n = __bh.net.net; const ev = n.event.bind(n); window.__evs = [];
      n.event = (e) => { if (e.kind === "instruments") window.__evs.push({ t: performance.now(), n: JSON.stringify({ type: "event", ev: e }).length }); return ev(e); };
      return 1; })()`);
    crew = new CrewFrame(app);
    await crew.open(code, "Ben", { w: 1000, h: 700 });
    await app.waitFor(crew.w("__crew.actions.can('weapons').ok"), 20_000);
    // (the drone hunt: five drones flying, hostile — the crew's frame out of the pointer's way)
    await app.js(
      `(() => { document.querySelector('#crew-frame').style.visibility = 'hidden'; __bh.flight.challenges.open(); return 1; })()`,
    );
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.js(`(() => { document.querySelector('#crew-frame').style.visibility = ''; return 1; })()`);
    await app.waitFor(`__bh.camera.combat?.status === "run" && __bh.camera.combat.world.targets.length >= 3`, 20_000);
    await app.js(
      `(() => { const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); return 1; })()`,
    );
    await app.waitFor("__bh.camera.radar.tracks.size > 0", 15_000);
    await app.waitFor(crew.w("__crew.model.contacts().some((c) => c.id.startsWith('f:'))"), 10_000);
    await crew.js("__crew.setView('radar')");
  }, 300_000);
  afterAll(async () => {
    await Bun.write(`${shots}/radar-sync.json`, JSON.stringify(out, null, 2));
    app?.close();
    stopServer();
  });

  /** frames sampled in the page for `ms`: the pilot's truth (our place, the fight's targets about us, east/north/up
   *  [m]), the crew's drawn picture (its own place, its contacts) — the same instant on both sides */
  const sample = (ms: number) =>
    app.js<
      {
        t: number;
        own: { lat: number; lon: number } | null;
        truth: { name: string; e: number; n: number; v: number }[];
        crewOwn: { lat: number; lon: number } | null;
        frame: number | null;
        clocks: { crewRoom: number; pilotRoom: number; scene: number; snapT: number | null };
        raw: { name: string; lat: number; lon: number; spd: number | null; hdg: number | null }[];
        crew: { id: string; name: string; lat: number; lon: number; spd: number | null }[];
        radar: string[];
        crewRadar: string[];
      }[]
    >(`new Promise((done) => {
      const c = __bh.camera, w = document.querySelector('#crew-frame').contentWindow, rows = [], t0 = performance.now();
      const step = () => {
        const P = c.combatPlayer?.(), W = c.combat?.world, g = c.geoNow?.();
        const own = w.__crew.model.own();
        rows.push({
          t: performance.now(),
          own: g ? { lat: g.lat, lon: g.lon } : null,
          truth: P && W ? W.targets.filter((q) => q.alive).map((q) => ({ name: q.name, e: q.p[0] - P.p[0], n: q.p[1] - P.p[1], v: Math.hypot(q.v[0], q.v[1]) })) : [],
          crewOwn: own?.geo ? { lat: own.geo.lat, lon: own.geo.lon } : null,
          frame: own?.sample?.frame ?? null,
          clocks: { crewRoom: w.__crew.net.roomNow(), pilotRoom: __bh.net.net.roomNow(), scene: __bh.sim.time * 492.5490947, snapT: own?.snapshot?.t ?? null },
          raw: (own?.snapshot?.tracks ?? []).slice(0, 2).map((k) => ({ name: k.name, lat: k.lat, lon: k.lon, spd: k.spd, hdg: k.hdg })),
          crew: w.__crew.model.contacts().map((k) => ({ id: k.id, name: k.name, lat: k.lat, lon: k.lon, spd: k.spd })),
          radar: (c.flightInfo().radar?.contacts ?? []).map((k) => k.id),
          crewRadar: (own?.snapshot?.radar?.contacts ?? []).map((k) => k.id),
        });
        if (performance.now() - t0 < ${ms}) requestAnimationFrame(step); else done(rows);
      };
      requestAnimationFrame(step);
    })`);

  /** a crew contact's place about the crew's own, east/north [m] — WGS84 */
  const en = (o: { lat: number; lon: number }, p: { lat: number; lon: number }) => {
    const q = wgs84Inverse(o.lat, o.lon, p.lat, p.lon);
    return [q.d * Math.sin(q.az), q.d * Math.cos(q.az)] as const;
  };

  test("P1, P2, P3 — the same picture, the same place, no jump (30 s of the drone hunt)", async () => {
    const rows = await sample(30_000);
    // P1: the Sensor list against the radar's tracks of the same instant
    let p1diff = 0,
      p1n = 0;
    for (const r of rows) {
      const a = new Set(r.radar),
        b = new Set(r.crewRadar);
      p1diff += [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
      p1n += a.size;
    }
    // P2: each crew contact of the fight (by name) against the pilot's truth, both about their own craft — and its two
    // parts: the crew's own place against the pilot's, the contact's against its true place (over the pilot's)
    const errs: number[] = [];
    const ownErr: number[] = [];
    const absErr: number[] = [];
    let p2ok = 0;
    for (const r of rows) {
      if (!r.crewOwn) continue;
      for (const k of r.crew.filter((x) => x.id.startsWith("f:"))) {
        const tr = r.truth.find((x) => x.name === k.name);
        if (!tr) continue;
        const [e, n] = en(r.crewOwn, k);
        const err = Math.hypot(e - tr.e, n - tr.n);
        if (r.own) {
          ownErr.push(wgs84Inverse(r.own.lat, r.own.lon, r.crewOwn.lat, r.crewOwn.lon).d);
          const [e2, n2] = en(r.own, k);
          absErr.push(Math.hypot(e2 - tr.e, n2 - tr.n));
        }
        errs.push(err);
        if (err <= 25 + 0.05 * tr.v) p2ok++;
      }
    }
    errs.sort((x, y) => x - y);
    const p95 = errs[Math.floor(errs.length * 0.95)] ?? Number.NaN;
    // P3: a contact moving between two frames more than twice its speed allows (1 m of slack; its first frame aside)
    let jumps = 0,
      steps = 0;
    for (let i = 1; i < rows.length; i++) {
      const dt = (rows[i]!.t - rows[i - 1]!.t) / 1000;
      for (const k of rows[i]!.crew.filter((x) => x.id.startsWith("f:"))) {
        const was = rows[i - 1]!.crew.find((x) => x.id === k.id);
        if (!was) continue;
        const d = wgs84Inverse(was.lat, was.lon, k.lat, k.lon).d;
        steps++;
        if (d > 2 * (k.spd ?? 0) * dt + 1) jumps++;
      }
    }
    out.ownFrame = rows.at(-1)?.frame;
    out.clocks = rows.slice(-3).map((r) => r.clocks);
    // (the raw track at its sending against the truth of that frame: the conversion's own error)
    out.raw = rows
      .filter((r) => r.own && r.clocks.snapT !== null && Math.abs(r.clocks.scene - r.clocks.snapT) < 0.02)
      .slice(0, 6)
      .flatMap((r) =>
        r.raw.map((k) => {
          const tr = r.truth.find((x) => x.name === k.name);
          if (!tr) return null;
          const [e, n] = en(r.own!, k);
          return {
            name: k.name,
            de: Math.round(e - tr.e),
            dn: Math.round(n - tr.n),
            dist: Math.round(Math.hypot(tr.e, tr.n)),
            brg: Math.round((Math.atan2(tr.e, tr.n) * 180) / Math.PI),
          };
        }),
      );
    console.log(`  raw ${JSON.stringify(out.raw)}`);
    out.P1 = { frames: rows.length, tracks: p1n, mismatches: p1diff, share: p1n ? p1diff / p1n : null };
    out.P2 = {
      samples: errs.length,
      p50: errs[Math.floor(errs.length / 2)] ?? null,
      p95,
      withinShare: errs.length ? p2ok / errs.length : null,
      // (its parts: the crew's own place off the pilot's, the contacts' off their true places)
      ownPlaceP50: [...ownErr].sort((a, b) => a - b)[Math.floor(ownErr.length / 2)] ?? null,
      contactPlaceP50: [...absErr].sort((a, b) => a - b)[Math.floor(absErr.length / 2)] ?? null,
      ownFrame: out.ownFrame,
    };
    out.P3 = { steps, jumps, share: steps ? jumps / steps : null };
    console.log(`  clocks ${JSON.stringify(out.clocks)}`);
    console.log(`  P1 ${JSON.stringify(out.P1)}\n  P2 ${JSON.stringify(out.P2)}\n  P3 ${JSON.stringify(out.P3)}`);
    expect(rows.length).toBeGreaterThan(100);
    expect(errs.length).toBeGreaterThan(50);
    await app.shot(`${shots}/radar-sync-radar.png`);
  }, 90_000);

  test("P4 — pause: nothing moves at the crew; ×4: four times as fast", async () => {
    await app.js("(__bh.game.pause(true), 1)");
    await Bun.sleep(1500);
    const still = await sample(3000);
    const drift = (rows: typeof still) => {
      const a = rows[0]!,
        b = rows.at(-1)!;
      let m = 0;
      for (const k of b.crew.filter((x) => x.id.startsWith("f:"))) {
        const was = a.crew.find((x) => x.id === k.id);
        if (was) m = Math.max(m, wgs84Inverse(was.lat, was.lon, k.lat, k.lon).d);
      }
      return m;
    };
    const paused = drift(still);
    await app.js("(__bh.game.pause(false), __bh.game.warp(4), 1)");
    await Bun.sleep(2500);
    const fast = await sample(3000);
    // (the crew's own speed over the ground against the drones' at ×4: their displacement over the sampled time)
    let ratio = Number.NaN;
    {
      const a = fast[0]!,
        b = fast.at(-1)!;
      const dt = (b.t - a.t) / 1000;
      const rs: number[] = [];
      for (const k of b.crew.filter((x) => x.id.startsWith("f:") && (x.spd ?? 0) > 5)) {
        const was = a.crew.find((x) => x.id === k.id);
        if (was) rs.push(wgs84Inverse(was.lat, was.lon, k.lat, k.lon).d / dt / k.spd!);
      }
      rs.sort((x, y) => x - y);
      ratio = rs[Math.floor(rs.length / 2)] ?? Number.NaN;
    }
    await app.js("(__bh.game.warp(1), 1)");
    out.P4 = { pausedDriftM: paused, warp4SpeedRatio: ratio };
    console.log(`  P4 ${JSON.stringify(out.P4)}`);
  }, 60_000);

  test("P8 — the events: the largest instruments event, the bytes a second; P9 — a missile and decoys at the crew", async () => {
    const ev = await app.js<{ t: number; n: number }[]>("window.__evs");
    const max = Math.max(...ev.map((e) => e.n));
    const span = (ev.at(-1)!.t - ev[0]!.t) / 1000;
    const rate = ev.reduce((a, e) => a + e.n, 0) / Math.max(span, 1);
    // (an AIM-120 at a drone, decoys out: what the crew's lists hold of them while they fly)
    await crew.js("__crew.actions.send('wp.select', { weapon: 'aim120' })");
    await crew.js("__crew.actions.send('wp.lock', {})");
    await app.waitFor("__bh.camera.combat.world.lock !== null", 5000);
    const shot = await crew.js<{ ok: boolean; msg: string }>("__crew.actions.send('wp.fire', {})");
    await crew.js("__crew.actions.send('wp.cm', {})");
    await Bun.sleep(700);
    const flying = await app.js<{ missiles: number; decoys: number }>(
      "({ missiles: __bh.camera.combat.world.missiles.filter((m) => m.alive).length, decoys: (__bh.camera.combat.world.decoys ?? []).length })",
    );
    const atCrew = await crew.js<number>(
      "__crew.model.contacts().filter((c) => c.kind === 'missile' || c.kind === 'decoy' || /^(msl|cm):/.test(c.id)).length",
    );
    out.P8 = { maxChars: max, limit: 16_384, bytesPerSecond: Math.round(rate), events: ev.length };
    out.P9 = { fired: shot, flying, atCrew };
    console.log(`  P8 ${JSON.stringify(out.P8)}\n  P9 ${JSON.stringify(out.P9)}`);
    expect(max).toBeGreaterThan(0);
  }, 30_000);

  test("P5, P6, P7, P10, P11 — as they stand", async () => {
    const src = async (f: string) => Bun.file(f).text();
    // P5: the IFF palettes written apart (the plan's six); one shared symbology module or not
    const files = ["src/ui/hud/symbology.ts", "src/f35/pcd.ts", "src/crew/draw/kit.ts", "src/crew/draw/radar.ts", "src/ui/missionmap.ts"];
    const palettes = (await Promise.all(files.map(src))).filter((s) => /hostile|IFF|iff/.test(s) && /#[0-9a-f]{6}|rgba?\(/i.test(s)).length;
    const symbols = await Bun.file("src/radar/symbols.ts").exists();
    // P6: the runways known
    const sites = ((await src("src/game/sites.ts")).match(/runway: true/g) ?? []).length;
    // P10, P11: the crew's click selects (a menu) — the pilot's radars none; the crew's wheel continuous, no common steps
    const range0 = await crew.js<number>("__crew.views.range");
    await crew.js("__crew.views.zoomBy(1.1)");
    const range1 = await crew.js<number>("__crew.views.range");
    out.P5 = { palettesFiles: palettes, sharedSymbols: symbols };
    out.P6 = { runwaysInGameSites: sites, worldBase: await Bun.file("assets/runways/index.json").exists() };
    out.P7 = { note: "cost: measured by trace-ab, not in this probe" };
    out.P10 = { crewTouchOpensMenu: true, pilotRadarClick: false };
    out.P11 = { crewWheelStep: range1 / range0, commonSteps: false };
    console.log(
      `  P5 ${JSON.stringify(out.P5)}\n  P6 ${JSON.stringify(out.P6)}\n  P10 ${JSON.stringify(out.P10)}\n  P11 ${JSON.stringify(out.P11)}`,
    );
    expect(app.cdp.errors).toEqual([]);
  }, 30_000);
});
