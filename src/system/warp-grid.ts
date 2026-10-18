// The mountains' warp, precomputed round the camera (trace.wgsl earthWarp). The Earth's ridged relief (earthDetail)
// is drawn on a lattice moved by a smooth field — 0.7 × three two-octave gradient noises of the geodetic direction ×
// 600, wavelengths of ~10 and 5 km —: six noises at every height a ray reads (its march's steps, the crossing, the
// normal's three, the relief's shadows), a third of the trace over the Andes (measured: the warp off −30 %).
//
// The field is smooth: read bilinearly from its values on a grid of nodes it is within 1e-5 of itself where the
// nodes are 19 m apart. So it is worked out on nodes fixed on the Earth — longitude and latitude in whole steps,
// the same nodes wherever the camera is: a point's value never depends on where the grid stands, nothing pops when
// it follows the camera — at three levels round the camera, 512 nodes a side each (19, 76, 306 m: ±4.9, ±20 and
// ±78 km; the crests moved by 3 cm, 0.4 m and 6 m there at most — tests/warp-grid.test.ts —, under a pixel at their
// distances), each level
// blended into the next towards its window's edge, the field worked out beyond them and near the poles. A level is
// worked out again (a compute pass, a fraction of a millisecond) only when the camera has gone 64 nodes from its
// window's centre. The physics keeps the field itself (terrain.ts earthDetail): the drawn ground and the felt one
// a few centimetres apart round the camera.
//
// The pass's noise is the tracer's own: its functions are taken from trace.wgsl's source (warpShader), not copied.

/** nodes a side of a level's window */
export const WARP_N = 512;
export const WARP_LEVELS = 3;
/** a level's nodes round a parallel of latitude (19.1, 76.4, 305.7 m apart at the equator) */
export const WARP_ROUND = [2 ** 21, 2 ** 19, 2 ** 17] as const;
/** the camera's distance from its window's centre [nodes] past which a level is worked out again round it */
export const WARP_RECENTRE = 64;
/** no grids above this latitude [rad] (the longitude's nodes crowd together): the field worked out there */
export const WARP_LAT_MAX = (75 * Math.PI) / 180;

/** A level's window: its first node's indices (longitude, latitude), in whole steps of 2π / WARP_ROUND[k]. */
export interface WarpWindow {
  i0: number;
  j0: number;
}

/**
 * The windows for the camera at (lon, lat) [rad, geodetic]: each level kept while the camera stays within
 * WARP_RECENTRE nodes of its centre, else centred on it (dirty: to be worked out); none near the poles. The
 * tracer's params (Params.warp): the reference (cos, sin of the longitude, sin, cos of the latitude), then each
 * level's (the camera on its window [nodes: east, north], nodes a radian, on).
 */
export function warpWindows(
  prev: (WarpWindow | null)[],
  lon: number,
  lat: number,
): { windows: (WarpWindow | null)[]; dirty: number[]; params: Float32Array<ArrayBuffer> } {
  const params = new Float32Array(16);
  const windows: (WarpWindow | null)[] = [];
  const dirty: number[] = [];
  params.set([Math.cos(lon), Math.sin(lon), Math.sin(lat), Math.cos(lat)], 0);
  for (let k = 0; k < WARP_LEVELS; k++) {
    if (Math.abs(lat) > WARP_LAT_MAX || !Number.isFinite(lon + lat)) {
      windows.push(null);
      continue;
    }
    const perRad = WARP_ROUND[k]! / (2 * Math.PI);
    const x = lon * perRad;
    const y = lat * perRad;
    let w = prev[k] ?? null;
    if (!w || Math.abs(x - (w.i0 + WARP_N / 2)) > WARP_RECENTRE || Math.abs(y - (w.j0 + WARP_N / 2)) > WARP_RECENTRE) {
      w = { i0: Math.floor(x) - WARP_N / 2, j0: Math.floor(y) - WARP_N / 2 };
      dirty.push(k);
    }
    windows.push(w);
    params.set([x - w.i0, y - w.j0, perRad, 1], 4 + 4 * k);
  }
  return { windows, dirty, params };
}

/** A function's whole source (`fn name(` … its closing brace) from a WGSL module. */
export function wgslFunction(src: string, name: string): string {
  const at = src.search(new RegExp(`\\nfn ${name}\\(`));
  if (at < 0) throw new Error(`warp-grid: fn ${name} not in the tracer`);
  let i = src.indexOf("{", at);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at + 1, i + 1);
}

/** The pass that works a level out: the tracer's noise (pcg, gGrad, gnoise, tfbm, earthWarpExact) and its own entry. */
export function warpShader(trace: string): string {
  const fns = ["pcg", "gGrad", "gnoise", "tfbm", "earthWarpExact"].map((n) => wgslFunction(trace, n)).join("\n");
  return `// (system/warp-grid.ts: the mountains' warp on a level's nodes — the tracer's functions below, taken from its source)
fn cost(k: u32) {}
${fns}
struct WarpU {
  origin: vec4f,  // the reference: cos, sin of its longitude, sin, cos of its latitude
  lv: vec4f,      // the level's: the reference on its window [nodes: east, north], nodes a radian, its first vec4
};
@group(0) @binding(0) var<storage, read_write> table: array<vec4f>;
@group(0) @binding(1) var<uniform> U: WarpU;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${WARP_N}u || gid.y >= ${WARP_N}u) { return; }
  // (the node's longitude and latitude from the reference's — small angles: no float32 cancellation —, its direction
  // by the angles' sums)
  let d = (vec2f(gid.xy) - U.lv.xy) / U.lv.z;
  let cl = cos(d.y);
  let sl = sin(d.y);
  let sinLat = U.origin.z * cl + U.origin.w * sl;
  let cosLat = U.origin.w * cl - U.origin.z * sl;
  let co = cos(d.x);
  let so = sin(d.x);
  let q = vec3f(cosLat * (U.origin.x * co - U.origin.y * so), cosLat * (U.origin.y * co + U.origin.x * so), sinLat);
  table[u32(U.lv.w) + gid.y * ${WARP_N}u + gid.x] = vec4f(earthWarpExact(q), 0.0);
}
`;
}

/** The levels' grids in the tracer's table buffer (at TABLE_WARP), kept round the camera. */
export class WarpGrid {
  private pipeline: GPUComputePipeline | null = null;
  private windows: (WarpWindow | null)[] = [null, null, null];
  private uniforms: GPUBuffer[];
  private binds: GPUBindGroup[] = [];
  /** the tracer's params now (Params.warp): all off until a level is worked out */
  params: Float32Array<ArrayBuffer> = new Float32Array(16);
  /** levels worked out (for the readouts and tests) */
  builds = 0;

  constructor(
    private device: GPUDevice,
    table: GPUBuffer,
    private offset: number,
    trace: string,
  ) {
    this.uniforms = Array.from({ length: WARP_LEVELS }, () =>
      device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: "warp level" }),
    );
    void device
      .createComputePipelineAsync({
        layout: "auto",
        compute: { module: device.createShaderModule({ code: warpShader(trace), label: "warp grid" }), entryPoint: "main" },
      })
      .then((p) => {
        this.pipeline = p;
        this.binds = this.uniforms.map((u) =>
          device.createBindGroup({
            layout: p.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: table } },
              { binding: 1, resource: { buffer: u } },
            ],
          }),
        );
      })
      .catch((e) => console.warn("The mountains' warp grid unavailable (worked out by each ray):", e));
  }

  /**
   * The camera at (lon, lat) [rad, geodetic] — or none near the Earth (null) —: the levels kept round it, those it
   * left worked out again (submitted at once: before the frame's passes that read them). Its params after.
   */
  update(at: { lon: number; lat: number } | null) {
    if (!at || !this.pipeline) {
      this.params = new Float32Array(16);
      return;
    }
    const { windows, dirty, params } = warpWindows(this.windows, at.lon, at.lat);
    if (dirty.length) {
      const enc = this.device.createCommandEncoder({ label: "warp grid" });
      const pass = enc.beginComputePass({ label: "warp grid" });
      pass.setPipeline(this.pipeline);
      for (const k of dirty) {
        this.device.queue.writeBuffer(
          this.uniforms[k]!,
          0,
          new Float32Array([
            ...params.subarray(0, 4),
            params[4 + 4 * k]!,
            params[5 + 4 * k]!,
            params[6 + 4 * k]!,
            this.offset + k * WARP_N * WARP_N,
          ]),
        );
        pass.setBindGroup(0, this.binds[k]!);
        pass.dispatchWorkgroups(WARP_N / 8, WARP_N / 8);
        this.builds++;
      }
      pass.end();
      this.device.queue.submit([enc.finish()]);
    }
    this.windows = windows;
    this.params = params;
  }
}
