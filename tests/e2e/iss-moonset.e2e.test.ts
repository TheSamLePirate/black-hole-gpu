import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { azAltAt } from "../../src/eclipse/earth-moon";
import { addEphemeris } from "../../src/system/de440";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// Q6 — the setting Moon seen from the ISS against a photograph: Don Pettit's ISS006-E-45773 (16 April 2003, 08:38:31 GMT, the
// station 393 km over 21.1° S 20.6° W, a 400 mm lens — NASA's Gateway to Astronaut Photography): the Moon there 0.55 as high as
// it is wide (its outline at a red level of 130 of 255; 0.55–0.63 with the level). Its shape hangs on its height over the limb:
// the station's track unknown here, the camera is set at that moment over that point and moved along the Moon's azimuth (the game's ephemeris: the
// time and nadir given put it 8.5° under the limb — the cameras' clocks were often off) to where it touches the limb, then by
// 10 km steps about it (each ~1.3 s of the station's motion) — the Moon lower, then higher over the limb —, the free camera aimed at it
// (its true height raised 0.2°), a 1.5° field, frozen, no bloom nor flare; at each, the Moon's height over its width (its
// pixels redder than blue over 45 % of the reddest) and where it is widest. Then: does the model reach 0.55, and with the photo's
// shape (widest low)? MO_OUT: the shots (remote-results/iss-moonset).
// MO_STEPS="0,…" some steps alone; MO_JS a statement run first (an A/B's switch).
// Duration: ~4 min on this Mac.
// Done when: every step shot and measured, the flattest the model draws logged against the photo's, no GPU error.
const OUT = process.env.MO_OUT ?? "remote-results/iss-moonset";
const ISO = "2003-04-16T08:38:31Z";
const LAT = -21.1;
const LON = -20.6;
const ALT = 393e3;
const FOV = 1.5;
afterAll(stopServer);
test.skipIf(!E2E)(
  "Q6: the Moon setting seen from the ISS — the model's flattening against Pettit's photograph",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const rows: { step: number; alt: number; hw: number; widest: number; px: number }[] = [];
    let gpuErrors = 0;
    try {
      await app.js(
        `(() => { Object.assign(__bh.settings, { refraction: true, bloom: 0, lensFlare: 0, dof: false, motionBlur: 0, lookProfile: "neutral" }); return 1; })()`,
      );
      await app.js(`(() => { __bh.game.setDate("${ISO}"); return 1; })()`);
      // (the Moon's place from the game's ephemeris here — the page's sky report follows the craft, not the free camera —; the
      // photograph's time and nadir put it 8.5° under the limb: the cameras' clocks were often off — the point along its azimuth
      // where it touches the limb found, the steps about it)
      for (const f of ["de440.bin", "jup365.bin"]) {
        const b = readFileSync(`assets/ephemeris/${f}`);
        addEphemeris(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      }
      const D = Math.PI / 180;
      const ms = Date.parse(ISO);
      const az0 = azAltAt("moon", LAT * D, LON * D, ALT, ms).az;
      const along = (km: number) => {
        const d = (km * 1e3) / 6371e3;
        const lat = Math.asin(Math.sin(LAT * D) * Math.cos(d) + Math.cos(LAT * D) * Math.sin(d) * Math.cos(az0 * D)) / D;
        const lon =
          LON + Math.atan2(Math.sin(az0 * D) * Math.sin(d) * Math.cos(LAT * D), Math.cos(d) - Math.sin(LAT * D) * Math.sin(lat * D)) / D;
        return { lat, lon, ...azAltAt("moon", lat * D, lon * D, ALT, ms) };
      };
      const dip = -Math.acos(6378e3 / (6378e3 + ALT)) / D;
      let lo = 0,
        hi = 3000;
      for (let k = 0; k < 40; k++) {
        const mid = 0.5 * (lo + hi);
        if (along(mid).alt < dip) lo = mid;
        else hi = mid;
      }
      const km0 = Math.round(0.5 * (lo + hi));
      console.log(
        `  the Moon at ${ISO}: azimuth ${az0.toFixed(2)}° from the nadir given; on the limb (${dip.toFixed(2)}°) ${km0} km towards it`,
      );
      const steps = process.env.MO_STEPS ? process.env.MO_STEPS.split(",").map(Number) : [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
      if (process.env.MO_JS) await app.js(`(() => { ${process.env.MO_JS} return 1; })()`);
      // (the layered air's tables published before any shot — before them the exponential air's: the Moon barely flattened)
      await app.js(`(() => { __bh.viewAt(${LAT}, ${LON}, { altM: ${ALT}, heading: 0, pitch: 0, fov: ${FOV} }); return 1; })()`);
      await app.waitFor(`__bh.renderer.refrPublished !== ""`, 60_000);
      // (a first placement not measured: the first shot after the boot showed the Moon unflattened — the layered air's bending
      // in from the next one)
      for (const [n, step] of [steps[0]!, ...steps].entries()) {
        const warm = n === 0;
        // (10 km steps about the limb's point along the Moon's azimuth — towards it the Moon higher)
        const p = along(km0 + step * 10);
        // (aimed at its true height raised 0.2° — the limb's bending ≤ 0.6°, the field 1.5°: the Moon in it whatever its lift)
        const m = { az: p.az, alt: p.alt + 0.2 };
        await app.js(
          `(() => { __bh.freeze(false); __bh.viewAt(${p.lat}, ${p.lon}, { altM: ${ALT}, heading: ${m.az}, pitch: ${m.alt}, fov: ${FOV} }); __bh.camera.setFov(${FOV}); __bh.game.setDate("${ISO}"); document.body.classList.add("hide-ui"); return 1; })()`,
        );
        // (the field set — a frozen world holds the camera's rig: frozen after)
        await app.waitFor(`Math.abs(__bh.settings.fov - ${FOV}) < 0.01`, 30_000);
        await Bun.sleep(400);
        await app.js(`(() => { __bh.game.setDate("${ISO}"); __bh.freeze(true); return 1; })()`);
        await app.settled(120_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 60; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
        const file = `${OUT}/step${step}.png`;
        await app.shot(file);
        const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
        // (the Moon: its pixels redder than blue and over 45 % of the window's reddest — the sky's gradient, the labels and the stars
        // left out —, in the frame's middle: 20–80 % across, 20–85 % down)
        const x0 = Math.floor(0.2 * img.width),
          x1 = Math.floor(0.8 * img.width),
          y0 = Math.floor(0.2 * img.height),
          y1 = Math.floor(0.85 * img.height);
        const red: number[] = [];
        for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) red.push(img.data[(y * img.width + x) * img.channels]!);
        red.sort((a, b) => a - b);
        const t = 0.45 * red[Math.floor(0.999 * (red.length - 1))]!;
        const isMoon = (o: number) => img.data[o]! > t && img.data[o]! > img.data[o + 2]!;
        // (its box between the 0.5th and 99.5th percentiles of its pixels' rows and columns: a label's or a star's few pixels left
        // out)
        const ys: number[] = [];
        const xs: number[] = [];
        const widths = new Map<number, number>();
        for (let y = y0; y < y1; y++) {
          let a = 1e9,
            b = -1;
          for (let x = x0; x < x1; x++)
            if (isMoon((y * img.width + x) * img.channels)) {
              ys.push(y);
              xs.push(x);
              a = Math.min(a, x);
              b = Math.max(b, x);
            }
          if (b >= 0) widths.set(y, b - a + 1);
        }
        ys.sort((a, b) => a - b);
        xs.sort((a, b) => a - b);
        const q = (v: number[], f: number) => v[Math.floor(f * (v.length - 1))] ?? -1;
        const minY = q(ys, 0.005),
          maxY = q(ys, 0.995),
          minX = q(xs, 0.005),
          maxX = q(xs, 0.995);
        const H = maxY - minY + 1;
        const W = maxX - minX + 1;
        let wy = minY;
        for (const [y, w] of widths) if (w > (widths.get(wy) ?? 0)) wy = y;
        const row = {
          step,
          alt: +m.alt.toFixed(3),
          hw: maxY >= 0 ? +(H / W).toFixed(3) : 0,
          widest: maxY >= 0 ? +((wy - minY) / H).toFixed(2) : 0,
          px: W,
        };
        if (warm) {
          await app.js(`(() => { __bh.freeze(false); return 1; })()`);
          continue;
        }
        rows.push(row);
        console.log(
          `  step ${step} (${km0 + step * 10} km): the Moon at ${row.alt}° true, H/W ${row.hw}, widest at ${row.widest} from its top, ${W} px wide`,
        );
        await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      }
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(
        `${OUT}/moonset.json`,
        JSON.stringify({ photo: { hw: 0.55, widest: 0.56, source: "ISS006-E-45773" }, rows }, null, 1),
      );
      await app.close();
    }
    const seen = rows.filter((r) => r.hw > 0.05);
    const flattest = seen.reduce((a, b) => (b.hw < a.hw ? b : a), seen[0]!);
    console.log(`  the flattest drawn: H/W ${flattest.hw} at ${flattest.alt}° (step ${flattest.step}); the photograph's 0.55–0.63`);
    expect(seen.length).toBeGreaterThan(3);
    expect(gpuErrors).toBe(0);
  },
  10 * 60_000,
);
