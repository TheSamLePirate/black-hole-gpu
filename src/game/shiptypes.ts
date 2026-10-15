// The real traffic's ships (docs/PLAN-AVIATION-AAA.md, T3): an AIS ship type (or, unknown, its length) → the mesh
// drawn (scripts/build-ships.ts: the container ship, the tanker, the ferry, the trawler, the sailing boat), its
// length and beam (the AIS's, else its kind's), its navigation lights (COLREGs: the masthead lights — two over 50 m
// —, the sidelights, the stern light), how it rolls and pitches in a sea. Pure.

export type ShipMesh = "cargo" | "tanker" | "ferry" | "trawler" | "sailboat" | "frigate";

/** The meshes' own sizes [m] (their length, beam, the height of their masthead over the waterline). */
export const SHIP_MESH: Record<ShipMesh, { len: number; beam: number; mast: number }> = {
  cargo: { len: 300, beam: 42.3, mast: 43 },
  tanker: { len: 300, beam: 42.3, mast: 43 },
  ferry: { len: 150, beam: 26.5, mast: 32 },
  trawler: { len: 28, beam: 8.2, mast: 13 },
  sailboat: { len: 12, beam: 3.9, mast: 17 },
  frigate: { len: 135, beam: 17, mast: 32 },
};

/** What a ship's AIS type says it is: its mesh, its typical length and beam [m], a short name for its label. */
export function shipKindOf(type: number, len = 0): { mesh: ShipMesh; len: number; beam: number; kind: string } {
  const k = (mesh: ShipMesh, l: number, b: number, kind: string) => ({ mesh, len: l, beam: b, kind });
  if (type >= 70 && type <= 79) return k("cargo", 190, 30, "cargo");
  if (type >= 80 && type <= 89) return k("tanker", 180, 30, "tanker");
  if (type >= 60 && type <= 69) return k("ferry", 140, 24, "passenger");
  if (type === 30) return k("trawler", 25, 7, "fishing");
  if (type === 36) return k("sailboat", 12, 3.8, "sailing");
  if (type === 37) return k("sailboat", 11, 3.6, "pleasure");
  if (type === 31 || type === 32 || type === 52) return k("trawler", 30, 10, "tug");
  if (type === 50) return k("trawler", 20, 6, "pilot");
  if (type === 51 || type === 55) return k("trawler", 30, 7, "SAR");
  if (type === 35) return k("frigate", 135, 17, "military");
  if (type >= 40 && type <= 49) return k("ferry", 40, 10, "HSC");
  // (unknown: by its length — a big hull a cargo ship, a small one a workboat)
  if (len > 120) return k("cargo", len, len / 7, "vessel");
  if (len > 45) return k("ferry", len, len / 6, "vessel");
  return k("trawler", len > 0 ? len : 20, len > 0 ? len / 3.5 : 6, "vessel");
}

/** Its length and beam [m]: the AIS's when it gives them (bounded), else its kind's. */
export function shipSize(type: number, len: number, beam: number): { mesh: ShipMesh; len: number; beam: number; kind: string } {
  const K = shipKindOf(type, len);
  const L = len >= 4 && len <= 460 ? len : K.len;
  const B = beam >= 1.5 && beam <= 70 ? beam : (L * K.beam) / K.len;
  return { ...K, len: L, beam: B };
}

/**
 * Its navigation lights (COLREGs, a power-driven vessel underway; a sailing one: its sidelights and stern light
 * alone), in its frame [m] — x its left, y up from its waterline, z its bow —, for its length, beam and mesh:
 * the masthead's white forward, a second higher aft over 50 m, the red to port (its left), the green to starboard,
 * the white at its stern.
 */
export function shipLights(mesh: ShipMesh, len: number, beam: number) {
  const k = len / SHIP_MESH[mesh].len;
  const top = SHIP_MESH[mesh].mast * k;
  const side = Math.min(top * 0.55, 3 + len * 0.06);
  const out: { at: [number, number, number]; colour: "white" | "red" | "green"; size: number }[] = [
    { at: [beam / 2, side, len * 0.12], colour: "red", size: 1.8 },
    { at: [-beam / 2, side, len * 0.12], colour: "green", size: 1.8 },
    { at: [0, Math.min(side, 4 + len * 0.03), -len / 2], colour: "white", size: 1.5 },
  ];
  if (mesh !== "sailboat") {
    out.push({ at: [0, top * (len > 50 ? 0.8 : 1), len * (len > 50 ? 0.3 : 0.1)], colour: "white", size: 2 });
    if (len > 50) out.push({ at: [0, top, -len * 0.25], colour: "white", size: 2 });
  } else out.push({ at: [0, top, len * 0.05], colour: "white", size: 1.2 });
  return out;
}

/**
 * How it moves in a sea at `t` [s]: its roll and pitch [rad] and heave [m] — a hull's own periods (roll ≈ 0.8 B/√GM,
 * pitch ≈ √L/1.25…), smaller the bigger it is, in a sea of significant height `hs` [m]; its phases its own (`seed`).
 */
export function shipMotion(len: number, beam: number, hs: number, t: number, seed: number) {
  const s = Math.max(0, hs);
  const big = Math.min(1, s / Math.max(1, 0.05 * len));
  const rollT = Math.max(4, (0.8 * beam) / Math.sqrt(Math.max(0.5, 0.06 * beam))),
    pitchT = Math.max(2.5, 0.45 * Math.sqrt(len));
  const ph = (seed % 1000) * 0.0137;
  const roll =
    Math.min(12, 2.5 + 40 / Math.sqrt(len)) *
    big *
    (Math.sin((2 * Math.PI * t) / rollT + ph) * 0.8 + 0.2 * Math.sin((2 * Math.PI * t) / (rollT * 0.61) + 2 * ph)) *
    (Math.PI / 180);
  const pitch = Math.min(5, 0.8 + 12 / Math.sqrt(len)) * big * Math.sin((2 * Math.PI * t) / pitchT + 1.3 * ph) * (Math.PI / 180);
  const heave = 0.35 * s * Math.min(1, 25 / len + 0.15) * Math.sin((2 * Math.PI * t) / (pitchT * 1.1) + 0.7 * ph);
  return { roll, pitch, heave };
}

/** Its radar cross-section [m²]: a ship's grows with its size (a big merchant some 10⁴). */
export const shipRcs = (len: number) => Math.max(5, 0.4 * len ** 2);
