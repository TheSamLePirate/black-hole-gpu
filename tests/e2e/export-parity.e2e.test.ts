import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";
import { readPng, writePng } from "./lib/png";
// Probe — no assertion but no GPU error; not in `bun run e2e`: E2E_PROBE=1 — (PLAN-J5 J5-4) the exported image against the screen: the
// game's flight from the cockpit (J0's start, the HUD off), the world frozen, the exposure held, the interface hidden; the canvas as shown (a DevTools screenshot)
// against renderer.exportRGBA (the 8-bit export: its own post and display pass; `shown` — the image as the screen shows it, PLAN-J5
// J5-4 — unless EXPORT_SHOWN=0: the native image at the render's scale), both reduced to 16 × 9 blocks'
// mean colours — no pixel alignment between a canvas shown at another size and its target —, their mean and largest |difference|
// (0–255) by channel. Controls (method rule 3): two screenshots of the same state (A/A, its floor) and the screen after +1 EV of
// exposure against the export before (the positive: the probe must see it). Logged, shots kept (SDR: kerr-mini's display).
// Duration: ~3 min on kerr-mini.
// Done when: the screen, the export and both controls compared.
afterAll(stopServer);
const OUT = process.env.EXPORT_OUT ?? "remote-results/export-parity";
const BW = 16;
const BH = 9;
type Px = { width: number; height: number; channels: number; data: Uint8Array | Uint8ClampedArray };
const blocks = (p: Px) => {
  const out = new Float64Array(BW * BH * 3);
  const n = new Float64Array(BW * BH);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const b = Math.min(BH - 1, Math.floor((y * BH) / p.height)) * BW + Math.min(BW - 1, Math.floor((x * BW) / p.width));
      const i = (y * p.width + x) * p.channels;
      for (let c = 0; c < 3; c++) out[b * 3 + c]! += p.data[i + c]!;
      n[b]!++;
    }
  for (let b = 0; b < BW * BH; b++) for (let c = 0; c < 3; c++) out[b * 3 + c]! /= Math.max(n[b]!, 1);
  return out;
};
const diff = (a: Float64Array, b: Float64Array) => {
  let sum = 0;
  let max = 0;
  let at = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    sum += d;
    if (d > max) [max, at] = [d, Math.floor(i / 3)];
  }
  // (the worst block: its column and row of the 16 × 9)
  return { mean: +(sum / a.length).toFixed(2), max: +max.toFixed(1), worst: [at % BW, Math.floor(at / BW)] };
};
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the exported image against the screen: block colours, an A/A and a +1 EV positive",
  async () => {
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      // (J0's start — Toulon-Hyères, 500 m over the sea, the afternoon —: a daylit image, the HUD and the screens off, the cockpit's frame
      // kept; the orbit's black and its stars could not tell +1 EV from nothing, a first run)
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, dynamicResolution: false,
          hudJet: "off", hudHorizon: false, hudHeading: false, hudBank: false, hudMarkers: false, hudEdge: false, hudAoA: false, hudEnergy: false,
          hudDirector: false, hudPath: false, hudFuture: false, hudImpact: false, hudRunway: false });
        __bh.game.setDate("${J0_SCENE.date}"); __bh.game.flyAt(${J0_SCENE.start.join(", ")}); __bh.settings.shipMount = "cockpit";
        __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
      await app.dataSettled("export parity", { maxMs: 90_000 }).catch((e) => console.log(`(not settled: ${String(e).slice(0, 160)})`));
      await app.settled();
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(true);
        const ev = __bh.renderer.ev(__bh.settings); Object.assign(__bh.settings, { autoExposure: false, exposure: ev });
        document.body.classList.add("hide-ui"); for (let i = 0; i < 90; i++) { __bh.touch(); await f(); } return 1; })()`);
      const screen = async (name: string) => {
        const f = `${OUT}/${name}.png`;
        await app.shot(f);
        return readPng(new Uint8Array(await Bun.file(f).arrayBuffer()));
      };
      const A = await screen("screen-a");
      const A2 = await screen("screen-b");
      const ex = await app.js<{ width: number; height: number; b64: string }>(`(async () => {
        const r = await __bh.renderer.exportRGBA(__bh.settings, ${process.env.EXPORT_SHOWN !== "0"}); let s = ""; const d = r.data;
        for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
        return { width: r.width, height: r.height, b64: btoa(s) }; })()`);
      const E = { width: ex.width, height: ex.height, channels: 4, data: Uint8Array.from(atob(ex.b64), (c) => c.charCodeAt(0)) };
      // (the export kept beside the screens)
      const rgb = new Uint8Array(E.width * E.height * 3);
      for (let k = 0; k < E.width * E.height; k++) for (let c = 0; c < 3; c++) rgb[k * 3 + c] = E.data[k * 4 + c]!;
      await Bun.write(`${OUT}/export.png`, writePng(E.width, E.height, rgb));
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.settings.exposure += 1;
        for (let i = 0; i < 30; i++) { __bh.touch(); await f(); } return 1; })()`);
      const P = await screen("screen-plus1ev");
      const [a, a2, e, p] = [A, A2, E, P].map(blocks) as Float64Array[];
      console.log(
        JSON.stringify({
          screen: [A.width, A.height],
          export: [E.width, E.height],
          aa: diff(a!, a2!),
          exportVsScreen: diff(e!, a!),
          positivePlus1Ev: diff(p!, e!),
          meanScreen: +(a!.reduce((x, y) => x + y, 0) / a!.length).toFixed(1),
          meanExport: +(e!.reduce((x, y) => x + y, 0) / e!.length).toFixed(1),
        }),
      );
      await app.js(
        `(() => { document.body.classList.remove("hide-ui"); Object.assign(__bh.settings, { autoExposure: true, exposure: 0 }); __bh.freeze(false); return 1; })()`,
      );
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  600_000,
);
