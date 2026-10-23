// The tactical picture sent to the crew (docs/PLAN-RADAR-AAA.md RD5): the pilot's one list of tracks (radar/picture.ts)
// in a compact block of the `instruments` event, four times a second — what the crew's console draws, both its views
// (« Capteur »: what the pilot's sensors hold; « Partagé »: the truth) two filters of it.
//   - a row a track, quantified: its place from the pilot's (1e-5°), its height [m], its velocity (east, north, up
//     [dm/s]), the freshness of its last measure [ds], its kind, side, IFF, state, sensors, lock, selection and TCAS
//     grading packed in one integer; a missile's and a decoy's own figures in a second row;
//   - its id, name and type in a dictionary, sent once a track (and again to a crew that comes), the rows naming it
//     by a small number;
//   - by priority: the lock, the selection, the hostiles, the missiles and the decoys, the datalink's, what is within
//     40 km in every block; the rest by turns, each at least once a second while the budget allows;
//   - the ids lost (gone), the radar's mode, beam and the pilot's scope's range, his selection;
//   - a crew that comes: the last two minutes of each track's history (a point each 2 s), spread over a few blocks.
// Pure (no import of the simulator): the crew's bundle decodes it.

/** A picture's track as the encoder reads it (radar/picture.ts PicTrack's fields it needs). */
export interface PicLike {
  id: string;
  name: string;
  type: string;
  kind: "air" | "sea" | "ground" | "missile" | "flare" | "chaff";
  side: string;
  iff: string;
  sensors: number;
  state: string;
  locked: boolean;
  selected: boolean;
  lat: number;
  lon: number;
  h: number;
  /** its velocity (east, north, up [m/s]); its true one, when known (the place sent is the true one: carried on by it) */
  v: readonly number[];
  vt?: readonly number[];
  /** its sensors' estimate relative to us (east, north, up [m]): its distance */
  r: readonly number[];
  seenAt?: number | null;
  msl?: { target: string | null; tti: number | null; ours: boolean; decoyed: boolean; motor: boolean; end?: "splash" | "miss" };
  cm?: { life: number };
  tcas?: string;
  ra?: string;
  /** its history: places and the trails' clock [s] */
  hist?: readonly { lat: number; lon: number; t: number }[];
}

/** The block (instruments' `pic`). */
export interface PicBlock {
  /** the pilot's place [1e-5°]: the rows' origin */
  o: [number, number];
  /** the radar's mode ("" none), its beam off the nose [mrad] (null: none), the pilot's scope's range [m] */
  m: string;
  b: number | null;
  rg: number;
  /** the selection's and the lock's numbers (−1: none) */
  sel: number;
  lk: number;
  /** the rows: [n, Δlat, Δlon (1e-5° from o), h (m), ve, vn, vu (dm/s), age (ds), bits] */
  r: number[][];
  /** the weapons' rows: [n, target (n; −2 the pilot; −1 none), tti (ds; −1 none), flags (WFLAG), a decoy's life (ds)] */
  w?: number[][];
  /** the dictionary: [n, id, name, type] */
  d?: [number, string, string, string][];
  /** the numbers lost */
  g?: number[];
  /** the histories: [n, age of the newest (ds), lat0, lon0 (1e-5°), then Δlat, Δlon pairs back in time, a point each 2 s] */
  h?: number[][];
}

export const KIND = ["air", "sea", "ground", "missile", "flare", "chaff"] as const;
export const SIDES = ["friend", "hostile", "neutral", "traffic", "carrier", "player", "dead"] as const;
export const IFFS = ["unknown", "friend", "neutral", "hostile"] as const;
export const STATES = ["firm", "coast", "datalink", "truth"] as const;
export const TCASL = ["", "proximate", "TA", "RA"] as const;
/** a weapon's flags */
export const WFLAG = { OURS: 1, DECOYED: 2, SPLASH: 4, MISS: 8, MOTOR: 16 } as const;

/** The bits of a row: kind 3, side 3, IFF 2, state 2, lock, selection, TCAS 2, an RA's sense (climb), sensors 7. */
export function packBits(t: Pick<PicLike, "kind" | "side" | "iff" | "state" | "locked" | "selected" | "tcas" | "ra" | "sensors">): number {
  const ix = <T extends readonly string[]>(a: T, v: string | undefined) => Math.max(0, a.indexOf(v as T[number]));
  return (
    ix(KIND, t.kind) |
    (ix(SIDES, t.side) << 3) |
    (ix(IFFS, t.iff) << 6) |
    (ix(STATES, t.state) << 8) |
    (t.locked ? 1 << 10 : 0) |
    (t.selected ? 1 << 11 : 0) |
    (ix(TCASL, t.tcas === "other" ? "" : t.tcas) << 12) |
    (t.ra === "climb" ? 1 << 14 : 0) |
    ((t.sensors & 127) << 15)
  );
}

export function unpackBits(b: number) {
  return {
    kind: KIND[b & 7] ?? "air",
    side: SIDES[(b >> 3) & 7] ?? "hostile",
    iff: IFFS[(b >> 6) & 3] ?? "unknown",
    state: STATES[(b >> 8) & 3] ?? "truth",
    locked: !!(b & (1 << 10)),
    selected: !!(b & (1 << 11)),
    tcas: TCASL[(b >> 12) & 3] || undefined,
    ra: (b >> 12) & 3 ? (b & (1 << 14) ? "climb" : "descend") : undefined,
    sensors: (b >> 15) & 127,
  };
}

/** The budget: rows a block at most (some 40 characters each: ~9 KB), the dictionary's entries a block. */
export const PIC_ROWS = 220;
const DICT_PER_BLOCK = 60;
const HIST_PER_BLOCK = 16;
/** the priority's reach [m] */
const NEAR = 40_000;
const q5 = (x: number) => Math.round(x * 1e5);
const dm = (x: number | undefined) => Math.round((x ?? 0) * 10);

/**
 * The pilot's encoder: its numbers by id, what it has sent of the dictionary, the turn of the rest, the histories to
 * send a crew that comes.
 */
export class PicEncoder {
  private num = new Map<string, number>();
  private next = 0;
  private named = new Set<number>();
  private turn = 0;
  private live = new Set<number>();
  private goneQ: number[] = [];
  private histQ: string[] = [];

  /** A crew came (or asked): the dictionary sent again, every track's history spread over the next blocks. */
  catchUp(ids: Iterable<string>) {
    this.named.clear();
    this.histQ = [...ids];
  }

  /** The block for these tracks at the trails' clock `trailT` [s] (the histories' ages); the origin the pilot's place. */
  encode(
    tracks: readonly PicLike[],
    o: { lat: number; lon: number; mode: string | null; beam: number | null; range: number; t: number; trailT?: number },
  ): PicBlock {
    const O: [number, number] = [q5(o.lat), q5(o.lon)];
    const nOf = (id: string) => {
      let n = this.num.get(id);
      if (n === undefined) this.num.set(id, (n = this.next++));
      return n;
    };
    // (the priority's: every block; the rest by turns)
    const pri: PicLike[] = [];
    const rest: PicLike[] = [];
    for (const T of tracks) {
      const urgent =
        T.locked ||
        T.selected ||
        T.side === "hostile" ||
        T.iff === "hostile" ||
        T.kind === "missile" ||
        T.kind === "flare" ||
        T.kind === "chaff" ||
        (T.sensors & 2) !== 0 ||
        Math.hypot(T.r[0] ?? 0, T.r[1] ?? 0) < NEAR;
      (urgent ? pri : rest).push(T);
    }
    const room = Math.max(0, PIC_ROWS - pri.length);
    // (the rest a quarter a block — each once a second at four blocks a second — within the room left)
    const share = Math.min(room, Math.ceil(rest.length / 4));
    const picked: PicLike[] = [...pri.slice(0, PIC_ROWS)];
    if (rest.length) {
      rest.sort((a, b) => (a.id < b.id ? -1 : 1));
      const start = this.turn % rest.length;
      for (let k = 0; k < share; k++) picked.push(rest[(start + k) % rest.length]!);
      this.turn = (start + share) % Math.max(rest.length, 1);
    }
    const r: number[][] = [];
    const w: number[][] = [];
    const d: [number, string, string, string][] = [];
    for (const T of picked) {
      const n = nOf(T.id);
      const age = T.seenAt !== null && T.seenAt !== undefined ? Math.min(255, Math.max(0, Math.round((o.t - T.seenAt) * 10))) : 0;
      const V = T.vt ?? T.v;
      r.push([n, q5(T.lat) - O[0], q5(T.lon) - O[1], Math.round(T.h), dm(V[0]), dm(V[1]), dm(V[2]), age, packBits(T)]);
      if (T.msl) {
        const tg = T.msl.target === "own" ? -2 : T.msl.target ? nOf(T.msl.target) : -1;
        const flags =
          (T.msl.ours ? WFLAG.OURS : 0) |
          (T.msl.decoyed ? WFLAG.DECOYED : 0) |
          (T.msl.end === "splash" ? WFLAG.SPLASH : T.msl.end === "miss" ? WFLAG.MISS : 0) |
          (T.msl.motor ? WFLAG.MOTOR : 0);
        w.push([n, tg, T.msl.tti !== null && T.msl.tti < 6000 ? Math.round(T.msl.tti * 10) : -1, flags, 0]);
      } else if (T.cm) w.push([n, -1, -1, 0, Math.round(T.cm.life * 10)]);
      if (!this.named.has(n) && d.length < DICT_PER_BLOCK) {
        this.named.add(n);
        d.push([n, T.id.slice(0, 40), T.name.slice(0, 32), T.type.slice(0, 16)]);
      }
    }
    // (the lost: the ids gone from the picture since the last block, said twice)
    const now = new Set(tracks.map((T) => nOf(T.id)));
    const gone = [...this.live].filter((n) => !now.has(n));
    this.live = now;
    const g = [...this.goneQ, ...gone];
    this.goneQ = gone;
    for (const n of gone) this.named.delete(n);
    // (a crew come: the histories, some each block — a point each 2 s, the last two minutes, back in time)
    const h: number[][] = [];
    if (this.histQ.length && o.trailT !== undefined) {
      const by = new Map(tracks.map((T) => [T.id, T]));
      while (this.histQ.length && h.length < HIST_PER_BLOCK) {
        const T = by.get(this.histQ.shift()!);
        if (!T?.hist?.length) continue;
        const pts: { lat: number; lon: number; t: number }[] = [];
        for (let k = T.hist.length - 1; k >= 0; k--) {
          const p = T.hist[k]!;
          if (o.trailT - p.t > 120) break;
          if (!pts.length || pts[pts.length - 1]!.t - p.t >= 2) pts.push(p);
        }
        if (!pts.length) continue;
        const row = [nOf(T.id), Math.round((o.trailT - pts[0]!.t) * 10), q5(pts[0]!.lat), q5(pts[0]!.lon)];
        for (let k = 1; k < pts.length; k++) row.push(q5(pts[k]!.lat) - q5(pts[k - 1]!.lat), q5(pts[k]!.lon) - q5(pts[k - 1]!.lon));
        h.push(row);
      }
    }
    const sel = tracks.find((T) => T.selected);
    const lk = tracks.find((T) => T.locked);
    return {
      o: O,
      m: o.mode ?? "",
      b: o.beam === null ? null : Math.round(o.beam * 1000),
      rg: Math.round(o.range),
      sel: sel ? nOf(sel.id) : -1,
      lk: lk ? nOf(lk.id) : -1,
      r,
      ...(w.length ? { w } : {}),
      ...(d.length ? { d } : {}),
      ...(g.length ? { g } : {}),
      ...(h.length ? { h } : {}),
    };
  }
}

/** A track decoded: its id, name, type, place, velocity, its bits' meaning, a weapon's figures. */
export interface PicDecoded {
  id: string;
  name: string;
  type: string;
  kind: (typeof KIND)[number];
  side: string;
  iff: string;
  state: string;
  sensors: number;
  locked: boolean;
  selected: boolean;
  tcas?: string;
  ra?: string;
  lat: number;
  lon: number;
  h: number;
  ve: number;
  vn: number;
  vu: number;
  /** its last measure's age at the block's time [s] */
  age: number;
  msl?: { target: string | null; tti: number | null; ours: boolean; decoyed: boolean; motor: boolean; end?: "splash" | "miss" };
  life?: number;
}

/** The crew's decoder for one pilot: his dictionary kept across the blocks. */
export class PicDecoder {
  readonly dict = new Map<number, { id: string; name: string; type: string }>();

  /** The block's tracks (those named: a row whose number is not yet named waits for its dictionary entry); the ids
   *  lost; the histories (oldest first, their age at the block's time [s]). */
  decode(B: PicBlock): {
    tracks: PicDecoded[];
    gone: string[];
    hist: { id: string; pts: { lat: number; lon: number; age: number }[] }[];
    sel: string | null;
    lock: string | null;
  } {
    for (const [n, id, name, type] of B.d ?? []) this.dict.set(n, { id, name, type });
    const gone: string[] = [];
    for (const n of B.g ?? []) {
      const e = this.dict.get(n);
      if (e) gone.push(e.id);
    }
    const W = new Map((B.w ?? []).map((x) => [x[0]!, x]));
    const tracks: PicDecoded[] = [];
    for (const row of B.r) {
      const [n, dla, dlo, h, ve, vn, vu, age, bits] = row as [number, number, number, number, number, number, number, number, number];
      const e = this.dict.get(n);
      if (!e) continue;
      const u = unpackBits(bits);
      const x = W.get(n);
      const T: PicDecoded = {
        ...e,
        ...u,
        lat: (B.o[0] + dla) / 1e5,
        lon: (B.o[1] + dlo) / 1e5,
        h,
        ve: ve / 10,
        vn: vn / 10,
        vu: vu / 10,
        age: age / 10,
      };
      if (x && u.kind === "missile") {
        const tg = x[1]!;
        const f = x[3]!;
        T.msl = {
          target: tg === -2 ? "own" : tg >= 0 ? (this.dict.get(tg)?.id ?? null) : null,
          tti: x[2]! >= 0 ? x[2]! / 10 : null,
          ours: !!(f & WFLAG.OURS),
          decoyed: !!(f & WFLAG.DECOYED),
          motor: !!(f & WFLAG.MOTOR),
          ...(f & WFLAG.SPLASH ? { end: "splash" as const } : f & WFLAG.MISS ? { end: "miss" as const } : {}),
        };
      } else if (x) T.life = x[4]! / 10;
      tracks.push(T);
    }
    const hist: { id: string; pts: { lat: number; lon: number; age: number }[] }[] = [];
    for (const row of B.h ?? []) {
      const e = this.dict.get(row[0]!);
      if (!e || row.length < 4) continue;
      let la = row[2]!,
        lo = row[3]!;
      const age0 = row[1]! / 10;
      const pts = [{ lat: la / 1e5, lon: lo / 1e5, age: age0 }];
      for (let k = 4; k + 1 < row.length; k += 2) {
        la += row[k]!;
        lo += row[k + 1]!;
        pts.push({ lat: la / 1e5, lon: lo / 1e5, age: age0 + ((k - 2) / 2) * 2 });
      }
      hist.push({ id: e.id, pts: pts.reverse() });
    }
    for (const id of gone) for (const [n, e] of this.dict) if (e.id === id) this.dict.delete(n);
    return {
      tracks,
      gone,
      hist,
      sel: B.sel >= 0 ? (this.dict.get(B.sel)?.id ?? null) : null,
      lock: B.lk >= 0 ? (this.dict.get(B.lk)?.id ?? null) : null,
    };
  }
}

/** A block read from the network (untrusted): its shape checked and bounded; null if not one. */
export function readPicBlock(x: unknown): PicBlock | null {
  if (!x || typeof x !== "object") return null;
  const b = x as Record<string, unknown>;
  const nums = (a: unknown, len: number, max: number): number[][] | null =>
    Array.isArray(a)
      ? a
          .slice(0, max)
          .filter(
            (row): row is number[] =>
              Array.isArray(row) && row.length >= len && row.every((v) => typeof v === "number" && Number.isFinite(v)),
          )
      : null;
  const o = b.o;
  if (!Array.isArray(o) || o.length !== 2 || !o.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const r = nums(b.r, 9, 600);
  if (!r) return null;
  const d = Array.isArray(b.d)
    ? (b.d as unknown[])
        .slice(0, 600)
        .filter(
          (e): e is [number, string, string, string] =>
            Array.isArray(e) &&
            typeof e[0] === "number" &&
            typeof e[1] === "string" &&
            typeof e[2] === "string" &&
            typeof e[3] === "string",
        )
        .map((e) => [e[0], e[1].slice(0, 40), e[2].slice(0, 32), e[3].slice(0, 16)] as [number, string, string, string])
    : undefined;
  return {
    o: [o[0] as number, o[1] as number],
    m: typeof b.m === "string" ? b.m.slice(0, 8) : "",
    b: typeof b.b === "number" && Number.isFinite(b.b) ? b.b : null,
    rg: typeof b.rg === "number" && Number.isFinite(b.rg) ? b.rg : 0,
    sel: typeof b.sel === "number" ? b.sel : -1,
    lk: typeof b.lk === "number" ? b.lk : -1,
    r,
    ...(nums(b.w, 5, 600) ? { w: nums(b.w, 5, 600)! } : {}),
    ...(d ? { d } : {}),
    ...(Array.isArray(b.g) ? { g: (b.g as unknown[]).filter((n): n is number => typeof n === "number").slice(0, 600) } : {}),
    ...(nums(b.h, 4, 64) ? { h: nums(b.h, 4, 64)!.map((row) => row.slice(0, 4 + 2 * 60)) } : {}),
  };
}
