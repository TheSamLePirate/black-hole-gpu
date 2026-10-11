// CPU queries over the exact packed scenery, no GPU readback and no second collision geometry.
import type { Vec3 } from "../physics";
import { dot, sub } from "../math/vec3";
import { cartToGeodetic, WGS84_A, WGS84_F } from "./ellipsoid";
import { D, SCENERY_GRID, sceneryFrame, wrapLon, type SceneryReply } from "./scenery-data";

export class SceneryContact {
  private f: Float32Array;
  private u: Uint32Array;
  private frame: ReturnType<typeof sceneryFrame>;
  constructor(
    readonly reply: SceneryReply,
    buffer: ArrayBuffer,
  ) {
    this.f = new Float32Array(buffer);
    this.u = new Uint32Array(buffer);
    this.frame = sceneryFrame(reply.lat, reply.lon);
  }
  get bytes() {
    return this.f.byteLength;
  }
  local(qMetres: Vec3): Vec3 {
    const d = sub(qMetres, this.frame.origin);
    return [dot(d, this.frame.east), dot(d, this.frame.north), dot(d, this.frame.up)];
  }
  private visit(p: Vec3, radius: number, surface: boolean, fn: (base: number) => void) {
    const f = this.f;
    const start = surface ? f[4]! * 4 : 16;
    const count = surface ? f[5]! : f[0]!;
    const geom = surface ? f[6]! : f[1]!;
    let i = 0;
    while (i < count) {
      const n = start + i * 8;
      if (p[0] + radius < f[n]! || p[0] - radius > f[n + 4]! || p[1] + radius < f[n + 1]! || p[1] - radius > f[n + 5]!) {
        i = f[n + 3]!;
        continue;
      }
      const leaf = f[n + 7]!;
      if (leaf >= 0) fn((geom + leaf) * 4);
      i++;
    }
  }
  private polygon(p: Vec3, base: number, radius = 0) {
    const f = this.f;
    let inside = false,
      edge = false;
    for (let i = base + 12; i < base + 12 + f[base + 2]! * 4; i += 4) {
      const x = f[i]!,
        y = f[i + 1]!,
        dx = f[i + 2]! - x,
        dy = f[i + 3]! - y;
      const t = Math.max(0, Math.min(1, ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy || 1)));
      edge ||= (p[0] - x - t * dx) ** 2 + (p[1] - y - t * dy) ** 2 < radius * radius;
      if (y > p[1] !== f[i + 3]! > p[1] && p[0] < x + ((p[1] - y) * dx) / dy) inside = !inside;
    }
    return inside || edge;
  }
  cover(q: Vec3) {
    const geo = cartToGeodetic(WGS84_A, WGS84_F, q),
      b = this.reply.bounds;
    if (!b) return 0;
    const lon = b[0] + wrapLon(geo.lon / D - b[0]);
    const x = Math.floor(((lon - b[0]) / (b[2] - b[0])) * SCENERY_GRID),
      y = Math.floor(((b[3] - geo.lat / D) / (b[3] - b[1])) * SCENERY_GRID);
    if (x < 0 || y < 0 || x >= SCENERY_GRID || y >= SCENERY_GRID) return 0;
    return this.u[this.f[2]! * 4 + y * SCENERY_GRID + x]! >>> 24;
  }
  grass(q: Vec3) {
    if (this.cover(q) !== 30) return false;
    const p = this.local(q);
    let excluded = false;
    this.visit(p, 0.15, true, (b) => {
      const f = this.f;
      if (f[b + 11]! < 0.5) {
        const dx = f[b + 2]! - f[b]!,
          dy = f[b + 3]! - f[b + 1]!;
        const t = Math.max(0, Math.min(1, ((p[0] - f[b]!) * dx + (p[1] - f[b + 1]!) * dy) / (dx * dx + dy * dy || 1)));
        excluded ||= Math.hypot(p[0] - f[b]! - t * dx, p[1] - f[b + 1]! - t * dy) < f[b + 4]! + 0.25;
      } else excluded ||= this.polygon(p, b, 0.25);
    });
    this.visit(p, 0.3, false, (b) => {
      if (this.f[b + 3]! > 0.5 && this.polygon(p, b, 0.3)) excluded = true;
    });
    return !excluded;
  }
  /** Capsule occupancy and highest reachable support: preserves polygon holes and bridge undersides. */
  at(q: Vec3, radius = 0.3, height = 1.8, step = 0.25) {
    const p = this.local(q);
    let blocked = false,
      support = -Infinity;
    this.visit(p, radius, false, (b) => {
      const f = this.f;
      if (f[b + 3]! < 0.5) {
        blocked ||=
          Math.hypot(p[0] - f[b]!, p[1] - f[b + 1]!) < radius + 0.22 && p[2] < f[b + 2]! + f[b + 5]! * 0.64 && p[2] + height > f[b + 2]!;
      } else if (this.polygon(p, b, radius)) {
        const bottom = f[b]!,
          top = f[b + 1]!;
        if (top <= p[2] + step && top >= p[2] - 2) support = Math.max(support, top - p[2]);
        else if (bottom < p[2] + height - 0.02 && top > p[2] + 0.02) blocked = true;
      }
    });
    return { blocked, support };
  }
}
