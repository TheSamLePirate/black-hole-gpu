import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { placeLow } from "./lib/place";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T7 — the sea and its coasts, a survey (Sam, 4 Nov 2026: "plusieurs zones de mer, littoral, France et monde, pour une mer et un
// littoral parfaits AAA"): cliffs, bays, tidal flats, low lands, sandy and rocky coasts, lagoons and fjords, from the cockpit a few
// hundred metres up facing the coast, the Sun at ~14 h local solar time (SC_HOUR), the weather fair and the clouds off. Each site
// placed level over the relief in (lib/place.ts), the world under the view awaited (45 s at most, what is missing said), frozen,
// the exposure settled, shot. The shots are looked at one by one: the coast's line against the imagery, the shallows' colour, the
// surf and foam, the wet sand, the waves' scale and repetition, the glint, low lands changed to sea, the cliffs' faces.
//   SC_SITES: the sites' names (comma-separated; all when unset); SC_HIGH=1: each also from 2 500 m looking 25° down.
// Output: remote-results/coast-survey/<site>[-high].png, coast.json (SC_OUT).
// Done when: every site asked shot (or its placing's error said), no GPU error (their texts said). Duration: ~1 min a site.
const OUT = process.env.SC_OUT ?? "remote-results/coast-survey";
afterAll(stopServer);
const HOUR = Number(process.env.SC_HOUR ?? 14);
interface Site {
  name: string;
  /** lat, lon, height over the ground or sea [m], heading [°] (towards the coast), speed [m/s] */
  at: [number, number, number, number, number];
  look: number;
  what: string;
}
const SITES: Site[] = [
  // France
  { name: "etretat", at: [49.722, 0.17, 250, 135, 140], look: -6, what: "chalk cliffs, arches, shingle" },
  { name: "msm", at: [48.665, -1.56, 300, 135, 140], look: -10, what: "the bay's tidal flats, the Mont" },
  { name: "raz", at: [48.035, -4.8, 250, 85, 140], look: -6, what: "a granite point, the open Atlantic's surf" },
  { name: "calanques", at: [43.18, 5.47, 300, 10, 140], look: -8, what: "limestone cliffs, clear shallow inlets" },
  { name: "nice", at: [43.655, 7.26, 400, 355, 140], look: -8, what: "the Baie des Anges, a city on the shore" },
  { name: "pilat", at: [44.585, -1.27, 300, 85, 140], look: -6, what: "the dune, the Arcachon basin's banks" },
  { name: "camargue", at: [43.4, 4.45, 500, 10, 140], look: -8, what: "low lands, lagoons, the delta" },
  { name: "bonifacio", at: [41.365, 9.15, 250, 15, 140], look: -6, what: "the town on its white cliffs" },
  // the world
  { name: "dover", at: [51.105, 1.36, 250, 330, 140], look: -6, what: "the white cliffs, the Channel" },
  { name: "santorini", at: [36.4, 25.385, 400, 80, 140], look: -8, what: "the caldera's walls, deep blue water" },
  { name: "waikiki", at: [21.245, -157.845, 400, 45, 140], look: -8, what: "reef, turquoise shallows, Diamond Head" },
  { name: "maldives", at: [4.25, 73.52, 1500, 0, 140], look: -25, what: "atolls, lagoons, reefs" },
  { name: "sydney", at: [-33.835, 151.33, 400, 270, 140], look: -6, what: "the Heads, sandstone cliffs, the harbour" },
  { name: "bigsur", at: [36.37, -121.94, 300, 90, 140], look: -6, what: "the Pacific's surf at steep coast" },
  { name: "lofoten", at: [67.91, 13.05, 400, 45, 140], look: -6, what: "peaks out of the sea, a fishing village" },
  { name: "wadden", at: [52.95, 5.05, 600, 120, 140], look: -8, what: "the Afsluitdijk, polders under the sea's level" },
];

test.skipIf(!E2E)(
  "T7: the sea and its coasts, France and the world — a shot each from the cockpit",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const want = process.env.SC_SITES?.split(",");
    const sites = SITES.filter((s) => !want || want.includes(s.name));
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, f35AutoProtect: true, motionBlur: 0, dof: false, hudJet: "off" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const s of sites)
        for (const high of process.env.SC_HIGH === "1" ? [false, true] : [false]) {
          const name = high ? `${s.name}-high` : s.name;
          // (the local solar time asked: UTC = hour − lon/15)
          const utc = new Date(Date.UTC(2026, 6, 10) + (HOUR - s.at[1] / 15) * 3600e3).toISOString();
          await app.js(`(() => { __bh.freeze(false); __bh.game.setDate(${JSON.stringify(utc)}); __bh.game.set("weather", "fair");
            document.body.classList.add("hide-ui"); return 1; })()`);
          const at: Site["at"] = high ? [s.at[0], s.at[1], 2500, s.at[3], s.at[4]] : s.at;
          let placed: unknown;
          try {
            placed = await placeLow(app, at, high ? -25 : s.look);
          } catch (e) {
            out[name] = { error: String(e) };
            console.log(`  ${name}: ${String(e)}`);
            continue;
          }
          const world =
            await app.js<string>(`(async () => { const r = __bh.renderer, t0 = performance.now(), frame = () => new Promise((q) => requestAnimationFrame(q));
            const missing = () => { const sc = r.earthScenery.stats(), m = [];
              if (r.earthMaps.tier !== "high") m.push("maps " + r.earthMaps.tier); if (r.earthTiles.pending) m.push(r.earthTiles.pending + " relief tiles");
              if (r.earthTiles.orthoPending) m.push(r.earthTiles.orthoPending + " imagery tiles"); if (r.earthSurface.pending) m.push("surface");
              if (sc.status !== "ready" || sc.pending) m.push("scenery " + sc.status); return m; };
            while (performance.now() - t0 < 45000 && missing().length) { __bh.touch(); await frame(); }
            const m = missing(); return m.length ? "missing after 45 s: " + m.join(", ") : "all in"; })()`);
          await app.settled(60_000);
          await app.exposureSettled();
          await app.js(`(() => { const m = document.querySelector("[data-testid=jetmap]"); if (m) m.style.visibility = "hidden";
            document.getElementById("overlay").style.visibility = "hidden"; return 1; })()`);
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 45) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          await app.shot(`${OUT}/${name}.png`);
          out[name] = {
            what: s.what,
            utc,
            placed,
            world,
            pipeline: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`),
            sunDeg: await app.js<number>(
              `(() => { const g = __bh.camera.geoNow(); const s = __bh.sys.sunElevation?.("earth", g); return s == null ? null : +(s * 180 / Math.PI).toFixed(1); })()`,
            ),
          };
          console.log(`  ${name}: ${JSON.stringify(out[name])}`);
          await app.js(`(() => { document.getElementById("overlay").style.visibility = ""; return 1; })()`);
        }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = app.cdp.errors.filter((e) => /WebGPU/i.test(e)).slice(0, 3);
    } finally {
      await Bun.write(`${OUT}/coast.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  30 * 60_000,
);
