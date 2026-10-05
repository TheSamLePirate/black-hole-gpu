// Sequential observations of two deployments, with a fresh browser profile per side.
// A fresh profile does not isolate the driver's shader cache; a reload also changes HTTP/SW
// caches. Completed GPU submissions and browser callbacks are recorded separately.
// Effective settings must match before interpreting a frame-rate difference as a speedup.
// Run: bun scripts/ab-pages.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, type Cdp } from "../tests/e2e/lib/cdp";

const TARGETS = [
  { name: "A-main", url: process.env.AB_MAIN_URL ?? "https://thesamlepirate.github.io/black-hole-gpu/" },
  { name: "B-test-kimi", url: process.env.AB_TEST_URL ?? "https://thesamlepirate.github.io/black-hole-gpu/test/" },
];

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

interface LoadTiming {
  firstFrameMs: number;
  splashLiftedMs: number;
}

async function load(cdp: Cdp, url: string, midShot?: string): Promise<LoadTiming> {
  const previousOrigin = await js<number>(cdp, "performance.timeOrigin");
  await cdp.send("Page.navigate", { url });
  const fresh = `performance.timeOrigin !== ${previousOrigin} && !!globalThis.__bh?.renderer && __bh.renderer.lastFrameDoneAt > 0`;
  const [firstFrameMs, splashLiftedMs] = await Promise.all([
    until(cdp, fresh, 240_000),
    until(cdp, `${fresh} && (!!document.querySelector("#loading.done") || !document.querySelector("#loading"))`, 240_000),
    midShot ? Bun.sleep(2500).then(() => shot(cdp, midShot)) : Promise.resolve(),
  ]);
  const precise = await js<number | null>(cdp, `__bh.renderer.firstFrameDoneAt || null`);
  return { firstFrameMs: precise ?? firstFrameMs, splashLiftedMs };
}

const report: Record<string, unknown> = {};

for (const t of TARGETS) {
  console.log(`\n=== ${t.name} — ${t.url}`);
  const cdp = await launch({ width: 1440, height: 900 });
  try {
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    // (the world's mutable services out of the measure, as in the e2e suite)
    await cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"],
    });

    // ---- cold load
    const cold = await load(cdp, t.url, `${t.name}-1-loading.png`);
    console.log(`  cold: first GPU frame ${cold.firstFrameMs} ms, splash lifted ${cold.splashLiftedMs} ms`);
    await shot(cdp, `${t.name}-2-title.png`);

    // ---- the first mission launched from the title screen (the focus lands on the first entry
    // once the splash has gone — wait for it, not for a fixed delay)
    const focused = await until(cdp, `document.activeElement?.dataset.testid === "title-missions"`, 20_000);
    if (focused < 0) throw new Error("the title screen never focused its Missions entry");
    await press(cdp, "Enter", 13);
    const opened = await until(cdp, `!!document.querySelector("[data-testid=missions]")`, 10_000);
    if (opened < 0) throw new Error("the missions panel did not open");
    const mission = await js<string>(cdp, `document.querySelector(".ms-name")?.textContent ?? "?"`);
    await shot(cdp, `${t.name}-3-missions.png`);
    const launchBtn = await until(cdp, `!!document.querySelector("[data-testid=mission-launch]")`, 5_000);
    if (launchBtn < 0) throw new Error("the mission's launch button never showed");
    await js(cdp, `document.querySelector("[data-testid=mission-launch]").click(), true`);
    await until(cdp, `!!globalThis.__bh?.camera?.piloting`, 30_000);
    console.log(`  mission launched: ${mission}`);
    await shot(cdp, `${t.name}-4-scene.png`);
    await Bun.sleep(6000);
    await shot(cdp, `${t.name}-5-in-flight.png`);

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
      firstFrameMeasurement: __bh.renderer.firstFrameDoneAt ? "completion timestamp" : "250 ms polling observation",
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
      tierRemembered: localStorage.getItem("kerr.tier"),
    })`,
    );
    console.log(`  tier: ${JSON.stringify(data.tier)}`);
    console.log(
      `  adapter: ${JSON.stringify(data.adapter?.vendor)} ${JSON.stringify(data.adapter?.architecture)} — ${frames.renderedFps ?? "unavailable"} completed GPU submissions/s, gpu ${data.gpuFrameMs} ms/frame`,
    );

    // ---- reload: shader, HTTP and Service Worker cache effects remain combined
    const warm = await load(cdp, t.url);
    console.log(`  reload: first GPU frame ${warm.firstFrameMs} ms, splash lifted ${warm.splashLiftedMs} ms`);
    await shot(cdp, `${t.name}-6-reload.png`);

    report[t.name] = { url: t.url, cold, warm, mission, frames, ...data, consoleErrors: cdp.errors };
    if (data.gpuErrors || data.lost || data.pipelines?.qualityError || cdp.errors.length)
      throw new Error(`${t.name}: GPU or console errors; comparison invalid`);
  } catch (error) {
    report[t.name] = {
      ...(report[t.name] as object),
      error: error instanceof Error ? error.message : String(error),
      consoleErrors: cdp.errors,
    };
    writeFileSync(`${OUT}/ab-report.json`, JSON.stringify(report, null, 2));
    throw error;
  } finally {
    cdp.close();
  }
}

writeFileSync(`${OUT}/ab-report.json`, JSON.stringify(report, null, 2));
console.log(`\n=== report: ${OUT}/ab-report.json`);
const a = report["A-main"] as { cold: LoadTiming; warm: LoadTiming; frames: { renderedFps: number | null } };
const b = report["B-test-kimi"] as { cold: LoadTiming; warm: LoadTiming; frames: { renderedFps: number | null } };
console.log(
  `\nfirst GPU frame, cold:  A ${a.cold.firstFrameMs} ms   B ${b.cold.firstFrameMs} ms   (Δ ${a.cold.firstFrameMs - b.cold.firstFrameMs} ms)`,
);
console.log(
  `splash lifted, cold:    A ${a.cold.splashLiftedMs} ms   B ${b.cold.splashLiftedMs} ms   (Δ ${a.cold.splashLiftedMs - b.cold.splashLiftedMs} ms)`,
);
console.log(
  `splash lifted, reload:  A ${a.warm.splashLiftedMs} ms   B ${b.warm.splashLiftedMs} ms   (Δ ${a.warm.splashLiftedMs - b.warm.splashLiftedMs} ms)`,
);
console.log(`completed GPU submissions/s: A ${a.frames.renderedFps ?? "unavailable"}   B ${b.frames.renderedFps ?? "unavailable"}`);
console.log("Observations only: compare effective settings and image dimensions before drawing a performance conclusion.");
