// The free camera from a giant's orbit down into its clouds, filmed (PLAN-PLANETES-AAA P11): 720p, 30 images a second,
// frame by frame — the world frozen and stepped a thirtieth of a second, each image drawn whole (the refining kernels'
// cascade waited for), then shot (DevTools) —, encoded with ffmpeg (H.264), the two clips joined by a fade. No craft: the
// free camera flown as a player flies it, its forward key held, its speed's multiplier (the wheel's) and its look
// (rotateView, the drag's) set each frame from the height — a dive from orbit at −60°, levelled out over the clouds, through
// the top deck, the view level at the end.
//   jupiter  from 40 000 km over 148.6° E down to 3 km under 1 bar by the Great Red Spot in its afternoon, a storm's column
//            rising into the ammonia's ceiling ahead (the planet-views "inside" place)
//   saturn   from 50 000 km over 60° N (2076: its north lit) down to skim its cloud tops at 42° N, a storm ahead, the rings'
//            arcs in the sky
//
//   bun scripts/giant-free-video.ts [jupiter saturn] [--out dir] [--preview [--every 2] [--from s] [--to s]]
//   (--preview: no film, a still every 2 s — or as asked —, the images not waited for whole)
// Takes the Mac's Chrome lock (tests/e2e/lib/app.ts). Needs ffmpeg.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { App, stopServer } from "../tests/e2e/lib/app";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : (process.argv[i + 1] ?? d);
};
const OUT = arg("out", "remote-results/free-camera-video")!;
const PREVIEW = process.argv.includes("--preview");
/** --preview: a still every this many seconds [s], from --from to --to [s] */
const EVERY = Number(arg("every", "2")),
  FROM = Number(arg("from", "0")),
  TO = Number(arg("to", "1e9"));
const CLIPS = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const W = 1280,
  H = 720,
  FPS = 30;
const SPM = 492.5490947;

type Clip = {
  name: string;
  body: string;
  scene: string;
  /** the scene's time [M] */
  t: number;
  altKm: number;
  /** where it starts over, where it looks (the dive's heading) */
  at: [number, number];
  aim: [number, number];
  /** the heights of the levelling out moved by this [km] (the clouds' tops: Saturn's lower), and where it ends [km over 1 bar] */
  shift: number;
  end: number;
  /** the pitch held from orbit (the dive's −60°) above this height [km]; below it pitched up only */
  holdAbove: number;
};
const CLIP_LIST: Clip[] = [
  {
    name: "jupiter",
    body: "jupiter",
    scene: "Jupiter: from orbit",
    t: 109.6 + 49.7 + (0.17 * 9.925 * 3600) / SPM,
    altKm: 40000,
    at: [-12, 148.6],
    aim: [-12, 126.6],
    shift: 0,
    end: -1.5,
    holdAbove: -1e9,
  },
  {
    name: "saturn",
    body: "saturn",
    scene: "Saturn: the rings from above",
    t: 109.6 + 9.4 * 64069,
    altKm: 50000,
    at: [60, 0],
    aim: [30, 0],
    shift: 0,
    end: -3,
    holdAbove: 1e9,
  },
];

/** The flight's law, in the page: the height [km] → a pitch over the local horizon [°] and a speed's multiplier, eased between */
const plan = (c: Clip) => `(() => { let held = 0;
  const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  const S = ${c.shift};
  const P = [[1500, -60, 1], [300, -34, 1.2], [45 + S, -30, 2.4], [17 + S, -30, 3.2], [7 + S, -25, 2.2], [0 + S, -8, 1.0], [-4 + S, 0, 0.3]];
  const at = (h, k) => { if (h >= P[0][0]) return P[0][k]; for (let i = 1; i < P.length; i++) if (h >= P[i][0]) {
    const h0 = P[i - 1][0], h1 = P[i][0], x = ss(0, 1, (h0 - h) / (h0 - h1)); return P[i - 1][k] + (P[i][k] - P[i - 1][k]) * x; }
    return P[P.length - 1][k]; };
  return (tau, h, dt, now) => {
    // (12° a second at most; down too only where held — above, the dive's own line kept until the pitch asked is above it)
    const want = at(h, 1);
    const dp = Math.max(h < ${c.holdAbove} ? -12 * dt : 0, Math.min(12 * dt, want - now));
    if (h <= ${c.end}) held += dt;
    const fs = ss(0.3, 1.8, tau) * at(h, 2) * (1 - 0.6 * ss(0, 4, held));
    return { fs, dp, done: held > 6 };
  }; })()`;

async function film(app: App, c: Clip): Promise<string | null> {
  const dir = `${OUT}/${c.name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await app.js(`(() => { __bh.presets.zzfree = { ...__bh.presets[${JSON.stringify(c.scene)}], time: ${c.t}, target: "${c.body}", ship: false, fov: 60,
    pose: { body: "${c.body}", altKm: ${c.altKm}, at: [${c.at}], aim: [${c.aim}] } };
    __bh.game.preset("zzfree"); Object.assign(__bh.settings, { animate: true, dynamicResolution: false, showFps: false, dof: false, motionBlur: 0 });
    window.__plan = ${plan(c)}; document.body.classList.add("hide-ui"); return 1; })()`);
  await app.settled();
  await app.js(`(__bh.freeze(true), 1)`);
  let k = 0;
  for (; k < 90 * FPS; k++) {
    const r = await app.js<{ line: string; done: boolean }>(`(async () => {
      const c = __bh.camera, g0 = __bh.sys.geodetic(), w = c.rigWorld(), B = c.rigBody("${c.body}", true, c.nowTime());
      const d = [0, 1, 2].map((i) => w.X[i] - B.C[i]), l = Math.hypot(...d);
      const pitch = (Math.asin((w.fwd[0] * d[0] + w.fwd[1] * d[1] + w.fwd[2] * d[2]) / l) * 180) / Math.PI;
      const P = window.__plan(${k / FPS}, g0 ? g0.altM / 1e3 : 1e9, ${1 / FPS}, pitch);
      // (the key held, its boost held at its tap's — the speed the wheel's multiplier —, the look turned as a drag turns it)
      c.flySpeed = Math.max(P.fs, 1e-4); c.moveHeld = 0;
      if (P.fs > 1e-3) c.codes.add("KeyW"); else c.codes.delete("KeyW");
      if (P.dp) c.rotateView(0, P.dp, 0);
      __bh.step(${1 / FPS});
      // (the image of that step drawn whole: three frames completed, nothing compiling, the refining cascade done)
      const r = __bh.renderer, c0 = r.completedFrames, t0 = performance.now();
      if (${!PREVIEW}) while ((r.completedFrames < c0 + 3 || r.compilingNow.length > 0 || r.variants.get(r.featureKey)?.qBusy) && performance.now() - t0 < 120000) {
        __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
      else await new Promise((q) => requestAnimationFrame(q));
      const g = __bh.sys.geodetic();
      return { line: g ? (g.altM / 1e3).toFixed(2) + " km · " + g.lat.toFixed(2) + "°, " + g.lon.toFixed(2) + "° · pitch " + pitch.toFixed(1) + "° · speed ×" + P.fs.toFixed(2) : "—", done: P.done }; })()`);
    if (r.done) break;
    if (!PREVIEW) {
      const s = (await app.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92 })) as { data: string };
      writeFileSync(`${dir}/${String(k).padStart(6, "0")}.jpg`, Buffer.from(s.data, "base64"));
    } else if (k / FPS >= FROM && k / FPS <= TO && k % Math.max(1, Math.round(EVERY * FPS)) === 0)
      await app.shot(`${dir}/still-${(k / FPS).toFixed(2).padStart(5, "0")}s.png`);
    if (k % FPS === 0) console.log(`  ${c.name} ${(k / FPS).toFixed(0)} s: ${r.line}`);
  }
  await app.js(
    `(() => { __bh.camera.codes.delete("KeyW"); __bh.camera.flySpeed = 1; __bh.freeze(false); document.body.classList.remove("hide-ui"); return 1; })()`,
  );
  if (PREVIEW) return null;
  const out = `${OUT}/${c.name}-orbit-to-clouds.mp4`;
  const p = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(FPS),
      "-i",
      `${dir}/%06d.jpg`,
      "-vf",
      `scale=${W}:${H}:flags=lanczos`,
    ].concat(["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]),
    { stdout: "inherit", stderr: "inherit" },
  );
  await p.exited;
  console.log(`${c.name}: ${k} images → ${out}`);
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const app = await App.boot({ width: W, height: H, hash: `scene=${encodeURIComponent("Jupiter: from orbit")}`, telemetry: false });
  const made: string[] = [];
  try {
    for (const c of CLIP_LIST) if (!CLIPS.length || CLIPS.includes(c.name)) made.push((await film(app, c)) ?? "");
  } finally {
    app.close();
    stopServer();
  }
  // (both: one film, the second faded in over the first's last 0.8 s)
  const films = made.filter(Boolean);
  if (films.length === 2) {
    const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", films[0]!]);
    const off = (Number(probe.stdout.toString().trim()) - 0.8).toFixed(2);
    const out = `${OUT}/giants-free-camera.mp4`;
    const p = Bun.spawn(
      ["ffmpeg", "-y", "-loglevel", "error", "-i", films[0]!, "-i", films[1]!, "-filter_complex"]
        .concat([`[0:v][1:v]xfade=transition=fade:duration=0.8:offset=${off},format=yuv420p[v]`, "-map", "[v]"])
        .concat(["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", out]),
      { stdout: "inherit", stderr: "inherit" },
    );
    await p.exited;
    console.log(`→ ${out}`);
  }
}

await main();
