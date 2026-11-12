// PLAN-J2 J2-0 — the probes' measures, read in the page (docs/PLAN-J2-PAGES-RECONSTRUCTION.md §3, §4, §5): the leak between imagery
// pages (two sentinels compared), the seams between the raster's levels (C0-12), the sea's white points by reconstruction stage, the
// sharpness's dips at a change of scale. One definition read by tests/e2e/j2-probes.e2e.test.ts and by J2-3/J2-6 when they measure
// themselves against the J2-0 fiche (docs/progress/j2/).

/** the views of the leak and seam probes: low over the ground (grazing: each imagery level's window edge in the image, their
 *  coarser mips and the anisotropic filter's long footprints along it) — over France (the IGN's orthophotos z 15–18 and imagery) */
export const LEAK_VIEWS: Record<string, { what: string; at: [number, number, number, number, number]; date: string }> = {
  // (inland from Hyères, over the Gapeau's plain towards the Maures — J0's land: farms, vineyards, roads, villages; 300 m)
  "hyeres-low": {
    what: "plaine du Gapeau vers les Maures, 300 m sol, cap 20°",
    at: [43.12, 6.13, 300, 20, 140],
    date: "2026-07-10T10:00:00Z",
  },
  // (motion-quality's Alps: the Arve's valley and the glaciers, 2 500 m over the sea's level the flyAt's ground)
  alps: { what: "vallée de l'Arve vers l'est, 2 500 m sol, cap 110°", at: [45.85, 6.75, 2500, 110, 140], date: "2026-07-10T11:00:00Z" },
};

/** the two sentinels (8-bit sRGB): magenta and green — a leak is what changes between them, a magenta signature */
export const SENTINEL_A: [number, number, number] = [255, 0, 255];
export const SENTINEL_B: [number, number, number] = [0, 255, 0];

/**
 * In the page: the scene's colour kept under `globalThis.__j2[name]` (renderer.sceneColor: the radiance before the optics, its raw
 * data — pre-exposed only, the exposure left out: two reads compare whatever the meter did). Returns its size and source.
 */
export const keepSceneJs = (name: string) => `(async () => {
  const c = await __bh.renderer.sceneColor(__bh.settings);
  globalThis.__j2 ??= {}; globalThis.__j2[${JSON.stringify(name)}] = c;
  return { width: c.width, height: c.height, source: c.source, exposure: c.exposure }; })()`;

/**
 * In the page: the leak between two kept images (a: sentinel A, b: sentinel B, c: B again — the control, the two reads' noise):
 * per pixel the magenta signature of a − b, s = ½(ΔR + ΔB) − ΔG, against the pixel's luminance in b (× b's exposure, ≥ 0.01):
 * rel = s / L. A pixel whose page colour has a share f of sentinel shows rel ≈ 2 f / albedo (10–20 f for a ground of albedo
 * 0.1–0.2): rel > 0.1 is a leak of ~1 %, > 0.5 ~5 %, > 2 ~15 %. The control counts |s| / L of c − b the same way (both of the
 * same sentinel: the noise's false leaks). Pixels over twice the mid-grey in any read (lamps, glints, the sea's white points — their
 * colour changes between renders whatever the sentinel) are left out and counted (`bright`). Returns the counts, the leaking pixels' rows (where in the image), and a PNG (base64)
 * of the leak: grey the image (b's luminance), red the leak (rel 0.1 → 2), blue the bright points left out.
 */
export const leakCompareJs = (a: string, b: string, c: string) => `(async () => {
  const A = globalThis.__j2[${JSON.stringify(a)}], B = globalThis.__j2[${JSON.stringify(b)}], C = globalThis.__j2[${JSON.stringify(c)}];
  if (!A || !B || !C || A.width !== B.width || A.height !== B.height || C.width !== B.width) return { error: "sizes differ or a read is missing" };
  const W = B.width, H = B.height, e = B.exposure, a = A.data, b = B.data, c = C.data;
  const T = [0.1, 0.5, 2], n = [0, 0, 0], nc = [0, 0, 0], rows = new Array(10).fill(0);
  let ground = 0, maxRel = 0, bright = 0;
  const lum = (d, i) => e * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
  const img = new Uint8ClampedArray(W * H * 4);
  for (let i = 0, p = 0; p < W * H; p++, i += 4) {
    const L = Math.max(e * (0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]), 0.01);
    const s = e * (0.5 * ((a[i] - b[i]) + (a[i + 2] - b[i + 2])) - (a[i + 1] - b[i + 1]));
    const sc = e * Math.abs(0.5 * ((c[i] - b[i]) + (c[i + 2] - b[i + 2])) - (c[i + 1] - b[i + 1]));
    const rel = s / L, relc = sc / L;
    // (a point over twice the mid-grey in any of the three — a lamp, a glint, the sea's white points: its colour changes from one
    // render to the next whatever the sentinel — counted apart, not a leak)
    if (Math.max(lum(a, i), L, lum(c, i)) > 2) { bright++; img[i] = 0; img[i + 1] = 90; img[i + 2] = 255; img[i + 3] = 255; continue; }
    if (rel > maxRel) maxRel = rel;
    for (let k = 0; k < 3; k++) { if (rel > T[k]) n[k]++; if (relc > T[k]) nc[k]++; }
    if (rel > T[0]) rows[Math.min(9, Math.floor((10 * Math.floor(p / W)) / H))]++;
    const g = Math.round(255 * Math.min(1, L / (1 + L)));
    const k = Math.max(0, Math.min(1, (rel - 0.1) / 1.9));
    img[i] = rel > 0.1 ? Math.round(160 + 95 * k) : g; img[i + 1] = rel > 0.1 ? Math.round(g * 0.3) : g; img[i + 2] = rel > 0.1 ? Math.round(g * 0.3) : g; img[i + 3] = 255;
    if (b[i] + b[i + 1] + b[i + 2] > 0) ground++;
  }
  const cv = new OffscreenCanvas(W, H); cv.getContext("2d").putImageData(new ImageData(img, W, H), 0, 0);
  const blob = await cv.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = ""; for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { width: W, height: H, pixels: W * H, leak: { over0_1: n[0], over0_5: n[1], over2: n[2] }, control: { over0_1: nc[0], over0_5: nc[1], over2: nc[2] }, bright,
    maxRel: +maxRel.toFixed(3), leakRowsByTenth: rows, png: btoa(bin) }; })()`;

/**
 * In the page: the seams between the raster's levels (C0-12: ≤ 0.25 px in low flight) — the visibility's distance target
 * (terrainRaster.distanceTexture: r the ground's metres, g the scenery's instance, a the code × 2¹⁸ + the normal) read back; at each
 * pair of neighbour pixels of the ground (codes 1…56, terrain-raster-hint.ts RASTER_GROUND_LAST: the patch and its rings — not a
 * building's mesh, a box, a bridge, a cloud) drawn by two levels, each side's own slope a pixel along the same axis inside its
 * level, the distance's jump over that slope: `excess` = jump / slope − 1 (0: the two levels meet as one surface; 1: a pixel's
 * worth of gap). The depth alone does not tell a crack from a silhouette (a hill of a finer level over a farther ring): pairs with
 * jump / slope ≤ 3 are "continuous" (their excess reported: p50…max, over 0.25 and 1 px — C0-12's measure), the others are
 * counted as "silhouettes" (occlusion edges, and any crack wider than ~2 px alike: T3's geomorphose makes the levels' edges meet
 * by construction — docs/progress/refraction-horizons/T3-T5.md). tests/e2e/zz-seams, made a probe.
 */
export const SEAM_JS = `(async () => {
  const R = __bh.renderer, tr = R.terrainRaster, tex = tr?.distanceTexture?.(), dev = R.device;
  if (!tex) return { none: true };
  const W = tex.width, H = tex.height, bpr = Math.ceil(W * 16 / 256) * 256;
  const buf = dev.createBuffer({ size: bpr * H, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const e = dev.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [W, H]); dev.queue.submit([e.finish()]);
  await buf.mapAsync(GPUMapMode.READ); const raw = new Float32Array(buf.getMappedRange().slice(0)); buf.unmap(); buf.destroy();
  const st = bpr / 4, d = (x, y) => raw[y * st + x * 4], g = (x, y) => raw[y * st + x * 4 + 1];
  const lv = (x, y) => { const c = Math.floor(raw[y * st + x * 4 + 3] / 262144); return c >= 1 && c <= 56 && g(x, y) <= 0 && d(x, y) > 0 ? c : 0; };
  const errs = []; let pairs = 0, groundPx = 0, silhouettes = 0;
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const m = lv(x, y); if (!m) continue;
    groundPx++;
    const d0 = d(x, y);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const m1 = lv(x + dx, y + dy);
      if (!m1 || m1 === m) continue;
      if (lv(x - dx, y - dy) !== m || lv(x + 2 * dx, y + 2 * dy) !== m1) continue;
      const d1 = d(x + dx, y + dy);
      const s0 = Math.abs(d0 - d(x - dx, y - dy)), s1 = Math.abs(d(x + 2 * dx, y + 2 * dy) - d1);
      const slope = Math.max(0.5 * (s0 + s1), 1e-4 * d0);
      const r = Math.abs(d1 - d0) / slope;
      pairs++;
      if (r > 3) { silhouettes++; continue; }
      errs.push(Math.max(r - 1, 0));
    }
  }
  errs.sort((p, q) => p - q);
  const q = (f) => errs.length ? +errs[Math.min(errs.length - 1, Math.floor(f * errs.length))].toFixed(3) : 0;
  return { W, H, groundPx, pairs, continuous: errs.length, silhouettes, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1),
    over0_25: errs.filter((v) => v > 0.25).length, over1: errs.filter((v) => v > 1).length };
})()`;

/**
 * In the page: the sea's white points by reconstruction stage (renderer.sceneStages — stageProbe on): in each stage's image, in its
 * rows ROWS (the band about the horizon and the sea under it), the pixels over the SDR's white (× exposure > 1) and 1.5 × their 8
 * neighbours' mean luminance — sea-sparkle-probe's "over white" —, and those over `ratio` × it and a mid-grey (its "isolated").
 * Each stage at its own size (shade and temporal the render's, taau the canvas's): their counts per megapixel too.
 */
export const stageSparklesJs = (rows: [number, number], ratio = 3) => `(async () => {
  const r = await __bh.renderer.sceneStages(__bh.settings);
  if (!r) return null;
  const e = r.exposure, out = {};
  for (const [k, im] of Object.entries(r.stages)) {
    if (!im) { out[k] = null; continue; }
    const W = im.width, H = im.height, d = im.data;
    const L = (x, y) => { const i = 4 * (y * W + x); return e * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); };
    let over = 0, iso = 0; const at = [];
    for (let y = Math.max(1, Math.floor(H * ${rows[0]})); y < Math.min(H - 1, Math.floor(H * ${rows[1]})); y++) for (let x = 1; x < W - 1; x++) {
      const l = L(x, y); if (!(l > 0.5)) continue;
      let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) s += L(x + i, y + j);
      if (l > 1 && l > 1.5 * s / 8) { over++; if (at.length < 24) at.push([+(x / W).toFixed(3), +(y / H).toFixed(3)]); }
      if (l > ${ratio} * s / 8) iso++;
    }
    const mpx = (W * H) / 1e6;
    out[k] = { width: W, height: H, overWhite: over, isolated: iso, overWhitePerMpx: +(over / mpx).toFixed(1), isolatedPerMpx: +(iso / mpx).toFixed(1), at };
  }
  return out; })()`;

export interface SharpRowT {
  frame: number;
  t: number;
  sharp: number;
  width: number;
  height: number;
  scale: number;
  renderScale: number;
  source: string;
  phase: string;
  invalidations?: number;
  points?: number;
}

/**
 * The sharpness's disturbance at an event (J2-6's criterion, "aucun creux > 3 %": a change of scale, a pause, a resume): the `n`
 * images from the event against the median of the `n` images before it — `dip` = their least over it − 1 (a blur pulse: the image
 * softer), `peak` = their most over it − 1 (the history lost: the frame's own samples, noisier — the Laplacian's energy counts the
 * noise as detail), `settled` = the median of the images `settle`…`2·settle` after over it − 1 (where it went: the content drifts
 * meanwhile — over a second at 140 m/s, a turn —, not a pulse). Rows in order, `t` in the rows' unit.
 */
export function eventStep(rows: SharpRowT[], t: number, n = 8, settle = 20) {
  const med = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)]! : Number.NaN;
  };
  const i = rows.findIndex((r) => r.t >= t);
  if (i < 1) return null;
  const base = med(rows.slice(Math.max(0, i - n), i).map((r) => r.sharp));
  const first = rows.slice(i, i + n).map((r) => r.sharp);
  const steady = rows.slice(i + settle, i + 2 * settle).map((r) => r.sharp);
  return {
    at: i,
    t: rows[i]!.t,
    from: +rows[i - 1]!.renderScale.toFixed(3),
    to: +rows[Math.min(rows.length - 1, i + 1)]!.renderScale.toFixed(3),
    dip: +(Math.min(...first) / base - 1).toFixed(4),
    peak: +(Math.max(...first) / base - 1).toFixed(4),
    settled: +(med(steady) / base - 1).toFixed(4),
  };
}

/** every image whose render scale differs from the one before: its eventStep (the scale's changes, made by the flight or forced) */
export function scaleDips(rows: SharpRowT[], n = 8, settle = 20) {
  const out: NonNullable<ReturnType<typeof eventStep>>[] = [];
  for (let i = 1; i < rows.length; i++)
    if (Math.abs(rows[i]!.renderScale - rows[i - 1]!.renderScale) >= 1e-3) {
      const e = eventStep(rows, rows[i]!.t, n, settle);
      if (e) out.push(e);
    }
  return out;
}
