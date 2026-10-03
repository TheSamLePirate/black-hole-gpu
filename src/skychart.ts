// The sky chart: our sky's constellations (their figures and names), its named stars, the equatorial
// grid of the date, the horizontal (altitude–azimuth) grid of the place the camera stands over, the
// ecliptic. Built each frame as the camera sees them — a matrix from the home frame to its view, the
// aberration of its motion —, lines for the GPU's overlay (drawn over the image where the sky shows:
// renderer.ts, overlay.wgsl) and labels for the 2D layer (main.ts). Our side only: the black hole's
// universe has other stars.
//
// Data: assets/sky/constellations.json (scripts/build-constellations.ts), ICRS unit vectors.

import sky from "../assets/sky/constellations.json";
import { basis, yawPitchRoll, type CameraFrame } from "./camera";
import type { Settings } from "./settings";
import type { Vec3 } from "./physics";
import { projectLook } from "./shadow";
import { aberrateRep, cameraHome, onOurSide } from "./targeting";
import { homeToRep, ourState } from "./system/our-side";
import { eclOf, equatorOfDate } from "./system/orientation";
import { bodyPole, SOLAR_BODIES, utcOf } from "./system/solar";
import { tdbOf } from "./system/timescale";
import { mouth } from "./wormhole";
import { cross, dot, lin } from "./math/vec3";

// ------------------------------------------------------------------------------------ the data
export interface Constellation {
  abbr: string;
  name: string;
  label: Vec3;
}
export interface NamedStar {
  name: string;
  v: Vec3;
  mag: number;
  constellation: number;
}

const D = Math.PI / 180;
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** the constellations, their figures' segments (home frame: J2000 ecliptic) and the named stars */
export const CONSTELLATIONS: Constellation[] = sky.constellations.map((c) => ({
  abbr: c.abbr,
  name: c.name,
  label: eclOf(c.label as Vec3),
}));
const SEGMENTS: { a: Vec3; b: Vec3; c: number }[] = sky.segments.map((s) => ({
  a: eclOf([s[0]!, s[1]!, s[2]!]),
  b: eclOf([s[3]!, s[4]!, s[5]!]),
  c: s[6]!,
}));
/** the constellation a direction's nearest figure belongs to (the figures' segments; within 12°), or −1 */
function figureOf(v: Vec3) {
  let best = -1,
    bd = Math.cos(12 * D);
  for (const s of SEGMENTS) {
    const d = Math.max(dot(v, s.a), dot(v, s.b), dot(v, unit(lin(s.a, 1, s.b, 1))));
    if (d > bd) (bd = d), (best = s.c);
  }
  return best;
}
export const NAMED_STARS: NamedStar[] = sky.stars.map((s) => {
  const v = eclOf(s.v as Vec3);
  return { name: s.name, v, mag: s.mag, constellation: figureOf(v) };
});

// ------------------------------------------------------------------------------------ the frames
/** J2000 ecliptic → equatorial (ICRS) components, and right ascension / declination [°] */
export function raDecOf(v: Vec3, axes?: [Vec3, Vec3, Vec3]): [number, number] {
  const e: Vec3 = axes ? [dot(v, axes[0]), dot(v, axes[1]), dot(v, axes[2])] : icrsOf(v);
  return [(((Math.atan2(e[1], e[0]) / D) % 360) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, e[2]))) / D];
}
const CE = Math.cos((84381.448 / 3600) * D),
  SE = Math.sin((84381.448 / 3600) * D);
/** home frame (J2000 ecliptic) → ICRS */
export const icrsOf = (v: Vec3): Vec3 => [v[0], CE * v[1] - SE * v[2], SE * v[1] + CE * v[2]];

/** The camera's horizon: the body it is near (within two of its radii from its surface), its zenith, north
 *  and east there (home frame), and how far below the horizon it sees the body's limb [rad] */
export interface Horizon {
  body: string;
  zenith: Vec3;
  north: Vec3;
  east: Vec3;
  dip: number;
  X: Vec3;
  C: Vec3;
  R: number;
}
export function horizonAt(s: Settings, cam: CameraFrame, t: number): Horizon | null {
  return onOurSide(s, cam) ? horizonOf(cameraHome(s, cam), t) : null;
}
/** the horizon of a home-frame point at scene time t (see horizonAt) */
export function horizonOf(X: Vec3, t: number): Horizon | null {
  let best: Horizon | null = null,
    bh = 2;
  for (const b of SOLAR_BODIES) {
    if (b.kind !== "planet") continue;
    const C = ourState(b.id, t).pos;
    const r = Math.hypot(X[0] - C[0], X[1] - C[1], X[2] - C[2]);
    const h = (r - b.radius) / b.radius;
    if (h >= bh) continue;
    const zenith = unit([X[0] - C[0], X[1] - C[1], X[2] - C[2]]);
    const pole = bodyPole(b, t);
    let east = cross(pole, zenith);
    if (Math.hypot(...east) < 1e-9) east = cross([0, 0, 1], zenith);
    east = unit(east);
    bh = h;
    best = { body: b.id, zenith, north: cross(zenith, east), east, dip: Math.acos(Math.min(1, b.radius / r)), X, C, R: b.radius };
  }
  return best;
}
/** altitude, azimuth (from the north through the east) [°] of a home-frame direction */
export function altAzOf(h: Horizon, v: Vec3): [number, number] {
  const z = dot(v, h.zenith);
  return [Math.asin(Math.max(-1, Math.min(1, z))) / D, (((Math.atan2(dot(v, h.east), dot(v, h.north)) / D) % 360) + 360) % 360];
}
/** the body under the camera hides that direction */
function behindBody(h: Horizon | null, v: Vec3) {
  if (!h) return false;
  const c = lin(h.C, 1, h.X, -1);
  const tc = dot(c, v);
  if (tc <= 0) return false;
  return dot(c, c) - tc * tc < h.R * h.R;
}

// ------------------------------------------------------------------------------------ the view
/** home frame → the camera's look: the wormhole's rep components at the camera (linear: the images A of
 *  the axes), then the aberration of its motion */
function viewOf(s: Settings, cam: CameraFrame) {
  const w = mouth(s).w;
  const A = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].map((e) => homeToRep(w, cam.ell, cam.n, e as Vec3));
  const beta = cam.beta;
  const moving = dot(beta, beta) > 1e-14;
  const rep = (v: Vec3): Vec3 => [
    A[0]![0] * v[0] + A[1]![0] * v[1] + A[2]![0] * v[2],
    A[0]![1] * v[0] + A[1]![1] * v[1] + A[2]![1] * v[2],
    A[0]![2] * v[0] + A[1]![2] * v[1] + A[2]![2] * v[2],
  ];
  const look = (v: Vec3): Vec3 => {
    const r = unit(rep(v));
    return moving ? aberrateRep(r, beta) : r;
  };
  return { A, look, rep };
}

/** a home-frame direction as the camera sees it (its look: rep components, aberrated) */
export const lookOf = (s: Settings, cam: CameraFrame, d: Vec3) => viewOf(s, cam).look(d);

/** The camera's yaw, pitch, roll looking at a home-frame direction — its up towards `up` (the zenith
 *  on a world: the horizon level), else kept */
export function aimAngles(s: Settings, cam: CameraFrame, d: Vec3, up?: Vec3) {
  const { look, rep } = viewOf(s, cam);
  const f = look(d);
  let u = up ? unit(rep(up)) : cam.up;
  u = lin(u, 1, f, -dot(u, f));
  if (Math.hypot(...u) < 1e-6) u = cam.up;
  // (the camera's axes are those of basis(yaw, pitch, roll) carried by a map that depends on its place
  // alone — the wormhole's side, the frame it is set in: read off the two frames now, orthonormal both)
  const b = basis(s.yaw, s.pitch, s.roll);
  const back = (v: Vec3): Vec3 => lin(lin(b.fwd, dot(cam.fwd, v), b.up, dot(cam.up, v)), 1, b.right, dot(cam.right, v));
  return yawPitchRoll(unit(back(f)), unit(back(unit(u))));
}
export interface SkyChartOptions {
  lines: boolean;
  names: boolean;
  stars: boolean;
  equatorial: boolean;
  horizontal: boolean;
  ecliptic: boolean;
  /** 0 … 1 */
  opacity: number;
  /** a constellation drawn brighter (hovered), or −1 */
  highlight: number;
}
export function chartOptions(s: Settings, highlight = -1): SkyChartOptions {
  return {
    lines: s.skyLines,
    names: s.skyNames,
    stars: s.starNames,
    equatorial: s.gridEquatorial,
    horizontal: s.gridHorizontal,
    ecliptic: s.skyEcliptic,
    opacity: s.skyChartOpacity,
    highlight,
  };
}
export const chartOn = (o: SkyChartOptions) => o.lines || o.names || o.stars || o.equatorial || o.horizontal || o.ecliptic;

export type LabelKind = "constellation" | "star" | "grid" | "cardinal" | "ecliptic";
export interface ChartLabel {
  text: string;
  x: number;
  y: number;
  kind: LabelKind;
  alpha: number;
  rgb?: string;
}
/** One frame of the chart: segments for the GPU (per segment: x0, y0, x1, y1 in the image's NDC, r, g, b, a
 *  in display sRGB, width in CSS pixels, 0), labels in NDC, and what the pointer can pick */
export interface ChartFrame {
  segs: Float32Array;
  count: number;
  labels: ChartLabel[];
  /** the named stars and constellations' names on the screen (NDC), for picking */
  picks: { kind: "star" | "constellation"; index: number; x: number; y: number }[];
  /** the figures' segments on the screen, for hovering a constellation */
  figures: { c: number; x0: number; y0: number; x1: number; y1: number }[];
  horizon: Horizon | null;
  /** from NDC back to a home-frame direction (unaberrated: to a few arc-minutes at a ship's speeds) */
  unproject: (x: number, y: number) => Vec3;
}

const STYLE = {
  figure: { rgb: [150, 190, 255], a: 0.5, w: 1.25 },
  figureHi: { rgb: [190, 220, 255], a: 0.95, w: 2.0 },
  equatorial: { rgb: [90, 200, 215], a: 0.3, w: 1.0 },
  equator: { rgb: [110, 220, 235], a: 0.6, w: 1.6 },
  horizontal: { rgb: [255, 176, 90], a: 0.3, w: 1.0 },
  horizon: { rgb: [255, 186, 100], a: 0.75, w: 2.0 },
  ecliptic: { rgb: [255, 214, 96], a: 0.55, w: 1.4 },
};
type Style = (typeof STYLE)[keyof typeof STYLE];

/** a step from the list near a target [°] */
const pick = (list: number[], target: number) =>
  list.reduce((b, x) => (Math.abs(Math.log(x / target)) < Math.abs(Math.log(b / target)) ? x : b), list[0]!);
const RA_STEPS = [90, 45, 30, 15, 7.5, 3.75, 2.5, 1.25, 0.5, 0.25];
const DEC_STEPS = [30, 20, 15, 10, 5, 2, 1, 0.5, 0.25];

const fmtRa = (deg: number) => {
  const m = Math.round((((deg % 360) + 360) % 360) * 4); // minutes of time
  const h = Math.floor(m / 60) % 24,
    mm = m % 60;
  return mm ? `${h}h${String(mm).padStart(2, "0")}m` : `${h}h`;
};
const fmtDeg = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(Math.round(d * 100) / 100)}°`;
const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * The chart as the camera sees it at scene time t, its image `aspect` wide per unit high (the lines'
 * widths in CSS pixels of the view: the overlay scales them to its output).
 */
export function buildChart(
  s: Settings,
  cam: CameraFrame,
  t: number,
  o: SkyChartOptions,
  aspect: number,
  cssHeight = 800,
): ChartFrame | null {
  if (!chartOn(o) || !onOurSide(s, cam)) return null;
  const tanH = Math.tan((s.fov * D) / 2);
  const { A, look } = viewOf(s, cam);
  const project = (v: Vec3) => projectLook(cam, look(v), tanH, aspect);
  // (back: the inverse of A applied to the camera's look — its columns' dual basis)
  const Ai = (() => {
    const [a, b, c] = A as [Vec3, Vec3, Vec3];
    const bc = cross(b, c),
      ca = cross(c, a),
      ab = cross(a, b);
    const det = dot(a, bc);
    return [bc, ca, ab].map((r) => [r[0] / det, r[1] / det, r[2] / det] as Vec3);
  })();
  const unproject = (x: number, y: number): Vec3 => {
    const l = unit(lin(lin(cam.fwd, 1, cam.right, x * tanH * aspect), 1, cam.up, y * tanH));
    return unit([dot(Ai[0]!, l), dot(Ai[1]!, l), dot(Ai[2]!, l)]);
  };
  // the view: its centre and angular radius (a little over the corners)
  const centre = unproject(0, 0);
  const radius = Math.atan(tanH * Math.hypot(1, aspect)) + 2 * D;
  const fovV = s.fov;
  const hz = horizonAt(s, cam, t);

  const out: number[] = [];
  let count = 0;
  const emit = (p: [number, number], q: [number, number], st: Style, alpha = 1) => {
    // (off the image, a margin kept: long segments cross it)
    if ((p[0] < -1.3 && q[0] < -1.3) || (p[0] > 1.3 && q[0] > 1.3) || (p[1] < -1.3 && q[1] < -1.3) || (p[1] > 1.3 && q[1] > 1.3)) return;
    out.push(p[0], p[1], q[0], q[1], st.rgb[0]! / 255, st.rgb[1]! / 255, st.rgb[2]! / 255, st.a * o.opacity * alpha, st.w, 0);
    count++;
  };
  const step = Math.min(1, Math.max(0.01, fovV / 90)) * D;
  /** a curve f(u), u in [u0, u1] (radians along it), drawn where it crosses the view; its visible points */
  const curve = (f: (u: number) => Vec3, u0: number, u1: number, st: Style, alpha = 1) => {
    const pts: [number, number][] = [];
    const coarse = Math.max(step, 1 * D);
    const n = Math.max(1, Math.ceil((u1 - u0) / coarse));
    const cr = Math.cos(radius + coarse);
    for (let i = 0; i < n; i++) {
      const a = u0 + ((u1 - u0) * i) / n,
        b = u0 + ((u1 - u0) * (i + 1)) / n;
      if (dot(f(a), centre) < cr && dot(f(b), centre) < cr && dot(f((a + b) / 2), centre) < cr) continue;
      const m = Math.max(1, Math.ceil((b - a) / step));
      let prev: [number, number] | null = project(f(a));
      for (let j = 1; j <= m; j++) {
        const q = project(f(a + ((b - a) * j) / m));
        if (prev && q) {
          emit(prev, q, st, alpha);
          if (Math.abs(q[0]) < 1 && Math.abs(q[1]) < 1) pts.push(q);
        }
        prev = q;
      }
    }
    return pts;
  };
  /** a grid's frame: its pole z and its origin x (y = z × x) */
  const grid = (
    x: Vec3,
    z: Vec3,
    minor: Style,
    major: Style,
    lonLabel: (deg: number) => string,
    latLabel: (deg: number) => string,
    labels: ChartLabel[],
    kindAlpha: number,
    azimuthal: boolean,
  ) => {
    const rgb = minor.rgb.join(", ");
    const y = cross(z, x);
    const at = (lon: number, lat: number): Vec3 =>
      lin(lin(x, Math.cos(lat) * Math.cos(lon), y, Math.cos(lat) * Math.sin(lon)), 1, z, Math.sin(lat));
    // (the view's centre in the grid: which meridians and parallels cross it)
    const cz = dot(centre, z);
    const clat = Math.asin(Math.max(-1, Math.min(1, cz)));
    const clon = Math.atan2(dot(centre, y), dot(centre, x));
    const latStep = pick(DEC_STEPS, fovV / 4) * D;
    const lonStep = pick(RA_STEPS, fovV / 4 / Math.max(Math.cos(clat), 0.25)) * D;
    const lat0 = Math.max(-Math.PI / 2, clat - radius),
      lat1 = Math.min(Math.PI / 2, clat + radius);
    const poleIn = lat1 >= Math.PI / 2 - 1e-9 || lat0 <= -Math.PI / 2 + 1e-9;
    const dLon = poleIn ? Math.PI : Math.min(Math.PI, Math.asin(Math.min(1, Math.sin(radius) / Math.max(Math.cos(clat), 1e-6))) + lonStep);
    // parallels
    for (let k = Math.ceil(lat0 / latStep); k * latStep <= lat1; k++) {
      const lat = k * latStep;
      if (Math.abs(lat) > Math.PI / 2 - 1e-6) continue;
      const major0 = Math.abs(lat) < 1e-9;
      const pts = curve((u) => at(u, lat), clon - dLon, clon + dLon, major0 ? major : minor);
      const left = pts.reduce<[number, number] | null>((b, p) => (!b || p[0] < b[0] ? p : b), null);
      if (left && !major0) labels.push({ text: latLabel(lat / D), x: left[0], y: left[1], kind: "grid", alpha: kindAlpha, rgb });
    }
    // meridians (not through the pole's last degrees when fine: they crowd)
    const poleCut = lonStep < 5 * D ? 80 * D : 90 * D;
    for (let k = Math.ceil((clon - dLon) / lonStep); k * lonStep <= clon + dLon; k++) {
      const lon = k * lonStep;
      const main = Math.round((((lon / D) % 360) + 360) % 360) % 90 === 0 && lonStep < 90 * D;
      const pts = curve((u) => at(lon, u), Math.max(lat0, -poleCut), Math.min(lat1, poleCut), minor, main ? 1.4 : 1);
      const low = pts.reduce<[number, number] | null>((b, p) => (!b || p[1] < b[1] ? p : b), null);
      if (low)
        labels.push({
          text: lonLabel(azimuthal ? (((-lon / D) % 360) + 360) % 360 : lon / D),
          x: low[0],
          y: low[1],
          kind: "grid",
          alpha: kindAlpha,
          rgb,
        });
    }
    return at;
  };

  const labels: ChartLabel[] = [];
  const et = tdbOf(utcOf(t));
  if (o.equatorial) {
    const E = equatorOfDate(et);
    grid(E[0], E[2], STYLE.equatorial, STYLE.equator, fmtRa, fmtDeg, labels, 0.8 * o.opacity, false);
  }
  if (o.horizontal && hz) {
    const at = grid(
      hz.north,
      hz.zenith,
      STYLE.horizontal,
      STYLE.horizon,
      (a) => `${Math.round(a * 100) / 100}°`,
      (a) => fmtDeg(a),
      labels,
      0.8 * o.opacity,
      true,
    );
    // (azimuth from the north through the east: the grid's longitude runs the other way)
    CARDINALS.forEach((c, i) => {
      const p = project(at(-i * 45 * D, 0));
      if (p && Math.abs(p[0]) < 1.05 && Math.abs(p[1]) < 1.05)
        labels.push({ text: c, x: p[0], y: p[1], kind: "cardinal", alpha: o.opacity * (c.length === 1 ? 1 : 0.7) });
    });
  }
  if (o.ecliptic) {
    const x: Vec3 = [1, 0, 0],
      y: Vec3 = [0, 1, 0];
    const pts = curve((u) => lin(x, Math.cos(u), y, Math.sin(u)), 0, 2 * Math.PI, STYLE.ecliptic);
    const right = pts.reduce<[number, number] | null>((b, p) => (!b || p[0] > b[0] ? p : b), null);
    if (right) labels.push({ text: "Ecliptic", x: right[0], y: right[1], kind: "ecliptic", alpha: o.opacity });
  }
  const figures: ChartFrame["figures"] = [];
  if (o.lines) {
    for (const sg of SEGMENTS) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(sg.a, sg.b))));
      const hi = sg.c === o.highlight;
      // (the line stops short of its stars — 5 CSS pixels —, leaving them their own light)
      const gap = Math.min(0.3 * ang, (5 * fovV * D) / Math.max(cssHeight, 1));
      const pts = curve((u) => unit(lin(sg.a, Math.sin(ang - u), sg.b, Math.sin(u))), gap, ang - gap, hi ? STYLE.figureHi : STYLE.figure);
      const pa = project(sg.a),
        pb = project(sg.b);
      if (pa && pb && pts.length) figures.push({ c: sg.c, x0: pa[0], y0: pa[1], x1: pb[0], y1: pb[1] });
    }
  }
  const picks: ChartFrame["picks"] = [];
  // (words: not behind the world under the camera — and, standing on it, not below its horizon: the
  // lines are cut by the ground itself, the words would float over the hills)
  const onGround = !!hz && Math.hypot(hz.X[0] - hz.C[0], hz.X[1] - hz.C[1], hz.X[2] - hz.C[2]) < hz.R * 1.005;
  const visible = (v: Vec3) => !behindBody(hz, v) && !(onGround && dot(v, hz!.zenith) < Math.sin(0.5 * D));
  if (o.names) {
    CONSTELLATIONS.forEach((c, i) => {
      if (dot(c.label, centre) < Math.cos(radius)) return;
      const p = project(c.label);
      if (!p || Math.abs(p[0]) > 1 || Math.abs(p[1]) > 1 || !visible(c.label)) return;
      labels.push({ text: c.name, x: p[0], y: p[1], kind: "constellation", alpha: o.opacity * (i === o.highlight ? 1 : 0.8) });
      picks.push({ kind: "constellation", index: i, x: p[0], y: p[1] });
    });
  }
  // (the named stars: the brighter as the view widens — at 60° the twenty brightest, zoomed in all)
  const magMax = 1.6 + Math.max(0, Math.log2(60 / Math.max(fovV, 0.1))) * 1.3;
  NAMED_STARS.forEach((st, i) => {
    if (dot(st.v, centre) < Math.cos(radius)) return;
    const p = project(st.v);
    if (!p || Math.abs(p[0]) > 1 || Math.abs(p[1]) > 1 || !visible(st.v)) return;
    picks.push({ kind: "star", index: i, x: p[0], y: p[1] });
    if (o.stars && st.mag <= magMax)
      labels.push({ text: st.name, x: p[0], y: p[1], kind: "star", alpha: o.opacity * Math.min(1, 0.55 + (magMax - st.mag) * 0.2) });
  });
  return { segs: new Float32Array(out), count, labels, picks, figures, horizon: hz, unproject };
}

/** What lies under the pointer (NDC): a named star, else the constellation of the nearest figure line
 *  within `tol` (NDC, vertical), and the sky's coordinates there */
export function pickChart(f: ChartFrame, x: number, y: number, tol: number, aspect: number, t: number) {
  const d2 = (px: number, py: number) => ((px - x) * aspect) ** 2 + (py - y) ** 2;
  let star = -1,
    sd = tol * tol;
  for (const p of f.picks) if (p.kind === "star" && d2(p.x, p.y) < sd) (sd = d2(p.x, p.y)), (star = p.index);
  let constellation = -1,
    cd = (tol * 1.2) ** 2;
  for (const s of f.figures) {
    const ax = (s.x1 - s.x0) * aspect,
      ay = s.y1 - s.y0;
    const l2 = ax * ax + ay * ay;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.x0) * aspect * ax + (y - s.y0) * ay) / l2)) : 0;
    const dd = ((s.x0 + (s.x1 - s.x0) * u - x) * aspect) ** 2 + (s.y0 + ay * u - y) ** 2;
    if (dd < cd) (cd = dd), (constellation = s.c);
  }
  const v = f.unproject(x, y);
  if (star >= 0) constellation = NAMED_STARS[star]!.constellation;
  const et = tdbOf(utcOf(t));
  return {
    star: star >= 0 ? NAMED_STARS[star]! : null,
    constellation: constellation >= 0 ? CONSTELLATIONS[constellation]! : null,
    constellationIndex: constellation,
    radec: raDecOf(star >= 0 ? NAMED_STARS[star]!.v : v),
    radecDate: raDecOf(star >= 0 ? NAMED_STARS[star]!.v : v, equatorOfDate(et)),
    altaz: f.horizon ? altAzOf(f.horizon, star >= 0 ? NAMED_STARS[star]!.v : v) : null,
  };
}
