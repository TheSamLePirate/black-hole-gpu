// The cockpit's mask (renderer.ts encodeCockpitMask): the rays the flown craft's own opaque parts hide, not
// traced. The last frame's own mask (ship.ts: its solid triangles alone, from the cockpit — the cabin, the
// panel, the frame; not its glass, not the others' craft) read for each 16 × 16 tile of the image: a tile all
// of whose pixels within the margin around it were covered is marked in moments.x (−1; 0 else — realtime
// leaves it 0), the trace kernel's thread there does not trace (trace.wgsl main), the light meter skips it
// (post.wgsl meter). The margin: the reconstruction's reach (two blocks) and the camera's buffeting — a pixel
// the mask let through, near its edge, is traced and its neighbours with it.

@group(0) @binding(0) var own: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> moments: array<vec2f>;
// size: the image's width, height, the mode (0: every tile cleared; 1: a covered tile not traced, −1; 2: traced but
// marked −2 — the cabin still left out of the light meter), the margin [px]; rect: the own mask's box in the image
// [px] (x, y, w, h)
struct MaskU { size: vec4u, rect: vec4i };
@group(0) @binding(2) var<uniform> U: MaskU;

var<workgroup> covered: atomic<u32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
        @builtin(workgroup_id) wid: vec3u) {
  if (lid.x == 0u && lid.y == 0u) { atomicStore(&covered, select(0u, 1u, U.size.z != 0u)); }
  workgroupBarrier();
  let W = i32(U.size.x);
  let H = i32(U.size.y);
  let m = i32(U.size.w);
  if (U.size.z != 0u) {
    // (the tile and its margin, each thread a stride of it)
    let o = vec2i(wid.xy) * 16 - vec2i(m);
    let span = 16 + 2 * m;
    for (var y = i32(lid.y); y < span; y += 16) {
      for (var x = i32(lid.x); x < span; x += 16) {
        let p = o + vec2i(x, y);
        // (off the image: nothing seen there — as if covered)
        if (any(p < vec2i(0)) || p.x >= W || p.y >= H) { continue; }
        let q = p - U.rect.xy;
        var a = 0.0;
        if (all(q >= vec2i(0)) && all(q < U.rect.zw)) { a = textureLoad(own, q, 0).r; }
        if (a < 0.5) { atomicStore(&covered, 0u); }
      }
    }
  }
  // (a barrier and a plain load, not workgroupUniformLoad on an atomic — a newer overload some browsers lack; nothing
  // after it waits on the others)
  workgroupBarrier();
  let full = atomicLoad(&covered);
  let p = vec2i(gid.xy);
  if (p.x < W && p.y < H) { moments[u32(p.y * W + p.x)].x = select(0.0, select(-2.0, -1.0, U.size.z == 1u), full == 1u); }
}
