// The real traffic's liveries (Sam, 24 Nov 2026: « les avions proches portent tous la livrée de l'A320 du jeu »): each airliner's
// paint from its callsign's ICAO airline designator (its first three letters — « UAL2623 » United's), a few colours laid on the
// aircraft's own regions by the craft's shader (ship.wgsl trafficPaint: its fin, a cheatline under its windows, its lower or
// upper fuselage, its engines' nacelles) over a white airframe — no texture, no name, no logo, no trade mark: colours only. An
// airline not in the table: a plain white aircraft, its fin one of a few muted colours chosen by its designator (the same
// airline always the same). Pure.

export type Rgb = readonly [number, number, number];

/** How the colours lie on the airframe: its fin alone (`tail`); a cheatline under the windows (`cheat`); the lower fuselage
 *  from under the windows down (`belly`, its edge the cheatline's colour); the upper fuselage over the windows (`crown`, the
 *  lower white); the whole fuselage (`body`). */
export type PaintPattern = "tail" | "cheat" | "belly" | "crown" | "body";

export interface Livery {
  /** the table's key, or "" for the generic paint */
  icao: string;
  pattern: PaintPattern;
  /** the fin; the cheatline (a band under the windows, the belly's or the crown's edge); the fuselage's painted part (the lower
   *  for `belly`, the upper for `crown`, all of it for `body`); the engines' nacelles — sRGB 0…255 */
  tail: Rgb;
  stripe: Rgb;
  body: Rgb;
  engine: Rgb;
}

/** the patterns' codes in the shader's record (ship.wgsl trafficPaint): 0 none — the mesh's own map — then these */
export const PATTERN_CODE: Record<PaintPattern, number> = { tail: 1, cheat: 2, belly: 3, crown: 4, body: 5 };

const WHITE: Rgb = [242, 242, 240];
const GREY: Rgb = [200, 202, 204];
const L = (pattern: PaintPattern, tail: Rgb, stripe: Rgb, body: Rgb = WHITE, engine: Rgb = GREY) => ({
  pattern,
  tail,
  stripe,
  body,
  engine,
});

/**
 * The major airlines seen by the traffic (their ICAO designators): their schemes' main colours — the colours alone, read as a
 * spotter would name them (« a white aircraft, a dark-blue fin and belly »), no mark of theirs. A designator flown by several
 * operators for one brand (regional partners) keeps its own operator's: SkyWest (SKW), Republic (RPA), Envoy (ENY) their own.
 */
const TABLE: Record<string, Omit<Livery, "icao">> = {
  // ---- North America
  UAL: L("belly", [22, 38, 92], [70, 110, 190], [22, 38, 92], [22, 38, 92]),
  AAL: L("cheat", [40, 70, 140], [200, 30, 45], [205, 208, 212], [190, 193, 197]),
  DAL: L("belly", [190, 20, 40], [30, 50, 110], [18, 34, 80], [18, 34, 80]),
  SWA: L("belly", [40, 70, 160], [230, 170, 30], [40, 70, 160], [40, 70, 160]),
  ASA: L("tail", [10, 40, 70], [0, 120, 130], WHITE, [10, 40, 70]),
  JBU: L("belly", [20, 40, 100], [60, 120, 200], [20, 40, 100], [20, 40, 100]),
  NKS: L("body", [250, 210, 20], [20, 20, 20], [250, 210, 20], [250, 210, 20]),
  FFT: L("cheat", [20, 110, 60], [20, 110, 60], WHITE, [20, 110, 60]),
  HAL: L("tail", [90, 40, 120], [200, 40, 120], WHITE, [90, 40, 120]),
  ACA: L("belly", [25, 25, 25], [200, 30, 40], [25, 25, 25], [25, 25, 25]),
  WJA: L("tail", [0, 115, 130], [20, 60, 110], WHITE, [0, 115, 130]),
  AMX: L("belly", [15, 35, 70], [190, 30, 50], [15, 35, 70], [15, 35, 70]),
  VOI: L("tail", [100, 40, 130], [100, 40, 130], WHITE, [100, 40, 130]),
  SKW: L("cheat", [30, 50, 100], [30, 50, 100], WHITE, GREY),
  RPA: L("cheat", [40, 60, 120], [180, 30, 40], WHITE, GREY),
  ENY: L("cheat", [40, 70, 140], [200, 30, 45], WHITE, GREY),
  FDX: L("crown", [80, 30, 120], [230, 110, 20], [80, 30, 120], GREY),
  UPS: L("crown", [70, 45, 30], [240, 180, 20], [70, 45, 30], [70, 45, 30]),
  // ---- Europe
  AFR: L("cheat", [20, 40, 120], [200, 20, 40], WHITE, WHITE),
  BAW: L("belly", [20, 30, 80], [200, 20, 40], [20, 30, 80], GREY),
  DLH: L("tail", [10, 25, 70], [10, 25, 70], WHITE, [10, 25, 70]),
  KLM: L("crown", [0, 150, 210], [0, 90, 170], [0, 150, 210], GREY),
  SWR: L("tail", [220, 20, 30], [220, 20, 30], WHITE, GREY),
  AUA: L("tail", [220, 20, 30], [220, 20, 30], WHITE, GREY),
  IBE: L("tail", [210, 20, 40], [250, 190, 20], WHITE, GREY),
  EZY: L("tail", [255, 100, 0], [255, 100, 0], WHITE, [255, 100, 0]),
  RYR: L("belly", [10, 30, 90], [250, 200, 20], [10, 30, 90], [10, 30, 90]),
  WZZ: L("tail", [200, 0, 110], [40, 30, 110], WHITE, [40, 30, 110]),
  VLG: L("belly", [60, 60, 60], [250, 200, 0], [60, 60, 60], [250, 200, 0]),
  EIN: L("tail", [0, 120, 100], [0, 120, 100], WHITE, GREY),
  TAP: L("tail", [200, 20, 40], [0, 130, 80], WHITE, GREY),
  SAS: L("tail", [10, 30, 100], [10, 30, 100], WHITE, [10, 30, 100]),
  FIN: L("tail", [0, 40, 120], [0, 40, 120], WHITE, GREY),
  TRA: L("tail", [0, 160, 80], [0, 100, 60], WHITE, GREY),
  TVF: L("tail", [0, 160, 80], [0, 100, 60], WHITE, GREY),
  ITY: L("tail", [10, 40, 110], [0, 140, 70], WHITE, GREY),
  THY: L("tail", [200, 20, 30], [200, 20, 30], WHITE, GREY),
  // ---- Middle East, Asia, Oceania
  UAE: L("tail", [200, 20, 30], [40, 110, 50], WHITE, GREY),
  QTR: L("tail", [100, 20, 50], [100, 20, 50], WHITE, GREY),
  ETD: L("tail", [190, 160, 110], [120, 100, 70], WHITE, GREY),
  SIA: L("tail", [20, 40, 100], [240, 170, 30], WHITE, GREY),
  CPA: L("cheat", [0, 90, 80], [0, 90, 80], WHITE, GREY),
  ANA: L("cheat", [10, 40, 110], [0, 110, 190], WHITE, GREY),
  JAL: L("tail", [210, 20, 30], [210, 20, 30], WHITE, GREY),
  KAL: L("crown", [130, 180, 220], [30, 60, 140], [130, 180, 220], GREY),
  CCA: L("tail", [200, 20, 30], [200, 20, 30], WHITE, GREY),
  CES: L("tail", [200, 20, 30], [20, 40, 110], WHITE, GREY),
  CSN: L("tail", [10, 70, 160], [10, 70, 160], WHITE, GREY),
  QFA: L("tail", [220, 20, 30], [220, 20, 30], WHITE, GREY),
  ANZ: L("tail", [20, 20, 20], [20, 20, 20], WHITE, [20, 20, 20]),
  VIR: L("tail", [200, 20, 40], [120, 20, 60], [210, 212, 216], GREY),
};

/** the generic paint's fins: muted colours — one chosen by the designator */
const GENERIC_FINS: readonly Rgb[] = [
  [40, 60, 110],
  [120, 30, 40],
  [30, 90, 70],
  [70, 70, 80],
  [20, 90, 140],
  [140, 90, 30],
];

/** The ICAO airline designator a callsign starts with (its three letters, then its flight number's digit): « UAL2623 » → « UAL »;
 *  none (a registration — « N796UA », « FGKXA » —, a military callsign) "". */
export function airlineOf(callsign: string): string {
  const m = /^([A-Z]{3})\d/.exec(callsign.trim().toUpperCase());
  return m ? m[1]! : "";
}

/** A string's FNV-1a hash (the generic fin's pick: the same designator always the same colour). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The livery of an aircraft by its callsign (and its registration, the generic fin's pick when it has no airline's). */
export function liveryOf(callsign: string, reg = ""): Livery {
  const icao = airlineOf(callsign);
  const L0 = TABLE[icao];
  if (L0) return { icao, ...L0 };
  const fin = GENERIC_FINS[hash(icao || reg || callsign) % GENERIC_FINS.length]!;
  return { icao: "", pattern: "tail", tail: fin, stripe: fin, body: WHITE, engine: GREY };
}

/** the airlines in the table (tests, the docs) */
export const LIVERY_AIRLINES = Object.keys(TABLE);

const lin = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

/**
 * The livery's record for the craft's shader (ship.wgsl trafficPaint — 20 floats, an instance record's: model then flags), linear
 * colours: [gear, pattern, engine r, engine g | fin rgb, engine b | cheatline rgb, 0 | fuselage rgb, 0 | 0, 0, 0, 0]. `gear`: its
 * landing gear 0 (up) … 1 (down) — the plain meshes' (ship.wgsl trafficGearPos).
 */
export function liveryRecord(L: Livery | null, gear: number): Float32Array<ArrayBuffer> {
  const r = new Float32Array(20);
  r[0] = Math.max(0, Math.min(1, gear));
  if (!L) return r;
  r[1] = PATTERN_CODE[L.pattern];
  r[2] = lin(L.engine[0]);
  r[3] = lin(L.engine[1]);
  r.set([lin(L.tail[0]), lin(L.tail[1]), lin(L.tail[2]), lin(L.engine[2])], 4);
  r.set([lin(L.stripe[0]), lin(L.stripe[1]), lin(L.stripe[2]), 0], 8);
  r.set([lin(L.body[0]), lin(L.body[1]), lin(L.body[2]), 0], 12);
  return r;
}

/**
 * Where a livery lies on each airliner drawn (ship.wgsl S.tpaint — its frame [m]: x its left, y up, z its nose), measured on the
 * meshes (24 Nov 2026): by mesh — 0 the plain A320 (assets/traffic/a320.bin), 1 the CRJ-900, 2 the game's A320 (its rig's frame:
 * its belly at 0, its nose 2.32 m ahead of the plain one's) — three vec4s: its belly's, its windows' (their middle) and its crown's
 * heights, its fin's root (z, its front); its fuselage's half-width, its nacelles' |x| from, to and their bottom; their top, their z
 * from, to, its fin's half-thickness. (The game's A320's engines: their own material — its box empty.)
 */
export const TRAFFIC_PAINT_GEO = new Float32Array([
  // the plain A320
  -1.61, 1.0, 2.56, -12.5, 2.05, 4.6, 7.0, -2.85, -0.45, 0.0, 5.4, 0.6,
  // the CRJ-900
  -1.03, 1.07, 2.18, -10.3, 1.45, 1.45, 3.2, 0.4, 2.15, -11.4, -7.1, 0.3,
  // the game's A320
  0.0, 2.61, 4.17, -10.2, 2.05, 99, 99, 0, 0, 0, 0, 0.6,
]);
