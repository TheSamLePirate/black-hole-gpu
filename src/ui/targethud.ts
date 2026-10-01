// The targeting HUD (Outer Wilds' lock-on): around what is locked — the target body, or the space
// station clicked — a ring its apparent size, its name above, the distance to its surface below; beside
// it the closing speed (▼, warm: coming closer; ▲, cool: going away); from its centre an arrow, the
// velocity it has relative to the ship across the view — its length on a log scale, the speed at its
// tip, and whether the rest is towards or away from the eye (⊙ / ⊗); under it the closest approach on
// straight lines, or the time to impact. Off the screen: an arrow at its edge, the name and distance.

import type { Vec3 } from "../physics";

export interface LockDraw {
  name: string;
  /** its colour ("r, g, b") */
  colour: string;
  /** direction (camera frame: x right, y up, z forward), angular radius [rad] */
  dir: Vec3;
  ang: number;
  /** distance to its surface [m]; velocity relative to the ship (camera frame) [m/s]; closing rate [m/s] */
  dist: number;
  vrel: Vec3;
  closing: number;
  /** closest approach on straight lines: its distance from the surface [m], its time [s] (NaN: past); time to impact [s] (NaN: none) */
  ca: number;
  tca: number;
  impact: number;
}

const C = 299792458;

/** A distance for the eye: m, km, then AU and light-years. */
export function fmtDistance(m: number) {
  const a = Math.abs(m);
  if (a < 10) return `${m.toFixed(2)} m`;
  if (a < 1000) return `${m.toFixed(1)} m`;
  if (a < 1e4) return `${(m / 1e3).toFixed(2)} km`;
  if (a < 1e6) return `${(m / 1e3).toFixed(1)} km`;
  if (a < 1.5e9) return `${Math.round(m / 1e3).toLocaleString("en-US")} km`;
  if (a < 9.46e14) return `${(m / 1.495978707e11).toFixed(a < 1.5e11 ? 3 : 2)} AU`;
  return `${(m / 9.4607e15).toFixed(2)} ly`;
}

/** A speed for the eye: m/s, km/s, then fractions of c. */
export function fmtSpeed(v: number) {
  const a = Math.abs(v);
  if (a < 10) return `${v.toFixed(2)} m/s`;
  if (a < 1000) return `${v.toFixed(1)} m/s`;
  if (a < 0.01 * C) return `${(v / 1e3).toFixed(a < 1e4 ? 2 : 1)} km/s`;
  return `${(v / C).toFixed(3)} c`;
}

/** A duration for the eye: s, min s, h min, days. */
export function fmtTime(s: number) {
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${(s / 86400).toFixed(1)} d`;
}

/**
 * Draws it: W × H device pixels, tanH = tan(fov/2), a device pixel ratio k, an opacity. The key: what
 * changes the drawing (the overlay redraws only then).
 */
export function lockKey(v: LockDraw, W: number, H: number, tanH: number) {
  const p = project(v.dir, W, H, tanH);
  return [v.name, p ? p[0].toFixed(1) : "off", p ? p[1].toFixed(1) : "", v.ang.toPrecision(3), fmtDistance(v.dist), fmtSpeed(v.closing), v.vrel.map((x) => x.toPrecision(2)), Number.isFinite(v.impact) ? v.impact.toFixed(0) : "", Number.isFinite(v.tca) ? fmtTime(v.tca) : "", fmtDistance(v.ca)].join();
}

function project(d: Vec3, W: number, H: number, tanH: number): [number, number] | null {
  if (d[2] <= 1e-3) return null;
  return [((d[0] / (d[2] * tanH * (W / H)) + 1) / 2) * W, ((1 - d[1] / (d[2] * tanH)) / 2) * H];
}

export function drawLock(ctx: CanvasRenderingContext2D, v: LockDraw, W: number, H: number, tanH: number, k: number, alpha: number, inset = { top: 0, bottom: 0 }) {
  const col = v.colour || "200, 220, 255";
  const p = project(v.dir, W, H, tanH);
  const margin = 28 * k;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 4 * k;
  ctx.lineCap = "round";
  const on = p && p[0] > margin && p[0] < W - margin && p[1] > margin && p[1] < H - margin;
  const label = (text: string, x: number, y: number, size: number, weight: number, fill: string, align: CanvasTextAlign = "center", font = "Rajdhani, Inter, system-ui, sans-serif") => {
    ctx.font = `${weight} ${size * k}px ${font}`;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  };
  const mono = '"JetBrains Mono", ui-monospace, monospace';
  const warm = "255, 176, 92", cool = "124, 200, 255", red = "255, 90, 70";
  if (!on) {
    // off the screen: an arrow at its edge, towards where it is (behind: the way to turn)
    const dx = v.dir[0], dy = -v.dir[1];
    const a = Math.atan2(dy, dx);
    // (within the view less the HUD's bars: the mission bar above, the cockpit below)
    const top = margin + inset.top, bottom = H - margin - inset.bottom;
    const cx = W / 2, cy = (top + bottom) / 2;
    const ex = Math.cos(a), ey = Math.sin(a);
    const s = Math.min((W / 2 - margin) / Math.max(Math.abs(ex), 1e-6), ((bottom - top) / 2) / Math.max(Math.abs(ey), 1e-6));
    const x = cx + ex * s, y = cy + ey * s;
    ctx.fillStyle = `rgba(${col}, 0.95)`;
    ctx.beginPath();
    ctx.moveTo(x + ex * 12 * k, y + ey * 12 * k);
    ctx.lineTo(x - ey * 7 * k - ex * 4 * k, y + ex * 7 * k - ey * 4 * k);
    ctx.lineTo(x + ey * 7 * k - ex * 4 * k, y - ex * 7 * k - ey * 4 * k);
    ctx.closePath();
    ctx.fill();
    const tx = x - ex * 34 * k, ty = y - ey * 22 * k;
    label(v.name.toUpperCase(), tx, ty, 12, 700, `rgba(${col}, 0.95)`);
    label(fmtDistance(v.dist), tx, ty + 14 * k, 11, 500, "rgba(235, 240, 248, 0.9)", "center", mono);
    ctx.restore();
    return;
  }
  const [x, y] = p!;
  // the ring: the target's apparent size (at least a fingertip), four ticks, its centre
  // (no larger than the view keeps its figures: near, it fills it — the ring a frame for them)
  const r = Math.min(Math.max(18 * k, (Math.tan(v.ang) / tanH) * (H / 2) * 1.08), 0.34 * H);
  ctx.strokeStyle = `rgba(${col}, 0.9)`;
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    ctx.moveTo(x + ux * r, y + uy * r);
    ctx.lineTo(x + ux * (r + 7 * k), y + uy * (r + 7 * k));
  }
  ctx.stroke();
  ctx.fillStyle = `rgba(${col}, 0.9)`;
  ctx.beginPath();
  ctx.arc(x, y, 2.2 * k, 0, 2 * Math.PI);
  ctx.fill();
  // its name above, the distance to its surface below (inside the view: a ring larger than it, the
  // figures inside the ring, by its centre)
  const top = y - r - 12 * k, bot = y + r + 20 * k;
  const nameY = top > 30 * k ? top : y - 22 * k;
  const distY = bot + 24 * k < H - 8 * k ? bot : y + 30 * k;
  label(v.name.toUpperCase(), x, nameY, 13, 700, `rgba(${col}, 1)`);
  label(fmtDistance(v.dist), x, distY, 15, 600, "rgba(255, 255, 255, 0.95)", "center", mono);
  // the closing speed beside it: ▼ coming closer (warm), ▲ going away (cool) — by the distance when the
  // ring's side is off the view
  const closing = v.closing > 0;
  const cc = Math.abs(v.closing) < 0.005 ? "220, 228, 240" : closing ? warm : cool;
  const sideX = x + r + 14 * k < W - 110 * k ? x + r + 14 * k : x - 10 * k;
  const sideY = x + r + 14 * k < W - 110 * k ? y + 5 * k : distY + 18 * k;
  label(`${closing ? "▼" : "▲"} ${fmtSpeed(Math.abs(v.closing))}`, sideX, sideY, 13, 600, `rgba(${cc}, 1)`, sideX < x ? "center" : "left", mono);
  // the relative velocity across the view: an arrow from the centre (log scale), the speed at its tip;
  // its part along the line of sight: ⊙ towards the eye, ⊗ away
  const vl = Math.hypot(...v.vrel);
  if (vl > 0.005) {
    const lat = Math.hypot(v.vrel[0], v.vrel[1]);
    const L = Math.min(150 * k, (14 + 34 * Math.log10(1 + lat / 0.05)) * k);
    const ux = v.vrel[0] / (lat || 1), uy = -v.vrel[1] / (lat || 1);
    // (from its centre: the way it drifts across the view)
    const sx = x + ux * 6 * k, sy = y + uy * 6 * k;
    const tx = sx + ux * L, ty = sy + uy * L;
    if (lat > 0.005) {
      ctx.strokeStyle = `rgba(${cc}, 0.95)`;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ux * 8 * k - uy * 5 * k, ty - uy * 8 * k + ux * 5 * k);
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ux * 8 * k + uy * 5 * k, ty - uy * 8 * k - ux * 5 * k);
      ctx.stroke();
    }
    // (the speed itself, its depth sign)
    const toward = v.vrel[2] < 0;
    const ox = lat > 0.005 ? tx + ux * 10 * k : sideX;
    const oy = lat > 0.005 ? ty + uy * 10 * k + 4 * k : sideY + 17 * k;
    label(`${toward ? "⊙" : "⊗"} ${fmtSpeed(vl)}`, ox, oy, 11, 500, "rgba(235, 240, 248, 0.85)", lat > 0.005 ? (ux >= 0 ? "left" : "right") : "left", mono);
  }
  // under the distance: the time to impact (red), or the closest approach
  const y2 = distY + 16 * k;
  if (Number.isFinite(v.impact)) label(`IMPACT ${fmtTime(v.impact)}`, x, y2, 13, 700, `rgba(${red}, 1)`);
  else if (Number.isFinite(v.tca) && v.tca < 30 * 86400) label(`CLOSEST ${fmtDistance(v.ca)} · ${fmtTime(v.tca)}`, x, y2, 11, 600, "rgba(200, 214, 232, 0.85)");
  ctx.restore();
}
