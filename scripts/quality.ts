import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
// Deterministic realtime-vs-converged quality: the camera turns 0.2° per rendered frame (frame-locked),
// stops on a realtime frame, which is captured; the same view is then left to converge (reference).
// PSNR of the realtime capture against it (centre crop), for each config, averaged over stops.
// bun scripts/quality.ts [url] ["scene|scene"] [configs JSON] [stops] — needs python3 with numpy and Pillow
const S = `${tmpdir()}/kerr-quality`;
mkdirSync(`${S}/ui`, { recursive: true });
const url = process.argv[2] ?? "http://localhost:3000/";
const scenes = (process.argv[3] ?? "Kerr a=0.94, near edge-on").split("|");
const configs: { name: string; js: string }[] = JSON.parse(
  process.argv[4] ??
    `[{"name":"off","js":"__bh.settings.temporalReprojection=false"},{"name":"on","js":"__bh.settings.temporalReprojection=true"}]`,
);
const stops = Number(process.argv[5] ?? 3);
const port = 9570 + Math.floor(Math.random() * 20);
const chrome = Bun.spawn(
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${S}/chrome-profile`,
    "--enable-unsafe-webgpu",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--window-size=1600,900",
    "--no-first-run",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" },
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const res: Record<string, number[]> = {};
try {
  let t: any[] = [];
  for (let i = 0; i < 200; i++) {
    try {
      t = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (t.some((x) => x.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = new Map<number, any>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pend.has(d.id)) pend.get(d.id)(d.result ?? d.error);
  };
  const cdp = (method: string, params: object = {}) =>
    new Promise<any>((r) => {
      const i = ++id;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const js = async (b: string) =>
    (await cdp("Runtime.evaluate", { expression: `(async () => { ${b} })()`, awaitPromise: true, returnByValue: true }))?.result?.value;
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url });
  for (let i = 0; i < 120; i++) {
    if (await js(`return typeof __bh !== "undefined" && !!__bh.renderer`)) break;
    await sleep(500);
  }
  await sleep(2500);
  // hide the HUD: only the image is compared
  await js(
    `const st = document.createElement("style"); st.textContent = ".fl-root, canvas.fl-hud, #overlay, .glass, .sp-opener, .asset-pill, .mission-caption { visibility: hidden !important; }"; document.head.appendChild(st); return 0`,
  );
  const shot = async (file: string) => {
    const r = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 300, y: 150, width: 1000, height: 600, scale: 1 } });
    await Bun.write(file, Buffer.from(r.data, "base64"));
  };
  for (const sc of scenes)
    for (const cfg of configs)
      for (let k = 0; k < stops; k++) {
        await js(
          `__bh.preset(${JSON.stringify(sc)}); Object.assign(__bh.settings, { quality: "game", realtimeSubsampling: 4, dynamicResolution: false, animate: false }); ${cfg.js}; __bh.refresh?.(); return 0`,
        );
        await sleep(2500);
        // frame-locked turn: one step per completed frame, 40 + 10k frames
        const n = 40 + 10 * k;
        await js(`const r = __bh.renderer; let done = 0, last = r.lastDoneAt;
      __bh.camera.rotateView(0.2, 0.03, 0); __bh.touch();
      while (done < ${n}) { await new Promise((q) => requestAnimationFrame(q)); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; if (done < ${n}) { __bh.camera.rotateView(0.2, 0.03, 0); __bh.touch(); } } }
      window.__spp = __bh.settings.targetSpp; __bh.settings.targetSpp = 0; return 0`);
        await sleep(500);
        const base = `${S}/ui/ev_${sc.replace(/[^\w]+/g, "_").slice(0, 16)}_${cfg.name}_${k}`;
        await shot(`${base}.png`);
        await js(`__bh.settings.targetSpp = Math.max(window.__spp, 64); __bh.touch(); return 0`);
        for (let i = 0; i < 40; i++) {
          await sleep(500);
          if (await js(`return __bh.renderer.lastPhase === "converged"`)) break;
        }
        await shot(`${base}_ref.png`);
        const p = Bun.spawnSync([
          "python3",
          "-c",
          `
import numpy as np
from PIL import Image
a=np.asarray(Image.open("${base}.png").convert("RGB"),dtype=np.float64); b=np.asarray(Image.open("${base}_ref.png").convert("RGB"),dtype=np.float64)
m=((a-b)**2).mean(); print(10*np.log10(255**2/max(m,1e-9)))`,
        ]);
        const v = Number(p.stdout.toString().trim());
        (res[`${sc} | ${cfg.name}`] ??= []).push(v);
        console.log(sc, cfg.name, k, v.toFixed(2));
      }
} finally {
  chrome.kill();
  Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
}
for (const [k, v] of Object.entries(res))
  console.log(k.padEnd(48), (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), "dB", v.map((x) => x.toFixed(1)).join(" "));
process.exit(0);
