import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The raster pipeline's realtime image in low flight, measured (the governor's block, the dynamic resolution, the shading
// rate, the frame's GPU passes) — and A/B between two builds in one Chrome (its shader cache shared): AB_A_URL and AB_B_URL
// (scripts/ab-commit.ts with AB_CMD serves two commits), else the test's own server alone. The F-35 at 120 m/s, 450 m over
// Chamonix's valley floor, in its cockpit, the game's own settings (quality "game": dynamic resolution, automatic block and
// shading rate); the IGN relief off as in tests/e2e/zones.e2e.test.ts. Each side: the automatic flight sampled, then the
// block held at 2, 4 and 8, then the view frozen (__bh.freeze — does it refine?), then the game paused (how fast it does).
// Rounds A B B A (AB_ROUNDS pairs). Figures in $AB_OUT/lowflight.json (remote-results/ else), shots lf-<side><round>-*.png.
// LF_ABLATE=1: the levers below instead (LF_LEVERS=history|fix: other sets); LF_PROBE=1: the near body's frame over
// consecutive frames in flight. Findings: docs/progress/raster-aaa/VOL-BAS-2026-10-24.md.
// Duration: ~3 min a side on kerr-mini, its shaders cached.
// Done when: every side flown, its figures written.

const D = Math.PI / 180;
const C = { lat: 45.92, lon: 6.87 };
const START = { lat: C.lat - (1.1 * Math.cos(45 * D)) / 111.2, lon: C.lon - (1.1 * Math.sin(45 * D)) / (111.2 * Math.cos(C.lat * D)) };
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: false, earthIgnSilhouettes: false, earthScenery: "off", earthSurface: "off", detailReach: "normal", f35AutoProtect: false }`;
const SIDES = [
  ["A", process.env.AB_A_URL],
  ["B", process.env.AB_B_URL],
].filter((s): s is [string, string] => !!s[1]);
const ROUNDS = Number(process.env.AB_ROUNDS ?? 1);
const OUT = process.env.AB_OUT ?? "remote-results";
// (LF_ABLATE=1: instead of the phases, the same flight flown again from its start under each of these — the block, the
// shading rate and the scale held, one lever changed at a time —: each one's frame time and ground detail at the same moment)
const ABLATE = process.env.LF_ABLATE === "1";
const FLOOR = `__bh.settings.realtimeSubsampling = 8; __bh.settings.earthRasterShading = "sixteenth"; __bh.forceScale(0.5);`;
const EVERY = `${FLOOR} __bh.settings.earthRasterShading = "every"; __bh.settings.motionBlur = 0;`;
const RIGID_OFF = "__bh.renderer.reprojectGround = false;";
const LEVERS: [string, string][] = (
  process.env.LF_LEVERS === "fix"
    ? [
        ["game (automatic)", ""],
        ["game (automatic), rigid reprojection off", RIGID_OFF],
        ["every pixel, scale 0.5, no motion blur", EVERY],
        ["… rigid reprojection off", `${EVERY} ${RIGID_OFF}`],
        ["floor, no motion blur", `${FLOOR} __bh.settings.motionBlur = 0;`],
        ["… rigid reprojection off", `${FLOOR} __bh.settings.motionBlur = 0; ${RIGID_OFF}`],
      ]
    : process.env.LF_LEVERS === "history"
      ? [
          ["every pixel, scale 0.5, no motion blur", EVERY],
          ["… the ground's rigid reprojection off", `${EVERY} __bh.renderer.reprojectGround = false;`],
          ["… history weight ×8 lighter (least α 0.5)", `${EVERY} __bh.renderer.taParams[0] = 0.5;`],
          ["… no temporal reprojection", `${EVERY} __bh.settings.temporalReprojection = false;`],
          ["… temporal blend off", `${EVERY} __bh.settings.temporalBlend = 1;`],
          ["floor, history weight ×8 lighter", `${FLOOR} __bh.settings.motionBlur = 0; __bh.renderer.taParams[0] = 0.5;`],
        ]
      : [
          ["game (automatic)", ""],
          ["floor: block 8, 1/16, scale 0.5", FLOOR],
          ["floor, no motion blur", `${FLOOR} __bh.settings.motionBlur = 0;`],
          ["1/16, scale 1, no motion blur", `${FLOOR} __bh.forceScale(1); __bh.settings.motionBlur = 0;`],
          ["every pixel, scale 0.5, no motion blur", EVERY],
          ["every pixel, scale 1, no motion blur", `${EVERY} __bh.forceScale(1);`],
          ["game (automatic), no motion blur", "__bh.settings.motionBlur = 0;"],
          ["floor, chase view (the cockpit's cost)", `${FLOOR} __bh.settings.shipMount = "chase";`],
        ]
) as [string, string][];
const UNDO = `__bh.renderer.reprojectGround = true; __bh.renderer.taParams[0] = 1 / 16; __bh.settings.temporalReprojection = window.__tr ??= __bh.settings.temporalReprojection; __bh.settings.temporalBlend = window.__tb ??= __bh.settings.temporalBlend; __bh.forceScale(null); __bh.settings.realtimeSubsampling = "auto"; __bh.settings.earthRasterShading = "auto"; __bh.settings.motionBlur = window.__mb ??= __bh.settings.motionBlur; __bh.settings.shipMount = "cockpit";`;

afterAll(stopServer);

test.skipIf(!E2E)(
  "low flight over Chamonix: the realtime image's governor, per build",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    const results: Record<string, unknown>[] = [];
    // (no builds given: this one, its own server)
    if (!SIDES.length) SIDES.push(["H", app.url]);
    // (the ground's detail on screen: the mean luminance step between neighbouring pixels over a band of the valley's floor
    // ahead — as zones.e2e's)
    // (far: the valley's right-hand slope 2–4 km off, over the HUD's right column)
    const detail = async (far = false) => {
      const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      const [rx0, rx1, ry0, ry1] = far ? [0.74, 0.92, 0.4, 0.5] : [0.22, 0.45, 0.7, 0.78];
      return app.js<number>(`(async () => {
        const b = await (await fetch("data:image/png;base64,${data}")).blob(), i = await createImageBitmap(b);
        const c = new OffscreenCanvas(i.width, i.height), g = c.getContext("2d"); g.drawImage(i, 0, 0);
        const x0 = Math.round(${rx0} * i.width), x1 = Math.round(${rx1} * i.width), y0 = Math.round(${ry0} * i.height), y1 = Math.round(${ry1} * i.height);
        const px = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, w = x1 - x0;
        const L = (k) => 0.2126 * px[4 * k] + 0.7152 * px[4 * k + 1] + 0.0722 * px[4 * k + 2];
        let sum = 0, n = 0;
        for (let y = 0; y < y1 - y0; y++) for (let x = 1; x < w; x++) { sum += Math.abs(L(y * w + x) - L(y * w + x - 1)); n++; }
        return +(sum / n).toFixed(2); })()`);
    };
    const SAMPLE = `(() => { const r = __bh.renderer, p = __bh.game.perf(), bm = {};
      for (const [k, v] of r.blockMs ?? []) bm[k] = +v.ms.toFixed(1);
      return { block: p.block, scale: +p.renderScale.toFixed(3), gpu: p.gpuFrameMs, fps: p.renderFps, rate: p.terrainRaster?.rate ?? null,
        primary: p.terrainRaster?.primary ?? null, pipe: r.earthPipelineNow(__bh.settings), fell: !!r.rasterFellBack, hint: r.rasterHint ?? null, phase: r.lastPhase, dense: !!r.lastFrameDense, trace: +(r.prof.traceMs?.() ?? 0).toFixed(2),
        image: p.image, blockMs: bm }; })()`;
    const sample = async (seconds: number) => {
      const s: Record<string, unknown>[] = [];
      for (let t0 = Date.now(); Date.now() - t0 < seconds * 1000; ) {
        await Bun.sleep(500);
        s.push(await app.js<Record<string, unknown>>(SAMPLE));
      }
      return s;
    };
    const passes = () =>
      app.js<{ pass: string; ms: number }[]>(
        `__bh.game.perf().gpu.filter((g) => g.ms > 0.3).sort((a, b) => b.ms - a.ms).slice(0, 12).map((g) => ({ pass: g.pass, ms: g.ms }))`,
      );
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? NaN;
    const summary = (s: Record<string, unknown>[]) => {
      const blocks: Record<string, number> = {};
      for (const x of s) blocks[String(x.block)] = (blocks[String(x.block)] ?? 0) + 1;
      return {
        blocks,
        scale: median(s.map((x) => x.scale as number)),
        rate: median(s.map((x) => (x.rate as number) ?? 0)),
        gpu: median(s.map((x) => x.gpu as number)),
        fps: median(s.map((x) => x.fps as number)),
        trace: median(s.map((x) => x.trace as number)),
      };
    };
    const place = `__bh.game.flyAt(${START.lat}, ${START.lon}, 450, 45, 120); __bh.settings.shipMount = "cockpit";`;
    const fly = async () => {
      await app.js(`(__bh.freeze(false), 1)`);
      await Bun.sleep(1200);
      await app.js(`(() => { const c = __bh.camera;
        if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        if (c.jetModes.spd !== null) c.jetModes.spd = 120; return 1; })()`);
    };

    for (let round = 0; round < ROUNDS; round++) {
      const order = round % 2 ? [...SIDES].reverse() : SIDES;
      for (const [side, url] of order) {
        const label = `${side}${round}`;
        // (the page on that build: same Chrome, its own load)
        (app as unknown as { url: string }).url = url;
        await app.load("scene=game:artemis");
        await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
        await Bun.sleep(1000);
        await app.js(`(() => { ${place} __bh.freeze(true); return 1; })()`);
        const ground = (cond: string) =>
          app.waitFor(`(() => { const t = __bh.renderer.earthTiles; return ${cond}; })()`, 120_000).catch(() => {});
        await ground("t.finest >= 14 && t.pending === 0");
        await app.js(`(() => { ${place} return 1; })()`);
        await ground("t.orthoFinest >= 17 && t.orthoPending === 0 && t.pending === 0");
        await app.settled();
        const settings = await app.js(
          `(() => { const s = __bh.settings; return { quality: s.quality, budget: s.realtimeBudget, dyn: s.dynamicResolution, sub: s.realtimeSubsampling, shading: s.earthRasterShading, scale: s.earthRasterScale, motionDetail: s.motionDetail, pixelRatio: s.pixelRatio, refreshMs: __bh.renderer.refreshMs, budgetMs: __bh.renderer.frameBudget(s), tier: __bh.renderer.tier }; })()`,
        );
        const tiles = await app.js(
          `(() => { const t = __bh.renderer.earthTiles; return { finest: t.finest, orthoFinest: t.orthoFinest, orthoLoaded: t.orthoLoaded }; })()`,
        );

        if (process.env.LF_PROBE === "1") {
          // (the near body's frame over consecutive frames in flight: the centre's shift and the turn's share at the centre [m])
          await fly();
          await Bun.sleep(4000);
          const probe = await app.js(`(async () => {
            const r = __bh.renderer, mPerM = 1476.625 * (__bh.settings.massSolar || 1), out = [];
            const frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
            const snap = () => { const n = r.lastNear; return n && { c: [...n.centre], a: n.axes.map((x) => [...x]), R: n.radius, t: r.lastTime, now: performance.now() }; };
            let p = snap();
            for (let i = 0; i < 8; i++) {
              await frame();
              const q = snap();
              if (!p || !q) { p = q; continue; }
              const k = q.R * mPerM;
              const move = [0, 1, 2].map((j) => (p.c[j] - q.c[j]) * k);
              const rows = [0, 1, 2].map((j) => [0, 1, 2].map((m) => p.a[0][j] * q.a[0][m] + p.a[1][j] * q.a[1][m] + p.a[2][j] * q.a[2][m] - (j === m ? 1 : 0)));
              const tc = rows.map((row) => (row[0] * q.c[0] + row[1] * q.c[1] + row[2] * q.c[2]) * k);
              out.push({ dtMs: +(q.now - p.now).toFixed(1), dtScene: q.t - p.t, moveM: +Math.hypot(...move).toFixed(3), turnCentreM: +Math.hypot(...tc).toFixed(3),
                move: move.map((x) => +x.toFixed(3)), tc: tc.map((x) => +x.toFixed(3)), centreM: +(Math.hypot(...q.c) * k).toFixed(0) });
              p = q;
            }
            return { mPerM, massSolar: __bh.settings.massSolar, out };
          })()`);
          console.log(`  ${label}: probe ${JSON.stringify(probe)}`);
          results.push({ side, round, probe });
          continue;
        }
        if (ABLATE) {
          const levers: Record<string, unknown>[] = [];
          for (const [name, js] of LEVERS) {
            await app.js(`(() => { __bh.freeze(true); ${place} ${UNDO} ${js} return 1; })()`);
            await Bun.sleep(800);
            await fly();
            await Bun.sleep(4000);
            const s = await sample(3);
            const l = { name, ...summary(s), detail: await detail(), far: await detail(true) };
            await app.shot(`${OUT}/lf-${label}-lever${levers.length}.png`);
            levers.push(l);
            console.log(
              `  ${label}: ${name} — gpu ${l.gpu} ms, fps ${l.fps}, block ${JSON.stringify(l.blocks)}, rate ${l.rate}, scale ${l.scale}, detail ${l.detail}`,
            );
          }
          // (the reference: the same flight held at the same moment by __bh.freeze, 20 s — does the held view refine?)
          await app.js(`(() => { __bh.freeze(true); ${place} ${UNDO} return 1; })()`);
          await Bun.sleep(800);
          await fly();
          await Bun.sleep(4000);
          await app.js(`(__bh.freeze(true), 1)`);
          await Bun.sleep(20_000);
          const still = {
            phase: await app.js<string>(`__bh.renderer.lastPhase`),
            spp: await app.js<number>(
              `+(__bh.renderer.sampleIndex + __bh.renderer.bandY / Math.max(1, __bh.renderer.live?.height ?? 1)).toFixed(2)`,
            ),
            detail: await detail(),
            far: await detail(true),
          };
          await app.shot(`${OUT}/lf-${label}-still.png`);
          console.log(`  ${label}: frozen 20 s — ${still.phase}, ${still.spp} spp, detail ${still.detail}, far ${still.far}`);
          await app.js(`(__bh.freeze(false), 1)`);
          results.push({ side, round, url, settings, tiles, levers, still });
          writeFileSync(`${OUT}/lowflight.json`, JSON.stringify(results, null, 1));
          continue;
        }
        // the automatic flight (the raster's state held still first; when the governor gives it up, the time from the thaw)
        const before = await app.js<Record<string, unknown>>(SAMPLE);
        await app.js(`(() => { window.__fellAt = 0; const t0 = performance.now(); clearInterval(window.__fellTimer);
          window.__fellTimer = setInterval(() => { if (!window.__fellAt && __bh.renderer.rasterFellBack) window.__fellAt = (performance.now() - t0) / 1000; }, 100); return 1; })()`);
        await fly();
        await Bun.sleep(3000);
        const auto = await sample(6);
        const autoDetail = await detail();
        await app.shot(`${OUT}/lf-${label}-auto.png`);
        const autoPasses = await passes();
        const more = await sample(4);
        // the block held
        const held: Record<string, unknown> = {};
        for (const b of [2, 4, 8]) {
          await app.js(`(__bh.settings.realtimeSubsampling = ${b}, 1)`);
          await Bun.sleep(1500);
          const s = await sample(3);
          held[b] = { ...summary(s), detail: await detail(), passes: await passes() };
          await app.shot(`${OUT}/lf-${label}-block${b}.png`);
        }
        await app.js(`(__bh.settings.realtimeSubsampling = "auto", 1)`);
        await Bun.sleep(2000);
        // the view frozen: the camera and the clocks held — does the image refine?
        await app.js(`(__bh.freeze(true), 1)`);
        await Bun.sleep(5000);
        await app.shot(`${OUT}/lf-${label}-frozen5s.png`);
        // (refined while held: until one sample a pixel, 60 s at most — the phase stays "realtime" if it never starts)
        const f0 = Date.now();
        await app
          .waitFor(
            `__bh.renderer.lastPhase !== "realtime" && (__bh.renderer.sampleIndex >= 1 || __bh.renderer.lastPhase === "converged")`,
            55_000,
          )
          .catch(() => {});
        const frozenS = (Date.now() - f0) / 1000 + 5;
        const frozen = {
          seconds: frozenS,
          spp: await app.js<number>(
            `+(__bh.renderer.sampleIndex + __bh.renderer.bandY / Math.max(1, __bh.renderer.live?.height ?? 1)).toFixed(2)`,
          ),
          ...(await app.js<{ phase: string; block: number } & Record<string, unknown>>(SAMPLE)),
          thrust: await app.js<boolean>(`!!__bh.renderer.shipThrust`),
          detail: await detail(),
        };
        await app.shot(`${OUT}/lf-${label}-frozen.png`);
        // the game paused: the refinement's pace
        await app.js(`(__bh.game.pause(true), 1)`);
        const t0 = Date.now();
        const pace: { t: number; phase: string; spp: number }[] = [];
        let convergedAt = 0;
        while (Date.now() - t0 < 40_000) {
          await Bun.sleep(1000);
          const p = await app.js<{ phase: string; spp: number }>(
            `(() => { const r = __bh.renderer; return { phase: r.lastPhase, spp: +(r.sampleIndex + r.bandY / Math.max(1, r.live?.height ?? 1)).toFixed(2) }; })()`,
          );
          pace.push({ t: +((Date.now() - t0) / 1000).toFixed(1), ...p });
          if (!convergedAt && p.spp >= 1) {
            convergedAt = Date.now() - t0;
            await app.shot(`${OUT}/lf-${label}-paused-1spp.png`);
          }
          if (p.phase === "converged") break;
        }
        const pausedDetail = await detail();
        await app.shot(`${OUT}/lf-${label}-paused.png`);
        await app.js(`(__bh.game.pause(false), __bh.freeze(false), 1)`);

        const fellAt = await app.js<number>(`window.__fellAt`);
        const r = {
          before,
          fellAt,
          side,
          round,
          url,
          settings,
          tiles,
          auto: { ...summary([...auto, ...more]), detail: autoDetail, passes: autoPasses, samples: [...auto, ...more] },
          held,
          frozen,
          paused: { firstSppS: convergedAt / 1000, detail: pausedDetail, pace },
        };
        results.push(r);
        console.log(
          `  ${label}: auto ${JSON.stringify(r.auto.blocks)} scale ${r.auto.scale} rate ${r.auto.rate} gpu ${r.auto.gpu} ms fps ${r.auto.fps} trace ${r.auto.trace} detail ${autoDetail}`,
        );
        for (const b of [2, 4, 8]) {
          const h = held[b] as ReturnType<typeof summary> & { detail: number };
          console.log(
            `  ${label}: block ${b} scale ${h.scale} rate ${h.rate} gpu ${h.gpu} ms fps ${h.fps} trace ${h.trace} detail ${h.detail}`,
          );
        }
        console.log(
          `  ${label}: frozen phase ${frozen.phase} after ${frozen.seconds.toFixed(0)} s, ${frozen.spp} spp, thrust ${frozen.thrust} block ${frozen.block} detail ${frozen.detail}; paused 1 spp at ${convergedAt / 1000} s, detail ${pausedDetail}`,
        );
        console.log(
          `  ${label}: held still before the flight ${JSON.stringify(before)}; raster given up ${fellAt ? `${fellAt.toFixed(1)} s after the thaw` : "never"}`,
        );
        console.log(`  ${label}: passes ${autoPasses.map((p) => `${p.pass} ${p.ms}`).join(" · ")}`);
        writeFileSync(`${OUT}/lowflight.json`, JSON.stringify(results, null, 1));
      }
    }
    app.close();
    expect(results.length).toBe(SIDES.length * ROUNDS);
  },
  3_600_000,
);
