import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// PLAN-PLANETES-AAA P9 G1–G8 (the giants' clouds moving): Jupiter's and Saturn's bands carried by their zonal winds
// (trace.wgsl giantFlow — two readings half a cycle apart, faded), the named vortices turning (the Great Red Spot, the
// Oval BA; Saturn's polar cyclone and hexagon), the turbulence tile under the map's texel up close (giantTurb) — each view
// at the scene's time and one turn later (the same face under the same Sun: only its clouds moved, the two images differ);
// the Great Red Spot again at the first time after the jump — the same image: the clouds a function of the date alone —;
// Saturn's rings among their blocks. No GPU error.
// Duration: ~12 min on kerr-mini.
// Done when: every view shot at both times, the images compared, no GPU error.

const OUT = process.env.OUT ?? "remote-results/giants-flow";
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0 });`;
// (one turn of each — System III: Jupiter's 9.925 h, Saturn's 10.656 h — on the scenes' clock [M]: a second
// 1/(4.925490947e-6 · 10⁸) M)
const TURN = { jupiter: (9.925 * 3600) / (4.925490947e-6 * 1e8), saturn: (10.656 * 3600) / (4.925490947e-6 * 1e8) };
const T0 = 109.6;
// (the Great Red Spot at its noon: the Sun over Jupiter's 13.0° E at T0, 49.62° further west every 10 M)
const GRS_NOON = T0 + 49.7;
// (the Oval BA at its noon: 57.7° W, the Sun 70.7° west of where it was at T0)
const OVAL_NOON = T0 + 14.25;
// (Saturn's north pole lit: at the scenes' 2067 its polar night still reaches 11° from the pole, over the hexagon — its
// northern summer solstice, 2076, 9.4 years on: 64 069 M a year)
const SATURN_NORTH = T0 + 9.4 * 64069;
// (the band's flank at 150° E: lit in the Great Red Spot's afternoon)
const START: Record<string, number> = {
  "jupiter-grs": GRS_NOON,
  "jupiter-flank": GRS_NOON,
  "jupiter-oval": OVAL_NOON,
  "saturn-pole": SATURN_NORTH,
};
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

  // (G5: the camera among the rings' blocks, the A ring at 125 000 km — Saturn's equatorial radius 60 268 km —: 40 m over the
  // plane towards Saturn, along it, and 600 m under it — the lit face at this date — looking up)
  for (const [name, lat, off] of [
    ["saturn-blocks-grazing", (40 / 125e6) * 57.2958, "[0, 0]"],
    ["saturn-blocks-along", (40 / 125e6) * 57.2958, "[45, 0]"],
    ["saturn-blocks-under", (-600 / 125e6) * 57.2958, "[0, 30]"],
  ] as const)
    test(`${name}: among the rings' blocks, some drawn`, async () => {
      await app.js(
        `(() => { ${view(`p9${name.replaceAll("-", "")}`, "saturn", `{ body: "saturn", altKm: 64732, at: [${lat}, 0], look: "saturn", off: ${off} }`, T0)} return 1; })()`,
      );
      await settle("saturn");
      const anchor = await app.js<number>(`(() => __bh.renderer.ringBlocksOn ? 1 : 0)()`);
      await shot(name);
      // (blocks lit: a share of the image's lower half brighter than the sky)
      const A = readPng(new Uint8Array(await Bun.file(`${OUT}/${name}.png`).arrayBuffer()));
      let lit = 0,
        n = 0;
      for (let y = Math.floor(A.height * 0.2); y < A.height * 0.8; y += 2)
        for (let x = 0; x < A.width; x += 2, n++) {
          const i = (y * A.width + x) * A.channels;
          if (A.data[i]! + A.data[i + 1]! + A.data[i + 2]! > 60) lit++;
        }
      console.log(`  ${name}: anchored ${anchor}, ${((100 * lit) / n).toFixed(1)} % of the middle lit`);
      expect(anchor).toBe(1);
      expect(lit / n).toBeGreaterThan(0.02);
      expect(await errors()).toBe(0);
    }, 600_000);

  for (const [name, body, pose] of [
    ["jupiter-orbit", "jupiter", `{ tilt: 60, body: "jupiter", altKm: 200000, phase: 30, look: "jupiter" }`],
    ["jupiter-grs", "jupiter", `{ body: "jupiter", altKm: 25000, at: [-22, 126.4], look: "jupiter", off: [0, 0] }`],
    // (G8: a band's flank from 8 000 km, under the map's texel; the Oval BA; Saturn's north pole from above)
    ["jupiter-flank", "jupiter", `{ body: "jupiter", altKm: 8000, at: [-17, 150], look: "jupiter", off: [0, 0] }`],
    ["jupiter-oval", "jupiter", `{ body: "jupiter", altKm: 25000, at: [-32, -57.7], look: "jupiter", off: [0, 0] }`],
    ["saturn-pole", "saturn", `{ body: "saturn", altKm: 90000, at: [89, 0], look: "saturn", off: [0, 0] }`],
    ["saturn-orbit", "saturn", `{ tilt: 60, body: "saturn", altKm: 300000, phase: 40, at: [-30, 0], look: "saturn" }`],
    // (15 000 km over the rings' plane above the A ring, towards Saturn: Cassini's kilometre profile, the wakes, the spokes)
    ["saturn-rings", "saturn", `{ body: "saturn", altKm: 67664, at: [6.8, 0], look: "saturn", off: [0, 0] }`],
  ] as const)
    test(`${name}: at the scene's time and one turn later, the clouds moved`, async () => {
      for (const [k, t] of [
        ["a", START[name] ?? T0],
        ["b", (START[name] ?? T0) + TURN[body]],
      ] as const) {
        await app.js(`(() => { ${view(`p9${name.replace("-", "")}${k}`, body, pose, t)} return 1; })()`);
        await settle(body);
        await shot(`${name}-${k}`);
      }
      const d = await diff(`${name}-a`, `${name}-b`);
      console.log(`  ${name}: the two times differ by ${d.toFixed(2)} /255 over the image's middle`);
      // (G8: back at the first time — the date jumped there and back —, the same clouds)
      if (name === "jupiter-grs") {
        await app.js(`(() => { ${view(`p9${name.replace("-", "")}c`, body, pose, GRS_NOON)} return 1; })()`);
        await settle(body);
        await shot(`${name}-c`);
        const back = await diff(`${name}-a`, `${name}-c`);
        console.log(`  ${name}: back at the first time, ${back.toFixed(3)} /255 from it`);
        expect(back).toBeLessThan(0.1 * d);
      }
      // (the rings' view: only their spokes move from one turn to the next)
      expect(d).toBeGreaterThan(name === "saturn-rings" ? 0.1 : 0.2);
      expect(await errors()).toBe(0);
    }, 600_000);
});
