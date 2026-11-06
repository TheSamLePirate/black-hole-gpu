// The sea's life where the AIS says nothing (Sam, 6 Nov 2026: « meilleurs bateaux, la vie sur la mer »; PLAN-AVIATION-AAA
// T4): ships drawn from the place itself — cargo ships and tankers on the deep water, ferries, fishing boats and sailing boats
// near the coasts, a warship now and then, ships at anchor off the shore —, the same for everyone (each 0.2° cell its own seed,
// their motion the clock's alone: a room sees one sea).
//
// Each ship under way runs a racetrack — out along a lane, a U-turn of `turn` metres' radius to starboard, back along the lane
// beside it —, both lanes and the turns checked to lie over water deep enough for it at generation: none crosses a coast, none
// appears or vanishes (the loop has no end). Pure; the sea floor's sampler given by the renderer (setSeaFloor: the global height
// map, the bed below 0).

const D = Math.PI / 180;
const R = 6_371_000;

export interface SimShip {
  /** a made-up MMSI (99xxxxxxx: no real ship's), the AIS type, length and beam [m], its name ("" none) */
  mmsi: number;
  type: number;
  len: number;
  beam: number;
  name: string;
  /** where it is now (geodetic [°]), its course over the ground and its heading [°], its speed [m/s] */
  lat: number;
  lon: number;
  cog: number;
  hdg: number;
  sog: number;
}

/** the sea floor's height [m] (negative under the sea) at a geodetic place [°]; null: unknown (no ship made) */
type Floor = (lat: number, lon: number) => number;
let floor: Floor | null = null;
let gen = 0;
export function setSeaFloor(f: Floor | null) {
  floor = f;
  cells.clear();
  gen++;
}
/** bumped when the sea's floor changes (a cache of its ships made before it — seatraffic.ts — stale) */
export const seaGen = () => gen;

/**
 * The sea's depth as the ships need it, from the oceans' mask alone (the game's global relief holds no bathymetry — its sea
 * at 0): the distance to the nearest land [m] — rings of 12 points out to 20 km, the first meeting land — taken as a shelf
 * sloping 1.2 % (a cargo ship's 60 m 5 km off the coast, a fishing boat's 8 m 700 m off, a sailing boat's 4 m 330 m off),
 * 240 m beyond; the land +10. `sea(lat, lon)`: whether the mask says sea there.
 */
export function shelfFloor(sea: (lat: number, lon: number) => boolean): Floor {
  const RINGS = [300, 600, 1000, 1500, 2200, 3200, 4500, 6500, 9000, 13_000, 20_000];
  return (lat, lon) => {
    if (!sea(lat, lon)) return 10;
    for (const r of RINGS)
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * 2 * Math.PI + r * 1e-4;
        const [la, lo] = offset(lat, lon, r * Math.sin(a), r * Math.cos(a));
        if (!sea(la, lo)) return -0.012 * r;
      }
    return -0.012 * 20_000;
  };
}

/** The oceans' mask (an image, its red channel: 1 the sea, equirectangular from 90° N, 180° W) read once, then the shelf's
 *  floor from it (setSeaFloor). */
export async function loadSeaMask(url: string) {
  const img = await createImageBitmap(await (await fetch(url)).blob());
  const W = img.width,
    H = img.height;
  const cv = new OffscreenCanvas(W, H);
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = px[4 * i]!;
  img.close();
  setSeaFloor(
    shelfFloor((lat, lon) => {
      const x = Math.floor((((lon + 180) / 360) % 1) * W + W) % W;
      const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
      return m[y * W + x]! > 127;
    }),
  );
}

/** a cell's side [°] */
export const SEA_CELL = 0.2;

interface Track {
  mmsi: number;
  type: number;
  len: number;
  beam: number;
  name: string;
  /** the lane's centre [°], its course [rad], its extent each way of the centre [m] (a, b: signed along it), the turn's
   *  radius [m], its speed [m/s], its phase [m]; anchored: none of the lane (still at the centre, its heading the course) */
  lat: number;
  lon: number;
  course: number;
  a: number;
  b: number;
  turn: number;
  speed: number;
  phase: number;
  anchored: boolean;
}

const cells = new Map<string, Track[]>();

/** a small deterministic generator from a seed (mulberry32) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Poisson's count for a mean (Knuth's, small means) */
function poisson(r: () => number, mean: number) {
  const L = Math.exp(-mean);
  let k = 0,
    p = 1;
  do {
    k++;
    p *= r();
  } while (p > L && k < 20);
  return k - 1;
}

/** a place `e`, `n` metres east and north of (lat, lon) [°] */
const offset = (lat: number, lon: number, e: number, n: number): [number, number] => [
  lat + n / (R * D),
  lon + e / (R * D * Math.cos(lat * D)),
];

const NAMES: Record<string, string[]> = {
  cargo: ["Maersk Altair", "CMA CGM Rhone", "MSC Aurora", "Ever Gentle", "Hapag Lyon", "ONE Harmony", "Cosco Pride"],
  tanker: ["Nordic Spirit", "Stena Arctica", "Hellas Glory", "Atlantic Star", "Seaways Polaris"],
  ferry: ["Pont-Aven", "Mega Express", "Moby Wonder", "Corsica Victoria", "Stena Europe"],
  fishing: ["Marie-Galante", "Saint-Pierre", "Ar Bigouden", "Kerlouan", "L'Espérance", "Notre-Dame", "Petit Mousse"],
  sailing: ["Alizé", "Ondine", "Grand Largue", "Sirocco", "Pen Duick", "Mistral", "Zéphyr", "Galatée"],
  military: ["F 712", "D 655", "A 607", "F 731"],
};

/** The kinds made and where: the depth [m] each needs (the floor under it at most), its mean per cell, its sizes, speeds,
 *  lane length [m] (the lane's half at most each way), turn's radius [m]. */
const KINDS = [
  { kind: "cargo", type: 70, depth: -60, mean: 0.5, len: [140, 300], beamK: 0.145, speed: [7, 10.5], lane: 60_000, turn: 1500 },
  { kind: "tanker", type: 80, depth: -60, mean: 0.3, len: [150, 260], beamK: 0.18, speed: [6, 8], lane: 60_000, turn: 1500 },
  { kind: "ferry", type: 60, depth: -30, mean: 0.15, len: [120, 190], beamK: 0.17, speed: [9, 12.5], lane: 40_000, turn: 900 },
  { kind: "fishing", type: 30, depth: -8, mean: 1.1, len: [16, 34], beamK: 0.3, speed: [1.5, 4.5], lane: 8_000, turn: 250 },
  { kind: "sailing", type: 36, depth: -4, mean: 1.4, len: [8, 16], beamK: 0.3, speed: [2, 4], lane: 5_000, turn: 150 },
  { kind: "military", type: 35, depth: -80, mean: 0.04, len: [130, 145], beamK: 0.13, speed: [8, 13], lane: 50_000, turn: 1200 },
] as const;

/** The tracks of a cell (made once, kept): each kind's count by its mean where its depth is, each lane checked over the water. */
function cellTracks(iy: number, ix: number): Track[] {
  const key = `${iy}:${ix}`;
  const kept = cells.get(key);
  if (kept) return kept;
  const out: Track[] = [];
  if (!floor) return out;
  const r = rng(Math.imul(iy, 73856093) ^ Math.imul(ix, 19349663) ^ 0x5eac0de);
  const lat0 = (iy + 0.5) * SEA_CELL,
    lon0 = (ix + 0.5) * SEA_CELL;
  let n = 0;
  for (const K of KINDS) {
    const count = poisson(r, K.mean);
    for (let i = 0; i < count; i++) {
      // (its centre somewhere in the cell, over water deep enough for it)
      const lat = lat0 + (r() - 0.5) * SEA_CELL,
        lon = lon0 + (r() - 0.5) * SEA_CELL;
      const len = K.len[0] + r() * (K.len[1] - K.len[0]);
      const speed = K.speed[0] + r() * (K.speed[1] - K.speed[0]);
      const course = r() * 2 * Math.PI;
      const phaseR = r();
      // (a ship off the shore at anchor: a cargo ship or a tanker — a fifth of them — in water under 60 m)
      const anchorable = (K.kind === "cargo" || K.kind === "tanker") && r() < 0.2;
      if (floor(lat, lon) > K.depth) {
        if (!anchorable || floor(lat, lon) > -12 || floor(lat, lon) < -80) continue;
      }
      // (its MMSI 99xxxxxxx — none a real ship's —: the cell's number and its rank there — the cells about a place all
      // apart: two had shared one, a ship's label and its tracking jumping to another)
      const cellNo = ((((iy + 900) * 36_000 + (ix + 1800)) % 99_000) + 99_000) % 99_000;
      const mmsi = 990_000_000 + cellNo * 100 + Math.min(n++, 99);
      const pool = NAMES[K.kind] ?? [];
      const name = pool.length ? pool[Math.floor(r() * pool.length)]! : "";
      const T: Track = {
        mmsi,
        type: K.type,
        len,
        beam: len * K.beamK,
        name,
        lat,
        lon,
        course,
        a: 0,
        b: 0,
        turn: K.turn,
        speed,
        phase: 0,
        anchored: false,
      };
      if (floor(lat, lon) > K.depth) {
        T.anchored = true;
        out.push(T);
        continue;
      }
      // (its lanes: out along its course and back 2·turn to starboard — each step of 1 km both checked —, as far each way
      // as the water lets it, within the kind's lane)
      const step = 1000;
      const ok = (s: number) => {
        const [la, lo] = offset(lat, lon, Math.sin(course) * s, Math.cos(course) * s);
        const [lb, lob] = offset(la, lo, Math.cos(course) * 2 * K.turn, -Math.sin(course) * 2 * K.turn);
        return floor!(la, lo) <= K.depth && floor!(lb, lob) <= K.depth;
      };
      let b = 0;
      while (b + step <= K.lane / 2 && ok(b + step)) b += step;
      let a = 0;
      while (a - step >= -K.lane / 2 && ok(a - step)) a -= step;
      // (too short a lane for it: a big ship's 10 km at least, a small one's 1.5 km)
      if (b - a < (K.turn > 500 ? 10_000 : 1500)) continue;
      T.a = a + K.turn;
      T.b = b - K.turn;
      if (T.b <= T.a) continue;
      T.phase = phaseR * (2 * (T.b - T.a) + 2 * Math.PI * K.turn);
      out.push(T);
    }
  }
  cells.set(key, out);
  if (cells.size > 400) cells.delete(cells.keys().next().value!);
  return out;
}

/**
 * The made-up ships within `radius` [m] of (lat, lon) [°] at the time `t` [s] (any clock shared by those who should see the
 * same sea — the traffic's): each one's place, course, heading and speed.
 */
export function simShips(lat: number, lon: number, t: number, radius = 30_000): SimShip[] {
  if (!floor) return [];
  const reach = radius + 35_000;
  const dy = reach / (R * D),
    dx = reach / (R * D * Math.max(Math.cos(lat * D), 0.2));
  const out: SimShip[] = [];
  for (let iy = Math.floor((lat - dy) / SEA_CELL); iy <= Math.floor((lat + dy) / SEA_CELL); iy++)
    for (let ix = Math.floor((lon - dx) / SEA_CELL); ix <= Math.floor((lon + dx) / SEA_CELL); ix++)
      for (const T of cellTracks(iy, ix)) {
        const s = shipAt(T, t);
        const de = (s.lon - lon) * D * R * Math.cos(lat * D),
          dn = (s.lat - lat) * D * R;
        if (de * de + dn * dn > radius * radius) continue;
        out.push(s);
      }
  return out;
}

/** a track's ship at `t`: along its racetrack — out on the lane, the turn to starboard, back, the turn — or at anchor */
export function shipAt(T: Track, t: number): SimShip {
  const base = { mmsi: T.mmsi, type: T.type, len: T.len, beam: T.beam, name: T.name };
  if (T.anchored) {
    // (swinging slowly to its anchor: its heading wandering ±25° over twenty minutes)
    const h = T.course + 0.45 * Math.sin((t / 1200) * 2 * Math.PI + T.mmsi);
    return { ...base, lat: T.lat, lon: T.lon, cog: (h / D + 360) % 360, hdg: (h / D + 360) % 360, sog: 0 };
  }
  const L = T.b - T.a,
    C = Math.PI * T.turn;
  const P = 2 * L + 2 * C;
  let u = (((T.speed * t + T.phase) % P) + P) % P;
  const c = T.course;
  // (the lane's frame: x along the course, y to starboard)
  let x: number, y: number, h: number;
  if (u < L) {
    x = T.a + u;
    y = 0;
    h = c;
  } else if ((u -= L) < C) {
    const th = u / T.turn;
    x = T.b + T.turn * Math.sin(th);
    y = T.turn * (1 - Math.cos(th));
    h = c + th;
  } else if ((u -= C) < L) {
    x = T.b - u;
    y = 2 * T.turn;
    h = c + Math.PI;
  } else {
    u -= L;
    const th = u / T.turn;
    x = T.a - T.turn * Math.sin(th);
    y = T.turn * (1 + Math.cos(th));
    h = c + Math.PI + th;
  }
  // (starboard of a course c: its east, north (cos c, −sin c))
  const e = Math.sin(c) * x + Math.cos(c) * y,
    n = Math.cos(c) * x - Math.sin(c) * y;
  const [la, lo] = offset(T.lat, T.lon, e, n);
  const deg = (((h / D) % 360) + 360) % 360;
  return { ...base, lat: la, lon: lo, cog: deg, hdg: deg, sog: T.speed };
}
