import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Probe — not in `bun run e2e`: E2E_PROBE=1 — (PROBLEMES-A-REGLER, « Des villes couvertes d'arbres », 12 Nov 2026: does the
// scenery's cap of 32 000 buildings, the nearest its centre kept, leave the IGN's surveyed trees — its canopy model holds the
// roofs too — on the blocks it cut?). A city flown as J0 is (E2E-VOLS §5.4: placed with the clock frozen, the data waited for,
// placed again, autopilot, autothrottle and gear down held; then the view held for the measure), 300 m over the ground at 90 m/s
// (under T8m's fast flight: the full scene comes), the cockpit looking a little down at the blocks 0.5–5 km ahead. Then, the
// scenery's `clearCut` off / on / off (the trees kept off the cut buildings' footprints too — the lever, off by default): each
// side the scene's stats (`cutBuildings`, `keptReachM`, `surveyedTrees`, `clearedTrees`, the worker's time), a grid of the
// visibility's surface (renderer.surfaceAt: tree, building, ground by distance) and a shot. The tree points that turn to ground
// with `clearCut` are trees on known buildings. CT_PLACE "lat,lon,agl,hdg,v" (default Paris, Passy towards the Louvre), CT_LOOK
// (the look's pitch, °), CT_OUT (remote-results/cut-trees), CT_SIDES (default "off,on,off"), CT_FLY_S (flown that long in real time
// before the view is held: the scene drawn the flight's own — a side toggled after it is made for the held craft, led ahead), CT_CLEAR=1
// (the lever on from the start: the flight's own scenes made with it).
// Duration: ~5–7 min (three full scenes of Paris).
// Done when: each side measured and shot, results.json written.
afterAll(stopServer);
const OUT = process.env.CT_OUT ?? "remote-results/cut-trees";
const PLACE = (process.env.CT_PLACE ?? "48.8600,2.2780,300,95,90").split(",").map(Number) as [number, number, number, number, number];
const LOOK = Number(process.env.CT_LOOK ?? -7);
const SIDES = (process.env.CT_SIDES ?? "off,on,off").split(",");
const GX = 80,
  GY = 45;
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the scenery's cap: trees on the blocks it cut",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 900, lang: "fr", hash: "scene=game:artemis" });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, autosave: false, wind: 0, damage: false,
        crashSpeed: 1e9, f35Invulnerable: true, f35AutoProtect: false, weather: "fair", earthClouds: 0 }); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      // (CT_CLEAR=1: the lever on from the start — the flight's own scenes made with it, side "now" measuring them)
      if (process.env.CT_CLEAR === "1") await app.js(`(() => { __bh.renderer.earthScenery.clearCut = true; return 1; })()`);
      const [lat, lon, agl, hdg, v] = PLACE;
      const place = `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${v});
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
      await app.settled(180_000);
      await app.dataSettled("cut trees: the city", { maxMs: 60_000 }).catch((e) => console.log(`  (${String(e).slice(0, 160)})`));
      await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
      await app.settled(60_000);
      const ap = await app.js<{ ap: boolean; athr: boolean }>(`(async () => { __bh.freeze(false);
        const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
        for (let i = 0; i < 90; i++) { await f(); __bh.settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true;
          if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          if (c.jetModes.alt !== null && c.jetModes.spd !== null && i > 10) break; }
        const g = c.geoNow(); if (g && c.jetModes.alt !== null) { c.jetModes.alt = g.alt; c.jetModes.hdg = ${hdg} * Math.PI / 180; }
        c.jetModes.spd = ${v};
        for (let i = 0; i < 60; i++) { await f(); c.gearDown = true; c.gearExt = 1; }
        // (CT_FLY_S: then flown that long in real time — the scenes made as in a flight, the craft catching up with their centre)
        const end = performance.now() + ${Number(process.env.CT_FLY_S ?? 0)} * 1000;
        while (performance.now() < end) { await f(); c.gearDown = true; c.gearExt = 1; }
        return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null }; })()`);
      if (!ap.ap || !ap.athr) throw new Error(`the autopilot ${ap.ap} / autothrottle ${ap.athr} not engaged`);
      // (the view held — the clock frozen: the craft in flight, its scene the moving craft's, led ahead by its speed —, looking down)
      await app.js(`(async () => { __bh.freeze(true); __bh.settings.shipLookPitch = ${LOOK}; __bh.refresh();
        const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) await f(); return 1; })()`);
      const flight = await app.js<Record<string, unknown>>(`(() => { const c = __bh.camera, g = c.geoNow();
        return { lat: +(g.lat).toFixed(5), lon: +(g.lon).toFixed(5), altMsl: Math.round(g.alt),
          ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null, gear: c.gearDown, speed: Math.round(__bh.renderer.earthScenery.speed) }; })()`);
      console.log(`  flight held: ${JSON.stringify(flight)}`);
      const out: Record<string, unknown> = { place: PLACE, look: LOOK, flight, sides: [] as unknown[] };
      for (const [n, side] of SIDES.entries()) {
        const on = side === "on";
        if (side !== "now") await app.js(`(() => { __bh.renderer.earthScenery.clearCut = ${on}; __bh.touch(); return 1; })()`);
        // (the scene made with this side's lever, the full one, drawn: logged every 10 s, 240 s at most — a cold Paris is ~60–120 s)
        const t0 = Date.now();
        let last = 0;
        // (side "now": the scene drawn as it is — after CT_FLY_S, the flight's own —, not waited for)
        for (; side !== "now"; ) {
          const s = await app.js<{ ok: boolean; line: string }>(`(() => { const s = __bh.renderer.earthScenery.stats();
            return { ok: s.clearCutDrawn === ${on} && !s.quick && !s.pending && s.status === "ready",
              line: s.status + " quick " + s.quick + " pending " + s.pending + " drawn " + s.clearCutDrawn + " step " + JSON.stringify(s.progress) }; })()`);
          if (s.ok) break;
          if (Date.now() - t0 > 240_000) throw new Error(`side ${side}: the scene never came (${s.line})`);
          if (Date.now() - last > 10_000) {
            console.log(`    side ${side}: waiting for the scene, ${Math.round((Date.now() - t0) / 1000)} s — ${s.line}`);
            last = Date.now();
          }
          await Bun.sleep(500);
        }
        if (side !== "now")
          await app.js(`new Promise((q) => { let n = 0; const f = () => (++n > 90 ? q(1) : requestAnimationFrame(f)); f(); })`);
        const stats = await app.js<
          Record<string, unknown>
        >(`(() => { const s = __bh.renderer.earthScenery.stats(), c = __bh.camera.geoNow();
          const d = s.lat === null ? null : Math.round(Math.hypot((s.lat - c.lat) * 111320, (s.lon - c.lon) * 111320 * Math.cos(c.lat * Math.PI / 180)));
          return { centre: [s.lat, s.lon], centreFromCraftM: d, budgetLimited: s.budgetLimited, buildings: s.buildings, bdtopoBuildings: s.bdtopoBuildings,
            cutBuildings: s.cutBuildings, keptReachM: s.keptReachM, trees: s.trees, surveyedTrees: s.surveyedTrees, clearedTrees: s.clearedTrees,
            cutHousesMs: s.cutHousesMs, quick: s.quick, pending: s.pending, surveyError: s.surveyError, workerMs: Math.round(s.workerMs ?? 0), phases: s.phases, gpuBytes: s.gpuBytes, reach: s.reach }; })()`);
        console.log(`  side ${n} ${side}: ${JSON.stringify(stats)}`);
        // (the visibility's surface on a GX × GY grid: kind and distance — 256 reads at once)
        const grid = await app.js<{ kind: string; d: number; object: number }[]>(`(async () => {
          const pts = []; for (let j = 0; j < ${GY}; j++) for (let i = 0; i < ${GX}; i++) pts.push([(i + 0.5) / ${GX}, (j + 0.5) / ${GY}]);
          const res = [];
          for (let k = 0; k < pts.length; k += 256) {
            const part = await Promise.all(pts.slice(k, k + 256).map(([x, y]) => __bh.renderer.surfaceAt(x, y)));
            for (const r of part) res.push({ kind: r?.kind ?? "none", d: Math.round(r?.nearest ?? -1), object: r?.object ?? 0 });
          }
          return res; })()`);
        const bins = [0, 1000, 2000, 3000, 5000, Infinity];
        const byKind: Record<string, number[]> = {};
        for (const p of grid) {
          const b = bins.findIndex((x, i) => p.d >= x && p.d < bins[i + 1]!);
          (byKind[p.kind] ??= [0, 0, 0, 0, 0])[Math.max(0, b)]!++;
        }
        console.log(`  side ${n} ${side}: grid kinds by distance (<1, 1–2, 2–3, 3–5, >5 km) ${JSON.stringify(byKind)}`);
        // (frame GPU time over 60 frames, the view held)
        const gpu = await app.js<number[]>(`(async () => { const a = []; const f = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < 60; i++) { await f(); a.push(__bh.renderer.lastGpuMs); } return a.filter((x) => x > 0).sort((x, y) => x - y); })()`);
        const gpuP50 = gpu[Math.floor(gpu.length / 2)] ?? 0;
        await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
        await app.js(`new Promise((q) => requestAnimationFrame(() => requestAnimationFrame(q)))`);
        const shot = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
        await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
        await Bun.write(`${OUT}/side-${n}-${side}.png`, Buffer.from(shot.data, "base64"));
        (out.sides as unknown[]).push({ side, stats, byKind, grid: grid.map((p) => `${p.kind[0]}${p.d}`), gpuP50 });
        console.log(`  side ${n} ${side}: GPU p50 ${gpuP50.toFixed(2)} ms`);
      }
      // (the points that change between the first two sides: a tree in one, what in the other — by distance)
      const sides = out.sides as { side: string; grid: string[] }[];
      if (sides.length >= 2) {
        const a = sides[0]!.grid,
          b = sides[1]!.grid;
        const moves: Record<string, number> = {};
        for (let i = 0; i < a.length; i++) {
          if (a[i]![0] === b[i]![0]) continue;
          const d = Number(a[i]!.slice(1));
          const key = `${a[i]![0]}→${b[i]![0]} ${d < 1000 ? "<1" : d < 2000 ? "1–2" : d < 3000 ? "2–3" : d < 5000 ? "3–5" : ">5"} km`;
          moves[key] = (moves[key] ?? 0) + 1;
        }
        console.log(`  points changed ${sides[0]!.side} → ${sides[1]!.side}: ${JSON.stringify(moves)}`);
        out.moves = moves;
      }
      await Bun.write(`${OUT}/results.json`, JSON.stringify(out, null, 1));
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      await app.js(`(() => { __bh.renderer.earthScenery.clearCut = false; return 1; })()`).catch(() => 0);
      app.close();
    }
  },
  1_200_000,
);
