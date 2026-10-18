import { afterAll, beforeAll, describe, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The render's costs on held scenes (scripts/trace-ab.ts's way, in one build, on kerr-mini): each scene set, its
// clock held, the view marked changed every frame (__bh.touch: the realtime pass, the same rays each frame); every
// frame profiled (prof.every = 1) — the trace pass, the probes, the far field's LUT, the reconstruction (resolve,
// gather, temporal: compute passes, their own times — Apple's render passes' timestamps overlap: the craft's raster
// is read as the whole frame's interval only, snapped to the 50 Hz screen's 20 ms). The black hole's scenes, the
// planets' (in the viewer: no craft, no cockpit), the low flight's from the cockpit (the game, after them).
//   SCENES=a,b (the short names below, or presets), SUB=4 (the realtime subsampling), FRAMES=60,
//   AB=<name> (ABS below) or "name;js A;js B" — each scene measured A, B, A, B (REPS=2 pairs), the switch put back to A after.
// E2E_SHOTS=<dir>: each scene's image (and its B's; COST=1,9,… its cost views — renderer.costView; 14, 15 their raw
// counts read back and printed: renderer.costStats), perf.json.

const FLIGHT: Record<string, string> = {
  "flight: Tarifa, cockpit": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.3);
    __bh.game.flyAt(36.1, -5.55, 900, 200, 210); __bh.settings.shipMount = "cockpit";`,
  "flight: the Alps, cockpit": `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "cockpit";`,
  // (the air at dusk and by moonlight — the aerial table's half floats at a high exposure: AB=aerial; the dusk's view
  // towards the sun's glow over the sea, the night's under the full moon)
  "flight: Tarifa at dusk, cockpit": `__bh.game.setDate("2026-07-29T20:15:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(36.1, -5.55, 900, 290, 210); __bh.settings.shipMount = "cockpit";`,
  // (the sun's disc setting over the sea: a sky column by a sea column of the aerial table — AB=aerial)
  "flight: Tarifa at sunset, cockpit": `__bh.game.setDate("2026-07-29T19:28:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(36.1, -5.55, 900, 292, 210); __bh.settings.shipMount = "cockpit";`,
  "flight: Tarifa by moonlight, cockpit": `__bh.game.setDate("2026-07-29T23:30:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(36.1, -5.55, 900, 200, 210); __bh.settings.shipMount = "cockpit";`,
};
const DEFAULT = [
  "Interstellar: along the disk (the film's close pass)",
  "Kerr a=0.94, near edge-on",
  "Cinematic: volumetric disk + jet",
  "Miller: Gargantua over the sea",
  "Saturn: backlit",
  "Moon: an afternoon on the plains",
  "Earth: Yosemite Valley from Tunnel View",
  "flight: the Alps, cockpit",
  "flight: Tarifa, cockpit",
];
// (short names: the remote runner passes the command through a shell)
const ALIAS: Record<string, string> = {
  interstellar: "Interstellar: along the disk (the film's close pass)",
  kerr: "Kerr a=0.94, near edge-on",
  cinematic: "Cinematic: volumetric disk + jet",
  miller: "Miller: Gargantua over the sea",
  saturn: "Saturn: backlit",
  moon: "Moon: an afternoon on the plains",
  yosemite: "Earth: Yosemite Valley from Tunnel View",
  andes: "Earth: sunset over the Andes",
  brittany: "Earth: a winter afternoon in Brittany",
  himalaya: "Earth: the Himalaya from orbit",
  alps: "flight: the Alps, cockpit",
  tarifa: "flight: Tarifa, cockpit",
  "tarifa-dusk": "flight: Tarifa at dusk, cockpit",
  "tarifa-night": "flight: Tarifa by moonlight, cockpit",
  "tarifa-sunset": "flight: Tarifa at sunset, cockpit",
};
/** AB=<name>: the switches compared (A, then B) */
const ABS: Record<string, [string, string, string, string?]> = {
  mask: ["the cockpit's mask on → off", "__bh.renderer.cockpitMask = true", "__bh.renderer.cockpitMask = false"],
  // (renderer.tune: trace.wgsl's TUNE_* — what a loop's count costs)
  air16: ["the air's samples 32 → 16", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_AIR_N: 16 }"],
  air8: ["the air's samples 32 → 8", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_AIR_N: 8 }"],
  shadow24: [
    "the relief's shadow steps 48 → 24 (the same reach)",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_SHADOW_N: 24, TUNE_SHADOW_K: 1.3924 }",
  ],
  noshadow: ["the relief's shadows → none", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SHADOW_N: 0 }"],
  probe2: ["the craft's probe every frame → every other", "__bh.renderer.probeEveryMoving = 1", "__bh.renderer.probeEveryMoving = 2"],
  epsfar: ["the geodesics' tolerance far from the hole × 3 → × 1", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_EPS_FAR: 1 }"],
  aerial: [
    "the air from the aerial perspective's table → marched by each ray",
    "__bh.renderer.aerialTable = true",
    "__bh.renderer.aerialTable = false",
    // (its pass's kernel compiled after the first image: A waits for it)
    "!!__bh.renderer.aerialPipe",
  ],
  // (the aerial table's half floats: its light × the pre-exposure → raw, as before the 18/10 audit — at dusk, at night)
  aerialraw: [
    "the aerial table's light pre-exposed → raw",
    "__bh.renderer.aerialPreExposed = true",
    "__bh.renderer.aerialPreExposed = false",
    "!!__bh.renderer.aerialPipe",
  ],
  stepbodies: [
    "the per-step tests of Gargantua's bodies → skipped (a measure)",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_STEP_BODIES: 0 }",
  ],
  ceiling: [
    "the ground's marches under the relief's ceiling → under 9 600 m",
    "__bh.renderer.reliefCeiling = true",
    "__bh.renderer.reliefCeiling = false",
  ],
  march9: [
    "the ground's march steps 0.5 → 0.9 of the clearance (a measure)",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_MARCH_K: 0.9 }",
  ],
  relax: ["the ground's march over-relaxed ×1.6 → not", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_RELAX: 1 }"],
  // (bounds, not candidates: what fewer of a loop's steps could give — the march's steps twice as long, unsafe; the
  // relief's shadows on a quarter of their steps)
  k1: ["the ground's march steps 0.5 → 1 of the clearance (unsafe)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_MARCH_K: 1 }"],
  shadow12: ["the relief's shadows 48 → 12 steps", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SHADOW_N: 12 }"],
  relaxband: [
    "the ground's march over-relaxed near the ground too → on the way in only",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_RELAX_BAND: 1 }",
  ],
  // (a candidate's switch: trace.wgsl TUNE_BODY_REJECT)
  bodyreject: [
    "the bodies far from a step rejected early → not",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_BODY_REJECT: 0 }",
  ],
  // (the ground's shading, a part of it left out — trace.wgsl TUNE_GSKIP)
  ...Object.fromEntries(
    (
      [
        ["gnormal", 1, "the relief's own normal near"],
        ["gshadow", 2, "the relief's shadows"],
        ["gcover", 4, "the near materials (snow, rock)"],
        ["gfine", 8, "the fine noise's colour and light"],
        ["gclouds", 16, "the clouds' and the weather's shadows"],
        ["gimagery", 32, "the tiles' imagery"],
        ["gsurface", 64, "the surface textures"],
        ["gsea", 128, "the sea's shading"],
        ["gosm", 256, "the scenery's surfaces"],
      ] as const
    ).map(([k, b, what]) => [
      k,
      [`${what} → left out (a measure)`, "__bh.renderer.tune = {}", `__bh.renderer.tune = { TUNE_GSKIP: ${b} }`],
    ]),
  ),
  shadowrelax: [
    "the relief's shadows stepped by their clearance → by their growth alone",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_SHADOW_RELAX: 0 }",
  ],
  warpgrid: [
    "the mountains' warp from its grids → worked out by each ray",
    "__bh.renderer.warpGrid = true",
    "__bh.renderer.warpGrid = false",
  ],
  cheap: ["the tiles' heights B-spline → bilinear (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_CHEAP: 1 }"],
  flatground: ["the Earth's ground shaded → flat (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SKIP: 8192 }"],
  warp: ["the mountains' warp on → off (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_WARP: 0 }"],
  detail: ["the ground's detail on → off (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_DETAIL: 0 }"],
  skipbg: ["the background → skipped (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SKIP: 1 }"],
  skippts: ["the far points → skipped (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SKIP: 2 }"],
  skipour: ["ourSegment → skipped (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SKIP: 4 }"],
  skipsky: ["the sky ray past the near world → skipped (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SKIP: 16 }"],
  skipour32: ["ourSegment's bodies met → skipped (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SKIP: 32 }"],
  skipour64: ["ourSegment's rings → skipped (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SKIP: 64 }"],
  skipour128: ["ourSegment's worlds' air → skipped (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SKIP: 128 }"],
  skipour768: [
    "ourSegment's corona and stars' discs → skipped (a measure)",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_SKIP: 768 }",
  ],
  merge: [
    "the wormhole's steps merged for ourSegment → each on its own",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_MERGE: 0 }",
  ],
  skipkick: [
    "the Kerr loop's weak fields' kick → skipped (a measure)",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_SKIP: 1024 }",
  ],
  skipthick: ["the Kerr loop's thick disk → skipped (a measure)", "__bh.renderer.tune = {}", "__bh.renderer.tune = { TUNE_SKIP: 2048 }"],
  skipcross: [
    "the Kerr loop's equatorial crossings → skipped (a measure)",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_SKIP: 4096 }",
  ],
  noop: ["the same → the same (the noise floor of a comparison)", "__bh.renderer.tune = {}", "__bh.renderer.tune = {}"],
  smoke5: [
    "the realtime steps through the disk's smoke 0.25 → 0.5 M",
    "__bh.renderer.tune = {}",
    "__bh.renderer.tune = { TUNE_SMOKE_STEP: 0.5 }",
  ],
  bodies: ["the bodies listed → all looked at", "__bh.renderer.bodyList = true", "__bh.renderer.bodyList = false"],
  eps2: ["the geodesics' tolerance 0.12 → 0.24", "__bh.settings.realtimeEps = 0.12", "__bh.settings.realtimeEps = 0.24"],
  scenery: ["the scenery balanced → off", `__bh.game.set("earthScenery", "balanced")`, `__bh.game.set("earthScenery", "off")`],
};
const SCENES = process.env.SCENES ? process.env.SCENES.split(",").map((x) => ALIAS[x] ?? x) : DEFAULT;
const SUB = Number(process.env.SUB ?? 4);
const FRAMES = Number(process.env.FRAMES ?? 60);
const REPS = Number(process.env.REPS ?? 2);
const AB = process.env.AB ? (ABS[process.env.AB] ?? process.env.AB.split(";")) : undefined;

type Run = {
  trace: number;
  probes: number;
  lut: number;
  post: number;
  compute: number;
  frame: number;
  block: number;
  n: number;
  /** every pass's median [ms], the largest first */
  passes?: [string, number][];
};

describe.skipIf(!E2E)("the render's costs on held scenes", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const out: Record<string, { a: Run[]; b: Run[] }> = {};
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name.replace(/[^\w]+/g, "-").slice(0, 60)}.png`);
  };
  /** FRAMES frames touched, each profiled: the passes' medians, the frames' interval */
  const measure = () =>
    app.js<Run>(`(async () => {
      const r = __bh.renderer, frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
      for (let i = 0; i < 20; i++) { __bh.touch(); await frame(); }
      r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
      const tr = [], pr = [], lu = [], po = [], co = [], iv = [], all = {};
      let seen = r.prof.frames, done = r.completedFrames, tl = performance.now();
      const t0 = performance.now();
      while (tr.length < ${FRAMES} && performance.now() - t0 < 30000) {
        __bh.touch();
        await frame();
        const now = performance.now();
        if (r.completedFrames !== done) { iv.push((now - tl) / (r.completedFrames - done)); done = r.completedFrames; tl = now; }
        if (r.prof.frames === seen) continue;
        seen = r.prof.frames;
        const t = r.prof.table();
        const get = (f) => t.filter(f).reduce((a, p) => a + p.last, 0);
        tr.push(get((p) => p.label === "trace"));
        pr.push(get((p) => p.label.includes("probe")));
        lu.push(get((p) => p.label === "far-field LUT"));
        po.push(get((p) => p.label === "resolve" || p.label === "gather" || p.label === "temporal"));
        co.push(get((p) => !p.label.startsWith("ship") && !p.label.startsWith("display") && !p.label.startsWith("canvas")));
        for (const p of t) (all[p.label] ??= []).push(p.last);
      }
      r.prof.every = 8;
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
      const passes = Object.entries(all).map(([k, v]) => [k, med(v)]).filter((x) => x[1] >= 0.3).sort((a, b) => b[1] - a[1]).slice(0, 14);
      return { trace: med(tr), probes: med(pr), lut: med(lu), post: med(po), compute: med(co), frame: med(iv.slice(2)), block: r.realtimeBlockNow, n: tr.length, passes };
    })()`);
  const f1 = (x: number) => x.toFixed(1).padStart(6);
  const row = (r: Run) =>
    `trace ${f1(r.trace)}  probes ${f1(r.probes)}  LUT ${f1(r.lut)}  post ${f1(r.post)}  compute ${f1(r.compute)}  frame ${f1(r.frame)} ms  (×${r.block}, ${r.n})`;

  beforeAll(async () => {
    // (the viewer's scenes as they are — no craft, no cockpit —: the flights' after them)
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: `scene=${encodeURIComponent(DEFAULT[1]!)}`, tiles: true });
    await app.js(`(() => { Object.assign(__bh.settings, { showFps: true, autosave: false }); return 1; })()`);
  }, 300_000);
  afterAll(async () => {
    const lines = Object.entries(out).map(([sc, v]) => {
      const m = (rs: Run[], k: Exclude<keyof Run, "passes">) => {
        const b = rs.map((r) => r[k]).sort((x, y) => x - y);
        return b[b.length >> 1] ?? 0;
      };
      const pick = (rs: Run[]): Run => ({
        trace: m(rs, "trace"),
        probes: m(rs, "probes"),
        lut: m(rs, "lut"),
        post: m(rs, "post"),
        compute: m(rs, "compute"),
        frame: m(rs, "frame"),
        block: m(rs, "block"),
        n: m(rs, "n"),
      });
      const A = pick(v.a);
      let s = `${sc.slice(0, 48).padEnd(48)} A ${row(A)}`;
      if (v.b.length) {
        const B = pick(v.b);
        s += `\n${"".padEnd(48)} B ${row(B)}\n${"".padEnd(48)} Δ trace ${f1(B.trace - A.trace)} ms (${(((B.trace - A.trace) / Math.max(A.trace, 1e-6)) * 100).toFixed(1)} %), compute ${f1(B.compute - A.compute)} ms`;
      }
      return s;
    });
    console.log(`\n${AB ? `A/B: ${AB[0]}\n` : ""}${lines.join("\n")}`);
    if (shots) await Bun.write(`${shots}/perf.json`, JSON.stringify(out, null, 1));
    app?.close();
    stopServer();
  });

  // (the viewer's scenes first, the flights last: a game's craft and cockpit stay once flown)
  for (const sc of [...SCENES.filter((x) => !FLIGHT[x]), ...SCENES.filter((x) => FLIGHT[x])])
    test(`${sc}`, async () => {
      const set = FLIGHT[sc] ?? `__bh.game.preset(${JSON.stringify(sc)});`;
      if (FLIGHT[sc]) {
        // (the F-35 flown first: the preset's fleet would keep the Ranger)
        await app.js(`(async () => { __bh.game.preset("game:artemis"); __bh.settings.vessel = "f35"; return 1; })()`);
        await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
      }
      await app.js(`(async () => { ${set}
        Object.assign(__bh.settings, { realtimeSubsampling: ${SUB}, dynamicResolution: false, fpsCap: 0, animate: false, autosave: false });
        ${AB ? `${AB[1]};` : ""} return 1; })()`);
      // (its tracer compiled, its data in — the Earth's tiles —, still for 1.5 s)
      await app.js(`(async () => {
        const r = __bh.renderer, frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
        const t0 = performance.now();
        // (a few frames first: the kernel's key follows the scene at the next frame)
        for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
        // (the kernel settled — renderer.kernelsSettled: its own passes compiled, its surface and scenery in)
        while (!r.kernelsSettled && performance.now() - t0 < 240000) { __bh.touch(); await frame(); }
        // (the aerial perspective's table's kernel, compiled after the first image: waited for — 3 min at most —
        // near a world with air)
        while (r.aerialWanted && !r.aerialPipe && performance.now() - t0 < 180000) { __bh.touch(); await frame(); }
        // (a trace pass drawn — not only a kernel said ready: a scene's first could still be compiling; the profiler's
        // figures cleared first: they keep the last scene's)
        {
          r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
          const t1 = performance.now();
          while (performance.now() - t1 < 120000) {
            __bh.touch(); await frame();
            if ((r.prof.table().find((p) => p.label === "trace")?.last ?? 0) > 0) break;
          }
          r.prof.every = 8;
        }
        let calm = 0;
        while (performance.now() - t0 < 240000) {
          const ready = r.earthTiles.pending === 0 && !r.hdLoading;
          calm = ready ? calm || performance.now() : 0;
          if (calm && performance.now() - calm > 1500) break;
          __bh.touch(); await frame();
        }
        return 1; })()`);
      const v = (out[sc] = { a: [] as Run[], b: [] as Run[] });
      for (let k = 0; k < (AB ? 2 * REPS : 1); k++) {
        const side = k % 2 ? "b" : "a";
        if (AB) {
          await app.js(`(async () => { ${side === "a" ? AB[1] : AB[2]}; return 1; })()`);
          // (a few frames first: the kernel's key follows a switch at the next frame — its variant then compiled, the
          // general kernel drawing meanwhile, 20–40 % slower — and the tracer settled on it)
          await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
            for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
            // (settled: a tuned variant's own aerial table's pass, surface and scenery — variantReady alone measured B
            // without them: 10–30 % on the Earth, either way)
            const t0 = performance.now(); while (!r.kernelsSettled && performance.now() - t0 < 240000) { __bh.touch(); await frame(); }
            while (r.aerialWanted && !r.aerialPipe && performance.now() - t0 < 240000) { __bh.touch(); await frame(); }
            for (let i = 0; i < 6; i++) { __bh.touch(); await frame(); }
            ${side === "a" && AB[3] ? `while (!(${AB[3]}) && performance.now() - t0 < 240000) { __bh.touch(); await frame(); }` : ""}
            return 1; })()`);
        }
        const r = await measure();
        if (k === 0) console.log(`      bodies: ${JSON.stringify(await app.js("__bh.renderer.bodyListSizes"))}`);
        v[side].push(r);
        console.log(`  ${side.toUpperCase()} ${row(r)}`);
        if (k < 2) console.log(`      ${(r.passes ?? []).map(([l, ms]) => `${l} ${ms.toFixed(1)}`).join(" · ")}`);
        // (the last pair's images: the scene settled, its kernels in)
        if (k >= (AB ? 2 * REPS : 1) - 2) await shot(`${sc}${AB ? `-${side}` : ""}`);
      }
      if (AB) await app.js(`(async () => { ${AB[1]}; return 1; })()`);
      // (COST=1,9,…: the cost view's heat maps of the scene too — renderer.costView, each kind asked)
      for (const cv of process.env.COST ? process.env.COST.split(",").map(Number) : []) {
        await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
          r.costView = ${cv}; const t0 = performance.now();
          // (a few frames first: the kernel's key follows the switch at the next frame)
          for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
          while (!r.kernelsSettled && performance.now() - t0 < 240000) { __bh.touch(); await frame(); }
          for (let i = 0; i < 24; i++) { __bh.touch(); await frame(); } return 1; })()`);
        await shot(`${sc}-cost${cv}`);
        // (14, 15: the raw counts read back — renderer.costStats)
        if (cv === 14 || cv === 15) {
          const st = await app.js<{ share: number; mean: number; p50: number; p90: number; p99: number }[] | null>(
            "__bh.renderer.costStats()",
          );
          const names =
            cv === 14 ? ["march steps", "heights read", "shadow steps"] : ["main-loop steps", "bodies tested", "integrator tries"];
          for (const [i, x] of (st ?? []).entries())
            console.log(
              `  ${sc} ${names[i]}: ${(100 * x.share).toFixed(0)} % of the pixels, there mean ${x.mean.toFixed(1)} · p50 ${x.p50.toFixed(0)} · p90 ${x.p90.toFixed(0)} · p99 ${x.p99.toFixed(0)}`,
            );
        }
      }
      if (process.env.COST) await app.js(`(() => { __bh.renderer.costView = 0; return 1; })()`);
    }, 600_000);
});
