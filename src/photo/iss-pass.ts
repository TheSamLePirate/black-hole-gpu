// The station's passes and their trail (PLAN-CIEL C10): when the ISS crosses a place's night sky lit by the
// Sun (SGP4 on its latest elements, the game's own: system/iss.ts), its way across it, its brightness; the
// photograph — the landscape at the pass's middle, the station's trail laid over it as a long exposure draws
// it: a line of light brightening as it nears, reddening and fading as it goes into the Earth's shadow, or
// broken into dashes by the gaps between the frames of an interval shooting.

import { earthPointKm, KM, posKm, tOf } from "../eclipse/core";
import { azAltAt, azAltOfKm } from "../eclipse/earth-moon";
import { dot, len, scale, sub, type Vec3 } from "../math/vec3";
import type { Preset } from "../settings";
import { issOrbit } from "../system/iss";
import type { Exposure } from "./multiexposure";
import { type Framing, frame, projectSky } from "./plans";

const D = Math.PI / 180;
const RE = 6378.137;

/** The station at a UTC time seen from a place [°]: its place in the sky [°], its distance [km], lit by the Sun, its magnitude. */
export interface IssSight {
  ms: number;
  az: number;
  alt: number;
  range: number;
  /** its share of the Sun's light (0 in the Earth's shadow, rising through its edge — the air's reddening) */
  lit: number;
  mag: number;
}

/** The station seen from a place at a UTC time (null: its orbit lost in the propagation). */
export function issSight(lat: number, lon: number, ms: number): IssSight | null {
  const o = issOrbit(tOf(ms));
  if (!o) return null;
  const P = scale(o.X, KM);
  const { az, alt } = azAltOfKm(P, lat * D, lon * D, 0, ms);
  const E = posKm("earth", ms);
  const S = posKm("sun", ms);
  const r = sub(P, E);
  const s = sub(S, E);
  const sl = len(s);
  const su: Vec3 = [s[0] / sl, s[1] / sl, s[2] / sl];
  // (the Earth's shadow as a cylinder, its edge widened by the air's 80 km: the station entering it reddens and fades)
  const along = dot(r, su);
  const off = len(sub(r, scale(su, along)));
  const lit = along > 0 ? 1 : Math.min(Math.max((off - RE) / 80, 0), 1);
  // (its magnitude: −1.8 at 1 000 km, half lit; Lambert's sphere for the phase)
  const toSun = sub(S, P),
    toObs = sub(observerKm(lat, lon, ms), P);
  const ph = Math.acos(Math.max(-1, Math.min(1, dot(toSun, toObs) / (len(toSun) * len(toObs)))));
  const F = ((Math.PI - ph) * Math.cos(ph) + Math.sin(ph)) / Math.PI;
  const range = len(toObs);
  const mag = -1.8 + 5 * Math.log10(range / 1000) - 2.5 * Math.log10(Math.max(Math.PI * F, 1e-3));
  return { ms, az, alt, range, lit, mag };
}

const observerKm = (lat: number, lon: number, ms: number) => earthPointKm(lat * D, lon * D, 0, ms);

/** A pass: rising over 10°, its highest, setting under 10° (or into the shadow) [ms UTC], its highest altitude [°], its brightest magnitude. */
export interface IssPass {
  start: number;
  top: number;
  end: number;
  maxAlt: number;
  mag: number;
  /** the moments it is seen: lit, the sky dark enough (the Sun under −4°) */
  seenFrom: number;
  seenTo: number;
}

/**
 * The passes seen from a place over days from a date: the station over 10°, lit by the Sun, the place's sky
 * dark enough (the Sun under −4°) — scanned every 20 s, refined to the second.
 */
export function issPasses(lat: number, lon: number, from: number, days: number): IssPass[] {
  const out: IssPass[] = [];
  const step = 20e3;
  let cur: IssSight[] = [];
  const close = () => {
    const seen = cur.filter((x) => x.lit > 0.3 && azAltAt("sun", lat * D, lon * D, 0, x.ms).alt < -4);
    if (seen.length) {
      const top = cur.reduce((a, b) => (b.alt > a.alt ? b : a));
      out.push({
        start: cur[0]!.ms,
        top: top.ms,
        end: cur.at(-1)!.ms,
        maxAlt: top.alt,
        mag: Math.min(...seen.map((x) => x.mag)),
        seenFrom: seen[0]!.ms,
        seenTo: seen.at(-1)!.ms,
      });
    }
    cur = [];
  };
  for (let t = from; t < from + days * 86400e3; t += step) {
    const s = issSight(lat, lon, t);
    if (!s) break;
    if (s.alt > 10) cur.push(s);
    else if (cur.length) close();
  }
  if (cur.length) close();
  return out;
}

export interface IssPhotoOptions {
  lat: number;
  lon: number;
  pass: IssPass;
  framing: "landscape" | "sky";
  aspect: number;
  template: Preset;
  /** the base's compensation [EV] */
  comp: number;
}

/** The pass's photograph: the base frame (the landscape at its middle), the view, the station's way (every half second). */
export function issPhotoPlan(o: IssPhotoOptions): { frames: Exposure[]; view: Framing; track: IssSight[] } {
  const track: IssSight[] = [];
  for (let t = o.pass.seenFrom; t <= o.pass.seenTo; t += 500) {
    const s = issSight(o.lat, o.lon, t);
    if (s && s.alt > 0) track.push(s);
  }
  const fit = (pts: { az: number; alt: number }[]) => {
    const az0 = frame(pts, o.aspect).az;
    return o.framing === "landscape" ? frame([...pts, { az: az0, alt: -3 }], o.aspect, 6) : frame(pts, o.aspect, 5);
  };
  const all = track.filter((_, i) => i % 10 === 0).map((s) => ({ az: s.az, alt: s.alt }));
  let view = fit(all);
  // (a pass high overhead spans more sky than a lens holds: its bright high part framed, its ends running out)
  if (view.fov >= 139) {
    const top = Math.max(...all.map((p) => p.alt));
    view = fit(all.filter((p) => p.alt > Math.min(top * 0.5, 30)));
  }
  const mid = (o.pass.seenFrom + o.pass.seenTo) / 2;
  const frames: Exposure[] = [
    {
      preset: {
        ...o.template,
        ship: false,
        target: "earth",
        fov: view.fov,
        lensFlare: 0,
        time: tOf(mid),
        pose: { at: [o.lat, o.lon], heading: view.az, off: [0, view.alt] },
      },
      exposure: "auto",
      comp: o.comp,
      blend: "base",
      label: `${new Date(mid).toISOString().slice(11, 16)} UTC`,
    },
  ];
  return { frames, view, track };
}

/**
 * The station's trail drawn into the image (W × H): its way projected, each point as bright as its magnitude
 * (−4 and brighter: full; 1: faint) times its share of sunlight — reddened in the shadow's edge —, a soft
 * line of `width` px; `dashes`: the frames of an interval shooting (`exposure` s each, a second's gap between).
 */
export function drawIssTrail(
  out: Uint8ClampedArray,
  W: number,
  H: number,
  view: Framing,
  track: IssSight[],
  o: { width?: number; dashes?: boolean; exposure?: number } = {},
) {
  const width = o.width ?? Math.max(1.6, W / 1100);
  const R = Math.ceil(width * 2);
  const t0 = track[0]?.ms ?? 0;
  let prev: [number, number] | null = null;
  for (const s of track) {
    // (the gaps: a second after each exposure)
    if (o.dashes && ((s.ms - t0) / 1000) % ((o.exposure ?? 15) + 1) >= (o.exposure ?? 15)) {
      prev = null;
      continue;
    }
    const p = projectSky(view, s.az, s.alt, W, H);
    if (!p) {
      prev = null;
      continue;
    }
    const I = Math.min(Math.max((1 - s.mag) / 5, 0.12), 1) * s.lit;
    if (I <= 0.01) {
      prev = null;
      continue;
    }
    // (the colour: warm white, reddening as the light grazes the air into the shadow)
    const red = s.lit < 1 ? 1 - s.lit : 0;
    const col = [255, 238 - 120 * red, 214 - 180 * red];
    // (the segment from the last point, in steps of a third of a pixel)
    const from = prev ?? p;
    const n = Math.max(1, Math.ceil(Math.hypot(p[0] - from[0], p[1] - from[1]) * 3));
    for (let k = 1; k <= n; k++) {
      const x = from[0] + ((p[0] - from[0]) * k) / n,
        y = from[1] + ((p[1] - from[1]) * k) / n;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const ix = Math.floor(x) + dx,
            iy = Math.floor(y) + dy;
          if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
          const d = Math.hypot(ix + 0.5 - x, iy + 0.5 - y);
          // (a bright core, a soft glow)
          const w = I * (d < width / 2 ? 1 : Math.exp(-((d - width / 2) ** 2) / (0.5 * width * width)));
          if (w < 0.02) continue;
          const q = (iy * W + ix) * 4;
          for (let j = 0; j < 3; j++) {
            const v = col[j]! * w;
            if (v > out[q + j]!) out[q + j] = v;
          }
        }
    }
    prev = p;
  }
}
