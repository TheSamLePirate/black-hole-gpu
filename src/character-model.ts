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
import { jointAt, rotateAbout, rotationBetween, solveKnee } from "./character-ik";
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
/** the clips' authored paces [m/s] and the run clip's phase against the walk's (its left foot down 0.016 earlier) */
const WALK_SPEED = 1.4,
  RUN_SPEED = 3.5,
  RUN_PHASE = 0.016;
const sub3 = (a: number[], b: number[]): [number, number, number] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
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
  // The gait's one phase (cycles), integrated: its rate follows the speed, never jumping when the speed changes;
  // the walk and the run read it together — their feet in step while they blend (both clips plant the left foot
  // at 0.45 of their cycle, measured on the asset: RUN_PHASE the remainder).
  private stride = 0;
  private gait = [0, 0, 0];
  private turn = new Float32Array(4);
  /** off the ground, eased (0 standing … 1 in the air): the stride held, as a leap */
  private air = 0;
  // The rest pose of each node (translation, rotation, scale) and whether it is in place (its root keeps its own motion).
  private rest: Float32Array[] = [];
  private inPlace: boolean[] = [];
  /** the legs (thigh, calf, foot nodes) and the nodes under each calf, in order: the feet's IK */
  private legs: { thigh: number; calf: number; foot: number; below: number[] }[] = [];
  /** how far the body is lowered for the lower foot to reach its ground on a slope [m, ≤ 0], eased */
  footDrop = 0;
  /** each foot's lift by its IK this frame [m] (left, right) */
  readonly footLift = [0, 0];
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
          m = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 16, size))) as Model;
        if (m.joints.length !== 70 || m.nv > 100000 || m.ni > 500000 || m.stride !== 84)
          throw new Error("Astronaut budget/format mismatch");
        const offset = 16 + Math.ceil(size / 4) * 4;
        this.vertices = this.d.createBuffer({ size: m.nv * m.stride, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        this.d.queue.writeBuffer(this.vertices, 0, b, offset, m.nv * m.stride);
        this.indices = this.d.createBuffer({ size: m.ni * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        this.d.queue.writeBuffer(this.indices, 0, b, offset + m.nv * m.stride, m.ni * 4);
        this.count = m.ni;
        this.meshBytes = m.nv * m.stride + m.ni * 4;
        this.prepare(m);
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
  /** The skeleton's working arrays, once: the rest pose, the nodes' order, the legs for the feet's IK. */
  private prepare(m: Model) {
    this.model = m;
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
    const at = (name: string) => m.nodes.findIndex((n) => n.name === name);
    const under = (i: number, ancestor: number): boolean => {
      const p = m.nodes[i]!.parent;
      return p === ancestor || (p >= 0 && under(p, ancestor));
    };
    this.legs = ["l", "r"]
      .map((side) => ({ thigh: at(`thigh_${side}`), calf: at(`calf_${side}`), foot: at(`foot_${side}`), below: [] as number[] }))
      .filter((leg) => leg.thigh >= 0 && leg.calf >= 0 && leg.foot >= 0);
    for (const leg of this.legs) leg.below = this.order.filter((i) => under(i, leg.calf));
  }
  /** One frame of the pose: three clips sampled, blended, composed and skinned into the bone matrices, the feet
   *  placed on the ground (placeFeet). The clips' arrays are reused, the samples written in place; the feet's IK
   *  allocates a few small vectors a frame (two legs). */
  evaluate(age: number, speed: number, airborne = false, ground: ((x: number, z: number) => number) | null = null) {
    if (!this.model) return;
    const began = performance.now(),
      m = this.model,
      n = m.nodes.length,
      dt = Math.max(0, Math.min(0.1, age - this.lastAge));
    this.lastAge = age;
    // (in the air the legs stop cycling: the stride is held — a standing jump takes a running one's, a leap)
    this.air += ((airborne ? 1 : 0) - this.air) * (1 - Math.exp(-dt * (airborne ? 10 : 16)));
    const stepping = 1 - this.air;
    this.blend += (Math.max(Math.min(1, speed / 1.4), this.air) - this.blend) * (1 - Math.exp(-dt * 12));
    const run = Math.max(Math.max(0, Math.min(1, (speed - 1.4) / 2.6)), 0.6 * this.air);
    const walkClip = m.clips[1]!.duration,
      runClip = m.clips[2]!.duration;
    // (a cycle's length on the ground: the walk's at 1.4 m/s, the run's at 3.5 m/s, blended; slow, a shuffle)
    const cycleM = WALK_SPEED * walkClip + (RUN_SPEED * runClip - WALK_SPEED * walkClip) * run;
    this.stride += dt * Math.max(0.47, speed / cycleM) * stepping;
    this.gait[1] = this.stride * walkClip;
    this.gait[2] = (this.stride + RUN_PHASE) * runClip;
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
      // (as the translations: idle ↔ (walk ↔ run by run) by blend)
      slerpAt(b, 3, c, 3, run, this.turn, 0);
      slerpAt(a, 3, this.turn, 0, this.blend, out, 3);
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
    this.placeFeet(ground, dt);
    for (let i = 0; i < m.joints.length; i++) multiply(this.global[m.joints[i]!]!, this.inverse[i]!, this.mats, i * 16);
    this.d.queue.writeBuffer(this.bones, 0, this.mats);
    this.cpuMs = performance.now() - began;
  }
  /**
   * The feet on the ground under them (ground: its height at a model-space x, z [m] over the ground under the
   * astronaut, null in the air): the body lowered for the lower foot (eased), each leg bent by its two bones for
   * its ankle to rise by its ground's height there, the knee in its own plane, the foot as the clip holds it.
   */
  private placeFeet(ground: ((x: number, z: number) => number) | null, dt: number) {
    const rises = this.legs.map((leg) => {
      if (!ground) return 0;
      const a = jointAt(this.global[leg.foot]!),
        r = ground(a[0], a[2]);
      // (beyond a step — an edge, a wall's foot —: the foot left as the clip has it)
      return Number.isFinite(r) && Math.abs(r) <= 0.35 ? r : 0;
    });
    const want = Math.max(-0.35, Math.min(0, ...rises));
    this.footDrop += (want - this.footDrop) * (1 - Math.exp(-dt * 12));
    const parent = (i: number) => this.model!.nodes[i]!.parent;
    const recompose = (nodes: number[]) => {
      for (const i of nodes) multiply(this.global[parent(i)]!, this.local[i]!, this.global[i]!);
    };
    this.legs.forEach((leg, k) => {
      const lift = ground ? rises[k]! - this.footDrop : 0;
      this.footLift[k] = lift;
      if (Math.abs(lift) < 0.002) return;
      const hip = jointAt(this.global[leg.thigh]!),
        knee = jointAt(this.global[leg.calf]!),
        ankle = jointAt(this.global[leg.foot]!);
      const target: [number, number, number] = [ankle[0], ankle[1] + lift, ankle[2]];
      const bent = solveKnee(hip, knee, ankle, target);
      // (the thigh turned about the hip onto the new knee, the calf following; then the calf about the knee onto the target)
      rotateAbout(this.global[leg.thigh]!, hip, rotationBetween(sub3(knee, hip), sub3(bent, hip)));
      recompose([leg.calf, ...leg.below]);
      const k2 = jointAt(this.global[leg.calf]!),
        a2 = jointAt(this.global[leg.foot]!);
      rotateAbout(this.global[leg.calf]!, k2, rotationBetween(sub3(a2, k2), sub3(target, k2)));
      recompose(leg.below);
    });
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
