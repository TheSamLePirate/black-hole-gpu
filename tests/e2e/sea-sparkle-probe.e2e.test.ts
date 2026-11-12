import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";
import { readPng } from "./lib/png";

// Probe — not in `bun run e2e`: E2E_PROBE=1 — (Sam, 12 Nov 2026: in J0's flight « plein de points blancs (pixels) qui apparaissent
// et disparaissent, comme du bruit » on the sea): J0's scene flown (the F-35, cockpit, 500 m over the Rade d'Hyères, its autopilot),
// the sea under the horizon read 6 times a side from the scene's colour (renderer.sceneColor: no HUD), its sparkles counted
// (a pixel over SP_RATIO × its 8 neighbours' mean luminance), for each side of the renderer's switches named in SP_SWITCHES (default: none, identityReject, shipInScene off) —
// what makes the noise. SP_OUT (remote-results/sea-sparkle).
// Duration: ~3 min. Done when: each side shot and counted.
afterAll(stopServer);
const OUT = process.env.SP_OUT ?? "remote-results/sea-sparkle";
/** the rows looked at (fractions of the image: SP_ROWS, default the band about the horizon and the sea under it) */
const ROWS = (process.env.SP_ROWS ?? "0.35,0.85").split(",").map(Number) as [number, number];
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the sea's white sparkles: what makes them",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 900, lang: "fr", hash: "scene=game:artemis", tiles: process.env.SP_TILES !== "0" });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const [lat, lon, agl, hdg, v] = J0_SCENE.start;
      // (J0's protocol — E2E-VOLS §5.4 —: placed with the clock frozen, the data waited for frozen — not gliding at a closed throttle
      // meanwhile —, placed again on the relief now in, then the clock running and the autopilot, autothrottle and gear held each
      // frame until they hold: a steady flight, not a climb — the gear up, the autopilot climbs —)
      const place = `__bh.game.setDate("${J0_SCENE.date}"); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${v});
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
      await app.settled(180_000);
      await app.dataSettled("sparkles: Toulon-Hyères", { maxMs: 60_000 }).catch((e) => console.log(`  (${String(e).slice(0, 120)})`));
      await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
      await app.settled(60_000);
      const ap = await app.js<{ ap: boolean; athr: boolean }>(`(async () => { __bh.freeze(false);
        const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
        for (let i = 0; i < 90; i++) { await f(); __bh.settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true;
          if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          if (c.jetModes.alt !== null && c.jetModes.spd !== null && i > 10) break; }
        const g = c.geoNow(); if (g && c.jetModes.alt !== null) { c.jetModes.alt = g.alt; c.jetModes.hdg = ${hdg} * Math.PI / 180; }
        c.jetModes.spd = ${v}; return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null }; })()`);
      if (!ap.ap || !ap.athr) throw new Error(`the autopilot ${ap.ap} / autothrottle ${ap.athr} not engaged`);
      // (SP_HOLD=1: the view held — the clock frozen, the image refined: on the M1 Max the sparkles swarm then, J2-0 —, every side)
      if (process.env.SP_HOLD === "1")
        await app.js(
          `(async () => { __bh.freeze(true); const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 120; i++) await f(); return 1; })()`,
        );
      const sides = (process.env.SP_SWITCHES ?? "none,identityReject=false,shipInScene=false").split(",");
      const out: Record<string, number[]> = {};
      for (const side of sides) {
        const [name, val] = side.split("=");
        // (a renderer's switch, or a setting: settings.<name>=<value>; restored after the side)
        const target = name!.startsWith("settings.") ? "__bh.settings" : "__bh.renderer";
        const key = name!.replace(/^settings\./, "");
        let before = "undefined";
        if (name !== "none") {
          if (!/^[A-Za-z]+$/.test(key) || !/^[A-Za-z0-9"]+$/.test(val!)) throw new Error(`SP_SWITCHES: ${side}`);
          before = JSON.stringify(await app.js(`${target}.${key}`));
          await app.js(`(() => { ${target}.${key} = ${val}; __bh.touch(); return 1; })()`);
        }
        await app.js(`new Promise((q) => { let n = 0; const f = () => (++n > 60 ? q(1) : requestAnimationFrame(f)); f(); })`);
        const counts: number[] = [];
        const blinks: number[] = [];
        // (the bright ones over the SDR's white — an HDR screen shows them, a shot clips them —, over 1.5 × their neighbours)
        const overs: number[] = [];
        for (let k = 0; k < 6; k++) {
          // (the scene's colour before the HUD and the optics — renderer.sceneColor, J1-6 —: a pixel over SP_RATIO × its 8
          // neighbours' mean luminance and over a mid-grey, under the horizon — the sea's rows, 50–85 % of the image)
          const r = await app.js<{ n: number; at: number[]; over: number; what: unknown[] }>(`(async () => {
            const c = await __bh.renderer.sceneColor(__bh.settings), W = c.width, H = c.height, e = c.exposure, d = c.data;
            const L = (x, y) => { const i = 4 * (y * W + x); return e * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); };
            let n = 0, over = 0; const at = [];
            for (let y = Math.floor(H * ${ROWS[0]}); y < Math.floor(H * ${ROWS[1]}); y++) for (let x = 1; x < W - 1; x++) {
              const l = L(x, y); if (!(l > 0.5)) continue;
              let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) s += L(x + i, y + j);
              if (l > ${Number(process.env.SP_RATIO ?? 3)} * s / 8) { n++; if (at.length < 40) at.push(x, y); }
              if (l > 1 && l > 1.5 * s / 8) over++;
            }
            // (what the visibility drew under the first ones — surfaceAt —, their colour and its neighbours': what they are)
            const what = [];
            for (let q = 0; q < Math.min(at.length, 8); q += 2) {
              const x = at[q], y = at[q + 1], i = 4 * (y * W + x), sa = await __bh.renderer.surfaceAt((x + 0.5) / W, (y + 0.5) / H);
              what.push({ x, y, rgb: [d[i], d[i + 1], d[i + 2]].map((v) => +(v * e).toFixed(2)), kind: sa?.kind, ground: sa && Math.round(sa.ground), nearest: sa && Math.round(sa.nearest), level: sa?.level });
            }
            return { n, at, over, what }; })()`);
          if (k === 0) console.log(`    ${side}: what they are ${JSON.stringify(r.what)}`);
          counts.push(r.n);
          overs.push(r.over);
          // (and on the screen as shown — the display's composition, the canopy's glass, the bloom —: two shots a frame apart, the
          // pixels near-white on one and not the other, isolated, the HUD's colours left out)
          const shot = async () => {
            const q = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
            const png = new Uint8Array(Buffer.from(q.data, "base64"));
            return Object.assign(readPng(png), { png });
          };
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          const A = await shot();
          await app.js(`new Promise((q) => requestAnimationFrame(() => requestAnimationFrame(q)))`);
          const B = await shot();
          await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
          if (k === 0) {
            await Bun.write(`${OUT}/${side.replace(/[=]/g, "-")}-${blinks.length}-a.png`, A.png);
            await Bun.write(`${OUT}/${side.replace(/[=]/g, "-")}-${blinks.length}-b.png`, B.png);
          }
          let blink = 0;
          const at = (P: typeof A, x: number, y: number) => {
            const i = P.channels * (y * P.width + x);
            return [P.data[i]!, P.data[i + 1]!, P.data[i + 2]!] as const;
          };
          for (let y = Math.floor(A.height * ROWS[0]); y < Math.floor(A.height * ROWS[1]); y++)
            for (let x = 1; x < A.width - 1; x++) {
              const a = at(A, x, y),
                b = at(B, x, y);
              const la = (a[0] + a[1] + a[2]) / 3,
                lb = (b[0] + b[1] + b[2]) / 3;
              const hi = la > lb ? a : b;
              if (Math.abs(la - lb) < 70 || Math.max(...hi) - Math.min(...hi) > 40 || Math.max(la, lb) < 170) continue;
              blink++;
            }
          blinks.push(blink);
          if (k === 0) console.log(`    ${side}: first sparkles at ${JSON.stringify(r.at.slice(0, 16))}`);
          await app.js(`new Promise((q) => { let n = 0; const f = () => (++n > 8 ? q(1) : requestAnimationFrame(f)); f(); })`);
        }
        // (the flight held? its height and the autopilot's modes — a climbing craft looks at the sky)
        console.log(
          `  ${side}: ${await app.js<string>(`(() => { const c = __bh.camera, g = c.geoNow(); return "alt " + Math.round(g?.alt ?? -1) + " m, ap " + (c.jetModes.alt !== null) + ", athr " + (c.jetModes.spd !== null) + ", gear " + c.gearDown; })()`)}`,
        );
        out[side] = counts;
        out[`${side} blinks`] = blinks;
        out[`${side} over white`] = overs;
        console.log(
          `  ${side}: pixels over the SDR's white, brighter than their neighbours, in the scene's colour ${JSON.stringify(overs)}`,
        );
        console.log(`  ${side}: pixels blinking white between two shown frames ${JSON.stringify(blinks)}`);
        console.log(`  ${side}: isolated white pixels on the sea per shot ${JSON.stringify(counts)}`);
        if (name !== "none") await app.js(`(() => { ${target}.${key} = ${before}; __bh.touch(); return 1; })()`);
      }
      await Bun.write(`${OUT}/results.json`, JSON.stringify(out, null, 1));
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  400_000,
);
