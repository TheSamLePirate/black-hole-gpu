// The real traffic as a page reads it (docs/PLAN-AVIATION-AAA.md, T1, T2): the aircraft and ships about the
// flown craft, asked of the relay (server/traffic.ts: the dev server's own, else the room server's) — the air every
// 5 s within 120 km, the sea every 10 s within 60 km —; off when the setting says so or the page is offline. Each
// one kept with its last two reports, so it can be carried on between them (T2: where it is now — its way, its
// speed, its turn, its climb). Its sources' attribution kept to be shown.

import type { Plane, Ship } from "../../server/traffic";

export type { Plane, Ship };

/** A tracked aircraft: its last report and the one before, when we heard it [s, the page's clock]. */
export interface TrackedPlane {
  p: Plane;
  prev: Plane | null;
  heard: number;
}
export interface TrackedShip {
  s: Ship;
  heard: number;
}

/** the relay: the dev server's own (localhost), else the room server's */
export function trafficBase(loc: { hostname: string; protocol: string; host: string } = location): string {
  if (/^(localhost|127\.0\.0\.1)$/.test(loc.hostname)) return `${loc.protocol}//${loc.host}`;
  return "https://stream.samlepirate.org";
}

export const FEED = {
  /** the asks' periods [s] and radii [km]; a report dropped after this [s] */
  airEvery: 5,
  seaEvery: 10,
  airR: 120,
  seaR: 60,
  keep: 60,
} as const;

export class TrafficFeed {
  readonly planes = new Map<string, TrackedPlane>();
  readonly ships = new Map<number, TrackedShip>();
  /** the sources' credits (the air's, the sea's); the state: off, waiting, live, the last error */
  credit: { air?: string; sea?: string } = {};
  status: "off" | "waiting" | "live" | "error" | "offline" = "off";
  error = "";
  private airAt = -1e9;
  private seaAt = -1e9;
  private busy = { air: false, sea: false };

  constructor(
    private base: () => string = () => trafficBase(),
    private get: (url: string) => Promise<Response> = (url) => fetch(url),
    private online: () => boolean = () => typeof navigator === "undefined" || navigator.onLine !== false,
  ) {}

  /** Drops everything (the setting off, far from the Earth). */
  clear() {
    this.planes.clear();
    this.ships.clear();
    this.credit = {};
  }

  /**
   * A frame: `now` [s, the page's clock], `at` where the flown craft is over the Earth (null: not near it), `on` the
   * setting. The air and the sea asked when due; the old reports dropped.
   */
  tick(now: number, at: { lat: number; lon: number } | null, on: boolean) {
    if (!on || !at) {
      if (this.status !== "off") this.clear();
      this.status = "off";
      return;
    }
    if (!this.online()) {
      this.status = "offline";
      return;
    }
    if (this.status === "off") this.status = "waiting";
    if (now - this.airAt >= FEED.airEvery && !this.busy.air) {
      this.airAt = now;
      void this.ask("air", at, now);
    }
    if (now - this.seaAt >= FEED.seaEvery && !this.busy.sea) {
      this.seaAt = now;
      void this.ask("sea", at, now);
    }
    for (const [k, v] of this.planes) if (now - v.heard > FEED.keep) this.planes.delete(k);
    for (const [k, v] of this.ships) if (now - v.heard > FEED.keep * 3) this.ships.delete(k);
  }

  /** The credits to show: those of the sources that gave something now. */
  get attribution(): string[] {
    return [this.planes.size ? this.credit.air : undefined, this.ships.size ? this.credit.sea : undefined].filter((x): x is string => !!x);
  }

  private async ask(what: "air" | "sea", at: { lat: number; lon: number }, now: number) {
    this.busy[what] = true;
    try {
      const r = what === "air" ? FEED.airR : FEED.seaR;
      const res = await this.get(`${this.base()}/traffic/${what}?lat=${at.lat.toFixed(4)}&lon=${at.lon.toFixed(4)}&r=${r}`);
      if (!res.ok) throw new Error(`${what} ${res.status}`);
      const j = (await res.json()) as { planes?: Plane[]; ships?: Ship[]; attribution?: string };
      if (what === "air")
        for (const p of j.planes ?? []) {
          const T = this.planes.get(p.id);
          // (a new report: the one before kept for the turn and the climb)
          if (T && T.p.t === p.t) continue;
          this.planes.set(p.id, { p, prev: T ? T.p : null, heard: now });
        }
      else for (const s of j.ships ?? []) this.ships.set(s.mmsi, { s, heard: now });
      if (j.attribution) this.credit[what] = j.attribution;
      this.status = "live";
      this.error = "";
    } catch (e) {
      this.status = "error";
      this.error = String(e);
    } finally {
      this.busy[what] = false;
    }
  }
}
