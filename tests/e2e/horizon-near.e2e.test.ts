import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { type Pixels, readPng, writePng } from "./lib/png";

// H3 — the near body's shadows read its horizon map (docs/PLAN-REFRACTION-HORIZONS.md; trace.wgsl nearShadow): its blockers
// from D_bake (~11 km on the Moon) out to the relief's reach, the long shadows of a low Sun past the march's 20 km, the share
// of the Sun's disc over them taken as the min with the march and the Sun's map; the Sun wholly under the map's horizon: in
// the shadow, the march skipped.
// Three views of the Moon, its finer maps in and their horizons baked, the time frozen, each shot with the map read and
// without it (renderer.liteSkip 524288 — the same session, the same tiles, the exposure held at the meter's reading), and each
// frame's GPU time (60 frames drawn anew):
//   1. the terminator from 500 km (the body raster: bodyLite → shadeNear), the Sun ~2° up at the image's centre;
//   2. the terminator from 4 000 km through an 8° lens (the traced near body: nearMarch → shadeNear);
//   3. the south pole on the ground, the Sun requested 1.5° up, outside the frame (the polar cap's map).
// HN_ONLY=name,name: other views (mercury-terminator, mercury-cine, ceres-terminator, mars-terminator: the worlds baked since H3).
// Output: remote-results/horizon-near/ — <view>-on.png, <view>-off.png (converged for the traced view; -rt: the realtime images), <view>-diff.png (red: darkened by the map, blue:
// brightened), side.png, horizon-near.json.
// Done when: the bake is in within 90 s, no GPU error, in each view the map brightens no more than twice the captures' own
// noise (a second shot without it) or 0.2 %, adds no stipple (the lit pixels' high frequencies within 10 % of the march's
// alone), and darkens ≥ 0.05 % in at least one of the terminator views.
// Duration: ~3 min (cold shaders can add a minute; 3 lunar views, 60 realtime frames per state, traced shots at convergence).
const OUT = process.env.AB_OUT ?? process.env.HN_OUT ?? "remote-results/horizon-near";
afterAll(stopServer);

const HOLDS = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, ship: false });`;
const made = (name: string, base: string, patch: string) =>
  `__bh.presets[${JSON.stringify(name)}] = { ...__bh.presets[${JSON.stringify(base)}], ship: false, ${patch} }; __bh.game.preset(${JSON.stringify(name)}); ${HOLDS} __bh.touch();`;
const ALL_VIEWS = [
  {
    name: "terminator-500km",
    map: "moon",
    terminator: true,
    set: made("H3: terminator 500 km", "Moon: Earthrise", `fov: 50, pose: { body: "moon", altKm: 500, phase: 88, look: "moon", tilt: 25 }`),
  },
  {
    name: "terminator-4000km-8deg",
    map: "moon",
    terminator: true,
    set: made(
      "H3: terminator 4000 km",
      "Moon: the half Moon from orbit",
      `fov: 8, pose: { body: "moon", altKm: 4000, phase: 86, look: "moon" }`,
    ),
  },
  {
    name: "south-pole",
    map: "moon",
    terminator: false,
    set: made(
      "H3: south pole",
      "Moon: Earthrise",
      `fov: 60, pose: { body: "moon", at: [-88.5, 0], sunEl: 1.5, look: "sun", off: [90, -20] }`,
    ),
  },
  // (HN_ONLY: the other worlds baked since H3 — decision 37 —, their terminators from orbit, the plan's Mercury ciné)
  {
    name: "mercury-terminator",
    map: "mercury",
    terminator: true,
    set: made(
      "H3: Mercury terminator",
      "Mars: from orbit",
      `target: "mercury", fov: 50, pose: { body: "mercury", altKm: 700, phase: 88, look: "mercury", tilt: 25 }`,
    ),
  },
  {
    name: "mercury-cine",
    map: "mercury",
    terminator: false,
    set: made("H3: Mercury plains", "Mercury: the cratered plains", `ship: false`),
  },
  {
    name: "ceres-terminator",
    map: "ceres",
    terminator: true,
    set: made(
      "H3: Ceres terminator",
      "Mars: from orbit",
      `target: "ceres", fov: 50, pose: { body: "ceres", altKm: 200, phase: 88, look: "ceres", tilt: 25 }`,
    ),
  },
  {
    name: "mars-terminator",
    map: "mars",
    terminator: true,
    set: made("H3: Mars terminator", "Mars: from orbit", `fov: 50, pose: { body: "mars", altKm: 1500, phase: 88, look: "mars", tilt: 25 }`),
  },
];
const ONLY = process.env.HN_ONLY?.split(",");
const VIEWS = ALL_VIEWS.filter((v) => (ONLY ? ONLY.includes(v.name) : v.map === "moon"));

test.skipIf(!E2E)(
  "H3: near shadows read their horizon maps — long shadows of a low Sun, nothing brightened",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: `scene=${encodeURIComponent("Moon: the half Moon from orbit")}` });
    const out: Record<string, unknown> = {};
    // Keep the realtime path active for 60 completed frames, including on traced views.
    const still = () =>
      app.js<boolean>(`(async () => { const r = __bh.renderer, f0 = r.completedFrames, t0 = performance.now();
        while (r.completedFrames - f0 < 60 && performance.now() - t0 < 20000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
        if (r.completedFrames - f0 < 60) throw new Error('H3: fewer than 60 realtime frames in 20 s');
        return r.completedFrames - f0 >= 60; })()`);
    const converged = () => app.waitFor(`__bh.renderer.lastPhase === "converged"`, 30_000);
    const timed = () =>
      app.js<{ median: number; p95: number }>(`(async () => { const r = __bh.renderer;
        const f0 = r.completedFrames, t0 = performance.now();
        while (r.completedFrames - f0 < 60 && performance.now() - t0 < 20000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
        if (r.completedFrames - f0 < 60) throw new Error('H3: fewer than 60 timed frames in 20 s');
        const d = [...r.completedDurations].slice(-60).sort((a, b) => a - b);
        return { median: +d[30].toFixed(2), p95: +d[56].toFixed(2) }; })()`);
    try {
      for (const v of VIEWS) {
        const t0 = Date.now();
        const meterBefore = await app.js<number>(`__bh.renderer.meterAt`);
        await app.js(`(() => { __bh.renderer.liteSkip = 0; ${v.set} return 1; })()`);
        await app.settled();
        const hd = await app.waitFor(`__bh.renderer.hdMap.name === "${v.map}" && __bh.renderer.hdMap.mode === "full"`, 60_000).then(
          () => true,
          () => false,
        );
        if (!hd) throw new Error(`${v.name}: the ${v.map}'s finer maps not in within 60 s (${await app.js(`__bh.renderer.hdMap.name`)})`);
        const baked = await app.waitFor(`__bh.renderer.horizonRow[0] === 1`, 90_000).then(
          () => true,
          () => false,
        );
        const bake = await app.js(
          `(() => { const s = __bh.renderer.horizonMaps.stats(); return { state: s.state, doneMs: s.doneMs }; })()`,
        );
        if (!baked) throw new Error(`${v.name}: the bake not in within 90 s: ${JSON.stringify(bake)}`);
        const ready = +((Date.now() - t0) / 1000).toFixed(1);
        const raster = await app.js<boolean>(`__bh.renderer.bodyRasterNow`);
        // (the exposure held at the meter's reading, the map on: else the meter lifts a darker image — the lit pixels then
        // "brightened" by a map that only darkens. Held as the auto exposure's own value, frame by frame — not the manual
        // exposure: with the auto exposure off, the sky is drawn at its physical scale, not the image's — its stars out by day)
        await app.waitFor(`__bh.renderer.meterAt > ${meterBefore} && __bh.renderer.meterSettled`, 15_000);
        const ev = await app.js<number>(
          `(() => { const r = __bh.renderer; const ev = r.autoExposureEV; window.__evHold = ev; const f = () => { if (window.__evHold == null) return; r.autoExposureEV = window.__evHold; requestAnimationFrame(f); }; requestAnimationFrame(f); return +r.ev(__bh.settings).toFixed(2); })()`,
        );
        // (each state: its realtime image after 60 frames — what a flight sees: the stipple's measure —, and the traced views'
        // converged one — the comparison's: a realtime image's noise follows its random draws, which the map's early exit
        // shifts; the raster's are the same image)
        // (the page's overlays hidden: a toast in one capture and not the other read as "brightened")
        const shots = async (tag: string) => {
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          await still();
          await app.shot(`${OUT}/${v.name}-${tag}-rt.png`);
          if (!raster) await converged();
          await app.shot(`${OUT}/${v.name}-${tag}.png`);
        };
        await shots("on");
        const onTime = await timed();
        await app.js(`(() => { __bh.renderer.liteSkip = 524288; __bh.touch(); return 1; })()`);
        await shots("off");
        const offTime = await timed();
        // (the same again: the noise from a capture to the next — the floor the comparison is judged against)
        await shots("off2");
        await app.js(`(() => { __bh.renderer.liteSkip = 0; window.__evHold = null; __bh.touch(); return 1; })()`);
        out[v.name] = { ready, bake, raster, ev, onMs: onTime.median, offMs: offTime.median, onP95: onTime.p95, offP95: offTime.p95 };
        console.log(`  ${v.name}: ${JSON.stringify(out[v.name])}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      if (out.gpuErrors) console.log(`  page errors: ${JSON.stringify(app.cdp.errors.slice(0, 5))}`);
    } finally {
      await app.close();
    }
    const load = async (n: string) => readPng(new Uint8Array(await Bun.file(`${OUT}/${n}.png`).arrayBuffer()));
    const lum = (p: Pixels, i: number) =>
      0.2126 * p.data[i * p.channels]! + 0.7152 * p.data[i * p.channels + 1]! + 0.0722 * p.data[i * p.channels + 2]!;
    const sides: Uint8Array[] = [];
    let W = 0,
      H = 0;
    // (x against y over y's lit pixels: darker by 20 %, brighter by 25 %; a diff image — red darkened, blue brightened)
    const compare = (x: Pixels, y: Pixels) => {
      const img = new Uint8Array(x.width * x.height * 3);
      let lit = 0,
        darker = 0,
        brighter = 0;
      for (let i = 0; i < x.width * x.height; i++) {
        const a = lum(x, i),
          b = lum(y, i);
        const g = Math.round(0.35 * b);
        img.set([g, g, g], i * 3);
        if (b < 12) continue;
        lit++;
        if (a < 0.8 * b) {
          darker++;
          img.set([255, Math.round(0.4 * a), Math.round(0.4 * a)], i * 3);
        } else if (a > 1.25 * b + 3) {
          brighter++;
          img.set([40, 90, 255], i * 3);
        }
      }
      return { img, lit, darker, brighter };
    };
    // (the high-frequency energy of the lit pixels — their difference to the mean of their 3 × 3: the stipple)
    const hf = (x: Pixels) => {
      let e = 0,
        n = 0;
      for (let y = 1; y < x.height - 1; y++)
        for (let xx = 1; xx < x.width - 1; xx++) {
          const c = lum(x, y * x.width + xx);
          if (c < 20) continue;
          let m = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m += lum(x, (y + dy) * x.width + xx + dx);
          e += Math.abs(c - m / 9);
          n++;
        }
      return +(e / Math.max(n, 1)).toFixed(2);
    };
    for (const v of VIEWS) {
      const on = await load(`${v.name}-on`),
        off = await load(`${v.name}-off`),
        off2 = await load(`${v.name}-off2`),
        onRt = await load(`${v.name}-on-rt`),
        offRt = await load(`${v.name}-off-rt`);
      W = on.width;
      H = on.height;
      const c = compare(on, off),
        noise = compare(off2, off);
      const img = c.img;
      writeFileSync(`${OUT}/${v.name}-diff.png`, writePng(W, H, img));
      const share = (n: number) => +(n / Math.max(c.lit, 1)).toFixed(5);
      Object.assign(out[v.name] as object, {
        lit: c.lit,
        darker: c.darker,
        brighter: c.brighter,
        darkerShare: share(c.darker),
        brighterShare: share(c.brighter),
        noiseDarkerShare: share(noise.darker),
        noiseBrighterShare: share(noise.brighter),
        hfOn: hf(onRt),
        hfOff: hf(offRt),
      });
      // (a row: off | on | diff, each halved)
      const w2 = W >> 1,
        h2 = H >> 1;
      const row = new Uint8Array(3 * w2 * h2 * 3);
      const put = (src: Uint8Array, ch: number, k: number) => {
        for (let y = 0; y < h2; y++)
          for (let x = 0; x < w2; x++) {
            const s = (2 * y * W + 2 * x) * ch,
              d = (y * 3 * w2 + k * w2 + x) * 3;
            row[d] = src[s]!;
            row[d + 1] = src[s + 1]!;
            row[d + 2] = src[s + 2]!;
          }
      };
      put(off.data, off.channels, 0);
      put(on.data, on.channels, 1);
      put(img, 3, 2);
      sides.push(row);
    }
    const side = new Uint8Array(sides.reduce((n, r) => n + r.length, 0));
    sides.reduce((o, r) => (side.set(r, o), o + r.length), 0);
    writeFileSync(`${OUT}/side.png`, writePng(3 * (W >> 1), (H >> 1) * sides.length, side));
    console.log(`  ${JSON.stringify(out)}`);
    writeFileSync(`${OUT}/horizon-near.json`, JSON.stringify(out, null, 2));
    expect(out.gpuErrors).toBe(0);
    // (the map only darkens: what it brightens is the captures' noise — judged against their floor)
    for (const v of VIEWS) {
      const o = out[v.name] as { brighterShare: number; noiseBrighterShare: number; hfOn: number; hfOff: number };
      expect(o.brighterShare).toBeLessThanOrEqual(Math.max(0.002, 2 * o.noiseBrighterShare));
      // (no stipple: the lit pixels' high frequencies within 10 % of the march's alone)
      expect(o.hfOn).toBeLessThanOrEqual(1.1 * o.hfOff + 0.2);
    }
    const terminators = VIEWS.filter((v) => v.terminator);
    if (terminators.length)
      expect(Math.max(...terminators.map((v) => (out[v.name] as { darkerShare: number }).darkerShare))).toBeGreaterThanOrEqual(0.0005);
  },
  480_000,
);
