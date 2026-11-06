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
import {
  box,
  extrudeX,
  extrudeY,
  flat,
  frustum,
  lathe,
  mark,
  type Mesh,
  mesh,
  ogive,
  plate,
  quad,
  solid,
  transform,
  type V3,
  wheel,
  write,
} from "./lib/trfc";

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

// ---- a main battle tank (a generic modern one): 7 m of hull — its sloped glacis, its fenders and segmented skirts, its engine
// deck's grilles —; seven road wheels a side, the drive sprocket aft, the idler forward, the return rollers, the track's runs;
// its angular turret — its front cheeks, its bustle, the commander's and the gunner's sights, a machine gun, the smoke
// dischargers, two antennas —; its 120 mm gun 5 m out, its thermal sleeve's bands and its bore evacuator
{
  const id: GroundUnitId = "gu-tank";
  const U = GROUND_UNITS[id];
  const m = mesh();
  const TRACK = flat(34, 34, 31);
  // (the running gear, either side: the track's lower and upper runs, its ends round the sprocket and the idler, the wheels)
  for (const sx of [-1, 1]) {
    const x = sx * 1.5,
      w = 0.62;
    box(m, [x - w / 2, 0, -3.15], [x + w / 2, 0.1, 3.0], RUBBER, TRACK);
    box(m, [x - w / 2, 0.86, -3.2], [x + w / 2, 0.95, 3.05], RUBBER, TRACK);
    extrudeX(
      m,
      [
        [0.0, 3.0],
        [0.1, 3.0],
        [0.86, 3.05],
        [0.95, 3.05],
        [0.78, 3.42],
        [0.42, 3.5],
        [0.12, 3.2],
      ],
      x - w / 2,
      x + w / 2,
      RUBBER,
      TRACK,
    );
    extrudeX(
      m,
      [
        [0.0, -3.15],
        [0.12, -3.38],
        [0.5, -3.55],
        [0.86, -3.45],
        [0.95, -3.2],
        [0.86, -3.2],
        [0.1, -3.15],
      ],
      x - w / 2,
      x + w / 2,
      RUBBER,
      TRACK,
    );
    const gx = x + sx * (w / 2 - 0.08);
    for (let k = 0; k < 7; k++) wheel(m, [gx, 0.37, -2.55 + k * 0.82], 0.34, 0.16, RUBBER, flat(52, 56, 46), 16);
    wheel(m, [gx, 0.52, -3.25], 0.3, 0.2, RUBBER, flat(44, 46, 40), 12);
    wheel(m, [gx, 0.52, 3.15], 0.28, 0.2, RUBBER, flat(44, 46, 40), 12);
    for (const z of [-1.6, 0.1, 1.8]) wheel(m, [gx, 0.84, z], 0.09, 0.12, RUBBER, flat(44, 46, 40), 8);
  }
  // (the hull, a side view extruded across: the belly, the sloped glacis to the nose, the deck, the rear plate)
  extrudeX(
    m,
    [
      [0.42, -3.35],
      [0.42, 2.9],
      [0.75, 3.55],
      [1.18, 3.55],
      [1.45, 2.55],
      [1.45, -3.2],
      [1.2, -3.5],
    ],
    -1.2,
    1.2,
    PAINT,
    OLIVE,
  );
  // (over the tracks: the sponsons and their fenders)
  for (const sx of [-1, 1]) {
    // (down to 0.9 m, over the track's upper run: the hull and its running gear one — a gap under them had shown the tracks apart,
    // Sam)
    extrudeX(
      m,
      [
        [0.9, -3.45],
        [0.9, 3.3],
        [1.12, 3.5],
        [1.45, 2.55],
        [1.45, -3.2],
      ],
      sx * 1.18,
      sx * 1.86,
      PAINT,
      OLIVE,
    );
    // (the skirts: six plates with their gaps, a little out)
    for (let k = 0; k < 6; k++)
      box(m, [sx * 1.87 - 0.02, 0.5, -3.0 + k * 1.03], [sx * 1.87 + 0.02, 1.02, -2.04 + k * 1.03], PAINT, OLIVE_DARK);
  }
  // (the engine deck's grilles aft, the driver's hatch forward)
  for (const z of [-2.9, -2.35]) box(m, [-0.95, 1.45, z], [0.95, 1.48, z + 0.45], PAINT, flat(40, 44, 34));
  box(m, [-0.35, 1.45, 2.0], [0.35, 1.5, 2.45], PAINT, OLIVE_DARK);
  // (the turret, angular: its front cheeks sloping in to the gun, its sides, its bustle aft)
  const tz = U.turretZ;
  extrudeY(
    m,
    [
      [-1.6, tz - 1.55],
      [1.6, tz - 1.55],
      [1.75, tz + 0.8],
      [1.1, tz + 1.85],
      [-1.1, tz + 1.85],
      [-1.75, tz + 0.8],
    ],
    1.45,
    2.25,
    TURRET,
    OLIVE,
    0.12,
  );
  extrudeY(
    m,
    [
      [-1.25, tz - 2.55],
      [1.25, tz - 2.55],
      [1.35, tz - 1.5],
      [-1.35, tz - 1.5],
    ],
    1.55,
    2.15,
    TURRET,
    OLIVE_DARK,
    0.05,
  );
  // (the sights: the commander's panoramic one on its pedestal, the gunner's box; a machine gun on its ring; two antennas)
  const s0 = mark(m);
  lathe(
    m,
    0,
    0.4,
    [
      [0, 0.2],
      [0.6, 0.2],
      [0.62, 0.24],
      [1, 0.22],
    ],
    12,
    TURRET,
    OLIVE_DARK,
  );
  standUp(m, s0, 2.25, tz - 0.4);
  transform(
    m,
    s0,
    (p) => [p[0] + 0.7, p[1], p[2]],
    (n) => n,
  );
  box(m, [-0.95, 2.25, tz + 0.75], [-0.45, 2.55, tz + 1.15], TURRET, OLIVE_DARK);
  quad(
    m,
    [
      [-0.92, 2.3, tz + 1.16],
      [-0.48, 2.3, tz + 1.16],
      [-0.48, 2.5, tz + 1.16],
      [-0.92, 2.5, tz + 1.16],
    ],
    [0, 0, 1],
    GLASS,
    flat(20, 24, 28),
  );
  const mg = mark(m);
  lathe(
    m,
    0,
    1.1,
    [
      [0, 0.03],
      [1, 0.025],
    ],
    8,
    TURRET,
    flat(30, 30, 30),
  );
  transform(
    m,
    mg,
    (p) => [p[0] - 0.3, p[1] + 2.42, p[2] + tz - 0.6],
    (n) => n,
  );
  for (const x of [-0.9, 0.9]) {
    const a0 = mark(m);
    lathe(
      m,
      0,
      2.2,
      [
        [0, 0.012],
        [1, 0.006],
      ],
      6,
      TURRET,
      flat(30, 30, 30),
    );
    standUp(m, a0, 2.15, tz - 2.3);
    transform(
      m,
      a0,
      (p) => [p[0] + x, p[1], p[2]],
      (n) => n,
    );
  }
  // (the smoke dischargers: four tubes each side of the front, raised and splayed)
  for (const sx of [-1, 1])
    for (let k = 0; k < 4; k++) {
      const d0 = mark(m);
      lathe(
        m,
        0,
        0.32,
        [
          [0, 0.045],
          [1, 0.045],
        ],
        8,
        TURRET,
        OLIVE_DARK,
      );
      const yaw = sx * (0.5 + 0.12 * k),
        pit = 0.45;
      transform(
        m,
        d0,
        (p) => {
          const y = p[1] * Math.cos(pit) + p[2] * Math.sin(pit),
            z = -p[1] * Math.sin(pit) + p[2] * Math.cos(pit);
          return [
            sx * (1.5 - 0.08 * k) + p[0] * Math.cos(yaw) + z * Math.sin(yaw),
            2.05 + 0.03 * k + y,
            tz + 0.9 - p[0] * Math.sin(yaw) + z * Math.cos(yaw),
          ];
        },
        (n) => n,
      );
    }
  // (the gun: its mantlet, its barrel — the thermal sleeve's bands, the bore evacuator, the muzzle's reference)
  box(m, [-0.42, U.armY - 0.3, U.armZ - 0.2], [0.42, U.armY + 0.3, U.armZ + 0.4], ARM, OLIVE_DARK);
  const g0 = mark(m);
  const prof: [number, number][] = [[0, 0.13]];
  for (let k = 0; k < 6; k++) prof.push([0.05 + k * 0.08, 0.115], [0.09 + k * 0.08, 0.108]);
  prof.push([0.55, 0.108], [0.57, 0.14], [0.68, 0.14], [0.7, 0.1], [0.97, 0.095], [0.98, 0.11], [1, 0.11]);
  lathe(m, 0, 5.1, prof, 16, ARM, OLIVE_DARK);
  transform(
    m,
    g0,
    (p) => [p[0], U.armY + p[1], U.armZ + 0.35 + p[2]],
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

// ---- the airfield's targets (the war mode's « Guerre : base aérienne »): a hardened aircraft shelter — its concrete arch and its
// ribs, its two-leaf blast door in its frame, its exhaust vent aft, its earth banks along its sides —; a control tower — its
// two-storey base with its windows, its striped shaft, its octagonal glass cab between its mullions, its catwalk and railing,
// its roof's antennas and radome —; a fuel tank — its coned roof, its rings, its stair, its pipe — in its bund; and a bomb's
// crater (scorched ground, its rim of thrown earth)
const CONC = flat(158, 154, 144);
const CONC_DARK = flat(118, 114, 106);
const STEEL_DOOR = flat(78, 82, 74);
const DARK_GLASS = flat(18, 24, 30);
const EARTH = flat(150, 128, 98);
{
  const id: GroundUnitId = "gu-has";
  const m = mesh();
  // (the arch: its half above the ground — 9 m of radius, its foot 2.2 m under the ground's level —, 30 m long; a rib every 6 m)
  const arch = (z: number, r = 9): V3[] =>
    Array.from({ length: 25 }, (_, k) => {
      const a = Math.asin(2.2 / r) + ((Math.PI - 2 * Math.asin(2.2 / r)) * k) / 24;
      return [r * Math.cos(a), r * Math.sin(a) - 2.2, z] as V3;
    });
  solid(m, arch(-15), arch(15), CONCRETE, CONC);
  for (let k = 0; k <= 5; k++) solid(m, arch(-15 + 6 * k - 0.25, 9.18), arch(-15 + 6 * k + 0.25, 9.18), CONCRETE, CONC_DARK);
  // (the front: its headwall round the door; the door's two leaves, their frames, the gap between them)
  extrudeX(
    m,
    [
      [0, 15.0],
      [0, 16.2],
      [7.4, 16.2],
      [7.4, 15.0],
    ],
    -9.4,
    -6.2,
    CONCRETE,
    CONC_DARK,
  );
  extrudeX(
    m,
    [
      [0, 15.0],
      [0, 16.2],
      [7.4, 16.2],
      [7.4, 15.0],
    ],
    6.2,
    9.4,
    CONCRETE,
    CONC_DARK,
  );
  box(m, [-6.2, 6.4, 15.0], [6.2, 7.4, 16.2], CONCRETE, CONC_DARK);
  for (const sx of [-1, 1]) {
    box(m, [sx > 0 ? 0.05 : -6.15, 0, 15.6], [sx > 0 ? 6.15 : -0.05, 6.4, 15.9], PAINT, STEEL_DOOR);
    for (let k = 1; k < 4; k++)
      box(m, [sx > 0 ? 0.2 : -6.0, k * 1.6 - 0.06, 15.88], [sx > 0 ? 6.0 : -0.2, k * 1.6 + 0.06, 15.95], PAINT, flat(60, 64, 58));
  }
  // (aft: the exhaust vent's box)
  box(m, [-2.2, 0, -16.4], [2.2, 4.2, -15.0], CONCRETE, CONC_DARK);
  box(m, [-1.6, 1.2, -16.45], [1.6, 3.6, -16.38], PAINT, flat(30, 30, 30));
  // (the earth banked along its sides, to half its height)
  for (const sx of [-1, 1])
    extrudeX(
      m,
      [
        [0, -15],
        [0, 15],
        [3.8, 14.0],
        [3.8, -14.0],
      ],
      sx * 6.2,
      sx * 11.5,
      PAINT,
      EARTH,
    );
  await write(id, m);
}
{
  const id: GroundUnitId = "gu-tower";
  const m = mesh();
  // (the base: two storeys, its windows in bands round it, its door)
  box(m, [-7, 0, -5], [7, 7, 5], CONCRETE, flat(204, 198, 186));
  for (const y of [1.2, 4.6])
    for (const [a, b, n] of [
      [
        [-6.4, 5.02],
        [6.4, 5.02],
        [0, 0, 1],
      ],
      [
        [-6.4, -5.02],
        [6.4, -5.02],
        [0, 0, -1],
      ],
    ] as const)
      quad(
        m,
        [
          [a[0], y, a[1]],
          [b[0], y, b[1]],
          [b[0], y + 1.5, b[1]],
          [a[0], y + 1.5, a[1]],
        ],
        [n[0], n[1], n[2]],
        GLASS,
        DARK_GLASS,
      );
  box(m, [-1, 0, 5.02], [1, 2.4, 5.1], PAINT, flat(60, 62, 66));
  frustum(m, [-7.2, 7, -5.2], [7.2, 7.4, 5.2], 0.1, PAINT, flat(150, 148, 142));
  // (the shaft: 14 m, its red and white bands)
  for (let k = 0; k < 7; k++) box(m, [-2, 7.4 + 2 * k, -2], [2, 9.4 + 2 * k, 2], CONCRETE, k % 2 ? flat(190, 40, 34) : flat(226, 224, 216));
  // (the cab: an octagon of glass leaning out, its mullions; its floor's slab, its catwalk's railing)
  const R0 = 4.2,
    R1 = 4.8,
    y0 = 22.2,
    y1 = 25.4;
  const oct = (r: number, y: number): V3[] =>
    Array.from(
      { length: 8 },
      (_, k) => [r * Math.cos((k * Math.PI) / 4 + Math.PI / 8), y, r * Math.sin((k * Math.PI) / 4 + Math.PI / 8)] as V3,
    );
  solid(m, oct(5.6, 21.4), oct(5.6, 22.2), CONCRETE, flat(170, 168, 160));
  solid(
    m,
    oct(2.6, 21.4),
    oct(4.6, 21.4).map((p) => [p[0], 21.4, p[2]] as V3),
    CONCRETE,
    flat(170, 168, 160),
  );
  const lo = oct(R0, y0),
    hi = oct(R1, y1);
  for (let k = 0; k < 8; k++) {
    const j = (k + 1) % 8;
    const mid = [(lo[k]![0] + lo[j]![0]) / 2, 0, (lo[k]![2] + lo[j]![2]) / 2];
    const l = Math.hypot(mid[0]!, mid[2]!);
    quad(m, [lo[k]!, lo[j]!, hi[j]!, hi[k]!], [mid[0]! / l, 0.2, mid[2]! / l], GLASS, DARK_GLASS);
    const ml = mark(m);
    box(m, [-0.08, y0, -0.08], [0.08, y1, 0.08], PAINT, flat(60, 62, 66));
    transform(
      m,
      ml,
      (p) => [
        p[0] + lo[k]![0] + (hi[k]![0] - lo[k]![0]) * ((p[1] - y0) / (y1 - y0)),
        p[1],
        p[2] + lo[k]![2] + (hi[k]![2] - lo[k]![2]) * ((p[1] - y0) / (y1 - y0)),
      ],
      (n) => n,
    );
  }
  for (let k = 0; k < 8; k++) {
    const a = oct(5.5, 22.2)[k]!,
      b = oct(5.5, 22.2)[(k + 1) % 8]!;
    const rl = mark(m);
    box(m, [-0.04, 0, -0.04], [0.04, 1.0, 0.04], PAINT, flat(200, 200, 196));
    transform(
      m,
      rl,
      (p) => [p[0] + a[0], p[1] + 22.2, p[2] + a[2]],
      (n) => n,
    );
    quad(
      m,
      [
        [a[0], 23.1, a[2]],
        [b[0], 23.1, b[2]],
        [b[0], 23.2, b[2]],
        [a[0], 23.2, a[2]],
      ],
      [a[0], 0, a[2]],
      PAINT,
      flat(200, 200, 196),
    );
  }
  solid(m, oct(5.2, 25.4), oct(4.2, 26.0), PAINT, flat(120, 120, 116));
  // (on the roof: two masts, a radome)
  for (const x of [-2.5, 2.5]) box(m, [x - 0.06, 26, -0.06], [x + 0.06, 30, 0.06], PAINT, flat(200, 200, 196));
  const rd = mark(m);
  lathe(
    m,
    0,
    1.6,
    Array.from({ length: 7 }, (_, k) => [k / 6, 1.0 * Math.cos((k / 6) * Math.PI * 0.5)] as [number, number]),
    16,
    PAINT,
    flat(230, 230, 226),
  );
  standUp(m, rd, 26, -1.5);
  await write(id, m);
}
{
  const id: GroundUnitId = "gu-fuel";
  const m = mesh();
  // (the tank: its shell, its stiffening rings, its coned roof, its spiral stair's flights, its pipe out to the bund's edge)
  const t0 = mark(m);
  lathe(
    m,
    0,
    8,
    [
      [0, 6],
      [1, 6],
    ],
    32,
    PAINT,
    flat(214, 214, 206),
  );
  standUp(m, t0, 0, 0);
  for (const y of [2.6, 5.3]) {
    const r0 = mark(m);
    lathe(
      m,
      0,
      0.18,
      [
        [0, 6.08],
        [1, 6.08],
      ],
      32,
      PAINT,
      flat(190, 190, 184),
    );
    standUp(m, r0, y, 0);
  }
  const c0 = mark(m);
  lathe(
    m,
    0,
    1.1,
    [
      [0, 6.05],
      [1, 0.4],
    ],
    32,
    PAINT,
    flat(196, 196, 190),
  );
  standUp(m, c0, 8, 0);
  for (let k = 0; k < 6; k++) {
    const a = -0.4 + k * 0.32;
    const st = mark(m);
    box(m, [-0.45, -0.05, 0], [0.45, 0.05, 1.5], PAINT, flat(150, 150, 146));
    transform(
      m,
      st,
      (p) => {
        const ca = Math.cos(a),
          sa = Math.sin(a);
        const x = 6.5 * ca - (p[2] - 0.75) * sa + p[0] * ca * 0,
          z = 6.5 * sa + (p[2] - 0.75) * ca;
        return [x + p[0] * ca, p[1] + 0.5 + k * 1.3 + (p[2] / 1.5) * 1.3, z + p[0] * sa];
      },
      (n) => n,
    );
  }
  const p0 = mark(m);
  lathe(
    m,
    0,
    4,
    [
      [0, 0.25],
      [1, 0.25],
    ],
    10,
    PAINT,
    flat(120, 120, 116),
  );
  transform(
    m,
    p0,
    (p) => [p[0] + 6, p[1] + 0.5, p[2] - 2],
    (n) => n,
  );
  for (const [x0, z0, x1, z1] of [
    [-9, -9, 9, -8.6],
    [-9, 8.6, 9, 9],
    [-9, -9, -8.6, 9],
    [8.6, -9, 9, 9],
  ])
    box(m, [x0!, 0, z0!], [x1!, 1.4, z1!], CONCRETE, CONC_DARK);
  await write(id, m);
}
{
  const id: GroundUnitId = "gu-crater";
  const m = mesh();
  const c0 = mark(m);
  lathe(
    m,
    0,
    0.12,
    [
      [0, 5.2],
      [1, 5.0],
    ],
    24,
    PAINT,
    flat(34, 28, 22),
  );
  standUp(m, c0, 0, 0);
  const r0 = mark(m);
  lathe(
    m,
    0,
    0.7,
    [
      [0, 7.4],
      [0.5, 6.4],
      [1, 5.3],
    ],
    24,
    PAINT,
    flat(96, 82, 64),
  );
  standUp(m, r0, 0, 0);
  await write(id, m);
}
