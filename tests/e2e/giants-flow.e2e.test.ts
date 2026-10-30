import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// PLAN-PLANETES-AAA P9 G1–G2 (the giants' clouds moving): Jupiter's and Saturn's bands carried by their zonal winds
// (trace.wgsl giantFlow — two readings half a cycle apart, faded), the Great Red Spot turning on itself, eddies under the
// map's texel up close — Jupiter from orbit at the scene's time and one turn later (the same face under the same Sun: only its
// clouds moved, the two images differ), the Great Red Spot from 25 000 km at both times, Saturn from orbit. No GPU error.
// Duration: ~4 min on kerr-mini.
// Done when: every view shot at both times, the images compared, no GPU error.

const OUT = process.env.OUT ?? "remote-results/giants-flow";
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0 });`;
// (one turn of each — System III: Jupiter's 9.925 h, Saturn's 10.656 h — on the scenes' clock [M]: a second
// 1/(4.925490947e-6 · 10⁸) M)
const TURN = { jupiter: (9.925 * 3600) / (4.925490947e-6 * 1e8), saturn: (10.656 * 3600) / (4.925490947e-6 * 1e8) };
const T0 = 109.6;
// (the Great Red Spot at its noon: the Sun over Jupiter's 13.0° E at T0, 49.62° further west every 10 M)
const GRS_NOON = T0 + 49.7;
const view = (name: string, body: string, pose: string, time: number) =>
  `__bh.presets.${name} = { ...__bh.presets["Jupiter: from orbit"], time: ${time}, target: "${body}", ship: false, pose: ${pose} }; __bh.game.preset("${name}"); ${HOLD}`;

describe.skipIf(!E2E)("P9 G1–G2: the giants' clouds moving", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Jupiter: from orbit")}` });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const settle = (body: string) =>
    app.js(`(async () => { const r = __bh.renderer, t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0 || r.hdMap.name !== ${JSON.stringify(body)}) && performance.now() - t0 < 240000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      const t1 = performance.now();
      while (performance.now() - t1 < 5000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      return 1; })()`);
  const shot = async (name: string) => {
    await app.settled();
    await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
    await app.shot(`${OUT}/${name}.png`);
    await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
  };
  // (the mean absolute difference of two shots over their middle, /255)
  const diff = async (a: string, b: string) => {
    const A = readPng(new Uint8Array(await Bun.file(`${OUT}/${a}.png`).arrayBuffer()));
    const B = readPng(new Uint8Array(await Bun.file(`${OUT}/${b}.png`).arrayBuffer()));
    let s = 0,
      n = 0;
    for (let y = Math.floor(A.height * 0.3); y < A.height * 0.7; y++)
      for (let x = Math.floor(A.width * 0.3); x < A.width * 0.7; x++, n++) {
        const i = (y * A.width + x) * A.channels;
        s += Math.abs(A.data[i]! - B.data[i]!) + Math.abs(A.data[i + 1]! - B.data[i + 1]!) + Math.abs(A.data[i + 2]! - B.data[i + 2]!);
      }
    return s / (3 * n);
  };
  const errors = () => app.js<number>(`(() => __bh.renderer.gpuErrors)()`);

  for (const [name, body, pose] of [
    ["jupiter-orbit", "jupiter", `{ tilt: 60, body: "jupiter", altKm: 200000, phase: 30, look: "jupiter" }`],
    ["jupiter-grs", "jupiter", `{ body: "jupiter", altKm: 25000, at: [-22, 126.4], look: "jupiter", off: [0, 0] }`],
    ["saturn-orbit", "saturn", `{ tilt: 60, body: "saturn", altKm: 300000, phase: 40, at: [-30, 0], look: "saturn" }`],
    // (15 000 km over the rings' plane above the A ring, towards Saturn: Cassini's kilometre profile, the wakes, the spokes)
    ["saturn-rings", "saturn", `{ body: "saturn", altKm: 67664, at: [6.8, 0], look: "saturn", off: [0, 0] }`],
  ] as const)
    test(`${name}: at the scene's time and one turn later, the clouds moved`, async () => {
      for (const [k, t] of [
        ["a", name === "jupiter-grs" ? GRS_NOON : T0],
        ["b", (name === "jupiter-grs" ? GRS_NOON : T0) + TURN[body]],
      ] as const) {
        await app.js(`(() => { ${view(`p9${name.replace("-", "")}${k}`, body, pose, t)} return 1; })()`);
        await settle(body);
        await shot(`${name}-${k}`);
      }
      const d = await diff(`${name}-a`, `${name}-b`);
      console.log(`  ${name}: the two times differ by ${d.toFixed(2)} /255 over the image's middle`);
      expect(d).toBeGreaterThan(0.2);
      expect(await errors()).toBe(0);
    }, 600_000);
});
