import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";
import { readPng } from "./lib/png";

// PLAN-J1 J1-5 — the craft in the scene before the history (ship.ts encodeShip's compose, renderer.shipInScene): the F-35 at J0's
// start (500 m over the Rade d'Hyères, 140 m/s, its autopilot and autothrottle holding), turned right by its autopilot; in the
// turn, from behind (chase) then from the cockpit, the image with the craft composited after the history as before J1-5
// (shipInScene false) and drawn into the scene (true), a few frames apart: shots, the craft's crop's sharpness (its mean luma
// gradient), its pixels read back (renderer.surfaceAt: the craft's identity word, its motion — z 1 with history from behind, z 2
// none from inside —, w 1), the craft's passes' GPU time; a board of the four shots and the two crops (CIS_OUT/board.jpg).
// CIS_OUT (remote-results/craft-in-scene), CIS_W × CIS_H (1440 × 810).
// Duration: ~2–3 min (boot, the J0 start's data, the turn's two views).
// Done when: both views shot both ways in the turn, the craft's pixels read back as the craft's, its crop's sharpness in the scene
// over 0.6 of the composited one's (two moments of the turn: the Sun's glint moves), no GPU error.

const OUT = process.env.CIS_OUT ?? "remote-results/craft-in-scene";
const W = Number(process.env.CIS_W ?? 1440),
  H = Number(process.env.CIS_H ?? 810);
afterAll(stopServer);

/** the mean luma gradient over a crop of a PNG (fractions of its size: x, y, w, h; its pixels' |∂x| + |∂y|, 0–255 scale) — the
 *  sharper, the higher —, and the crop in its pixels */
function sharpness(file: Uint8Array, f: [number, number, number, number]) {
  const p = readPng(file);
  const crop = [f[0] * p.width, f[1] * p.height, f[2] * p.width, f[3] * p.height].map(Math.round) as [number, number, number, number];
  const [x0, y0, w, h] = crop;
  const L = (x: number, y: number) => {
    const i = (Math.min(Math.max(y, 0), p.height - 1) * p.width + Math.min(Math.max(x, 0), p.width - 1)) * p.channels;
    return 0.2126 * p.data[i]! + 0.7152 * p.data[i + 1]! + 0.0722 * p.data[i + 2]!;
  };
  let s = 0,
    n = 0;
  for (let y = y0; y < y0 + h - 1; y++)
    for (let x = x0; x < x0 + w - 1; x++) {
      s += Math.abs(L(x + 1, y) - L(x, y)) + Math.abs(L(x, y + 1) - L(x, y));
      n++;
    }
  return { sharp: +(s / Math.max(n, 1)).toFixed(3), crop };
}

test.skipIf(!E2E)(
  "the craft drawn into the scene before the history: sharp in a turn, its motion and identity read back",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: W, height: H, lang: "fr", hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const hasToggle = await app.js<boolean>(`"shipInScene" in __bh.renderer`);
      const [lat, lon, agl, hdg, spd] = J0_SCENE.start;
      const place = `__bh.game.setDate("${J0_SCENE.date}"); __bh.game.set("weather", "${J0_SCENE.weather}"); __bh.game.set("earthClouds", ${J0_SCENE.earthClouds});
        __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${spd}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
      await app.settled(180_000);
      await app
        .dataSettled("craft in scene: J0's start", { maxMs: 60_000 })
        .catch((e) => console.log(`  (data not settled: ${String(e).slice(0, 160)})`));
      // (placed again on the relief now in, the clock running, the autopilot and autothrottle engaged — E2E-VOLS §5.4)
      await app.js(`(() => { __bh.freeze(false); ${place} return 1; })()`);
      const ap = await app.js<{ ap: boolean; athr: boolean; note: string }>(`(async () => {
        const c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(q)); let note = "";
        for (let i = 0; i < 90; i++) { await frame();
          __bh.settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true;
          if (c.jetModes.alt === null) note = c.jetToggle("ap") ?? note;
          if (c.jetModes.spd === null) note = c.jetToggle("athr") ?? note;
          if (c.jetModes.alt !== null && c.jetModes.spd !== null && i >= 10) break; }
        const g = c.geoNow(); if (g && c.jetModes.alt !== null) c.jetModes.alt = g.alt;
        c.jetModes.spd = ${spd};
        return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null, note: String(note) }; })()`);
      if (!ap.ap || !ap.athr) throw new Error(`the autopilot ${ap.ap} / autothrottle ${ap.athr} not engaged — ${ap.note}`);
      // (the turn: right, towards J0's 340° — the autopilot banks the craft; 4 s into it)
      await app.js(`(() => { __bh.camera.jetModes.hdg = ${J0_SCENE.turnTo} * Math.PI / 180; return 1; })()`);
      await app.js(`new Promise((q) => setTimeout(() => q(1), 4000))`);
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) await f(); return 1; })()`,
        );
      const results: Record<string, unknown> = {};
      for (const mount of ["chase", "cockpit"] as const) {
        await app.js(`(() => { __bh.settings.shipMount = "${mount}"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
        await frames(45);
        for (const inScene of hasToggle ? [false, true] : [false]) {
          await app.js(
            `(() => { __bh.renderer.shipInScene = ${inScene}; __bh.renderer.prof.enabled = true; __bh.renderer.prof.reset(); return 1; })()`,
          );
          // (the history settled on the new way: 40 frames; then the images' GPU time over 3 s — renderer.lastGpuMs, median)
          await frames(40);
          const gpu = await app.js<{ p50: number; n: number }>(`(async () => {
            const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q)), g = [];
            let last = r.completedFrames ?? 0; const t0 = performance.now();
            while (performance.now() - t0 < 3000) { await f(); const d = r.completedFrames ?? 0; if (d !== last && r.lastGpuMs > 0) g.push(r.lastGpuMs); last = d; }
            g.sort((a, b) => a - b); return { p50: +(g[Math.floor(g.length / 2)] ?? 0).toFixed(2), n: g.length }; })()`);
          const tag = `${mount}-${inScene ? "scene" : "after"}`;
          const file = `${OUT}/${tag}.png`;
          await app.shot(file);
          // (the craft's box in the internal image and the canvas's scale; its pixels read back at the box's centre (behind it) or
          // low in the panel (inside))
          const info = await app.js<{
            rect: number[];
            iw: number;
            ih: number;
            cw: number;
            ch: number;
            bank: number;
            composed: boolean;
            passes: { pass: string; ms: number }[];
            gpu: number;
          }>(`(() => { const r = __bh.renderer, t = r.live; const g = __bh.camera.geoNow();
            return { rect: [...r.ship.rectFor(t.hdr)], iw: t.width, ih: t.height, cw: r.context.canvas.width, ch: r.context.canvas.height,
              bank: Math.round(((__bh.camera.attitudeNow?.()?.bank ?? 0) * 180) / Math.PI * 10) / 10, composed: !!r.ship.composed,
              passes: r.prof.table().filter((x) => /^ship|temporal|taau|display|bloom down 1/.test(x.label)).map((x) => ({ pass: x.label, ms: +x.ms.toFixed(3) })),
              gpu: r.gpuErrors }; })()`);
          // (a pixel of the craft: from behind, the first down the image's middle column whose word is the craft's — its hull
          // below the centre —; inside, low in the panel)
          const at: [number, number] = [0.5, 0.93];
          let px = await app.js<{ kind: string; id: number; craft: number | null; motion: number[] | null } | null>(
            `__bh.renderer.surfaceAt(${at[0]}, ${at[1]})`,
          );
          if (mount === "chase")
            for (let y = 0.5; y < 0.9; y += 0.02) {
              const q = await app.js<typeof px>(`__bh.renderer.surfaceAt(0.5, ${y})`);
              at[1] = y;
              px = q;
              if (q?.craft !== null && q?.craft !== undefined) break;
            }
          // (the craft's crop, in fractions of the shot: from behind, the middle of the image's lower half — the craft —; inside,
          // the panel's lower middle)
          const frac: [number, number, number, number] = mount === "chase" ? [0.3, 0.5, 0.4, 0.36] : [0.3, 0.72, 0.4, 0.27];
          const png = new Uint8Array(await Bun.file(file).arrayBuffer());
          const { crop } = sharpness(png, frac);
          // (the sharpness on the craft alone — its fuselage and nozzle from behind, the panel inside —: the wide crop's sky and
          // clouds changed it by ±30 % from run to run)
          const { sharp } = sharpness(png, mount === "chase" ? [0.37, 0.62, 0.15, 0.15] : [0.35, 0.86, 0.3, 0.12]);
          results[tag] = { ...info, at, px, crop, sharp, gpu };
          console.log(
            `  ${tag}: composed ${info.composed}, bank ${info.bank}°, at ${at.map((v) => v.toFixed(3))} → ${JSON.stringify(px && { craft: px.craft, id: px.id, motion: px.motion })}; sharpness ${sharp}; GPU p50 ${gpu.p50} ms (${gpu.n} images); passes ${JSON.stringify(info.passes)}; GPU errors ${info.gpu}`,
          );
        }
      }
      await Bun.write(`${OUT}/results.json`, JSON.stringify(results, null, 1));
      // the board: the four shots (after / in the scene; behind / inside) and the craft's crops
      if (hasToggle) {
        const r = results as Record<string, { crop: number[]; sharp: number; bank: number }>;
        const c = r["chase-after"]!.crop;
        const k = r["cockpit-after"]!.crop;
        const cropArg = (c: number[]) => `${c[2]}x${c[3]}+${c[0]}+${c[1]}`;
        const lab = (f: string, t: string) => [
          "(",
          f,
          "-resize",
          "960x",
          "-gravity",
          "north",
          "-fill",
          "white",
          "-undercolor",
          "#000a",
          "-pointsize",
          "22",
          "-annotate",
          "+0+8",
          t,
          ")",
        ];
        const crop = (f: string, t: string, c: number[]) => [
          "(",
          f,
          // (the gravity the labels set last stays: the crop's offsets from the top left)
          "-gravity",
          "northwest",
          "-crop",
          cropArg(c),
          "+repage",
          "-resize",
          "960x",
          "-gravity",
          "north",
          "-fill",
          "white",
          "-undercolor",
          "#000a",
          "-pointsize",
          "22",
          "-annotate",
          "+0+8",
          t,
          ")",
        ];
        const args = [
          "(",
          ...lab(`${OUT}/chase-after.png`, `poursuite — composé après l'historique (avant J1-5), inclinaison ${r["chase-after"]!.bank}°`),
          ...lab(`${OUT}/chase-scene.png`, `poursuite — dans la scène avant l'historique (J1-5), ${r["chase-scene"]!.bank}°`),
          "+append",
          ")",
          "(",
          ...crop(`${OUT}/chase-after.png`, `l'appareil — après (netteté ${r["chase-after"]!.sharp})`, c),
          ...crop(`${OUT}/chase-scene.png`, `l'appareil — dans la scène (netteté ${r["chase-scene"]!.sharp})`, c),
          "+append",
          ")",
          "(",
          ...lab(`${OUT}/cockpit-after.png`, "cockpit — composé après l'historique"),
          ...lab(`${OUT}/cockpit-scene.png`, "cockpit — dans la scène (sans historique : sous son masque)"),
          "+append",
          ")",
          "(",
          ...crop(`${OUT}/cockpit-after.png`, `le panneau — après (netteté ${r["cockpit-after"]!.sharp})`, k),
          ...crop(`${OUT}/cockpit-scene.png`, `le panneau — dans la scène (netteté ${r["cockpit-scene"]!.sharp})`, k),
          "+append",
          ")",
          "-append",
          "-quality",
          "84",
          `${OUT}/board.jpg`,
        ];
        const made = await $`magick ${args}`.nothrow().quiet();
        console.log(made.exitCode ? `  the board not made: ${made.stderr.toString().slice(0, 300)}` : `  board: ${OUT}/board.jpg`);
        // the craft's pixels: its word from behind (instance 0, motion z 1, w 1) and from inside (z 2)
        const chase = results["chase-scene"] as { px: { craft: number | null; motion: number[] | null } | null; composed: boolean };
        const inside = results["cockpit-scene"] as { px: { craft: number | null; motion: number[] | null } | null; composed: boolean };
        expect(chase.composed).toBe(true);
        expect(inside.composed).toBe(true);
        expect(chase.px?.craft).toBe(0);
        expect(chase.px?.motion?.[2]).toBe(1);
        expect(chase.px?.motion?.[3]).toBe(1);
        expect(inside.px?.craft).toBe(0);
        expect(inside.px?.motion?.[2]).toBe(2);
        // (as sharp in the scene as composited after — not blurred by the history: the shots are two moments of the turn, the Sun's
        // glint on the hull moved between them (kerr-mini, 12 Nov: ±30 % for the same look) — the board is the judge; the bound
        // catches a smeared craft)
        expect(r["chase-scene"]!.sharp).toBeGreaterThan(0.6 * r["chase-after"]!.sharp);
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  420_000,
);
