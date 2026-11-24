import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { type BridgeView, gpuTimes, passesJs, sceneStats, showView, widestRoad } from "./lib/bridge-views";

// The Paris bridge and street views' GPU cost, pass by pass (perf lot of 24 Nov 2026 — Sam: « qualité, high-detail et performance,
// pas de défauts »): the views of bridges.e2e that cost 70–76 ms on kerr-mini (Pont de Grenelle, Pont Alexandre III, rue de Rivoli
// wet), each placed by lib/bridge-views.ts (the scene about the place, its data, its street cells, its compiles), then held: the render
// scale pinned (__bh.forceScale, PRC_SCALE — 0.75 by default, the raster's motion scale), every frame touched (a realtime frame, not
// the held view's refinement), the GPU profiler on every frame, 40 profiled frames: each pass's median (gpuprof labels), the frame's
// summed passes, the completion interval (renderer.lastGpuMs, p50/p95 over 90 frames — bridges.e2e's measure, at the game's own
// scale and at the pinned one). Run by scripts/ab-e2e.ts (AB_SIDE, AB_RUN name the results) for an A B B A between two commits; alone
// it is one side. PRC_LEVER=<page JS>: run before each view's measure (an in-page lever — a renderer flag —, the same commit).
// PRC_VIEWS=key,key: some views only. Shots per view at the pinned scale: <OUT>/<side><run>-<key>.png.
// Earth data: the e2e disk cache (Paris = IGN; one IGN-heavy job at a time across the lab).
// Duration: ~5 min on kerr-mini a side.
// Done when: each view measured with ≥ 20 profiled frames, its scene ready, no GPU error.

const OUT = process.env.PRC_OUT ?? process.env.AB_OUT ?? "remote-results/paris-routes-cost";
const SIDE = `${process.env.AB_SIDE ?? "X"}${process.env.AB_RUN ?? ""}`;
const SCALE = Number(process.env.PRC_SCALE ?? 0.75);
const LEVER = process.env.PRC_LEVER ?? "";
// (an in-page A/B of a lever, same commit: PRC_AB_OFF / PRC_AB_ON — the page's JS for each side; each view measured off, on, on, off,
// then each side shot and the two shots compared pixel by pixel)
const AB_OFF = process.env.PRC_AB_OFF ?? "";
const AB_ON = process.env.PRC_AB_ON ?? "";
// (cuts for attribution — PRC_ABLATE="name=js;…" —, PRC_ABLATE_RESET the JS putting every cut back)
const ABLATE = (process.env.PRC_ABLATE ?? "")
  .split(";")
  .filter((s) => s.includes("="))
  .map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)] as const);
const ABLATE_RESET = process.env.PRC_ABLATE_RESET ?? "";

const ALL: (BridgeView & { label: string })[] = [
  {
    key: "grenelle",
    label: "Paris — Pont de Grenelle from over the Seine",
    at: [48.8484, 2.2771],
    aglM: 12,
    look: [48.8503, 2.28],
    lookAglM: 8,
    holds: "sc.cellBridges > 0",
  },
  {
    key: "alexandre-iii",
    label: "Paris — Pont Alexandre III from over the Seine",
    at: [48.8636, 2.3152],
    aglM: 7,
    look: [48.8638, 2.3136],
    lookAglM: 5,
    holds: "sc.cellBridges > 0",
  },
  {
    key: "rivoli-dry",
    label: "Paris — rue de Rivoli at a bus driver's eyes, dry",
    at: [48.8628, 2.3365],
    aglM: 60,
    look: [48.8638, 2.333],
    holds: "sc.cellRoads > 0",
  },
  {
    key: "rivoli-rain",
    label: "Paris — rue de Rivoli at a bus driver's eyes, in the rain",
    at: [48.8628, 2.3365],
    aglM: 60,
    look: [48.8638, 2.333],
    holds: "sc.cellRoads > 0",
    weather: "rain",
  },
];
const only = process.env.PRC_VIEWS?.split(",");
const VIEWS = only ? ALL.filter((v) => only.includes(v.key)) : ALL;

/** two shots compared in the page: the mean absolute difference over RGB [0–255], the share of pixels apart by more than 8 and 24, and
 *  the difference ×4 as a PNG (base64) */
async function diffShots(app: App, a: string, b: string, out: string) {
  const b64 = async (f: string) => Buffer.from(await Bun.file(f).arrayBuffer()).toString("base64");
  const r = await app.js<{ mean: number; over8: number; over24: number; png: string }>(`(async () => {
    const load = async (s) => createImageBitmap(await (await fetch("data:image/png;base64," + s)).blob());
    const A = await load(${JSON.stringify(await b64(a))}), B = await load(${JSON.stringify(await b64(b))});
    const W = A.width, H = A.height, read = (im) => { const c = new OffscreenCanvas(W, H), x = c.getContext("2d"); x.drawImage(im, 0, 0); return x.getImageData(0, 0, W, H).data; };
    const pa = read(A), pb = read(B), d = new Uint8ClampedArray(pa.length);
    let sum = 0, o8 = 0, o24 = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const e = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      sum += (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])) / 3;
      if (e > 8) o8++; if (e > 24) o24++;
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, 4 * e); d[i + 3] = 255;
    }
    const c = new OffscreenCanvas(W, H); c.getContext("2d").putImageData(new ImageData(d, W, H), 0, 0);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const n = pa.length / 4;
    return { mean: +(sum / n).toFixed(3), over8: +(o8 / n).toFixed(5), over24: +(o24 / n).toFixed(5), png: btoa(s) };
  })()`);
  await Bun.write(out, Buffer.from(r.png, "base64"));
  return { mean: r.mean, over8: r.over8, over24: r.over24, heat: out };
}

describe.skipIf(!E2E)("Paris bridges and streets: the GPU's cost pass by pass", () => {
  let app: App;
  const results: Record<string, unknown>[] = [];

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: true });
    app.steps(VIEWS.map((v) => v.label));
    app.estimate(VIEWS.length * (60 + ABLATE.length * 40 + (AB_ON ? 150 : 0)));
  }, 180_000);

  afterAll(async () => {
    await Bun.write(`${OUT}/prc-${SIDE}.json`, JSON.stringify({ side: SIDE, scale: SCALE, lever: LEVER, results }, null, 1));
    app?.close();
    stopServer();
  });

  let street: { at: [number, number]; look: [number, number] } | null = null;
  for (const v of VIEWS)
    test(
      v.label,
      async () => {
        await app.step(v.label);
        let view = await showView(app, v);
        if (v.key.startsWith("rivoli")) {
          // (the street itself, as bridges.e2e: the widest road within 120 m along 115°, the camera on its axis 2.5 m up, 70 m along it)
          if (!street) {
            const road = await widestRoad(app, v.at, 120, 115);
            if (road) {
              const lenM = Math.hypot(
                (road.b[0] - road.a[0]) * 111132,
                (road.b[1] - road.a[1]) * 111320 * Math.cos((road.a[0] * Math.PI) / 180),
              );
              const k = 70 / Math.max(lenM, 1);
              street = { at: road.a, look: [road.a[0] + (road.b[0] - road.a[0]) * k, road.a[1] + (road.b[1] - road.a[1]) * k] };
            }
            console.log(`  the street: ${JSON.stringify(street)}`);
          }
          if (street) view = await showView(app, { ...v, at: street.at, aglM: 2.5, look: street.look, lookAglM: 0 });
          await app.js(`(() => { __bh.settings.weather = ${JSON.stringify(v.weather ?? "fair")}; __bh.touch(); return 1; })()`);
          await app.settled(60_000);
          await Bun.sleep(1500);
        }
        // (bridges.e2e's measure first: the game's own scale)
        const game = await gpuTimes(app);
        if (LEVER) await app.js(`(() => { ${LEVER}; __bh.touch(); return 1; })()`);
        await app.js(`(() => { __bh.forceScale(${SCALE}); __bh.touch(); return 1; })()`);
        await app.settled(60_000);
        await Bun.sleep(2000);
        const pinned = await gpuTimes(app);
        const prof = await app.js<{ frames: number; sum: number; passes: Record<string, number>; w: number; h: number }>(passesJs(40));
        const sc = await sceneStats(app);
        // (the scene's surface records — trace.wgsl scenerySurface walks them at each ground pixel —: lines, polygons by kind, the largest
        // polygons by edges, and the water tree's records)
        const surfaces = await app.js<Record<string, unknown>>(`(() => {
          const c = __bh.renderer.earthScenery.contact; if (!c) return null;
          const f = c.f, start = f[4] * 4, count = f[5], geom = f[6];
          let lines = 0; const poly = {}, big = [];
          for (let i = 0; i < count; i++) { const n = start + i * 8, leaf = f[n + 7]; if (leaf < 0) continue; const b = (geom + leaf) * 4;
            if (f[b + 11] < 0.5) { lines++; continue; }
            const kind = f[b + 3], edges = f[b + 2]; const k = poly[kind] ??= { n: 0, edges: 0 }; k.n++; k.edges += edges;
            big.push({ kind, edges, w: Math.round(f[b + 6] - f[b + 4]), h: Math.round(f[b + 7] - f[b + 5]) }); }
          big.sort((a, b) => b.edges - a.edges);
          return { lines, polygons: poly, largest: big.slice(0, 8), waterNodes: f[10] };
        })()`);
        console.log(`  ${v.key} surfaces: ${JSON.stringify(surfaces)}`);
        await app.shot(`${OUT}/${SIDE}-${v.key}.png`);
        let lever: Record<string, unknown> | null = null;
        if (AB_ON && AB_OFF) {
          type Prof = { frames: number; sum: number; passes: Record<string, number> };
          const runs: { on: boolean; gpu: Awaited<ReturnType<typeof gpuTimes>>; prof: Prof }[] = [];
          const side = async (on: boolean) => {
            await app.js(`(() => { ${on ? AB_ON : AB_OFF}; __bh.touch(); return 1; })()`);
            await app.settled(60_000);
            await Bun.sleep(1500);
            runs.push({ on, gpu: await gpuTimes(app), prof: await app.js<Prof>(passesJs(30)) });
          };
          for (const on of [false, true, true, false, false, true]) await side(on);
          const shotOf = async (on: boolean, name: string) => {
            await app.js(`(() => { ${on ? AB_ON : AB_OFF}; __bh.touch(); return 1; })()`);
            await app.settled(60_000);
            await Bun.sleep(2500);
            const f = `${OUT}/${SIDE}-${v.key}-${name}.png`;
            await app.shot(f);
            return f;
          };
          const off1 = await shotOf(false, "off"),
            on1 = await shotOf(true, "on"),
            off2 = await shotOf(false, "off2");
          const aa = await diffShots(app, off1, off2, `${OUT}/${SIDE}-${v.key}-diff-aa.png`);
          const ab = await diffShots(app, off1, on1, `${OUT}/${SIDE}-${v.key}-diff-ab.png`);
          const mean = (on: boolean, f: (r: (typeof runs)[number]) => number) => {
            const x = runs.filter((r) => r.on === on).map(f);
            return +(x.reduce((s, y) => s + y, 0) / x.length).toFixed(3);
          };
          const labels = [...new Set(runs.flatMap((r) => Object.keys(r.prof.passes)))];
          const passes: Record<string, { off: number; on: number }> = {};
          for (const l of labels)
            passes[l] = { off: mean(false, (r) => r.prof.passes[l] ?? 0), on: mean(true, (r) => r.prof.passes[l] ?? 0) };
          lever = {
            gpuP50: { off: mean(false, (r) => r.gpu.p50), on: mean(true, (r) => r.gpu.p50) },
            sum: { off: mean(false, (r) => r.prof.sum), on: mean(true, (r) => r.prof.sum) },
            passes,
            runs: runs.map((r) => ({ on: r.on, p50: r.gpu.p50, sum: +r.prof.sum.toFixed(2) })),
            diff: { aa, ab },
          };
          await app.js(`(() => { ${AB_OFF}; __bh.touch(); return 1; })()`);
          console.log(
            `  ${SIDE} ${v.key} lever: GPU p50 off ${JSON.stringify(lever.gpuP50)} (runs ${JSON.stringify(lever.runs)}); image A/A ${aa.mean} (${aa.over8} > 8), off/on ${ab.mean} (${ab.over8} > 8, ${ab.over24} > 24)`,
          );
        }
        // (attribution only — PRC_ABLATE="name=js;name=js": each cut measured against the base around it, base cut base …, no shot)
        const ablations: Record<
          string,
          { base: number; cut: number; delta: number; sumBase: number; sumCut: number; passes: Record<string, number> }
        > = {};
        if (ABLATE.length) {
          const one = async () => {
            const gpu = await gpuTimes(app);
            const pr = await app.js<{ sum: number; passes: Record<string, number> }>(passesJs(16));
            return { gpu, sum: pr.sum, passes: pr.passes };
          };
          const reset = `${ABLATE_RESET}; __bh.touch()`;
          for (const [name, js] of ABLATE) {
            type One = { gpu: number; sum: number; passes: Record<string, number> };
            const base: One[] = [],
              cut: One[] = [];
            for (const on of [false, true, true, false]) {
              await app.js(`(() => { ${reset}; ${on ? js : ""}; __bh.touch(); return 1; })()`);
              await Bun.sleep(800);
              const r = await one();
              (on ? cut : base).push({ gpu: r.gpu.p50, sum: r.sum, passes: r.passes });
            }
            await app.js(`(() => { ${reset}; return 1; })()`);
            const avg = (x: One[], k: "gpu" | "sum") => +(x.reduce((s, y) => s + y[k], 0) / x.length).toFixed(2);
            // (each pass's change, cut less base — the compute passes' are attributable, the render passes' overlap on Apple)
            const passes: Record<string, number> = {};
            for (const l of new Set([...base, ...cut].flatMap((r) => Object.keys(r.passes)))) {
              const m = (x: One[]) => x.reduce((s, y) => s + (y.passes[l] ?? 0), 0) / x.length;
              const d = +(m(cut) - m(base)).toFixed(2);
              if (Math.abs(d) >= 0.1) passes[l] = d;
            }
            ablations[name] = {
              base: avg(base, "gpu"),
              cut: avg(cut, "gpu"),
              delta: +(avg(cut, "gpu") - avg(base, "gpu")).toFixed(2),
              sumBase: avg(base, "sum"),
              sumCut: avg(cut, "sum"),
              passes,
            };
            console.log(
              `  ${SIDE} ${v.key} cut ${name}: GPU p50 ${ablations[name].base} → ${ablations[name].cut} (${ablations[name].delta} ms)`,
            );
          }
        }
        await app.js(`(() => { __bh.forceScale(null); return 1; })()`);
        const top = Object.entries(prof.passes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, ms]) => `${k} ${ms}`)
          .join(" · ");
        console.log(
          `  ${SIDE} ${v.key}: game p50 ${game.p50} / pinned p50 ${pinned.p50} p95 ${pinned.p95} ms, passes Σ ${prof.sum} ms (${prof.frames} frames, ${prof.w}×${prof.h}) — ${top}`,
        );
        results.push({ view: v.key, ...view, game, pinned, prof, lever, ablations, surfaces, ...sc });
        await app.stepDone(`${v.key}: épinglé p50 ${pinned.p50} ms · Σ passes ${prof.sum} ms`, view.ready);
        expect(view.ready, `${v.label}: the scene never held ${v.holds} (${JSON.stringify(sc)})`).toBe(true);
        expect(sc.gpuErrors).toBe(0);
        expect(prof.frames).toBeGreaterThanOrEqual(20);
      },
      360_000 + ABLATE.length * 60_000 + (AB_ON ? 240_000 : 0),
    );
});
