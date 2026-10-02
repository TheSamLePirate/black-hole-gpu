// Condensation trails: what the engines and the wingtips leave in the air.
//
// An engine's exhaust carries water vapour; mixed with the cold air behind the craft it saturates and
// freezes into a trail when the air is cold enough — the Schmidt–Appleman criterion: the mixing line
// of the exhaust and the air touches the saturation curve below a threshold temperature that rises with
// the pressure (Earth: above ~7–8 km in the standard atmosphere, at the ground in a polar winter; Titan,
// everywhere; Venus's hot deep air, never). A rocket's exhaust is wetter than a jet's (more water per
// kilogram burnt): its threshold is warmer. The trail widens (the wake's vortices, then the air's
// turbulence) and thins as it does, then sublimates — here within a few minutes.
//
// A wing pulling hard in moist warm air drops the pressure in its tip vortices below saturation: short
// white spirals from the wingtips, gone in a few seconds.
//
// The trails are kept in the body's frame (SI, centred on it), fixed to the air: carried round with the
// ground on our side's turning worlds, at rest in the frames of Gargantua's. Each frame they are handed to
// the renderer in the ship's frame, relative to its origin (ship.ts draws them).

export type V3 = [number, number, number];

/** A source this step: where it is (body frame [m]), what kind (0: an engine, 1: a wingtip), how
 *  strongly it makes a trail (0 … 1). The key names it from step to step (one trail per key). */
export interface ContrailSource {
  key: string;
  p: V3;
  kind: 0 | 1;
  str: number;
}

interface Pt {
  p: V3;
  /** born [s of the scene] */
  t: number;
  str: number;
  /** the distance along the trail from its start [m] (where its puffs are: they stay put) */
  s: number;
}

interface Trail {
  key: string;
  kind: 0 | 1;
  pts: Pt[];
  /** still drawn out by its source */
  open: boolean;
}

/** The kinds: how long a point lives [s], its width at birth [m] and how it spreads, its optical
 *  depth across at birth (at a reference width), the time it takes to condense [s]. */
const KIND = [
  { life: 150, w0: 3, spread: 3.2, tau: 2.2, wRef: 6, form: 0.35 },
  { life: 3.5, w0: 0.6, spread: 0.7, tau: 1.2, wRef: 0.8, form: 0.05 },
] as const;

/** The most points a trail keeps, the most segments drawn. */
const MAX_PTS = 700;
export const MAX_SEGMENTS = 4096;
/** Floats per segment: its ends (ship frame) and widths [m]; their optical depths and distances along
 *  the trail (mod 10 km); the kind. */
export const SEG_FLOATS = 16;

/** A trail point's width [m] and optical depth across its middle, at an age [s]. */
export function trailLook(kind: 0 | 1, age: number, str: number): { w: number; tau: number } {
  const K = KIND[kind];
  const w = K.w0 + K.spread * Math.pow(Math.max(age, 0), 0.7);
  const form = Math.min(Math.max(age / K.form, 0), 1);
  const fade = 1 - smooth(0.55 * K.life, K.life, age);
  return { w, tau: K.tau * str * Math.min(1, K.wRef / w) * form * form * (3 - 2 * form) * fade };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * The Schmidt–Appleman threshold [K] at a pressure [Pa] for a rocket's exhaust: the mixing line's slope
 * G [Pa/K] — the water emitted per kilogram burnt (methalox's ~2.25 kg, a jet's 1.25), the heat
 * released, the air's heat capacity — then the threshold's fit (Schumann 1996): T [°C] = −46.46 +
 * 9.43 ln(G − 0.053) + 0.72 ln²(G − 0.053).
 */
export function contrailThreshold(p: number): number {
  const G = 3.0 * (p / 25000);
  const x = Math.max(Math.log(Math.max(G - 0.053, 1e-9)), -4);
  return 273.15 - 46.46 + 9.43 * x + 0.72 * x * x;
}

/** How strongly an engine at a throttle makes a trail in air of a density [kg/m³], temperature [K]
 *  and gas constant (0 … 1): the colder below the threshold the surer, none in the thinnest air. */
export function engineTrail(throttle: number, rho: number, T: number, R: number): number {
  if (!(throttle > 0.02) || !(rho > 0)) return 0;
  const Tc = contrailThreshold(rho * R * T);
  return Math.min(1, throttle * 1.4) * smooth(Tc + 2, Tc - 8, T) * smooth(2e-5, 5e-4, rho);
}

/** How strongly a wingtip's vortex condenses (0 … 1): a high lift coefficient in dense, not frozen,
 *  air at speed. */
export function tipTrail(cl: number, rho: number, T: number, speed: number): number {
  return smooth(0.7, 1.05, cl) * smooth(0.45, 0.9, rho) * smooth(255, 268, T) * smooth(40, 80, speed);
}

export class Contrails {
  trails: Trail[] = [];
  private tLast = NaN;
  private body = "";

  clear() {
    this.trails = [];
    this.tLast = NaN;
  }

  /**
   * A step at a time of the scene [s]: the air's motion carried (`carry`: a point after dt [s] — the
   * body's turn), the sources drawn on (a point every few metres; the head follows the source), the old
   * points gone. A new body: the trails dropped.
   */
  step(now: number, body: string, carry: (p: V3, dt: number) => V3, src: ContrailSource[]) {
    if (body !== this.body) {
      this.clear();
      this.body = body;
    }
    const dt = Number.isFinite(this.tLast) ? now - this.tLast : 0;
    this.tLast = now;
    // (time back — a saved game, a rewind —: the trails dropped)
    if (dt < 0) this.clear();
    if (dt > 0) for (const tr of this.trails) for (const q of tr.pts) q.p = carry(q.p, dt);
    const live = new Set<string>();
    for (const s of src) {
      if (!(s.str > 0.01)) continue;
      live.add(s.key);
      let tr = this.trails.find((x) => x.key === s.key && x.open);
      if (!tr) this.trails.push((tr = { key: s.key, kind: s.kind, pts: [], open: true }));
      const P = tr.pts;
      const head = P[P.length - 1];
      const prev = P[P.length - 2];
      // (a new point when the head is far enough from the one before it — else the head moved on)
      const step = s.kind === 0 ? 12 : 1.5;
      if (!head || !prev || dist(head.p, prev.p) > step || now - prev.t > 0.5) P.push({ p: s.p, t: now, str: s.str, s: head ? head.s + dist(head.p, s.p) : 0 });
      else {
        head.p = s.p;
        head.t = now;
        head.str = s.str;
        head.s = prev.s + dist(prev.p, s.p);
      }
      if (P.length === 1) P.push({ p: s.p, t: now, str: s.str, s: 0 });
      // (too many: the older half thinned, one point in two — far from the craft, coarser is enough)
      if (P.length > MAX_PTS) {
        const half = P.length >> 1;
        const kept = P.slice(0, half).filter((_, i) => i % 2 === 0);
        P.splice(0, half, ...kept);
      }
    }
    for (const tr of this.trails) {
      if (tr.open && !live.has(tr.key)) tr.open = false;
      const life = KIND[tr.kind].life;
      let k = 0;
      while (k < tr.pts.length && now - tr.pts[k]!.t > life) k++;
      if (k) tr.pts.splice(0, k);
    }
    this.trails = this.trails.filter((tr) => tr.pts.length > 1);
  }

  /**
   * The segments to draw (ship frame — `x` the ship's origin, `ax` its axes in the body frame —: each
   * end, its width and optical depth, the kind), at most MAX_SEGMENTS, the nearest trails' first.
   */
  view(now: number, x: V3, ax: [V3, V3, V3], out: Float32Array): number {
    let n = 0;
    const toShip = (p: V3): V3 => {
      const d: V3 = [p[0] - x[0], p[1] - x[1], p[2] - x[2]];
      return [d[0] * ax[0][0] + d[1] * ax[0][1] + d[2] * ax[0][2], d[0] * ax[1][0] + d[1] * ax[1][1] + d[2] * ax[1][2], d[0] * ax[2][0] + d[1] * ax[2][1] + d[2] * ax[2][2]];
    };
    for (const tr of this.trails) {
      const P = tr.pts;
      let a = toShip(P[P.length - 1]!.p);
      let la = trailLook(tr.kind, now - P[P.length - 1]!.t, P[P.length - 1]!.str);
      // (from the head back: the youngest, nearest part kept when there are too many)
      for (let i = P.length - 2; i >= 0 && n < MAX_SEGMENTS; i--) {
        const b = toShip(P[i]!.p);
        const lb = trailLook(tr.kind, now - P[i]!.t, P[i]!.str);
        if (la.tau > 1e-3 || lb.tau > 1e-3) {
          out.set([a[0], a[1], a[2], la.w, b[0], b[1], b[2], lb.w, la.tau, lb.tau, P[i + 1]!.s % 1e4, P[i + 1]!.s % 1e4 - (P[i + 1]!.s - P[i]!.s), tr.kind, 0, 0, 0], n * SEG_FLOATS);
          n++;
        }
        a = b;
        la = lb;
      }
    }
    return n;
  }
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
