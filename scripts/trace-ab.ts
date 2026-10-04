// The tracer's cost, A/B — two builds on the same frozen views (G1 onwards: the Kerr Bench's windows
// move the scene's clock and its probes, ±20 % between runs on the heavy scenes, more than most
// kernel changes win):
//   bun scripts/trace-ab.ts --ref http://localhost:3012/ [--new http://localhost:3000/] [--scenes "a|b"]
//                           [--reps 2] [--frames 150] [--out file.json]
// Each scene at a fixed subsampling 4 and ~1.44 Mpx, its clock held, the view marked changed every frame
// (the realtime pass, the same rays each run: the interleave and the seeds follow the frame count); every
// frame's passes timed on the GPU (timestamps) — the trace pass's median, its LUT's, the probes'. Each
// build's scenes are loaded once first (their tracers compiled), then the builds alternate (ref, new, ref,
// new): the machine's heat and clocks drift on both alike. A/A: ±1 % on the heavy scenes. Measure alone.

import { tmpdir } from "node:os";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const REF = arg("ref", "http://localhost:3012/");
const NEW = arg("new", "http://localhost:3000/");
const REPS = Number(arg("reps", "2"));
const FRAMES = Number(arg("frames", "150"));
const SCENES = arg(
  "scenes",
  "Interstellar: along the disk (the film's close pass)|Kerr a=0.94, near edge-on|Ranger: approaching Gargantua|Miller: Gargantua over the sea|Saturn: backlit|Moon: an afternoon on the plains",
).split("|");
const port = 9390 + Math.floor(Math.random() * 40);
const W = 1469,
  H = 965;
const CHROME =
  process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const chrome = Bun.spawn(
  [
    CHROME,
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpdir()}/kerr-bench-profile`,
    "--enable-unsafe-webgpu",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    `--window-size=${W},${H}`,
    "--no-first-run",
    "--mute-audio",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" },
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kill = () => {
  chrome.kill();
  Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
};
process.on("SIGINT", () => (kill(), process.exit(1)));

type Evaluated = { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } } };
interface Run {
  trace: number;
  lut: number;
  probes: number;
  n: number;
}

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
  const pending = new Map<number, (v: Evaluated) => void>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) pending.get(d.id)!(d.result ?? d.error);
  };
  const cdp = (method: string, params: object = {}) =>
    new Promise<Evaluated>((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async <T>(expr: string): Promise<T> => {
    const r = await cdp("Runtime.evaluate", { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "page error");
    return r?.result?.value as T;
  };
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  const open = async (url: string) => {
    await cdp("Page.navigate", { url: `${url}#bench` });
    await sleep(1500);
    for (let i = 0; i < 240; i++) {
      if (
        await js<boolean>(`typeof __bh !== "undefined" && !!__bh.renderer && !document.querySelector("#loading:not(.done)")`).catch(
          () => false,
        )
      )
        break;
      await sleep(500);
    }
  };
  const measure = (scene: string) =>
    js<Run>(`(async () => {
      const r = __bh.renderer, s = __bh.settings;
      const frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
      __bh.game.preset(${JSON.stringify(scene)});
      // (the fixed setting of the Kerr Bench's phase B: subsampling 4, ~1.44 Mpx; the clock held)
      const area = Math.max(innerWidth * innerHeight, 1);
      Object.assign(s, { realtimeSubsampling: 4, dynamicResolution: false, pixelRatio: Math.sqrt(1.44e6 / area), fpsCap: 0, animate: false, autosave: false });
      __bh.touch();
      const t0 = performance.now();
      while (!r.variantReady && performance.now() - t0 < 90000) { __bh.touch(); await frame(); }
      for (let i = 0; i < 240; i++) { __bh.touch(); await frame(); }
      r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
      const tr = [], lu = [], pr = [];
      let seen = r.prof.frames;
      for (let i = 0; i < ${FRAMES} * 3 && tr.length < ${FRAMES}; i++) {
        __bh.touch();
        await frame();
        if (r.prof.frames === seen) continue;
        seen = r.prof.frames;
        const t = r.prof.table();
        const get = (f) => t.filter(f).reduce((a, p) => a + p.last, 0);
        tr.push(get((p) => p.label === "trace"));
        lu.push(get((p) => p.label === "far-field LUT"));
        pr.push(get((p) => p.label.includes("probe")));
      }
      r.prof.enabled = false; r.prof.every = 8;
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
      return { trace: med(tr), lut: med(lu), probes: med(pr), n: tr.length };
    })()`);

  // (each build's scenes loaded once first: their specialised tracers compiled and cached — a changed
  // shader's first load measured the general one, 20–40 % slower)
  for (const url of [REF, NEW]) {
    await open(url);
    for (const sc of SCENES)
      await js<boolean>(`(async () => {
        const frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
        __bh.game.preset(${JSON.stringify(sc)}); __bh.touch();
        const t0 = performance.now();
        while (!__bh.renderer.variantReady && performance.now() - t0 < 90000) { __bh.touch(); await frame(); }
        return __bh.renderer.variantReady;
      })()`).catch(() => false);
  }
  const res: Record<string, { ref: Run[]; new: Run[] }> = {};
  for (const sc of SCENES) res[sc] = { ref: [], new: [] };
  for (let k = 0; k < REPS; k++)
    for (const [side, url] of [
      ["ref", REF],
      ["new", NEW],
    ] as const) {
      await open(url);
      for (const sc of SCENES) {
        const r = await measure(sc).catch((e) => (console.log(`  ${side} ${sc}: ${(e as Error).message}`), null));
        if (r) res[sc]![side].push(r);
        process.stdout.write(`  ${side}${k + 1} ${sc.slice(0, 40)}: trace ${r?.trace.toFixed(2)} ms (${r?.n} frames)\n`);
      }
    }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
  console.log("\nscene                                     trace+LUT ref → new          probes ref → new");
  for (const sc of SCENES) {
    const R = res[sc]!.ref,
      N = res[sc]!.new;
    if (!R.length || !N.length) continue;
    const a = mean(R.map((x) => x.trace + x.lut)),
      b = mean(N.map((x) => x.trace + x.lut));
    console.log(
      `${sc.slice(0, 40).padEnd(40)} ${a.toFixed(2).padStart(7)} → ${b.toFixed(2).padStart(7)} ms (${((100 * (b - a)) / a).toFixed(1).padStart(5)} %)  [${R.map((x) => x.trace.toFixed(1))} | ${N.map((x) => x.trace.toFixed(1))}]  ${mean(R.map((x) => x.probes)).toFixed(2)} → ${mean(N.map((x) => x.probes)).toFixed(2)}`,
    );
  }
  const out = arg("out", "");
  if (out) await Bun.write(out, JSON.stringify(res, null, 1));
} finally {
  kill();
}
