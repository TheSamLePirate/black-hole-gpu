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
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the sea's white sparkles: what makes them",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 900, lang: "fr", hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const [lat, lon, agl, hdg, v] = J0_SCENE.start;
      await app.js(`(() => { __bh.game.setDate("${J0_SCENE.date}"); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${v});
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
      await app.settled(180_000);
      await app.dataSettled("sparkles: Toulon-Hyères", { maxMs: 60_000 }).catch((e) => console.log(`  (${String(e).slice(0, 120)})`));
      // (the autopilot and autothrottle on: a steady flight)
      await app.js(`(async () => { const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
        for (let i = 0; i < 90; i++) { await f(); __bh.settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true;
          if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          if (c.jetModes.alt !== null && c.jetModes.spd !== null && i > 10) break; }
        const g = c.geoNow(); if (g) c.jetModes.alt = g.alt; c.jetModes.spd = 140; return 1; })()`);
      const sides = (process.env.SP_SWITCHES ?? "none,identityReject=false,shipInScene=false").split(",");
      const out: Record<string, number[]> = {};
      for (const side of sides) {
        const [name, val] = side.split("=");
        if (name !== "none") {
          if (!/^[A-Za-z]+$/.test(name!)) throw new Error(`SP_SWITCHES: ${side}`);
          await app.js(`(() => { __bh.renderer.${name} = ${val}; return 1; })()`);
        }
        await app.js(`new Promise((q) => { let n = 0; const f = () => (++n > 60 ? q(1) : requestAnimationFrame(f)); f(); })`);
        const counts: number[] = [];
        const blinks: number[] = [];
        for (let k = 0; k < 6; k++) {
          // (the scene's colour before the HUD and the optics — renderer.sceneColor, J1-6 —: a pixel over SP_RATIO × its 8
          // neighbours' mean luminance and over a mid-grey, under the horizon — the sea's rows, 50–85 % of the image)
          const r = await app.js<{ n: number; at: number[] }>(`(async () => {
            const c = await __bh.renderer.sceneColor(__bh.settings), W = c.width, H = c.height, e = c.exposure, d = c.data;
            const L = (x, y) => { const i = 4 * (y * W + x); return e * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); };
            let n = 0; const at = [];
            for (let y = Math.floor(H * 0.5); y < Math.floor(H * 0.85); y++) for (let x = 1; x < W - 1; x++) {
              const l = L(x, y); if (!(l > 0.5)) continue;
              let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) s += L(x + i, y + j);
              if (l > ${Number(process.env.SP_RATIO ?? 3)} * s / 8) { n++; if (at.length < 40) at.push(x, y); }
            }
            return { n, at }; })()`);
          counts.push(r.n);
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
          for (let y = Math.floor(A.height * 0.5); y < Math.floor(A.height * 0.85); y++)
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
        out[side] = counts;
        out[`${side} blinks`] = blinks;
        console.log(`  ${side}: pixels blinking white between two shown frames ${JSON.stringify(blinks)}`);
        console.log(`  ${side}: isolated white pixels on the sea per shot ${JSON.stringify(counts)}`);
        if (name !== "none") await app.js(`(() => { __bh.renderer.${name} = ${val === "false" ? "true" : "false"}; return 1; })()`);
      }
      await Bun.write(`${OUT}/results.json`, JSON.stringify(out, null, 1));
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  400_000,
);
