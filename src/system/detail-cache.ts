// The relief's detail cached round the camera (docs/PLAN-RENDU-RASTER-AAA.md étape 1, the ground's shading): the
// procedural detail under the elevation tiles (trace.wgsl earthDetail — a ridged multifractal warped, hills, rocks: three
// layers of noise) is evaluated at every read of the relief — the raster hint's refinement, the normal, the shadows' steps
// —, 5 to 7 ms of the raster's shading at Tarifa. Its finest wavelengths are ~8 m: a grid of 2 m holds it whole. Here a
// 2048² texture of it, 2 m a texel (±2 km round the camera), on the tangent plane of an epoch's centre (a texel's place:
// its east and north metres from there, dot(q, E)·a, dot(q, N)·a — no absolute float32 longitude), wrapped round
// (toroidal: a texel's slot its global index modulo 2048), so the camera's motion adds strips, never a rebuild.
//
// The kernel detailBuild (trace.wgsl) writes it with the tracer's own functions (earthH, earthDetail); earthDetail reads it
// back — four texels, bilinear — wherever its footprint is fine enough and the texel is valid, else evaluates as before.
// The elevation tiles' arrivals refresh it in place, band by band.

import { TABLE_DETAIL } from "../gpu-tables";
import { WGS84_A } from "./ellipsoid";

export const DETAIL_CACHE_N = 2048;
/** a texel's side [m] */
export const DETAIL_CACHE_M = 2;
export const DETAIL_CACHE_BINDING = 36;
/** sampled textures per stage with the cache's (the raster hint's 22 and one) */
export const DETAIL_CACHE_TEXTURE_LIMIT = 23;
/** its table entries [vec4s]: (q0, on), (E, M), (N, a), the valid rectangle of global indices (i0, j0, i1, j1) */
export const DETAIL_CACHE_VEC4S = 4;
/** rows (or columns) computed a frame at most: a band of 2048 × 128 texels (≈ 0.3 ms on an M1 Max) */
const BAND = 128;
/** a new epoch (tangent plane) once the camera is this far from its centre [m] */
const EPOCH_M = 20_000;

/** The tracer with the cache's lookup in place of its stub (where the device takes one more sampled texture). */
export function withDetailCache(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_DETAIL_CACHE[\s\S]*?\/\/ END_DETAIL_CACHE/;
  if (!marker.test(trace)) throw new Error("detail-cache: missing tracer stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${DETAIL_CACHE_BINDING}) var detailTex: texture_2d<f32>;
const DC_OFF = ${TABLE_DETAIL}u;
const DC_N = ${DETAIL_CACHE_N};
// The relief's cached detail at a geodetic direction q (x) and whether it was there (y: 0 — off, out of the window, or the
// kernel that writes it): bilinear between the four texels round its place on the epoch's tangent plane.
fn detailCacheRead(q: vec3f) -> vec2f {
  if (!HAS_DETAIL_CACHE || DC_BYPASS) { return vec2f(0.0); }
  let c0 = bodies[DC_OFF];
  if (c0.w < 0.5) { return vec2f(0.0); }
  let e = bodies[DC_OFF + 1u]; let n = bodies[DC_OFF + 2u]; let r = bodies[DC_OFF + 3u];
  let k = n.w / e.w;
  let x = dot(q, e.xyz) * k - 0.5; let y = dot(q, n.xyz) * k - 0.5;
  let i0 = floor(x); let j0 = floor(y);
  if (i0 < r.x || j0 < r.y || i0 + 1.0 >= r.z || j0 + 1.0 >= r.w) { return vec2f(0.0); }
  let f = vec2f(x - i0, y - j0);
  let a = (vec2i(i32(i0), i32(j0)) % DC_N + DC_N) % DC_N;
  let b = (a + vec2i(1)) % DC_N;
  let v00 = textureLoad(detailTex, a, 0).r; let v10 = textureLoad(detailTex, vec2i(b.x, a.y), 0).r;
  let v01 = textureLoad(detailTex, vec2i(a.x, b.y), 0).r; let v11 = textureLoad(detailTex, b, 0).r;
  return vec2f(mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y), 1.0);
}`,
  );
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** a geodetic latitude, longitude's unit normal and its east, north axes (Earth-fixed) */
function frameAt(lat: number, lon: number): { q: V3; e: V3; n: V3 } {
  const cl = Math.cos(lat),
    sl = Math.sin(lat),
    co = Math.cos(lon),
    so = Math.sin(lon);
  return { q: [cl * co, cl * so, sl], e: [-so, co, 0], n: [-sl * co, -sl * so, cl] };
}

interface Rect {
  i0: number;
  j0: number;
  w: number;
  h: number;
}

export class DetailCache {
  readonly texture: GPUTexture;
  /** a 1 × 1 stand-in, bound where the cache itself is written (it cannot be read in the same dispatch) */
  readonly dummy: GPUTexture;
  readonly writeLayout: GPUBindGroupLayout;
  private rectBufs: GPUBuffer[];
  private rectBinds: GPUBindGroup[];
  private epoch: { q: V3; e: V3; n: V3 } | null = null;
  /** the valid rectangle (global indices, half open) and the window's centre */
  private valid = { i0: 0, j0: 0, i1: 0, j1: 0 };
  private centre = { i: 0, j: 0 };
  /** the elevation tiles' state the texels were made with; a refresh sweep's next row band */
  private tiles = "";
  private sweep = -1;
  private table = new Float32Array(DETAIL_CACHE_VEC4S * 4);
  /** texels written so far, and the last frame's */
  texels = 0;
  lastTexels = 0;

  constructor(private device: GPUDevice) {
    const N = DETAIL_CACHE_N;
    this.texture = device.createTexture({
      label: "relief detail cache",
      size: [N, N],
      format: "r32float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.dummy = device.createTexture({
      label: "relief detail cache: none",
      size: [1, 1],
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    const C = GPUShaderStage.COMPUTE;
    this.writeLayout = device.createBindGroupLayout({
      label: "relief detail cache write",
      entries: [
        { binding: 9, visibility: C, storageTexture: { access: "write-only", format: "r32float" } },
        { binding: 10, visibility: C, buffer: { type: "uniform" } },
      ],
    });
    // (two rectangles a frame at most: a strip across, a strip down — or a band of a fill or a refresh)
    this.rectBufs = [0, 1].map(() => device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.rectBinds = this.rectBufs.map((b) =>
      device.createBindGroup({
        layout: this.writeLayout,
        entries: [
          { binding: 9, resource: this.texture.createView() },
          { binding: 10, resource: { buffer: b } },
        ],
      }),
    );
  }

  /**
   * The rectangles to write this frame for the camera over (lat, lon) [rad, geodetic] and the elevation tiles' state, and
   * the table's entries (written by the caller into the tracer's table at TABLE_DETAIL). None: the cache off (the caller's
   * table entries then say so).
   */
  plan(lat: number, lon: number, tiles: string): Rect[] {
    const N = DETAIL_CACHE_N,
      M = DETAIL_CACHE_M;
    const here = frameAt(lat, lon);
    const rects: Rect[] = [];
    let fresh = !this.epoch;
    if (this.epoch) {
      const d = Math.acos(Math.min(1, dot(here.q, this.epoch.q))) * WGS84_A;
      if (d > EPOCH_M) fresh = true;
    }
    if (fresh) {
      this.epoch = frameAt(lat, lon);
      this.valid = { i0: 0, j0: 0, i1: 0, j1: 0 };
      this.sweep = -1;
    }
    const ep = this.epoch!;
    // (the camera's ground on the epoch's tangent plane, in texels)
    const ci = Math.floor((dot(here.q, ep.e) * WGS84_A) / M);
    const cj = Math.floor((dot(here.q, ep.n) * WGS84_A) / M);
    const v = this.valid;
    const full = v.i1 - v.i0 === N && v.j1 - v.j0 === N;
    if (!full) {
      // (filling: the window round the centre where it began, a band of rows a frame — from its middle out, alternately
      // below and above; the camera gone a quarter of the window from it: begun again round where it is now)
      if (v.j1 <= v.j0 || Math.abs(ci - this.centre.i) > N / 4 || Math.abs(cj - this.centre.j) > N / 4) {
        this.centre = { i: ci, j: cj };
        this.valid = { i0: ci - N / 2, j0: cj, i1: ci + N / 2, j1: cj };
      }
      const w = this.valid;
      const below = w.j0 - (this.centre.j - N / 2);
      const above = this.centre.j + N / 2 - w.j1;
      if (above >= below && above > 0) {
        const h = Math.min(BAND, above);
        rects.push({ i0: w.i0, j0: w.j1, w: N, h });
        w.j1 += h;
      } else if (below > 0) {
        const h = Math.min(BAND, below);
        rects.push({ i0: w.i0, j0: w.j0 - h, w: N, h });
        w.j0 -= h;
      }
    } else {
      // (full: the window led after the camera — the columns and rows it moves into written over the ones it leaves)
      const di = ci - this.centre.i,
        dj = cj - this.centre.j;
      if (Math.abs(di) > N / 4 || Math.abs(dj) > N / 4) {
        this.valid = { i0: 0, j0: 0, i1: 0, j1: 0 };
        return this.plan(lat, lon, tiles);
      }
      const si = Math.max(-BAND, Math.min(BAND, di)),
        sj = Math.max(-BAND, Math.min(BAND, dj));
      if (si !== 0) {
        rects.push(si > 0 ? { i0: v.i1, j0: v.j0, w: si, h: N } : { i0: v.i0 + si, j0: v.j0, w: -si, h: N });
        v.i0 += si;
        v.i1 += si;
        this.centre.i += si;
      }
      if (sj !== 0) {
        rects.push(sj > 0 ? { i0: v.i0, j0: v.j1, w: N, h: sj } : { i0: v.i0, j0: v.j0 + sj, w: N, h: -sj });
        v.j0 += sj;
        v.j1 += sj;
        this.centre.j += sj;
      }
      // (the tiles changed — finer heights arrived: their detail fades — the window written again in place, band by band)
      if (tiles !== this.tiles) {
        this.tiles = tiles;
        this.sweep = v.j0;
      }
      if (this.sweep >= 0 && rects.length < 2) {
        const h = Math.min(BAND, v.j1 - this.sweep);
        if (h > 0) rects.push({ i0: v.i0, j0: this.sweep, w: N, h });
        this.sweep = h > 0 && this.sweep + h < v.j1 ? this.sweep + h : -1;
      }
    }
    if (!full) this.tiles = tiles;
    const t = this.table;
    t.set([...ep.q, this.valid.j1 > this.valid.j0 ? 1 : 0], 0);
    t.set([...ep.e, M], 4);
    t.set([...ep.n, WGS84_A], 8);
    t.set([this.valid.i0, this.valid.j0, this.valid.i1, this.valid.j1], 12);
    return rects.slice(0, 2);
  }

  /** the table's entries for the tracer (TABLE_DETAIL): written each frame */
  tableEntries(): Float32Array<ArrayBuffer> {
    return this.table;
  }

  /** The planned rectangles written by the kernel detailBuild (bind group 0: the tracer's with the stand-in at 36). */
  encode(enc: GPUCommandEncoder, pipeline: GPUComputePipeline, trace: GPUBindGroup, rects: Rect[], descriptor: GPUComputePassDescriptor) {
    if (!rects.length || !this.epoch) return;
    const ep = this.epoch;
    const pass = enc.beginComputePass(descriptor);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, trace);
    let texels = 0;
    rects.forEach((r, k) => {
      const u = new ArrayBuffer(64);
      new Int32Array(u, 0, 4).set([r.i0, r.j0, r.w, r.h]);
      new Float32Array(u, 16, 12).set([...ep.q, DETAIL_CACHE_M, ...ep.e, WGS84_A, ...ep.n, DETAIL_CACHE_N]);
      this.device.queue.writeBuffer(this.rectBufs[k]!, 0, u);
      pass.setBindGroup(1, this.rectBinds[k]!);
      pass.dispatchWorkgroups(Math.ceil(r.w / 8), Math.ceil(r.h / 8));
      texels += r.w * r.h;
    });
    pass.end();
    this.texels += texels;
    this.lastTexels = texels;
  }

  stats() {
    const v = this.valid;
    return { epoch: !!this.epoch, valid: [v.i0, v.j0, v.i1, v.j1], rows: v.j1 - v.j0, texels: this.texels, lastTexels: this.lastTexels };
  }

  dispose() {
    this.texture.destroy();
    this.dummy.destroy();
    for (const b of this.rectBufs) b.destroy();
  }
}
