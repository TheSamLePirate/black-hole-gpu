// The F-35's glass thinned to one surface (TERRE-UNREAL U5). The model's canopy is a shell 5 mm thick, each of its
// triangles twice (one per winding): blended, a ray from the pilot's eye crossed four layers of it, the whole view drawn
// four times over — 35–45 ms a frame on an M1 at 1920 × 1080, the craft's cost. One surface of each is what the eye
// tells apart: the copies dropped, the inner wall of the shell dropped, the outer kept.

type V3 = [number, number, number];

/**
 * The glass's triangles to keep: `tris` (vertex indices, three a triangle) over `verts` (its stride `stride`, the
 * position first), `inside` a point within the shell (the pilot's head). Exact copies (the same corners, either
 * winding) once; of two triangles facing each other across the shell's thickness (≤ `gap` m apart along their normal,
 * within it across), the one nearer `inside` dropped.
 */
export function thinGlass(tris: Uint32Array, verts: Float32Array, stride: number, inside: V3, gap = 0.015): Uint32Array {
  const P = (i: number): V3 => [verts[stride * i]!, verts[stride * i + 1]!, verts[stride * i + 2]!];
  const key = (p: V3) => p.map((x) => Math.round(x * 1000)).join(",");
  // (the copies: the corners' places, sorted)
  const seen = new Set<string>();
  const kept: number[] = [];
  for (let t = 0; t < tris.length / 3; t++) {
    const k = [0, 1, 2]
      .map((j) => key(P(tris[3 * t + j]!)))
      .sort()
      .join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(t);
  }
  // (each one's centre, normal and size; a grid of the centres, a cell the gap's)
  const C: V3[] = [],
    N: V3[] = [],
    R: number[] = [];
  for (const t of kept) {
    const a = P(tris[3 * t]!),
      b = P(tris[3 * t + 1]!),
      c = P(tris[3 * t + 2]!);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const l = Math.hypot(...n) || 1;
    N.push([n[0] / l, n[1] / l, n[2] / l]);
    C.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    R.push(Math.sqrt(l / 2));
  }
  const cell = (p: V3) => p.map((x) => Math.floor(x / gap));
  const grid = new Map<string, number[]>();
  C.forEach((p, i) => {
    const k = cell(p).join(",");
    const g = grid.get(k);
    if (g) g.push(i);
    else grid.set(k, [i]);
  });
  const d2 = (p: V3) => (p[0] - inside[0]) ** 2 + (p[1] - inside[1]) ** 2 + (p[2] - inside[2]) ** 2;
  const drop = new Set<number>();
  C.forEach((p, i) => {
    if (drop.has(i)) return;
    const [x, y, z] = cell(p);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of grid.get(`${x! + dx},${y! + dy},${z! + dz}`) ?? []) {
            if (j === i || drop.has(j)) continue;
            const n = N[i]!,
              q = C[j]!;
            if (Math.abs(n[0] * N[j]![0] + n[1] * N[j]![1] + n[2] * N[j]![2]) < 0.95) continue;
            const v = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
            const along = v[0]! * n[0] + v[1]! * n[1] + v[2]! * n[2];
            const across = Math.hypot(v[0]! - along * n[0], v[1]! - along * n[1], v[2]! - along * n[2]);
            if (Math.abs(along) < 1e-4 || Math.abs(along) > gap || across > 0.25 * Math.min(R[i]!, R[j]!)) continue;
            drop.add(d2(p) < d2(q) ? i : j);
          }
  });
  const out: number[] = [];
  kept.forEach((t, i) => {
    if (!drop.has(i)) out.push(tris[3 * t]!, tris[3 * t + 1]!, tris[3 * t + 2]!);
  });
  return new Uint32Array(out);
}
