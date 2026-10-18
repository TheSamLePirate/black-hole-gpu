// The cockpit's mask (renderer.ts encodeCockpitMask): the rays the flown craft's own opaque parts hide, not
// traced. The last frame's own mask (ship.ts: its solid triangles alone, from the cockpit — the cabin, the
// panel, the frame; not its glass, not the others' craft) read for each 16 × 16 tile of the image: a tile all
// of whose pixels within the margin around it were covered is marked in moments.x (−1; 0 else — realtime
// leaves it 0), the trace kernel's thread there does not trace (trace.wgsl main), the light meter skips it
// (post.wgsl meter). The margin: the reconstruction's reach (two blocks) and the camera's buffeting — a pixel
// the mask let through, near its edge, is traced and its neighbours with it.
// Two passes: cell — each 8 × 8 cell of the image covered whole or not (a texel read a pixel) —, then main — a tile
// covered when every cell within its margin is (the margin rounded out to whole cells: ≤ 18 × 18 cells a tile, not
// (16 + 2m)² texels — with the motion blur's 40 px, 81 texels a pixel, 10 ms on an M1).

@group(0) @binding(0) var own: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> moments: array<vec2f>;
// size: the image's width, height, the mode (0: every tile cleared; 1: a covered tile not traced, −1; 2: traced but
// marked −2 — the cabin still left out of the light meter), the margin [px]; rect: the own mask's box in the image
// [px] (x, y, w, h)
struct MaskU { size: vec4u, rect: vec4i };
@group(0) @binding(2) var<uniform> U: MaskU;
// each 8 × 8 cell: 1 covered whole (off the image: covered), 0 not
@group(0) @binding(3) var<storage, read_write> cells: array<u32>;

var<workgroup> covered: atomic<u32>;

@compute @workgroup_size(8, 8)
fn cell(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
        @builtin(workgroup_id) wid: vec3u) {
  if (lid.x == 0u && lid.y == 0u) { atomicStore(&covered, 1u); }
  workgroupBarrier();
  let W = i32(U.size.x);
  let H = i32(U.size.y);
  let p = vec2i(gid.xy);
  // (off the image: nothing seen there — as if covered)
  if (p.x < W && p.y < H) {
    let q = p - U.rect.xy;
    var a = 0.0;
    if (all(q >= vec2i(0)) && all(q < U.rect.zw)) { a = textureLoad(own, q, 0).r; }
    if (a < 0.5) { atomicStore(&covered, 0u); }
  }
  workgroupBarrier();
  let CW = (U.size.x + 7u) / 8u;
  if (lid.x == 0u && lid.y == 0u) { cells[wid.y * CW + wid.x] = atomicLoad(&covered); }
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
        @builtin(workgroup_id) wid: vec3u) {
  if (lid.x == 0u && lid.y == 0u) { atomicStore(&covered, select(0u, 1u, U.size.z != 0u)); }
  workgroupBarrier();
  let W = i32(U.size.x);
  let H = i32(U.size.y);
  if (U.size.z != 0u) {
    // (the tile and its margin, in whole cells — floor by an arithmetic shift, below 0 too —, each thread a stride)
    let m = i32(U.size.w);
    let CW = (W + 7) / 8;
    let CH = (H + 7) / 8;
    let c0 = (vec2i(wid.xy) * 16 - vec2i(m)) >> vec2u(3u);
    let c1 = (vec2i(wid.xy) * 16 + vec2i(15 + m)) >> vec2u(3u);
    let n = c1 - c0 + vec2i(1);
    for (var k = i32(lid.y * 16u + lid.x); k < n.x * n.y; k += 256) {
      let c = c0 + vec2i(k % n.x, k / n.x);
      // (off the image: covered)
      if (any(c < vec2i(0)) || c.x >= CW || c.y >= CH) { continue; }
      if (cells[u32(c.y * CW + c.x)] == 0u) { atomicStore(&covered, 0u); }
    }
  }
  // (a barrier and a plain load, not workgroupUniformLoad on an atomic — a newer overload some browsers lack; nothing
  // after it waits on the others)
  workgroupBarrier();
  let full = atomicLoad(&covered);
  let p = vec2i(gid.xy);
  if (p.x < W && p.y < H) { moments[u32(p.y * W + p.x)].x = select(0.0, select(-2.0, -1.0, U.size.z == 1u), full == 1u); }
}
