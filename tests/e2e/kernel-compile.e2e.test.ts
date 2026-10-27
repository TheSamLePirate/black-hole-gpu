import { afterAll, describe, test } from "bun:test";
import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, E2E, stopServer } from "./lib/app";

// What a cold launch of each reference scene compiles, and how long until it is drawn (docs/PLAN-LEAN-TRACER-KERNELS.md,
// P0): a fresh Chrome per case — its own profile, so the browser's shader cache is empty (the system's Metal cache is not:
// macOS keeps it across profiles, a "cold" start here is warmer than a Windows player's first — unless KC_COLD=1, which
// empties Chrome's GPU-process Metal cache before each case: only on the lab's mini, nothing else of Chrome running) —, the
// scene set, then the
// time to its first traced frame and every tracer compile until the queue is empty (renderer.compileReport()). The same
// cases before and after each phase of the plan: remote-results/kernel-compile.json.
// KC_WARM=1: each case launched twice on one Chrome profile, the second measured as a returning player's launch.
// Duration: ~3–6 min a case on kerr-mini (cold compiles); twice that with KC_WARM
// Done when: every case's compiles are in (or 10 min passed) and the report is written.

const CASES: Record<string, { boot: string; set: string; tiles?: boolean }> = {
  // (the F-35 low over Tarifa: the raster pipeline, the ground's tiles and scenery — the game as it is played)
  "earth-raster": {
    boot: "scene=game:artemis",
    tiles: true,
    set: `Object.assign(__bh.settings, { vessel: "f35", traffic: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true });
      __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
      __bh.settings.shipMount = "cockpit"; __bh.game.flyAt(36.08, -5.6, 700, 20, 240); __bh.settings.earthPipeline = "raster";`,
  },
  "earth-trace": {
    boot: "scene=game:artemis",
    tiles: true,
    set: `Object.assign(__bh.settings, { vessel: "f35", traffic: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true });
      __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
      __bh.settings.shipMount = "cockpit"; __bh.game.flyAt(36.08, -5.6, 700, 20, 240); __bh.settings.earthPipeline = "trace";`,
  },
  moon: { boot: `scene=${encodeURIComponent("Moon: an afternoon on the plains")}`, set: "" },
  mars: { boot: `scene=${encodeURIComponent("Mars: the blue sunset")}`, set: "" },
  kerr: { boot: `scene=${encodeURIComponent("Kerr a=0.94, near edge-on")}`, set: "" },
  wormhole: { boot: `scene=${encodeURIComponent("Wormhole: strong lensing (W = 0.43 ρ)")}`, set: "" },
  gargantua: { boot: `scene=${encodeURIComponent("Interstellar: wormhole to Gargantua")}`, set: "" },
};
const cases = (process.env.CASES ?? "earth-raster,moon,kerr,wormhole").split(",");

/** macOS's Metal shader cache of Chrome's GPU process (per user, kept across Chrome profiles), emptied: a truly cold start */
function emptyMetalCache() {
  const base = Bun.spawnSync(["getconf", "DARWIN_USER_CACHE_DIR"]).stdout.toString().trim();
  for (const app of ["com.google.Chrome.helper", "com.google.Chrome"])
    for (const sub of ["com.apple.metal", "com.apple.metalfe"]) {
      const dir = join(base, app, sub);
      try {
        for (const f of readdirSync(dir)) rmSync(join(dir, f), { recursive: true, force: true });
      } catch {
        /* (none yet) */
      }
    }
}

describe.skipIf(!E2E)("cold launches: what each scene compiles, and how long it waits", () => {
  const rows: unknown[] = [];
  afterAll(async () => {
    await Bun.write("remote-results/kernel-compile.json", `${JSON.stringify(rows, null, 1)}\n`);
    stopServer();
  });
  for (const id of cases)
    test(id, async () => {
      const c = CASES[id];
      if (!c) throw new Error(`no case ${id}: ${Object.keys(CASES).join(", ")}`);
      if (process.env.KC_COLD === "1") emptyMetalCache();
      // (KC_WARM=1: the case launched twice on one kept profile, the second a returning player's launch — Chrome's shader
      // cache lives in the profile, and each e2e Chrome otherwise gets a fresh one: without it a "warm" run only met the
      // system's Metal cache)
      const warm = process.env.KC_WARM === "1";
      const profile = warm ? join(tmpdir(), `kerr-kc-${id}`) : undefined;
      if (profile) rmSync(profile, { recursive: true, force: true });
      try {
        for (const launch of warm ? ["first", "again"] : ["first"]) {
          const app = await App.boot({ width: 1600, height: 1000, hash: c.boot, tiles: c.tiles, profile });
          try {
            // (the measure runs in the page — a DevTools call times out after 5 min —, polled)
            await app.js(`(() => { window.__kc = null; (async () => {
          const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          ${c.set}
          r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
          const t0 = performance.now(); let first = 0, raster = 0, ready = 0;
          while (performance.now() - t0 < 600000) {
            __bh.touch(); await frame();
            if (!first && (r.prof.table().find((p) => p.label === "trace")?.last ?? 0) > 0) first = performance.now();
            // (the raster's material drawing the ground; the scene's own kernel there — or given up)
            if (!raster && r.rasterLiteActive) raster = performance.now();
            if (!ready && r.variantReady) ready = performance.now();
            if (first && ready && r.compilesPending === 0 && performance.now() - first > 3000) break;
          }
          const s = (t) => (t ? (t - t0) / 1000 : -1);
          window.__kc = { t0, firstTraceS: s(first), firstRasterS: s(raster), variantReadyS: s(ready), settledS: (performance.now() - t0) / 1000, report: r.compileReport() };
        })(); return 1; })()`);
            let r: {
              firstRasterS: number;
              variantReadyS: number;
              firstTraceS: number;
              settledS: number;
              report: { count: number; cold: number; seconds: number; compiles: unknown[] };
            } | null = null;
            while (!r) {
              await Bun.sleep(3000);
              r = await app.js(`window.__kc`);
            }
            console.log(
              `  ${id}${warm ? ` (${launch} launch)` : ""}: first trace ${r.firstTraceS.toFixed(1)} s, raster ${r.firstRasterS.toFixed(1)} s, the scene's kernel ${r.variantReadyS.toFixed(1)} s, settled ${r.settledS.toFixed(1)} s, ${r.report.count} compiles (${r.report.cold} cold), ${r.report.seconds.toFixed(0)} s of compile`,
            );
            for (const x of r.report.compiles as { pipeline: string; key: number; seconds: number; ok: boolean }[])
              console.log(
                `    ${x.pipeline.padEnd(26)} key ${String(x.key).padStart(10)}  ${x.seconds.toFixed(1).padStart(6)} s${x.ok ? "" : "  FAILED"}`,
              );
            rows.push({ case: id, launch, ...r });
          } finally {
            app.close();
          }
        }
      } finally {
        if (profile) rmSync(profile, { recursive: true, force: true });
      }
    }, 1_800_000);
});
