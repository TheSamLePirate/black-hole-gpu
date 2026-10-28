// The speed felt (the flight HUD's canvas, under its symbology): the frame's edges darkened with the speed — more
// fast, low over the ground and with the afterburner lit —; the grey-out of a hard pull (from 5 g, the field narrowing
// to a tunnel at 9). Only in the air. (The streaks of the air rushing past the eye are gone — 28/10/2026, the
// owner's choice: not realistic.)

/** How strong the speed's effects are (0 … 1): the speed through the air, the air's density, the ground's
 *  nearness (the speed over the height: the ground rushing by), the afterburner. */
export function speedFxLevel(o: { speed: number; rho: number; agl: number; boost: number }): number {
  if (!(o.speed > 0) || !(o.rho > 0)) return 0;
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const air = smooth(60, 380, o.speed) * Math.min(1, Math.sqrt(o.rho / 1.225) * 1.4);
  // (the ground's rush: its angular speed below, speed / height [rad/s] — 1 rad/s is 200 m/s at 200 m)
  const ground = Number.isFinite(o.agl) ? 0.5 * smooth(0.15, 1.2, o.speed / Math.max(o.agl, 5)) : 0;
  return Math.min(1, air + ground * air + (o.boost > 1 ? 0.25 : 0) * air);
}

/** The grey-out's strength (0 … 1) at a load [g]: from 5 g, full at 9. */
export const greyOut = (g: number) => Math.min(Math.max((g - 5) / 4, 0), 1);

// (the load at the pilot's eyes — game/gstrain.ts —, here for its tests)
export { GStrain } from "../game/gstrain";

type V3 = [number, number, number];

/**
 * The camera's axes in the world's (rows: right, up, forward — each on north, east, up) from the local vertical
 * and north in camera coordinates (the HUD's dirs; camera coordinates are left-handed: east = −(north × up)).
 */
export function cameraInWorld(up: V3, north: V3): [V3, V3, V3] {
  const e: V3 = [-(north[1] * up[2] - north[2] * up[1]), -(north[2] * up[0] - north[0] * up[2]), -(north[0] * up[1] - north[1] * up[0])];
  const l = Math.hypot(...e) || 1;
  const east: V3 = [e[0] / l, e[1] / l, e[2] / l];
  return [0, 1, 2].map((r) => [north[r]!, east[r]!, up[r]!]) as [V3, V3, V3];
}

export class SpeedFx {
  private grey = 0;

  /**
   * One frame: `level` (speedFxLevel × the player's setting: the edges darkened), the pilot's eyes under load (the
   * grey-out, its own setting).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    o: {
      W: number;
      H: number;
      dpr: number;
      level: number;
      /** the pilot's eyes (game/gstrain.ts, the controller's): the grey-out, the black-out, the red-out 0…1 */
      body: { grey: number; black: number; red: number } | null;
      greyOut: boolean;
    },
  ) {
    const { W, H } = o;
    // ---- the edges darkened with the speed, the grey-out of a hard pull (the load felt at the eyes: GStrain), the
    // field narrowing to a tunnel, the colours washed out; the red-out of a negative load
    const B = o.greyOut && o.body ? o.body : { grey: 0, black: 0, red: 0 };
    this.grey = B.grey;
    const red = B.red;
    if (this.grey > 0.25) {
      ctx.fillStyle = `rgba(70, 70, 70, ${Math.min(0.55, (this.grey - 0.25) * 0.8).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (red > 0.01) {
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.hypot(W, H) * 0.1, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      gr.addColorStop(0, `rgba(160, 10, 10, ${(0.25 * red).toFixed(3)})`);
      gr.addColorStop(1, `rgba(90, 0, 0, ${Math.min(0.9, 0.85 * red).toFixed(3)})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
    const edge = 0.28 * o.level + 0.75 * this.grey;
    if (edge > 0.01) {
      const r0 = Math.hypot(W, H) * (0.55 - 0.3 * this.grey),
        r1 = Math.hypot(W, H) * 0.62;
      const gr = ctx.createRadialGradient(W / 2, H / 2, r0 * 0.45, W / 2, H / 2, r1);
      gr.addColorStop(0, "rgba(0, 0, 0, 0)");
      gr.addColorStop(1, `rgba(${this.grey > 0.3 ? "28, 28, 28" : "0, 0, 0"}, ${Math.min(0.92, edge).toFixed(3)})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
    // (the black-out: the tunnel closing to a point, then nothing — G-LOC)
    if (B.black > 0.01) {
      const R = Math.hypot(W, H);
      const inner = R * 0.32 * (1 - B.black) ** 1.5;
      const gr = ctx.createRadialGradient(W / 2, H / 2, inner, W / 2, H / 2, inner + R * (0.06 + 0.25 * (1 - B.black)));
      gr.addColorStop(0, "rgba(0, 0, 0, 0)");
      gr.addColorStop(1, "rgba(0, 0, 0, 1)");
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
      if (B.black > 0.85) {
        ctx.fillStyle = `rgba(0, 0, 0, ${((B.black - 0.85) / 0.15).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }
}
