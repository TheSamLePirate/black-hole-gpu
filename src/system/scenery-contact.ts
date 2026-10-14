// CPU queries over the exact packed scenery, no GPU readback and no second collision geometry.
import type { Vec3 } from "../physics";
import { dot, sub } from "../math/vec3";
import { cartToGeodetic, WGS84_A, WGS84_F } from "./ellipsoid";
import { crownOf, ForestKind, type ForestFrame, forestTreesNear, KIND_SHAPES, readForest, trunkOf } from "./forest";
import { D, SCENERY_GRID, sceneryFrame, wrapLon, type SceneryReply } from "./scenery-data";

export class SceneryContact {
  readonly f: Float32Array;
  readonly u: Uint32Array;
  private frame: ReturnType<typeof sceneryFrame>;
  /** the procedural forest's grid (forest.ts), null when the scenery has none */
  readonly forest: { frame: ForestFrame; cells: Uint32Array } | null;
  constructor(
    readonly reply: SceneryReply,
    buffer: ArrayBuffer,
  ) {
    this.f = new Float32Array(buffer);
    this.u = new Uint32Array(buffer);
    this.frame = sceneryFrame(reply.lat, reply.lon);
    this.forest = readForest(this.f, this.u);
  }
  /** the trees whose trunk or crown may reach within `radius` of a frame point */
  private trees(p: Vec3, radius: number) {
    return this.forest ? forestTreesNear(this.forest.frame, this.forest.cells, p[0], p[1], radius) : [];
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
    const line = (a: Vec3, b: Vec3) => {
      if (lines.length < maxSegments * 6) lines.push(...a, ...b);
    };
    let trees = 0,
      buildings = 0;
    // (the nearest first, if a dense forest reaches the diagnostic budget: the trunks the astronaut meets)
    for (const t of this.trees(p, range)) {
      if (lines.length >= maxSegments * 6) break;
      trees++;
      const trunk = trunkOf(t),
        k = KIND_SHAPES[t.kind]!;
      const ring = (z: number, r: number, cx = t.x, cy = t.y) => {
        for (let i = 0; i < 12; i++) {
          const a0 = (i * Math.PI) / 6,
            a1 = ((i + 1) * Math.PI) / 6;
          line([cx + r * Math.cos(a0), cy + r * Math.sin(a0), z], [cx + r * Math.cos(a1), cy + r * Math.sin(a1), z]);
        }
      };
      if (trunk.radius > 0) {
        ring(t.z, trunk.radius);
        ring(trunk.top, trunk.radius);
        for (let i = 0; i < 4; i++) {
          const a0 = (i * Math.PI) / 2;
          line(
            [t.x + trunk.radius * Math.cos(a0), t.y + trunk.radius * Math.sin(a0), t.z],
            [t.x + trunk.radius * Math.cos(a0), t.y + trunk.radius * Math.sin(a0), trunk.top],
          );
        }
      }
      // the crown's outline: its widest ring, and its top
      const r = k.width * t.radius;
      ring(t.z + k.crown * t.height, r);
      line([t.x, t.y, t.z + (k.cone ? k.crown * t.height : (k.crown - k.depth) * t.height)], [t.x, t.y, t.z + t.height]);
    }
    for (const b of bases) {
      if (lines.length >= maxSegments * 6) break;
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
    return { vertices: new Float32Array(lines), trees, buildings, truncated: lines.length >= maxSegments * 6 };
  }
  /** Capsule occupancy and highest reachable support: preserves polygon holes and bridge undersides. */
  at(q: Vec3, radius = 0.3, height = 1.8, step = 0.25) {
    const p = this.local(q);
    let blocked = false,
      support = -Infinity;
    // the trunks (vertical cylinders) and the crowns that come down to the ground (shrubs, mangroves)
    for (const t of this.trees(p, radius + 1)) {
      const trunk = trunkOf(t);
      const r = trunk.radius + radius;
      if (trunk.radius > 0 && (p[0] - t.x) ** 2 + (p[1] - t.y) ** 2 < r * r && p[2] < trunk.top && p[2] + height > t.z) blocked = true;
      if (t.kind === ForestKind.shrub) {
        // (its plain dome, as drawn from afar: the leaves' carving on average)
        const crown = crownOf(t);
        const rx = crown.r[0],
          rz = crown.r[2],
          cz = crown.c[2];
        // (the capsule's axis point nearest the dome's centre, inside the dome grown by the capsule's radius)
        const z = Math.max(p[2] + radius, Math.min(p[2] + height - radius, cz));
        if (((p[0] - t.x) / (rx + radius)) ** 2 + ((p[1] - t.y) / (rx + radius)) ** 2 + ((z - cz) / (rz + radius)) ** 2 < 1) blocked = true;
      }
      if (blocked) break;
    }
    this.visit(p, radius, false, (b) => {
      const f = this.f;
      if (this.polygon(p, b, radius)) {
        const bottom = f[b]!,
          top = f[b + 1]!;
        if (top <= p[2] + step && top >= p[2] - 2) support = Math.max(support, top - p[2]);
        else if (bottom < p[2] + height - 0.02 && top > p[2] + 0.02) blocked = true;
      }
    });
    return { blocked, support };
  }
}

/** The scenery the game stands in now (main.ts sets it: the Earth's near the camera, when drawn), for what is not
 *  the walker's — a tripod's stand. */
let current: () => SceneryContact | null = () => null;
export function setSceneryContact(f: () => SceneryContact | null) {
  current = f;
}
export const sceneryContact = () => current();

/**
 * A stand clear of what is there — `free(p)`: a person can stand at p (no building, no tree, no craft parked) —:
 * the feet [m, body-fixed] themselves if free, else the nearest free place in rings of `step` metres out to `reach`
 * along the ground (`ground`: a point set down on it), or null — none (a city block wider than the reach).
 * A tripod set by its coordinates in a city stood inside a building, or by the craft it came in, in its hull.
 */
export function clearStand(
  free: (p: Vec3) => boolean,
  feet: Vec3,
  up: Vec3,
  ground: (p: Vec3) => Vec3,
  o: { reach?: number; step?: number } = {},
): Vec3 | null {
  if (free(feet)) return feet;
  // (the ground's own two directions there)
  const ref: Vec3 = Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const k = dot(ref, up);
  const n0 = [ref[0] - k * up[0], ref[1] - k * up[1], ref[2] - k * up[2]];
  const nl = Math.hypot(n0[0]!, n0[1]!, n0[2]!) || 1;
  const north: Vec3 = [n0[0]! / nl, n0[1]! / nl, n0[2]! / nl];
  const east: Vec3 = [north[1] * up[2] - north[2] * up[1], north[2] * up[0] - north[0] * up[2], north[0] * up[1] - north[1] * up[0]];
  const reach = o.reach ?? 250,
    step = o.step ?? 2;
  for (let r = step; r <= reach; r += step) {
    // (a sample every ~2 m round the ring)
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / 2));
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const ca = Math.cos(a) * r,
        sa = Math.sin(a) * r;
      const p = ground([
        feet[0] + north[0] * ca + east[0] * sa,
        feet[1] + north[1] * ca + east[1] * sa,
        feet[2] + north[2] * ca + east[2] * sa,
      ]);
      if (free(p)) return p;
    }
  }
  return null;
}
