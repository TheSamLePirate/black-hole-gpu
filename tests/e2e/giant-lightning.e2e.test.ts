import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { giantFlashes } from "../../src/system/giant-clouds";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// The giants' lightning drawn where the CPU's twin says (PLAN-PLANETES-AAA P11 D4–D5: trace.wgsl giantFlashes, its twin
// system/giant-clouds.ts — the thunder's, the calls'): by night in Jupiter near a storm, 3 km under 1 bar, the instants the
// twin finds a near flash bright and those it finds none, each drawn (the clock held, the image redrawn whole) and its
// brightness read — the flashes' frames far brighter than the dark ones. And the AIR panel's figures there: its pressure
// and temperature Galileo's (~1.13 bar, ~172 K 3 km under 1 bar), the night.
// Duration: ~3 min on kerr-mini
// Done when: the lit and dark instants compared, the panel read.

const OUT = "remote-results/giant-lightning";
const T0 = 109.6;
const NOON = T0 + 49.7;
const SPM = 492.5490947;
const TURN = (9.925 * 3600) / SPM;
const T_NIGHT = NOON + 0.5 * TURN;
afterAll(stopServer);

test.skipIf(!E2E)(
  "Jupiter's lightning by night: the twin's flashes drawn, the dark instants dark; the AIR panel",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 720, hash: `scene=${encodeURIComponent("Jupiter: from orbit")}` });
    await app.js(
      `(() => { __bh.presets.zzl = { ...__bh.presets["Jupiter: from orbit"], time: ${T_NIGHT}, target: "jupiter", ship: false, fov: 70, pose: { body: "jupiter", altKm: -3, at: [-12, 126.4], heading: 270, tilt: 4 } };
        __bh.game.preset("zzl"); Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0, autoExposure: true, exposure: 0 }); return 1; })()`,
    );
    await app.settled();
    // (every kernel compiled — the refining one's whole cascade too)
    await app.js(`(async () => { const r = __bh.renderer, t0 = performance.now();
      while ((!r.kernelsSettled || r.compilingNow.length > 0 || r.variants.get(r.featureKey)?.qBusy) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      return 1; })()`);
    const nc = await app.js<{ id: string; c: [number, number, number]; mR: number; tc: number }>("__bh.renderer.nearCamera");
    console.log(
      `  ${nc.id}: the camera ${(((Math.hypot(...nc.c) - 1) * nc.mR) / 1e3).toFixed(1)} km off 1 bar, the clock ${nc.tc.toFixed(3)} s`,
    );
    expect(nc.id).toBe("jupiter");
    // (the instants: a near flash bright — within 80 km, its light over 0.6 —, or none at all)
    const lit: number[] = [];
    const dark: number[] = [];
    for (let dt = 0; dt < 120 && (lit.length < 5 || dark.length < 5); dt += 1 / 60) {
      const f = giantFlashes(4, nc.c, nc.mR, nc.tc + dt);
      const near = f.some((x) => x.light > 0.6 && Math.hypot(x.pos[0] - nc.c[0], x.pos[1] - nc.c[1], x.pos[2] - nc.c[2]) * nc.mR < 80e3);
      if (near && lit.length < 5 && (!lit.length || dt - lit[lit.length - 1]! > 1)) lit.push(dt);
      if (!f.length && dark.length < 5 && (!dark.length || dt - dark[dark.length - 1]! > 1)) dark.push(dt);
    }
    expect(lit.length).toBe(5);
    expect(dark.length).toBe(5);
    // (the exposure held at the scene's, frame by frame: the meter would chase each)
    const ev = await app.js<number>("__bh.renderer.autoExposureEV");
    const mean = async (dt: number, tag: string) => {
      await app.js(`(async () => { const r = __bh.renderer; r.autoExposureEV = ${ev}; __bh.sim.setTime(${T_NIGHT} + ${dt} / ${SPM}); __bh.step(0);
        const c0 = r.completedFrames, t0 = performance.now();
        while (r.completedFrames < c0 + 4 && performance.now() - t0 < 8000) { r.autoExposureEV = ${ev}; __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
        return 1; })()`);
      const shot = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      const bytes = Buffer.from(shot.data, "base64");
      await Bun.write(`${OUT}/${tag}.png`, bytes);
      const px = readPng(bytes);
      let s = 0;
      // (the middle of the image: the FPS meter and the bars out)
      for (let y = Math.floor(px.height * 0.1); y < px.height * 0.9; y += 4)
        for (let x = 0; x < px.width; x += 4) {
          const i = (y * px.width + x) * px.channels;
          s += 0.2126 * px.data[i]! + 0.7152 * px.data[i + 1]! + 0.0722 * px.data[i + 2]!;
        }
      return s / ((px.height * 0.8 * px.width) / 16) / 255;
    };
    const L: number[] = [];
    const D: number[] = [];
    for (const [k, dt] of lit.entries()) L.push(await mean(dt, `lit-${k}`));
    for (const [k, dt] of dark.entries()) D.push(await mean(dt, `dark-${k}`));
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
    console.log(`  lit (+${lit.map((x) => x.toFixed(2)).join(", ")} s): ${L.map((x) => x.toFixed(4)).join(" ")}`);
    console.log(`  dark (+${dark.map((x) => x.toFixed(2)).join(", ")} s): ${D.map((x) => x.toFixed(4)).join(" ")}`);
    // (the flashes' frames far brighter than the dark ones: the shader's flashes where the twin finds them)
    expect(med(L)).toBeGreaterThan(5 * med(D) + 0.005);
    expect(Math.min(...L)).toBeGreaterThan(Math.max(...D));
    // (the AIR panel's figures there — the controller's, the camera's place: Galileo's air a few km under 1 bar)
    const air = await app.js<{ h: number; p: number; T: number; deck: string | null; mu0: number; wind: number } | null>(
      "__bh.camera.giantAirFigures?.() ?? null",
    );
    console.log(`  air: ${JSON.stringify(air)}`);
    expect(air).not.toBeNull();
    expect(air!.h / 1e3).toBeCloseTo(-3, 0);
    // (e^(3/25): ~1.13 bar — the scale height ~25 km)
    expect(air!.p / 1e5).toBeGreaterThan(1.08);
    expect(air!.p / 1e5).toBeLessThan(1.18);
    expect(air!.T).toBeGreaterThan(170);
    expect(air!.T).toBeLessThan(190);
    expect(air!.mu0).toBeLessThan(-0.15);
    app.close();
  },
  1_200_000,
);
