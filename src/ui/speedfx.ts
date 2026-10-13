// The speed felt (the flight HUD's canvas, under its symbology): streaks of the air rushing past — specks of
// moisture and dust in a box of the world round the eye, carried by the flow, drawn as their motion over a
// fraction of a second (so a turn sweeps them across the view, a climb lifts them) —, more of them faster, low
// over the ground and with the afterburner lit; the frame's edges darkened with the speed; the grey-out of a
// hard pull (from 5 g, the field narrowing to a tunnel at 9). Only in the air: in vacuum nothing streams past.

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

type V3 = [number, number, number];
const N = 140;

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
const R = 70;

export class SpeedFx {
  /** the specks about the eye (world axes: north, east, up — metres), their seeds */
  private p: V3[] = [];
  private seed: number[] = [];
  private grey = 0;
  constructor() {
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
    for (let i = 0; i < N; i++) {
      this.p.push([rnd() * R, rnd() * R, rnd() * R]);
      this.seed.push((rnd() + 1) / 2);
    }
  }

  /**
   * One frame: `M` the camera's axes in the world's (rows: right, up, forward — each in north, east, up), the
   * flow past the eye in the world [m/s] (the air's velocity relative to the craft), `level` (speedFxLevel ×
   * the player's setting), the load [g] (the grey-out, its own setting).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    o: {
      W: number;
      H: number;
      dpr: number;
      fov: number;
      dt: number;
      M: [V3, V3, V3];
      flow: V3;
      level: number;
      g: number;
      greyOut: boolean;
    },
  ) {
    const { W, H, dpr } = o;
    // ---- the streaks
    if (o.level > 0.01) {
      const f = o.flow;
      const dt = Math.min(o.dt, 0.1);
      const trail = 0.045;
      const tanH = Math.tan((o.fov * Math.PI) / 360);
      const fpx = H / (2 * tanH);
      const cam = (v: V3): V3 => [
        o.M[0][0] * v[0] + o.M[0][1] * v[1] + o.M[0][2] * v[2],
        o.M[1][0] * v[0] + o.M[1][1] * v[1] + o.M[1][2] * v[2],
        o.M[2][0] * v[0] + o.M[2][1] * v[1] + o.M[2][2] * v[2],
      ];
      const wrap = (x: number) => ((((x + R) % (2 * R)) + 2 * R) % (2 * R)) - R;
      const n = Math.round(N * Math.min(1, 0.25 + 0.75 * o.level));
      ctx.save();
      ctx.lineCap = "round";
      for (let i = 0; i < n; i++) {
        const p = this.p[i]!;
        for (let k = 0; k < 3; k++) p[k] = wrap(p[k]! + f[k]! * dt);
        const a = cam(p),
          b = cam([p[0] - f[0] * trail, p[1] - f[1] * trail, p[2] - f[2] * trail]);
        if (a[2] < 2 || b[2] < 2) continue;
        const x0 = W / 2 + (a[0] / a[2]) * fpx,
          y0 = H / 2 - (a[1] / a[2]) * fpx,
          x1 = W / 2 + (b[0] / b[2]) * fpx,
          y1 = H / 2 - (b[1] / b[2]) * fpx;
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 2 * dpr || len > 0.6 * H) continue;
        // (nearer, brighter; the centre of the view kept clear — the eye's target)
        const near = Math.min(1, 25 / a[2]);
        const off = Math.hypot(x0 - W / 2, y0 - H / 2) / (0.5 * Math.hypot(W, H));
        const alpha = o.level * (0.18 + 0.5 * near) * Math.min(1, off * 2.2) * (0.5 + 0.5 * this.seed[i]!);
        if (alpha < 0.02) continue;
        ctx.strokeStyle = `rgba(235, 245, 255, ${Math.min(0.75, alpha).toFixed(3)})`;
        ctx.lineWidth = (0.6 + 1.4 * near) * dpr;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.restore();
    }
    // ---- the edges darkened with the speed, the grey-out of a hard pull (eased in and out)
    const gWant = o.greyOut ? greyOut(o.g) : 0;
    this.grey += (gWant - this.grey) * Math.min(1, o.dt / (gWant > this.grey ? 1.2 : 0.5));
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
  }
}
