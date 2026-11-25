import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { gpuTimes, sceneStats as stats, showView } from "./lib/bridge-views";
import { readPng } from "./lib/png";

// PLAN-PONT-ROUTES-AAA (review A1/A2, B3; 24 Nov 2026), beside bridges.e2e: what its six views cannot say. The Golden Gate from ~30 km over
// the sea through a 6° lens — two frames of the frozen world 0.5 s apart, their difference about the bridge against a one-pixel shift of
// the same frame (no shimmer: a cable's sparkle is that shift's order); a French motorway viaduct (Pont de Cheviré, Nantes) seen from
// 900 m, its crest over the Loire; and the decks themselves, read from the CPU's copy of the drawn scenery (earthScenery.contact) about
// the Pont de Grenelle (cut by the z 14 tile's edge at 48.85026° N), the Millau viaduct and the Golden Gate: each deck's drawn top (the
// highest deck slice) sampled every 1.5 m, its largest part — its length, across the edge —, then along its axis every 0.5 m — no step
// over 0.25 m, no hole —, the walker's support on the drawn top within 2 cm, its crest over the sea; then a driver's view along each
// deck, placed from those samples. Each view waits on its conditions (capped, said with the scene's state when not met), streetMissing
// 0, GPU p50/p95 over 90 images.
// (25 Nov 2026) Pont de Cheviré on its surveyed deck (the BD TOPO's Z, street cells' format 6): its crest ≥ 45 m over the sea, one
// continuous deck ≥ 1.4 km, no step over 25 cm on its axis; the Loire's bed under it levelled (no ridge over its water); the Golden
// Gate's main cables shaded round (the driver's view).
// Duration: ~7 min on kerr-mini (414 s on 24 Nov 2026, the Earth data on disk).
// Done when: the seven views shot with their GPU times, the shimmer and the five decks' profiles measured, no page error.

// (an A/B — scripts/ab-e2e.ts —: each side its own folder)
const OUT = `${process.env.BRIDGES_OUT ?? "remote-results/bridges-notable"}${process.env.AB_SIDE ? `-${process.env.AB_SIDE}` : ""}`;
const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));

/**
 * The decks in the CPU's copy of the drawn scenery about a place: each deck slice's top (DECK_PLANE leaves, the parapets — kind 3 — left
 * out) sampled on a grid of `step` m over a box [±hx east, ±hy north] about it; the steps between neighbours, the decks' connected parts
 * (joined under 0.25 m), whether the largest crosses a latitude, the walker's support on the plane at 24 points, the deck's centre/top.
 */
interface DeckProfile {
  points: number;
  steps25: number;
  maxStep: number;
  p99Step: number;
  stepsAt: [number, number, number][];
  parts: number;
  largest: number;
  largestSpansEdge: boolean | null;
  supportErrMaxM: number;
  supportChecked: number;
  supportWorstAt: [number, number] | null;
  supportWorstLeaves: unknown;
  /** the largest part's centre over the ellipsoid [m]; its highest top over the sea (the geoid) [m] */
  centreAltM: number;
  crestOverSeaM: number | null;
  axisSamples: number;
  axisSteps: number;
  axisMaxStep: number;
  axisGapM: number;
  axisStepsAt: [number, number, number, number][];
  axisStepLeaves: unknown;
  topMin: number;
  topMax: number;
  centre: [number, number];
  axisDeg: number;
  lenM: number;
  /** its extent across its axis [m] */
  widthM: number;
  slices: number;
  parapets: number;
}
const deckProfile = (app: App, at: [number, number], hx: number, hy: number, step: number, edgeLat: number | null) =>
  app.js<DeckProfile | { error: string }>(`(() => {
    const c = __bh.renderer.earthScenery.contact;
    if (!c) return { error: "no contact copy" };
    const f = c.f, fr = c.frame, D = Math.PI / 180;
    const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
    const cart = (lat, lon, h) => { const a = lat * D, b = lon * D, N = A / Math.sqrt(1 - E2 * Math.sin(a) ** 2);
      return [(N + h) * Math.cos(a) * Math.cos(b), (N + h) * Math.cos(a) * Math.sin(b), (N * (1 - E2) + h) * Math.sin(a)]; };
    const loc = (lat, lon) => c.local(cart(lat, lon, 0));
    const world = (p) => [0, 1, 2].map((i) => fr.origin[i] + fr.east[i] * p[0] + fr.north[i] * p[1] + fr.up[i] * p[2]);
    const geo = (x, y) => { const lat0 = ${at[0]}, lon0 = ${at[1]}; const o = loc(lat0, lon0);
      return [lat0 + (y - o[1]) / 111132, lon0 + (x - o[0]) / (111320 * Math.cos(lat0 * D))]; };
    const o = loc(${at[0]}, ${at[1]});
    const slices = new Set(), parapets = new Set();
    // (the deck's drawn top at a frame point: the highest deck slice there — DECK_PLANE leaves, parapets — kind 3 — left out —, what
    // is seen from above and driven on; -Infinity: none)
    const deckTop = (p) => { let t = -Infinity;
      c.visit(p, 0, false, (b) => {
        if (f[b + 11] !== -1 || !c.polygon(p, b)) return;
        if (f[b + 3] === 3) { parapets.add(b); return; }
        slices.add(b);
        t = Math.max(t, c.topAt(b, p[0], p[1]));
      });
      return t; };
    // (a frame point's height over the ellipsoid: its ECEF position, Bowring's latitude)
    const altOf = (p) => { const [X, Y, Z] = world(p), r = Math.hypot(X, Y), B = A * (1 - F), ep2 = (A * A - B * B) / (B * B);
      const th = Math.atan2(Z * A, r * B), lat = Math.atan2(Z + ep2 * B * Math.sin(th) ** 3, r - E2 * A * Math.cos(th) ** 3);
      const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2); return r / Math.cos(lat) - N; };
    const nx = Math.round(${2 * hx} / ${step}) + 1, ny = Math.round(${2 * hy} / ${step}) + 1;
    const top = new Float32Array(nx * ny).fill(NaN);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const p = [o[0] - ${hx} + i * ${step}, o[1] - ${hy} + j * ${step}, 0];
      const t = deckTop(p);
      if (t > -Infinity) top[j * nx + i] = t;
    }
    let points = 0, steps25 = 0, maxStep = 0; const ds = [], stepsAt = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = top[j * nx + i]; if (Number.isNaN(v)) continue; points++;
      for (const [a, b] of [[i + 1, j], [i, j + 1]]) {
        if (a >= nx || b >= ny) continue; const w = top[b * nx + a]; if (Number.isNaN(w)) continue;
        const d = Math.abs(w - v); ds.push(d); maxStep = Math.max(maxStep, d);
        if (d > 0.25) { steps25++; if (stepsAt.length < 12) { const g = geo(o[0] - ${hx} + i * ${step}, o[1] - ${hy} + j * ${step}); stepsAt.push([+g[0].toFixed(6), +g[1].toFixed(6), +d.toFixed(2)]); } }
      }
    }
    ds.sort((a, b) => a - b);
    // (the decks' parts: neighbours joined under 0.25 m)
    const part = new Int32Array(nx * ny).fill(-1); const sizes = []; let largestK = -1;
    for (let s = 0; s < nx * ny; s++) {
      if (Number.isNaN(top[s]) || part[s] >= 0) continue;
      const k = sizes.length; let n = 0; const st = [s]; part[s] = k;
      while (st.length) { const q = st.pop(); n++; const i = q % nx, j = (q - i) / nx;
        for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const r = b * nx + a;
          if (part[r] >= 0 || Number.isNaN(top[r]) || Math.abs(top[r] - top[q]) > 0.25) continue; part[r] = k; st.push(r); } }
      sizes.push(n); if (largestK < 0 || n > sizes[largestK]) largestK = k;
    }
    // (the largest part: its extent, its axis — principal direction —, its centre, whether it crosses the edge's latitude)
    let sx = 0, sy = 0, sz = 0, n = 0, zmin = Infinity, zmax = -Infinity, north = false, south = false, topAt = null;
    const edgeY = ${edgeLat === null ? "null" : `loc(${edgeLat}, ${at[1]})[1]`};
    const pts = [];
    for (let s = 0; s < nx * ny; s++) if (part[s] === largestK) {
      const i = s % nx, j = (s - i) / nx, x = o[0] - ${hx} + i * ${step}, y = o[1] - ${hy} + j * ${step};
      sx += x; sy += y; sz += top[s]; n++; zmin = Math.min(zmin, top[s]); pts.push([x, y]);
      if (top[s] > zmax) { zmax = top[s]; topAt = [x, y, top[s]]; }
      if (edgeY !== null) { if (y > edgeY + 3) north = true; if (y < edgeY - 3) south = true; }
    }
    const mx = sx / n, my = sy / n; let cxx = 0, cyy = 0, cxy = 0;
    for (const [x, y] of pts) { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); }
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy); const ux = Math.cos(ang), uy = Math.sin(ang);
    let lo = Infinity, hi = -Infinity; for (const [x, y] of pts) { const t = (x - mx) * ux + (y - my) * uy; lo = Math.min(lo, t); hi = Math.max(hi, t); }
    let wlo = Infinity, whi = -Infinity; for (const [x, y] of pts) { const v = -(x - mx) * uy + (y - my) * ux; wlo = Math.min(wlo, v); whi = Math.max(whi, v); }
    // (along the largest part's axis — the driving line and 3 m either side of it —, every 0.5 m: the deck's top, its steps over
    // 0.25 m, its holes — a stretch with no deck: a slice missing, a deck cut at a tile's edge —; a car's wheel feels these)
    // (the deck's own centre line — a curved deck, Millau's 20 km radius, leaves a straight line —: every 10 m along the axis, the run of
    // deck across it [±60 m, 1 m] nearest the last centre, its middle; in between, interpolated)
    const centres = [];
    let lastU = 0;
    for (let t = lo; t <= hi; t += 10) {
      const runs = []; let cur = null;
      for (let u = -60; u <= 60; u += 1) {
        const hit = deckTop([mx + ux * t - uy * u, my + uy * t + ux * u, 0]) > -Infinity;
        if (hit) { if (!cur) { cur = [u, u]; runs.push(cur); } else cur[1] = u; } else cur = null;
      }
      if (!runs.length) { centres.push([t, lastU]); continue; }
      let best = runs[0]; for (const r of runs) if (Math.abs((r[0] + r[1]) / 2 - lastU) < Math.abs((best[0] + best[1]) / 2 - lastU)) best = r;
      lastU = (best[0] + best[1]) / 2; centres.push([t, lastU]);
    }
    const uAt = (t) => { let k = Math.min(centres.length - 2, Math.max(0, Math.floor((t - lo) / 10))); if (k < 0) return 0;
      const [t0, u0] = centres[k], [t1, u1] = centres[k + 1] ?? centres[k]; return t1 > t0 ? u0 + ((t - t0) / (t1 - t0)) * (u1 - u0) : u0; };
    const onLine = (t, off) => { const u = uAt(t) + off; return [mx + ux * t - uy * u, my + uy * t + ux * u]; };
    // (along that line — the driving line and 3 m either side of it —, every 0.5 m: the deck's top, its steps over 0.25 m, its holes — a
    // stretch with no deck: a slice missing, a deck cut at a tile's edge —; a car's wheel feels these)
    // (the leaves under a point: their kind, box, top there, plane or not — what holds the walker when its support is off the deck's)
    const leavesAt = (x, y) => { const out = [];
      c.visit([x, y, 0], 0.05, false, (b) => { if (!c.polygon([x, y, 0], b, 0.05)) return;
        out.push({ kind: f[b + 3], bottom: +f[b].toFixed(2), boxTop: +f[b + 1].toFixed(2), top: +c.topAt(b, x, y).toFixed(2), plane: f[b + 11] === -1, n: f[b + 2] }); });
      return out; };
    let axisSteps = 0, axisMaxStep = 0, axisGapM = 0, axisSamples = 0, axisStepLeaves = null; const axisStepsAt = [];
    for (const off of [-3, 0, 3]) {
      let prev = null, gap = 0;
      for (let t = lo + 2; t <= hi - 2; t += 0.5) {
        const [x, y] = onLine(t, off), z = deckTop([x, y, 0]);
        // (a step between neighbouring samples only — across a hole the hole's, axisGapM: 25 Nov 2026, a 0.41 m « step » was a slope over 67 m)
        if (z === -Infinity) { gap += 0.5; axisGapM = Math.max(axisGapM, gap); prev = null; continue; }
        gap = 0; axisSamples++;
        if (prev !== null) { const d = Math.abs(z - prev); axisMaxStep = Math.max(axisMaxStep, d);
          if (d > 0.25 && !axisStepLeaves) { const [px, py] = onLine(t - 0.5, off); axisStepLeaves = { before: leavesAt(px, py), at: leavesAt(x, y) }; }
          if (d > 0.25) { axisSteps++; if (axisStepsAt.length < 12) { const g = geo(x, y); axisStepsAt.push([+g[0].toFixed(6), +g[1].toFixed(6), off, +d.toFixed(2)]); } } }
        prev = z;
      }
    }
    // (the walker on the deck: a capsule of 5 cm set 0.10 m over the drawn top at 24 points of the line — its support -0.10 m)
    let err = 0, checked = 0, worst = null, worstLeaves = null;
    for (let k = 0; k < 24; k++) {
      const t = lo + 2 + ((k + 0.5) / 24) * (hi - lo - 4), [x, y] = onLine(t, 0), z = deckTop([x, y, 0]);
      if (z === -Infinity) continue;
      const r = c.at(world([x, y, z + 0.1]), 0.05, 1.8, 0.25);
      if (r.blocked) continue;
      const e = Math.abs(r.support + 0.1); checked++;
      if (e > err) { err = e; const g = geo(x, y); worst = [+g[0].toFixed(6), +g[1].toFixed(6)]; worstLeaves = { deckTop: +z.toFixed(2), leaves: leavesAt(x, y) }; }
    }
    const g = geo(mx, my);
    return { points, steps25, maxStep: +maxStep.toFixed(3), p99Step: +(ds[Math.floor(0.99 * ds.length)] ?? 0).toFixed(3), stepsAt,
      parts: sizes.filter((s) => s > 40).length, largest: n, largestSpansEdge: edgeY === null ? null : north && south,
      supportErrMaxM: +err.toFixed(4), supportChecked: checked, supportWorstAt: worst, supportWorstLeaves: worstLeaves, topMin: +zmin.toFixed(2), topMax: +zmax.toFixed(2),
      centre: [+g[0].toFixed(6), +g[1].toFixed(6)], centreAltM: +altOf([mx, my, sz / n]).toFixed(2),
      crestOverSeaM: topAt ? +(altOf(topAt) - __bh.sys.geoid(...geo(topAt[0], topAt[1]))).toFixed(1) : null, axisDeg: +(90 - ang / D).toFixed(1),
      lenM: Math.round(hi - lo), widthM: Math.round(whi - wlo), axisSamples, axisSteps, axisMaxStep: +axisMaxStep.toFixed(3), axisGapM, axisStepsAt, axisStepLeaves,
      slices: slices.size, parapets: parapets.size };
  })()`);

/** a point d metres from (lat, lon) along a heading [° from the north] */
const offset = (p: [number, number], headingDeg: number, d: number): [number, number] => {
  const h = (headingDeg * Math.PI) / 180;
  return [p[0] + (d * Math.cos(h)) / 111132, p[1] + (d * Math.sin(h)) / (111320 * Math.cos((p[0] * Math.PI) / 180))];
};

/** (minLenM: the deck's largest part at least this long within the box; crestOverSeaM: its highest top at least this over the sea) */
const DECKS: {
  key: string;
  label: string;
  at: [number, number];
  aglM: number;
  hx: number;
  hy: number;
  edge: number | null;
  minLenM: number;
  crestOverSeaM?: number;
}[] = [
  {
    key: "grenelle",
    label: "Paris — Pont de Grenelle's deck across the z 14 tile's edge (48.85026° N): one deck, no step on its axis, contact on it",
    at: [48.8502, 2.2806],
    aglM: 150,
    hx: 220,
    hy: 220,
    edge: 48.85026,
    minLenM: 150,
  },
  {
    // (its classification — monumental_alexandre_iii: no pier in the Seine, its four pylons, its arch — rests on the data's deck: its
    // length 100–220 m, its width ≥ 10 m, its middle within 110 m of 48.8637 N, 2.3135 E — bridge-structures.ts)
    key: "alexandre-iii",
    label:
      "Paris — Pont Alexandre III's deck: whole, no step on its axis, contact on it (its length and width as the classifier reads them)",
    at: [48.8638, 2.3136],
    aglM: 150,
    hx: 160,
    hy: 160,
    edge: null,
    minLenM: 100,
  },
  {
    key: "millau",
    label: "Millau — the viaduct's deck: whole, no step on its axis, contact on it, its parapets",
    at: [44.08, 3.0224],
    aglM: 500,
    hx: 90,
    hy: 1320,
    edge: null,
    minLenM: 1800,
  },
  {
    key: "golden-gate",
    label: "San Francisco — the Golden Gate's deck: whole at its height (no low double), no step, contact on it",
    at: [37.8197, -122.4786],
    aglM: 300,
    hx: 120,
    hy: 1100,
    edge: null,
    // (its main span 1 280 m, its side spans 343 m each; the crest ~77 m over the sea — Wikipedia's 67 m clearance under a 7.6 m truss)
    minLenM: 1600,
    crestOverSeaM: 70,
  },
];

describe.skipIf(!E2E)("notable bridges, a motorway viaduct, the decks' contact, the cables' shimmer", () => {
  let app: App;
  const results: Record<string, unknown>[] = [];

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: true });
    app.steps([
      "Golden Gate from ~30 km, 6° lens: two frames 0.5 s apart",
      "Pont de Cheviré (Nantes): a motorway viaduct, its parapets",
      ...DECKS.map((d) => d.label),
    ]);
    app.estimate(480);
  }, 180_000);

  afterAll(async () => {
    console.log(`bridges-notable results: ${JSON.stringify(results, null, 1)}`);
    await Bun.write(`${OUT}/results.json`, JSON.stringify(results, null, 1));
    app?.close();
    stopServer();
  });

  test("the Golden Gate from ~30 km through a 6° lens: towers and cables seen, two frozen frames 0.5 s apart differ less than a 1-px shift", async () => {
    await app.step("Golden Gate from ~30 km, 6° lens: two frames 0.5 s apart");
    const w = await showView(app, {
      key: "gg-30km-tele",
      at: [37.62, -122.73],
      aglM: 450,
      look: [37.8197, -122.4786],
      lookAglM: 120,
      fov: 6,
      holds: "sc.notableBridges >= 1",
      // (a full scene there is ~110 s on kerr-mini — the Marin hills' forest —, made twice: the bridge in it from the first)
      dataMs: 60_000,
    });
    await app.exposureSettled();
    const gpu = await gpuTimes(app);
    const sc = await stats(app);
    const a = `${OUT}/gg-30km-a.png`,
      b = `${OUT}/gg-30km-b.png`;
    await app.shot(a);
    await app.js(
      `(async () => { const t0 = performance.now(); while (performance.now() - t0 < 500) { __bh.touch(); await new Promise((r) => requestAnimationFrame(r)); } return 1; })()`,
    );
    await app.shot(b);
    // (the bridge about the image's centre — aimed at its middle —: a box 30 % wide, 12 % high about it (the haze around left out); the
    // luminance's change frame to frame against the same frame shifted by one pixel — what a thin cable's sparkle from image to image
    // would be)
    const A = png(a),
      B = png(b);
    const lum = (p: typeof A, x: number, y: number) => {
      const i = (y * p.width + x) * p.channels;
      return 0.2126 * p.data[i]! + 0.7152 * p.data[i + 1]! + 0.0722 * p.data[i + 2]!;
    };
    const x0 = Math.round(A.width * 0.35),
      x1 = Math.round(A.width * 0.65),
      y0 = Math.round(A.height * 0.46),
      y1 = Math.round(A.height * 0.58);
    let dAB = 0,
      dShift = 0,
      n = 0,
      changedAB = 0,
      changedShift = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const la = lum(A, x, y),
          ab = Math.abs(la - lum(B, x, y)),
          sh = Math.abs(la - lum(A, x + 1, y));
        dAB += ab;
        dShift += sh;
        if (ab > 8) changedAB++;
        if (sh > 8) changedShift++;
        n++;
      }
    const shimmer = {
      meanAB: +(dAB / n).toFixed(3),
      meanShift1px: +(dShift / n).toFixed(3),
      changedAB: +((changedAB / n) * 100).toFixed(3),
      changedShift1px: +((changedShift / n) * 100).toFixed(3),
    };
    results.push({ view: "gg-30km", ...w, gpu, shimmer, ...sc, shots: [a, b] });
    await app.stepDone(`gg-30km: GPU p50 ${gpu.p50} p95 ${gpu.p95} ms · A/B ${shimmer.meanAB} vs 1 px ${shimmer.meanShift1px}`, w.ready);
    expect(w.ready, `the Golden Gate not in the scene (${JSON.stringify(sc)})`).toBe(true);
    expect(sc.streetMissing).toBe(0);
    expect(sc.gpuErrors).toBe(0);
    // (the positive witness: the shifted frame must differ, or the box holds no detail to judge — the bridge dim in the haze at 30 km:
    // 0.31 measured on 24 Nov 2026)
    expect(shimmer.meanShift1px).toBeGreaterThan(0.2);
    expect(shimmer.meanAB).toBeLessThan(0.5 * shimmer.meanShift1px);
  }, 300_000);

  test("Pont de Cheviré (Nantes): a motorway viaduct over the Loire — its deck, its parapets, its crest over the river", async () => {
    await app.step("Pont de Cheviré (Nantes): a motorway viaduct, its parapets");
    // (from 900 m east of its middle — Wikipedia's 47.1931 N, 1.6181 W —, 60 m over the ground, aimed at its deck)
    const w = await showView(app, {
      key: "chevire",
      at: [47.1931, -1.6062],
      aglM: 60,
      look: [47.1931, -1.6181],
      lookAglM: 40,
      holds: "sc.cellBridges > 0",
    });
    const gpu = await gpuTimes(app);
    const sc = await stats(app);
    // (the deck itself: its axis at 1.6138° W from 47.184 to 47.199° N, bending west to 1.6162° W at its north end — the BD TOPO's;
    // the box of campaign 2, about Wikipedia's point 330 m west of it, sampled another deck)
    const deck = await deckProfile(app, [47.1915, -1.6145], 220, 900, 2, null);
    console.log(`  chevire deck: ${JSON.stringify(deck)}`);
    const s = `${OUT}/chevire.png`;
    await app.shot(s);
    results.push({ view: "chevire", ...w, gpu, ...sc, deck, shots: [s] });
    const crest = "error" in deck ? null : deck.crestOverSeaM;
    await app.stepDone(
      `chevire: GPU p50 ${gpu.p50} p95 ${gpu.p95} ms · ponts ${sc.bridges} (cellules ${sc.cellBridges}) · crête ${crest} m sur la mer`,
      w.ready,
    );
    expect(w.ready, `no bridge from the street cells at Nantes (${JSON.stringify(sc)})`).toBe(true);
    expect(sc.streetMissing).toBe(0);
    expect(sc.gpuErrors).toBe(0);
    // (its clearance 52 m over the Loire — Wikipedia —: its deck's crest at least 45 m over the sea)
    expect(crest, `the Cheviré deck's crest over the sea (${JSON.stringify(deck)})`).toBeGreaterThan(45);
    // (25 Nov 2026: one continuous deck — its largest part the viaduct's length, ~1.68 km —, no step over 25 cm along its axis, no hole,
    // the walker on its drawn top; campaign 2: four pieces, steps of 1.5–11 m)
    const p = deck as DeckProfile;
    expect(p.lenM, `the Cheviré deck's largest part (${JSON.stringify(deck)})`).toBeGreaterThan(1400);
    // (its axis — the driving line — on the straight span where its two carriageways run side by side, 47.1845–47.1945° N: north of it they
    // part on the curve, and the box's centre line strays between them)
    // (25 Nov 2026 — water-flatten.ts: the Loire's bed levelled under its water; before, a 5.1 m ridge under the deck — 47.1920 N,
    // 1.6135 W — and 3–5 m spikes stood 3 m over its 2.3 m water: the light band. The relief across the river under the deck and 150 m
    // west of it, over the sea)
    const bed = await app.js<{ under: number[]; west: number[] }>(`(() => {
      const N = __bh.sys.geoid(47.1925, -1.6140), row = (lon) => [47.1920, 47.1925, 47.1930].map((lat) => +(__bh.sys.groundAt(lat, lon) - N).toFixed(2));
      return { under: row(-1.6135), west: row(-1.6155) };
    })()`);
    console.log(`  chevire bed over the sea: under the deck ${bed.under.join(" ")} · 150 m west ${bed.west.join(" ")}`);
    results.push({ view: "chevire-bed", bed });
    expect(Math.max(...bed.under), `the Loire's bed under the deck (${JSON.stringify(bed)})`).toBeLessThan(Math.max(...bed.west) + 1);
    const span = await deckProfile(app, [47.1895, -1.6136], 60, 550, 2, null);
    console.log(`  chevire span: ${JSON.stringify(span)}`);
    results.push({ view: "chevire-span", deck: span });
    const q = span as DeckProfile;
    expect(q.lenM, `the Cheviré span's deck (${JSON.stringify(span)})`).toBeGreaterThan(1000);
    expect(q.axisSteps, `steps over 25 cm on the Cheviré deck's axis at ${JSON.stringify(q.axisStepsAt)}`).toBe(0);
    expect(q.axisGapM).toBeLessThan(6);
    expect(q.supportErrMaxM).toBeLessThan(0.02);
  }, 300_000);

  for (const d of DECKS)
    test(d.label, async () => {
      await app.step(d.label);
      const w = await showView(app, {
        key: `deck-${d.key}`,
        at: d.at,
        aglM: d.aglM,
        look: offset(d.at, 90, 600),
        holds: d.key === "millau" || d.key === "golden-gate" ? "sc.notableBridges >= 1" : "sc.cellBridges > 0",
      });
      const prof = await deckProfile(app, d.at, d.hx, d.hy, 1.5, d.edge);
      console.log(`  ${d.key} deck: ${JSON.stringify(prof)}`);
      const shots: string[] = [];
      let gpu = { p50: 0, p95: 0, n: 0, fps: 0 };
      if (!("error" in prof) && prof.largest > 0) {
        // (a driver's view along the deck: on its axis 150 m before its middle, 6 m over its top, aimed 200 m past it — placed from the
        // samples; heights over the ellipsoid)
        const cam = offset(prof.centre, prof.axisDeg + 180, 150);
        const aim = offset(prof.centre, prof.axisDeg, 200);
        await showView(app, {
          key: `deck-${d.key}-low`,
          at: cam,
          altM: prof.centreAltM + 6,
          look: aim,
          lookAltM: prof.centreAltM + 1,
          holds: "sc.bridges + sc.notableBridges > 0",
        });
        gpu = await gpuTimes(app);
        const s = `${OUT}/${d.key}-deck-low.png`;
        await app.shot(s);
        shots.push(s);
      }
      const sc = await stats(app);
      results.push({ view: `deck-${d.key}`, ...w, gpu, ...sc, deck: prof, shots });
      const ok = !("error" in prof) && prof.axisSteps === 0 && prof.axisGapM < 6 && prof.supportErrMaxM < 0.02;
      await app.stepDone(
        "error" in prof
          ? `${d.key}: ${prof.error}`
          : `${d.key}: ${prof.lenM} m, axe : marches > 25 cm ${prof.axisSteps}, trou ${prof.axisGapM} m, contact ±${prof.supportErrMaxM} m, crête ${prof.crestOverSeaM} m · GPU p50 ${gpu.p50} p95 ${gpu.p95}`,
        ok,
      );
      expect("error" in prof ? prof.error : null).toBeNull();
      const p = prof as DeckProfile;
      expect(p.largest, `${d.key}: no deck sampled`).toBeGreaterThan(100);
      expect(p.lenM, `${d.key}: the deck's largest part shorter than the bridge`).toBeGreaterThan(d.minLenM);
      if (d.edge !== null) expect(p.largestSpansEdge, `${d.key}: the deck's largest part does not cross ${d.edge}° N`).toBe(true);
      // (along its axis: no step a wheel feels, no hole — the grid's steps between this deck and its neighbours, reported only)
      expect(p.axisSteps, `${d.key}: steps over 25 cm on the axis at ${JSON.stringify(p.axisStepsAt)}`).toBe(0);
      expect(p.axisGapM, `${d.key}: a stretch of the axis with no deck`).toBeLessThan(6);
      expect(p.supportChecked).toBeGreaterThan(10);
      expect(p.supportErrMaxM, `${d.key}: the walker's support off the drawn top at ${JSON.stringify(p.supportWorstAt)}`).toBeLessThan(
        0.02,
      );
      if (d.crestOverSeaM) expect(p.crestOverSeaM ?? 0, `${d.key}: the deck's crest over the sea`).toBeGreaterThan(d.crestOverSeaM);
      expect(sc.streetMissing).toBe(0);
      expect(sc.gpuErrors).toBe(0);
    }, 360_000);

  test("no page error over the views", () => {
    expect(app.cdp.errors).toEqual([]);
  });
});
