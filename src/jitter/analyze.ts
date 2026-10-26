// The flight's jitter, in pixels, by its cause (docs/progress/JITTER-VOL.md) — from the probe's samples (probe.ts).
//
// What a viewer sees as a tremor is the image moving by a frame what it should not: the smooth motion (a turn, the ground
// sliding) is taken out — each frame's move compared with the local trend of its rate (a weighted linear fit of the
// neighbouring frames' rates, the frame itself left out) times its own step —, the rest is the jitter. Each layer of what
// places the image is measured the same way, in output pixels (a turn by the field's pixels a radian, a roll at the
// corners):
//
// - flight   the flown craft's own attitude (the dynamics, the flight laws — before any view)
// - mount    the view's mount on the craft (the rig's springs and the camera shake turned into it)
// - camShake the camera shake alone (camshake.ts: the runway, the buffet, Mach 1, the afterburner, the engine's hum)
// - display  the display's shake (the whole image offset: renderer.shake)
// - view     what the camera and the display do together (all of the above as the eye gets it)
// - pacing   the loop's timing: the image shows the flight at the loop's time but reaches the screen at the GPU's end —
//            its latency's variation times the image's speed; and the steps' own irregularity
//
// What the shaders do on their own (the temporal history, the sparse shading's pattern, a scale change) does not show in
// the camera: the video's analysis (scripts/jitter-lab.ts) measures it. Pure.

import type { JitterSample, V3 } from "./probe";

export interface ChannelStats {
  /** the jitter's root mean square, its 95th percentile, its largest [px a frame] */
  rms: number;
  p95: number;
  max: number;
  /** the residual's strongest frequency as the frames show it [Hz], its share of the residual's power */
  freqHz: number;
  peakShare: number;
}

export interface JitterReport {
  frames: number;
  seconds: number;
  /** images a second, loop turns a second */
  fps: number;
  loopFps: number;
  /** the steps given to the flight [ms]: median, 95th percentile, coefficient of variation, the share more than 25 % off the median */
  dt: { median: number; p95: number; cov: number; irregular: number };
  gpuMs: number;
  refreshMs: number;
  /** the images' completions: the interval's median and variation, the latency from the loop's stamp (median, spread) [ms] */
  present: { known: number; intervalMedian: number; intervalCov: number; latencyMedian: number; latencyStd: number };
  /** the image's smooth speed: its median [px/s] (the camera's turn plus the ground's slide) */
  imageSpeed: number;
  channels: Record<"flight" | "mount" | "camShake" | "display" | "view" | "pacing", ChannelStats>;
  /** the renderer's own changes over the stretch: scale, shading rate, phases seen */
  render: { scaleChanges: number; rateChanges: number; phases: string[] };
  /** the causes, the strongest first: [name, rms px] */
  ranking: [string, number][];
  verdict: string;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The rotation taking the axes `p` to `n` (each a triple of vectors), as a rotation vector in the frame's own components. */
export function rotationBetween(p: [V3, V3, V3], n: [V3, V3, V3]): V3 {
  // R = Σ nᵢ ⊗ pᵢ (proper whatever the triples' handedness, both the same)
  const R = (r: number, c: number) => n[0][r]! * p[0][c]! + n[1][r]! * p[1][c]! + n[2][r]! * p[2][c]!;
  const w: V3 = [0.5 * (R(2, 1) - R(1, 2)), 0.5 * (R(0, 2) - R(2, 0)), 0.5 * (R(1, 0) - R(0, 1))];
  const s = Math.hypot(...w);
  const c = Math.min(Math.max((R(0, 0) + R(1, 1) + R(2, 2) - 1) / 2, -1), 1);
  const ang = Math.atan2(s, c);
  const k = s > 1e-12 ? ang / s : 1;
  return [w[0] * k, w[1] * k, w[2] * k];
}

/** The craft's axes in the flight's frame: the camera's axes through the mount (S's rows are the camera's axes in the ship's frame). */
export function craftAxes(cam: [V3, V3, V3], S: [V3, V3, V3]): [V3, V3, V3] {
  return [0, 1, 2].map((i) => [0, 1, 2].map((k) => cam[0][k]! * S[0][i]! + cam[1][k]! * S[1][i]! + cam[2][k]! * S[2][i]!) as V3) as [
    V3,
    V3,
    V3,
  ];
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
const std = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : 0;
};

/**
 * Each frame's move less what the local trend of the rate gives over its own step [same unit as d]. `d`: the moves a frame,
 * `tau`: the steps [s], `time`: the frames' times [s]; `sigma`: the trend's reach [s] (a Gaussian weight, the frame itself
 * left out — its own jitter does not pull its trend).
 */
export function residuals(d: number[], tau: number[], time: number[], sigma = 0.1): number[] {
  const n = d.length;
  const out = new Array<number>(n).fill(0);
  const rate = d.map((x, i) => (tau[i]! > 0 ? x / tau[i]! : 0));
  let lo = 0;
  for (let k = 0; k < n; k++) {
    if (!(tau[k]! > 0)) continue;
    while (time[lo]! < time[k]! - 3 * sigma) lo++;
    let sw = 0,
      st = 0,
      sr = 0,
      stt = 0,
      str = 0;
    for (let j = lo; j < n && time[j]! <= time[k]! + 3 * sigma; j++) {
      if (j === k || !(tau[j]! > 0)) continue;
      const u = time[j]! - time[k]!;
      const w = Math.exp((-0.5 * u * u) / (sigma * sigma));
      sw += w;
      st += w * u;
      sr += w * rate[j]!;
      stt += w * u * u;
      str += w * u * rate[j]!;
    }
    if (sw <= 0) continue;
    // (the weighted line through the neighbours' rates, read at the frame)
    const det = sw * stt - st * st;
    const r0 = Math.abs(det) > 1e-12 * sw * sw ? (sr * stt - st * str) / det : sr / sw;
    out[k] = d[k]! - r0 * tau[k]!;
  }
  return out;
}

/** The residual's strongest frequency [Hz] (a plain DFT over the frames at their mean interval) and its share of the power. */
export function peakFrequency(r: number[], fps: number): { freqHz: number; share: number } {
  const n = r.length;
  if (n < 8 || !(fps > 0)) return { freqHz: Number.NaN, share: 0 };
  const m = mean(r);
  const bins = Math.min(96, n >> 1);
  let best = 0,
    bestP = 0,
    total = 0;
  for (let b = 1; b <= bins; b++) {
    const f = (0.5 * b) / bins; // cycles a frame, up to Nyquist
    let re = 0,
      im = 0;
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * f * i;
      re += (r[i]! - m) * Math.cos(a);
      im += (r[i]! - m) * Math.sin(a);
    }
    const p = re * re + im * im;
    total += p;
    if (p > bestP) {
      bestP = p;
      best = f;
    }
  }
  return { freqHz: best * fps, share: total > 0 ? bestP / total : 0 };
}

function stats(vecs: number[][], fps: number): ChannelStats {
  const mag = vecs.map((v) => Math.hypot(...v));
  // (the frequency of the strongest component's residual)
  let comp = 0,
    best = -1;
  for (let c = 0; c < (vecs[0]?.length ?? 0); c++) {
    const e = vecs.reduce((a, v) => a + v[c]! ** 2, 0);
    if (e > best) {
      best = e;
      comp = c;
    }
  }
  const pk = peakFrequency(
    vecs.map((v) => v[comp] ?? 0),
    fps,
  );
  return {
    rms: Math.sqrt(mean(mag.map((x) => x * x))) || 0,
    p95: pct(mag, 0.95) || 0,
    max: mag.length ? Math.max(...mag) : 0,
    freqHz: pk.freqHz,
    peakShare: pk.share,
  };
}

const NAMES: Record<string, string> = {
  flight: "the craft's own motion (flight dynamics, flight laws)",
  mount: "the view's mount (rig springs + camera shake)",
  camShake: "the camera shake (camshake.ts)",
  display: "the display shake (renderer.shake: the whole image offset)",
  pacing: "the frame pacing (the loop's timing against the GPU's)",
};

export interface AnalyzeOptions {
  /** the trend's reach [s] */
  sigma?: number;
  /** a stretch only: the samples from, to [ms of the rAF clock] */
  from?: number;
  to?: number;
}

export function analyze(all: JitterSample[], o: AnalyzeOptions = {}): JitterReport {
  const span = all.filter((s) => (o.from === undefined || s.t >= o.from) && (o.to === undefined || s.t <= o.to));
  const loopSec = span.length > 1 ? (span[span.length - 1]!.t - span[0]!.t) / 1000 : 0;
  // (the images drawn: what the eye sees — a turn without one moved nothing on the screen)
  const fr = span.filter((s) => s.rendered);
  const n = fr.length;
  const seconds = n > 1 ? (fr[n - 1]!.t - fr[0]!.t) / 1000 : 0;
  const fps = seconds > 0 ? (n - 1) / seconds : 0;
  const dts = span.filter((s) => s.dt > 0).map((s) => s.dt * 1000);
  const dtMed = pct(dts, 0.5);
  const flight: number[][] = [],
    mount: number[][] = [],
    shake: number[][] = [],
    disp: number[][] = [],
    view: number[][] = [],
    tau: number[] = [],
    time: number[] = [],
    camRate: number[] = [];
  for (let k = 1; k < n; k++) {
    const a = fr[k - 1]!,
      b = fr[k]!;
    const pxr = b.H / (2 * Math.tan((b.fov * Math.PI) / 360));
    const corner = 0.5 * Math.hypot(b.W, b.H);
    // (in the camera's components now: about its right — the pitch, up and down —, its up — the yaw —, its line of sight — the roll)
    const inCam = (w: V3) => [dot(w, b.cam[1]) * pxr, dot(w, b.cam[0]) * pxr, dot(w, b.cam[2]) * corner];
    const wCam = rotationBetween(a.cam, b.cam);
    const wCraft = rotationBetween(craftAxes(a.cam, a.S), craftAxes(b.cam, b.S));
    // (the mount: the camera's axes in the ship's frame, their turn in their own components)
    const wM = rotationBetween(a.S, b.S);
    const mnt = [dot(wM, b.S[1]) * pxr, dot(wM, b.S[0]) * pxr, dot(wM, b.S[2]) * corner];
    const sh = [(b.sh[0] - a.sh[0]) * pxr, (b.sh[1] - a.sh[1]) * pxr, (b.sh[2] - a.sh[2]) * corner];
    const ds = [(b.ds[0] - a.ds[0]) * b.W, (b.ds[1] - a.ds[1]) * b.H, 0];
    const c = inCam(wCam);
    flight.push(inCam(wCraft));
    mount.push(mnt);
    shake.push(sh);
    disp.push(ds);
    view.push([c[0]! + ds[0]!, c[1]! + ds[1]!, c[2]!]);
    const t = Math.max(b.sim - a.sim, 0);
    tau.push(t);
    time.push(b.sim);
    camRate.push(t > 0 ? Math.hypot(c[0]!, c[1]!) / t + b.groundPx : 0);
  }
  const sigma = o.sigma ?? 0.1;
  const res = (vs: number[][]) => {
    const cols = [0, 1, 2].map((c) =>
      residuals(
        vs.map((v) => v[c]!),
        tau,
        time,
        sigma,
      ),
    );
    return vs.map((_, i) => cols.map((col) => col[i]!)).filter((_, i) => tau[i]! > 0);
  };
  // (the latency: the GPU's end, on the display's next refresh, after the loop's stamp)
  const known = fr.filter((s) => Number.isFinite(s.done));
  const refresh = pct(
    span.map((s) => s.refreshMs).filter((x) => x > 0),
    0.5,
  );
  const vsync = (s: JitterSample) => (refresh > 0 ? s.t + Math.max(1, Math.ceil((s.done - s.t) / refresh - 1e-6)) * refresh : s.done);
  const lat = known.map((s) => vsync(s) - s.t);
  const presented = known.map(vsync);
  const iv = presented.slice(1).map((x, i) => x - presented[i]!);
  const speed = pct(
    camRate.filter((x) => x > 0),
    0.5,
  );
  // (pacing: the image placed at the loop's time, shown at the screen's — the latency off its mean times the image's speed,
  // a frame's change of it what the eye gets as a judder; and the steps' own irregularity: each step against the interval
  // the image is on the screen)
  const latMean = mean(lat);
  const pace: number[][] = [];
  for (let i = 1; i < known.length; i++) {
    const v = speed || 0;
    pace.push([((lat[i]! - latMean - (lat[i - 1]! - latMean)) * v) / 1000, 0, 0]);
  }
  const channels = {
    flight: stats(res(flight), fps),
    mount: stats(res(mount), fps),
    camShake: stats(res(shake), fps),
    display: stats(res(disp), fps),
    view: stats(res(view), fps),
    pacing: stats(pace, fps),
  };
  let scaleChanges = 0,
    rateChanges = 0;
  const phases = new Set<string>();
  for (let i = 0; i < span.length; i++) {
    phases.add(span[i]!.phase);
    if (i && span[i]!.scale !== span[i - 1]!.scale) scaleChanges++;
    if (i && span[i]!.rate !== span[i - 1]!.rate) rateChanges++;
  }
  // (the mount less the shake: the rig's own — the two taken as independent)
  const rig = Math.sqrt(Math.max(0, channels.mount.rms ** 2 - channels.camShake.rms ** 2));
  const ranking = (
    [
      ["flight", channels.flight.rms],
      ["rig", rig],
      ["camShake", channels.camShake.rms],
      ["display", channels.display.rms],
      ["pacing", channels.pacing.rms],
    ] as [string, number][]
  ).sort((a, b) => b[1] - a[1]);
  const top = ranking[0]!;
  const verdict =
    top[1] < 0.3
      ? "no camera-side jitter above 0.3 px a frame: what shows is the renderer's (see the video's analysis)"
      : `strongest: ${NAMES[top[0]] ?? top[0]} — ${top[1].toFixed(2)} px a frame` +
        (ranking[1]![1] > 0.5 * top[1] ? `; then ${NAMES[ranking[1]![0]] ?? ranking[1]![0]} — ${ranking[1]![1].toFixed(2)} px` : "");
  return {
    frames: n,
    seconds,
    fps,
    loopFps: loopSec > 0 ? (span.length - 1) / loopSec : 0,
    dt: {
      median: dtMed,
      p95: pct(dts, 0.95),
      cov: dts.length > 1 ? std(dts) / mean(dts) : 0,
      irregular: dts.length ? dts.filter((x) => Math.abs(x - dtMed) > 0.25 * dtMed).length / dts.length : 0,
    },
    gpuMs: pct(
      fr.map((s) => s.gpuMs).filter((x) => x > 0),
      0.5,
    ),
    refreshMs: refresh,
    present: {
      known: known.length,
      intervalMedian: pct(iv, 0.5),
      intervalCov: iv.length > 1 ? std(iv) / mean(iv) : 0,
      latencyMedian: pct(lat, 0.5),
      latencyStd: std(lat),
    },
    imageSpeed: speed || 0,
    channels,
    render: { scaleChanges, rateChanges, phases: [...phases] },
    ranking,
    verdict,
  };
}
