import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS, sceneryReady } from "./lib/plan-views";
import { type Pixels, readPng } from "./lib/png";

// Q2 — the photographs' own light (docs/PLAN-REFRACTION-HORIZONS.md, decision 29; trace.wgsl photoRelightK): Paris, Chamonix
// and the Beauce from the F-35's cockpit, each under three Suns — near the photographs' (the IGN's: noon), the late afternoon, the
// sunset —, drawn with settings.groundRelight "auto" and "full" (the relief's n·L whole over the photograph, as before Q2),
// the tiles and the scenery in. The two compared: near the photographs' Sun auto keeps their light (the relief not shaded twice
// — the images differ on the slopes); at sunset the two come together (k → 1: ours whole). Shots in remote-results/ground-relight.
// Duration: ~10 min (kerr-mini).
const OUT = "remote-results/ground-relight";
afterAll(stopServer);
const VIEWS = [
  { name: "paris", at: [48.85, 2.27, 300, 70, 120] },
  { name: "chamonix", at: [45.9, 6.85, 450, 90, 120] },
  { name: "beauce", at: [48.3, 1.6, 300, 200, 120] },
];
// (UTC on a July day: 11:45, the local noon — the IGN's orthophotos', the ground's photographs over France: their Sun —, 15:30
// the late afternoon, 18:55 the sunset — the Sun 3–8°)
const SUNS = [
  { name: "noon", date: "2026-07-10T11:45:00Z" },
  { name: "afternoon", date: "2026-07-10T15:30:00Z" },
  { name: "sunset", date: "2026-07-10T18:55:00Z" },
];
/** the ground band's luminance (rows 38–72 %, above the cockpit) in 16 × 16 blocks — their means: the frame's grain averaged out */
const blocks = (a: Pixels) => {
  const B = 16,
    y0 = Math.floor(a.height * 0.38),
    y1 = Math.floor(a.height * 0.72);
  const out: number[] = [];
  for (let by = y0; by + B <= y1; by += B)
    for (let bx = 0; bx + B <= a.width; bx += B) {
      let s = 0;
      for (let y = by; y < by + B; y++)
        for (let x = bx; x < bx + B; x++) {
          const i = (y * a.width + x) * a.channels;
          s += 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;
        }
      out.push(s / (B * B));
    }
  return out;
};
/** two images' blocks: their mean absolute and signed differences [levels], and the 95th centile of the absolute */
const compare = (a: number[], b: number[]) => {
  const d = a.map((v, i) => v - b[i]!);
  const abs = d.map(Math.abs).sort((x, y) => x - y);
  return {
    abs: +(abs.reduce((s, v) => s + v, 0) / abs.length).toFixed(2),
    signed: +(d.reduce((s, v) => s + v, 0) / d.length).toFixed(2),
    p95: +abs[Math.floor(0.95 * (abs.length - 1))]!.toFixed(2),
  };
};

test.skipIf(!E2E)(
  "the ground's light: the photographs' kept near their Sun, ours whole at sunset",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const t0 = performance.now();
    const step = (what: string) => console.log(`  [${((performance.now() - t0) / 1000).toFixed(0)} s] ${what}`);
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<
      string,
      Record<
        string,
        { sun: number; abs: number; signed: number; p95: number; noise: number; skyBounce: { abs: number; signed: number; p95: number } }
      >
    > = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, groundRelight: "auto" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const v of VIEWS) {
        const place = `__bh.game.flyAt(${v.at.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
        await app.js(`(() => { __bh.game.setDate(${JSON.stringify(SUNS[0]!.date)}); ${place} __bh.freeze(true); return 1; })()`);
        const tiles = await app.waitFor(`__bh.renderer.earthTiles.pending <= 2 && __bh.renderer.earthTiles.finest >= 14`, 60_000).then(
          () => true,
          () => false,
        );
        const sc = await sceneryReady(app, 120_000);
        step(
          `${v.name}: tiles ${tiles ? "in" : "NOT in after 60 s"}, scenery ${sc.ready ? "in" : "NOT in after 120 s"} ${JSON.stringify(sc)}`,
        );
        out[v.name] = {};
        for (const sun of SUNS) {
          // (the light's change of Sun let settle first — the first shot after it was darker by 4 levels, whatever the mode —;
          // then auto, full, auto: the relief's change against auto's two shots' mean, their own gap the noise)
          const shoot = async (mode: string, tag: string, frames: number, skip = 0) => {
            await app.js(
              `(() => { __bh.renderer.liteSkip = ${skip}; __bh.settings.groundRelight = "${mode}"; __bh.game.setDate(${JSON.stringify(sun.date)}); __bh.freeze(true); return 1; })()`,
            );
            await app.settled(60_000);
            await app.js(
              `new Promise((r) => { let k = 0; const f = () => { __bh.touch(); if (++k < ${frames}) requestAnimationFrame(f); else r(1); }; f(); })`,
            );
            await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
            const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
            await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
            const b = Buffer.from(data, "base64");
            if (tag) await Bun.write(`${OUT}/${v.name}-${sun.name}-${tag}.png`, b);
            // (the relief cascades' state and the camera's place at the shot: the craft held — placed again unfrozen, it flew ~180 m
            // during a shot's 90 frames, the views compared not the same: a whole slope "shaded" was another slope, 2 Nov 2026)
            const st = await app.js(
              `(() => { const R = __bh.renderer, tr = R.terrainRaster, g = __bh.camera.geoNow?.(); return { key: String(tr.sunKey).slice(0, 24), frames: tr.sunFrames, at: g ? [+g.lat.toFixed(5), +g.lon.toFixed(5), Math.round(g.alt)] : null, rows: Array.from(R.sunCascadeRows).map((x) => +x.toFixed(1)) }; })()`,
            );
            if (tag) step(`    ${tag}: ${JSON.stringify(st)}`);
            return blocks(readPng(b));
          };
          await shoot("auto", "", 240);
          const a1 = await shoot("auto", "auto", 90);
          const f = await shoot("full", "full", 90);
          const a2 = await shoot("auto", "auto2", 90);
          // (L1, L6 — the sky by the frame's harmonics on the face, the bounce by the ground's mean albedo — against the flat sky
          // and the 0.18 bounce: liteSkip 32768)
          const old = await shoot("auto", "oldlight", 90, 32768);
          const auto = a1.map((x, i) => 0.5 * (x + a2[i]!));
          const sunEl = await app.js<number>(`(() => +(__bh.camera.skyInfo?.().sun?.lightAltDeg ?? NaN).toFixed(1))()`);
          const r = { sun: sunEl, ...compare(auto, f), noise: compare(a1, a2).abs, skyBounce: compare(auto, old) };
          out[v.name]![sun.name] = r;
          step(`${v.name} ${sun.name} (Sun ${sunEl}°): auto − full ${JSON.stringify(r)}`);
        }
      }
      writeFileSync(`${OUT}/ground-relight.json`, JSON.stringify(out, null, 1));
      expect(await app.js<number>(`(() => __bh.renderer.gpuErrors)()`)).toBe(0);
      // (in the late afternoon and at sunset ours whole either way — k 1 —: auto and full within their noise; near the
      // photographs' Sun, auto keeps their light — a difference over the relief's slopes, above the noise in the mountains)
      for (const v of VIEWS)
        for (const t of ["afternoon", "sunset"]) expect(out[v.name]![t]!.abs).toBeLessThan(Math.max(2 * out[v.name]![t]!.noise, 0.5));
      expect(out.chamonix!.noon!.abs).toBeGreaterThan(2 * out.chamonix!.noon!.noise);
    } finally {
      app.close();
    }
  },
  15 * 60_000,
);
