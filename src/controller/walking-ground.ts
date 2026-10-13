// A small shared heightfield closes the CPU/float32 terrain gap at human scale.
// Published atomically after a bounded build; both contacts and the tracer sample these same metres.
import type { Vec3 } from "../physics";
import { add, cross, dot, sub, unit } from "../math/vec3";
export const WALK_GRID = 65;
export const WALK_VEC4S = Math.ceil((WALK_GRID * WALK_GRID) / 4);
export class WalkingGround {
  origin: Vec3 = [0, 0, 0];
  right: Vec3 = [1, 0, 0];
  up: Vec3 = [0, 1, 0];
  forward: Vec3 = [0, 0, 1];
  values = new Float32Array(WALK_VEC4S * 4);
  stamp = 0;
  size = 17;
  step = 4;
  ready = false;
  cpuMs = 0;
  private pending: {
    revision: number;
    origin: Vec3;
    right: Vec3;
    up: Vec3;
    forward: Vec3;
    values: Float32Array<ArrayBuffer>;
    cursor: number;
  } | null = null;
  private revision = -1;
  private sampleHeight(q: Vec3, raw: (q: Vec3) => number, up: Vec3, origin: Vec3) {
    return dot(sub(q, origin), up) - raw(q);
  }
  build(q: Vec3, up: Vec3, raw: (q: Vec3) => number, revision: number) {
    const distance = dot(sub(q, this.origin), this.right) ** 2 + dot(sub(q, this.origin), this.forward) ** 2;
    if (this.ready && revision === this.revision && distance < 64 && !this.pending) return;
    const begin = performance.now();
    // (new ground data while a grid is made: that one finished first, then made again — tiles streaming in must
    // not keep a grid from ever coming out)
    if (!this.ready || (!this.pending && (revision !== this.revision || distance >= 64))) {
      if (!this.ready) this.revision = revision;
      const right = unit(cross(Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], up));
      // (the first patch only: a coarse 4 m grid at once; afterwards the fine grid in use stays — it covers
      // ±32 m, the astronaut 8 m from its middle — until its successor is published whole)
      if (!this.ready) {
        this.origin = [...q];
        this.up = [...up];
        this.right = right;
        this.forward = cross(up, right);
        this.size = 17;
        this.step = 4;
        for (let y = 0; y < 17; y++)
          for (let x = 0; x < 17; x++) {
            const p = add(add(q, this.right, x * 4 - 32), this.forward, y * 4 - 32);
            this.values[y * 17 + x] = this.sampleHeight(p, raw, up, q);
          }
        this.ready = true;
        this.stamp++;
      }
      this.pending = {
        revision,
        origin: [...q],
        right,
        up: [...up],
        forward: cross(up, right),
        values: new Float32Array(WALK_VEC4S * 4),
        cursor: 0,
      };
    }
    const p = this.pending;
    if (p) {
      while (p.cursor < WALK_GRID ** 2 && performance.now() - begin < 1) {
        const i = p.cursor++,
          x = (i % WALK_GRID) - 32,
          y = Math.floor(i / WALK_GRID) - 32;
        const point = add(add(p.origin, p.right, x), p.forward, y);
        p.values[i] = this.sampleHeight(point, raw, p.up, p.origin);
      }
      if (p.cursor === WALK_GRID ** 2) {
        this.revision = p.revision;
        this.origin = p.origin;
        this.right = p.right;
        this.up = p.up;
        this.forward = p.forward;
        this.values = p.values;
        this.size = WALK_GRID;
        this.step = 1;
        this.pending = null;
        this.stamp++;
      }
    }
    this.cpuMs = performance.now() - begin;
  }
  sample(q: Vec3): number | null {
    if (!this.ready) return null;
    const d = sub(q, this.origin),
      x = (dot(d, this.right) + 32) / this.step,
      y = (dot(d, this.forward) + 32) / this.step;
    if (x < 0 || y < 0 || x > this.size - 1 || y > this.size - 1) return null;
    const ix = Math.min(Math.floor(x), this.size - 2),
      iy = Math.min(Math.floor(y), this.size - 2),
      fx = x - ix,
      fy = y - iy;
    const a = this.values[iy * this.size + ix]!,
      b = this.values[iy * this.size + ix + 1]!,
      c = this.values[(iy + 1) * this.size + ix]!,
      e = this.values[(iy + 1) * this.size + ix + 1]!;
    return dot(d, this.up) - ((a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy);
  }
  clear() {
    this.ready = false;
    this.pending = null;
    this.revision = -1;
    this.stamp++;
  }
}
