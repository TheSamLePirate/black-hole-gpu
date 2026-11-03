import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Vec3 } from "../../src/physics";
import { loadHeights } from "../../src/system/heights-file";
import {
  bakeRange,
  bakeTexel,
  bakeTexelBlockers,
  horizonFrom,
  type CapLattice,
  capLattice,
  decodeHorizon,
  encodeHorizonByte,
  globalLattice,
  heightPyramid,
  horizonAt,
  horizonMapWidth,
  type Lattice,
  latticePoint,
  latticeSectors,
  meanAt,
  referenceHorizon,
  topAround,
} from "../../src/system/horizon-maps";
import { App, E2E, stopServer } from "./lib/app";
import { writePng } from "./lib/png";

// H1 — the horizon maps' pilot (docs/PLAN-REFRACTION-HORIZONS.md): the Moon's maps baked on the GPU in the page (its finer
// maps in — "Moon: an afternoon on the plains" —, a band a frame, the profiler on), read back, then here:
//   1. the GPU's bytes against the CPU's reference bake (src/system/horizon-maps.ts bakeTexel, the same DEM as half floats),
//      texel for texel on the map and both caps;
//   2. the pilot's measure: at random places, a Sun at a random azimuth, the map's horizon (its texels bilinear, the sectors
//      interpolated) against the truth — the ground's mean heights marched from the receiver's own height along the exact
//      azimuth, half a texel a step, from D_bake to the reach —: the angle's error, the false light and the false shadow apart
//      (a point Sun 0–5° high; and "hard" ones, the Sun more than its radius from the true horizon); and against the truth
//      seen from the texel's top (the error of the sampling alone, the receiver's bias taken out);
//   3. two plates: a terminator at the equator and the south pole (the Sun 1.5° high), the map's shadow against the truth's —
//      false light red, false shadow blue.
// Duration: ~2 min (this Mac). Done when: baked within 90 s, ≥ 99 % of the texels within one code of the CPU's, no error.
const OUT = "remote-results/horizon-pilot";
afterAll(stopServer);
const deg = Math.PI / 180;
const R = 1_737_400;

test.skipIf(!E2E)(
  "H1's pilot: the Moon's horizon maps baked on the GPU, against the CPU's bake and against the truth",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: `scene=${encodeURIComponent("Moon: an afternoon on the plains")}` });
    // (the page's part — Chrome closed whatever happens, a failed expect, a timeout: none left on the GPU)
    const { st, mw, mh, gpuMap, gpuPole } = await (async () => {
      try {
        await app.js(
          `(() => { const r = __bh.renderer; r.prof.enabled = true; r.prof.every = 1; Object.assign(__bh.settings, { animate: false }); return 1; })()`,
        );
        const hd = await app.waitFor(`__bh.renderer.hdMap?.name === "moon"`, 60_000).then(
          () => true,
          () => false,
        );
        if (!hd)
          throw new Error(
            `the Moon's finer maps not in within 60 s (hdMap: ${await app.js(`(() => __bh.renderer.hdMap?.name ?? "none")()`)})`,
          );
        const st = await app.js<Record<string, unknown>>(`(async () => { const h = __bh.renderer.horizonMaps, t0 = performance.now();
        while (h.state !== "done" && performance.now() - t0 < 90000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
        const p = __bh.renderer.prof.table().find((x) => x.label === "horizon bake");
        return { ...h.stats(), band: p ? { ms: +p.ms.toFixed(3), last: +p.last.toFixed(3), n: p.n } : null, gpuErrors: __bh.renderer.gpuErrors }; })()`);
        console.log(`  bake: ${JSON.stringify(st)}`);
        await app.shot(`${OUT}/moon-scene.png`);
        if (st.state !== "done")
          throw new Error(`the bake not done within 90 s: ${st.left} rows left (${st.bands} bands of ${st.rows} rows)`);
        if (st.gpuErrors) console.log(`  page errors: ${JSON.stringify(app.cdp.errors.slice(0, 5))}`);
        expect(st.gpuErrors).toBe(0);
        // (the maps read back, brought here in pieces)
        const dims = await app.js<number[]>(
          `(async () => { const r = await __bh.renderer.horizonMaps.read(); window.__hz = r; return [r.map.w, r.map.h, r.map.layers.length, r.pole.w, r.pole.layers.length]; })()`,
        );
        const fetchLayer = async (which: "map" | "pole", l: number, size: number) => {
          const out = new Uint8Array(size);
          for (let o = 0; o < size; o += 3 << 20) {
            const n = Math.min(3 << 20, size - o);
            const b64 = await app.js<string>(
              `(() => { const a = window.__hz.${which}.layers[${l}].subarray(${o}, ${o + n}); let s = ""; for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode(...a.subarray(i, i + 32768)); return btoa(s); })()`,
            );
            out.set(Buffer.from(b64, "base64"), o);
          }
          return out;
        };
        const [mw, mh, ml, pw, pl] = dims as [number, number, number, number, number];
        const gpuMap = await Promise.all([...Array(ml).keys()].map((l) => fetchLayer("map", l, mw * mh * 4)));
        const gpuPole = await Promise.all([...Array(pl).keys()].map((l) => fetchLayer("pole", l, pw * pw * 4)));
        return { st, mw, mh, gpuMap, gpuPole };
      } finally {
        app.close();
      }
    })();

    // (the same DEM here, as the GPU holds it)
    const dem = await loadHeights("assets/planets-hd/moon-dem.bin", async (u) => new Response(Bun.file(u)));
    let lo = 0,
      hi = 0;
    for (let i = 0; i < dem.map.length; i++) {
      const v = dem.map[i]!;
      if (v < lo) lo = v;
      else if (v > hi) hi = v;
    }
    const src = heightPyramid(dem.map, dem.W, dem.H);
    const map = globalLattice(horizonMapWidth(dem.W), horizonMapWidth(dem.W) / 2);
    expect(mw).toBe((map as { W: number }).W);
    const caps = [capLattice(1), capLattice(-1)] as const;
    const rMap = bakeRange(map, dem, R, hi - lo),
      rCap = bakeRange(caps[0], dem, R, hi - lo);
    console.log(
      `  DEM ${dem.W} × ${dem.H}, relief ${lo} … ${hi} m; the map ${mw} × ${mh}: D_bake ${(rMap.D0 / 1000).toFixed(1)} km, reach ${(rMap.Dmax / 1000).toFixed(0)} km, ${rMap.steps} steps; the caps: D_bake ${(rCap.D0 / 1000).toFixed(1)} km`,
    );
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const gpuByte = (lat: Lattice, i: number, j: number, k: number, cap = 0) => {
      const w = lat.kind === "latlon" ? lat.W : lat.N;
      const layers = lat.kind === "latlon" ? gpuMap : gpuPole;
      // (option (d): a cap's 4 layers of sines then its 4 of the blockers' steps — the south cap from layer 8)
      return layers[8 * cap + (k >> 2)]![(j * w + i) * 4 + (k & 3)]!;
    };

    // 1. the GPU against the CPU
    const parity: Record<string, { n: number; within1: number; worst: number }> = {};
    for (const [name, lat, r, cap, count] of [
      ["map", map, rMap, 0, 400],
      ["north cap", caps[0], rCap, 0, 150],
      ["south cap", caps[1], rCap, 1, 150],
    ] as const) {
      const w = lat.kind === "latlon" ? lat.W : lat.N,
        h = lat.kind === "latlon" ? lat.H : lat.N;
      let n = 0,
        ok = 0,
        worst = 0;
      for (let s = 0; s < count; s++) {
        const i = Math.floor(rnd() * w),
          j = Math.floor(rnd() * h);
        const v = bakeTexel(lat, src, r, i, j);
        for (let k = 0; k < latticeSectors(lat); k++) {
          const d = Math.abs(encodeHorizonByte(v[k]!) - gpuByte(lat, i, j, k, cap));
          n++;
          if (d <= 1) ok++;
          worst = Math.max(worst, d);
        }
      }
      parity[name] = { n, within1: ok / n, worst };
    }
    console.log(`  GPU against the CPU: ${JSON.stringify(parity)}`);

    // the map's horizon at a point along an azimuth (its texels bilinear in their encoded values — as a sampler —, decoded,
    // the sectors interpolated); a cap past 79°
    const sampled = (lat: Lattice, gx: number, gy: number, cap: number) => {
      const w = lat.kind === "latlon" ? lat.W : lat.N,
        h = lat.kind === "latlon" ? lat.H : lat.N;
      const x = gx - 0.5,
        y = gy - 0.5;
      const i0 = Math.floor(x),
        j0 = Math.floor(y),
        fx = x - i0,
        fy = y - j0;
      const S = latticeSectors(lat);
      const out = new Float64Array(S);
      for (let k = 0; k < S; k++) {
        let v = 0;
        for (const [di, dj, wgt] of [
          [0, 0, (1 - fx) * (1 - fy)],
          [1, 0, fx * (1 - fy)],
          [0, 1, (1 - fx) * fy],
          [1, 1, fx * fy],
        ] as const) {
          const ii = lat.kind === "latlon" ? (((i0 + di) % w) + w) % w : Math.max(0, Math.min(w - 1, i0 + di));
          const jj = Math.max(0, Math.min(h - 1, j0 + dj));
          v += wgt * gpuByte(lat, ii, jj, k, cap);
        }
        out[k] = decodeHorizon(v / 255);
      }
      return out;
    };
    const frame = (p: Vec3) => {
      const lat = Math.asin(p[2]),
        lon = Math.atan2(p[1], p[0]);
      const sl = Math.sin(lat),
        cl = Math.cos(lat),
        so = Math.sin(lon),
        co = Math.cos(lon);
      return { lat, lon, east: [-so, co, 0] as Vec3, north: [-sl * co, -sl * so, cl] as Vec3 };
    };
    const mapHorizon = (p: Vec3, az: number) => {
      const f = frame(p);
      if (Math.abs(f.lat) > 79 * deg) {
        const pole = f.lat > 0 ? 1 : -1;
        const c = caps[pole > 0 ? 0 : 1] as CapLattice;
        const rr = 2 * Math.tan((Math.PI / 2 - pole * f.lat) / 2);
        const gx = ((rr * Math.cos(f.lon)) / c.rmax + 1) * (c.N / 2),
          gy = ((rr * Math.sin(f.lon)) / c.rmax + 1) * (c.N / 2);
        return horizonAt(sampled(c, gx, gy, pole > 0 ? 0 : 1), f.lon + Math.atan2(Math.sin(az), -pole * Math.cos(az)));
      }
      const m = map as Extract<Lattice, { kind: "latlon" }>;
      return horizonAt(sampled(m, (f.lon - m.lon0) / m.dlon, (m.lat0 - f.lat) / m.dlat, 0), az);
    };
    const tangent = (p: Vec3, az: number): Vec3 => {
      const f = frame(p);
      return [0, 1, 2].map((c) => Math.cos(az) * f.north[c]! + Math.sin(az) * f.east[c]!) as Vec3;
    };
    // (each from its lattice's D_bake — the caps' past 79° —, from the receiver's ground or its texel's top as the bake reads it)
    const truthAt = (p: Vec3, az: number, top = false) => {
      const r = Math.abs(p[2]) > Math.sin(79 * deg) ? rCap : rMap;
      return referenceHorizon(
        dem.map,
        dem.W,
        dem.H,
        R,
        p,
        tangent(p, az),
        top ? topAround(src, p, r.obsLevel) : meanAt(dem.map, dem.W, dem.H, p),
        r.D0,
        r.Dmax,
        0.5,
      );
    };

    // 2. the pilot's measure
    const asDeg = (s: number) => Math.asin(Math.max(-1, Math.min(1, s))) / deg;
    const rows: { where: string; err: number; errTop: number; sun: number; truth: number; map: number; p: Vec3; az: number }[] = [];
    for (let n = 0; n < 2400; n++) {
      // (uniform on the sphere: 2000 on the map, 400 past 80° on the caps)
      const cap = n >= 2000;
      const z = cap
        ? (rnd() < 0.5 ? -1 : 1) * (Math.sin(80 * deg) + rnd() * (1 - Math.sin(80 * deg)))
        : (rnd() * 2 - 1) * Math.sin(78 * deg);
      const lon = rnd() * 2 * Math.PI - Math.PI,
        cl = Math.sqrt(1 - z * z);
      const p: Vec3 = [cl * Math.cos(lon), cl * Math.sin(lon), z];
      const az = rnd() * 2 * Math.PI;
      const truth = asDeg(truthAt(p, az)),
        truthTop = asDeg(truthAt(p, az, true)),
        m = asDeg(mapHorizon(p, az));
      rows.push({ where: cap ? "cap" : "map", err: m - truth, errTop: m - truthTop, sun: rnd() * 5, truth, map: m, p, az });
    }
    const summary = (sel: typeof rows) => {
      const e = sel.map((r) => r.err).sort((a, b) => a - b),
        t = sel.map((r) => r.errTop).sort((a, b) => a - b);
      const q = (a: number[], f: number) => +a[Math.floor(f * (a.length - 1))]!.toFixed(3);
      const falseLight = sel.filter((r) => r.sun > r.map && r.sun <= r.truth).length / sel.length,
        falseShadow = sel.filter((r) => r.sun <= r.map && r.sun > r.truth).length / sel.length;
      const hard = sel.filter((r) => Math.abs(r.sun - r.truth) > 0.27);
      const hardLight = hard.filter((r) => r.sun > r.map && r.sun <= r.truth).length / sel.length,
        hardShadow = hard.filter((r) => r.sun <= r.map && r.sun > r.truth).length / sel.length;
      return {
        n: sel.length,
        err: { p5: q(e, 0.05), p25: q(e, 0.25), median: q(e, 0.5), p75: q(e, 0.75), p95: q(e, 0.95), min: q(e, 0), max: q(e, 1) },
        errFromTop: { p5: q(t, 0.05), median: q(t, 0.5), p95: q(t, 0.95) },
        falseLight: +(100 * falseLight).toFixed(2),
        falseShadow: +(100 * falseShadow).toFixed(2),
        hardFalseLight: +(100 * hardLight).toFixed(2),
        hardFalseShadow: +(100 * hardShadow).toFixed(2),
        shadowed: +((100 * sel.filter((r) => r.sun <= r.truth).length) / sel.length).toFixed(1),
      };
    };
    const pilot: Record<string, ReturnType<typeof summary>> = {
      map: summary(rows.filter((r) => r.where === "map")),
      caps: summary(rows.filter((r) => r.where === "cap")),
    };
    // (the options for the gate, on the map's samples — the CPU's bake at the nearest texel, the sectors interpolated: (a) as
    // baked, from the texel's top; (b) from its mean height; (c) the blockers kept — the distance by direction — and the horizon
    // seen again from the receiver's own height)
    {
      const m = map as Extract<Lattice, { kind: "latlon" }>;
      const opt: Record<"top" | "mean" | "blockers" | "blockersMean", typeof rows> = { top: [], mean: [], blockers: [], blockersMean: [] };
      for (const r of rows.filter((x) => x.where === "map")) {
        const p = r.p;
        const f = frame(p);
        const i = Math.floor((f.lon - m.lon0) / m.dlon),
          j = Math.min(m.H - 1, Math.max(0, Math.floor((m.lat0 - f.lat) / m.dlat)));
        const hr = meanAt(dem.map, dem.W, dem.H, p);
        const b = bakeTexelBlockers(m, src, rMap, ((i % m.W) + m.W) % m.W, j);
        const mean = bakeTexel(
          m,
          src,
          rMap,
          ((i % m.W) + m.W) % m.W,
          j,
          meanAt(dem.map, dem.W, dem.H, latticePoint(m, ((i % m.W) + m.W) % m.W, j).p),
          "top",
        );
        const seen = Array.from(b.sin, (_, k) => horizonFrom(R, hr, b.dist[k]!, b.height[k]!));
        const bm = bakeTexelBlockers(m, src, rMap, ((i % m.W) + m.W) % m.W, j, undefined, "mean");
        const seenMean = Array.from(bm.sin, (_, k) => horizonFrom(R, hr, bm.dist[k]!, bm.height[k]!));
        for (const [key, v] of [
          ["top", b.sin],
          ["mean", mean],
          ["blockers", seen],
          ["blockersMean", seenMean],
        ] as const)
          opt[key].push({ ...r, map: asDeg(horizonAt(v, r.az)), err: asDeg(horizonAt(v, r.az)) - r.truth, errTop: 0 });
      }
      pilot["option a — from the texel's top (CPU)"] = summary(opt.top);
      pilot["option b — from the texel's mean"] = summary(opt.mean);
      pilot["option c — the blockers kept, the receiver's own height"] = summary(opt.blockers);
      pilot["option d — c, the rays reading the mean heights"] = summary(opt.blockersMean);
    }
    console.log(`  the pilot (degrees; rates in % of the samples, the Sun 0–5° high): ${JSON.stringify(pilot)}`);

    // 3. the plates: the map's shadow against the truth's, a Sun direction fixed in space
    // (option d's horizon at a point: the nearest texel's blockers, seen from the receiver's own height — cached by texel)
    const dCache = new Map<string, ReturnType<typeof bakeTexelBlockers>>();
    const optionD = (p: Vec3, az: number) => {
      const f = frame(p);
      const hr = meanAt(dem.map, dem.W, dem.H, p);
      let lat: Lattice, i: number, j: number, angle: number, key: string;
      if (Math.abs(f.lat) > 79 * deg) {
        const pole = f.lat > 0 ? 1 : -1;
        const c = caps[pole > 0 ? 0 : 1] as CapLattice;
        const rr = 2 * Math.tan((Math.PI / 2 - pole * f.lat) / 2);
        i = Math.max(0, Math.min(c.N - 1, Math.floor(((rr * Math.cos(f.lon)) / c.rmax + 1) * (c.N / 2))));
        j = Math.max(0, Math.min(c.N - 1, Math.floor(((rr * Math.sin(f.lon)) / c.rmax + 1) * (c.N / 2))));
        lat = c;
        angle = f.lon + Math.atan2(Math.sin(az), -pole * Math.cos(az));
        key = `${pole}:${i}:${j}`;
      } else {
        const m = map as Extract<Lattice, { kind: "latlon" }>;
        i = ((Math.floor((f.lon - m.lon0) / m.dlon) % m.W) + m.W) % m.W;
        j = Math.max(0, Math.min(m.H - 1, Math.floor((m.lat0 - f.lat) / m.dlat)));
        lat = m;
        angle = az;
        key = `m:${i}:${j}`;
      }
      let b = dCache.get(key);
      if (!b) dCache.set(key, (b = bakeTexelBlockers(lat, src, lat.kind === "latlon" ? rMap : rCap, i, j, undefined, "mean")));
      return horizonAt(
        Array.from(b.sin, (_, k) => horizonFrom(R, hr, b.dist[k]!, b.height[k]!)),
        angle,
      );
    };
    const plate = (name: string, centre: Vec3, axes: [Vec3, Vec3], half: number, L: Vec3, n = 300, mode: "gpu" | "d" = "gpu") => {
      const rgb = new Uint8Array(n * n * 3);
      let fl = 0,
        fs = 0,
        sh = 0;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const u = ((x + 0.5) / n - 0.5) * 2 * half,
            v = (0.5 - (y + 0.5) / n) * 2 * half;
          const q: Vec3 = [0, 1, 2].map((c) => centre[c]! + u * axes[0][c]! + v * axes[1][c]!) as Vec3;
          const l = Math.hypot(...q);
          const p: Vec3 = [q[0] / l, q[1] / l, q[2] / l];
          const f = frame(p);
          const sunSin = p[0] * L[0] + p[1] * L[1] + p[2] * L[2];
          const az = Math.atan2(
            f.east[0] * L[0] + f.east[1] * L[1] + f.east[2] * L[2],
            f.north[0] * L[0] + f.north[1] * L[1] + f.north[2] * L[2],
          );
          const litMap = sunSin > (mode === "gpu" ? mapHorizon(p, az) : optionD(p, az)),
            litTrue = sunSin > truthAt(p, az);
          const o = 3 * (y * n + x);
          const g = Math.round(90 + 60 * Math.max(0, Math.min(1, ((meanAt(dem.map, dem.W, dem.H, p) - lo) / (hi - lo)) * 3)));
          if (litMap && litTrue) rgb.set([g + 60, g + 60, g + 60], o);
          else if (!litMap && !litTrue) rgb.set([g - 70, g - 70, g - 60], o), sh++;
          else if (litMap) rgb.set([235, 60, 50], o), fl++;
          else rgb.set([60, 120, 245], o), fs++;
        }
      writeFileSync(`${OUT}/${name}.png`, writePng(n, n, rgb));
      return {
        shadowed: +((100 * sh) / n / n).toFixed(1),
        falseLight: +((100 * fl) / n / n).toFixed(2),
        falseShadow: +((100 * fs) / n / n).toFixed(2),
      };
    };
    const plates: Record<string, unknown> = {};
    {
      // (the terminator at 30° E on the equator, the Sun 1.5° high at the centre: ±200 km)
      const c: Vec3 = [Math.cos(30 * deg), Math.sin(30 * deg), 0];
      const east: Vec3 = [-Math.sin(30 * deg), Math.cos(30 * deg), 0];
      const L: Vec3 = [0, 1, 2].map((k) => Math.cos(1.5 * deg) * east[k]! + Math.sin(1.5 * deg) * c[k]!) as Vec3;
      plates.terminator = plate("terminator-equator", c, [east.map((v) => v / R) as Vec3, [0, 0, 1 / R]], 200_000, L);
      plates.terminatorD = plate("terminator-equator-d", c, [east.map((v) => v / R) as Vec3, [0, 0, 1 / R]], 200_000, L, 300, "d");
    }
    {
      // (the south pole, ±250 km, the Sun 1.5° over its horizon towards +x)
      const c: Vec3 = [0, 0, -1];
      const L: Vec3 = [Math.cos(1.5 * deg), 0, Math.sin(1.5 * deg)];
      plates.southPole = plate(
        "south-pole",
        c,
        [
          [1 / R, 0, 0],
          [0, 1 / R, 0],
        ],
        250_000,
        L,
      );
      plates.southPoleD = plate(
        "south-pole-d",
        c,
        [
          [1 / R, 0, 0],
          [0, 1 / R, 0],
        ],
        250_000,
        L,
        300,
        "d",
      );
    }
    console.log(`  plates (% of the plate): ${JSON.stringify(plates)}`);
    // (the baked map itself: the east sector, its byte as grey)
    {
      const n = 4,
        w = mw / n,
        h = mh / n;
      const rgb = new Uint8Array(w * h * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) rgb.fill(gpuMap[0]![(y * n * mw + x * n) * 4 + 2]!, 3 * (y * w + x), 3 * (y * w + x) + 3);
      writeFileSync(`${OUT}/map-east.png`, writePng(w, h, rgb));
    }
    writeFileSync(
      `${OUT}/horizon-pilot.json`,
      JSON.stringify({ bake: st, ranges: { map: rMap, cap: rCap }, parity, pilot, plates }, null, 1),
    );
    for (const p of Object.values(parity)) expect(p.within1).toBeGreaterThanOrEqual(0.99);
  },
  10 * 60_000,
);
