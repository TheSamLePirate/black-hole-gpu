// Offline import of the user's licensed false-earth astronaut. Requires decoded GLB (see asset README).
// Bun scripts/build-astronaut.ts .cache/false-earth-assets
const source = process.argv[2];
if (!source) throw new Error("Pass the local licensed source directory.");
// biome-ignore lint/suspicious/noExplicitAny: offline glTF JSON input; accessors validated before decoding
async function glb(path: string): Promise<{ j: any; bytes: DataView }> {
  const b = await Bun.file(path).arrayBuffer(),
    v = new DataView(b);
  if (v.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB");
  const size = v.getUint32(12, true);
  return { j: JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, size))), bytes: new DataView(b, 28 + size) };
}
// biome-ignore lint/suspicious/noExplicitAny: only bounded scalar/vector/matrix accessors used by this asset
function accessor(g: { j: any; bytes: DataView }, id: number): number[] {
  const a = g.j.accessors[id],
    view = g.j.bufferViews[a.bufferView];
  if (a.sparse) throw new Error("Sparse accessor unsupported");
  const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type]!;
  const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
  const out: number[] = [];
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < n; k++) {
      const p = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? n * size) + k * size;
      let v =
        a.componentType === 5126
          ? g.bytes.getFloat32(p, true)
          : a.componentType === 5125
            ? g.bytes.getUint32(p, true)
            : a.componentType === 5123
              ? g.bytes.getUint16(p, true)
              : g.bytes.getUint8(p);
      if (a.normalized) v /= size === 2 ? 65535 : 255;
      out.push(v);
    }
  return out;
}
const g = await glb(`${source}/models/Astronaut-decoded.glb`),
  skin = g.j.skins[0];
const nodes = g.j.nodes.map((n: { name: string; translation?: number[]; rotation?: number[]; scale?: number[] }) => ({
  name: n.name,
  t: n.translation ?? [0, 0, 0],
  r: n.rotation ?? [0, 0, 0, 1],
  s: n.scale ?? [1, 1, 1],
  parent: -1,
}));
g.j.nodes.forEach((n: { children?: number[] }, i: number) => n.children?.forEach((c) => (nodes[c].parent = i)));
const vertex: number[] = [],
  indices: number[] = [];
const BODY = ["Astronaut_Suit_Body_Detail_01_Mesh", "Astronaut_Suit_Body_Mesh", "Astronaut_Suit_Shoes_Mesh"];
for (const node of g.j.nodes) {
  if (node.mesh === undefined || node.name.includes("Person")) continue;
  for (const p of g.j.meshes[node.mesh].primitives) {
    if (p.extensions?.KHR_draco_mesh_compression) throw new Error("Decode Draco first");
    const a = p.attributes,
      pos = accessor(g, a.POSITION),
      normal = accessor(g, a.NORMAL),
      uv = accessor(g, a.TEXCOORD_0),
      joints = accessor(g, a.JOINTS_0),
      weights = accessor(g, a.WEIGHTS_0),
      index = accessor(g, p.indices),
      nv = pos.length / 3;
    const tangents = Array.from({ length: nv }, () => [0, 0, 0]);
    const signs = new Array(nv).fill(1);
    for (let i = 0; i < index.length; i += 3) {
      const k = index.slice(i, i + 3);
      const v = k.map((n) => pos.slice(n * 3, n * 3 + 3)),
        t = k.map((n) => uv.slice(n * 2, n * 2 + 2));
      const dx = v[1]!.map((x, n) => x - v[0]![n]!),
        dy = v[2]!.map((x, n) => x - v[0]![n]!);
      const du = t[1]![0]! - t[0]![0]!,
        dv = t[1]![1]! - t[0]![1]!,
        eu = t[2]![0]! - t[0]![0]!,
        ev = t[2]![1]! - t[0]![1]!;
      const determinant = du * ev - dv * eu;
      const scale = 1 / (Math.abs(determinant) > 1e-10 ? determinant : 1);
      for (const n of k) {
        for (let c = 0; c < 3; c++) tangents[n]![c]! += (dx[c]! * ev - dy[c]! * dv) * scale;
        signs[n] = determinant < 0 ? -1 : 1;
      }
    }
    const base = vertex.length / 21,
      material = BODY.includes(node.name) ? 0 : node.name.includes("Glass") ? 2 : 1;
    for (let i = 0; i < nv; i++) {
      const tangent = tangents[i]!,
        length = Math.hypot(...tangent) || 1;
      const w = weights.slice(i * 4, i * 4 + 4),
        sum = w.reduce((a, b) => a + b, 0) || 1;
      vertex.push(
        ...pos.slice(i * 3, i * 3 + 3),
        ...normal.slice(i * 3, i * 3 + 3),
        ...uv.slice(i * 2, i * 2 + 2),
        ...joints.slice(i * 4, i * 4 + 4),
        ...w.map((x) => x / sum),
        tangent[0]! / length,
        tangent[1]! / length,
        tangent[2]! / length,
      ); // separate tangent sign/material are packed below
      // The runtime layout is 84 B: 3+3+2+4 joints(u16)+4 weights+4 tangent+material(u32).
      vertex.push(signs[i]!, material);
    }
    // actual packed logical values: 21, not 19 (joints still converted to u16)
    for (const n of index) indices.push(base + n);
  }
}
const floatsPerVertex = 21,
  nv = vertex.length / floatsPerVertex;
const packed = new ArrayBuffer(nv * 84),
  view = new DataView(packed);
for (let i = 0; i < nv; i++) {
  const v = vertex.slice(i * 21, i * 21 + 21),
    off = i * 84;
  for (let k = 0; k < 8; k++) view.setFloat32(off + k * 4, v[k]!, true);
  for (let k = 0; k < 4; k++) view.setUint16(off + 32 + k * 2, v[8 + k]!, true);
  for (let k = 0; k < 4; k++) view.setFloat32(off + 40 + k * 4, v[12 + k]!, true);
  for (let k = 0; k < 4; k++) view.setFloat32(off + 56 + k * 4, v[16 + k]!, true);
  view.setUint32(off + 72, v[20]!, true);
}
const clips = [];
for (const name of ["Idle", "Walking", "Running", "WalkingBack"]) {
  const a = await glb(`${source}/models/${name}.glb`),
    animation = a.j.animations[0];
  const tracks = new Map<string, object>();
  let duration = 0;
  for (const c of animation.channels) {
    const n = a.j.nodes[c.target.node],
      baseNode = nodes.findIndex((b: { name: string }) => b.name === n.name);
    if (baseNode < 0) continue;
    const s = animation.samplers[c.sampler];
    if (s.interpolation && s.interpolation !== "LINEAR" && s.interpolation !== "STEP") throw new Error("Unsupported interpolation");
    const times = accessor(a, s.input),
      values = accessor(a, s.output);
    duration = Math.max(duration, ...times);
    tracks.set(`${baseNode}:${c.target.path}`, { node: baseNode, path: c.target.path, times, values, step: s.interpolation === "STEP" });
  }
  clips.push({ name, duration, tracks: [...tracks.values()] });
}
const meta = new TextEncoder().encode(
  JSON.stringify({ nodes, joints: skin.joints, inverse: accessor(g, skin.inverseBindMatrices), clips, nv, ni: indices.length, stride: 84 }),
);
const padded = Math.ceil(meta.length / 4) * 4;
const output = new Uint8Array(16 + padded + packed.byteLength + indices.length * 4),
  header = new Uint32Array(output.buffer, 0, 4);
header.set([0x314e4b53, meta.length, nv, indices.length]);
output.set(meta, 16);
output.set(new Uint8Array(packed), 16 + padded);
output.set(new Uint8Array(new Uint32Array(indices).buffer), 16 + padded + packed.byteLength);
await Bun.write("assets/character/astronaut.bin", Bun.gzipSync(output));
for (const part of ["Body", "Details"])
  for (const kind of ["Albedo", "Metallic", "Ao", "Normals"])
    await Bun.write(`assets/character/${part}-${kind}.ktx2`, Bun.file(`${source}/textures/${part}/Astronaut_Suit_${part}_${kind}.ktx2`));
console.log({
  vertices: nv,
  triangles: indices.length / 3,
  joints: skin.joints.length,
  bytes: output.byteLength,
  compressed: Bun.gzipSync(output).length,
  clips: clips.map((c) => ({ name: c.name, duration: c.duration, tracks: c.tracks.length })),
});
