import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { fromRunway } from "../../src/game/ils";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// A night approach on Paris-Le Bourget (LFPB), landed by the ILS's autopilot (Sam, 6 Nov 2026: « approche Le Bourget de nuit
// pour atterrissage automatique ILS. Attends le chargement pour lancer »): the F-35 put on the final of the runway in use,
// 14 km out on its 3° slope, gear down, 7 Nov 2026 19:30 UTC (20:30 in Paris); held still until every datum round it is in
// (app.dataSettled: the relief, the photographs, the scenery, the kernels), then the approach engaged (camera.ilsStart) and
// flown to the rollout — a shot every 3 s from the cockpit (the north of Paris at night below: the streets' lamps, NU1; the
// runway's lights), the phases and the touchdown's grade logged.
// Output: remote-results/lebourget-night-ils/NN.jpg, approach.json (LBN_OUT). LBN_RWY: an end (« 25 », « 21 »…).
// Done when: the data in before the approach, the approach engaged, the rollout reached within 4 min on the drawn runway
// (within 15 m of its axis), no console error.
// Duration: ~4 min (the load included).
const OUT = process.env.LBN_OUT ?? "remote-results/lebourget-night-ils";
// (LBN_FIELD: another airfield — its ICAO —, LBN_NEAR « lat,lon » a place near it its runways' tile loads from)
const FIELD = process.env.LBN_FIELD ?? "LFPB";
// (LBN_UTC: the instant — night at the field: 20:30 local; Paris's 19:30 UTC by default, New York's 01:30 the next day)
const UTC = process.env.LBN_UTC ?? "2026-11-07T19:30:00Z";
const NEAR = (process.env.LBN_NEAR ?? "48.9,2.35").split(",").map(Number) as [number, number];
const KM = 14;
afterAll(stopServer);

test.skipIf(!E2E)(
  "Le Bourget at night: the ILS's autopilot lands the F-35",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    const series: Record<string, unknown>[] = [];
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, f35Invulnerable: true, motionBlur: 0, dof: false, detailReach: "veryFar", earthScenery: "high" }); return 1; })()`,
      );
      await app.waitProgress(`__bh.fleet.active === "f35"`, "the F-35");
      // (near the field: its runways' tile in, the end in use)
      await app.js(
        `(() => { __bh.game.setDate(${JSON.stringify(UTC)}); __bh.game.set("weather", "fair"); __bh.game.flyAt(${NEAR[0]}, ${NEAR[1]}, 900, 60, 120); __bh.freeze(true); return 1; })()`,
      );
      await app.waitProgress(`(__bh.camera.ilsRunways(${JSON.stringify(FIELD)})?.ends.length ?? 0) >= 2`, `${FIELD}'s runways`);
      const ch = await app.js<{ auto: string; ends: { id: string; lat: number; lon: number; hdg: number; elev: number; len: number }[] }>(
        `(() => { const c = __bh.camera.ilsRunways(${JSON.stringify(FIELD)}); return { auto: c.auto.id, ends: c.ends.map((e) => ({ id: e.id, lat: e.rwy.lat, lon: e.rwy.lon, hdg: e.rwy.hdg, elev: e.rwy.elev, len: Math.round(e.len) })) }; })()`,
      );
      const rwy = process.env.LBN_RWY ?? ch.auto;
      const E = ch.ends.find((e) => e.id === rwy)!;
      console.log(`  ${FIELD}: ${ch.ends.map((e) => `${e.id} ${e.len} m`).join(", ")} — flying ${rwy}`);
      // (14 km out on its axis, on the 3° slope over the threshold — 300 m past it the aim —, gear down)
      const p = fromRunway({ name: FIELD, lat: E.lat, lon: E.lon, hdg: E.hdg, elev: E.elev, len: E.len }, -KM * 1000, 0);
      const h = Math.round((KM * 1000 + 300) * Math.tan((3 * Math.PI) / 180));
      await app.js(`(() => { __bh.game.flyAt(${p.lat}, ${p.lon}, ${h}, ${E.hdg}, 95); __bh.camera.gearDown = true;
        __bh.settings.shipMount = "cockpit"; __bh.freeze(true); return 1; })()`);
      // (every datum in before the approach: waited while it keeps coming, what stalls said)
      await app.dataSettled("Le Bourget's final");
      // (the network's light's seconds counted from here — the flight's —, not the load's)
      await app.js(`(() => { __bh.freeze(false); __bh.netLight.reset(); __bh.camera.setLook(0, -4); return 1; })()`);
      const said = await app.js<string>(`__bh.camera.ilsStart(${JSON.stringify(FIELD)}, { runway: ${JSON.stringify(rwy)} })`);
      console.log(`  ${said}`);
      const t0 = Date.now();
      let phase: string | null = null;
      let lastXte = Number.NaN;
      for (let i = 0; Date.now() - t0 < 240_000; i++) {
        const a = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
        await Bun.write(`${OUT}/${String(i).padStart(2, "0")}.jpg`, Buffer.from(a.data, "base64"));
        // (xte: the craft off the drawn runway's axis [m, right +] — the runway as the scenery draws it, sys.runways —: the ILS's
        // runway and the drawn one the same; the first flight touched down ~60 m beside it)
        const m = await app.js<Record<string, unknown>>(`(() => { const c = __bh.camera, g = c.geoNow(), I = c.ilsInfo(), D = Math.PI / 180;
          // (the field's runway drawn nearest the craft's line — the game's own or a world one —, its axis's distance)
          let xte = null;
          if (g) for (const r of __bh.sys.runways().filter((x) => x.site.icao === ${JSON.stringify(FIELD)} || x.world?.field === ${JSON.stringify(FIELD)})) {
            const s = r.site, dn = (g.lat - s.lat) * 111132, de = (g.lon - s.lon) * 111320 * Math.cos(s.lat * D), h = s.rwy * D;
            const x = Math.round(de * Math.cos(h) - dn * Math.sin(h));
            if (xte === null || Math.abs(x) < Math.abs(xte)) xte = x; }
          return { phase: I?.phase ?? null, alt: g ? Math.round(g.alt) : null, gs: g ? Math.round(g.gs) : null, xte, city: +(__bh.renderer.cityLight * 1e5).toFixed(2),
            pending: __bh.renderer.earthTiles.pending, fps: Math.round(__bh.renderer.fps ?? 0),
            // (the scenery's state — LBN_SCENERY=1: its scenes, their worker's time by phase, their bytes, its budget —)
            sc: ${process.env.LBN_SCENERY === "1"} ? (() => { const x = __bh.renderer.earthScenery.stats(); return { st: x.status, step: x.progress?.step ?? null,
              ms: Math.round(x.workerMs), ph: x.phases, mb: +(x.tileNetworkBytes / 1e6).toFixed(1), b: x.buildings, lim: x.budgetLimited, gpu: +(x.gpuBytes / 1e6).toFixed(0),
              up: Math.round(x.uploadCpuMs ?? 0), reach: x.reach, lat: x.lat }; })() : undefined }; })()`);
        const t = +((Date.now() - t0) / 1000).toFixed(1);
        series.push({ i, t, ...m });
        console.log(`  ${t}s: ${JSON.stringify(m)}`);
        phase = (m.phase as string | null) ?? phase;
        if (m.xte !== null) lastXte = m.xte as number;
        if (m.phase === "rollout" || m.phase === "done" || (m.gs as number) < 5) break;
        await Bun.sleep(3000);
      }
      // (the network's failures by source and answer — what turned its light red —, the most first)
      const fails = await app.js<[string, number][]>(
        `Object.entries(__bh.netLight.stats().failBy ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 12)`,
      );
      const net = await app.js<Record<string, unknown>>(
        `(() => { const s = __bh.netLight.stats(); return { started: s.started, done: s.done, failed: s.failed, limited: s.limited, cached: s.cached, mb: Math.round(s.bytes / 1e6), seconds: Object.fromEntries(Object.entries(s.seconds).map(([k, v]) => [k, Math.round(v)])) }; })()`,
      );
      console.log(`  network: ${JSON.stringify(net)} — failures ${JSON.stringify(fails)}`);
      const last = await app.js<unknown>(`__bh.camera.ilsLast ?? null`);
      console.log(`  touchdown: ${JSON.stringify(last)}`);
      await Bun.write(`${OUT}/approach.json`, JSON.stringify({ rwy, said, series, last }, null, 1));
      expect(["rollout", "done"]).toContain(phase ?? "none");
      // (on the drawn runway: within 15 m of its axis at the end)
      expect(Math.abs(lastXte)).toBeLessThan(15);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  10 * 60_000,
);
