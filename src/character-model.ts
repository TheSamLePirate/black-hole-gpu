// The licensed false-earth astronaut in the native renderer. Only joints are evaluated on CPU.
import modelUrl from "../assets/character/astronaut.bin";
import bodyAlbedo from "../assets/character/Body-Albedo.ktx2";
import bodyMetal from "../assets/character/Body-Metallic.ktx2";
import bodyAO from "../assets/character/Body-Ao.ktx2";
import bodyNormal from "../assets/character/Body-Normals.ktx2";
import detailAlbedo from "../assets/character/Details-Albedo.ktx2";
import detailMetal from "../assets/character/Details-Metallic.ktx2";
import detailAO from "../assets/character/Details-Ao.ktx2";
import detailNormal from "../assets/character/Details-Normals.ktx2";
import { ktxLevels, ktxTarget, writeLevels } from "./system/ktx2";
interface Node {
  name: string;
  t: number[];
  r: number[];
  s: number[];
  parent: number;
}
interface Track {
  node: number;
  path: "translation" | "rotation" | "scale";
  times: number[];
  values: number[];
  step: boolean;
}
interface Clip {
  name: string;
  duration: number;
  tracks: Track[];
}
interface Model {
  nodes: Node[];
  joints: number[];
  inverse: number[];
  clips: Clip[];
  nv: number;
  ni: number;
  stride: number;
}
/** Column-major product a·b into out, from offset `at` (an allocation-free composition of the joints). */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>, out: Float32Array, at = 0) {
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let value = 0;
      for (let k = 0; k < 4; k++) value += a[k * 4 + row]! * b[col * 4 + k]!;
      out[at + col * 4 + row] = value;
    }
}
/** The local matrix of the pose stored at pose[at..at+10): translation 0–2, rotation quaternion 3–6, scale 7–9. */
export function composeAt(pose: ArrayLike<number>, out: Float32Array) {
  const x = pose[3]!,
    y = pose[4]!,
    z = pose[5]!,
    w = pose[6]!,
    sx = pose[7]!,
    sy = pose[8]!,
    sz = pose[9]!,
    xx = x * x,
    yy = y * y,
    zz = z * z,
    xy = x * y,
    xz = x * z,
    yz = y * z,
    wx = w * x,
    wy = w * y,
    wz = w * z;
  out[0] = (1 - 2 * (yy + zz)) * sx;
  out[1] = 2 * (xy + wz) * sx;
  out[2] = 2 * (xz - wy) * sx;
  out[3] = 0;
  out[4] = 2 * (xy - wz) * sy;
  out[5] = (1 - 2 * (xx + zz)) * sy;
  out[6] = 2 * (yz + wx) * sy;
  out[7] = 0;
  out[8] = 2 * (xz + wy) * sz;
  out[9] = 2 * (yz - wx) * sz;
  out[10] = (1 - 2 * (xx + yy)) * sz;
  out[11] = 0;
  out[12] = pose[0]!;
  out[13] = pose[1]!;
  out[14] = pose[2]!;
  out[15] = 1;
}
/** Spherical interpolation of the quaternions a[ao..ao+4) and b[bo..bo+4), written at out[at..at+4). Safe when out is a. */
function slerpAt(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, t: number, out: Float32Array, at: number) {
  let cosine = 0;
  for (let i = 0; i < 4; i++) cosine += a[ao + i]! * b[bo + i]!;
  const sign = cosine < 0 ? -1 : 1;
  cosine = Math.min(1, Math.abs(cosine));
  const angle = Math.acos(cosine),
    sine = Math.sin(angle);
  const p = sine > 1e-5 ? Math.sin((1 - t) * angle) / sine : 1 - t,
    q = sine > 1e-5 ? Math.sin(t * angle) / sine : t;
  for (let i = 0; i < 4; i++) out[at + i] = p * a[ao + i]! + sign * q * b[bo + i]!;
}
/** A track sampled at `time` into out[at..at+size): linear for translations and scales, slerp for rotations. */
function value(track: Track, time: number, out: Float32Array, at: number) {
  const size = track.path === "rotation" ? 4 : 3,
    times = track.times,
    values = track.values;
  let lo = 0,
    hi = times.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= time) lo = mid;
    else hi = mid;
  }
  const t = track.step ? 0 : Math.max(0, Math.min(1, (time - times[lo]!) / (times[hi]! - times[lo]! || 1)));
  const a = lo * size,
    b = hi * size;
  if (size === 4) slerpAt(values, a, values, b, t, out, at);
  else for (let i = 0; i < size; i++) out[at + i] = values[a + i]! + (values[b + i]! - values[a + i]!) * t;
}
export class AstronautModel {
  vertices: GPUBuffer | null = null;
  indices: GPUBuffer | null = null;
  count = 0;
  ready = false;
  error: string | null = null;
  bones: GPUBuffer;
  texture: GPUTexture | null = null;
  sampler: GPUSampler;
  meshBytes = 0;
  textureBytes = 0;
  cpuMs = 0;
  private model: Model | null = null;
  private loading: Promise<void> | null = null;
  private pose: Float32Array[] = [];
  private global: Float32Array[] = [];
  private local: Float32Array[] = [];
  private inverse: Float32Array[] = [];
  private mats = new Float32Array(70 * 16);
  private order: number[] = [];
  private sampled: Float32Array[][] = [];
  private lastAge = 0;
  private blend = 0;
  // Each gait clock is integrated: its rate follows the speed, its time never jumps when the speed changes.
  private gait = [0, 0, 0];
  // The rest pose of each node (translation, rotation, scale) and whether it is in place (its root keeps its own motion).
  private rest: Float32Array[] = [];
  private inPlace: boolean[] = [];
  constructor(private d: GPUDevice) {
    this.bones = d.createBuffer({ size: 70 * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.sampler = d.createSampler({
      addressModeU: "repeat",
      addressModeV: "repeat",
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 4,
    });
  }
  load() {
    return (this.loading ??= (async () => {
      try {
        const response = await fetch(modelUrl);
        if (!response.ok) throw new Error(`Astronaut mesh: ${response.status}`);
        const b = await new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(),
          header = new Uint32Array(b, 0, 4);
        if (header[0] !== 0x314e4b53) throw new Error("Invalid astronaut mesh");
        const size = header[1]!,
          m = (this.model = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 16, size))) as Model);
        if (m.joints.length !== 70 || m.nv > 100000 || m.ni > 500000 || m.stride !== 84)
          throw new Error("Astronaut budget/format mismatch");
        const offset = 16 + Math.ceil(size / 4) * 4;
        this.vertices = this.d.createBuffer({ size: m.nv * m.stride, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        this.d.queue.writeBuffer(this.vertices, 0, b, offset, m.nv * m.stride);
        this.indices = this.d.createBuffer({ size: m.ni * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        this.d.queue.writeBuffer(this.indices, 0, b, offset + m.nv * m.stride, m.ni * 4);
        this.count = m.ni;
        this.meshBytes = m.nv * m.stride + m.ni * 4;
        this.rest = m.nodes.map((n) => new Float32Array([...n.t, ...n.r, ...n.s]));
        this.inPlace = m.nodes.map((n) => n.name === "root");
        this.pose = this.rest.map((p) => new Float32Array(p));
        this.sampled = m.clips.map(() => this.pose.map((p) => new Float32Array(p)));
        this.global = m.nodes.map(() => new Float32Array(16));
        this.local = m.nodes.map(() => new Float32Array(16));
        this.inverse = m.joints.map((_, i) => new Float32Array(m.inverse.slice(i * 16, i * 16 + 16)));
        const visit = (i: number) => {
          if (this.order.includes(i)) return;
          const p = m.nodes[i]!.parent;
          if (p >= 0) visit(p);
          this.order.push(i);
        };
        m.nodes.forEach((_, i) => visit(i));
        const target = ktxTarget(this.d);
        const format: GPUTextureFormat = target === "bc7" ? "bc7-rgba-unorm" : target === "astc" ? "astc-4x4-unorm" : "rgba8unorm";
        const urls = [bodyAlbedo, bodyMetal, bodyAO, bodyNormal, detailAlbedo, detailMetal, detailAO, detailNormal];
        // Keep 1K mip chains: the authored 2K sources remain available, residency stays bounded even on RGBA GPUs.
        for (let i = 0; i < urls.length; i++) {
          const image = await ktxLevels(urls[i]!, target);
          const skip = Math.max(0, Math.ceil(Math.log2(Math.max(image.width, image.height) / (target === "rgba" ? 512 : 1024))));
          const w = image.width >> skip,
            h = image.height >> skip,
            levels = image.levels.slice(skip);
          this.texture ??= this.d.createTexture({
            size: [w, h, 8],
            mipLevelCount: levels.length,
            format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          if (w !== this.texture.width || h !== this.texture.height) throw new Error("Astronaut textures must share dimensions");
          writeLevels(this.d, this.texture, levels, w, h, target, i);
          this.textureBytes += levels.reduce((n, l) => n + l.byteLength, 0);
        }
        this.evaluate(0, 0);
        this.ready = true;
      } catch (error) {
        this.error = String(error);
        console.error("Astronaut:", error);
      }
    })());
  }
  /** One frame of the pose: three clips sampled, blended, composed and skinned into the bone matrices. Nothing is
   * allocated here: the arrays of the model are reused, the samples written in place. */
  evaluate(age: number, speed: number) {
    if (!this.model) return;
    const began = performance.now(),
      m = this.model,
      n = m.nodes.length,
      dt = Math.max(0, Math.min(0.1, age - this.lastAge));
    this.lastAge = age;
    this.blend += (Math.min(1, speed / 1.4) - this.blend) * (1 - Math.exp(-dt * 12));
    this.gait[1]! += dt * Math.max(0.5, speed / 1.4);
    this.gait[2]! += dt * Math.max(0.5, speed / 3.5);
    const run = Math.max(0, Math.min(1, (speed - 1.4) / 2.6));
    const w0 = 1 - this.blend,
      w1 = this.blend * (1 - run),
      w2 = this.blend * run;
    for (let k = 0; k < 3; k++) {
      const clip = m.clips[k]!,
        poses = this.sampled[k]!;
      for (let i = 0; i < n; i++) poses[i]!.set(this.rest[i]!);
      const time = (((k === 0 ? age : this.gait[k]!) % clip.duration) + clip.duration) % clip.duration;
      for (const t of clip.tracks) value(t, time, poses[t.node]!, t.path === "translation" ? 0 : t.path === "rotation" ? 3 : 7);
    }
    for (let i = 0; i < n; i++) {
      const out = this.pose[i]!,
        a = this.sampled[0]![i]!,
        b = this.sampled[1]![i]!,
        c = this.sampled[2]![i]!;
      for (let j = 0; j < 10; j++) if (j < 3 || j > 6) out[j] = w0 * a[j]! + w1 * b[j]! + w2 * c[j]!;
      slerpAt(a, 3, b, 3, this.blend, out, 3);
      if (run > 0) slerpAt(out, 3, c, 3, run, out, 3);
      // In-place locomotion: root motion belongs to the planetary controller, not the imported clip.
      if (this.inPlace[i]) {
        out[0] = this.rest[i]![0]!;
        out[1] = this.rest[i]![1]!;
      }
      composeAt(out, this.local[i]!);
    }
    for (const i of this.order) {
      const parent = m.nodes[i]!.parent;
      if (parent < 0) this.global[i]!.set(this.local[i]!);
      else multiply(this.global[parent]!, this.local[i]!, this.global[i]!);
    }
    for (let i = 0; i < m.joints.length; i++) multiply(this.global[m.joints[i]!]!, this.inverse[i]!, this.mats, i * 16);
    this.d.queue.writeBuffer(this.bones, 0, this.mats);
    this.cpuMs = performance.now() - began;
  }
  stats() {
    return {
      model: "false-earth astronaut",
      ready: this.ready,
      error: this.error,
      triangles: this.count / 3,
      joints: 70,
      meshBytes: this.meshBytes,
      textureBytes: this.textureBytes,
      cpuMs: this.cpuMs,
    };
  }
}
