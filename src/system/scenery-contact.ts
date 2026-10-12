// CPU queries over the exact packed scenery, no GPU readback and no second collision geometry.
import type { Vec3 } from "../physics";
import { dot, sub } from "../math/vec3";
import { cartToGeodetic, WGS84_A, WGS84_F } from "./ellipsoid";
import { D, SCENERY_GRID, sceneryFrame, wrapLon, type SceneryReply } from "./scenery-data";

export class SceneryContact {
  readonly f: Float32Array;
  readonly u: Uint32Array;
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
  /** The scenery raster's pixel under q (WorldCover class << 24 | satellite sRGB), 0 outside it. */
  private pixel(q: Vec3) {
    const geo = cartToGeodetic(WGS84_A, WGS84_F, q),
      b = this.reply.bounds;
    if (!b) return 0;
    const lon = b[0] + wrapLon(geo.lon / D - b[0]);
    const x = Math.floor(((lon - b[0]) / (b[2] - b[0])) * SCENERY_GRID),
      y = Math.floor(((b[3] - geo.lat / D) / (b[3] - b[1])) * SCENERY_GRID);
    if (x < 0 || y < 0 || x >= SCENERY_GRID || y >= SCENERY_GRID) return 0;
    return this.u[this.f[2]! * 4 + y * SCENERY_GRID + x]!;
  }
  cover(q: Vec3) {
    return this.pixel(q) >>> 24;
  }
  /** Is q under a road, a railway, a paved or water surface, or a building's footprint (with margins [m])? */
  excluded(q: Vec3, line = 0.25, area = 0.25, volume = 0.3) {
    const p = this.local(q);
    let out = false;
    this.visit(p, Math.max(line, area, 0.15), true, (b) => {
      const f = this.f;
      if (f[b + 11]! < 0.5) {
        const dx = f[b + 2]! - f[b]!,
          dy = f[b + 3]! - f[b + 1]!;
        const t = Math.max(0, Math.min(1, ((p[0] - f[b]!) * dx + (p[1] - f[b + 1]!) * dy) / (dx * dx + dy * dy || 1)));
        out ||= Math.hypot(p[0] - f[b]! - t * dx, p[1] - f[b + 1]! - t * dy) < f[b + 4]! + line;
      } else out ||= this.polygon(p, b, area);
    });
    this.visit(p, volume, false, (b) => {
      if (this.f[b + 3]! > 0.5 && this.polygon(p, b, volume)) out = true;
    });
    return out;
  }
  /**
   * What grows at q: its WorldCover class (0: outside the raster or excluded — a road, a building, water,
   * pavement), and the satellite's sRGB there (0xbbggrr; 0: none). The grass field's cells (grass-ground.ts).
   */
  vegetation(q: Vec3): { cover: number; rgb: number } {
    const px = this.pixel(q),
      cover = px >>> 24;
    if (!cover || cover === 50 || cover === 70 || cover === 80 || this.excluded(q)) return { cover: 0, rgb: px & 0xffffff };
    return { cover, rgb: this.reply.rgbPixels ? px & 0xffffff : 0 };
  }
  grass(q: Vec3) {
    return this.cover(q) === 30 && !this.excluded(q);
  }
  /** Diagnostic wireframe of the actual CPU colliders, in this cache's east/north/up metres. */
  collisionLines(q: Vec3, range = 60, maxSegments = 16384) {
    const p = this.local(q),
      f = this.f,
      bases: number[] = [],
      lines: number[] = [];
    this.visit(p, range, false, (b) => bases.push(b));
    // Draw the closest objects first if a dense forest reaches the diagnostic budget.
    const distance = (b: number) => {
      const x = f[b + 3]! < 0.5 ? f[b]! : f[b + 12]!;
      const y = f[b + 3]! < 0.5 ? f[b + 1]! : f[b + 13]!;
      return (x - p[0]) ** 2 + (y - p[1]) ** 2;
    };
    bases.sort((a, b) => distance(a) - distance(b));
    const line = (a: Vec3, b: Vec3) => {
      if (lines.length < maxSegments * 6) lines.push(...a, ...b);
    };
    let trees = 0,
      buildings = 0;
    for (const b of bases) {
      if (lines.length >= maxSegments * 6) break;
      if (f[b + 3]! < 0.5) {
        trees++;
        const x = f[b]!,
          y = f[b + 1]!,
          z = f[b + 2]!,
          h = f[b + 5]!;
        const corners: Vec3[] = [
          [x - 0.22, y - 0.22, z],
          [x + 0.22, y - 0.22, z],
          [x + 0.22, y + 0.22, z],
          [x - 0.22, y + 0.22, z],
        ];
        for (let i = 0; i < 4; i++) {
          const a = corners[i]!,
            c = corners[(i + 1) % 4]!;
          line(a, c);
          line([a[0], a[1], z + h * 0.64], [c[0], c[1], z + h * 0.64]);
          line(a, [a[0], a[1], z + h * 0.64]);
        }
        for (let l = 0; l < 5; l++) {
          const phase = l * 2.399963 + f[b + 6]! * Math.PI * 2,
            reach = l ? f[b + 4]! * 0.38 : 0;
          const centre: Vec3 = [x + Math.cos(phase) * reach, y + Math.sin(phase) * reach, z + h * (0.6 + 0.06 * l)];
          const r = f[b + 4]! * (0.65 + 0.06 * (l % 3)),
            rz = h * (0.22 + 0.02 * (l % 3));
          for (let plane = 0; plane < 3; plane++) {
            const point = (a: number): Vec3 =>
              plane === 0
                ? [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a), centre[2]]
                : plane === 1
                  ? [centre[0] + r * Math.cos(a), centre[1], centre[2] + rz * Math.sin(a)]
                  : [centre[0], centre[1] + r * Math.cos(a), centre[2] + rz * Math.sin(a)];
            for (let i = 0; i < 16; i++) line(point((i * Math.PI) / 8), point(((i + 1) * Math.PI) / 8));
          }
        }
      } else {
        buildings++;
        for (let i = 0; i < f[b + 2]!; i++) {
          const e = b + 12 + i * 4,
            low = f[b]!,
            high = f[b + 1]!;
          const a: Vec3 = [f[e]!, f[e + 1]!, low],
            c: Vec3 = [f[e + 2]!, f[e + 3]!, low];
          line(a, c);
          line([a[0], a[1], high], [c[0], c[1], high]);
          line(a, [a[0], a[1], high]);
        }
      }
    }
    return { vertices: new Float32Array(lines), trees, buildings, truncated: lines.length >= maxSegments * 6 };
  }
  /** Capsule occupancy and highest reachable support: preserves polygon holes and bridge undersides. */
  at(q: Vec3, radius = 0.3, height = 1.8, step = 0.25) {
    const p = this.local(q);
    let blocked = false,
      support = -Infinity;
    this.visit(p, radius, false, (b) => {
      const f = this.f;
      if (f[b + 3]! < 0.5) {
        // The rendered trunk is a box, not a cylinder; use the capsule's closest XY distance.
        const dx = Math.max(Math.abs(p[0] - f[b]!) - 0.22, 0);
        const dy = Math.max(Math.abs(p[1] - f[b + 1]!) - 0.22, 0);
        blocked ||= dx * dx + dy * dy < radius * radius && p[2] < f[b + 2]! + f[b + 5]! * 0.64 && p[2] + height > f[b + 2]!;
        // Same five ellipsoids, centres and radii as sceneryQuery() in trace.wgsl.
        for (let l = 0; l < 5 && !blocked; l++) {
          const phase = l * 2.399963 + f[b + 6]! * Math.PI * 2,
            reach = l ? f[b + 4]! * 0.38 : 0;
          const cx = f[b]! + Math.cos(phase) * reach,
            cy = f[b + 1]! + Math.sin(phase) * reach,
            cz = f[b + 2]! + f[b + 5]! * (0.6 + 0.06 * l);
          const rx = f[b + 4]! * (0.65 + 0.06 * (l % 3)),
            rz = f[b + 5]! * (0.22 + 0.02 * (l % 3));
          const low = p[2] + Math.min(radius, height / 2),
            high = p[2] + Math.max(height - radius, height / 2);
          const v = [p[0] - cx, p[1] - cy, Math.max(low, Math.min(high, cz)) - cz],
            radii = [rx, rx, rz];
          if (v.reduce((sum, x, i) => sum + (x / radii[i]!) ** 2, 0) <= 1) {
            blocked = true;
            break;
          }
          let lo = 0,
            hi = Math.hypot(...v) * Math.max(...radii);
          for (let k = 0; k < 20; k++) {
            const m = (lo + hi) / 2;
            const norm = v.reduce((sum, x, i) => sum + ((radii[i]! * x) / (m + radii[i]! ** 2)) ** 2, 0);
            if (norm > 1) lo = m;
            else hi = m;
          }
          blocked ||= v.reduce((sum, x, i) => sum + ((x * hi) / (hi + radii[i]! ** 2)) ** 2, 0) < radius * radius;
        }
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
