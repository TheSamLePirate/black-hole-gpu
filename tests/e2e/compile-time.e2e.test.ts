import { afterAll, describe, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// How long a scene's tracer takes to compile before its first traced frame (on kerr-mini): booted on one scene
// (BOOT), then each of SCENES set — the time until a trace pass is drawn (its kernel specialised, compiled), and the
// graphics diagnostic's compile records. To compare two builds' kernels (a branch against main).

const ALIAS: Record<string, string> = {
  interstellar: "Interstellar: along the disk (the film's close pass)",
  kerr: "Kerr a=0.94, near edge-on",
  cinematic: "Cinematic: volumetric disk + jet",
  saturn: "Saturn: backlit",
};
const BOOT = ALIAS[process.env.BOOT ?? "kerr"] ?? process.env.BOOT!;
const SCENES = (process.env.SCENES ?? "interstellar,cinematic").split(",").map((x) => ALIAS[x] ?? x);

describe.skipIf(!E2E)("a scene's tracer compile time", () => {
  let app: App;
  afterAll(() => {
    app?.close();
    stopServer();
  });
  test("each scene: until its first trace pass", async () => {
    const t0 = performance.now();
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent(BOOT)}` });
    console.log(`  boot (${BOOT}): ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    for (const sc of SCENES) {
      const s = await app.js<number>(`(async () => {
        const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
        __bh.game.preset(${JSON.stringify(sc)}); Object.assign(__bh.settings, { realtimeSubsampling: 4, animate: false });
        r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
        const t0 = performance.now();
        for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
        while (performance.now() - t0 < 600000) {
          __bh.touch(); await frame();
          if (r.variantReady && (r.prof.table().find((p) => p.label === "trace")?.last ?? 0) > 0) break;
        }
        return (performance.now() - t0) / 1000; })()`);
      console.log(`  ${sc}: first trace after ${s.toFixed(1)} s`);
    }
    const diag = await app.js<string>(`JSON.stringify(__bh.graphicsDiagnostic?.() ?? null)`);
    const lines = (diag.match(/tracer [^"]*?features \\d+: [\\d.]+ s[^"]*/g) ?? []).slice(0, 30);
    console.log(`  compiles:\n${lines.map((l) => `    ${l}`).join("\n")}`);
  }, 1_500_000);
});
