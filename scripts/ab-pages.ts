// Observations of two deployments, interleaved A B B A (AB_ROUNDS rounds: two runs a side each), a
// fresh browser profile per run. Both sides are timed the same way, by a probe injected before the
// page's own scripts (the first submission after a canvas texture was acquired, at its completion; the
// splash's #loading marked done), from navigation start — not by the app's own telemetry, which only
// the newer side has. A fresh profile does not isolate the driver's shader cache; a reload also changes
// HTTP/SW caches. Completed GPU submissions and browser callbacks are recorded separately.
// Effective settings must match before interpreting a frame-rate difference as a speedup.
// Run: bun scripts/ab-pages.ts   (AB_MAIN_URL, AB_TEST_URL, AB_ROUNDS — default 2 —, AB_OUT)
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, type Cdp } from "../tests/e2e/lib/cdp";

const TARGETS = [
  { name: "A-main", url: process.env.AB_MAIN_URL ?? "https://thesamlepirate.github.io/black-hole-gpu/" },
  { name: "B-test-kimi", url: process.env.AB_TEST_URL ?? "https://thesamlepirate.github.io/black-hole-gpu/test/" },
] as const;
type Target = (typeof TARGETS)[number];

const ROUNDS = Math.max(1, Number(process.env.AB_ROUNDS ?? 2));
const OUT = process.env.AB_OUT ?? `remote-results/${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}-ab-pages`;
mkdirSync(OUT, { recursive: true });

// biome-ignore lint/suspicious/noExplicitAny: CDP answers, typed at the call
async function js<T = any>(cdp: Cdp, expr: string): Promise<T> {
  const r = await cdp.send<{ result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
    "Runtime.evaluate",
    { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true, userGesture: true },
  );
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value as T;
}

async function until(cdp: Cdp, expr: string, timeout: number): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await js<boolean>(cdp, expr).catch(() => false)) return Date.now() - t0;
    await Bun.sleep(250);
  }
  throw new Error(`Timed out after ${timeout} ms: ${expr}`);
}

async function shot(cdp: Cdp, file: string) {
  const r = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${file}`, Buffer.from(r.data, "base64"));
  console.log(`  📷 ${file}`);
}

async function press(cdp: Cdp, key: string, code: number) {
  // (Enter types a carriage return, as a keyboard does: what activates a focused button — the
  // e2e harness's lesson, tests/e2e/lib/app.ts)
  const text = key === "Enter" ? "\r" : undefined;
  await cdp.send("Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    key,
    code: key,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code,
    text,
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await Bun.sleep(60);
}

/**
 * The probe, the same on both sides, injected before any of the page's scripts: the first frame — the
 * first queue submission after a canvas texture was acquired, at its completion — and the splash
 * lifted (#loading marked done, or gone), both from navigation start (performance.now()).
 */
const PROBE = `(() => {
  const m = (window.__ab = { firstFrameMs: null, splashLiftedMs: null });
  let acquired = false;
  const acquire = GPUCanvasContext.prototype.getCurrentTexture;
  GPUCanvasContext.prototype.getCurrentTexture = function () {
    acquired = true;
    return acquire.call(this);
  };
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (buffers) {
    const r = submit.call(this, buffers);
    if (acquired && m.firstFrameMs === null) {
      acquired = false;
      this.onSubmittedWorkDone().then(() => (m.firstFrameMs ??= performance.now()));
    }
    return r;
  };
  let seen = false;
  new MutationObserver(() => {
    const el = document.querySelector("#loading");
    seen ||= !!el;
    if (seen && m.splashLiftedMs === null && (!el || el.classList.contains("done"))) m.splashLiftedMs = performance.now();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
})()`;

interface LoadTiming {
  firstFrameMs: number;
  splashLiftedMs: number;
}

async function load(cdp: Cdp, url: string, midShot?: string): Promise<LoadTiming> {
  const previousOrigin = await js<number>(cdp, "performance.timeOrigin");
  await cdp.send("Page.navigate", { url });
  const done = `performance.timeOrigin !== ${previousOrigin} && globalThis.__ab?.firstFrameMs != null && __ab.splashLiftedMs != null`;
  await Promise.all([until(cdp, done, 240_000), midShot ? Bun.sleep(2500).then(() => shot(cdp, midShot)) : Promise.resolve()]);
  const t = await js<LoadTiming>(cdp, "__ab");
  return { firstFrameMs: Math.round(t.firstFrameMs), splashLiftedMs: Math.round(t.splashLiftedMs) };
}

interface Run {
  side: string;
  run: number;
  cold: LoadTiming;
  warm: LoadTiming;
  frames: { renderedFps: number | null };
  [more: string]: unknown;
}
const runs: Run[] = [];
const save = (extra: object = {}) =>
  writeFileSync(`${OUT}/ab-report.json`, JSON.stringify({ order: "ABBA", rounds: ROUNDS, ...extra, runs }, null, 2));

/** One run of a side: a fresh profile — the cold load, the first mission, the flight measured, a reload. */
async function measure(t: Target, n: number) {
  // (the screenshots: each side's first run only)
  const snap = (cdp: Cdp, step: string) => (n === 0 ? shot(cdp, `${t.name}-${step}.png`) : Promise.resolve());
  console.log(`\n=== ${t.name} #${n + 1} — ${t.url}`);
  const cdp = await launch({ width: 1440, height: 900 });
  try {
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
    await cdp.send("Network.enable");
    // (the world's mutable services out of the measure, as in the e2e suite)
    await cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"],
    });

    // ---- cold load
    const cold = await load(cdp, t.url, n === 0 ? `${t.name}-1-loading.png` : undefined);
    console.log(`  cold: first GPU frame ${cold.firstFrameMs} ms, splash lifted ${cold.splashLiftedMs} ms`);
    await snap(cdp, "2-title");

    // ---- the first mission launched from the title screen (the focus lands on the first entry
    // once the splash has gone — wait for it, not for a fixed delay)
    await until(cdp, `document.activeElement?.dataset.testid === "title-missions"`, 20_000);
    await press(cdp, "Enter", 13);
    await until(cdp, `!!document.querySelector("[data-testid=missions]")`, 10_000);
    const mission = await js<string>(cdp, `document.querySelector(".ms-name")?.textContent ?? "?"`);
    await snap(cdp, "3-missions");
    await until(cdp, `!!document.querySelector("[data-testid=mission-launch]")`, 5_000);
    await js(cdp, `document.querySelector("[data-testid=mission-launch]").click(), true`);
    await until(cdp, `!!globalThis.__bh?.camera?.piloting`, 30_000);
    console.log(`  mission launched: ${mission}`);
    await snap(cdp, "4-scene");
    await Bun.sleep(6000);
    await snap(cdp, "5-in-flight");

    // ---- the flight measured, the settings and the adapter's record
    const frames = await js(
      cdp,
      `new Promise((resolve) => {
      const renderer = __bh.renderer;
      const before = renderer.frameTelemetry?.completedFrames ?? null;
      let callbacks = 0;
      const t0 = performance.now();
      const sample = () => {
        callbacks++;
        const elapsedMs = performance.now() - t0;
        if (elapsedMs < 3000) { requestAnimationFrame(sample); return; }
        const telemetry = renderer.frameTelemetry;
        const completed = before === null ? null : telemetry.completedFrames - before;
        const durations = completed === null || completed <= 0 ? [] : telemetry.durationsMs.slice(-Math.min(completed, 512)).sort((a, b) => a - b);
        const percentile = (p) => durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] : null;
        resolve({ elapsedMs, completed, renderedFps: completed === null ? null : completed * 1000 / elapsedMs,
          animationCallbacksPerSecond: callbacks * 1000 / elapsedMs, retainedDurationSamples: durations.length,
          queueCompletionMedianMs: percentile(0.5), queueCompletionP95Ms: percentile(0.95) });
      };
      requestAnimationFrame(sample);
    })`,
    );
    const data = await js(
      cdp,
      `({
      build: await fetch("version.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null),
      effectiveQuality: __bh.renderer.effectiveQuality?.(__bh.settings) ?? null,
      pipelines: __bh.renderer.pipelineStatus ?? null,
      actualImage: { width: __bh.renderer.live?.width, height: __bh.renderer.live?.height, block: __bh.renderer.realtimeBlockNow },
      loadMeasurement: "injected probe, both sides: first presented submission completed; #loading done — from navigation start",
      tier: __bh.renderer.tier,
      adapter: __bh.renderer.adapter,
      settings: {
        pixelRatio: __bh.settings.pixelRatio,
        dynamicResolution: __bh.settings.dynamicResolution,
        realtimeSteps: __bh.settings.realtimeSteps,
        realtimeEps: __bh.settings.realtimeEps,
        targetSpp: __bh.settings.targetSpp,
        farFieldLut: __bh.settings.farFieldLut,
      },
      gpuFrameMs: __bh.renderer.prof.frameMs ?? null,
      gpuErrors: __bh.renderer.gpuErrors,
      lost: __bh.renderer.lost,
      // (a preview's keys carry its directory: test/kerr.tier)
      tierRemembered: Object.fromEntries(Object.keys(localStorage).filter((k) => k.endsWith("kerr.tier")).map((k) => [k, localStorage.getItem(k)])),
    })`,
    );
    console.log(`  tier: ${JSON.stringify(data.tier)}`);
    console.log(
      `  adapter: ${JSON.stringify(data.adapter?.vendor)} ${JSON.stringify(data.adapter?.architecture)} — ${frames.renderedFps ?? "unavailable"} completed GPU submissions/s, gpu ${data.gpuFrameMs} ms/frame`,
    );

    // ---- reload: shader, HTTP and Service Worker cache effects remain combined
    const warm = await load(cdp, t.url);
    console.log(`  reload: first GPU frame ${warm.firstFrameMs} ms, splash lifted ${warm.splashLiftedMs} ms`);
    await snap(cdp, "6-reload");

    runs.push({ side: t.name, run: n, url: t.url, cold, warm, mission, frames, ...data, consoleErrors: cdp.errors });
    if (data.gpuErrors || data.lost || data.pipelines?.qualityError || cdp.errors.length)
      throw new Error(`${t.name} #${n + 1}: GPU or console errors; comparison invalid`);
  } catch (error) {
    if (runs.at(-1)?.side !== t.name || runs.at(-1)?.run !== n) runs.push({ side: t.name, run: n } as Run);
    Object.assign(runs.at(-1)!, { error: error instanceof Error ? error.message : String(error), consoleErrors: cdp.errors });
    save();
    throw error;
  } finally {
    cdp.close();
  }
}

// (A B B A each round: neither side always first — a drifting network, a warming driver, shared evenly)
const [A, B] = TARGETS;
const count = { [A.name]: 0, [B.name]: 0 };
for (let r = 0; r < ROUNDS; r++) for (const t of [A, B, B, A]) await measure(t, count[t.name]++);

/** a side's values: their median and their range */
function spread(xs: number[]) {
  const v = [...xs].sort((p, q) => p - q);
  const mid = v.length >> 1;
  const median = v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  return { n: v.length, median: Math.round(median), min: v[0]!, max: v.at(-1)! };
}
const METRICS: Record<string, (r: Run) => number> = {
  "first GPU frame, cold": (r) => r.cold.firstFrameMs,
  "splash lifted, cold": (r) => r.cold.splashLiftedMs,
  "first GPU frame, reload": (r) => r.warm.firstFrameMs,
  "splash lifted, reload": (r) => r.warm.splashLiftedMs,
};
const summary: Record<string, Record<string, ReturnType<typeof spread>>> = {};
for (const [label, f] of Object.entries(METRICS))
  summary[label] = Object.fromEntries(TARGETS.map((t) => [t.name, spread(runs.filter((r) => r.side === t.name).map(f))]));
save({ summary });
console.log(`\n=== report: ${OUT}/ab-report.json`);
for (const [label, sides] of Object.entries(summary)) {
  const a = sides[A.name]!,
    b = sides[B.name]!;
  console.log(
    `${label.padEnd(24)} A ${a.median} ms [${a.min}–${a.max}]   B ${b.median} ms [${b.min}–${b.max}]   (medians, ranges; n = ${a.n})`,
  );
}
const fps = (side: string) => runs.filter((r) => r.side === side).map((r) => r.frames.renderedFps ?? "unavailable");
console.log(`completed GPU submissions/s: A ${fps(A.name).join(", ")}   B ${fps(B.name).join(", ")}`);
console.log(
  "Observations only: overlapping ranges are no difference; compare effective settings and image dimensions before drawing a performance conclusion.",
);
