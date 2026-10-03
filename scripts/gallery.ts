// The scene gallery's pictures, captured anew and compared with the ones in the repository (a visual
// regression test): each scene in a headless Chrome over the DevTools protocol, given a few seconds
// for its maps to stream in, then left to converge (__bh.captureScenes: 640 × 360, posted to
// snapshots/scene-<slug>.webp).
//
//   bun scripts/gallery.ts [--scenes "a|b"] [--warm 8000] [--url http://localhost:3000/]
//                          [--ssim 0.9] [--area 0.02] [--update]
//
// Each capture is compared with assets/scenes/<slug>.webp in the page (320 × 180, luminance): SSIM
// over 8 × 8 windows, and the share of the picture whose luminance moved by more than a tenth (3 × 3
// smoothed — the renderer's noise stays under it; a new cloud, a hidden Moon do not), and the largest
// colour change of its 16 × 9 blocks (a tint, a tone: --tone). Measured between
// two captures of the same code (2026-09-29, 71 scenes): SSIM ≥ 0.92 and ≤ 0.8 % moved for the still
// scenes — the defaults leave a margin. A scene under
// --ssim or over --area is flagged (a flight or a mission: --ssim-moving, --area-moving); the flagged ones are drawn side by side — the repository's, the
// capture, their difference — in snapshots/gallery-diff.png, all of them listed in
// snapshots/gallery-report.json. Exit code 1 when a scene is flagged (0 with --update).
//
// --update installs the captures as the gallery's pictures (scripts/scene-thumbs.ts) once reviewed.
// The dev server is started on the URL's port when it is not running. Measure alone: the browser pane
// rendering at the same time slows the captures (they converge less in their time). Chrome is killed
// on exit.
import { tmpdir } from "node:os";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { presets } from "../src/settings";
import { sceneSlug } from "./scene-slug";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const URL_ = arg("url", "http://localhost:3000/");
const WARM = Number(arg("warm", "8000"));
const SSIM_MIN = Number(arg("ssim", "0.85"));
const AREA_MAX = Number(arg("area", "0.02"));
// (flights and missions fly for their capture's 9 s at the frame rate's pace, the polarization's ticks
// follow its converging noise: never twice the same picture — held to a looser bound)
const SSIM_MOVING = Number(arg("ssim-moving", "0.75"));
const AREA_MOVING = Number(arg("area-moving", "0.08"));
// (colour: the largest mean change over the picture's 16 × 9 blocks, per channel, 0 … 1 — a hue or a
// tone moved where the structure did not)
const TONE_MAX = Number(arg("tone", "0.05"));
const TONE_MOVING = Number(arg("tone-moving", "0.12"));
const moving = (name: string) => !!presets[name]!.ship || !!presets[name]!.mission || !!presets[name]!.polarization;
const UPDATE = process.argv.includes("--update");
const SCENES = arg("scenes", "") ? arg("scenes", "").split("|") : Object.keys(presets);
for (const s of SCENES) if (!presets[s]) throw new Error(`no scene “${s}”`);
const CHROME =
  process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = 9500 + Math.floor(Math.random() * 40);
const procs: { kill(): void }[] = [];
const kill = () => {
  for (const p of procs) p.kill();
  Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
};
process.on("SIGINT", () => (kill(), process.exit(1)));

// (the dev server: started when the URL does not answer)
const up = async () =>
  fetch(URL_).then(
    (r) => r.ok,
    () => false,
  );
if (!(await up())) {
  const u = new URL(URL_);
  if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) throw new Error(`${URL_} does not answer`);
  console.log(`starting the dev server on port ${u.port || 80}`);
  procs.push(Bun.spawn(["bun", "server.ts"], { env: { ...process.env, PORT: u.port || "80" }, stdout: "ignore", stderr: "inherit" }));
  for (let i = 0; i < 100 && !(await up()); i++) await sleep(200);
}
// (old captures out of the way: what is in snapshots/ afterwards is this run's)
for (const f of existsSync("snapshots") ? readdirSync("snapshots") : []) if (/^scene-.+\.webp$/.test(f)) rmSync(`snapshots/${f}`);

procs.push(
  Bun.spawn(
    [
      CHROME,
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${tmpdir()}/kerr-gallery-profile`,
      "--enable-unsafe-webgpu",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--window-size=1600,900",
      "--no-first-run",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  ),
);

// The comparison, in the page: two pictures (data URLs) → metrics, and their difference drawn
const COMPARE = `async (refUrl, newUrl) => {
  // (measured at 160 × 90: a converging picture's grain — regolith, polarization ticks — averaged out)
  const W = 160, H = 90;
  const load = async (u) => {
    const bm = await createImageBitmap(await (await fetch(u)).blob());
    const cv = new OffscreenCanvas(W, H);
    const cx = cv.getContext("2d");
    cx.imageSmoothingQuality = "high";
    cx.drawImage(bm, 0, 0, W, H);
    return { bm, d: cx.getImageData(0, 0, W, H).data };
  };
  const [a, b] = await Promise.all([load(refUrl), load(newUrl)]);
  const lum = (d) => { const l = new Float32Array(W * H); for (let i = 0; i < W * H; i++) l[i] = (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]) / 255; return l; };
  const la = lum(a.d), lb = lum(b.d);
  // SSIM over 8 × 8 windows, stride 4
  const C1 = 0.01 ** 2, C2 = 0.03 ** 2;
  let s = 0, n = 0;
  for (let y = 0; y + 8 <= H; y += 4) for (let x = 0; x + 8 <= W; x += 4) {
    let ma = 0, mb = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { ma += la[(y + j) * W + x + i]; mb += lb[(y + j) * W + x + i]; }
    ma /= 64; mb /= 64;
    let va = 0, vb = 0, cab = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const da = la[(y + j) * W + x + i] - ma, db = lb[(y + j) * W + x + i] - mb;
      va += da * da; vb += db * db; cab += da * db;
    }
    va /= 63; vb /= 63; cab /= 63;
    s += ((2 * ma * mb + C1) * (2 * cab + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    n++;
  }
  // the share moved by over a tenth (3 × 3 smoothed), and the difference drawn (red: brighter, blue: darker)
  const diff = new ImageData(W, H);
  let moved = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let d = 0, k = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = Math.min(Math.max(x + i, 0), W - 1), yy = Math.min(Math.max(y + j, 0), H - 1);
      d += lb[yy * W + xx] - la[yy * W + xx]; k++;
    }
    d /= k;
    if (Math.abs(d) > 0.1) moved++;
    const o = 4 * (y * W + x), g = Math.min(Math.abs(d) * 4, 1) * 255;
    diff.data[o] = d > 0 ? g : 0; diff.data[o + 1] = 0; diff.data[o + 2] = d < 0 ? g : 0; diff.data[o + 3] = 255;
  }
  // the colour: each 10 × 10 block's mean, the largest change of a channel's
  let tone = 0;
  for (let by = 0; by < H; by += 10) for (let bx = 0; bx < W; bx += 10) {
    const m = [0, 0, 0];
    for (let y = by; y < by + 10; y++) for (let x = bx; x < bx + 10; x++) for (let c = 0; c < 3; c++) m[c] += b.d[4 * (y * W + x) + c] - a.d[4 * (y * W + x) + c];
    for (let c = 0; c < 3; c++) tone = Math.max(tone, Math.abs(m[c]) / (100 * 255));
  }
  window.__cmp ??= [];
  window.__cmp.push({ a: a.bm, b: b.bm, diff });
  return { ssim: s / n, area: moved / (W * H), tone, i: window.__cmp.length - 1 };
}`;

// the flagged scenes side by side (the repository's │ the capture │ the difference), posted as a PNG
const SHEET = `async (rows) => {
  const W = 320, H = 180, T = 22;
  const cv = new OffscreenCanvas(3 * W, rows.length * (H + T));
  const up = (img) => { const c = new OffscreenCanvas(img.width, img.height); c.getContext("2d").putImageData(img, 0, 0); return c; };
  const cx = cv.getContext("2d");
  cx.fillStyle = "#111"; cx.fillRect(0, 0, cv.width, cv.height);
  rows.forEach((r, k) => {
    const c = window.__cmp[r.i], y = k * (H + T);
    cx.fillStyle = "#ddd"; cx.font = "13px sans-serif";
    cx.fillText(r.name + "  —  SSIM " + r.ssim.toFixed(3) + ", moved " + (100 * r.area).toFixed(1) + " %, colour " + (100 * r.tone).toFixed(1) + " %", 6, y + 15);
    cx.drawImage(c.a, 0, y + T, W, H);
    cx.drawImage(c.b, W, y + T, W, H);
    cx.imageSmoothingEnabled = false;
    cx.drawImage(up(c.diff), 2 * W, y + T, W, H);
    cx.imageSmoothingEnabled = true;
  });
  const blob = await cv.convertToBlob({ type: "image/png" });
  await fetch("/__snapshot?name=gallery-diff.png", { method: "POST", body: blob });
  return true;
}`;

const report: { name: string; ssim: number; area: number; tone?: number; flagged: boolean; i: number; note?: string }[] = [];
try {
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 200; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const errors = new Set<string>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) pending.get(d.id)!(d.result ?? d.error);
    if (d.method === "Runtime.exceptionThrown")
      errors.add((d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).split("\n")[0]);
  };
  const cdp = (method: string, params: object = {}) =>
    new Promise<any>((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const js = async (expr: string) => {
    const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r?.result?.value;
  };
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
  await cdp("Page.navigate", { url: URL_ });
  for (let i = 0; i < 120; i++) {
    if (await js(`return typeof __bh !== "undefined" && !!__bh.renderer`).catch(() => false)) break;
    await sleep(500);
  }
  await sleep(4000);
  const dataUrl = async (f: string) => `data:image/webp;base64,${Buffer.from(await Bun.file(f).arrayBuffer()).toString("base64")}`;
  const t0 = Date.now();
  for (const [k, name] of SCENES.entries()) {
    const slug = sceneSlug(name);
    // (warmed first: its maps streamed in, the Earth's relief read back, before the capture's clock starts)
    await js(`__bh.preset(${JSON.stringify(name)}); return 0`);
    await sleep(WARM);
    await js(`return await __bh.captureScenes(${JSON.stringify([name])})`);
    const cap = `snapshots/scene-${slug}.webp`,
      ref = `assets/scenes/${slug}.webp`;
    let row: (typeof report)[number];
    if (!existsSync(cap)) row = { name, ssim: 0, area: 1, flagged: true, i: -1, note: "not captured" };
    else if (!existsSync(ref)) row = { name, ssim: 0, area: 1, flagged: true, i: -1, note: "new: no picture yet" };
    else {
      const m = await js(`return await (${COMPARE})(${JSON.stringify(await dataUrl(ref))}, ${JSON.stringify(await dataUrl(cap))})`);
      // (the polarization's ticks: their noise leaves no structure to compare — SSIM ignored)
      const [sMin, aMax, tMax] = moving(name)
        ? [presets[name]!.polarization ? 0 : SSIM_MOVING, AREA_MOVING, TONE_MOVING]
        : [SSIM_MIN, AREA_MAX, TONE_MAX];
      row = { name, ...m, flagged: m.ssim < sMin || m.area > aMax || m.tone > tMax };
    }
    report.push(row);
    const eta = (((Date.now() - t0) / (k + 1)) * (SCENES.length - k - 1)) / 1000;
    console.log(
      `${row.flagged ? "✗" : "✓"} ${name.padEnd(58)} ${row.note ?? `SSIM ${row.ssim.toFixed(3)}  moved ${(100 * row.area).toFixed(1).padStart(5)} %  colour ${(100 * row.tone!).toFixed(1).padStart(4)} %`}   (${Math.round(eta)} s left)`,
    );
  }
  const flagged = report.filter((r) => r.flagged && r.i >= 0);
  if (flagged.length) await js(`return await (${SHEET})(${JSON.stringify(flagged)})`);
  await Bun.write(
    "snapshots/gallery-report.json",
    JSON.stringify({ ssimMin: SSIM_MIN, areaMax: AREA_MAX, toneMax: TONE_MAX, scenes: report.map(({ i, ...r }) => r) }, null, 1),
  );
  if (errors.size) console.log(`\npage errors:\n  ${[...errors].join("\n  ")}`);
} finally {
  kill();
}

const bad = report.filter((r) => r.flagged);
console.log(
  `\n${report.length - bad.length} / ${report.length} scenes unchanged${bad.length ? ` — ${bad.length} flagged: snapshots/gallery-diff.png` : ""}`,
);
if (UPDATE) {
  await Bun.$`bun scripts/scene-thumbs.ts`;
  process.exit(0);
}
process.exit(bad.length ? 1 : 0);
