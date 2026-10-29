// The low pass over a world (docs/PLAN-CAMERA-AAA.md CAM7): the cinematic voyage's "rase-motte" — down from where the
// camera comes in, along a great circle a few hundred metres over the ground (the relief followed with a look ahead:
// the highest ground of the next stretch, smoothed, so a ridge is climbed before it is reached, never cut through),
// then up to where it leaves; its speed along the ground a share of its height (the free camera's law: slow low,
// fast high), the look along the track, a little down, banked into its turn. In the body's fixed axes, lengths in M.
// Pure: the ground is asked of `ground(direction)` — its height over the body's sphere.

import type { Vec3 } from "../physics";

export interface SkimSpec {
  /** the body's sphere radius [M] */
  R: number;
  /** the ground's height over that sphere along a unit direction (body-fixed) [M] */
  ground: (u: Vec3) => number;
  /** where the track begins (unit, body-fixed) and its heading there (unit, tangent) */
  start: Vec3;
  heading: Vec3;
  /** the track's length on the sphere [rad] */
  arc: number;
  /** the pass's height over the ground [M]; the height coming in and going out (over the sphere) [M] */
  hSkim: number;
  hIn: number;
  hOut: number;
  /** the share of the time coming down and going up (each) */
  ease?: number;
  /** the share of the track coming down (else `ease`): a long glide down — from the night onto the day — first */
  easeIn?: number;
  /** samples along the track */
  n?: number;
  /** the screen-rate weights of the three stretches — coming down, the pass, going up — (each step's cost on the screen,
   *  its height's change in logarithm plus its way in heights, × its stretch's weight: one rate all along); none: the
   *  time ∝ 1 / height all along */
  shares?: [number, number, number];
}

export interface SkimPose {
  /** body-fixed place [M], look and up */
  P: Vec3;
  fwd: Vec3;
  up: Vec3;
  /** the height over the ground under it [M] */
  agl: number;
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** The point at angle θ along the great circle from `start` heading `heading`. */
function onCircle(start: Vec3, heading: Vec3, th: number): Vec3 {
  return add([start[0] * Math.cos(th), start[1] * Math.cos(th), start[2] * Math.cos(th)], heading, Math.sin(th));
}

/** Plans the pass: its pose at a share k ∈ [0, 1] of its time. */
export function planSkim(o: SkimSpec): { at(k: number): SkimPose; arc: number } {
  const n = o.n ?? 600;
  const ease = o.ease ?? 0.22;
  const easeIn = o.easeIn ?? ease;
  const h = unit(add(o.heading, o.start, -dot(o.heading, o.start)));
  // the ground along the track, then its look ahead: the highest of the next ~2 % of the track, smoothed both ways
  const g = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) g[i] = o.ground(onCircle(o.start, h, (o.arc * i) / n));
  const w = Math.max(2, Math.round(n * 0.02));
  const ahead = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    let m = g[i]!;
    for (let j = 1; j <= w && i + j <= n; j++) m = Math.max(m, g[i + j]!);
    ahead[i] = m;
  }
  const f = new Float64Array(n + 1);
  // (a forward and a backward pass of a first-order filter: no lag, no overshoot under the ground)
  let a = ahead[0]!;
  for (let i = 0; i <= n; i++) f[i] = a = Math.max(ahead[i]!, a + (ahead[i]! - a) * 0.15);
  a = f[n]!;
  for (let i = n; i >= 0; i--) f[i] = a = Math.max(f[i]!, a + (f[i]! - a) * 0.15);
  // the height over the sphere at each sample: in from hIn, the pass, out to hOut (eased on the logarithm of the height
  // over the ground: the descent fast high, slow low)
  const H = (i: number) => {
    const k = i / n;
    const floor = f[i]! + o.hSkim;
    const lin = (x0: number, x1: number, e: number) =>
      Math.exp(Math.log(Math.max(x0, 1e-15)) * (1 - e) + Math.log(Math.max(x1, 1e-15)) * e);
    if (k < easeIn) return Math.max(floor, f[i]! + lin(Math.max(o.hIn - f[i]!, o.hSkim), o.hSkim, smooth(k / easeIn)));
    if (k > 1 - ease) return Math.max(floor, f[i]! + lin(o.hSkim, Math.max(o.hOut - f[i]!, o.hSkim), smooth((k - 1 + ease) / ease)));
    return floor;
  };
  const hs = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) hs[i] = H(i);
  // the time along the track: the speed over the ground a share of the height over it (slow low, fast high) — the
  // share of the time at each sample ∝ 1 / agl
  const tcum = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const agl = Math.max(0.5 * (hs[i]! + hs[i - 1]! - g[i]! - g[i - 1]!), o.hSkim * 0.5);
    tcum[i] = tcum[i - 1]! + 1 / agl;
  }
  const total = tcum[n]!;
  // (the shares' schedule: each segment — down, along, up — at a steady rate on the screen: a step's cost the change of
  // the height's logarithm plus the way gone in heights, the sample at a share of its segment's cost)
  const ie = Math.round(n * easeIn),
    io = n - ie;
  const cost = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const a0 = Math.max(hs[i - 1]! - g[i - 1]!, 1e-15),
      a1 = Math.max(hs[i]! - g[i]!, 1e-15);
    const ds = ((o.R + 0.5 * (hs[i]! + hs[i - 1]!)) * o.arc) / n;
    cost[i] = cost[i - 1]! + Math.abs(Math.log(a1 / a0)) + ds / Math.sqrt(a0 * a1);
  }
  // (one rate all along — the shares weight the three stretches' costs, so no stretch hands over a different speed:
  // descent, pass and climb at a steady speed on the screen; their weights stretch or squeeze each as a whole)
  const [wd, wp, wc] = o.shares ?? [1, 1, 1];
  const weighted = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const wgt = i <= ie ? wd : i <= io ? wp : wc;
    weighted[i] = weighted[i - 1]! + (cost[i]! - cost[i - 1]!) * wgt;
  }
  const scheduled = (k: number) => {
    const want = k * weighted[n]!;
    let lo = 0,
      hi = n;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (weighted[m]! <= want) lo = m;
      else hi = m;
    }
    return lo + (want - weighted[lo]!) / Math.max(weighted[hi]! - weighted[lo]!, 1e-300);
  };
  const sample = (k: number) => {
    if (o.shares) return Math.min(n, Math.max(0, scheduled(Math.min(1, Math.max(0, k)))));
    // (the sample whose time is k of the whole)
    const want = Math.min(1, Math.max(0, k)) * total;
    let lo = 0,
      hi = n;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (tcum[m]! <= want) lo = m;
      else hi = m;
    }
    const fr = (want - tcum[lo]!) / Math.max(tcum[hi]! - tcum[lo]!, 1e-300);
    return lo + fr * (hi - lo);
  };
  const place = (x: number): { P: Vec3; agl: number } => {
    const i = Math.min(n - 1, Math.max(0, Math.floor(x)));
    const fr = x - i;
    const r = o.R + hs[i]! * (1 - fr) + hs[i + 1]! * fr;
    const d = onCircle(o.start, h, (o.arc * x) / n);
    const gr = g[i]! * (1 - fr) + g[i + 1]! * fr;
    return { P: [d[0] * r, d[1] * r, d[2] * r], agl: r - o.R - gr };
  };
  return {
    arc: o.arc,
    at(k: number): SkimPose {
      const x = sample(k);
      const p = place(x);
      // the look: along the track a little ahead, toward the ground's horizon (a few degrees down), banked by nothing
      // (a great circle does not turn)
      const q = place(Math.min(n, x + n * 0.01));
      let fwd = unit(add(q.P, p.P, -1));
      if (!Number.isFinite(fwd[0]) || len(add(q.P, p.P, -1)) === 0) fwd = h;
      const up0 = unit(p.P);
      // (the horizon's dip from the height: looking down as much, at most 25°)
      const dip = Math.min(0.44, Math.acos(Math.min(1, o.R / (o.R + Math.max(p.agl, 0)))) + 0.06);
      const right = unit(cross(fwd, up0));
      const flat = unit(cross(up0, right));
      fwd = unit(add([flat[0] * Math.cos(dip), flat[1] * Math.cos(dip), flat[2] * Math.cos(dip)], up0, -Math.sin(dip)));
      const up = unit(cross(right, fwd));
      return { P: p.P, fwd, up, agl: p.agl };
    },
  };
}
