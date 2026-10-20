// What each graphics setting of the player's screen costs the GPU (PLAN-TITRE-AAA E9b): on frozen views — the
// Cévennes' ground (the photographic surface, the scenery, the grass), Reine's fjord (the sea, the clouds), low
// orbit over the Amazon (the clouds from above), the film's pass by Gargantua (the picture's effects) —, each
// setting between its light value and its heavy one, alternated (light, heavy, light, heavy: the machine's heat
// and clocks drift on both alike), the whole frame's GPU time (every pass's timestamp) and the tracer's measured at
// the Kerr Bench's fixed frame (~1.44 Mpx, subsampling 4, the clock held). Each value is applied once first (its
// tracer compiled, its data loaded) before any measure; the measures alternate A B B A.
//   bun scripts/settings-cost.ts [--url http://localhost:3000/] [--reps 2] [--frames 90] [--seconds 4]
//                                [--out file.json] [--ts src/ui/settings/costs.ts] [--only key,key]
// (~30 min for everything on kerr-mini — run it there, headless: bun scripts/remote.ts run --headless -- …)
// --ts writes the data the player's screen shows (src/ui/settings/costs.ts) from the measure.

import { tmpdir } from "node:os";
import { chromeLock } from "./lib/chrome-lock";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const URL_ = arg("url", "http://localhost:3000/");
const REPS = Number(arg("reps", "2"));
const FRAMES = Number(arg("frames", "90"));
const SECONDS = Number(arg("seconds", "4"));
const ONLY = arg("only", "").split(",").filter(Boolean);

type Value = number | boolean | string;
/** a setting measured: its light value, its heavy one */
type Probe = [key: string, light: Value, heavy: Value];

const POST: Probe[] = [
  ["pixelRatio", 0.75, 1.25],
  ["bloom", 0, 0.5],
  ["lensFlare", 0, 1],
  ["sharpen", 0, 1],
  ["motionBlur", 0, 1],
  ["temporalReprojection", false, true],
];
const GROUND: Probe[] = [
  ["earthTerrain", false, true],
  ["earthSurface", "off", "materials"],
  ["earthScenery", "off", "high"],
  ["detailReach", "normal", "veryFar"],
  ["earthSceneryShadows", false, true],
  ["earthGrass", "off", "balanced"],
  ["earthGrassDensity", 0.25, 1],
  ["volumetricClouds", false, true],
  ["earthClouds", 0, 1],
  ["refraction", false, true],
];
const VIEWS: { name: string; scene: string; probes: Probe[] }[] = [
  { name: "Cévennes", scene: "Earth: Saint-Jean-de-Valériscle, the Cévennes", probes: [...GROUND, ...POST] },
  {
    name: "Reine",
    scene: "Earth: Reine from Reinebringen",
    probes: [
      ["seaFft", false, true],
      ["volumetricClouds", false, true],
      ["earthClouds", 0, 1],
      ["earthScenery", "off", "high"],
      ["refraction", false, true],
      ...POST,
    ],
  },
  {
    name: "Orbit",
    scene: "Earth: low orbit over the Amazon",
    probes: [
      ["volumetricClouds", false, true],
      ["earthClouds", 0, 1],
      ["pixelRatio", 0.75, 1.25],
    ],
  },
  { name: "Gargantua", scene: "Interstellar: along the disk (the film's close pass)", probes: POST },
];

const SETTLE = `{
  const r = __bh.renderer, frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
  const ts = performance.now();
  let calm = 0;
  while (performance.now() - ts < 60000) {
    const sc = r.earthScenery?.stats?.();
    const ready = (r.kernelsSettled ?? r.variantReady) && r.earthTiles.pending === 0 && !r.hdLoading && !(sc?.pending > 0);
    calm = ready ? calm || performance.now() : 0;
    if (calm && performance.now() - calm > 1500) break;
    __bh.touch(); await frame();
  }
}`;
/** the Kerr Bench's fixed frame, and one setting at a value (pixelRatio: its own, not the fixed one) */
const APPLY = (key: string, v: Value) => `{
  const s = __bh.settings;
  const area = Math.max(innerWidth * innerHeight, 1);
  Object.assign(s, { realtimeSubsampling: 4, dynamicResolution: false, pixelRatio: Math.sqrt(1.44e6 / area), fpsCap: 0, animate: false, autosave: false });
  __bh.game.set("pixelRatio", s.pixelRatio);
  __bh.game.set(${JSON.stringify(key)}, ${JSON.stringify(v)});
  __bh.touch();
}`;

// (--from file.json: the data the player's screen shows written again from a measure kept — no Chrome)
const FROM = arg("from", "");
if (FROM) {
  const kept = await Bun.file(FROM).json();
  if (arg("machine", "")) kept.machine = arg("machine", "");
  await Bun.write(arg("ts", "src/ui/settings/costs.ts"), costsTs(kept));
  process.exit(0);
}

const port = 9430 + Math.floor(Math.random() * 40);
const W = 1469,
  H = 965;
const CHROME =
  process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
await chromeLock();
const chrome = Bun.spawn(
  [
    CHROME,
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpdir()}/kerr-cost-profile`,
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
  /** the whole frame's GPU time, the tracer's [ms] (medians) */
  frame: number;
  trace: number;
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
  await cdp("Page.navigate", { url: `${URL_}#bench` });
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
  const machine =
    arg("machine", "") ||
    (await js<string>(
      `(async () => { const a = await navigator.gpu?.requestAdapter(); const i = a?.info ?? {}; return [i.vendor, i.architecture, i.description].filter(Boolean).join(" ") || "unknown"; })()`,
    ));
  const defaults = await js<Record<string, Value>>(
    `(() => { const d = {}; for (const [k, v] of Object.entries(__bh.settings)) if (typeof v !== "object") d[k] = v; return d; })()`,
  );

  const measure = () =>
    js<Run>(`(async () => {
      const r = __bh.renderer;
      const frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
      ${SETTLE}
      const tw = performance.now();
      for (let i = 0; i < 90 && performance.now() - tw < 2000; i++) { __bh.touch(); await frame(); }
      r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
      const fr = [], tr = [];
      let seen = r.prof.frames;
      const tm = performance.now();
      for (let i = 0; i < ${FRAMES} * 3 && fr.length < ${FRAMES} && (fr.length < 20 || performance.now() - tm < ${SECONDS} * 1000); i++) {
        __bh.touch();
        await frame();
        if (r.prof.frames === seen) continue;
        seen = r.prof.frames;
        const t = r.prof.table();
        fr.push(t.reduce((a, p) => a + p.last, 0));
        tr.push(t.filter((p) => p.label === "trace").reduce((a, p) => a + p.last, 0));
      }
      r.prof.enabled = false; r.prof.every = 8;
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
      return { frame: med(fr), trace: med(tr), n: fr.length };
    })()`);

  const out: {
    date: string;
    machine: string;
    frame: string;
    views: Record<
      string,
      Record<string, { light: Value; heavy: Value; lightMs: number[]; heavyMs: number[]; lightTrace: number[]; heavyTrace: number[] }>
    >;
  } = { date: new Date().toISOString().slice(0, 10), machine, frame: "~1.44 Mpx, subsampling 4, the clock held", views: {} };

  for (const v of VIEWS) {
    const probes = v.probes.filter(([k]) => !ONLY.length || ONLY.includes(k));
    if (!probes.length) continue;
    out.views[v.name] = {};
    await js(`(async () => { __bh.game.preset(${JSON.stringify(v.scene)}); __bh.touch(); return true; })()`);
    for (const [key, light, heavy] of probes) {
      const row = {
        light,
        heavy,
        lightMs: [] as number[],
        heavyMs: [] as number[],
        lightTrace: [] as number[],
        heavyTrace: [] as number[],
      };
      out.views[v.name]![key] = row;
      // (each value once first: its tracer compiled, its data in)
      for (const val of [heavy, light]) {
        await js(
          `(async () => { ${APPLY(key, val)}; const frame = () => new Promise((res) => requestAnimationFrame(() => res(null))); ${SETTLE}; await new Promise((r) => setTimeout(r, 1500)); return true; })()`,
        );
      }
      // (A B B A …: a drift of the machine or of the scene's data falls on both alike)
      for (let k = 0; k < REPS; k++)
        for (const [side, val] of (k % 2
          ? [
              ["heavy", heavy],
              ["light", light],
            ]
          : [
              ["light", light],
              ["heavy", heavy],
            ]) as [string, Value][]) {
          await js(`(async () => { ${APPLY(key, val)}; return true; })()`);
          const r = await measure().catch((e) => (console.log(`  ${v.name} ${key}=${val}: ${(e as Error).message}`), null));
          if (!r) continue;
          (side === "light" ? row.lightMs : row.heavyMs).push(r.frame);
          (side === "light" ? row.lightTrace : row.heavyTrace).push(r.trace);
        }
      const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
      const a = mean(row.lightMs),
        b = mean(row.heavyMs);
      console.log(
        `${v.name.padEnd(10)} ${key.padEnd(22)} ${String(light).padStart(9)} → ${String(heavy).padEnd(9)} ${a.toFixed(2).padStart(7)} → ${b.toFixed(2).padStart(7)} ms (${(b - a >= 0 ? "+" : "") + (b - a).toFixed(2)}, ${((100 * (b - a)) / Math.max(a, 1e-6)).toFixed(0)} %)  [${row.lightMs.map((x) => x.toFixed(1))} | ${row.heavyMs.map((x) => x.toFixed(1))}]`,
      );
      // (back to the default)
      await js(`(async () => { __bh.game.set(${JSON.stringify(key)}, ${JSON.stringify(defaults[key])}); __bh.touch(); return true; })()`);
    }
  }
  const file = arg("out", "");
  if (file) await Bun.write(file, JSON.stringify(out, null, 1));
  const ts = arg("ts", "");
  if (ts) await Bun.write(ts, costsTs(out));
} finally {
  kill();
}

/** src/ui/settings/costs.ts from a measure: each setting's worst view (the most it adds to a frame). */
function costsTs(o: {
  date: string;
  machine: string;
  frame: string;
  views: Record<string, Record<string, { light: Value; heavy: Value; lightMs: number[]; heavyMs: number[] }>>;
}): string {
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
  const sd = (a: number[]) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(a.length - 1, 1));
  };
  /** the difference's noise: twice its standard error over the repetitions */
  const noise = (r: { lightMs: number[]; heavyMs: number[] }) =>
    2 * Math.sqrt(sd(r.lightMs) ** 2 / r.lightMs.length + sd(r.heavyMs) ** 2 / r.heavyMs.length);
  const best: Record<string, { view: string; light: Value; heavy: Value; lightMs: number; heavyMs: number; noise: number }> = {};
  const aside: string[] = [];
  for (const [view, rows] of Object.entries(o.views))
    for (const [key, r] of Object.entries(rows)) {
      if (!r.lightMs.length || !r.heavyMs.length) continue;
      const c = {
        view,
        light: r.light,
        heavy: r.heavy,
        lightMs: +mean(r.lightMs).toFixed(2),
        heavyMs: +mean(r.heavyMs).toFixed(2),
        noise: +noise(r).toFixed(2),
      };
      // (a heavy value cheaper beyond the noise: not published — on 2026-10-20 the Cévennes' grass, scenery and
      // terrain switched off measured 2–3× the frame, the tracer unchanged, and a second harness did not see it)
      if (c.heavyMs < c.lightMs * 0.97) {
        aside.push(`${key} (${view}: ${c.lightMs} → ${c.heavyMs} ms)`);
        continue;
      }
      // (its worst view where the difference stands out of the noise; where it stands out nowhere, its most precise
      // view — the difference there within the noise, shown as negligible)
      const prev = best[key];
      const signal = (x: typeof c) => (x.heavyMs - x.lightMs > x.noise ? x.heavyMs - x.lightMs : 0);
      if (!prev || signal(c) > signal(prev) || (signal(c) === signal(prev) && signal(c) === 0 && c.noise < prev.noise)) best[key] = c;
    }
  const lines = Object.entries(best)
    .map(([k, c]) => `  ${k}: ${JSON.stringify(c).replace(/"(\w+)":/g, "$1: ")},`)
    .join("\n");
  // (a setting whose every view was set aside: none of its measures published)
  const lostKeys = [...new Set(aside.map((x) => x.split(" ")[0]!))].filter((k) => !best[k]);
  return `// What the graphics settings cost the GPU (PLAN-TITRE-AAA E9b), measured by scripts/settings-cost.ts — written by
// it (--ts, or --from a measure kept), not by hand. For each setting its worst view: the whole frame's GPU time with
// its light value and with its heavy one, at the Kerr Bench's fixed frame (${o.frame}), on ${o.machine}, ${o.date}.
// A setting not here was not measured, or not reliably: the player's screen shows no cost for it.
// Set aside (the heavy value cheaper beyond the noise, unexplained): ${aside.join("; ") || "none"}.
// Not published at all: ${lostKeys.join(", ") || "none"}.

import type { Settings } from "../../settings";

export interface SettingCost {
  /** the view where it costs the most */
  view: string;
  /** the values compared */
  light: number | boolean | string;
  heavy: number | boolean | string;
  /** the whole frame's GPU time with each [ms] */
  lightMs: number;
  heavyMs: number;
  /** the difference's noise: twice its standard error over the repetitions [ms] */
  noise: number;
}

export const COSTS_MEASURED = { date: ${JSON.stringify(o.date)}, machine: ${JSON.stringify(o.machine)}, frame: ${JSON.stringify(o.frame)} };

export const SETTING_COSTS: Partial<Record<keyof Settings, SettingCost>> = {
${lines}
};
`;
}
