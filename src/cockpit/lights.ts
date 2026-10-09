// The cabin's light (PLAN-COCKPIT K6): the ceiling lamps' level — the CABIN knob, dimmed by night, red with
// the NIGHT switch — and the screens as lights of their own. Pure: the screens' patches from the cabin's
// mesh (material 68, each face's display in its uv: scripts/build-cockpit.ts), their colours from the
// picture the screens show (cockpitscreens.ts), the uniform the cabin's shader reads (ship.wgsl S.cab, S.scr).
//
// The cabin has 30 screens, many showing the same display: those before the pilots (forward of the seats'
// backs), grouped where they sit close, are the lights — 7 of them, the dashboard's, the side consoles',
// the overhead one.

type V3 = [number, number, number];

/** The screen lights the shader takes (ship.wgsl: S.scr, three vec4s each). */
export const SCREEN_LIGHTS = 8;
/** A screen light's members: which display, how much of its area. */
export interface ScreenLight {
  /** its centre and its normal (out of the screens, into the cabin) in the ship's frame; its area [m²] */
  c: V3;
  n: V3;
  area: number;
  members: { slot: number; area: number }[];
}

/** The screens before the pilots: forward of this (ship's z, the nose) [m]. */
const FORWARD_OF = 2.2;
/** Screens closer than this are one light [m]. */
const GROUP = 0.6;
/** Where the screens face: the cabin's middle at the pilots' heads (ship's frame) [m]. */
const CABIN_MID: V3 = [0, 1.4, 2.0];

/** The screen lights from the cabin's mesh (10 floats a vertex: position, normal, material, ao, uv). */
export function screenLights(verts: Float32Array, idx: Uint32Array, stride = 10): ScreenLight[] {
  // each screen: its faces, by display and place (a display's faces within a screen's size of each other)
  const screens: { slot: number; c: V3; a: V3; A: number }[] = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const i = idx[3 * t]!,
      j = idx[3 * t + 1]!,
      k = idx[3 * t + 2]!;
    if (Math.round(verts[stride * i + 6]!) !== 68) continue;
    const P = [i, j, k].map((q) => [verts[stride * q]!, verts[stride * q + 1]!, verts[stride * q + 2]!] as V3);
    const e1 = P[1]!.map((x, m) => x - P[0]![m]!) as V3,
      e2 = P[2]!.map((x, m) => x - P[0]![m]!) as V3;
    const a: V3 = [(e1[1] * e2[2] - e1[2] * e2[1]) / 2, (e1[2] * e2[0] - e1[0] * e2[2]) / 2, (e1[0] * e2[1] - e1[1] * e2[0]) / 2];
    const A = Math.hypot(...a);
    if (A <= 0) continue;
    const c = [0, 1, 2].map((m) => (P[0]![m]! + P[1]![m]! + P[2]![m]!) / 3) as V3;
    // (its area vector into the cabin: the faces' winding is not to be trusted)
    const s = (CABIN_MID[0] - c[0]) * a[0] + (CABIN_MID[1] - c[1]) * a[1] + (CABIN_MID[2] - c[2]) * a[2] < 0 ? -1 : 1;
    const slot = Math.floor(verts[stride * i + 8]! / 2);
    let S = screens.find((q) => q.slot === slot && Math.hypot(q.c[0] / q.A - c[0], q.c[1] / q.A - c[1], q.c[2] / q.A - c[2]) < 0.35);
    if (!S) screens.push((S = { slot, c: [0, 0, 0], a: [0, 0, 0], A: 0 }));
    S.c = [S.c[0] + c[0] * A, S.c[1] + c[1] * A, S.c[2] + c[2] * A];
    S.a = [S.a[0] + a[0] * s, S.a[1] + a[1] * s, S.a[2] + a[2] * s];
    S.A += A;
  }
  // the lights: the screens before the pilots, grouped
  const out: (ScreenLight & { cw: V3; aw: V3 })[] = [];
  for (const S of screens) {
    const c = S.c.map((x) => x / S.A) as V3;
    if (c[2] < FORWARD_OF) continue;
    let L = out.find((q) => Math.hypot(q.cw[0] / q.area - c[0], q.cw[1] / q.area - c[1], q.cw[2] / q.area - c[2]) < GROUP);
    if (!L) out.push((L = { c: [0, 0, 0], n: [0, 0, 0], area: 0, members: [], cw: [0, 0, 0], aw: [0, 0, 0] }));
    L.cw = [L.cw[0] + c[0] * S.A, L.cw[1] + c[1] * S.A, L.cw[2] + c[2] * S.A];
    L.aw = [L.aw[0] + S.a[0], L.aw[1] + S.a[1], L.aw[2] + S.a[2]];
    L.area += S.A;
    const mem = L.members.find((x) => x.slot === S.slot);
    if (mem) mem.area += S.A;
    else L.members.push({ slot: S.slot, area: S.A });
  }
  return out
    .sort((a, b) => b.area - a.area)
    .slice(0, SCREEN_LIGHTS)
    .map(({ cw, aw, area, members }) => {
      const l = Math.hypot(...aw) || 1;
      return { c: cw.map((x) => x / area) as V3, n: aw.map((x) => x / l) as V3, area, members };
    });
}

/** The displays' mean colours (linear rgb, 3 a display) from the screens' picture's pixels (sRGB bytes, `w` ×
 *  `h`, 4 × 2 displays). */
export function displayColours(px: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(8 * 3);
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lin[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  const sw = w / 4,
    sh = h / 2;
  for (let k = 0; k < 8; k++) {
    const x0 = (k % 4) * sw,
      y0 = Math.floor(k / 4) * sh;
    let r = 0,
      g = 0,
      b = 0;
    for (let y = y0; y < y0 + sh; y++)
      for (let x = x0; x < x0 + sw; x++) {
        const o = 4 * (y * w + x);
        const a = px[o + 3]! / 255;
        r += lin[px[o]!]! * a;
        g += lin[px[o + 1]!]! * a;
        b += lin[px[o + 2]!]! * a;
      }
    const n = sw * sh;
    out.set([r / n, g / n, b / n], 3 * k);
  }
  return out;
}

/** The ceiling lamps: their level (the CABIN knob; by night the shader dims them further) and whether red. */
export function lampsOf(
  s: { cabinLight: number; nightLighting: boolean },
  colours: Float32Array | null = null,
): { level: number; red: number; colours: Float32Array | null } {
  const level = Math.min(Math.max(s.cabinLight, 0), 1);
  // (red: dim — the eyes kept for the dark outside)
  return s.nightLighting ? { level: level * 0.4, red: 1, colours } : { level, red: 0, colours };
}

/** The cabin's uniform (ship.wgsl S.cab then S.scr): the lamps' level, red, the screens' gain, the lights'
 *  count; then each light's centre and area, normal, colour (the area-weighted mean of its displays'). */
export function cabinUniform(
  lamps: { level: number; red: number },
  lights: ScreenLight[],
  colours: Float32Array | null,
): Float32Array<ArrayBuffer> {
  const u = new Float32Array(4 + SCREEN_LIGHTS * 12);
  u.set([lamps.level, lamps.red, colours ? 1 : 0, Math.min(lights.length, SCREEN_LIGHTS)], 0);
  lights.slice(0, SCREEN_LIGHTS).forEach((L, i) => {
    const col = [0, 0, 0];
    if (colours) for (const m of L.members) for (let k = 0; k < 3; k++) col[k] = col[k]! + (colours[3 * m.slot + k]! * m.area) / L.area;
    u.set([...L.c, L.area, ...L.n, 0, ...col, 0], 4 + i * 12);
  });
  return u;
}
