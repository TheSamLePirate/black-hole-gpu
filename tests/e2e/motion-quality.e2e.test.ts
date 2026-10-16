import { afterAll, beforeAll, describe, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The realtime image's quality while the camera moves (scripts/quality.ts's way, on kerr-mini): a scene, its clock
// held, the view turned a little each frame done (STEP: 0.2° — frame-locked), FRAMES of them; held then (targetSpp 0:
// the last realtime frame kept) and captured; left to converge (targetSpp 64) and captured again — the reference.
// Each config (CONFIGS, or CONF=a,b) on each scene (SCENES=interstellar,…). The PSNR is reckoned off the runner
// (scratchpad psnr2.py over E2E_SHOTS=<dir>: <scene>-<config>.png against <scene>-<config>-ref.png).

const ALIAS: Record<string, string> = {
  interstellar: "Interstellar: along the disk (the film's close pass)",
  kerr: "Kerr a=0.94, near edge-on",
  cinematic: "Cinematic: volumetric disk + jet",
};
const CONFIGS: Record<string, string> = {
  base: "__bh.renderer.tune = {}",
  smoke25: "__bh.renderer.tune = { TUNE_SMOKE_STEP: 0.25 }",
  eps1: "__bh.renderer.tune = { TUNE_EPS_FAR: 1 }",
};
const scenes = (process.env.SCENES ?? "interstellar").split(",");
const confs = process.env.CONF ? process.env.CONF.split(",") : ["base", "smoke25", "base", "smoke25"];
const FRAMES = Number(process.env.FRAMES ?? 60);
const STEP = process.env.STEP ?? "__bh.camera.rotateView(0.2, 0.03, 0)";

describe.skipIf(!E2E)("the realtime image's quality while the camera turns, against the converged one", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: `scene=${encodeURIComponent(ALIAS.kerr!)}` });
    await app.js(`(() => { Object.assign(__bh.settings, { showFps: false, autosave: false }); return 1; })()`);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  for (const sc of scenes)
    for (const cf of confs)
      test(`${sc}: ${cf}`, async () => {
        const name = ALIAS[sc] ?? sc;
        await app.js(`(async () => { __bh.game.preset(${JSON.stringify(name)});
          Object.assign(__bh.settings, { realtimeSubsampling: 4, dynamicResolution: false, animate: false, targetSpp: 64 }); ${CONFIGS[cf]}; return 1; })()`);
        // (its kernel compiled — a few frames first: the key follows the switch at the next one)
        await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
          const t0 = performance.now(); while (!r.variantReady && performance.now() - t0 < 180000) { __bh.touch(); await frame(); }
          for (let i = 0; i < 30; i++) { __bh.touch(); await frame(); } return 1; })()`);
        // (turned a step each frame done, FRAMES of them; then held)
        await app.js(`(async () => { const r = __bh.renderer; let done = 0, last = r.lastDoneAt;
          ${STEP}; __bh.touch();
          while (done < ${FRAMES}) { await new Promise((q) => requestAnimationFrame(q)); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; if (done < ${FRAMES}) { ${STEP}; __bh.touch(); } } }
          __bh.settings.targetSpp = 0; return 1; })()`);
        await Bun.sleep(600);
        await shot(`${sc}-${cf}`);
        await app.js(`(() => { __bh.settings.targetSpp = 64; __bh.touch(); return 1; })()`);
        for (let i = 0; i < 120; i++) {
          await Bun.sleep(500);
          if (await app.js<boolean>(`__bh.renderer.lastPhase === "converged"`)) break;
        }
        await shot(`${sc}-${cf}-ref`);
        await app.js(`(() => { __bh.renderer.tune = {}; return 1; })()`);
      }, 600_000);
});
