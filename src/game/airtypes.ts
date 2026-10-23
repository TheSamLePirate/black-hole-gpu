// The real traffic's aircraft types (docs/PLAN-AVIATION-AAA.md, T2): an ICAO type designator (or, unknown, its
// ADS-B category) → the mesh drawn (the A320's for the jets, the CRJ-900's for the regional, business and light
// aircraft — none for a helicopter: its lights alone) and its length [m] (the mesh scaled to it), its wingspan for a
// formation's clearance. Pure.

export type AirlinerMesh = "a320t" | "crj900";

/** The meshes' own lengths and spans [m] (scripts/build-airliners.ts), and where on them [m, the mesh's frame: x its
 *  left, y up, z its nose] its lights are — a wingtip's navigation light (the left one: x > 0), the tail's, the
 *  beacon on its back, the landing lights under its nose — and how far its wheels are under its origin. */
export const MESH = {
  a320t: {
    len: 37.7,
    span: 34.2,
    tip: [16.83, 0.87, -4.14],
    tail: [0, 1.4, -21.1],
    beacon: [0, 2.1, 1.5],
    landing: [0, -1.3, 11.4],
    wheels: 3.9,
  },
  crj900: {
    len: 36.2,
    span: 23.2,
    tip: [11.58, 1.0, -4.62],
    tail: [0, 1.2, -18.1],
    beacon: [0, 1.6, 2.0],
    landing: [0, -0.9, 14.0],
    wheels: 2.2,
  },
} as const;

/** By type designator: its mesh and length [m]. */
const TYPES: Record<string, [AirlinerMesh, number]> = {
  // narrow-bodies
  A318: ["a320t", 31.4],
  A319: ["a320t", 33.8],
  A320: ["a320t", 37.6],
  A321: ["a320t", 44.5],
  A19N: ["a320t", 33.8],
  A20N: ["a320t", 37.6],
  A21N: ["a320t", 44.5],
  B736: ["a320t", 31.2],
  B737: ["a320t", 33.6],
  B738: ["a320t", 39.5],
  B739: ["a320t", 42.1],
  B37M: ["a320t", 35.6],
  B38M: ["a320t", 39.5],
  B39M: ["a320t", 42.2],
  B3XM: ["a320t", 43.8],
  B752: ["a320t", 47.3],
  B753: ["a320t", 54.4],
  C919: ["a320t", 38.9],
  BCS1: ["crj900", 35.0],
  BCS3: ["crj900", 38.7],
  // wide-bodies
  A332: ["a320t", 58.8],
  A333: ["a320t", 63.7],
  A338: ["a320t", 58.8],
  A339: ["a320t", 63.7],
  A343: ["a320t", 63.7],
  A346: ["a320t", 75.3],
  A359: ["a320t", 66.8],
  A35K: ["a320t", 73.8],
  A388: ["a320t", 72.7],
  B744: ["a320t", 70.7],
  B748: ["a320t", 76.3],
  B763: ["a320t", 54.9],
  B764: ["a320t", 61.4],
  B772: ["a320t", 63.7],
  B77L: ["a320t", 63.7],
  B77W: ["a320t", 73.9],
  B788: ["a320t", 56.7],
  B789: ["a320t", 62.8],
  B78X: ["a320t", 68.3],
  A310: ["a320t", 46.7],
  A306: ["a320t", 54.1],
  MD11: ["a320t", 61.6],
  B762: ["a320t", 48.5],
  // regional
  CRJ2: ["crj900", 26.8],
  CRJ7: ["crj900", 32.5],
  CRJ9: ["crj900", 36.2],
  CRJX: ["crj900", 39.1],
  E170: ["crj900", 29.9],
  E175: ["crj900", 31.7],
  E75L: ["crj900", 31.7],
  E75S: ["crj900", 31.7],
  E190: ["crj900", 36.2],
  E195: ["crj900", 38.7],
  E290: ["crj900", 36.2],
  E295: ["crj900", 41.5],
  AT43: ["crj900", 22.7],
  AT45: ["crj900", 22.7],
  AT72: ["crj900", 27.2],
  AT75: ["crj900", 27.2],
  AT76: ["crj900", 27.2],
  DH8D: ["crj900", 32.8],
  SB20: ["crj900", 27.3],
  F100: ["crj900", 35.5],
  RJ85: ["crj900", 28.6],
  RJ1H: ["crj900", 31.0],
  // business jets
  C510: ["crj900", 12.4],
  C525: ["crj900", 12.9],
  C25A: ["crj900", 13.0],
  C25B: ["crj900", 14.4],
  C25C: ["crj900", 16.3],
  C56X: ["crj900", 15.8],
  C68A: ["crj900", 19.4],
  C700: ["crj900", 22.3],
  CL30: ["crj900", 20.9],
  CL35: ["crj900", 20.9],
  CL60: ["crj900", 20.9],
  GL5T: ["crj900", 29.5],
  GLEX: ["crj900", 30.3],
  GL7T: ["crj900", 33.8],
  GLF4: ["crj900", 26.9],
  GLF5: ["crj900", 29.4],
  GLF6: ["crj900", 30.4],
  G280: ["crj900", 20.4],
  F2TH: ["crj900", 20.2],
  F900: ["crj900", 20.2],
  FA7X: ["crj900", 23.2],
  FA8X: ["crj900", 24.5],
  E50P: ["crj900", 12.8],
  E55P: ["crj900", 15.6],
  PC24: ["crj900", 16.9],
  LJ45: ["crj900", 17.7],
  LJ75: ["crj900", 17.7],
  H25B: ["crj900", 15.6],
  PRM1: ["crj900", 14.0],
  // light and turboprop aircraft
  C150: ["crj900", 7.3],
  C152: ["crj900", 7.3],
  C172: ["crj900", 8.3],
  C182: ["crj900", 8.8],
  C206: ["crj900", 8.6],
  C208: ["crj900", 11.5],
  P28A: ["crj900", 7.3],
  PA28: ["crj900", 7.3],
  PA32: ["crj900", 8.4],
  SR20: ["crj900", 7.9],
  SR22: ["crj900", 7.9],
  DA40: ["crj900", 8.0],
  DA42: ["crj900", 8.6],
  BE20: ["crj900", 13.4],
  BE9L: ["crj900", 10.8],
  PC12: ["crj900", 14.4],
  TBM7: ["crj900", 10.6],
  TBM9: ["crj900", 10.7],
  DR40: ["crj900", 7.0],
};

/** Helicopters' designators (their lights alone: no mesh fits). */
const ROTOR =
  /^(H1[2-6]\d|EC[1-9]\d|AS[35]\d|A1[0-9]{2}|AW1\d\d|B06|B407|B412|B429|R22|R44|R66|S76|S92|H60|EH10|NH90|MI\d+|KA\d+|BK17|CABR)/;

/** The aircraft's mesh (null: a helicopter — its lights alone), its length and span [m]. */
export function airframeOf(type: string, cat = ""): { mesh: AirlinerMesh | null; len: number; span: number } {
  const t = type.toUpperCase();
  const k = TYPES[t];
  if (k) return { mesh: k[0], len: k[1], span: (MESH[k[0]].span * k[1]) / MESH[k[0]].len };
  if (ROTOR.test(t) || cat === "A7") return { mesh: null, len: 12, span: 11 };
  // (unknown: by its wake category — light, small, large, high vortex, heavy)
  const byCat: Record<string, [AirlinerMesh, number]> = {
    A1: ["crj900", 8],
    A2: ["crj900", 16],
    A3: ["a320t", 37.6],
    A4: ["a320t", 47],
    A5: ["a320t", 64],
  };
  const c = byCat[cat] ?? ["a320t", 37.6];
  return { mesh: c[0], len: c[1], span: (MESH[c[0]].span * c[1]) / MESH[c[0]].len };
}

/** Its radar cross-section [m²] by its length: a light aircraft's few, an airliner's tens, a heavy's a hundred. */
export const rcsOf = (len: number) => 2 + 40 * (len / 37.6) ** 2;
