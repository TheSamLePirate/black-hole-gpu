import type { NetClient } from "../net/client";
import { BODIES, KINDS, type CraftSample, type Member } from "../net/proto";
import {
  readInstruments,
  type InstrumentKey,
  type InstrumentSnapshot,
  type InstrumentTraffic,
  type InstrumentZone,
} from "../net/instruments";
import { cartToGeodetic, WGS84_A, WGS84_F, wgs84Offset } from "../system/ellipsoid";
import { DelayLine } from "./station";
import { L, locale } from "./lang";

export const D = Math.PI / 180;
export const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** the telemetry's measures: their names in the console's language (`name()`), their SI unit and factor */
export const METRICS: { key: InstrumentKey; name: () => string; unit: string; k: number }[] = [
  { key: "alt", name: () => "Altitude", unit: "km", k: 0.001 },
  { key: "speed", name: () => L("Vitesse", "Speed"), unit: "m/s", k: 1 },
  { key: "vz", name: () => L("Vitesse verticale", "Vertical speed"), unit: "m/s", k: 1 },
  { key: "mach", name: () => "Mach", unit: "", k: 1 },
  { key: "g", name: () => L("Charge", "Load"), unit: "g", k: 1 },
  { key: "fuel", name: () => L("Carburant", "Fuel"), unit: "%", k: 100 },
  { key: "throttle", name: () => L("Gaz", "Throttle"), unit: "%", k: 100 },
  { key: "q", name: () => L("Pression dynamique", "Dynamic pressure"), unit: "kPa", k: 0.001 },
  { key: "heat", name: () => L("Flux thermique", "Heat flux"), unit: "W/cm²", k: 0.0001 },
  { key: "tau", name: () => L("Temps propre", "Proper time"), unit: "τ/t", k: 1 },
];
export const valueText = (value: number | undefined, k = 1) =>
  value === undefined || !Number.isFinite(value)
    ? "—"
    : (value * k).toLocaleString(locale(), { maximumFractionDigits: Math.abs(value * k) < 10 ? 2 : 1 });

export interface CrewCraft {
  member: Member;
  kind: string;
  sample: CraftSample;
  geo: InstrumentSnapshot["geo"];
  body: string;
  age: number;
  snapshot: InstrumentSnapshot | null;
  metrics: InstrumentSnapshot["metrics"];
}
export interface HistoryPoint {
  t: number;
  metrics: InstrumentSnapshot["metrics"];
  geo: InstrumentSnapshot["geo"];
  body: string;
}

/** Geographic fallback only for known body-fixed frames. Never interpret inertial/Gargantua axes as ECEF. */
export function sampleGeo(sample: CraftSample): InstrumentSnapshot["geo"] {
  if (sample.frame !== 0 || sample.body !== 0) return null;
  const g = cartToGeodetic(WGS84_A, WGS84_F, sample.p);
  const [x, y, z, w] = sample.q;
  const forward = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
  const E = [-Math.sin(g.lon), Math.cos(g.lon), 0];
  const N = [-Math.sin(g.lat) * Math.cos(g.lon), -Math.sin(g.lat) * Math.sin(g.lon), Math.cos(g.lat)];
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
  return { lat: g.lat / D, lon: g.lon / D, heading: Math.atan2(dot(forward, E), dot(forward, N)) };
}

/** Same-frame relative picture in the selected craft's local tangent frame; metres. */
export function relative(own: CrewCraft, other: CrewCraft): { e: number; n: number; dz: number; distance: number } | null {
  const a = own.sample,
    b = other.sample;
  if (a.frame !== b.frame || a.body !== b.body) return null;
  const p = b.p.map((v, i) => v - a.p[i]!);
  if (a.frame === 2) return null; // its motion uses different conventions; no fabricated radar distances
  const r = Math.hypot(...a.p) || 1;
  const lon = Math.atan2(a.p[1], a.p[0]);
  const lat = a.frame === 0 && a.body === 0 ? cartToGeodetic(WGS84_A, WGS84_F, a.p).lat : Math.asin(a.p[2] / r);
  const sl = Math.sin(lon),
    cl = Math.cos(lon),
    sp = Math.sin(lat),
    cp = Math.cos(lat);
  return {
    e: -sl * p[0]! + cl * p[1]!,
    n: -sp * cl * p[0]! - sp * sl * p[1]! + cp * p[2]!,
    dz: cp * cl * p[0]! + cp * sl * p[1]! + sp * p[2]!,
    distance: Math.hypot(...p),
  };
}

/** a unit about, moved on along its heading since it was heard; `age` [s] */
export interface Contact extends InstrumentTraffic {
  age: number;
}

export class CrewModel {
  selected: number | null = null;
  readonly history = new Map<number, HistoryPoint[]>();
  /** each pilot's surroundings, as last sent (once a second) */
  private around = new Map<number, { traffic: InstrumentTraffic[]; zones: InstrumentZone[]; at: number }>();
  private snapshots = new Map<number, { data: InstrumentSnapshot; at: number }>();
  private seen = new Map<number, { sample: CraftSample; at: number }>();
  constructor(readonly net: NetClient) {
    net.on("event", ({ from, ev }) => {
      if (ev.kind !== "instruments" || !net.room?.members.some((m) => m.slot === from && m.role === "pilot")) return;
      const data = readInstruments(ev.data);
      if (!data) return;
      // (a ground station — PLAN-VAISSEAUX K5: the light's time late; behind the wormhole, nothing new at all)
      this.rawLink.set(from, data.link ?? null);
      const L = this.linkOf(from);
      // (cut: nothing new — but a craft never seen yet is known, its last word: the console's profile, its badge; and
      // what its once-a-second blocks bring until they have come)
      if (L.cut) {
        const had = this.snapshots.get(from)?.data;
        if (!had || (data.hole && !had.hole) || (data.bodies && !had.bodies)) this.apply(from, data);
        return;
      }
      const line = this.lines.get(from);
      if (L.delay > 0 || (line && line.size)) {
        const q = line ?? new DelayLine<InstrumentSnapshot>();
        this.lines.set(from, q);
        q.push(data, performance.now() / 1000, L.delay);
        return;
      }
      this.apply(from, data);
    });
    net.on("room", () => {
      this.snapshots.clear();
      this.around.clear();
      this.seen.clear();
      this.history.clear();
      this.lines.clear();
      this.rawLink.clear();
      this.heavy.clear();
      this.selected = null;
    });
    net.on("roster", (members) => {
      const live = new Set(members.map((m) => m.slot));
      for (const slot of this.snapshots.keys())
        if (!live.has(slot)) {
          this.snapshots.delete(slot);
          this.around.delete(slot);
          this.history.delete(slot);
          this.seen.delete(slot);
          this.lines.delete(slot);
          this.heavy.delete(slot);
        }
    });
  }
  /** the station's link to a pilot (K5): its delay [s] and whether it is cut — set by the console (0 aboard) */
  linkFor: (link: InstrumentSnapshot["link"] | null | undefined) => { delay: number; cut: boolean } = () => ({ delay: 0, cut: false });
  private lines = new Map<number, DelayLine<InstrumentSnapshot>>();
  private rawLink = new Map<number, InstrumentSnapshot["link"] | null>();
  /** a pilot's link as the station has it now (from his newest snapshot, not the delayed one) */
  linkOf(slot: number) {
    return this.linkFor(this.rawLink.get(slot));
  }
  /** the delayed snapshots now due, shown */
  private pump() {
    const now = performance.now() / 1000;
    for (const [slot, q] of this.lines) {
      const L = this.linkOf(slot);
      const v = q.take(now, L.delay);
      if (v && this.snapshots.get(slot)?.data !== v) this.apply(slot, v);
    }
  }
  /** each pilot's once-a-second blocks (PLAN-VAISSEAUX K1: the bodies, the paths, Gargantua's side), the last ones —
   *  carried into the snapshots between them, as the surroundings are */
  private heavy = new Map<number, Pick<InstrumentSnapshot, "bodies" | "traj" | "hole" | "others">>();
  /** a snapshot shown: the pilot's figures, his surroundings, his history */
  private apply(from: number, data: InstrumentSnapshot) {
    {
      const hv = this.heavy.get(from) ?? {};
      if (data.bodies || data.traj || data.hole || data.others) {
        if (data.others) hv.others = data.others;
        if (data.bodies) hv.bodies = data.bodies;
        if (data.traj) hv.traj = data.traj;
        if (data.hole) hv.hole = data.hole;
        this.heavy.set(from, hv);
      }
      // (a side changed — the wormhole crossed —: the other side's blocks dropped)
      if (data.hole && hv.bodies) {
        delete hv.bodies;
        delete hv.traj;
        delete hv.others;
      }
      if (data.state && hv.hole) delete hv.hole;
      data = {
        ...data,
        ...(data.bodies ? {} : hv.bodies ? { bodies: hv.bodies } : {}),
        ...(data.traj ? {} : hv.traj ? { traj: hv.traj } : {}),
        ...(data.others ? {} : hv.others ? { others: hv.others } : {}),
        ...(data.hole ? {} : hv.hole ? { hole: hv.hole } : {}),
      };
      this.snapshots.set(from, { data, at: performance.now() });
      if (data.traffic || data.zones)
        this.around.set(from, { traffic: data.traffic ?? [], zones: data.zones ?? [], at: performance.now() });
      let h = this.history.get(from) ?? [];
      if (h.length && (data.t < h[h.length - 1]!.t || data.body !== h[h.length - 1]!.body)) h = [];
      if (!h.length || data.t > h[h.length - 1]!.t) h.push({ t: data.t, metrics: data.metrics, geo: data.geo, body: data.body });
      if (h.length > 2400) h.splice(0, h.length - 2400);
      this.history.set(from, h);
    }
  }
  crafts(): CrewCraft[] {
    this.pump();
    const now = performance.now();
    return (this.net.room?.members ?? []).flatMap((member) => {
      if (member.role !== "pilot") return [];
      const sample = this.net.remotes.track(member.slot)?.latest;
      if (!sample) return [];
      const previous = this.seen.get(member.slot);
      if (previous?.sample !== sample) this.seen.set(member.slot, { sample, at: now });
      const snap = this.snapshots.get(member.slot);
      // (fresh within 3 s — or the last word of a craft behind the wormhole, kept: the link cut, not the craft gone)
      const fresh = snap && (now - snap.at < 3000 || this.linkOf(member.slot).cut);
      const snapshot = fresh ? snap.data : null;
      const geo = snapshot?.geo ?? sampleGeo(sample);
      const metrics: InstrumentSnapshot["metrics"] = { ...snapshot?.metrics };
      if (sample.frame !== 2 && metrics.speed === undefined) metrics.speed = Math.hypot(...sample.v);
      if (sample.frame === 0 && sample.body === 0 && metrics.alt === undefined) metrics.alt = cartToGeodetic(WGS84_A, WGS84_F, sample.p).h;
      if (metrics.mach === undefined) metrics.mach = sample.vis.mach;
      return [
        {
          member,
          sample,
          geo,
          snapshot,
          metrics,
          body: snapshot?.body ?? (sample.frame === 2 ? "gargantua" : (BODIES[sample.body] ?? "unknown")),
          kind: KINDS[sample.kind] ?? "craft",
          // A paused room can send identical simulation timestamps; its live telemetry still proves reception.
          age: (now - Math.max(this.seen.get(member.slot)?.at ?? now, snap?.at ?? 0)) / 1000,
        },
      ];
    });
  }
  /**
   * Everything the pilots see about, merged (one entry an id: the freshest), moved on along its heading at its speed
   * since it was sent (flat over a few seconds); dropped after 8 s without news.
   */
  contacts(): Contact[] {
    const now = performance.now();
    const by = new Map<string, Contact>();
    for (const [slot, a] of this.around) {
      const age = (now - a.at) / 1000;
      if (age > 8) {
        this.around.delete(slot);
        continue;
      }
      for (const t of a.traffic) {
        const had = by.get(t.id);
        if (had && had.age <= age) continue;
        let { lat, lon } = t;
        if (t.spd !== null && t.hdg !== null && t.spd > 0.5) {
          const d = t.spd * Math.min(age, 4);
          ({ lat, lon } = wgs84Offset(lat, lon, d * Math.sin(t.hdg), d * Math.cos(t.hdg)));
        }
        by.set(t.id, { ...t, lat, lon, age });
      }
    }
    return [...by.values()];
  }
  /** the mission's zones (the followed pilot's first) */
  zones(): InstrumentZone[] {
    const own = this.around.get(this.selected ?? -1);
    if (own?.zones.length) return own.zones;
    for (const a of this.around.values()) if (a.zones.length) return a.zones;
    return [];
  }
  own(crafts = this.crafts()) {
    if (!crafts.some((c) => c.member.slot === this.selected)) this.selected = crafts[0]?.member.slot ?? null;
    return crafts.find((c) => c.member.slot === this.selected) ?? null;
  }
  csv() {
    const keys = METRICS.map((m) => m.key);
    return [
      `t_s,${keys.join(",")}`,
      ...(this.history.get(this.selected ?? -1) ?? []).map((p) => [p.t, ...keys.map((k) => p.metrics[k] ?? "")].join(",")),
    ].join("\n");
  }
}
