// Q4 L2a — the ground's ambient occlusion (GTAO-style, horizon-based; docs/PLAN-REFRACTION-HORIZONS.md Q4, decision 41): before
// the raster's shading, from the visibility's exact metric distance of the ground and the buildings (terrainDist's r — never b,
// the trees' proxies: C0-9 as amended), at half the render's resolution. Each half-pixel: its point and normal rebuilt from the
// distances; 6 directions in the image (turned by the pixel and the frame: the image's history averages them), 5 steps each
// within a radius in metres (projected to pixels, bounded); in each direction the horizon's sine over the face's plane (a blocker
// farther than the radius, or nearer the camera than the point by more than the thickness, left out — a ridge against the far
// ground, the terrain's edges); the occlusion the cosine-weighted share left, 1 − sin² of each horizon, averaged. Read by
// shadeLite on the sky's and the bounce's light (rasterAO), never the Sun's. Where the device takes one more sampled texture.

/** sampled textures per stage with the occlusion's (the orthophotos' 31 and one) */
export const GTAO_TEXTURE_LIMIT = 32;
export const GTAO_BINDING = 47;

/** The tracer's reader: its texture and rasterAO(px) — the occlusion at a render pixel (1: none known). */
export function withGtao(trace: string, supported: boolean): string {
  const marker = /\/\/ BEGIN_GTAO[\s\S]*?\/\/ END_GTAO/;
  if (!marker.test(trace)) throw new Error("gtao: missing tracer stub");
  if (!supported) return trace;
  return trace.replace(
    marker,
    `
@group(0) @binding(${GTAO_BINDING}) var gtaoTex: texture_2d<f32>;
// (the half-resolution occlusion at a render pixel: its nearest half-pixel; 1 off it or where none was worked out)
fn rasterAO(px: vec2f) -> f32 {
  let n = vec2i(textureDimensions(gtaoTex));
  let q = vec2i(floor(px * 0.5));
  if (any(q < vec2i(0)) || any(q >= n)) { return 1.0; }
  let a = textureLoad(gtaoTex, q, 0).r;
  return select(1.0, clamp(a, 0.0, 1.0), a > 0.0);
}`,
  );
}

const SHADER = /* wgsl */ `
struct U {
  // the render's size [px], the vertical half-field's tangent, the aspect (width over height)
  size: vec4f,
  // the radius [m], the thickness [m], the frame (the directions' turn), the strength (0: none)
  k: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var dist: texture_2d<f32>;
@group(0) @binding(2) var outAO: texture_storage_2d<r32float, write>;

// a render pixel's point in the camera's frame (x right, y up, z forward) [m]; z ≤ 0: none (the sky, a tree's proxy)
fn pointAt(px: vec2i) -> vec3f {
  let s = vec2i(u.size.xy);
  if (any(px < vec2i(0)) || any(px >= s)) { return vec3f(0.0); }
  let d = textureLoad(dist, px, 0).r;
  if (d <= 0.0 || d > 1e7) { return vec3f(0.0); }
  let ndc = vec2f(2.0 * (f32(px.x) + 0.5) / u.size.x - 1.0, 1.0 - 2.0 * (f32(px.y) + 0.5) / u.size.y);
  return normalize(vec3f(ndc.x * u.size.z * u.size.w, ndc.y * u.size.z, 1.0)) * d;
}
// (interleaved gradient noise — Jimenez —: the directions' turn by the pixel, the frame shifting it)
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }

@compute @workgroup_size(8, 8)
fn gtao(@builtin(global_invocation_id) gid: vec3u) {
  let n = textureDimensions(outAO);
  if (gid.x >= n.x || gid.y >= n.y) { return; }
  let px = vec2i(gid.xy) * 2;
  let P = pointAt(px);
  if (P.z <= 0.0 || u.k.w <= 0.0) { textureStore(outAO, gid.xy, vec4f(1.0)); return; }
  // (the radius in render pixels at the point's distance — under a pixel and a half: nothing to find, nothing more read; at most 96)
  let R = u.k.x;
  let rpx = R / P.z * (0.5 * u.size.y / u.size.z);
  if (rpx < 1.5) { textureStore(outAO, gid.xy, vec4f(1.0)); return; }
  // (the normal from the nearer of each pair of neighbours — not across a silhouette)
  let xa = pointAt(px + vec2i(1, 0));
  let xb = pointAt(px - vec2i(1, 0));
  let ya = pointAt(px + vec2i(0, 1));
  let yb = pointAt(px - vec2i(0, 1));
  let dx = select(P - xb, xa - P, xa.z > 0.0 && (xb.z <= 0.0 || abs(xa.z - P.z) < abs(P.z - xb.z)));
  let dy = select(P - yb, ya - P, ya.z > 0.0 && (yb.z <= 0.0 || abs(ya.z - P.z) < abs(P.z - yb.z)));
  var N = normalize(cross(dy, dx));
  if (dot(N, -P) < 0.0) { N = -N; }
  let span = min(rpx, 96.0);
  let turn = ign(vec2f(gid.xy) + 5.588238 * (u.k.z % 64.0)) * 1.04719755;
  var vis = 0.0;
  for (var k = 0u; k < 6u; k++) {
    let a = turn + f32(k) * 1.04719755;
    let dir = vec2f(cos(a), sin(a));
    var best = 0.0;
    for (var s = 1u; s <= 5u; s++) {
      let t = (f32(s) - 0.5 + 0.5 * ign(vec2f(gid.yx) + f32(s * 7u + k))) / 5.0;
      let q = vec2i(round(vec2f(px) + dir * (t * span)));
      let S = pointAt(q);
      if (S.z <= 0.0) { continue; }
      let v = S - P;
      let l = length(v);
      // (beyond the radius, or a blocker before the point by more than the thickness: no occlusion)
      if (l > R || l < 1e-3 || P.z - S.z > u.k.y) { continue; }
      let sinH = dot(v / l, N);
      best = max(best, sinH * (1.0 - (l / R) * (l / R)));
    }
    vis += 1.0 - best * best;
  }
  let ao = mix(1.0, vis / 6.0, u.k.w);
  textureStore(outAO, gid.xy, vec4f(max(ao, 0.02)));
}`;

/** The occlusion's pass: its pipeline, its uniform; the target's half-resolution texture made by the renderer. */
export class Gtao {
  private pipeline: GPUComputePipeline | null = null;
  private uniform: GPUBuffer;
  private bind: { dist: GPUTexture; out: GPUTexture; group: GPUBindGroup } | null = null;
  error: string | null = null;
  /** the radius [m], the thickness [m], the strength (0…1) */
  radiusM = 4;
  thicknessM = 6;
  strength = 1;
  private frame = 0;

  constructor(private device: GPUDevice) {
    this.uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: "gtao" });
    const module = device.createShaderModule({ label: "gtao", code: SHADER });
    void device
      .createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "gtao" } })
      .then((p) => (this.pipeline = p))
      .catch((e) => (this.error = String(e)));
  }

  get ready() {
    return !!this.pipeline;
  }

  /** The occlusion of this frame from the visibility's distances into `out` (half the render's size); false: not worked out. */
  encode(enc: GPUCommandEncoder, dist: GPUTexture, out: GPUTexture, tanHalfFov: number, pass?: GPUComputePassDescriptor): boolean {
    if (!this.pipeline) return false;
    if (!this.bind || this.bind.dist !== dist || this.bind.out !== out) {
      this.bind = {
        dist,
        out,
        group: this.device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniform } },
            { binding: 1, resource: dist.createView() },
            { binding: 2, resource: out.createView() },
          ],
        }),
      };
    }
    this.frame++;
    this.device.queue.writeBuffer(
      this.uniform,
      0,
      new Float32Array([
        dist.width,
        dist.height,
        tanHalfFov,
        dist.width / dist.height,
        this.radiusM,
        this.thicknessM,
        this.frame,
        this.strength,
      ]),
    );
    const p = enc.beginComputePass(pass);
    p.setPipeline(this.pipeline);
    p.setBindGroup(0, this.bind.group);
    p.dispatchWorkgroups(Math.ceil(out.width / 8), Math.ceil(out.height / 8));
    p.end();
    return true;
  }
}
