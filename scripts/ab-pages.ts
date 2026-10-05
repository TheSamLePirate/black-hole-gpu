// A/B: the production deployment (main) against the branch's (/test/) — sequentially, in a real
// Chrome on its real GPU (tests/e2e/lib/cdp.ts), a fresh profile per side: the cold start is
// genuinely cold, the Service Worker installs but does not control the first load on either side.
// Per side: the load timed to the first GPU frame and to the splash's lift, screenshots along the
// way, the first mission launched from the title screen, the flight measured (GPU frame time,
// frames/s), the settings and the WebGPU adapter's record compared, then a reload (the shaders'
// disk cache). Run: bun scripts/ab-pages.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, type Cdp } from "../tests/e2e/lib/cdp";

const TARGETS = [
  { name: "A-main", url: "https://thesamlepirate.github.io/black-hole-gpu/" },
  { name: "B-test-kimi", url: "https://thesamlepirate.github.io/black-hole-gpu/test/" },
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
  return -1;
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
  await cdp.send("Page.navigate", { url });
  const [firstFrameMs, splashLiftedMs] = await Promise.all([
    until(cdp, `!!globalThis.__bh?.renderer && __bh.renderer.lastFrameDoneAt > 0`, 240_000),
    until(cdp, `!!document.querySelector("#loading.done") || !document.querySelector("#loading")`, 240_000),
    midShot ? Bun.sleep(2500).then(() => shot(cdp, midShot)) : Promise.resolve(),
  ]);
  return { firstFrameMs, splashLiftedMs };
}

const report: Record<string, unknown> = {};

for (const t of TARGETS) {
  console.log(`\n=== ${t.name} — ${t.url}`);
  const cdp = await launch({ width: 1440, height: 900 });
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
  const fps = await js<number>(
    cdp,
    `new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(Math.round(n / 3)); }; requestAnimationFrame(f); })`,
  );
  const data = await js(
    cdp,
    `({
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
    `  adapter: ${JSON.stringify(data.adapter?.vendor)} ${JSON.stringify(data.adapter?.architecture)} — ${data.fps} fps, gpu ${data.gpuFrameMs} ms/frame`,
  );

  // ---- the reload (the shaders' disk cache; the Service Worker now controls the page)
  const warm = await load(cdp, t.url);
  console.log(`  reload: first GPU frame ${warm.firstFrameMs} ms, splash lifted ${warm.splashLiftedMs} ms`);
  await shot(cdp, `${t.name}-6-reload.png`);

  report[t.name] = { url: t.url, cold, warm, mission, fps, ...data, consoleErrors: cdp.errors };
  cdp.close();
}

writeFileSync(`${OUT}/ab-report.json`, JSON.stringify(report, null, 2));
console.log(`\n=== report: ${OUT}/ab-report.json`);
const a = report["A-main"] as { cold: LoadTiming; warm: LoadTiming; fps: number };
const b = report["B-test-kimi"] as { cold: LoadTiming; warm: LoadTiming; fps: number };
console.log(
  `\nfirst GPU frame, cold:  A ${a.cold.firstFrameMs} ms   B ${b.cold.firstFrameMs} ms   (Δ ${a.cold.firstFrameMs - b.cold.firstFrameMs} ms)`,
);
console.log(
  `splash lifted, cold:    A ${a.cold.splashLiftedMs} ms   B ${b.cold.splashLiftedMs} ms   (Δ ${a.cold.splashLiftedMs - b.cold.splashLiftedMs} ms)`,
);
console.log(
  `splash lifted, reload:  A ${a.warm.splashLiftedMs} ms   B ${b.warm.splashLiftedMs} ms   (Δ ${a.warm.splashLiftedMs - b.warm.splashLiftedMs} ms)`,
);
console.log(`fps in flight:          A ${a.fps}   B ${b.fps}`);
