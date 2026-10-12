// The procedural forests' tracer (src/shaders/forest.wgsl) on the browser's own GPU, against its TypeScript
// twin (src/system/forest.ts): a synthetic forest on rolling ground — every kind, every height —, the hash
// bit for bit, then thousands of rays (views, downwards, shadows) traced on the GPU and by brute force on
// the CPU (every tree's exact shape): the first tree and its distance must agree.
//
//   bun scripts/check-forest.ts [--rays 6000] [--png forest.png] [--date 2026-10-15]   (CHROME=/path/to/chrome)
//
// --png also renders the synthetic forest (sunlit, its own shadows, its leaves' light through, forest.wgsl's
// own look) from the ground and from the air — at --date's season (46° N): a look without the app. Exit 1 when the GPU disagrees; 0 without a WebGPU adapter
// (nothing could be checked).
import { encodePNG16 } from "../src/exporters";
import {
  FOREST_KINDS,
  ForestKind,
  forestFrame,
  forestHash,
  forestTree,
  type ForestTree,
  crownOf,
  forestKindTable,
  forestSeason,
  packCell,
  trunkOf,
} from "../src/system/forest";
import { localPoint, packScenery, sceneryFrame } from "../src/system/scenery-data";
import type { Vec3 } from "../src/physics";
import { CHROME, withGpuPage } from "./lib/headless-gpu";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const RAYS = Number(arg("rays", "6000"));
const PNG = arg("png", "");
const DATE = arg("date", "2026-07-15");

// ---- a synthetic forest: 300 m round the origin, rolling ground, every kind
const ground = (x: number, y: number) => 400 + 15 * Math.sin(x / 40) * Math.cos(y / 55);
const frame = sceneryFrame(46, 7);
// (the app's frame — 3.25 km, ~930 cells a side: the dual grid's coordinates as large as there, where a
// float's step matters —, its trees within 300 m: the CPU's brute force stays quick)
const ff = forestFrame(46, 7, 3250, (lat, lon) => localPoint(frame, lat, lon, 0));
const cells = new Uint32Array(ff.w * ff.h);
let rng = 12345;
const random = () => (rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) / 4294967296;
const trees: ForestTree[] = [];
const mid = [Math.floor(ff.a[0]), Math.floor(ff.b[0])];
for (let j = mid[1]! - 46; j <= mid[1]! + 46; j++)
  for (let i = mid[0]! - 46; i <= mid[0]! + 46; i++) {
    if (random() > 0.72) continue;
    const kind = (1 + Math.floor(random() * (FOREST_KINDS - 1))) as ForestKind;
    const height = kind === ForestKind.shrub ? 2 + 4 * random() : 6 + 24 * random();
    // (its foot where it stands: the position first, then the ground there)
    const at = forestTree(ff, packCell(0, kind, height), i, j)!;
    if (Math.hypot(at.x, at.y) > 300) continue;
    cells[j * ff.w + i] = packCell(ground(at.x, at.y) - 1, kind, height);
    trees.push(forestTree(ff, cells[j * ff.w + i]!, i, j)!);
  }
const buffer = packScenery([], new Uint32Array(16), [], { frame: ff, cells, trees: trees.length });
// (the rays on the summer's table — winter's twigs are a chance pattern, no exact twin; the pictures at the
// date's season, its kinds' table written as the app writes it)
const seasonTable = forestKindTable(forestSeason(Date.parse(DATE), 46));
const seasonAt = (new Float32Array(buffer)[8]! + 7) * 16;

// ---- the CPU's exact shapes (forest.wgsl's, in double precision)
type Hit = { t: number; kind: number; part: number };
function ellipsoid(o: Vec3, d: Vec3, c: Vec3, r: Vec3): number {
  const p = [0, 1, 2].map((k) => (o[k]! - c[k]!) / r[k]!),
    v = [0, 1, 2].map((k) => d[k]! / r[k]!);
  const a = v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2,
    b = p[0]! * v[0]! + p[1]! * v[1]! + p[2]! * v[2]!,
    det = b * b - a * (p[0]! ** 2 + p[1]! ** 2 + p[2]! ** 2 - 1);
  if (det < 0) return -1;
  let t = (-b - Math.sqrt(det)) / a;
  if (t < 0.001) t = (-b + Math.sqrt(det)) / a;
  return t < 0.001 ? -1 : t;
}
function cone(o: Vec3, d: Vec3, apex: Vec3, rb: number, h: number): number {
  const k2 = (rb / h) ** 2,
    co = [o[0] - apex[0], o[1] - apex[1], o[2] - apex[2]];
  const a = d[0] ** 2 + d[1] ** 2 - k2 * d[2] ** 2,
    b = 2 * (co[0]! * d[0] + co[1]! * d[1] - k2 * co[2]! * d[2]),
    c = co[0]! ** 2 + co[1]! ** 2 - k2 * co[2]! ** 2;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) roots.push(-c / b);
  } else {
    const det = b * b - 4 * a * c;
    if (det >= 0) roots.push((-b - Math.sqrt(det)) / (2 * a), (-b + Math.sqrt(det)) / (2 * a));
  }
  let best = -1;
  for (const t of roots) {
    const z = co[2]! + d[2] * t;
    if (t > 0.001 && z <= 0 && z >= -h && (best < 0 || t < best)) best = t;
  }
  if (Math.abs(d[2]) > 1e-7) {
    const t = (apex[2] - h - o[2]) / d[2];
    const x = o[0] + d[0] * t - apex[0],
      y = o[1] + d[1] * t - apex[1];
    if (t > 0.001 && x * x + y * y <= rb * rb && (best < 0 || t < best)) best = t;
  }
  return best;
}
function cylinder(o: Vec3, d: Vec3, c: Vec3, r: number, top: number): number {
  const px = o[0] - c[0],
    py = o[1] - c[1],
    a = d[0] ** 2 + d[1] ** 2;
  if (a < 1e-12) return -1;
  const b = px * d[0] + py * d[1],
    det = b * b - a * (px * px + py * py - r * r);
  if (det < 0) return -1;
  const t = (-b - Math.sqrt(det)) / a,
    z = o[2] + d[2] * t;
  return t < 0.001 || z < c[2] || z > top ? -1 : t;
}
// (near: the bound the leaves carve inwards; else the plain shape the tracer draws without detail)
function cpuTrace(o: Vec3, d: Vec3, tMax: number, near = false): Hit {
  let best: Hit = { t: tMax, kind: 0, part: 0 };
  for (const tr of trees) {
    const c = crownOf(tr, near);
    let t = c.cone ? cone(o, d, c.c, c.r[0], c.r[1]) : ellipsoid(o, d, c.c, c.r);
    let part = 0;
    const trunk = trunkOf(tr);
    if (trunk.radius > 0) {
      const tt = cylinder(o, d, [tr.x, tr.y, tr.z - 1], trunk.radius, trunk.top);
      if (tt > 0 && (t < 0 || tt < t)) {
        t = tt;
        part = 1;
      }
    }
    if (t > 0 && t < best.t) best = { t, kind: tr.kind, part };
  }
  return best;
}

// ---- the rays: from the forest floor, from above, towards a sun
const rays: number[] = [];
for (let n = 0; n < RAYS; n++) {
  const x = (random() - 0.5) * 300,
    y = (random() - 0.5) * 300;
  // (from the floor, from above, towards a sun; straight down from 600 m — the aircraft's view)
  const mode = n % 4;
  const z = ground(x, y) + (mode === 1 ? 40 + 80 * random() : mode === 3 ? 600 : 1.2 + 3 * random());
  const az = random() * 2 * Math.PI,
    el =
      mode === 1
        ? -(0.1 + 1.3 * random())
        : mode === 2
          ? 0.15 + 1.2 * random()
          : mode === 3
            ? -(1.0 + 0.57 * random())
            : (random() - 0.5) * 0.5;
  rays.push(x, y, z, mode === 3 ? 900 : 400, Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el), mode === 2 ? 1 : 0);
}
const hashes: number[] = [];
for (let n = 0; n < 256; n++) hashes.push(Math.floor(random() * 2 ** 32), Math.floor((random() - 0.5) * 2 ** 31) >>> 0, n % 8, 0);

const forestWGSL = await Bun.file("src/shaders/forest.wgsl").text();
const kernel = `
@group(0) @binding(1) var<storage, read> rays: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> hits: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> hashes: array<vec4u>;
@compute @workgroup_size(64) fn trace(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < arrayLength(&hashes)) { let h = hashes[id.x]; hashes[id.x] = vec4u(h.xyz, forestHash(h.x, h.y, h.z)); }
  if (id.x >= arrayLength(&rays) / 2u) { return; }
  let a = rays[id.x * 2u]; let b = rays[id.x * 2u + 1u];
  let h = forestQuery(a.xyz, b.xyz, a.w, b.w > 0.5, 0.0);
  hits[id.x * 2u] = vec4f(h.t, f32(h.kind), f32(h.part), h.seed);
  let c = forestQuery(a.xyz, b.xyz, a.w, b.w > 0.5, 1e9);
  hits[id.x * 2u + 1u] = vec4f(c.t, f32(c.kind), f32(c.part), c.ao);
}
// the picture: a camera (o, its axes) over the synthetic ground, the Sun at L
struct View { o: vec4f, fwd: vec4f, right: vec4f, up: vec4f, sun: vec4f, size: vec4f };
@group(0) @binding(4) var<uniform> view: View;
@group(0) @binding(5) var<storage, read_write> image: array<vec4f>;
fn groundAt(p: vec2f) -> f32 { return 400.0 + 15.0 * sin(p.x / 40.0) * cos(p.y / 55.0); }
fn shade(c: vec3f) -> vec3f { let x = c * 1.4; return pow(x / (1.0 + x), vec3f(1.0 / 2.2)); }
@compute @workgroup_size(8, 8) fn render(@builtin(global_invocation_id) id: vec3u) {
  let w = u32(view.size.x); let hh = u32(view.size.y);
  if (id.x >= w || id.y >= hh) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(f32(w), f32(hh)) * 2.0 - 1.0;
  let d = normalize(view.fwd.xyz + view.right.xyz * uv.x * view.size.z * f32(w) / f32(hh) - view.up.xyz * uv.y * view.size.z);
  let o = view.o.xyz; let L = view.sun.xyz;
  let sky = mix(vec3f(0.55, 0.7, 0.9), vec3f(0.18, 0.35, 0.75), clamp(d.z, 0.0, 1.0));
  // the ground: marched, refined
  var tg = 1e9; var t = 0.5;
  for (var k = 0; k < 400; k++) { let p = o + d * t; if (p.z < groundAt(p.xy)) { tg = t; break; } t += 0.25 + t * 0.012; if (t > 700.0) { break; } }
  if (tg < 1e8) { var lo = tg - 0.25 - tg * 0.012; var hi = tg; for (var k = 0; k < 12; k++) { let m = 0.5 * (lo + hi); let p = o + d * m; if (p.z < groundAt(p.xy)) { hi = m; } else { lo = m; } } tg = hi; }
  let h = forestQuery(o, d, min(tg, 700.0), false, 220.0);
  var c = sky;
  if (h.kind > 0u || tg < 1e8) {
    var n = vec3f(0.0, 0.0, 1.0); var alb = vec3f(0.12, 0.1, 0.07); var p = o + d * tg;
    var through = vec3f(0.0);
    if (h.kind > 0u) {
      p = o + d * h.t; n = h.n;
      let look = forestLook(h, n, p, vec4f(0.0));
      alb = look.albedo; through = look.through;
    } else {
      let e = 0.5; n = normalize(vec3f(groundAt(p.xy - vec2f(e, 0.0)) - groundAt(p.xy + vec2f(e, 0.0)), groundAt(p.xy - vec2f(0.0, e)) - groundAt(p.xy + vec2f(0.0, e)), 2.0 * e));
    }
    let lit = select(1.0, 0.0, forestQuery(p + n * 0.35 + L * 0.15, L, 500.0, true, select(0.0, 60.0, length(p - o) < 180.0)).kind > 0u);
    let sun = vec3f(1.0, 0.95, 0.85) * 3.0 * max(dot(n, L), 0.0) * lit;
    // (the tracer's: light through the crown's thin edge, brightest looking into the Sun)
    let rim = 1.0 - abs(dot(n, d));
    let back = vec3f(1.0, 0.95, 0.85) * 3.0 * max(-dot(n, L), 0.0) * rim * (0.3 + 0.7 * pow(max(dot(d, L), 0.0), 4.0));
    c = alb * (sun + vec3f(0.45, 0.55, 0.75) * (0.55 + 0.45 * n.z)) + through * back;
    c = mix(c, sky, 1.0 - exp(-length(p - o) / 1800.0));
  }
  image[id.y * w + id.x] = vec4f(shade(c), 1.0);
}`;
const code = forestWGSL + kernel;

type Out = { adapter: string | null; errors?: string[]; hits?: number[]; hashes?: number[]; images?: number[][] };
const views = PNG
  ? [
      // from the forest floor, looking along it; from 60 m up, looking down across it
      { o: [-120, -20, ground(-120, -20) + 1.7], at: [60, 30, ground(60, 30) + 8] },
      { o: [-200, -160, ground(-200, -160) + 70], at: [0, 0, ground(0, 0)] },
    ]
  : [];
const W = 640,
  H = 360;
let out: Out;
try {
  out = await withGpuPage((evaluate) =>
    evaluate<Out>(`(async () => {
      if (!navigator.gpu) return { adapter: null };
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { adapter: null };
      const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize } });
      const module = device.createShaderModule({ code: ${JSON.stringify(code)} });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === "error").map((m) => m.lineNum + ":" + m.linePos + " " + m.message);
      if (errors.length) return { adapter: "x", errors };
      const S = GPUBufferUsage.STORAGE, D = GPUBufferUsage.COPY_DST, R = GPUBufferUsage.COPY_SRC;
      const make = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage: usage | D }); device.queue.writeBuffer(b, 0, data); return b; };
      const scene = make(Uint8Array.from(atob(${JSON.stringify(Buffer.from(buffer).toString("base64"))}), (c) => c.charCodeAt(0)), S);
      const rays = make(new Float32Array(${JSON.stringify(rays)}), S);
      const hits = device.createBuffer({ size: ${RAYS * 32}, usage: S | R });
      const hashes = make(new Uint32Array(${JSON.stringify(hashes)}), S | R);
      const read = async (b, size) => { const r = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | D }); const e = device.createCommandEncoder(); e.copyBufferToBuffer(b, 0, r, 0, size); device.queue.submit([e.finish()]); await r.mapAsync(GPUMapMode.READ); const v = r.getMappedRange().slice(0); r.unmap(); r.destroy(); return v; };
      const view = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | D });
      const image = device.createBuffer({ size: ${W * H * 16}, usage: S | R });
      const pipe = (entryPoint) => device.createComputePipeline({ layout: "auto", compute: { module, entryPoint } });
      const trace = pipe("trace");
      const bindTrace = device.createBindGroup({ layout: trace.getBindGroupLayout(0), entries: [0, 1, 2, 3].map((binding) => ({ binding, resource: { buffer: [scene, rays, hits, hashes][binding] } })) });
      let e = device.createCommandEncoder(); let p = e.beginComputePass(); p.setPipeline(trace); p.setBindGroup(0, bindTrace); p.dispatchWorkgroups(Math.ceil(${Math.max(RAYS, 256)} / 64)); p.end(); device.queue.submit([e.finish()]);
      const out = { adapter: adapter.info?.description || adapter.info?.vendor || "an adapter", hits: Array.from(new Float32Array(await read(hits, ${RAYS * 32}))), hashes: Array.from(new Uint32Array(await read(hashes, ${hashes.length * 4}))), images: [] };
      const views = ${JSON.stringify(views)};
      if (views.length) {
        device.queue.writeBuffer(scene, ${seasonAt}, new Float32Array(${JSON.stringify(Array.from(seasonTable))}));
        const render = pipe("render");
        const bind = device.createBindGroup({ layout: render.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: scene } }, { binding: 4, resource: { buffer: view } }, { binding: 5, resource: { buffer: image } }] });
        for (const v of views) {
          const f = v.at.map((x, i) => x - v.o[i]); const l = Math.hypot(...f); const fwd = f.map((x) => x / l);
          const right = [fwd[1], -fwd[0], 0].map((x) => x / Math.hypot(fwd[0], fwd[1]));
          const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
          const sun = [0.55, -0.45, 0.7]; const sl = Math.hypot(...sun);
          device.queue.writeBuffer(view, 0, new Float32Array([...v.o, 0, ...fwd, 0, ...right, 0, ...up, 0, ...sun.map((x) => x / sl), 0, ${W}, ${H}, Math.tan(Math.PI / 7), 0]));
          e = device.createCommandEncoder(); p = e.beginComputePass(); p.setPipeline(render); p.setBindGroup(0, bind); p.dispatchWorkgroups(${W / 8}, ${H / 8}); p.end(); device.queue.submit([e.finish()]);
          out.images.push(Array.from(new Float32Array(await read(image, ${W * H * 16}))));
        }
      }
      return out;
    })()`),
  );
} catch (e) {
  console.error("check-forest:", (e as Error).message);
  process.exit(1);
}
if (!out.adapter) {
  console.warn(`check-forest: no WebGPU adapter in this browser (${CHROME}) — nothing checked`);
  process.exit(0);
}
if (out.errors?.length) {
  console.error(`✗ forest.wgsl + kernel\n  ${out.errors.join("\n  ")}`);
  process.exit(1);
}
// the hash, bit for bit
let badHash = 0;
for (let n = 0; n < hashes.length; n += 4) if (out.hashes![n + 3] !== forestHash(hashes[n]!, hashes[n + 1]!, hashes[n + 2]!)) badHash++;
// the rays: the same first tree at the same distance (a grazing ray may part on a float's rounding)
let bad = 0,
  hitsN = 0,
  worst = 0,
  carvedBad = 0,
  carvedHits = 0;
const shown: string[] = [];
for (let n = 0; n < RAYS; n++) {
  const r = rays.slice(n * 8, n * 8 + 8);
  const o: Vec3 = [r[0]!, r[1]!, r[2]!],
    d: Vec3 = [r[4]!, r[5]!, r[6]!];
  const cpu = cpuTrace(o, d, r[3]!);
  const g = out.hits!.slice(n * 8, n * 8 + 4),
    carved = out.hits!.slice(n * 8 + 4, n * 8 + 8);
  // (the carved crowns lie inside their bounds: never met before the bounds' first crossing)
  const bound = cpuTrace(o, d, r[3]!, true);
  if (carved[1]! > 0 && carved[0]! < bound.t - 2e-3 - 2e-4 * bound.t) carvedBad++;
  if (carved[1]! > 0) carvedHits++;
  if (carved[3]! < 0.29 || carved[3]! > 1) carvedBad++;
  if (cpu.kind) hitsN++;
  const anyHit = r[7]! > 0.5;
  const agree = anyHit ? g[1]! > 0 === cpu.kind > 0 : g[1] === cpu.kind && Math.abs(g[0]! - cpu.t) <= 2e-3 + 2e-4 * cpu.t;
  if (!agree) {
    bad++;
    if (shown.length < 8)
      shown.push(
        `ray ${n}${anyHit ? " (shadow)" : ""}: GPU t ${g[0]!.toFixed(4)} kind ${g[1]} — CPU t ${cpu.t.toFixed(4)} kind ${cpu.kind}`,
      );
  } else if (!anyHit && cpu.kind) worst = Math.max(worst, Math.abs(g[0]! - cpu.t));
}
console.log(
  `${out.adapter}: ${trees.length} trees in ${ff.w} × ${ff.h} cells; hash ${hashes.length / 4 - badHash}/${hashes.length / 4} exact`,
);
console.log(`rays: ${RAYS - bad}/${RAYS} agree (${hitsN} hit a tree; worst distance gap ${(worst * 1000).toFixed(2)} mm)`);
console.log(`carved crowns: ${carvedHits} rays meet a tree, ${carvedBad} outside their bounds`);
for (const s of shown) console.log(`  ✗ ${s}`);
for (let k = 0; k < (out.images?.length ?? 0); k++) {
  const file = `${PNG.replace(/\.png$/, "")}-${k ? "air" : "ground"}.png`;
  await Bun.write(file, await encodePNG16(new Float32Array(out.images![k]!), W, H));
  console.log(`picture: ${file}`);
}
process.exit(badHash || carvedBad || bad > RAYS * 0.002 ? 1 : 0);
