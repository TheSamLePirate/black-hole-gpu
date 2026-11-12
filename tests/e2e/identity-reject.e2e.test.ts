import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED } from "./lib/j0-scene";

// PLAN-J1, after J1-5 — the history's rejection by identity (renderer.identityReject, post.wgsl identityKept): a pixel whose surface's
// word (object | generation) is nowhere in the 3 × 3 about where its history is taken, in the frame before's identity, starts again
// without history (off by default since its first run, 12 Nov: it softened the near forest). The F-35 low over the Maures' forest
// north of Hyères (IR_AGL, 120 m over the ground, 140 m/s, its autopilot holding),
// from the cockpit and from behind, the rejection off then on then on then off (A B B A, renderer.identityReject), each side the same
// snapshot flown 4 s of simulated time (the same place): a shot of each, the
// GPU time of the images over 3 s each (renderer.lastGpuMs, median), the visibility's identity read under the view (trees there);
// a board of the off/on shots and the forest's crops (IR_OUT/board.jpg).
// IR_OUT (remote-results/identity-reject), IR_W × IR_H (1440 × 810).
// Duration: ~4 min (boot, the forest's data, two views × four sides of ~15 s).
// Done when: both views shot both ways with trees in view, the GPU times taken, no GPU error.

const OUT = process.env.IR_OUT ?? "remote-results/identity-reject";
/** the height over the ground at the start [m] (IR_AGL) */
const AGL = Number(process.env.IR_AGL ?? 120);
const W = Number(process.env.IR_W ?? 1440),
  H = Number(process.env.IR_H ?? 810);
afterAll(stopServer);

test.skipIf(!E2E)(
  "the history rejected where the surface's identity changed: the forest flown low, off and on",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: W, height: H, lang: "fr", hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}, { earthClouds: 0 }); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const has = await app.js<boolean>(`"identityReject" in __bh.renderer`);
      const place = `__bh.game.setDate("2026-07-10T09:30:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
        __bh.game.flyAt(43.19, 6.2, ${AGL}, 60, 140); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
      await app.settled(180_000);
      await app
        .dataSettled("identity: the Maures", { maxMs: 60_000 })
        .catch((e) => console.log(`  (data not settled: ${String(e).slice(0, 160)})`));
      // (placed again on the relief now in — E2E-VOLS §5.4 —, its snapshot: each side flies the same start — J0's ablations' way)
      const save = await app.js<string>(
        `(() => { __bh.freeze(false); ${place} __bh.freeze(true); return JSON.stringify(__bh.game.snapshot("identity")); })()`,
      );
      /** the snapshot loaded, the mount set, the clock running, the autopilot and autothrottle engaged, then 4 s of simulated time */
      const start = async (mount: string) => {
        await app.js(`(() => { __bh.freeze(false); __bh.game.importSave(${JSON.stringify(save)}, false); __bh.freeze(true);
          __bh.settings.shipMount = "${mount}"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
        await app.settled(120_000);
        const ap = await app.js<{ ap: boolean; athr: boolean }>(`(async () => {
          __bh.freeze(false); const c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < 90; i++) { await frame();
            if (c.jetModes.alt === null) c.jetToggle("ap");
            if (c.jetModes.spd === null) c.jetToggle("athr");
            if (c.jetModes.alt !== null && c.jetModes.spd !== null && i >= 10) break; }
          const g = c.geoNow(); if (g && c.jetModes.alt !== null) c.jetModes.alt = g.alt;
          c.jetModes.spd = 140; const t0 = __bh.sim.time;
          for (let i = 0; i < 1200 && __bh.sim.time - t0 < 4; i++) await frame();
          return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null }; })()`);
        if (!ap.ap || !ap.athr) throw new Error(`the autopilot ${ap.ap} / autothrottle ${ap.athr} not engaged`);
      };
      const out: Record<string, unknown> = {};
      for (const mount of ["cockpit", "chase"] as const) {
        for (const [k, on] of (has ? [false, true, true, false] : [false]).entries()) {
          await app.js(`(() => { __bh.renderer.identityReject = ${on}; return 1; })()`);
          await start(mount);
          // (the shot at the same simulated time each side: the same place)
          if (k < 2) await app.shot(`${OUT}/${mount}-${on ? "on" : "off"}.png`);
          const m = await app.js<{ gpu: number; n: number; agl: number; errors: number }>(`(async () => {
            const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q)), g = [];
            let last = r.completedFrames ?? 0; const t0 = performance.now();
            while (performance.now() - t0 < 3000) { await f(); const d = r.completedFrames ?? 0; if (d !== last && r.lastGpuMs > 0) g.push(r.lastGpuMs); last = d; }
            g.sort((a, b) => a - b); const F = __bh.fleet, pose = F.pose(F.active, __bh.sim.time);
            return { gpu: +(g[Math.floor(g.length / 2)] ?? 0).toFixed(2), n: g.length, agl: Math.round(__bh.sys.heightOverGround("earth", pose.X, __bh.sim.time)), errors: r.gpuErrors }; })()`);
          // (the pixels the identity turned away, a frame's mean over 10 frames — the counter counts with the rejection off too:
          // where it would have)
          const rej = await app.js<{
            temporal: number;
            taau: number;
          }>(`(async () => { const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
            if (!r.identityRejects) return { temporal: -1, taau: -1 }; let a = 0, b = 0;
            for (let i = 0; i < 10; i++) { await f(); const x = await r.identityRejects(); a += x.temporal; b += x.taau; }
            return { temporal: Math.round(a / 10), taau: Math.round(b / 10) }; })()`);
          const tag = `${mount}-${on ? "on" : "off"}-${k}`;
          // (the trees under the view: the identity's lower rows)
          const ids = await app.js<{ trees: number; read: number }>(`(async () => { let trees = 0, read = 0;
            for (let i = 0; i < 7; i++) { const s = await __bh.renderer.surfaceAt((i + 0.5) / 7, 0.8); if (s) { read++; if (s.kind === "tree") trees++; } }
            return { trees, read }; })()`);
          out[tag] = { ...m, ...ids, rejects: rej, mount: await app.js<string>("__bh.settings.shipMount") };
          console.log(
            `  ${tag}: GPU p50 ${m.gpu} ms over ${m.n} images; ${m.agl} m over the ground; trees ${ids.trees}/${ids.read} at 0.8; turned away by identity ${rej.temporal} px (temporal) / ${rej.taau} (taau) a frame; GPU errors ${m.errors}`,
          );
        }
      }
      await Bun.write(`${OUT}/results.json`, JSON.stringify(out, null, 1));
      if (has) {
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
        const args: string[] = [];
        for (const m of ["cockpit", "chase"]) {
          args.push(
            "(",
            ...lab(`${OUT}/${m}-off.png`, `${m} — historique sans rejet par identité`),
            ...lab(`${OUT}/${m}-on.png`, `${m} — rejet par identité`),
            "+append",
            ")",
          );
          // (a band below the centre: the forest ahead of the craft)
          const c = (f: string, t: string) => [
            "(",
            f,
            "-gravity",
            "center",
            "-crop",
            "60%x22%+0+150",
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
          args.push("(", ...c(`${OUT}/${m}-off.png`, "la forêt — sans"), ...c(`${OUT}/${m}-on.png`, "la forêt — avec"), "+append", ")");
        }
        const made = await $`magick ${[...args, "-append", "-quality", "84", `${OUT}/board.jpg`]}`.nothrow().quiet();
        console.log(made.exitCode ? `  the board not made: ${made.stderr.toString().slice(0, 300)}` : `  board: ${OUT}/board.jpg`);
        const trees = Object.values(out).reduce((a: number, v) => a + (v as { trees: number }).trees, 0);
        expect(trees).toBeGreaterThan(0);
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  480_000,
);
