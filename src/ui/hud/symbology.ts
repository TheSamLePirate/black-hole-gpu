// The flight HUD's conformal symbology, drawn over the view (canvas.fl-hud, each frame): what is in the
// world drawn where it is seen — the horizon and the pitch ladder about the local vertical, the heading
// tape (the world's north), the bank scale, the orbital markers the view lacked (radial, normal),
// and for what leaves the screen an arrow at its edge, pointing to it.
//
// Directions come in camera coordinates (x right, y up, z forward — FlightHud's Info.dirs, the ship's
// axes Info.S): at infinity, so right from any mount. In the views from outside the ship only the
// markers and their arrows are drawn (the instruments belong to the pilot's seat and the chase).

import type { Settings } from "../../settings";
import type { FutureView, RunwayView } from "../../controls";
import { COL, FONT, MONO, marker } from "../hudkit";

type V3 = [number, number, number];

/** What the symbology needs from the flight (a slice of FlightHud's Info). */
export interface SymInfo {
  S: number[][];
  /** where the ship is (the hole's region: its lensed tube may draw the path instead) */
  region?: string;
  /** near the ground: height over it [m], vertical and horizontal speeds [m/s], thrust over weight, the
   *  local gravity [g], landed */
  surface?: { alt: number; vVert: number; vHor: number; twr: number; gLocal: number; landed?: boolean } | null;
  dirs: Record<string, V3 | null | undefined>;
  air?: {
    u?: number[] | null;
    q: number;
    inAir?: boolean;
    /** the angle of attack, the sideslip [rad]; the wing's stall and best lift-to-drag incidences */
    alpha?: number;
    beta?: number;
    stalled?: boolean;
    stallA?: number | null;
    bestA?: number | null;
    /** the speed through the air [m/s], the load and its limit [g] */
    speed?: number;
    g?: number;
    gMax?: number;
    /** how the craft flies in the air: rocket, plane, the sci-fi computer */
    mode?: string;
    /** the flight computer's command: speed [m/s], flight path angle, heading [rad] */
    sf?: { speed: number; gamma: number; heading: number } | null;
  } | null;
}

export interface SymFrame {
  ctx: CanvasRenderingContext2D;
  /** the canvas [device px], its pixel ratio */
  W: number;
  H: number;
  dpr: number;
  /** the vertical field of view [°] */
  fov: number;
  s: Settings;
  i: SymInfo;
  /** a view from outside the ship (around, free, fly-by, the port's camera): markers only */
  outside: boolean;
  /** the HUD's density (0 full, 1 minimal, 2 clean) */
  density: number;
  /** where the heading tape may sit: below this [device px] */
  top: number;
  /** the future as the eye sees it: the predicted path, the places to come, the impact */
  future?: FutureView | null;
  /** the quarter of the orbit asked among the places to come [s] (labelled so) */
  quarter?: number;
  /** the runway in reach (its outline, centreline, aim point; the craft's place along and across it) */
  runway?: RunwayView | null;
}

const UNDER = "rgba(0, 0, 0, 0.42)";
const LADDER = "124, 214, 255";
const D = Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const comb = (a: V3, ka: number, b: V3, kb: number): V3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
/** (camera coordinates are left-handed: a cross product there turns the other way — this is the
 *  right-handed world's a × b) */
const crossW = (a: V3, b: V3): V3 => [-(a[1] * b[2] - a[2] * b[1]), -(a[2] * b[0] - a[0] * b[2]), -(a[0] * b[1] - a[1] * b[0])];
const wrap360 = (a: number) => ((a % 360) + 360) % 360;

export function drawSymbology(F: SymFrame) {
  const { ctx, W, H, dpr, s, i } = F;
  const tanH = Math.tan((F.fov * D) / 2);
  const asp = W / H;
  const fpx = H / (2 * tanH);
  /** a direction on the screen [px] (unclipped), or null behind the eye */
  const pr = (d: V3 | null | undefined): [number, number] | null => {
    if (!d || d[2] <= 1e-3) return null;
    return [W / 2 + (d[0] / d[2]) * fpx, H / 2 - (d[1] / d[2]) * fpx];
  };
  const inside = (p: [number, number] | null, m = 0) => !!p && p[0] >= m && p[0] <= W - m && p[1] >= m && p[1] <= H - m;
  const stroke = (draw: () => void, col: string, lw: number, dash?: number[]) => {
    ctx.setLineDash(dash ? dash.map((x) => x * dpr) : []);
    for (const [w, c] of [[lw + 2.4, UNDER], [lw, col]] as const) {
      ctx.lineWidth = w * dpr;
      ctx.strokeStyle = c;
      ctx.beginPath();
      draw();
      ctx.stroke();
    }
    ctx.setLineDash([]);
  };
  const text = (t: string, x: number, y: number, col: string, size: number, align: CanvasTextAlign = "center", mono = false) => {
    ctx.font = `${mono ? 600 : 700} ${size * dpr}px ${mono ? MONO : FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = UNDER;
    ctx.strokeText(t, x, y);
    ctx.fillStyle = col;
    ctx.fillText(t, x, y);
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const up = i.dirs.up ?? null;
  const north = i.dirs.north ?? null;
  const pilotView = !F.outside && F.density < 2;
  const S = i.S;
  const nose: V3 = [S[0]![2]!, S[1]![2]!, S[2]![2]!];

  // ---- the horizon and the pitch ladder (about the local vertical)
  if (up && pilotView && s.hudHorizon) {
    // (the rungs centred on the view's own bearing — the ladder where the eye looks)
    let h0 = comb([0, 0, 1], 1, up, -up[2]);
    if (Math.hypot(...h0) < 0.05) h0 = comb(nose, 1, up, -dot(nose, up));
    if (Math.hypot(...h0) > 1e-6) {
      h0 = norm(h0);
      const side = norm(crossW(up, h0));
      const at = (e: number, a: number): V3 => comb(comb(h0, Math.cos(a), side, Math.sin(a)), Math.cos(e), up, Math.sin(e));
      // the view's elevation: the rungs within the screen and a little beyond
      const eView = Math.asin(Math.max(-1, Math.min(1, up[2])));
      const span = Math.atan(tanH) * 1.25;
      // the horizon: long, across the screen
      const hz: [number, number][] = [];
      const aw = Math.atan(tanH * asp) * 1.4;
      for (let k = -24; k <= 24; k++) {
        const p = pr(at(0, (k / 24) * aw));
        if (p) hz.push(p);
      }
      if (hz.length > 1) stroke(() => hz.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))), `rgba(${LADDER}, 0.8)`, 1.6);
      // the rungs every 5° (labelled every 10°): solid above, dashed below, their ends' ticks to the horizon
      const half = 95 * dpr, gap = 34 * dpr;
      // (the rungs within the HUD's field — a circle about the view's centre —, fading towards its rim)
      const field = Math.min(H, W) * 0.3;
      for (let deg = -85; deg <= 85; deg += 5) {
        if (deg === 0) continue;
        const e = deg * D;
        if (Math.abs(e - eView) > span) continue;
        const c0 = pr(at(e, 0));
        if (!c0) continue;
        const off = Math.hypot(c0[0] - W / 2, c0[1] - H / 2);
        if (off > field) continue;
        const fade = Math.min(1, (field - off) / (field * 0.3));
        const ce = Math.max(Math.cos(e), 0.08);
        const w = (deg % 10 === 0 ? half : half * 0.6) / fpx / ce, g = gap / fpx / ce;
        const col = `rgba(${LADDER}, ${((deg % 10 === 0 ? 0.85 : 0.55) * fade).toFixed(3)})`;
        const dash = deg < 0 ? [7, 5] : undefined;
        for (const sg of [-1, 1]) {
          const pts: [number, number][] = [];
          for (let k = 0; k <= 6; k++) {
            const p = pr(at(e, sg * (g + ((w - g) * k) / 6)));
            if (p) pts.push(p);
          }
          // (the end's tick towards the horizon)
          const tip = pr(at(e - (Math.sign(deg) * 8 * dpr) / fpx, sg * w));
          if (pts.length < 2) continue;
          stroke(() => {
            pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
            if (tip) ctx.lineTo(tip[0], tip[1]);
          }, col, 1.4, dash);
          if (deg % 10 === 0) {
            const end = pts[pts.length - 1]!;
            text(`${deg}`, end[0] + sg * 18 * dpr, end[1], col, 11.5, "center", true);
          }
        }
      }
      // the zenith and the nadir
      for (const [d, lab] of [[up, "ZEN"], [comb(up, -1, up, 0), "NAD"]] as const) {
        const p = pr(d as V3);
        if (!inside(p, 10 * dpr)) continue;
        stroke(() => {
          ctx.arc(p![0], p![1], 9 * dpr, 0, 2 * Math.PI);
        }, `rgba(${LADDER}, 0.7)`, 1.3);
        text(lab, p![0], p![1] + 20 * dpr, `rgba(${LADDER}, 0.7)`, 10);
      }
    }
  }

  // ---- the heading tape (the world's north), at the top
  if (up && north && pilotView && s.hudHeading) {
    const east = norm(crossW(north, up));
    const bearing = (d: V3 | null | undefined) => {
      if (!d) return null;
      const h = comb(d, 1, up, -dot(d, up));
      if (Math.hypot(...h) < 1e-4) return null;
      return wrap360(Math.atan2(dot(h, east), dot(h, north)) / D);
    };
    const view = bearing([0, 0, 1]) ?? bearing(nose);
    if (view !== null) {
      // (the scale's baseline; its figures above, the carets on it, the view's heading boxed under it)
      const cx = W / 2, y = F.top + 46 * dpr, wd = Math.min(420 * dpr, W * 0.36), degPx = wd / 70;
      // the scale: ticks every 5°, figures every 10°, the cardinal points named
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - wd / 2, y - 24 * dpr, wd, 34 * dpr);
      ctx.clip();
      for (let a = Math.floor((view - 40) / 5) * 5; a <= view + 40; a += 5) {
        const x = cx + (a - view) * degPx;
        const big = a % 10 === 0;
        stroke(() => {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y - (big ? 8 : 4) * dpr);
        }, `rgba(${LADDER}, ${big ? 0.85 : 0.5})`, 1.2);
        if (big) {
          const v = wrap360(a);
          const card = { 0: "N", 90: "E", 180: "S", 270: "W" }[v];
          text(card ?? String(v / 10).padStart(2, "0"), x, y - 16 * dpr, card ? "rgba(255, 200, 90, 0.95)" : `rgba(${LADDER}, 0.85)`, card ? 13 : 11.5, "center", !card);
        }
      }
      // the carets: the nose's heading, the track (where the craft goes), the target's bearing
      const caret = (b: number | null, col: string, down: boolean) => {
        if (b === null) return;
        let dx = b - view;
        dx = ((dx + 540) % 360) - 180;
        const x = cx + Math.max(-wd / 2 + 6 * dpr, Math.min(wd / 2 - 6 * dpr, dx * degPx));
        const yy = y + (down ? 1 : 1) * dpr;
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x - 5 * dpr, yy + 8 * dpr);
        ctx.lineTo(x + 5 * dpr, yy + 8 * dpr);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.strokeStyle = UNDER;
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        ctx.fill();
      };
      ctx.restore();
      const A = i.air;
      const track = A && A.u && A.q > 20 ? bearing([S[0]![0]! * A.u[0]! + S[0]![1]! * A.u[1]! + S[0]![2]! * A.u[2]!, S[1]![0]! * A.u[0]! + S[1]![1]! * A.u[1]! + S[1]![2]! * A.u[2]!, S[2]![0]! * A.u[0]! + S[2]![1]! * A.u[1]! + S[2]![2]! * A.u[2]!]) : bearing(i.dirs.prograde);
      caret(bearing(i.dirs.target), COL.target!, true);
      caret(track, "#78ffaa", true);
      caret(bearing(nose), "#ffc85a", true);
      // the view's heading, boxed
      const box = `${String(Math.round(view) % 360).padStart(3, "0")}°`;
      ctx.fillStyle = "rgba(4, 10, 18, 0.72)";
      ctx.strokeStyle = `rgba(${LADDER}, 0.85)`;
      ctx.lineWidth = 1.2 * dpr;
      const bw = 52 * dpr, bh = 20 * dpr;
      ctx.fillRect(cx - bw / 2, y + 12 * dpr, bw, bh);
      ctx.strokeRect(cx - bw / 2, y + 12 * dpr, bw, bh);
      text(box, cx, y + 22 * dpr, "#ffffff", 12.5, "center", true);
    }
  }

  // ---- the bank scale: fixed to the craft, its pointer to the sky's up
  if (up && pilotView && s.hudBank) {
    const X: V3 = [S[0]![0]!, S[1]![0]!, S[2]![0]!], Y: V3 = [S[0]![1]!, S[1]![1]!, S[2]![1]!];
    // (> 0 banked right: the left wing — the ship's +x — high)
    const bank = Math.atan2(dot(X, up), dot(Y, up));
    const cx = W / 2, cy = H / 2, R = Math.min(H, W) * 0.34;
    const col = `rgba(${LADDER}, 0.8)`;
    stroke(() => ctx.arc(cx, cy, R, -Math.PI / 2 - 60 * D, -Math.PI / 2 + 60 * D), `rgba(${LADDER}, 0.45)`, 1.2);
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const t = -Math.PI / 2 + a * D, l = a % 30 === 0 ? 12 : 7;
      stroke(() => {
        ctx.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R);
        ctx.lineTo(cx + Math.cos(t) * (R + l * dpr), cy + Math.sin(t) * (R + l * dpr));
      }, col, a === 0 ? 2 : 1.2);
    }
    const b = Math.max(-62 * D, Math.min(62 * D, -bank));
    const t = -Math.PI / 2 + b;
    const px = cx + Math.cos(t) * (R - 3 * dpr), py = cy + Math.sin(t) * (R - 3 * dpr);
    const nx = Math.cos(t), ny = Math.sin(t);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - nx * 11 * dpr - ny * 6 * dpr, py - ny * 11 * dpr + nx * 6 * dpr);
    ctx.lineTo(px - nx * 11 * dpr + ny * 6 * dpr, py - ny * 11 * dpr - nx * 6 * dpr);
    ctx.closePath();
    ctx.fillStyle = Math.abs(bank) > 60 * D ? "#ff5a46" : "#ffc85a";
    ctx.strokeStyle = UNDER;
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    ctx.fill();
    if (Math.abs(bank) > 1.5 * D) text(`${Math.abs(Math.round(bank / D))}° ${bank > 0 ? "R" : "L"}`, px - nx * 24 * dpr, py - ny * 24 * dpr, "#ffc85a", 11, "center", true);
  }

  // ---- the future: the path in perspective, the places to come, the impact
  if (F.future && F.density < 2) drawFuture(F, F.future, pr, stroke, text, inside);

  // ---- approach and landing: the runway, the vertical landing's scope and cues
  if (F.runway && s.hudRunway && !F.outside && F.density < 2) drawRunway(F, F.runway, pr, stroke, text, inside);
  if (i.surface && !i.surface.landed && s.hudHover && !F.outside && F.density < 2) drawHover(F, i.surface, up, pr, stroke, text, inside);

  // ---- in the air: the angle of attack, the energy, the sideslip, the load, the flight director
  const A = i.air;
  if (A && A.u && A.q > 20 && pilotView) drawAir(F, A, pr, stroke, text, up, north, fpx);

  // ---- the orbital markers the view lacked: radial, normal
  if (s.hudMarkers) {
    const r = 11 * dpr;
    // (the target: the lock's ring, name, distance and edge arrow already — targethud.ts)
    for (const k of ["radialOut", "radialIn", "normal", "antinormal"] as const) {
      const p = pr(i.dirs[k]);
      if (!inside(p)) continue;
      ctx.lineWidth = 4.5 * dpr;
      marker(ctx, glyph(k), p![0], p![1], r, UNDER);
      ctx.lineWidth = 2 * dpr;
      marker(ctx, glyph(k), p![0], p![1], r, COL[k]!);
    }
  }

  // ---- what leaves the screen: an arrow at its edge, its glyph beside it
  if (s.hudEdge) {
    const m = 46 * dpr;
    for (const k of ["prograde", "maneuver", "burn", "dock"] as const) {
      if (k === "maneuver" && i.dirs.burn) continue;
      const d = i.dirs[k];
      if (!d) continue;
      const p = pr(d);
      if (inside(p, m * 0.4)) continue;
      // (its direction on the screen: from the centre towards it — behind the eye, the other way round)
      let dx = d[0], dy = -d[1];
      if (d[2] <= 1e-3 && Math.hypot(dx, dy) < 1e-6) dx = 1;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const [x, y] = edgeAt(W, H, dpr, dx, dy);
      const col = COL[k] ?? "#ffffff";
      ctx.beginPath();
      ctx.moveTo(x + dx * 16 * dpr, y + dy * 16 * dpr);
      ctx.lineTo(x - dy * 8 * dpr, y + dx * 8 * dpr);
      ctx.lineTo(x + dy * 8 * dpr, y - dx * 8 * dpr);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.strokeStyle = UNDER;
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      ctx.fill();
      ctx.lineWidth = 3.5 * dpr;
      marker(ctx, glyph(k), x - dx * 18 * dpr, y - dy * 18 * dpr, 7 * dpr, UNDER);
      ctx.lineWidth = 1.6 * dpr;
      marker(ctx, glyph(k), x - dx * 18 * dpr, y - dy * 18 * dpr, 7 * dpr, col);
    }
  }
}

const glyph = (k: string) => ({ radialOut: "prograde", radialIn: "retrograde", normal: "prograde", antinormal: "retrograde", target: "target", maneuver: "burn", burn: "burn", dock: "dock", prograde: "prograde" })[k] ?? "prograde";


type Proj = (d: V3 | null | undefined) => [number, number] | null;
type Stroke = (draw: () => void, col: string, lw: number, dash?: number[]) => void;
type Text = (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void;

/** The speed's rate, eased (the energy chevron): the last sample. */
const energy = { t: 0, v: NaN, a: 0 };

/**
 * In the air, about the flight path vector (where the craft goes through the air):
 * - the angle of attack drawn where it is — the nose stands above the flight path by α, so the cues lie
 *   along that arc, in the craft's plane of symmetry: a green bracket on the best lift-to-drag incidence
 *   (±1.5°), an amber tick at 85 % of the stall, a red bar at the stall; the nose symbol between them
 *   reads the margin at a glance, α in figures beside it;
 * - the energy chevron: the speed's rate as the flight path it would hold — above the wings: the craft
 *   gains speed, below: it loses it (γ = atan(dV/dt / g));
 * - the sideslip: a ball under the flight path, off centre by β;
 * - the load in g, coloured against the craft's limit; STALL flashing;
 * - the flight director: where the flight computer wants the flight path (its climb angle, its heading).
 */
function drawAir(F: SymFrame, A: NonNullable<SymInfo["air"]>, pr: Proj, stroke: Stroke, text: Text, up: V3 | null, north: V3 | null, fpx: number) {
  const { ctx, dpr, s, i } = F;
  const S = i.S;
  const u = A.u!;
  const v = norm([S[0]![0]! * u[0]! + S[0]![1]! * u[1]! + S[0]![2]! * u[2]!, S[1]![0]! * u[0]! + S[1]![1]! * u[1]! + S[1]![2]! * u[2]!, S[2]![0]! * u[0]! + S[2]![1]! * u[1]! + S[2]![2]! * u[2]!]);
  const fp = pr(v);
  if (!fp) return;
  const r = 11 * dpr;
  // the craft's up and left about the flight path (the plane of symmetry: α measured in it)
  const Y: V3 = [S[0]![1]!, S[1]![1]!, S[2]![1]!], X: V3 = [S[0]![0]!, S[1]![0]!, S[2]![0]!];
  let p = comb(Y, 1, v, -dot(Y, v));
  if (Math.hypot(...p) < 1e-6) return;
  p = norm(p);
  const l = norm(comb(comb(X, 1, v, -dot(X, v)), 1, p, -dot(X, p)));
  const along = (a: number, side = 0): V3 => comb(comb(v, Math.cos(a), p, Math.sin(a)), 1, l, side);
  const alpha = A.alpha ?? 0;
  const stall = A.stallA ?? null;
  const best = A.bestA ?? null;

  // ---- the angle of attack
  if (s.hudAoA && stall) {
    const w = (16 * dpr) / fpx;
    const seg = (a: number, w0: number, w1: number) => [pr(along(a, w0 * w)), pr(along(a, w1 * w))] as const;
    // the best lift-to-drag band: a bracket on the left
    if (best) {
      const lo = best - 1.5 * (Math.PI / 180), hi = best + 1.5 * (Math.PI / 180);
      const pts = [pr(along(hi, 1.2 * w)), pr(along(hi, 2 * w)), pr(along(lo, 2 * w)), pr(along(lo, 1.2 * w))];
      if (pts.every(Boolean)) stroke(() => pts.forEach((q, j) => (j ? ctx.lineTo(q![0], q![1]) : ctx.moveTo(q![0], q![1]))), "rgba(120, 255, 170, 0.9)", 1.6);
    }
    // 85 % of the stall (amber), the stall (red)
    for (const [a, col, w0, w1] of [[stall * 0.85, "rgba(255, 200, 90, 0.9)", -1.4, 1.4], [stall, "rgba(255, 90, 70, 0.95)", -2.4, 2.4]] as const) {
      const [a0, a1] = seg(a, w0, w1);
      if (a0 && a1) stroke(() => {
        ctx.moveTo(a0[0], a0[1]);
        ctx.lineTo(a1[0], a1[1]);
      }, col, a === stall ? 2.2 : 1.4);
    }
    // the incidence, in figures by the bracket
    const k = alpha / stall;
    const col = k >= 0.85 ? (k >= 1 ? "#ff5a46" : "#ffc85a") : best && Math.abs(alpha - best) < 1.5 * (Math.PI / 180) ? "#78ffaa" : "rgba(214, 236, 255, 0.95)";
    const at = pr(along(Math.max(Math.min(alpha, stall * 1.2), -0.2), 2.6 * w));
    if (at) text(`α ${((alpha * 180) / Math.PI).toFixed(1)}°`, at[0], at[1], col, 12, "right", true);
  }

  // ---- the energy chevron: the speed's rate as a flight path angle
  if (s.hudEnergy && up && Number.isFinite(A.speed)) {
    const now = performance.now() / 1000;
    if (Number.isFinite(energy.v) && now > energy.t) {
      const dt = Math.min(now - energy.t, 0.5);
      const a = (A.speed! - energy.v) / Math.max(dt, 1e-3);
      if (dt > 0) energy.a += (a - energy.a) * Math.min(1, dt / 0.6);
    }
    energy.t = now;
    energy.v = A.speed!;
    let vu = comb(up, 1, v, -dot(up, v));
    if (Math.hypot(...vu) > 1e-6) {
      vu = norm(vu);
      const gam = Math.atan(energy.a / 9.80665);
      const q = pr(comb(v, Math.cos(gam), vu, Math.sin(gam)));
      if (q) {
        const x = fp[0] - 2.3 * r, y = q[1];
        const col = Math.abs(energy.a) < 0.3 ? "rgba(214, 236, 255, 0.85)" : energy.a > 0 ? "rgba(120, 255, 170, 0.95)" : "rgba(255, 200, 90, 0.95)";
        stroke(() => {
          ctx.moveTo(x - 7 * dpr, y - 6 * dpr);
          ctx.lineTo(x, y);
          ctx.lineTo(x - 7 * dpr, y + 6 * dpr);
        }, col, 2);
      }
    }
  }

  // ---- the sideslip: a ball under the flight path
  if (s.hudAoA && Number.isFinite(A.beta)) {
    const y = fp[1] + 2.4 * r, half = 22 * dpr;
    const b = Math.max(-1, Math.min(1, (A.beta! * 180) / Math.PI / 8));
    stroke(() => {
      ctx.moveTo(fp[0] - half, y);
      ctx.lineTo(fp[0] + half, y);
      ctx.moveTo(fp[0] - 5 * dpr, y - 4 * dpr);
      ctx.lineTo(fp[0] - 5 * dpr, y + 4 * dpr);
      ctx.moveTo(fp[0] + 5 * dpr, y - 4 * dpr);
      ctx.lineTo(fp[0] + 5 * dpr, y + 4 * dpr);
    }, "rgba(214, 236, 255, 0.55)", 1.2);
    ctx.beginPath();
    ctx.arc(fp[0] + b * half, y, 3.6 * dpr, 0, 2 * Math.PI);
    ctx.fillStyle = Math.abs(b) > 0.5 ? "#ffc85a" : "rgba(214, 236, 255, 0.95)";
    ctx.fill();
  }

  // ---- the load, STALL
  if (s.hudEnergy && Number.isFinite(A.g)) {
    const g = A.g!, k = g / (A.gMax || 9);
    if (Math.abs(g - 1) > 0.25 || k > 0.6) text(`${g.toFixed(1)} g`, fp[0] + 2.6 * r, fp[1] + 2.4 * r, k > 0.9 ? "#ff5a46" : k > 0.7 ? "#ffc85a" : "rgba(214, 236, 255, 0.9)", 12, "left", true);
  }
  const k = A.stallA ? alpha / A.stallA : 0;
  if (A.stalled || k > 0.92) {
    const on = A.stalled ? Math.floor(performance.now() / 300) % 2 === 0 : true;
    if (on) text(A.stalled ? "STALL" : "AOA", fp[0], fp[1] + 4 * r, A.stalled ? "#ff5a46" : "#ffc85a", 15);
  }

  // ---- the flight director: where the flight computer wants the flight path
  if (s.hudDirector && A.sf && up && north) {
    const east = norm(crossW(north, up));
    const { gamma, heading } = A.sf;
    const h = comb(north, Math.cos(heading), east, Math.sin(heading));
    const q = pr(comb(h, Math.cos(gamma), up, Math.sin(gamma)));
    if (q) {
      const col = "rgba(224, 123, 255, 0.95)";
      stroke(() => {
        ctx.arc(q[0], q[1], 7 * dpr, 0, 2 * Math.PI);
        ctx.moveTo(q[0] - 12 * dpr, q[1]);
        ctx.lineTo(q[0] - 7 * dpr, q[1]);
        ctx.moveTo(q[0] + 7 * dpr, q[1]);
        ctx.lineTo(q[0] + 12 * dpr, q[1]);
      }, col, 1.6);
      // (a dotted line to it from the flight path: the way to steer)
      if (Math.hypot(q[0] - fp[0], q[1] - fp[1]) > 3 * r) stroke(() => {
        ctx.moveTo(fp[0], fp[1]);
        ctx.lineTo(q[0], q[1]);
      }, "rgba(224, 123, 255, 0.45)", 1, [2, 4]);
    }
  }
}

/** A time ahead, short: 42 s, 3 min 20 s, 1 h 05 min. */
function ahead(t: number): string {
  if (!Number.isFinite(t)) return "—";
  if (t < 90) return `${Math.round(t)} s`;
  if (t < 3600) return `${Math.floor(t / 60)} min ${String(Math.round(t % 60)).padStart(2, "0")} s`;
  return `${Math.floor(t / 3600)} h ${String(Math.round((t % 3600) / 60)).padStart(2, "0")} min`;
}

/**
 * The future in the view:
 * - the predicted path in perspective (cyan), broken where its body hides it; on Gargantua's side the
 *   lensed tube (⇧Y) draws it instead when it is on;
 * - the ship's places to come — +10, +30, +60 s, a quarter of the orbit — as hollow rings, dated;
 * - where the path meets the ground (a red reticle on the spot as it turns now, its countdown) or the
 *   air's top (the entry, amber), or Gargantua's horizon; off screen, an arrow at the edge with the time.
 */
function drawFuture(F: SymFrame, fu: FutureView, pr: Proj, stroke: Stroke, text: Text, inside: (p: [number, number] | null, m?: number) => boolean) {
  const { ctx, W, H, dpr, s, i } = F;
  const tube = i.region === "hole" && s.pathInView;
  // (a wing carrying the craft: the free fall's path and its impact are not where it goes — the flight
  // path vector and the runway's cues are)
  const A = i.air;
  if (A && A.inAir && A.q > 1000 && A.mode === "plane") return;
  // ---- the path
  if (s.hudPath && !tube && fu.pts.length > 1) {
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    for (const q of fu.pts) {
      const p = q.hid ? null : pr(q.d);
      if (!p || Math.abs(p[0] - W / 2) > W * 3 || Math.abs(p[1] - H / 2) > H * 3) {
        if (run.length > 1) runs.push(run);
        run = [];
        continue;
      }
      run.push(p);
    }
    if (run.length > 1) runs.push(run);
    for (const r of runs) stroke(() => r.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))), "rgba(90, 220, 255, 0.7)", 1.8, [10, 6]);
  }
  // ---- the places to come
  if (s.hudFuture) {
    for (const m of fu.marks) {
      if (m.hid) continue;
      const p = pr(m.d);
      if (!inside(p, 8 * dpr)) continue;
      const big = m.t > 61;
      const quarter = F.quarter && Math.abs(m.t - F.quarter) < 1;
      stroke(() => {
        ctx.arc(p![0], p![1], 6.5 * dpr, 0, 2 * Math.PI);
        ctx.moveTo(p![0] - 11 * dpr, p![1]);
        ctx.lineTo(p![0] - 6.5 * dpr, p![1]);
        ctx.moveTo(p![0] + 6.5 * dpr, p![1]);
        ctx.lineTo(p![0] + 11 * dpr, p![1]);
      }, big ? "rgba(214, 236, 255, 0.85)" : "rgba(90, 220, 255, 0.95)", 1.5);
      // (beside it, to the right: the marks of a path seen end-on stack up, their labels still read)
      text(quarter ? "¼ ORBIT" : `+${ahead(m.t)}`, p![0] + 15 * dpr, p![1], big ? "rgba(214, 236, 255, 0.9)" : "rgba(90, 220, 255, 0.95)", 10.5, "left", true);
    }
  }
  // ---- the impact, the entry
  if (s.hudImpact && fu.impact) {
    const marks = [fu.impact, ...(fu.impact.ground ? [fu.impact.ground] : [])];
    for (const m of marks) {
      const ground = m.kind === "ground", air = m.kind === "air";
      const col = ground ? "#ff5a46" : air ? "#ffc85a" : "#ff8a5c";
      const label = ground ? `IMPACT ${ahead(m.t)}` : air ? `ENTRY ${ahead(m.t)}` : m.kind === "horizon" ? `HORIZON ${ahead(m.t)}` : `THE STAR ${ahead(m.t)}`;
      const p = m.hid ? null : pr(m.d);
      if (inside(p, 20 * dpr)) {
        const R = 13 * dpr;
        stroke(() => {
          ctx.arc(p![0], p![1], R, 0, 2 * Math.PI);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            ctx.moveTo(p![0] + dx * R * 0.45, p![1] + dy * R * 0.45);
            ctx.lineTo(p![0] + dx * R * 1.5, p![1] + dy * R * 1.5);
          }
        }, col, 1.8, air ? [4, 3] : undefined);
        text(label, p![0], p![1] + R * 2.1, col, 12, "center", true);
      } else if (ground || m.kind === "horizon") {
        // (out of the view: an arrow at its edge, the countdown by it)
        const d = m.d;
        let dx = d[0], dy = -d[1];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const [x, y] = edgeAt(W, H, dpr, dx, dy);
        ctx.beginPath();
        ctx.moveTo(x + dx * 16 * dpr, y + dy * 16 * dpr);
        ctx.lineTo(x - dy * 8 * dpr, y + dx * 8 * dpr);
        ctx.lineTo(x + dy * 8 * dpr, y - dx * 8 * dpr);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        text(label, x - dx * 30 * dpr, y - dy * 30 * dpr, col, 11.5, "center", true);
      }
    }
  }
}

/**
 * Where an arrow at the screen's edge goes for a screen direction (dx, dy, unit, y down): on the border
 * of the free frame — clear of the mission bar above and of the hub and its attitude ball below.
 */
function edgeAt(W: number, H: number, dpr: number, dx: number, dy: number): [number, number] {
  const top = 120 * dpr, bottom = Math.max(H * 0.62, H - 250 * dpr), side = 60 * dpr;
  const cy = (top + bottom) / 2, hy = (bottom - top) / 2, hx = W / 2 - side;
  const k = Math.min(hx / Math.max(Math.abs(dx), 1e-6), hy / Math.max(Math.abs(dy), 1e-6));
  return [W / 2 + dx * k, cy + dy * k];
}

/**
 * The runway in reach, drawn where it is: its outline on the ground, its centreline drawn 15 km back
 * (dashed, every kilometre), the aim point 2 km short of the threshold — the glide path's: the flight path
 * vector on the diamond is the craft on its glide path —; a box with the runway, the distance to its
 * threshold, the offset across the axis; on the final the glide path asked against the one flown;
 * FLARE low over it.
 */
function drawRunway(F: SymFrame, rw: RunwayView, pr: Proj, stroke: Stroke, text: Text, inside: (p: [number, number] | null, m?: number) => boolean) {
  const { ctx, dpr, W, H } = F;
  const front = (q: { d: V3 }) => q.d[2] > 1e-3;
  // the outline (its far end first: the near one may be behind the eye on the ground)
  if (rw.corners.every(front)) {
    const pts = rw.corners.map((q) => pr(q.d)!);
    ctx.beginPath();
    pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 220, 160, 0.12)";
    ctx.fill();
    stroke(() => {
      pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
    }, "rgba(255, 220, 160, 0.95)", 1.8);
    // (the threshold: a bar across)
    stroke(() => {
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      ctx.lineTo(pts[3]![0], pts[3]![1]);
    }, "#ffffff", 3);
  }
  // the centreline drawn back from the threshold, its kilometres ticked
  const line = rw.line.filter(front).map((q) => pr(q.d)!);
  if (line.length > 1) stroke(() => line.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))), "rgba(124, 214, 255, 0.75)", 1.4, [8, 6]);
  // the aim point
  const a = front(rw.aim) ? pr(rw.aim.d) : null;
  if (inside(a, 6 * dpr)) {
    const R = 8 * dpr;
    stroke(() => {
      ctx.moveTo(a![0], a![1] - R);
      ctx.lineTo(a![0] + R, a![1]);
      ctx.lineTo(a![0], a![1] + R);
      ctx.lineTo(a![0] - R, a![1]);
      ctx.closePath();
    }, "#78ffaa", 1.8);
    text("AIM", a![0] + R + 6 * dpr, a![1], "#78ffaa", 10.5, "left", true);
  }
  // the box: the runway, the distance to its threshold, the offset across the axis, the glide path
  const dist = Math.max(-rw.along, 0);
  const km = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  const off = Math.abs(rw.across) < 15 ? "ON AXIS" : `${rw.across > 0 ? "R" : "L"} ${Math.abs(rw.across) >= 1000 ? `${(Math.abs(rw.across) / 1000).toFixed(1)} km` : `${Math.round(Math.abs(rw.across))} m`}`;
  // (left of the view's centre — the vertical landing's scope stands on the right —, clear of the hub)
  const x = W / 2 - Math.min(W, H) * 0.44, y = H / 2 - 10 * dpr;
  ctx.fillStyle = "rgba(4, 10, 18, 0.55)";
  ctx.fillRect(x - 96 * dpr, y - 28 * dpr, 192 * dpr, rw.gRef !== null && rw.gam !== null ? 70 * dpr : 54 * dpr);
  text(`RWY ${String(Math.round(rw.rwy / 10) % 36 || 36).padStart(2, "0")} · ${rw.name.toUpperCase()}`, x, y - 14 * dpr, "rgba(255, 220, 160, 0.95)", 11);
  text(km, x, y + 4 * dpr, "#ffffff", 13, "center", true);
  text(off, x, y + 20 * dpr, Math.abs(rw.across) > 300 ? "#ffc85a" : Math.abs(rw.across) < 15 ? "#78ffaa" : "rgba(214, 236, 255, 0.95)", 11.5, "center", true);
  if (rw.gRef !== null && rw.gam !== null) {
    const e = ((rw.gam - rw.gRef) * 180) / Math.PI;
    text(`GLIDE ${e >= 0 ? "▲" : "▼"} ${Math.abs(e).toFixed(1)}°`, x, y + 35 * dpr, Math.abs(e) > 2 ? "#ffc85a" : "#78ffaa", 11.5, "center", true);
  }
  if (rw.final && rw.agl < 60 && rw.agl > 1) {
    const on = Math.floor(performance.now() / 350) % 2 === 0;
    if (on) text("FLARE", W / 2, H / 2 - 70 * dpr, "#ffc85a", 16);
  }
}

/**
 * The vertical landing (low over the ground, slow — the Lander's, a hover):
 * - the drift scope beside the view (heading up): the velocity over the ground, its scale chosen for it;
 *   the vertical speed's bar, the height over the ground;
 * - the stop burn: at full thrust, how long until it must start to stop at the ground (BURN IN …, BURN
 *   NOW), from the descent rate, the thrust over weight and the local gravity;
 * - the touchdown spot in the view: where the craft comes down at this drift and descent rate.
 */
function drawHover(F: SymFrame, sf: NonNullable<SymInfo["surface"]>, up: V3 | null, pr: Proj, stroke: Stroke, text: Text, inside: (p: [number, number] | null, m?: number) => boolean) {
  const { ctx, dpr, W, H, i } = F;
  const A = i.air;
  // (a hover, a vertical descent: low and slow — not the glide to a runway)
  if (!(sf.alt < 3000) || (A && A.speed && A.speed > 160 && A.q > 20)) return;
  const drift = i.dirs.drift ?? null;
  const vDown = Math.max(-sf.vVert, 0);
  // ---- the scope
  const R0 = 52 * dpr, cx = W / 2 + Math.min(W, H) * 0.44, cy = H / 2 + 20 * dpr;
  ctx.fillStyle = "rgba(4, 10, 18, 0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, R0 + 6 * dpr, 0, 2 * Math.PI);
  ctx.fill();
  stroke(() => {
    ctx.arc(cx, cy, R0, 0, 2 * Math.PI);
    ctx.moveTo(cx + R0 / 2, cy);
    ctx.arc(cx, cy, R0 / 2, 0, 2 * Math.PI);
    ctx.moveTo(cx - R0, cy);
    ctx.lineTo(cx + R0, cy);
    ctx.moveTo(cx, cy - R0);
    ctx.lineTo(cx, cy + R0);
  }, "rgba(124, 214, 255, 0.45)", 1);
  const scales = [2, 5, 10, 20, 50, 100, 200];
  const full = scales.find((k) => k >= sf.vHor * 1.25) ?? 200;
  if (drift && up && sf.vHor > 0.05) {
    // (heading up: the view's horizontal forward, its right)
    let f = comb([0, 0, 1], 1, up, -up[2]);
    if (Math.hypot(...f) < 0.05) f = comb([0, 1, 0], 1, up, -up[1]);
    f = norm(f);
    const r = norm(crossW(up, f));
    const k = Math.min(sf.vHor / full, 1.15) * R0;
    const dx = dot(drift, r) * k * -1, dy = -dot(drift, f) * k;
    const tx = cx + dx, ty = cy + dy;
    const col = sf.vHor > 3 ? "#ffc85a" : "#78ffaa";
    stroke(() => {
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
    }, col, 2.2);
    ctx.beginPath();
    ctx.arc(tx, ty, 4 * dpr, 0, 2 * Math.PI);
    ctx.fillStyle = col;
    ctx.fill();
  }
  text(`DRIFT ${sf.vHor.toFixed(sf.vHor < 10 ? 1 : 0)} m/s`, cx, cy + R0 + 18 * dpr, sf.vHor > 3 ? "#ffc85a" : "rgba(214, 236, 255, 0.9)", 11, "center", true);
  text(`${full} m/s`, cx + R0 - 2 * dpr, cy - R0 + 2 * dpr, "rgba(124, 214, 255, 0.6)", 9, "right", true);
  text(`AGL ${sf.alt >= 1000 ? `${(sf.alt / 1000).toFixed(2)} km` : `${Math.round(sf.alt)} m`}`, cx, cy - R0 - 16 * dpr, "#ffffff", 12, "center", true);
  // ---- the vertical speed's bar (±20 m/s), right of the scope
  const bx = cx + R0 + 22 * dpr, bh = R0 * 2;
  stroke(() => {
    ctx.moveTo(bx, cy - bh / 2);
    ctx.lineTo(bx, cy + bh / 2);
    ctx.moveTo(bx - 4 * dpr, cy);
    ctx.lineTo(bx + 4 * dpr, cy);
  }, "rgba(124, 214, 255, 0.5)", 1.2);
  const vv = Math.max(-1, Math.min(1, sf.vVert / 20));
  const vcol = vDown > Math.max(2, sf.alt / 10) ? "#ff5a46" : vDown > 2 ? "#ffc85a" : "#78ffaa";
  ctx.fillStyle = vcol;
  ctx.fillRect(bx - 3 * dpr, Math.min(cy, cy - vv * (bh / 2)), 6 * dpr, Math.abs(vv) * (bh / 2));
  text(`${sf.vVert >= 0 ? "▲" : "▼"} ${Math.abs(sf.vVert).toFixed(1)}`, bx + 8 * dpr, cy - vv * (bh / 2), vcol, 10.5, "left", true);
  // ---- the stop burn: the full-thrust deceleration against gravity, the distance it needs
  const g = sf.gLocal * 9.80665;
  const net = (sf.twr - 1) * g;
  let cue = "", ccol = "rgba(214, 236, 255, 0.9)";
  if (vDown > 1) {
    if (net <= 0.05) (cue = "TWR < 1 · NO STOP"), (ccol = "#ff5a46");
    else {
      const stop = (vDown * vDown) / (2 * net);
      const tIn = (sf.alt - stop * 1.1) / vDown;
      if (tIn <= 0) {
        if (Math.floor(performance.now() / 300) % 2 === 0) (cue = "BURN NOW"), (ccol = "#ff5a46");
        else cue = " ";
      } else if (tIn < 60) (cue = `BURN IN ${tIn.toFixed(tIn < 10 ? 1 : 0)} s`), (ccol = tIn < 5 ? "#ffc85a" : "rgba(214, 236, 255, 0.9)");
      else cue = `STOP ${Math.round(stop)} m`;
    }
  }
  if (cue) text(cue, cx, cy + R0 + 36 * dpr, ccol, 13, "center", true);
  // ---- the touchdown spot in the view: down the height, along the drift for as long as the fall lasts
  if (up && vDown > 0.3) {
    const tg = sf.alt / vDown;
    const v = comb(up, -sf.alt, drift ?? [0, 0, 0], sf.vHor * tg);
    const p = pr(norm(v));
    if (inside(p, 12 * dpr)) {
      const R = 11 * dpr;
      stroke(() => {
        ctx.arc(p![0], p![1], R, 0, 2 * Math.PI);
        ctx.moveTo(p![0] - R * 1.6, p![1]);
        ctx.lineTo(p![0] + R * 1.6, p![1]);
        ctx.moveTo(p![0], p![1] - R * 1.6);
        ctx.lineTo(p![0], p![1] + R * 1.6);
      }, "#78ffaa", 1.6);
      text(`TD ${Math.round(tg)} s`, p![0], p![1] + R * 2.3, "#78ffaa", 11, "center", true);
    }
  }
}
