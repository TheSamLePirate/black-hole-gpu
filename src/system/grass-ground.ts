// The ground under the grass, on the CPU: a grid of 1 m cells round the astronaut (GRASS_GRID², recentred by
// GRASS_GRID_SNAP steps) in a frame fixed on the body for kilometres — its heights and, per cell, what grows
// there (the kind, from WorldCover and the OSM exclusions) and the satellite's colour. Built in slices of a
// millisecond, the cells already known kept when it recentres, published whole (the GPU never sees a half grid).
// The blades themselves are made on the GPU each frame from it (character.wgsl, the grass section).
import type { Vec3 } from "../physics";
import { add, cross, dot, len, sub, unit } from "../math/vec3";
import { GRASS_GRID, GRASS_GRID_SNAP, vegetationOf } from "../grass-layout";

/** the frame's reach: past it from its origin [m], a new frame (the lattice's floats stay fine, the axes level) */
export const GRASS_FRAME_REACH = 1500;
const HALF = (GRASS_GRID - 1) / 2;

export interface GrassFrame {
  /** its origin [m, body-fixed] and its axes there (right, up, forward: unit) */
  origin: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}
/** What grows at a ground point (null: unknown — no scenery there yet). */
export type VegetationAt = (q: Vec3) => { cover: number; rgb: number } | null;

interface Grid {
  centre: [number, number];
  revision: number;
  heights: Float32Array<ArrayBuffer>;
  cells: Uint32Array<ArrayBuffer>;
}

export class GrassGround {
  frame: GrassFrame | null = null;
  /** the published grid: its centre [m, whole, in the frame], its heights [m along up] and cells (kind << 24 | sRGB) */
  centre: [number, number] = [0, 0];
  heights = new Float32Array(GRASS_GRID * GRASS_GRID);
  cells = new Uint32Array(GRASS_GRID * GRASS_GRID);
  ready = false;
  stamp = 0;
  /** the frame's own count: a new frame (the lattice moved) */
  frameStamp = 0;
  /** cells where something grows, in the published grid */
  vegetated = 0;
  cpuMs = 0;
  private revision = -1;
  private pending: (Grid & { todo: number[]; cursor: number }) | null = null;

  /** q [m, body-fixed] in the frame: (right, up, forward) metres from its origin. */
  local(q: Vec3): Vec3 {
    const f = this.frame!,
      d = sub(q, f.origin);
    return [dot(d, f.right), dot(d, f.up), dot(d, f.forward)];
  }
  /** The frame's point (x, z) on its plane [m, body-fixed]. */
  point(x: number, z: number): Vec3 {
    const f = this.frame!;
    return add(add(f.origin, f.right, x), f.forward, z);
  }

  /**
   * One slice of the work round the astronaut at q (up: the body's there): a new frame far from the last,
   * a grid recentred when he leaves its middle, rebuilt when the ground's data change (revision).
   * raw: a point's height over the ground [m]; vegetation: what grows at a ground point.
   */
  build(q: Vec3, up: Vec3, raw: (p: Vec3) => number, vegetation: VegetationAt, revision: number, budgetMs = 1) {
    const begin = performance.now();
    if (!this.frame || len(sub(q, this.frame.origin)) > GRASS_FRAME_REACH) {
      const right = unit(cross(Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], up));
      this.frame = { origin: [...q], right, up: [...up], forward: cross(up, right) };
      this.frameStamp++;
      this.ready = false;
      this.pending = null;
      this.revision = -1;
    }
    const l = this.local(q);
    const centre: [number, number] = [
      Math.round(l[0] / GRASS_GRID_SNAP) * GRASS_GRID_SNAP,
      Math.round(l[2] / GRASS_GRID_SNAP) * GRASS_GRID_SNAP,
    ];
    const same = (c: [number, number]) => c[0] === centre[0] && c[1] === centre[1];
    if (this.ready && same(this.centre) && revision === this.revision && !this.pending) {
      this.cpuMs = performance.now() - begin;
      return;
    }
    // (new ground data while a grid is made: that one finished first — its data a frame old —, then made again:
    // terrain tiles streaming in for a while must not keep any grid from coming out)
    if (!this.pending || !same(this.pending.centre)) this.start(centre, revision);
    const p = this.pending!;
    const f = this.frame!;
    while (p.cursor < p.todo.length && performance.now() - begin < budgetMs) {
      const i = p.todo[p.cursor++]!;
      const x = p.centre[0] + (i % GRASS_GRID) - HALF,
        z = p.centre[1] + Math.floor(i / GRASS_GRID) - HALF;
      const at = this.point(x, z);
      const h = -raw(at);
      p.heights[i] = h;
      const v = vegetation(add(at, f.up, h));
      p.cells[i] = v ? ((vegetationOf(v.cover) << 24) | (v.rgb & 0xffffff)) >>> 0 : 0;
    }
    if (p.cursor >= p.todo.length) {
      this.heights = p.heights;
      this.cells = p.cells;
      this.centre = p.centre;
      this.revision = p.revision;
      this.pending = null;
      this.ready = true;
      this.vegetated = this.cells.reduce((n, c) => n + (c >>> 24 ? 1 : 0), 0);
      this.stamp++;
    }
    this.cpuMs = performance.now() - begin;
  }
  /** A new grid for centre: the cells the published one already holds copied (same ground data), the rest to do. */
  private start(centre: [number, number], revision: number) {
    const heights = new Float32Array(GRASS_GRID * GRASS_GRID),
      cells = new Uint32Array(GRASS_GRID * GRASS_GRID),
      todo: number[] = [];
    const reuse = this.ready && revision === this.revision;
    const dx = centre[0] - this.centre[0],
      dz = centre[1] - this.centre[1];
    for (let j = 0; j < GRASS_GRID; j++)
      for (let i = 0; i < GRASS_GRID; i++) {
        const k = j * GRASS_GRID + i,
          oi = i + dx,
          oj = j + dz;
        if (reuse && oi >= 0 && oj >= 0 && oi < GRASS_GRID && oj < GRASS_GRID) {
          heights[k] = this.heights[oj * GRASS_GRID + oi]!;
          cells[k] = this.cells[oj * GRASS_GRID + oi]!;
        } else todo.push(k);
      }
    // (nearest the middle first: the ground under the astronaut comes in before the grid's rim)
    todo.sort(
      (a, b) =>
        ((a % GRASS_GRID) - HALF) ** 2 +
        (Math.floor(a / GRASS_GRID) - HALF) ** 2 -
        (((b % GRASS_GRID) - HALF) ** 2 + (Math.floor(b / GRASS_GRID) - HALF) ** 2),
    );
    this.pending = { centre, revision, heights, cells, todo, cursor: 0 };
  }
  /** The work still to do before the next grid is published (0: none). */
  get remaining() {
    return this.pending ? this.pending.todo.length - this.pending.cursor : 0;
  }
  clear() {
    this.frame = null;
    this.pending = null;
    this.ready = false;
    this.revision = -1;
    this.vegetated = 0;
    this.stamp++;
  }
}
