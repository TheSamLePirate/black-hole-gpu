// The war's ground units (Sam, 6 Nov 2026: « mode guerre : des chars, des tourelles qui tirent des sol-air, des bâtiments à
// détruire ») in the craft's mesh format for ship.ts — procedural, no licence to carry —: a 9A310 SAM launcher (an SA-11's TEL:
// its tracked chassis, its turret with its fire-control radar, its launcher arm and its four 9M38 on their rails), a main
// battle tank (its hull, its tracks and road wheels, its turret, its gun), a military truck (a 6×6's cab, bonnet and canvas),
// a concrete bunker.
//   bun scripts/build-ground-units.ts
// Their frame: x the unit's left, y up from the ground, z its front. Materials (ship.wgsl): 74 the paint (its colour packed in
// the UV, as 90), 75 the turret (turned about y at its pivot), 76 the arm or the gun (pitched about x at its pivot, then turned
// with the turret), 77 the tracks and the tyres, 78 the missiles on the rails (posed as the arm, rail k's — k in the UV's u —
// gone once fired), 79 the concrete, 97 the glass. Their pivots in src/game/ground-units.ts (GROUND_UNITS).

import { GROUND_UNITS, type GroundUnitId } from "../src/game/ground-units";
import { box, flat, frustum, lathe, mark, type Mesh, mesh, ogive, plate, quad, transform, wheel, write } from "./lib/trfc";

const PAINT = 74,
  TURRET = 75,
  ARM = 76,
  RUBBER = 77,
  RAIL = 78,
  CONCRETE = 79,
  GLASS = 97;
const OLIVE = flat(86, 92, 62);
const OLIVE_DARK = flat(66, 72, 48);
const SAND = flat(150, 134, 98);
const RUBBER_C = flat(26, 26, 24);
const STEEL = flat(70, 72, 70);

/** a turret built about z (a lathe's) stood up: its axis onto y, its base at `y0`, centred at z = zc */
function standUp(m: Mesh, from: number, y0: number, zc: number) {
  transform(
    m,
    from,
    (p) => [p[0], y0 + p[2], zc - p[1]],
    (n) => [n[0], n[2], -n[1]],
  );
}

/** tracks along a side: the belt (a box), its road wheels, its sprocket and idler — `x` the belt's middle */
function track(m: Mesh, x: number, len: number, w: number, h: number, wheels: number, r: number) {
  box(m, [x - w / 2, 0, -len / 2], [x + w / 2, h, len / 2], RUBBER, RUBBER_C);
  for (let k = 0; k < wheels; k++) {
    const z = -len / 2 + r + 0.15 + ((len - 2 * r - 0.3) * k) / (wheels - 1);
    wheel(m, [x + Math.sign(x) * (w / 2 + 0.02), r + 0.04, z], r, 0.08, RUBBER, flat(48, 50, 44));
  }
}

/** a 9M38 lying on its rail k along z from z0, its axis at (x, y): its body, its ogive, its long wings and tail fins */
function railMissile(m: Mesh, k: number, x: number, y: number, z0: number) {
  const at = mark(m);
  const L = 5.55,
    R = 0.2;
  const uv: [number, number] = [k, 0];
  lathe(
    m,
    0,
    L - 0.95,
    [
      [0, R * 0.85],
      [0.03, R],
      [1, R],
    ],
    16,
    RAIL,
    uv,
  );
  lathe(m, L - 0.95, L, ogive(R, 0.012, 8), 16, RAIL, uv);
  for (let j = 0; j < 4; j++) {
    const roll = Math.PI / 4 + (j * Math.PI) / 2;
    plate(m, roll, R * 0.98, 0.24, 3.6, 1.2, 2.6, 1.18, 0.012, RAIL, uv);
    plate(m, roll, R * 0.98, 0.32, 0.75, 0.05, 0.45, 0.03, 0.012, RAIL, uv);
  }
  transform(
    m,
    at,
    (p) => [x + p[0], y + p[1], z0 + p[2]],
    (n) => n,
  );
}

// ---- 9A310 (SA-11's TEL): 9.3 m on its tracks, its turret's radar forward, the arm's four missiles
{
  const id: GroundUnitId = "gu-tel";
  const U = GROUND_UNITS[id];
  const m = mesh();
  track(m, 1.42, 8.6, 0.5, 1.0, 6, 0.38);
  track(m, -1.42, 8.6, 0.5, 1.0, 6, 0.38);
  frustum(m, [-1.25, 0.55, -4.4], [1.25, 1.9, 4.45], 0.12, PAINT, OLIVE);
  // (the driver's hatch and its vision blocks)
  box(m, [-1.1, 1.9, 3.5], [-0.3, 2.05, 4.2], PAINT, OLIVE_DARK);
  quad(
    m,
    [
      [-1.05, 1.65, 4.34],
      [-0.35, 1.65, 4.34],
      [-0.35, 1.85, 4.3],
      [-1.05, 1.85, 4.3],
    ],
    [0, 0.2, 1],
    GLASS,
    flat(20, 24, 28),
  );
  // (the turret: its platform; its fire-control radar standing at its front — the Fire Dome —, turning with it)
  const tz = U.turretZ;
  box(m, [-1.35, 1.9, tz - 2.9], [1.35, 2.35, tz + 1.4], TURRET, OLIVE);
  box(m, [-0.65, 2.35, tz + 1.15], [0.65, 3.75, tz + 1.55], TURRET, OLIVE_DARK);
  box(m, [-0.55, 3.75, tz + 1.2], [0.55, 3.95, tz + 1.45], TURRET, OLIVE);
  // (the arm: two rails' frames, raised about its pivot at the turret's back)
  box(m, [-1.3, 2.38, U.armZ - 0.05], [1.3, 2.52, U.armZ + 5.3], ARM, STEEL);
  for (const x of [-0.7, 0.7]) box(m, [x - 0.08, 2.52, U.armZ], [x + 0.08, 2.62, U.armZ + 5.2], ARM, STEEL);
  // (its four missiles side by side, their noses forward)
  [-1.05, -0.35, 0.35, 1.05].forEach((x, k) => railMissile(m, k, x, 2.84, U.armZ - 0.1));
  await write(id, m);
}

// ---- a main battle tank: 6.9 m of hull, its turret's dome, its 125 mm gun 5 m out
{
  const id: GroundUnitId = "gu-tank";
  const U = GROUND_UNITS[id];
  const m = mesh();
  track(m, 1.6, 6.9, 0.58, 0.9, 6, 0.36);
  track(m, -1.6, 6.9, 0.58, 0.9, 6, 0.36);
  frustum(m, [-1.4, 0.45, -3.45], [1.4, 1.55, 3.45], 0.1, PAINT, OLIVE);
  // (the side skirts, the glacis' upper plate)
  for (const x of [-1.9, 1.86]) box(m, [x, 0.62, -3.0], [x + 0.04, 1.15, 3.2], PAINT, OLIVE_DARK);
  // (the turret: a flattened dome stood up about its pivot, the commander's cupola on it)
  const t0 = mark(m);
  lathe(
    m,
    0,
    0.78,
    [
      [0, 1.2],
      [0.4, 1.12],
      [0.8, 0.86],
      [1, 0.62],
    ],
    20,
    TURRET,
    OLIVE,
  );
  standUp(m, t0, 1.55, U.turretZ);
  const c0 = mark(m);
  lathe(
    m,
    0,
    0.3,
    [
      [0, 0.32],
      [1, 0.26],
    ],
    12,
    TURRET,
    OLIVE_DARK,
  );
  standUp(m, c0, 2.3, U.turretZ - 0.35);
  transform(
    m,
    c0,
    (p) => [p[0] - 0.45, p[1], p[2]],
    (n) => n,
  );
  // (the gun: its mantlet, its barrel, the bore evacuator halfway, its muzzle)
  box(m, [-0.38, U.armY - 0.28, U.armZ - 0.1], [0.38, U.armY + 0.28, U.armZ + 0.45], ARM, OLIVE_DARK);
  const g0 = mark(m);
  lathe(
    m,
    0,
    5.0,
    [
      [0, 0.11],
      [0.45, 0.095],
      [0.5, 0.13],
      [0.62, 0.13],
      [0.67, 0.09],
      [0.98, 0.085],
      [1, 0.1],
    ],
    14,
    ARM,
    OLIVE_DARK,
  );
  transform(
    m,
    g0,
    (p) => [p[0], U.armY + p[1], U.armZ + 0.4 + p[2]],
    (n) => n,
  );
  await write(id, m);
}

// ---- a 6×6 military truck: its cab and bonnet, its windscreen, the bed's canvas, six wheels
{
  const id: GroundUnitId = "gu-truck";
  const m = mesh();
  box(m, [-0.5, 0.85, -3.4], [0.5, 1.15, 3.2], PAINT, STEEL);
  frustum(m, [-1.05, 1.15, 2.3], [1.05, 2.55, 3.45], 0.06, PAINT, OLIVE);
  frustum(m, [-0.85, 1.15, 3.45], [0.85, 2.0, 4.45], 0.1, PAINT, OLIVE);
  quad(
    m,
    [
      [-0.95, 1.95, 3.47],
      [0.95, 1.95, 3.47],
      [0.92, 2.45, 3.42],
      [-0.92, 2.45, 3.42],
    ],
    [0, 0.1, 1],
    GLASS,
    flat(20, 24, 28),
  );
  box(m, [-1.2, 1.15, -3.3], [1.2, 1.55, 2.15], PAINT, OLIVE_DARK);
  frustum(m, [-1.2, 1.55, -3.3], [1.2, 3.05, 2.15], 0.18, PAINT, SAND);
  for (const z of [3.5, -0.9, -2.35]) for (const x of [-1.0, 1.0]) wheel(m, [x, 0.6, z], 0.6, 0.38, RUBBER, RUBBER_C, 16);
  await write(id, m);
}

// ---- a concrete bunker: a sloped block, its doorway, its earth over the roof
{
  const id: GroundUnitId = "gu-bunker";
  const m = mesh();
  frustum(m, [-6, 0, -5], [6, 3.6, 5], 1.4, CONCRETE, flat(150, 148, 140));
  frustum(m, [-4.2, 3.6, -3.4], [4.2, 4.2, 3.4], 0.9, PAINT, flat(104, 92, 70));
  box(m, [-1.4, 0, 4.95], [1.4, 2.3, 5.02], PAINT, flat(24, 24, 24));
  await write(id, m);
}
