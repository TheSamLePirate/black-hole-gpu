import type { NetClient } from "../net/client";
import { BODIES, KINDS, type CraftSample, type Member } from "../net/proto";
import { readInstruments, type InstrumentKey, type InstrumentSnapshot } from "../net/instruments";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";

export const D = Math.PI / 180;
export const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const METRICS: { key: InstrumentKey; name: string; unit: string; k: number }[] = [
  { key: "alt", name: "Altitude", unit: "km", k: 0.001 },
  { key: "speed", name: "Vitesse", unit: "m/s", k: 1 },
  { key: "vz", name: "Vitesse verticale", unit: "m/s", k: 1 },
  { key: "mach", name: "Mach", unit: "", k: 1 },
  { key: "g", name: "Charge", unit: "g", k: 1 },
  { key: "fuel", name: "Carburant", unit: "%", k: 100 },
  { key: "throttle", name: "Gaz", unit: "%", k: 100 },
  { key: "q", name: "Pression dynamique", unit: "kPa", k: 0.001 },
  { key: "heat", name: "Flux thermique", unit: "W/cm²", k: 0.0001 },
  { key: "tau", name: "Temps propre", unit: "τ/t", k: 1 },
];
export const valueText = (value: number | undefined, k = 1) =>
  value === undefined || !Number.isFinite(value)
    ? "—"
    : (value * k).toLocaleString("fr-FR", { maximumFractionDigits: Math.abs(value * k) < 10 ? 2 : 1 });

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

export class CrewModel {
  selected: number | null = null;
  readonly history = new Map<number, HistoryPoint[]>();
  private snapshots = new Map<number, { data: InstrumentSnapshot; at: number }>();
  private seen = new Map<number, { sample: CraftSample; at: number }>();
  constructor(readonly net: NetClient) {
    net.on("event", ({ from, ev }) => {
      if (ev.kind !== "instruments" || !net.room?.members.some((m) => m.slot === from && m.role === "pilot")) return;
      const data = readInstruments(ev.data);
      if (!data) return;
      this.snapshots.set(from, { data, at: performance.now() });
      let h = this.history.get(from) ?? [];
      if (h.length && (data.t < h[h.length - 1]!.t || data.body !== h[h.length - 1]!.body)) h = [];
      if (!h.length || data.t > h[h.length - 1]!.t) h.push({ t: data.t, metrics: data.metrics, geo: data.geo, body: data.body });
      if (h.length > 2400) h.splice(0, h.length - 2400);
      this.history.set(from, h);
    });
    net.on("room", () => {
      this.snapshots.clear();
      this.seen.clear();
      this.history.clear();
      this.selected = null;
    });
    net.on("roster", (members) => {
      const live = new Set(members.map((m) => m.slot));
      for (const slot of this.snapshots.keys())
        if (!live.has(slot)) {
          this.snapshots.delete(slot);
          this.history.delete(slot);
          this.seen.delete(slot);
        }
    });
  }
  crafts(): CrewCraft[] {
    const now = performance.now();
    return (this.net.room?.members ?? []).flatMap((member) => {
      if (member.role !== "pilot") return [];
      const sample = this.net.remotes.track(member.slot)?.latest;
      if (!sample) return [];
      const previous = this.seen.get(member.slot);
      if (previous?.sample !== sample) this.seen.set(member.slot, { sample, at: now });
      const snap = this.snapshots.get(member.slot);
      const fresh = snap && now - snap.at < 3000;
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
