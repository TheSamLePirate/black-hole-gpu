// The missiles' meshes (src/game/missile-models.ts), in the craft's mesh format for ship.ts ("TRFC", as the traffic's —
// scripts/build-tanker.ts): the AIM-120C, the AIM-9X, the 9M38 (SA-11) and the JSM — procedural (no licence to carry): their
// bodies lathed (the radome's ogive, the IR dome, the boat-tail, the nozzle), their wings and fins closed plates, their
// markings (a live warhead's yellow band, a live motor's brown one) rings of paint, their rail lugs.
//   bun scripts/build-missiles.ts
// Materials (ship.wgsl): 92 the body's paint (its sRGB colour packed in the UV, as 90), 93–96 the control fins k = 0…3 (the
// same paint, turned about their hinge by the deflection the renderer gives), 97 the seeker's dome (glass), 98 the nozzle.

import { MISSILE_SHAPES, type MissileMeshId } from "../src/game/missile-models";
import { flat, lathe, lug, type Mesh, mesh, ogive, plate, write } from "./lib/trfc";

const BODY = 92,
  FIN = 93,
  DOME = 97,
  NOZZLE = 98;
const WHITE = flat(222, 222, 216);
const RADOME = flat(236, 234, 226);
const YELLOW = flat(214, 170, 30);
const BROWN = flat(112, 72, 40);
const DARK = flat(44, 44, 46);
const SEG = 28;

/** the body: a boat-tail, the paint, its two bands, the nozzle — from z0 (the tail) to zN (where the nose begins) */
function body(
  m: Mesh,
  R: number,
  z0: number,
  zN: number,
  bands: [number, [number, number]][],
  paint: [number, number],
  nozzleR: number,
  seg = SEG,
  facets = false,
) {
  const L = zN - z0;
  const tailL = Math.min(0.12, 0.05 * L);
  lathe(
    m,
    z0,
    z0 + tailL,
    [
      [0, R * 0.86],
      [1, R],
    ],
    seg,
    BODY,
    paint,
    facets,
  );
  // (the paint between the bands, the bands a hair proud of it)
  const cuts = [z0 + tailL, ...bands.flatMap(([z]) => [z - 0.025, z + 0.025]), zN].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i += 2)
    lathe(
      m,
      cuts[i]!,
      cuts[i + 1]!,
      [
        [0, R],
        [1, R],
      ],
      seg,
      BODY,
      paint,
      facets,
    );
  for (const [z, c] of bands)
    lathe(
      m,
      z - 0.025,
      z + 0.025,
      [
        [0, R * 1.004],
        [1, R * 1.004],
      ],
      seg,
      BODY,
      c,
      facets,
    );
  // (the nozzle: its lip, its dark throat)
  lathe(
    m,
    z0 - 0.04,
    z0 + 0.005,
    [
      [0, nozzleR],
      [1, R * 0.8],
    ],
    seg,
    NOZZLE,
    DARK,
  );
  lathe(
    m,
    z0 + 0.0,
    z0 + 0.06,
    [
      [0, nozzleR * 0.95],
      [1, nozzleR * 0.4],
    ],
    seg,
    NOZZLE,
    flat(20, 20, 22),
  );
}

/** the four control fins (FIN + k), at the shape's roll — their hinge about its station */
function fins(
  m: Mesh,
  id: MissileMeshId,
  span: number,
  zLE: number,
  zTE: number,
  tLE: number,
  tTE: number,
  thick: number,
  paint: [number, number],
) {
  const S = MISSILE_SHAPES[id];
  for (let k = 0; k < 4; k++) plate(m, S.roll0 + (k * Math.PI) / 2, S.radius * 0.98, span, zLE, zTE, tLE, tTE, thick, FIN + k, paint);
}

// ---- AIM-120C (3.66 m, Ø 178 mm): the radome's ogive, clipped mid wings, tail control fins in an X, two rail lugs
{
  const id: MissileMeshId = "msl-aim120";
  const S = MISSILE_SHAPES[id];
  const m = mesh();
  const zt = -S.len / 2,
    zn = S.len / 2 - 0.55;
  body(
    m,
    S.radius,
    zt,
    zn,
    [
      [0.62, YELLOW],
      [-0.35, BROWN],
    ],
    WHITE,
    S.nozzleR,
  );
  lathe(m, zn, S.len / 2, ogive(S.radius, 0.006), SEG, BODY, RADOME);
  for (let k = 0; k < 4; k++) plate(m, S.roll0 + (k * Math.PI) / 2, S.radius * 0.98, 0.2, 0.3, -0.2, -0.04, -0.17, 0.008, BODY, WHITE);
  fins(m, id, 0.21, -1.4, -1.78, -1.58, -1.8, 0.007, WHITE);
  // (the lugs on its top — the launcher's rail, the bay's ejector)
  for (const z of [0.55, -0.6]) lug(m, Math.PI / 2, S.radius, z, 0.03, 0.02, 0.07, BODY, flat(160, 160, 156));
  await write(id, m);
}

// ---- AIM-9X (3.02 m, Ø 127 mm): the IR dome, small fixed fins forward, tail control fins
{
  const id: MissileMeshId = "msl-aim9x";
  const S = MISSILE_SHAPES[id];
  const m = mesh();
  const zt = -S.len / 2,
    zd = S.len / 2 - S.radius;
  body(
    m,
    S.radius,
    zt,
    zd - 0.12,
    [
      [0.95, YELLOW],
      [-0.4, BROWN],
    ],
    WHITE,
    S.nozzleR,
  );
  // (the seeker's housing narrowing to the dome, the dome a hemisphere of glass)
  lathe(
    m,
    zd - 0.12,
    zd,
    [
      [0, S.radius],
      [1, S.radius * 0.97],
    ],
    SEG,
    BODY,
    WHITE,
  );
  lathe(
    m,
    zd,
    S.len / 2,
    Array.from({ length: 9 }, (_, i) => [i / 8, S.radius * 0.97 * Math.cos((i / 8) * Math.PI * 0.5)] as [number, number]),
    SEG,
    DOME,
    flat(30, 34, 40),
  );
  for (let k = 0; k < 4; k++) plate(m, S.roll0 + (k * Math.PI) / 2, S.radius * 0.98, 0.045, 1.12, 0.92, 1.0, 0.92, 0.005, BODY, WHITE);
  fins(m, id, 0.11, -1.15, -1.46, -1.32, -1.48, 0.006, WHITE);
  for (const z of [0.6, -0.55]) lug(m, Math.PI / 2, S.radius, z, 0.025, 0.018, 0.06, BODY, flat(160, 160, 156));
  await write(id, m);
}

// ---- 9M38 (SA-11, 5.55 m, Ø 400 mm): a long ogive, long low wings, tail control fins in a +
{
  const id: MissileMeshId = "msl-sam";
  const S = MISSILE_SHAPES[id];
  const m = mesh();
  const paint = flat(206, 210, 198);
  const zt = -S.len / 2,
    zn = S.len / 2 - 0.95;
  body(m, S.radius, zt, zn, [[0.9, flat(150, 40, 36)]], paint, S.nozzleR);
  lathe(m, zn, S.len / 2, ogive(S.radius, 0.012, 12), SEG, BODY, paint);
  for (let k = 0; k < 4; k++) plate(m, S.roll0 + (k * Math.PI) / 2, S.radius * 0.98, 0.26, 1.0, -1.6, -0.6, -1.62, 0.014, BODY, paint);
  fins(m, id, 0.36, -2.0, -2.7, -2.32, -2.74, 0.012, paint);
  await write(id, m);
}

// ---- JSM (4 m): a faceted body (six sides), a chisel nose, two wings folded out, tail fins in an X, its intake under it
{
  const id: MissileMeshId = "msl-jsm";
  const S = MISSILE_SHAPES[id];
  const m = mesh();
  const paint = flat(96, 102, 106);
  const zt = -S.len / 2,
    zn = S.len / 2 - 0.8;
  body(m, S.radius, zt, zn, [], paint, S.nozzleR, 6, true);
  lathe(
    m,
    zn,
    S.len / 2,
    [
      [0, S.radius],
      [0.5, S.radius * 0.7],
      [1, 0.02],
    ],
    6,
    BODY,
    paint,
    true,
  );
  for (const roll of [0, Math.PI]) plate(m, roll, S.radius * 0.95, 0.62, 0.35, -0.35, -0.22, -0.52, 0.016, BODY, paint);
  fins(m, id, 0.3, -1.42, -1.92, -1.7, -1.96, 0.012, paint);
  lug(m, -Math.PI / 2, S.radius * 0.9, -0.3, 0.16, 0.07, 0.5, BODY, flat(60, 64, 66));
  await write(id, m);
}

// ---- GBU-32 JDAM (3.84 m, Ø 357 mm): a Mk 83's olive body — its blunt ogive, its yellow band —, the kit's strakes along it, the
// tail kit's cone and its four control fins in an X
{
  const id: MissileMeshId = "msl-gbu32";
  const S = MISSILE_SHAPES[id];
  const m = mesh();
  const OLIVE = flat(92, 98, 70);
  const zt = -S.len / 2;
  lathe(
    m,
    zt,
    zt + 0.9,
    [
      [0, 0.09],
      [0.6, 0.16],
      [1, S.radius],
    ],
    SEG,
    BODY,
    flat(70, 74, 60),
  );
  body(m, S.radius, zt + 0.9, S.len / 2 - 0.85, [[0.55, YELLOW]], OLIVE, 0.0);
  lathe(m, S.len / 2 - 0.85, S.len / 2, ogive(S.radius, 0.05, 10), SEG, BODY, OLIVE);
  for (let k = 0; k < 4; k++)
    plate(m, S.roll0 + (k * Math.PI) / 2, S.radius * 0.97, 0.05, 0.35, -0.9, 0.3, -0.85, 0.01, BODY, flat(70, 74, 60));
  fins(m, id, 0.3, -1.35, -1.85, -1.6, -1.88, 0.01, flat(70, 74, 60));
  lug(m, Math.PI / 2, S.radius, 0.35, 0.04, 0.05, 0.1, BODY, flat(160, 160, 156));
  await write(id, m);
}
