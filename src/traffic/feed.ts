// The real traffic as a page reads it (docs/PLAN-AVIATION-AAA.md, T1, T2): the aircraft and ships about the
// flown craft, asked of the relay (server/traffic.ts: the dev server's own, else the room server's) — the air every
// 15 s within 120 km (the sources' pace), the sea every 10 s within 60 km; the aircraft followed (a formation's
// lead, the radar's lock) its own quarter of an hour's trace every 15 s —; off when the setting says so or the page
// is offline. Each aircraft kept with its reports of the last quarter of an hour: T2 draws it some 30 s behind the
// real time, between two of them (controller/traffic.ts). Its sources' attribution kept to be shown.

import type { Plane, Ship } from "../../server/traffic";
import { geoidDeg } from "../system/geoid-grid";

export type { Plane, Ship };

/** A tracked aircraft: its last report and the one before, its reports in time's order (the last quarter of an
 *  hour), when we heard it [s, the page's clock]. */
export interface TrackedPlane {
  p: Plane;
  prev: Plane | null;
  hist: Plane[];
  heard: number;
}
/** A tracked ship: its last report, its reports in time's order (the last quarter of an hour), when heard. */
export interface TrackedShip {
  s: Ship;
  hist: Ship[];
  heard: number;
}

/** the relay: the dev server's own (localhost), else the room server's */
export function trafficBase(loc: { hostname: string; protocol: string; host: string } = location): string {
  if (/^(localhost|127\.0\.0\.1)$/.test(loc.hostname)) return `${loc.protocol}//${loc.host}`;
  return "https://stream.samlepirate.org";
}

export const FEED = {
  /** the asks' periods [s] and radii [km]; the followed one's trace's period [s]; an aircraft dropped unheard this
   *  long [s]; the history kept [s] */
  airEvery: 15,
  seaEvery: 10,
  traceEvery: 15,
  airR: 120,
  seaR: 60,
  keep: 120,
  history: 900,
} as const;

/**
 * A report on the ground though its source does not say so. adsb.lol says "ground" only when the transponder sets its
 * flag; many parked or taxiing aircraft send a numeric barometric altitude instead (N796UA, a 777 parked at SFO: 0.7 kt,
 * alt_baro −200 ft — drawn 23 m under the ground, 24 Nov 2026). Slow — under `gsMax` [m/s], 35 kt, below any
 * aircraft's flying speed but a rotorcraft's, a balloon's, a glider's or a drone's (their categories left as reported)
 * —, level, and at or below the nearby airfield's ground plus a margin: on the ground. The margin [m] wide for a
 * barometric altitude (its pressure altitude: QNH 980…1045 hPa puts it ±270 m off), narrow for a geometric one.
 */
export const GROUNDED = { gsMax: 18, vsMax: 3, marginGeom: 60, marginBaro: 270 } as const;
/** the categories that fly slowly (ADS-B's A7 rotorcraft, B1 glider, B2 lighter than air, B3 parachutist, B4
 *  ultralight, B6 drone, B7 space; OpenSky's 8–12, 14, 15): left as their source says */
const SLOW_FLYERS = /^(A7|B[1-467]|cat(8|9|10|11|12|14|15))$/;

/**
 * Whether a report is on the ground: its source's flag, else (see GROUNDED) slow, level and at the ground of the
 * airfield about it — `fieldH` that ground's height over the WGS84 ellipsoid [m] (null: no airfield known there);
 * `baro`: its altitude was barometric (raised by the geoid since, its margin the wider).
 */
export function groundedReport(p: Pick<Plane, "gnd" | "gs" | "vs" | "alt" | "cat">, fieldH: number | null, baro: boolean): boolean {
  if (p.gnd) return true;
  if (fieldH === null || !Number.isFinite(fieldH)) return false;
  if (!(p.gs < GROUNDED.gsMax) || Math.abs(p.vs) > GROUNDED.vsMax || SLOW_FLYERS.test(p.cat)) return false;
  return p.alt <= fieldH + (baro ? GROUNDED.marginBaro : GROUNDED.marginGeom);
}

export class TrafficFeed {
  readonly planes = new Map<string, TrackedPlane>();
  readonly ships = new Map<number, TrackedShip>();
  /** the sources' credits (the air's, the sea's); the state: off, waiting, live, the last error */
  credit: { air?: string; sea?: string } = {};
  status: "off" | "waiting" | "live" | "error" | "offline" = "off";
  error = "";
  /** one aircraft followed (a formation's lead, the radar's lock): its recent trace asked every 15 s */
  focus: string | null = null;
  private focusAt = -1e9;
  private airAt = -1e9;
  private seaAt = -1e9;
  private busy = { air: false, sea: false, plane: false };

  constructor(
    private base: () => string = () => trafficBase(),
    private get: (url: string) => Promise<Response> = (url) => fetch(url),
    private online: () => boolean = () => typeof navigator === "undefined" || navigator.onLine !== false,
    /** the ground of the airfield about a place: its height over the WGS84 ellipsoid [m] (its elevation over the sea
     *  raised by the geoid), null when none is known there (main.ts: world/runways.ts's tiles) */
    private fieldAt: (lat: number, lon: number) => number | null = () => null,
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
    if (this.focus && now - this.focusAt >= FEED.traceEvery && !this.busy.plane) {
      this.focusAt = now;
      void this.askTrace(this.focus, now);
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

  /** A report taken: kept if newer than the one we have, the one before kept for the turn and the climb; what a
   *  poorer source leaves out (OpenSky: the registration, the type) kept from before. */
  private merge(p: Plane, now: number) {
    // (a barometric altitude — over the sea —: over the ellipsoid, as the geometric ones and our places, by the geoid)
    const baro = !!p.baro;
    if (p.baro) {
      p.alt += geoidDeg(p.lat, p.lon);
      p.baro = false;
    }
    // (on the ground though its source did not flag it — parked, taxiing —: on the airfield's ground; GROUNDED)
    if (!p.gnd && p.gs < GROUNDED.gsMax) {
      const h = this.fieldAt(p.lat, p.lon);
      if (groundedReport(p, h, baro)) {
        p.gnd = true;
        p.alt = h!;
        p.vs = 0;
      }
    }
    const T = this.planes.get(p.id);
    if (T) {
      p.reg ||= T.p.reg;
      p.type ||= T.p.type;
      p.cat ||= T.p.cat;
      p.cs ||= T.p.cs;
    }
    // (into its history, in time's order — a trace's older points too —, one point a quarter second at most)
    const hist = T?.hist ?? [];
    if (!hist.some((q) => Math.abs(q.t - p.t) < 0.25)) {
      let i = hist.length;
      while (i > 0 && hist[i - 1]!.t > p.t) i--;
      hist.splice(i, 0, p);
      const last = hist.at(-1)!.t;
      while (hist.length > 2 && last - hist[0]!.t > FEED.history) hist.shift();
    }
    const newest = hist.at(-1) ?? p;
    if (T && newest.t <= T.p.t) {
      T.heard = now;
      return;
    }
    this.planes.set(p.id, { p: newest, prev: hist.length > 1 ? hist.at(-2)! : (T?.p ?? null), hist, heard: now });
  }

  /** A ship's report taken: into its history (in time's order, a report a second at most), its name, type and size
   *  kept from before when a report leaves them out. */
  private mergeShip(s: Ship, now: number) {
    const T = this.ships.get(s.mmsi);
    if (T) {
      s.name ||= T.s.name;
      s.type ||= T.s.type;
      s.len ||= T.s.len;
      s.beam ||= T.s.beam;
      s.dest ||= T.s.dest;
    }
    const hist = T?.hist ?? [];
    if (Number.isFinite(s.lat) && !hist.some((q) => Math.abs(q.t - s.t) < 1)) {
      let i = hist.length;
      while (i > 0 && hist[i - 1]!.t > s.t) i--;
      hist.splice(i, 0, s);
      const last = hist.at(-1)!.t;
      while (hist.length > 2 && last - hist[0]!.t > FEED.history) hist.shift();
    }
    const newest = hist.at(-1) ?? s;
    this.ships.set(s.mmsi, { s: { ...newest, name: s.name, type: s.type, len: s.len, beam: s.beam, dest: s.dest }, hist, heard: now });
  }

  private async askTrace(id: string, now: number) {
    this.busy.plane = true;
    try {
      const res = await this.get(`${this.base()}/traffic/trace?id=${encodeURIComponent(id)}`);
      if (res.ok) {
        const j = (await res.json()) as { trace?: Plane[] };
        const T = this.planes.get(id);
        for (const q of j.trace ?? []) {
          // (a trace's points named as the aircraft is known)
          if (T) {
            q.cs ||= T.p.cs;
            q.reg ||= T.p.reg;
            q.type ||= T.p.type;
          }
          this.merge(q, now);
        }
      }
    } catch {
      /* the next one's */
    } finally {
      this.busy.plane = false;
    }
  }

  private async ask(what: "air" | "sea", at: { lat: number; lon: number }, now: number) {
    this.busy[what] = true;
    try {
      const r = what === "air" ? FEED.airR : FEED.seaR;
      const res = await this.get(`${this.base()}/traffic/${what}?lat=${at.lat.toFixed(4)}&lon=${at.lon.toFixed(4)}&r=${r}`);
      if (!res.ok) throw new Error(`${what} ${res.status}`);
      const j = (await res.json()) as { planes?: Plane[]; ships?: Ship[]; attribution?: string };
      if (what === "air") for (const p of j.planes ?? []) this.merge(p, now);
      else for (const s of j.ships ?? []) this.mergeShip(s, now);
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
