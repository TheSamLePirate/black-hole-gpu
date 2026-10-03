import { AU_M } from "../units";
import { FONT, MONO } from "./hudkit";
// The telescope's overlay: a reticle, the target's disc, the angular scale, the lens (its focal length
// on a 35 mm frame, the magnification against a 50 mm lens) and the target (its apparent diameter, its
// distance, the tracking). Drawn on the overlay canvas (never into the renders: exports stay clean).

/** An angle [°] the way astronomers write it: 2.5°, 1°12′, 12′30″, 8.2″. */
export function fmtAngle(deg: number): string {
  const a = Math.abs(deg);
  if (a >= 10) return `${a.toFixed(1)}°`;
  if (a >= 1) {
    const d = Math.floor(a),
      m = Math.round((a - d) * 60);
    return m === 60 ? `${d + 1}°` : m ? `${d}°${String(m).padStart(2, "0")}′` : `${d}°`;
  }
  const am = a * 60;
  if (am >= 1) {
    const m = Math.floor(am),
      sec = Math.round((am - m) * 60);
    return sec === 60 ? `${m + 1}′` : sec ? `${m}′${String(sec).padStart(2, "0")}″` : `${m}′`;
  }
  const as = a * 3600;
  return `${as >= 10 ? as.toFixed(0) : as.toFixed(1)}″`;
}

/** The 35 mm equivalent focal length [mm] of a vertical field of view [°] (a 24 mm high frame). */
export const focalLength = (fovDeg: number) => 12 / Math.tan((fovDeg * Math.PI) / 360);

/** A distance [m] in its unit: m, km, AU, ly. */
function fmtDistance(m: number): string {
  if (m < 1e4) return `${m.toFixed(0)} m`;
  if (m < 1e10)
    return `${Math.round(m / 1e3)
      .toLocaleString("en-US")
      .replace(/,/g, " ")} km`;
  if (m < 1e15) return `${(m / AU_M).toPrecision(3)} AU`;
  return `${(m / 9.4607e15).toPrecision(3)} ly`;
}

export interface TelescopeView {
  /** vertical field of view [°] */
  fov: number;
  /** the target: its name, angular radius [rad], distance [M], where it is in the view (NDC, null: out of it) */
  target: { name: string; ang: number; dist: number; ndc: [number, number] | null } | null;
  /** metres per M */
  mPerM: number;
  tracking: boolean;
}

const SCALE_ARCSEC = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 36000];

/** Draws the telescope's overlay on a canvas of W × H device pixels (k: device pixels per CSS pixel). */
export function drawTelescope(ctx: CanvasRenderingContext2D, W: number, H: number, k: number, v: TelescopeView) {
  const cx = W / 2,
    cy = H / 2;
  ctx.save();
  // a soft vignette: the eyepiece's field stop, faint
  const R = Math.hypot(W, H) / 2;
  const g = ctx.createRadialGradient(cx, cy, 0.62 * R, cx, cy, R);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // the reticle: a cross open at its centre, fine ticks along it at the scale's step
  const pxPerDeg = H / v.fov; // (the field's centre: a gnomonic projection is linear there to <1 %)
  const halfW = (W / H) * v.fov * 3600;
  const step = SCALE_ARCSEC.filter((a) => a <= 0.2 * halfW).at(-1) ?? SCALE_ARCSEC[0]!;
  const stepPx = (step / 3600) * pxPerDeg;
  const gap = Math.min(W, H) * 0.035;
  const arm = Math.min(W, H) * 0.16;
  ctx.strokeStyle = "rgba(210, 236, 255, 0.55)";
  ctx.lineWidth = 1 * k;
  ctx.beginPath();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    ctx.moveTo(cx + dx * gap, cy + dy * gap);
    ctx.lineTo(cx + dx * arm, cy + dy * arm);
    for (let t = stepPx; t <= arm + 0.5; t += stepPx) {
      if (t < gap) continue;
      const len = 4 * k;
      ctx.moveTo(cx + dx * t - dy * len, cy + dy * t - dx * len);
      ctx.lineTo(cx + dx * t + dy * len, cy + dy * t + dx * len);
    }
  }
  ctx.stroke();

  // the target's disc (its apparent size), where it is
  if (v.target?.ndc) {
    const [nx, ny] = v.target.ndc;
    const x = ((nx + 1) / 2) * W,
      y = ((1 - ny) / 2) * H;
    const r = ((v.target.ang * 180) / Math.PI) * pxPerDeg;
    if (r > 6 * k && r < 2 * Math.max(W, H)) {
      ctx.strokeStyle = "rgba(255, 179, 92, 0.55)";
      ctx.setLineDash([5 * k, 5 * k]);
      ctx.beginPath();
      ctx.arc(x, y, r + 5 * k, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // the readout: the lens, then the target; the scale bar under them
  const f = focalLength(v.fov);
  const lens = `TELESCOPE · ${f >= 1e4 ? `${(f / 1e3).toFixed(f >= 1e5 ? 0 : 1)} m` : `${Math.round(f)} mm`} · FIELD ${fmtAngle(v.fov)} · ×${(f / 50).toPrecision(f / 50 >= 100 ? 3 : 2)}`;
  const lines = [lens];
  if (v.target) {
    const t = v.target;
    lines.push(
      `${t.name.toUpperCase()} · ⌀ ${fmtAngle((2 * t.ang * 180) / Math.PI)} · ${fmtDistance(t.dist * v.mPerM)}${v.tracking ? " · TRACKING" : ""}`,
    );
  }
  ctx.font = `600 ${12 * k}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const top = 62 * k;
  lines.forEach((l, i) => {
    const y = top + i * 17 * k;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    const w = ctx.measureText(l).width + 16 * k;
    ctx.fillRect(cx - w / 2, y - 2 * k, w, 16 * k);
    ctx.fillStyle = i === 0 ? "rgba(255, 196, 128, 0.95)" : "rgba(220, 236, 255, 0.9)";
    ctx.fillText(l, cx, y);
  });
  const by = top + lines.length * 17 * k + 6 * k;
  ctx.strokeStyle = "rgba(220, 236, 255, 0.85)";
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.moveTo(cx - stepPx / 2, by);
  ctx.lineTo(cx + stepPx / 2, by);
  ctx.moveTo(cx - stepPx / 2, by - 4 * k);
  ctx.lineTo(cx - stepPx / 2, by + 4 * k);
  ctx.moveTo(cx + stepPx / 2, by - 4 * k);
  ctx.lineTo(cx + stepPx / 2, by + 4 * k);
  ctx.stroke();
  ctx.fillStyle = "rgba(220, 236, 255, 0.85)";
  ctx.font = `500 ${11 * k}px ${MONO}`;
  ctx.fillText(fmtAngle(step / 3600), cx, by + 7 * k);
  ctx.restore();
}
