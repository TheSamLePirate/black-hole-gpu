import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T7 — the French coasts against photographs (docs/progress/refraction-horizons/T7/refs: Wikimedia Commons, their cameras' GPS):
// each reference's view reproduced with the camera alone, no craft (Sam: "la vue, caméra libre seule, ou trépied"; "les mêmes
// vues, l'heure, le coucher de soleil et la météo aussi") — __bh.viewAt: the tripod on the ground where a person took it (a
// cliff top: its GPS a few tens of metres off, the relief smoothed — where the 40 m of relief ahead rise over the eye, the free
// camera 4 m over them instead), the free camera at a drone's height read in the photograph (its GPS altitude its take-off's);
// facing its bearing, pitched as its horizon sits in it, its vertical field from the lens (35 mm equivalent, its width matched to
// ours), at its hour (the camera's local time, Paris's: UTC+2 in summer, +1 in winter — the sunsets fall right so), in the
// weather its sky shows (the world's cloud map off: a day's clouds, not the photograph's — over Belle-Île an overcast that hid
// its setting Sun); the world in (60 s at most, what is missing said), frozen, the exposure settled; the shot beside the
// photograph. The views are tuned by hand against them (dHdg, dPitch, dAlt: the corrections found by looking).
//   CR_IDS: the references' ids (comma-separated; all when unset); CR_AB=<liteSkip bit>: the "earth lite" pass's GPU time with
//   that part off, on, off (3 s each) after each shot.
// Output: remote-results/coast-refs/<id>.png and <id>-pair.jpg (the photograph left, ours right), refs.json (CR_OUT).
// Done when: every reference asked shot and paired (or why not said), no GPU error. Duration: ~1 min a reference.
const OUT = process.env.CR_OUT ?? "remote-results/coast-refs";
const REFS_DIR = `${import.meta.dir}/../../docs/progress/refraction-horizons/T7/refs`;
afterAll(stopServer);

type Weather = "fair" | "cloudy" | "overcast" | "storm" | "rain";
interface Ref {
  id: string;
  file: string;
  lat: number;
  lon: number;
  /** a drone's height over the ground [m], read in the photograph; none: a person on the ground (the tripod) */
  agl?: number;
  /** the view's bearing [°] */
  hdg: number;
  /** the horizon's height in the photograph, from its top (0) to its bottom (1): the pitch from it */
  yh: number;
  /** the lens: 35 mm equivalent focal [mm]; the photograph's width over its height */
  f35: number;
  aspect: number;
  utc: string;
  weather: Weather;
  /** the bearing set by a landmark in the photograph: its place, or the Sun ("sun"), and where it stands across it (0 left, 1
   *  right) — a phone's compass is off by 10–20° */
  aim?: { lat: number; lon: number; x: number } | { sun: true; x: number; el?: number };
  /** the bearing found in the relief: the one that sees the most sea along a narrow corridor (a calanque's inlet straight ahead
   *  in the photograph), within ±span° of hdg */
  seaAim?: number;
  /** the corrections found by looking: bearing [°], pitch [°], height [m], the place moved along the view [m] (a GPS fix off) */
  dFwd?: number;
  dHdg?: number;
  dPitch?: number;
  dAlt?: number;
}
const REFS: Ref[] = [
  {
    id: "001",
    aim: { lat: 49.7058, lon: 0.1867, x: 0.585 },
    file: "001_etretat.jpg",
    lat: 49.70925,
    lon: 0.19874,
    agl: 200,
    hdg: 225,
    yh: 0.1,
    f35: 24,
    aspect: 16 / 9,
    utc: "2020-06-03T12:30:00Z",
    weather: "fair",
  },
  {
    id: "003",
    aim: { lat: 49.7121, lon: 0.2133, x: 0.7 },
    file: "003_etretat.jpg",
    lat: 49.70696,
    lon: 0.19416,
    hdg: 57,
    yh: 0.35,
    f35: 35,
    aspect: 4 / 3,
    utc: "2014-05-04T12:55:00Z",
    weather: "fair",
  },
  {
    id: "012",
    aim: { sun: true, x: 0.708, el: 3.4 },
    file: "012_raz.jpg",
    lat: 48.03987,
    lon: -4.73674,
    hdg: 273,
    yh: 0.33,
    f35: 28,
    aspect: 4 / 3,
    utc: "2020-08-22T19:06:00Z",
    weather: "fair",
  },
  {
    id: "020",
    dAlt: 6,
    aim: { lat: 48.04114, lon: -4.75644, x: 0.78 },
    file: "020_raz.jpg",
    lat: 48.0398,
    lon: -4.73696,
    hdg: 277,
    yh: 0.42,
    f35: 112,
    aspect: 3 / 2,
    utc: "2013-08-08T17:05:00Z",
    weather: "cloudy",
  },
  {
    id: "025",
    aim: { lat: 43.2087, lon: 5.4535, x: 0.62 },
    dAlt: 10,
    file: "025_calanques-sugiton.jpg",
    lat: 43.21317,
    lon: 5.45108,
    hdg: 273,
    yh: 0.3,
    f35: 66,
    aspect: 4 / 3,
    utc: "2015-08-23T09:30:00Z",
    weather: "fair",
  },
  {
    id: "034",
    file: "034_calanques-sugiton.jpg",
    lat: 43.20398,
    lon: 5.49442,
    hdg: 136,
    yh: 0.25,
    f35: 52,
    aspect: 16 / 9,
    utc: "2021-07-30T09:57:00Z",
    weather: "fair",
  },
  {
    id: "036",
    dAlt: 6,
    file: "036_cap-canaille.jpg",
    lat: 43.19854,
    lon: 5.55212,
    hdg: 325,
    yh: 0.2,
    f35: 29,
    aspect: 4 / 3,
    utc: "2015-08-28T15:12:00Z",
    weather: "fair",
  },
  {
    id: "048",
    dFwd: -250,
    file: "048_bonifacio.jpg",
    lat: 41.38408,
    lon: 9.16534,
    agl: 120,
    hdg: 10,
    yh: -0.1,
    f35: 24,
    aspect: 16 / 9,
    utc: "2026-07-28T09:52:00Z",
    weather: "fair",
  },
  {
    id: "057",
    dAlt: 8,
    aim: { lat: 41.3836, lon: 9.1628, x: 0.48 },
    file: "057_bonifacio.jpg",
    lat: 41.38714,
    lon: 9.16016,
    hdg: 154,
    yh: 0.38,
    f35: 45,
    aspect: 3 / 2,
    utc: "2014-06-02T11:29:00Z",
    weather: "fair",
  },
  {
    id: "072",
    aim: { lat: 48.68528, lon: -2.31722, x: 0.38 },
    file: "072_cap-frehel.jpg",
    lat: 48.67944,
    lon: -2.31333,
    agl: 45,
    hdg: 337,
    yh: 0.42,
    f35: 25,
    aspect: 4 / 3,
    utc: "2018-03-07T16:58:00Z",
    weather: "cloudy",
  },
  {
    id: "069",
    dFwd: 20,
    dAlt: 10,
    aim: { sun: true, x: 0.575, el: 4.4 },
    file: "069_belle-ile-port-coton.jpg",
    lat: 47.30529,
    lon: -3.23751,
    hdg: 279,
    yh: 0.42,
    f35: 26,
    aspect: 2,
    utc: "2018-07-06T19:42:00Z",
    weather: "fair",
  },
  {
    id: "078",
    file: "078_cap-frehel.jpg",
    lat: 48.68197,
    lon: -2.32684,
    hdg: 327,
    yh: 0.62,
    f35: 35,
    aspect: 2,
    utc: "2018-05-12T15:43:00Z",
    weather: "storm",
  },
  // (the framing's trials: candidate bearings and places where neither the GPS direction nor a landmark settles it)
  {
    id: "025w",
    file: "025_calanques-sugiton.jpg",
    lat: 43.21317,
    lon: 5.45108,
    hdg: 273,
    yh: 0.3,
    f35: 66,
    aspect: 4 / 3,
    utc: "2015-08-23T09:30:00Z",
    weather: "fair",
    dAlt: 30,
  },
  {
    id: "025s",
    seaAim: 100,
    file: "025_calanques-sugiton.jpg",
    lat: 43.21317,
    lon: 5.45108,
    hdg: 190,
    yh: 0.3,
    f35: 66,
    aspect: 4 / 3,
    utc: "2015-08-23T09:30:00Z",
    weather: "fair",
    dAlt: 30,
  },
  {
    id: "034f",
    file: "034_calanques-sugiton.jpg",
    lat: 43.20398,
    lon: 5.49442,
    hdg: 136,
    yh: 0.25,
    f35: 52,
    aspect: 16 / 9,
    utc: "2021-07-30T09:57:00Z",
    weather: "fair",
    dFwd: 40,
    dAlt: 10,
  },
  {
    id: "034t",
    seaAim: 100,
    file: "034_calanques-sugiton.jpg",
    lat: 43.20398,
    lon: 5.49442,
    hdg: 160,
    yh: 0.25,
    f35: 52,
    aspect: 16 / 9,
    utc: "2021-07-30T09:57:00Z",
    weather: "fair",
    dAlt: 15,
  },
];

const D = Math.PI / 180;
/** the bearing [°] from a place to another (the sphere's: a few hundred metres, a hundredth of a degree off) */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const y = Math.sin((lon2 - lon1) * D) * Math.cos(lat2 * D);
  const x = Math.cos(lat1 * D) * Math.sin(lat2 * D) - Math.sin(lat1 * D) * Math.cos(lat2 * D) * Math.cos((lon2 - lon1) * D);
  return (Math.atan2(y, x) / D + 360) % 360;
}
/** the Sun's azimuth [° from the north] at a place and an instant (NOAA's solar position: to ~0.1°) */
function sunAzEl(utc: string, lat: number, lon: number) {
  const t = new Date(utc);
  const jd = t.getTime() / 864e5 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * D) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * D) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * D) * 0.000289;
  const lam = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * D);
  const eps =
    23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos((125.04 - 1934.136 * T) * D);
  const dec = Math.asin(Math.sin(eps * D) * Math.sin(lam * D));
  const yv = Math.tan((eps * D) / 2) ** 2;
  const eqt =
    (4 / D) *
    (yv * Math.sin(2 * L0 * D) -
      2 * e * Math.sin(M * D) +
      4 * e * yv * Math.sin(M * D) * Math.cos(2 * L0 * D) -
      0.5 * yv * yv * Math.sin(4 * L0 * D) -
      1.25 * e * e * Math.sin(2 * M * D));
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60;
  const ha = ((minutes + eqt + 4 * lon) / 4 - 180) * D;
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat * D) - Math.tan(dec) * Math.cos(lat * D)) / D + 180;
  const el = Math.asin(Math.sin(lat * D) * Math.sin(dec) + Math.cos(lat * D) * Math.cos(dec) * Math.cos(ha)) / D;
  return [(az + 360) % 360, el] as const;
}
const sunAzimuth = (utc: string, lat: number, lon: number) => sunAzEl(utc, lat, lon)[0];
/** the instant within an hour of utc when the Sun stands el° high (geometric, setting or rising as at utc): a camera's clock off */
function sunAt(utc: string, lat: number, lon: number, el: number) {
  const t0 = Date.parse(utc);
  let best = t0,
    err = Number.POSITIVE_INFINITY;
  for (let m = -60; m <= 60; m += 0.25) {
    const t = new Date(t0 + m * 60e3).toISOString();
    const e = Math.abs(sunAzEl(t, lat, lon)[1] - el);
    if (e < err) [best, err] = [t0 + m * 60e3, e];
  }
  return new Date(best).toISOString();
}
// (our image's aspect: the window's 1280 × 800)
const OUR_ASPECT = 1280 / 800;

test.skipIf(!E2E)(
  "T7: the French coasts reproduced from geotagged photographs, the camera alone, side by side",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const want = process.env.CR_IDS?.split(",");
    const refs = REFS.filter((r) => (want ? want.includes(r.id) : /^\d+$/.test(r.id)));
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      // (no craft: the camera alone)
      await app.js(
        `(() => { Object.assign(__bh.settings, ${EARTH_SETTINGS}, { ship: false, earthClouds: 0, lookProfile: "neutral", motionBlur: 0, dof: false }); __bh.renderer.debugSkipShip = true; return 1; })()`,
      );
      // (the scene's preset can put a craft back as it settles: the camera alone checked before each view — no ship, the free
      // camera's mode)
      await app.settled(120_000);
      for (const r of refs) {
        // (the Sun seen in the photograph: its height there sets the instant — a camera's clock off by minutes, the Sun at the
        // horizon instead of 3° over it —, else the camera's time)
        const aimSun = r.aim && "sun" in r.aim ? r.aim : null;
        const utc = aimSun?.el !== undefined ? sunAt(r.utc, r.lat, r.lon, aimSun.el) : r.utc;
        // (the lens: the photograph's horizontal field; ours the same across where the photograph is the narrower — cropped in
        // height to ours —, else the same in height — cropped in width)
        const hfov = 2 * Math.atan(18 / r.f35);
        // (the bearing: the landmark's — or the Sun's — less where it stands across the photograph; else the given one)
        const a = r.aim;
        const toAim = a ? ("sun" in a ? sunAzimuth(utc, r.lat, r.lon) : bearing(r.lat, r.lon, a.lat, a.lon)) : 0;
        // (the landmark across the photograph's own field — the photograph's crop the same across ours where it is narrower)
        const hdg = (a ? toAim - Math.atan((a.x - 0.5) * 2 * Math.tan(hfov / 2)) / D : r.hdg) + (r.dHdg ?? 0);
        // (the place moved along the view: a GPS fix tens of metres back from the cliff's edge it was taken at)
        const fwd = r.dFwd ?? 0;
        const lat = r.lat + (fwd * Math.cos(hdg * D)) / 111320;
        const lon = r.lon + (fwd * Math.sin(hdg * D)) / (111320 * Math.cos(r.lat * D));
        // (the inlet's bearing searched in the relief, the world first in: the most sea 150–1 500 m out along a ±2° corridor)
        let seaHdg: number | null = null;
        if (r.seaAim !== undefined) {
          await app.js(`__bh.viewAt(${lat}, ${lon}, { altM: 400, heading: ${hdg.toFixed(1)}, pitch: -20 })`);
          await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 60_000).catch(() => {});
          seaHdg = await app.js<number>(`(() => { const D = Math.PI / 180, S = __bh.sys, lat = ${lat}, lon = ${lon};
            const at = (h, d) => { const la = lat + d * Math.cos(h * D) / 111320, lo = lon + d * Math.sin(h * D) / (111320 * Math.cos(lat * D));
              return S.groundAt(la, lo) - S.geoid(la, lo); };
            const eye = at(0, 0) + 10; let best = ${hdg.toFixed(1)}, bestS = -1;
            for (let h = ${hdg.toFixed(1)} - ${r.seaAim}; h <= ${hdg.toFixed(1)} + ${r.seaAim}; h += 2.5) {
              let blocked = false; for (let d = 20; d <= 150; d += 10) if (at(h, d) > eye) blocked = true;
              if (blocked) continue;
              let sea = 0; for (let d = 150; d <= 1500; d += 50) for (const o of [-2, 0, 2]) if (at(h + o, d) < 2) sea++;
              if (sea > bestS) { bestS = sea; best = h; } }
            return best; })()`);
        }
        const hdgUsed = seaHdg ?? hdg;
        const vfovPhoto = 2 * Math.atan(Math.tan(hfov / 2) / r.aspect);
        const vfovOurs = r.aspect > OUR_ASPECT ? vfovPhoto / D : (2 * Math.atan(Math.tan(hfov / 2) / OUR_ASPECT)) / D;
        const pitch = (-Math.atan((0.5 - r.yh) * 2 * Math.tan(vfovPhoto / 2)) * 180) / Math.PI + (r.dPitch ?? 0);
        await app.js(
          `(() => { __bh.freeze(true); __bh.game.setDate(${JSON.stringify(utc)}); __bh.game.set("weather", ${JSON.stringify(r.weather)}); document.body.classList.add("hide-ui"); return 1; })()`,
        );
        await app.js(`(() => { __bh.settings.ship = false; __bh.renderer.debugSkipShip = true; return 1; })()`);
        // (placed twice: the ground read before the fine relief is in is the coarse one's)
        const place = async () => {
          const g = await app.js<{
            ground: number;
            ahead: number;
            N: number;
          }>(`(() => { const D = Math.PI / 180, h = ${hdgUsed.toFixed(2)} * D, S = __bh.sys;
            const g = (la, lo) => Math.max(S.groundAt(la, lo), S.geoid(la, lo));
            let ahead = -1e9;
            for (let d = 5; d <= 40; d += 5) ahead = Math.max(ahead, g(${lat} + d * Math.cos(h) / 111320, ${lon} + d * Math.sin(h) / (111320 * Math.cos(${lat} * D))));
            return { ground: g(${lat}, ${lon}), ahead, N: S.geoid(${lat}, ${lon}) }; })()`);
          // (heights over the ellipsoid: the sea's level their floor)
          const tripod = r.agl === undefined && !r.dAlt && g.ahead < g.ground + 1.5;
          const altM = (r.agl !== undefined ? g.ground + r.agl : Math.max(g.ground + 1.7, g.ahead + 4)) + (r.dAlt ?? 0);
          const why = await app.js<string | null>(
            `__bh.viewAt(${lat}, ${lon}, { tripod: ${tripod}, altM: ${altM.toFixed(1)}, heading: ${hdgUsed.toFixed(2)}, pitch: ${pitch.toFixed(2)}, fov: ${vfovOurs.toFixed(2)} })`,
          );
          await app.js(`(() => { __bh.settings.fov = ${vfovOurs.toFixed(2)}; __bh.touch(); return 1; })()`);
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 6) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          return {
            tripod,
            altM: +altM.toFixed(1),
            overGround: +(altM - g.ground).toFixed(1),
            groundMsl: +(g.ground - g.N).toFixed(1),
            why,
          };
        };
        const waitWorld = () =>
          app.js<string>(`(async () => { const r = __bh.renderer, t0 = performance.now(), frame = () => new Promise((q) => requestAnimationFrame(q));
          const missing = () => { const sc = r.earthScenery.stats(), m = [];
            if (r.earthTiles.pending) m.push(r.earthTiles.pending + " relief tiles"); if (r.earthTiles.orthoPending) m.push(r.earthTiles.orthoPending + " imagery tiles");
            if (r.earthSurface.pending) m.push("surface"); if (sc.status !== "ready" || sc.pending) m.push("scenery " + sc.status); return m; };
          while (performance.now() - t0 < 60000 && missing().length) { __bh.touch(); await frame(); }
          const m = missing(); return m.length ? "missing after 60 s: " + m.join(", ") : "all in"; })()`);
        await place();
        await waitWorld();
        const placed = await place();
        const world = await waitWorld();
        // (the clock held from the start — it ran while the world loaded, the Sun an hour and more past the photograph's —; set again
        // to the photograph's instant before the shot)
        await app.js(`(() => { __bh.freeze(true); __bh.game.setDate(${JSON.stringify(utc)}); __bh.touch(); return 1; })()`);
        await app.settled(60_000);
        await app.exposureSettled();
        await app.js(
          `(() => { for (const s of ["[data-testid=jetmap]", "#overlay"]) { const e = document.querySelector(s); if (e) e.style.visibility = "hidden"; } return 1; })()`,
        );
        await app.js(
          `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 60) requestAnimationFrame(f); else q(1); }; f(); })`,
        );
        const shot = `${OUT}/${r.id}.png`;
        await app.shot(shot);
        // (CR_AB=bit: the shading pass's GPU time over 3 s with a part of it off — renderer.liteSkip — and on, alternated)
        let ab: unknown = null;
        if (process.env.CR_AB) {
          const time = (skip: number) =>
            app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
            r.liteSkip = ${skip}; for (let i = 0; i < 20; i++) { __bh.touch(); await frame(); }
            r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
            while (performance.now() - t0 < 3000) { __bh.touch(); await frame(); }
            const p = r.prof.table().find((x) => /earth lite/.test(x.label)); r.prof.enabled = false; r.liteSkip = 0; return p ? +p.ms.toFixed(3) : -1; })()`);
          const bit = Number(process.env.CR_AB);
          ab = { off: await time(bit), on: await time(0), off2: await time(bit) };
        }
        // (the pair: the photograph cropped to our 16:10 by ImageMagick itself — under bun test a spawned command's output reads
        // empty —, both 900 px wide, side by side)
        const pair = [
          "(",
          `${REFS_DIR}/${r.file}`,
          "-gravity",
          "center",
          "-crop",
          "16:10",
          "+repage",
          "-resize",
          "900x",
          ")",
          "(",
          shot,
          "-resize",
          "900x",
          ")",
          "+append",
          "-quality",
          "82",
          `${OUT}/${r.id}-pair.jpg`,
        ];
        const made = await $`magick ${pair}`.nothrow().quiet();
        if (made.exitCode) console.log(`  ${r.id}: the pair not made`);
        out[r.id] = {
          file: r.file,
          ...placed,
          ab,
          hdg,
          pitchDeg: +pitch.toFixed(2),
          vfovDeg: +vfovOurs.toFixed(2),
          weather: r.weather,
          world,
          mode: await app.js<string>(`__bh.mode.get()`),
          // (the view as framed: its azimuth, altitude and field — checked against the asked)
          framed: await app.js<unknown>(
            `(() => { const v = __bh.mx.framedView?.(); return v && { az: +v.az.toFixed(1), alt: +v.alt.toFixed(1), fov: +v.fov.toFixed(1) }; })()`,
          ),
          utc,
          sunAz: +sunAzimuth(utc, r.lat, r.lon).toFixed(1),
          // (the Sun as the game has it there and then — TARS's telemetry: its altitude and azimuth, true and seen —, and its date)
          gameSky: await app.js<unknown>(`(async () => { const t = __bh.tars?.tools().find((x) => x.name === "get_telemetry");
            const r = t ? await t.run({ groups: ["sky"] }, new AbortController().signal) : null; return { sky: r?.sky ?? r, date: __bh.game.date?.() }; })()`),
          pipeline: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`),
        };
        console.log(`  ${r.id}: ${JSON.stringify(out[r.id])}`);
        await app.js(`(() => { document.getElementById("overlay").style.visibility = ""; __bh.freeze(false); return 1; })()`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = app.cdp.errors.filter((e) => /WebGPU/i.test(e)).slice(0, 3);
      await app.js(`(() => { __bh.renderer.debugSkipShip = false; return 1; })()`);
    } finally {
      await Bun.write(`${OUT}/refs.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  30 * 60_000,
);
