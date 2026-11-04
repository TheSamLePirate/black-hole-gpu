import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { geodeticToCart, rayFigure, WGS84_A, WGS84_F } from "../../src/system/ellipsoid";
import { gpuBending, gpuTableData } from "../../src/system/refraction-gpu";
import { App, E2E, stopServer } from "./lib/app";

// R2 — the sunset seen from the ISS on the layered air's tables (PLAN-REFRACTION-HORIZONS R2: « coucher de l'ISS écrasé ~1/5 en
// bas, posé sur le limbe à 70° N comme à l'équateur »): the free camera 420 km over the equator (20 March 2026, the Sun setting
// due west) and over 70° N (its path slanting), a 2.5° field on the Sun, the world held still at steps of the clock round the
// moment its centre reaches the apparent limb. Each step: a shot, the disc's height and width in the image [′] (its pixels over
// a quarter of the brightest, the exposure held where the Sun is not clipped, no bloom nor flare), against the CPU's same tables (refraction-gpu.ts gpuBending: the disc's points' apparent elevations,
// the rays under the limb cut off — on the WGS84 limb's dip in the Sun's azimuth). Then the refraction off, the geometric disc
// cut by the drawn limb against the ellipsoid's: where the image puts the Sun and the limb. Writes $AB_OUT/iss-sunset/<place>-<step>.png and sunset.json.
// ISS_PLACES="name,lat,lon,day;…" other places, ISS_STEPS=geo the geometric steps alone, ISS_WEATHER a weather preset, ISS_PIPELINE trace.
// Duration: ~4 min on this Mac.
// Done when: both places shot at every step, the image's flattening against the CPU's printed, no GPU error.
const OUT = `${process.env.AB_OUT ?? "remote-results"}/iss-sunset`;
const FOV = 2.5;
const H = 420e3;
const D = Math.PI / 180;
const R_SUN = (16.06 / 60) * D; // (20 March; 16.07′ on 25 October)

// The Sun's elevation and azimuth [°] (NOAA's low-precision formulae)
function sunAt(ms: number, lat: number, lon: number) {
  const n = ms / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D;
  const eps = (23.439 - 4e-7 * n) * D;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ha = (((18.697374558 + 24.06570982441908 * n) % 24) * 15 + lon) * D - ra;
  const la = lat * D;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / D;
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / D + 180) % 360;
  return { el, az };
}

// The CPU's disc on the same tables (the game's standard air), as the shader takes it (trace.wgsl refrBend): the tangent point on
// the squashed space's sphere of radius a, the camera at its distance there (r0) — its points' apparent elevations from there,
// the rays under the limb cut. The Sun's height then taken over the WGS84 limb in its azimuth — the same over this sphere's.
const table = gpuTableData({ pMsl: 101325, tGround: 15, rh: 0.5 });
function cpuModel(r0: number) {
  const trueOf = (e: number) => {
    const b = gpuBending(table, H, e, WGS84_A, r0);
    return b === null ? null : e - b;
  };
  // (the apparent limb: the lowest ray that clears the sea)
  let lo = -25 * D,
    hi = -15 * D;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (trueOf(m) === null) lo = m;
    else hi = m;
  }
  const eLimb = hi;
  const apparent = (y: number): number | null => {
    if (trueOf(eLimb)! > y) return null;
    let a = eLimb,
      b = y + 0.05;
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2;
      if (trueOf(m)! < y) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  /** the visible disc [′]: its height, its widest chord — the Sun's centre at a true elevation ec [rad] */
  const disc = (ec: number) => {
    const top = apparent(ec + R_SUN);
    if (top === null) return { V: 0, W: 0 };
    let bottom = apparent(ec - R_SUN);
    let W = 2 * R_SUN;
    if (bottom === null) {
      bottom = eLimb;
      const yCut = trueOf(eLimb)! - ec;
      if (yCut > 0) W = 2 * Math.sqrt(Math.max(R_SUN * R_SUN - yCut * yCut, 0));
    }
    return { V: (top - bottom) / (D / 60), W: W / (D / 60) };
  };
  // (the geometric dip of this sphere's limb; the true elevation of the Sun's centre on the apparent limb)
  return { eLimb, apparent, disc, dip: -Math.acos(WGS84_A / r0), ecLimb: trueOf(eLimb)! };
}
/** the camera's distance from the centre in the squashed space [m]: WGS84's a times its squashed radius */
const r0At = (lat: number, lon: number) => {
  const p = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, H);
  return Math.hypot(p[0], p[1], p[2] / (1 - WGS84_F));
};

// (the geometric limb's dip on WGS84 in an azimuth: the ray from the camera that grazes the ellipsoid, found by bisection)
function dipWgs84(lat: number, lon: number, az: number): number {
  const [la, lo2, a] = [lat * D, lon * D, az * D];
  const P = geodeticToCart(WGS84_A, WGS84_F, la, lo2, H);
  const U = [Math.cos(la) * Math.cos(lo2), Math.cos(la) * Math.sin(lo2), Math.sin(la)];
  const E = [-Math.sin(lo2), Math.cos(lo2), 0];
  const N = [-Math.sin(la) * Math.cos(lo2), -Math.sin(la) * Math.sin(lo2), Math.cos(la)];
  const dir = (e: number) =>
    [0, 1, 2].map((i) => Math.cos(e) * (Math.cos(a) * N[i]! + Math.sin(a) * E[i]!) + Math.sin(e) * U[i]!) as [number, number, number];
  let lo = -30 * D,
    hi = -10 * D;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (rayFigure(P.map((x) => x / WGS84_A) as [number, number, number], dir(m), 1, WGS84_F) !== null) lo = m;
    else hi = m;
  }
  return hi;
}
/** the geometric disc [′] (no air): its part over the WGS84 limb — the Sun's centre ec [rad] over the limb's dip */
function geoDisc(ec: number, dip: number) {
  const top = ec + R_SUN;
  if (top <= dip) return 0;
  return (top - Math.max(ec - R_SUN, dip)) / (D / 60);
}

/** the disc's pixels: over this share of the brightest, the Sun unclipped (its limb darkening in, the air's glow far under) */
const THRESHOLD = 0.25;

afterAll(stopServer);

test.skipIf(!E2E)(
  "R2: the Sun setting from the ISS's height, flattened on the limb as the CPU's tables say, at the equator and 70° N",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const out: Record<string, unknown> = {};
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { traffic: false, weather: "${process.env.ISS_WEATHER ?? "fair"}", earthClouds: 0, dof: false, motionBlur: 0,
        earthPipeline: "${process.env.ISS_PIPELINE ?? "raster"}", dynamicResolution: false, refraction: true, lookProfile: "neutral",
        autoExposure: false, exposure: 0, bloom: 0, lensFlare: 0 });
        document.body.classList.add("hide-ui"); return 1; })()`);
      await app.waitFor(`__bh.renderer.refrPublished !== ""`, 30_000).catch(() => console.warn("  tables not published after 30 s"));
      // (70° N in late October: the Sun 10° south, its path through the limb slanting — in March it never sinks that far there)
      // (ISS_PLACES="name,lat,lon,day;…": other places — the search for the moment starts at their day; ISS_STEPS=geo: the
      // geometric steps alone)
      const places: [string, number, number, string][] = process.env.ISS_PLACES
        ? process.env.ISS_PLACES.split(";").map((p) => {
            const [n, la, lo, d] = p.split(",");
            return [n!, +la!, +lo!, d!];
          })
        : [
            ["equator", 0, 0, "2026-03-20T17:00:00Z"],
            ["70N", 70, 0, "2026-10-25T10:00:00Z"],
          ];
      for (const [place, lat, lon, day] of places) {
        // (the moment the Sun's centre stands that far [rad] over the WGS84 limb, to the second)
        const over = (ms: number) => {
          const s = sunAt(ms, lat, lon);
          return s.el * D - dipWgs84(lat, lon, s.az);
        };
        const when = (x: number) => {
          let t = Date.parse(day);
          while (over(t) > x) t += 1000;
          return t;
        };
        const M = cpuModel(r0At(lat, lon));
        console.log(
          `  ${place}: the CPU's apparent limb ${((M.eLimb - M.dip) / D).toFixed(3)}° over the geometric, the Sun's centre on it ${((M.dip - M.ecLimb) / D).toFixed(3)}° under`,
        );
        const t = when(M.ecLimb - M.dip);
        // (the air's steps round the moment its centre reaches the apparent limb; then, the refraction off, the geometric
        // disc cut by the limb — its centre 0.15° over it, on it, 0.15° under it: where the image puts the Sun and the limb)
        const steps = [
          ...(process.env.ISS_STEPS === "geo" ? [] : [-240, -150, -90, -45, 0, 30]).map((dt) => ({
            tag: `${dt}`,
            ms: t + dt * 1000,
            refr: true,
          })),
          ...[0.15, 0, -0.15].map((k) => ({ tag: `geo${k}`, ms: when(k * D), refr: false })),
        ];
        const rows: Record<string, unknown>[] = [];
        for (const { tag: step, ms, refr } of steps) {
          const s = sunAt(ms, lat, lon);
          const dipW = dipWgs84(lat, lon, s.az);
          const cpu = refr ? M.disc(s.el * D - dipW + M.dip) : { V: geoDisc(s.el * D, dipW), W: (2 * R_SUN) / (D / 60) };
          const iso = new Date(ms).toISOString();
          // (the look at the Sun's apparent centre — its CPU elevation —, the world held still, the image settled)
          const aimEl = refr
            ? (Math.max(M.apparent(s.el * D - dipW + M.dip) ?? M.eLimb, M.eLimb) + dipW - M.dip) / D
            : Math.max(s.el * D, dipW) / D;
          await app.js(`(() => { __bh.settings.refraction = ${refr}; __bh.touch(); return 1; })()`);
          const tag = `${place}-${step}`;
          const why = await app.js<string | null>(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q));
            __bh.freeze(false); __bh.game.setDate("${iso}");
            const why = __bh.viewAt(${lat}, ${lon}, { altM: ${H}, heading: ${s.az.toFixed(4)}, pitch: ${aimEl.toFixed(5)}, fov: ${FOV} });
            // (the lens eased to its field before the freeze — frozen, it would stay where it was)
            for (let i = 0; i < 600 && Math.abs(__bh.camera.viewController().s.fov - ${FOV}) > 0.002; i++) await f();
            for (let i = 0; i < 20; i++) await f(); __bh.game.setDate("${iso}"); __bh.freeze(true);
            // (placed again once the clock is held: placed before, the free camera drifted while the clock ran on and was set
            // back — 417 km instead of 420 over the equator, the limb 0.07° higher, the rays lower: more air)
            __bh.viewAt(${lat}, ${lon}, { altM: ${H}, heading: ${s.az.toFixed(4)}, pitch: ${aimEl.toFixed(5)} });
            for (let i = 0; i < 60; i++) { __bh.touch(); await f(); } return why; })()`);
          if (why) throw new Error(`viewAt: ${why}`);
          await app.settled(60_000);
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 40) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          await app.shot(`${OUT}/${tag}.png`);
          // (the disc read in the canvas (its labels left out), a frame drawn first — read while frozen and untouched it came black —, at
          // an exposure held where the Sun is not clipped (the meter off, stepped down from its value until the brightest pixel
          // is under 240): its pixels over THRESHOLD of the brightest — the edges' limb darkening in, the air's glow out)
          const m = await app.js<{ h: number; max: number; bw: number; bh: number; n: number; ev: number; cut: boolean }>(`(async () => {
            const cv = document.querySelector("canvas"), s = __bh.settings;
            const read = async () => {
              __bh.touch();
              await new Promise((r) => requestAnimationFrame(r));
              __bh.touch();
              const b = await new Promise((r) => requestAnimationFrame(() => r(createImageBitmap(cv))));
              const o = new OffscreenCanvas(b.width, b.height), g = o.getContext("2d"); g.drawImage(b, 0, 0);
              const d = g.getImageData(0, 0, b.width, b.height).data;
              // (the frame less its labels: the meter's line on top, the ship's mark at the foot)
              const [x0, x1, y0, y1] = [0, b.width, 0.04 * b.height, 0.88 * b.height].map(Math.round);
              const L = (x, y) => { const i = 4 * (y * b.width + x); return d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; };
              // (the Sun's warm pixels only — red over blue —: the white labels of the marks left out)
              const warm = (x, y) => { const i = 4 * (y * b.width + x); return d[i] > 1.3 * d[i + 2] + 2; };
              // (its brightest over an extended source: a pixel whose neighbours 3 px round are as bright — a star's point left out)
              const wide = (x, y) => { const l = L(x, y); return [[3, 0], [-3, 0], [0, 3], [0, -3]].every(([a, c]) => x + a >= 0 && x + a < b.width && y + c >= 0 && y + c < b.height && L(x + a, y + c) > 0.5 * l); };
              let max = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (warm(x, y) && L(x, y) > max && wide(x, y)) max = L(x, y);
              // (the disc's centre: the warm bright pixels' weighted centroid — a banner's edge, a star a few pixels' weight —; its
              // box within 0.6° across and 0.4° up and down of it)
              let sw = 0, sx = 0, sy = 0;
              for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (max > 0 && warm(x, y) && L(x, y) >= ${THRESHOLD} * max) {
                const l = L(x, y); sw += l; sx += l * x; sy += l * y; }
              const cx = sx / Math.max(sw, 1e-9), cy = sy / Math.max(sw, 1e-9), px = b.height / __bh.camera.viewController().s.fov;
              let n = 0, top = 1e9, bottom = -1, left = 1e9, right = -1;
              for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (max > 0 && warm(x, y) && L(x, y) >= ${THRESHOLD} * max && Math.abs(x - cx) < 0.6 * px && Math.abs(y - cy) < 0.4 * px) {
                n++; top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
              // (a disc the frame's edge cuts: said, its height not read)
              const cut = top <= y0 || bottom >= y1 - 1 || left <= x0 || right >= x1 - 1;
              return { h: b.height, max, bw: right - left + 1, bh: bottom - top + 1, n, ev: s.exposure, cut };
            };
            let r = await read();
            for (let k = 0; k < 20 && (r.max === 0 || r.max >= 240); k++) {
              if (r.max > 0) s.exposure -= 1;
              for (let i = 0; i < 6; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
              r = await read();
            }
            return r; })()`);
          const fov = await app.js<number>(`__bh.camera.viewController().s.fov`);
          if (Math.abs(fov - FOV) > 0.002) console.warn(`  the field ${fov}°, not ${FOV}°`);
          const perPx = (fov * 60) / m.h;
          const img = m.n > 0 && !m.cut ? { V: m.bh * perPx, W: m.bw * perPx } : { V: 0, W: 0 };
          const row = {
            step,
            refraction: refr,
            iso,
            sunElDeg: +s.el.toFixed(4),
            overLimbDeg: +((s.el * D - dipW) / D).toFixed(4),
            sunAzDeg: +s.az.toFixed(3),
            cpu: { V: +cpu.V.toFixed(2), W: +cpu.W.toFixed(2), ratio: cpu.W > 0 ? +(cpu.V / cpu.W).toFixed(3) : null },
            img: {
              V: +img.V.toFixed(2),
              W: +img.W.toFixed(2),
              ratio: img.W > 0 ? +(img.V / img.W).toFixed(3) : null,
              n: m.n,
              max: +m.max.toFixed(0),
              ev: m.ev,
            },
          };
          rows.push(row);
          console.log(`  ${tag}: ${JSON.stringify(row)}`);
        }
        await app.js(`(() => { __bh.settings.refraction = true; return 1; })()`);
        out[place] = rows;
      }
      out.pipeline = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.errors = app.cdp.errors.slice(0, 5);
      console.log(`  pipeline ${out.pipeline}, tables ${await app.js<string>(`__bh.renderer.refrPublished`)}, GPU errors ${out.gpuErrors}`);
    } finally {
      writeFileSync(`${OUT}/sunset.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
