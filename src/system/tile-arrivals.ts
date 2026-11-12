// CM0 (docs/PLAN-CHARGEMENT-MONDE.md) — each tile's arrival, timed: when its load was asked, when its data came (fetched and
// decoded), when it was first written to the GPU, when its imagery and its national heights followed, when its level first
// drew it (its valid rectangle over it), and its failures. The audit of 10 Nov 2026 (ST-21) found no measure of "asked → drawn"
// per tile: the e2e saw a level whole or not, the network light its bytes. Read through `__bh.renderer.earthTiles.arrivals`
// (`stats()` by source, `rows()` the tiles, `reset()`).

/** the stages of a tile's arrival [ms, performance.now()] */
export type ArrivalStage = "req" | "got" | "put" | "img" | "nat" | "drawn";

export type TileArrival = {
  /** "z/x/y" for the relief's levels, "o:z/x/y" for the orthophotos' */
  key: string;
  /** its first source: "terrarium" (the global relief), "ortho:<national id>", … */
  src: string;
  /** its national source's id when its heights come from one after the global ones ("ign", "swisstopo", …) */
  natSrc?: string;
  /** loaded ahead, into memory past its window (the halo): not the view's wait */
  ahead?: boolean;
  /** its load's failures (a timeout, a refusal, the network down) */
  fails: number;
  /** a stand-in drawn for it (CM1: its parent's heights enlarged, while it is asked again) */
  standIn?: number;
} & Partial<Record<ArrivalStage, number>>;

/** a delay's distribution [ms]: count, median, 95th percentile, most */
export type Spread = { n: number; p50: number; p95: number; max: number };

export function spread(v: number[]): Spread {
  if (!v.length) return { n: 0, p50: 0, p95: 0, max: 0 };
  const s = [...v].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
  return { n: s.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(s[s.length - 1]!) };
}

/** one source's figures: its tiles, those drawn, failed, stood in for; each stage's delay from the request */
export type ArrivalStats = {
  tiles: number;
  drawn: number;
  failed: number;
  fails: number;
  standIns: number;
  got: Spread;
  put: Spread;
  img: Spread;
  nat: Spread;
  drawnAfter: Spread;
};

export class ArrivalLog {
  private rows = new Map<string, TileArrival>();
  /** since when [ms] (reset) */
  since = 0;
  constructor(
    private readonly most = 4096,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.since = this.now();
  }
  /** a load asked: its row begun — or, asked again (a retry), kept with its first request's time */
  begin(key: string, src: string, ahead = false): TileArrival {
    let r = this.rows.get(key);
    if (!r) {
      r = { key, src, fails: 0, req: this.now(), ...(ahead ? { ahead: true } : {}) };
      this.rows.set(key, r);
      if (this.rows.size > this.most) this.rows.delete(this.rows.keys().next().value!);
    } else if (!ahead && r.ahead && r.drawn === undefined) {
      // (loaded ahead, now wanted in its window: no longer the halo's)
      delete r.ahead;
    }
    return r;
  }
  /** a stage reached — its first time kept */
  mark(key: string, stage: ArrivalStage, t = this.now()) {
    const r = this.rows.get(key);
    if (r && r[stage] === undefined) r[stage] = t;
  }
  /** its national source (the heights after the global ones) */
  national(key: string, id: string) {
    const r = this.rows.get(key);
    if (r) r.natSrc ??= id;
  }
  fail(key: string) {
    const r = this.rows.get(key);
    if (r) r.fails++;
  }
  standIn(key: string) {
    const r = this.rows.get(key);
    if (r) r.standIn = (r.standIn ?? 0) + 1;
  }
  get(key: string): TileArrival | undefined {
    return this.rows.get(key);
  }
  reset() {
    this.rows.clear();
    this.since = this.now();
  }
  /** the rows, copied (the oldest first) */
  list(): TileArrival[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
  /**
   * By source — the relief's first source ("terrarium"), its national heights ("nat:ign", the delay to them from the tile's
   * request), the orthophotos ("ortho:ign") —, the tiles of the windows only (the halo's loads, `ahead`, left out unless
   * `ahead`): each stage's delay from the request [ms].
   */
  stats(ahead = false): Record<string, ArrivalStats> {
    const out: Record<string, ArrivalStats> = {};
    const acc = new Map<string, { rows: TileArrival[] }>();
    const add = (k: string, r: TileArrival) => {
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { rows: [] }));
      a.rows.push(r);
    };
    for (const r of this.rows.values()) {
      if (r.ahead && !ahead) continue;
      add(r.src, r);
      if (r.natSrc) add(`nat:${r.natSrc}`, r);
    }
    for (const [k, { rows }] of acc) {
      const after = (s: ArrivalStage) => rows.flatMap((r) => (r[s] !== undefined && r.req !== undefined ? [r[s]! - r.req] : []));
      const nat = k.startsWith("nat:");
      out[k] = {
        tiles: rows.length,
        drawn: rows.filter((r) => r.drawn !== undefined).length,
        failed: rows.filter((r) => r.fails > 0 && r.put === undefined).length,
        fails: rows.reduce((a, r) => a + r.fails, 0),
        standIns: rows.filter((r) => (r.standIn ?? 0) > 0).length,
        got: spread(nat ? [] : after("got")),
        put: spread(nat ? [] : after("put")),
        img: spread(nat ? [] : after("img")),
        nat: spread(after("nat")),
        drawnAfter: spread(nat ? [] : after("drawn")),
      };
    }
    return out;
  }
}
