import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { placeLow } from "./lib/place";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { readPng } from "./lib/png";

// PLAN-J1 J1-5 — the buildings shaded forward (renderer.buildingsForward; system/buildings-forward.ts, trace.wgsl liteBuildingG):
// their triangles drawn again against the visibility's kept depth, their fragment shading the pixel with shadeLite's material (Q3)
// and light — the point on the triangle's own plane, its geometric normal and footprint from the hardware's derivatives —, shadeLite
// leaving those pixels to shadeLiteFinish. Toulon from the F-35's cockpit, 45 m over the old harbour (la Darse), looking north at
// the old town's façades (8° down) — Paris's views (the Étoile, La Défense) fell on the avenues' and the parks' trees, the
// buildings far —, frozen, the exposure held: by day (16:30 UTC, the Sun behind, the façades lit) and by night (the
// windows); shot without the lever, with it, without again (the scene's drift on both sides); the forward pixels counted (its mask
// read back, against the visibility's building pixels) and tinted (debug 2), the triangle's normal against shadeLite's (debug 1:
// green within 25°, red off, blue none to compare — counted where the view differs from the "on" shot); the passes timed over 60
// frames each side (earth lite, its light and finishing, buildings forward and its marking).
// BF_PLACE: another view (lat,lon,height over the ground,heading,pitch[,speed] — under 120 m/s for the city's whole scene).
// Output: remote-results/buildings-forward/<view>-{off,on,off2,tint,normals}.png, buildings-forward.json (BF_OUT).
// Done when: placed level over the relief in (lib/place.ts), the scenery whole (90 s at most, what is missing said), the forward
// pipeline built (60 s at most, its failure said), every shot taken and compared, no GPU error.
// Duration: ~3 min (Paris's buildings, IGN tiles; one pipeline compile per view).
const OUT = process.env.BF_OUT ?? "remote-results/buildings-forward";
afterAll(stopServer);
const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
// (the night first: the city's scenery in by the day's view — at the first, after 90 s, its forest stood where the streets are)
const VIEWS: { name: string; date: string; debug: boolean }[] = [
  { name: "night", date: "2026-07-10T22:30:00Z", debug: false },
  { name: "day", date: "2026-07-10T16:30:00Z", debug: true },
];
const PASSES = ["earth lite (raster)", "earth lite: light", "earth lite: finishing", "buildings forward", "buildings forward: marking"];

/** two shots' mean absolute difference (0–255, the RGB channels) and the share of pixels over 8 */
function diff(a: string, b: string) {
  const p = png(a),
    q = png(b);
  let s = 0,
    over = 0;
  const n = p.width * p.height;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(p.data[i * p.channels + c]! - q.data[i * q.channels + c]!);
    s += d / 3;
    if (d / 3 > 8) over++;
  }
  return { mean: +(s / n).toFixed(3), over8: +(over / n).toFixed(5) };
}
/** pixels of a debug view by colour — magenta (tint), green/red/blue (normals) —, where it differs from the "on" shot (the HUD's
 *  own colours left out) */
function counts(f: string, ref: string) {
  const p = png(f),
    q = png(ref);
  const c = { magenta: 0, green: 0, red: 0, blue: 0 };
  for (let i = 0; i < p.width * p.height; i++) {
    const r = p.data[i * p.channels]!,
      g = p.data[i * p.channels + 1]!,
      b = p.data[i * p.channels + 2]!;
    const d = Math.abs(r - q.data[i * q.channels]!) + Math.abs(g - q.data[i * q.channels + 1]!) + Math.abs(b - q.data[i * q.channels + 2]!);
    if (d < 60) continue;
    const m = Math.max(r, g, b);
    if (m < 40) continue;
    if (r > 0.6 * m && b > 0.6 * m && g < 0.35 * m) c.magenta++;
    else if (g > 0.6 * m && r < 0.35 * m && b < 0.35 * m) c.green++;
    else if (r > 0.6 * m && g < 0.35 * m && b < 0.35 * m) c.red++;
    else if (b > 0.6 * m && r < 0.35 * m && g < 0.35 * m) c.blue++;
  }
  return c;
}

test.skipIf(!E2E)(
  "J1-5: the buildings shaded forward — the same city, their pixels the fragment's, timed",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", traffic: false, f35Invulnerable: true, f35AutoProtect: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(
        `(() => { const r = __bh.renderer, prev = r.onGpuError; window.__gpuMsgs = []; r.onGpuError = (m) => { window.__gpuMsgs.push(String(m).slice(0, 400)); prev?.(m); }; return 1; })()`,
      );
      for (const v of VIEWS) {
        await app.js(
          `(() => { __bh.renderer.buildingsForward = false; __bh.renderer.buildingsForwardDebug = 0; __bh.game.setDate(${JSON.stringify(v.date)}); __bh.game.set("weather", "fair"); document.body.classList.add("hide-ui"); return 1; })()`,
        );
        // (BF_PLACE="lat,lon,height over the ground,heading,pitch[,speed]": another view — façades near; a speed under 120 m/s for the
        // city's whole scene: over it the scenery chains quick scenes, a flight too fast for a full one — scenery.ts fastFlight —, the
        // buildings near never drawn, a frozen craft at 140 m/s counted as fast — Marseille, Manhattan, 12 Nov)
        const P = (process.env.BF_PLACE ?? "43.1195,5.9315,45,350,-8").split(",").map(Number);
        const placed = await placeLow(app, [P[0]!, P[1]!, P[2]!, P[3]!, P[5] ?? 140], P[4]!);
        const world = await app
          .waitFor(
            `(() => { const r = __bh.renderer, sc = r.earthScenery.stats(); return r.earthTiles.pending === 0 && sc.status === "ready" && !sc.quick && !sc.pending; })()`,
            // (the whole scene, not its quick first pass — the forests first, the buildings after: at the quick one the quays and
            // the streets stood under trees, no building near — Marseille, Manhattan, 12 Nov)
            90_000,
          )
          .then(
            () => "all in",
            async () =>
              `not all in after 90 s: ${JSON.stringify(await app.js(`(() => { const r = __bh.renderer, sc = r.earthScenery.stats(); return { tiles: r.earthTiles.pending, scenery: sc.status, quick: sc.quick, pending: sc.pending }; })()`))}`,
          );
        await app.settled(60_000);
        await app.exposureSettled();
        await app.js(
          `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
        );
        const view: Record<string, unknown> = { placed, world };
        // (the lever and debug view set, the pipeline awaited — built for the key and the view — then 60 frames timed, a shot)
        const side = async (tag: string, on: boolean, dbg: number) => {
          await app.js(
            `(() => { const r = __bh.renderer; r.buildingsForward = ${on}; r.buildingsForwardDebug = ${dbg}; __bh.touch(); return 1; })()`,
          );
          let built = "off";
          if (on)
            built =
              await app.js<string>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
              const t0 = performance.now();
              while (performance.now() - t0 < 60000) {
                const s = r.buildingsForwardState;
                if (s?.failed) return "failed: " + s.failed;
                if (r.buildingsForwardNow && s?.ready && String(s.key).endsWith(":${dbg}")) return "drawn";
                __bh.touch(); await frame(); }
              return "not drawn after 60 s — " + JSON.stringify(r.buildingsForwardState); })()`);
          const passes = await app.js<
            Record<string, number>
          >(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
            r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
            let drawn = 0;
            for (let i = 0; i < 60; i++) { __bh.touch(); await frame(); if (r.buildingsForwardNow) drawn++; }
            const T = r.prof.table(); r.prof.enabled = false;
            const o = { drawnFrames: drawn, total: +T.reduce((s, x) => s + (x.ms ?? 0), 0).toFixed(3) };
            for (const l of ${JSON.stringify(PASSES)}) o[l] = +(T.find((x) => x.label === l)?.ms ?? 0).toFixed(3);
            return o; })()`);
          await app.shot(`${OUT}/${v.name}-${tag}.png`);
          const pixels = on ? await app.js(`__bh.renderer.buildingsForwardPixels()`) : null;
          return { built, passes, pixels };
        };
        view.off = await side("off", false, 0);
        view.on = await side("on", true, 0);
        view.state = await app.js(`__bh.renderer.buildingsForwardState`);
        view.off2 = await side("off2", false, 0);
        view.onVsOff = diff(`${OUT}/${v.name}-off.png`, `${OUT}/${v.name}-on.png`);
        view.offVsOff2 = diff(`${OUT}/${v.name}-off.png`, `${OUT}/${v.name}-off2.png`);
        if (v.debug) {
          view.tint = await side("tint", true, 2);
          view.tintCounts = counts(`${OUT}/${v.name}-tint.png`, `${OUT}/${v.name}-on.png`);
          view.normals = await side("normals", true, 1);
          view.normalCounts = counts(`${OUT}/${v.name}-normals.png`, `${OUT}/${v.name}-on.png`);
        }
        await app.js(
          `(() => { window.__ev = null; const r = __bh.renderer; r.buildingsForward = false; r.buildingsForwardDebug = 0; return 1; })()`,
        );
        out[v.name] = view;
        console.log(`  ${v.name}: ${JSON.stringify(view)}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = await app.js<string[]>(`window.__gpuMsgs`);
      await Bun.write(`${OUT}/buildings-forward.json`, JSON.stringify(out, null, 1));
      await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      expect(out.gpuErrors).toBe(0);
      for (const v of VIEWS) expect((out[v.name] as { on: { built: string } }).on.built).toBe("drawn");
    } finally {
      await app.close();
    }
  },
  10 * 60_000,
);
