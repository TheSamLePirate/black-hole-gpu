// The crew's track store (docs/PLAN-RADAR-AAA.md RD6): every pilot's tactical picture (net/picture.ts — the `pic`
// block of his instruments, four times a second) decoded and merged by id, the freshest measure winning; each pilot's
// radar's mode, beam and scope's range, his selection and his lock; the histories a pilot sends a crew that comes
// (his last two minutes). What the console's views read: « Capteur » the tracks his sensors hold, coloured by the IFF
// they know; « Partagé » every one, coloured by what it truly is (the truth, the decision: also in a match).

import type { InstrumentTraffic } from "../net/instruments";
import { type PicBlock, type PicDecoded, PicDecoder } from "../net/picture";

/** A track as the console's contacts carry it: the instruments' traffic's fields, the picture's own beside them. */
export interface PicContactFields {
  /** the pilot's sensors holding it (radar/picture.ts SENSOR bits); its IFF as they know it; how they hold it */
  sensors?: number;
  iff?: string;
  state?: string;
  locked?: boolean;
  pilotSel?: boolean;
  /** a missile's figures (its target's id, time to go, ours, decoyed, its end) */
  msl?: PicDecoded["msl"];
  /** a decoy's life left [s] */
  life?: number;
  /** its vertical speed [m/s] */
  vu?: number;
  /** the slot of the pilot whose picture it came from */
  from?: number;
}

export interface StoredTrack {
  traffic: InstrumentTraffic & PicContactFields;
  /** the room's time of its place [s]; our clock when heard [ms] */
  srcT: number;
  at: number;
}

/** A missile's cue, as the console's draw reads it (crew/draw/kit.ts missileCue): its end, at us, decoyed, its time. */
export function missileType(m: NonNullable<PicDecoded["msl"]>): string {
  if (m.end) return m.end === "splash" ? "SPLASH" : "MISS";
  return [m.target === "own" ? "→ US" : "", m.decoyed ? "DECOYED" : "", m.tti !== null && m.tti < 600 ? `${Math.round(m.tti)}s` : ""]
    .filter(Boolean)
    .join(" ");
}

/** A decoded track as the console's contact. */
export function contactOf(T: PicDecoded, from: number): InstrumentTraffic & PicContactFields {
  const sp = Math.hypot(T.ve, T.vn);
  const decoy = T.kind === "flare" || T.kind === "chaff";
  return {
    id: T.id,
    name: T.name,
    kind: T.kind === "flare" || T.kind === "chaff" ? "decoy" : T.kind,
    side: T.kind === "missile" ? (T.msl?.ours ? "friend" : "hostile") : decoy ? "friend" : T.side,
    lat: T.lat,
    lon: T.lon,
    alt: T.h,
    hdg: sp > 1 ? Math.atan2(T.ve, T.vn) : null,
    spd: sp,
    type: T.kind === "missile" && T.msl ? missileType(T.msl) : decoy ? T.kind : T.type,
    ...(T.tcas === "proximate" || T.tcas === "TA" || T.tcas === "RA" ? { adv: T.tcas } : {}),
    sensors: T.sensors,
    iff: T.iff,
    state: T.state,
    locked: T.locked,
    pilotSel: T.selected,
    ...(T.msl ? { msl: T.msl } : {}),
    ...(T.life !== undefined ? { life: T.life } : {}),
    vu: T.vu,
    from,
  };
}

/** Each pilot's radar as his picture says: its mode, its beam off his nose [rad], his scope's range [m], his selection,
 *  his lock (their ids), when heard. */
export interface PilotRadar {
  mode: string;
  beam: number | null;
  range: number;
  sel: string | null;
  lock: string | null;
  srcT: number;
  at: number;
}

export class TrackStore {
  private dec = new Map<number, PicDecoder>();
  private by = new Map<string, StoredTrack>();
  readonly radar = new Map<number, PilotRadar>();
  /** the histories received (a crew come — RD5's catch-up): their places and room times, by id */
  readonly hist = new Map<string, { lat: number; lon: number; t: number }[]>();
  /** each pilot's last block (its room time, our clock) */
  private last = new Map<number, { t: number; at: number }>();

  /** A pilot's block heard: its room time `t` [s]; our clock `at` [ms]. */
  ingest(slot: number, B: PicBlock, t: number, at = performance.now()) {
    let D = this.dec.get(slot);
    if (!D) this.dec.set(slot, (D = new PicDecoder()));
    const out = D.decode(B);
    for (const T of out.tracks) {
      const had = this.by.get(T.id);
      // (the freshest measure wins: another pilot's newer one kept)
      if (had && had.srcT > t && had.traffic.from !== slot) continue;
      this.by.set(T.id, { traffic: contactOf(T, slot), srcT: t, at });
    }
    for (const id of out.gone) if (this.by.get(id)?.traffic.from === slot) this.by.delete(id);
    for (const h of out.hist)
      this.hist.set(
        h.id,
        h.pts.map((p) => ({ lat: p.lat, lon: p.lon, t: t - p.age })),
      );
    this.radar.set(slot, { mode: B.m, beam: B.b === null ? null : B.b / 1000, range: B.rg, sel: out.sel, lock: out.lock, srcT: t, at });
    this.last.set(slot, { t, at });
  }

  /** A pilot whose picture is fresh (heard within 8 s): his surroundings come from it, not the older blocks. */
  fresh(slot: number, now = performance.now()): boolean {
    const L = this.last.get(slot);
    return !!L && now - L.at < 8000;
  }

  /** The tracks heard: a truth's after 8 s without news dropped, a sensor's (its pilot lost it: gone) at once. */
  tracks(now = performance.now()): StoredTrack[] {
    const out: StoredTrack[] = [];
    for (const [id, S] of this.by) {
      if (now - S.at > 8000) {
        this.by.delete(id);
        continue;
      }
      out.push(S);
    }
    return out;
  }
}
