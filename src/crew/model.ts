import type { NetClient } from "../net/client";
import { BODIES, KINDS, type CraftSample, type Member } from "../net/proto";
import {
  readInstruments,
  type InstrumentKey,
  type InstrumentSnapshot,
  type InstrumentTraffic,
  type InstrumentZone,
} from "../net/instruments";
import { cartToGeodetic, WGS84_A, WGS84_F, wgs84Inverse, wgs84Offset } from "../system/ellipsoid";
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
  /** each pilot's surroundings, as last sent (once a second): their snapshot's room time `t`, our clock's `at` */
  private around = new Map<number, { traffic: InstrumentTraffic[]; zones: InstrumentZone[]; at: number; t: number }>();
  /** each pilot's fight (every snapshot: its targets, missiles, decoys — RD1) */
  private fast = new Map<number, { list: InstrumentTraffic[]; at: number; t: number }>();
  /** each contact as last drawn: its place, the room's time, the offset still being taken in (RD1: no jump) */
  private shown = new Map<string, { lat: number; lon: number; srcT: number; offE: number; offN: number; at: number }>();
  /** each contact's turn rate [rad/s] from its last two headings sent, their room time */
  private turns = new Map<string, { hdg: number; srcT: number; w: number }>();
  /** the pilot followed by his device (kept across a reconnection, ours or his — RD1) */
  private followDevice: string | null = null;
  private snapshots = new Map<number, { data: InstrumentSnapshot; at: number }>();
  private seen = new Map<number, { sample: CraftSample; at: number }>();
  constructor(readonly net: NetClient) {
    net.on("event", ({ from, ev }) => {
      // (the controls handed over — N3: the pilot followed now a passenger, the craft flown by the one he gave them to;
      // the console follows the craft)
      const to = (ev as { to?: unknown }).to;
      if (
        from === this.selected &&
        typeof to === "number" &&
        (ev.kind === "helm" || (ev.kind === "board" && (ev as { gone?: unknown }).gone === true))
      ) {
        this.selected = to;
        this.followDevice = net.room?.members.find((m) => m.slot === to)?.device ?? null;
        this.handedTo?.(to);
        return;
      }
      if (ev.kind !== "instruments" || !net.room?.members.some((m) => m.slot === from && m.role === "pilot")) return;
      const data = readInstruments(ev.data);
      if (!data) return;
      // (a ground station — PLAN-VAISSEAUX K5: the light's time late; behind the wormhole, nothing new at all)
      this.rawLink.set(from, data.link ?? null);
      this.rawCaps.set(from, data.caps ?? null);
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
    net.on("room", (room) => {
      this.snapshots.clear();
      this.around.clear();
      this.fast.clear();
      this.shown.clear();
      this.seen.clear();
      this.history.clear();
      this.lines.clear();
      this.rawLink.clear();
      this.rawCaps.clear();
      this.heavy.clear();
      // (a reconnection to the same room: the pilot followed found again by his device; another room: none)
      if (!room || room.code !== this.roomCode) this.followDevice = null;
      this.roomCode = room?.code ?? null;
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
          this.fast.delete(slot);
        }
    });
  }
  private roomCode: string | null = null;
  /** told when the console follows another pilot by itself (the controls handed over) */
  handedTo: ((slot: number) => void) | null = null;
  /** the station's link to a pilot (K5): its delay [s] and whether it is cut — set by the console (0 aboard, accepted) */
  linkFor: (link: InstrumentSnapshot["link"] | null | undefined, accepted: boolean) => { delay: number; cut: boolean } = () => ({
    delay: 0,
    cut: false,
  });
  /** each pilot's newest caps (not the delayed snapshot's): whether he holds the ground's orders, whom he took aboard */
  private rawCaps = new Map<number, InstrumentSnapshot["caps"] | null>();
  /** whether a pilot has taken this screen aboard (AUDIT-CREW priority 6) — an older pilot, who asks for no agreement:
   *  yes; none said yet: no */
  aboardWith(slot: number): boolean {
    const caps = this.rawCaps.get(slot);
    if (!caps?.hold) return true;
    return !!this.net.room && !!caps.aboard?.includes(this.net.room.slot);
  }
  /** whether a pilot holds the ground's orders and messages the light's time himself (the console then sends at once) */
  holds(slot: number): boolean {
    return this.rawCaps.get(slot)?.hold === true;
  }
  private lines = new Map<number, DelayLine<InstrumentSnapshot>>();
  private rawLink = new Map<number, InstrumentSnapshot["link"] | null>();
  /** a pilot's link as the station has it now (from his newest snapshot, not the delayed one) */
  linkOf(slot: number) {
    return this.linkFor(this.rawLink.get(slot), this.aboardWith(slot));
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
        this.around.set(from, { traffic: data.traffic ?? [], zones: data.zones ?? [], at: performance.now(), t: data.t });
      if (data.tracks) this.fast.set(from, { list: data.tracks, at: performance.now(), t: data.t });
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
      const track = this.net.remotes.track(member.slot);
      const latest = track?.latest;
      if (!latest) return [];
      // (where it is now — the track's prediction at the room's time, as the pilots' own pages draw it —, not its last
      // sample's place: speed × the latency and the sample's age off — RD1)
      const rt = this.net.roomNow();
      const st = Number.isFinite(rt) ? track.at(rt) : null;
      const sample: CraftSample = st && latest.frame === 0 ? { ...latest, p: st.p, v: st.v, q: st.q } : latest;
      const previous = this.seen.get(member.slot);
      if (previous?.sample !== latest) this.seen.set(member.slot, { sample: latest, at: now });
      const snap = this.snapshots.get(member.slot);
      // (fresh within 3 s — or the last word of a craft behind the wormhole, kept: the link cut, not the craft gone)
      const fresh = snap && (now - snap.at < 3000 || this.linkOf(member.slot).cut);
      const snapshot = fresh ? snap.data : null;
      // (over the Earth: the predicted place, the snapshot's heading; elsewhere the snapshot's own place)
      const pg = st ? sampleGeo(sample) : null;
      const geo = pg && snapshot?.geo ? { ...pg, heading: snapshot.geo.heading } : (snapshot?.geo ?? pg ?? sampleGeo(sample));
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
   * Everything the pilots see about, merged (one entry an id: the freshest — a pilot's fight, every snapshot, before his
   * surroundings, once a second), carried on along its heading at its speed for the room's time since it was sent (RD1:
   * a pause holds it still, a warp hastens it), flat over a few seconds; a new place taken in over 0.2 s (no jump); a turning one along its arc;
   * dropped after 8 s without news.
   */
  contacts(): Contact[] {
    const now = performance.now();
    const room = this.net.roomNow();
    const by = new Map<string, { t: InstrumentTraffic; srcT: number; age: number }>();
    const take = (list: InstrumentTraffic[], t: number, at: number) => {
      // (the room's time since it was sent; no room clock: our own)
      const age = Number.isFinite(room) ? Math.max(0, room - t) : (now - at) / 1000;
      for (const x of list) {
        const had = by.get(x.id);
        if (had && had.srcT >= t) continue;
        by.set(x.id, { t: x, srcT: t, age });
      }
    };
    for (const [slot, f] of this.fast) {
      if ((now - f.at) / 1000 > 8) this.fast.delete(slot);
      else take(f.list, f.t, f.at);
    }
    for (const [slot, a] of this.around) {
      if ((now - a.at) / 1000 > 8) {
        this.around.delete(slot);
        continue;
      }
      take(a.traffic, a.t, a.at);
    }
    const out: Contact[] = [];
    for (const [id, { t, srcT, age }] of by) {
      let { lat, lon } = t;
      // (its turn: the heading's change between its last two places sent, ±0.5 rad/s at most — carried on along that
      // arc, not straight: a drone in a turn stays on it)
      const tn = this.turns.get(id);
      if (t.hdg !== null && (!tn || tn.srcT !== srcT)) {
        const dt = tn ? srcT - tn.srcT : 0;
        const w = tn && dt > 0.05 && dt < 2 ? Math.atan2(Math.sin(t.hdg - tn.hdg), Math.cos(t.hdg - tn.hdg)) / dt : 0;
        this.turns.set(id, { hdg: t.hdg, srcT, w: Math.max(-0.5, Math.min(0.5, w)) });
      }
      if (t.spd !== null && t.hdg !== null && t.spd > 0.5) {
        const a = Math.min(age, 4),
          w = this.turns.get(id)?.w ?? 0,
          h = t.hdg,
          v = t.spd;
        const e = Math.abs(w) > 1e-4 ? (v / w) * (Math.cos(h) - Math.cos(h + w * a)) : v * a * Math.sin(h),
          n = Math.abs(w) > 1e-4 ? (v / w) * (Math.sin(h + w * a) - Math.sin(h)) : v * a * Math.cos(h);
        ({ lat, lon } = wgs84Offset(lat, lon, e, n));
      }
      // (a new place: what was drawn kept as an offset that fades in 0.2 s — beyond 2 km a jump it is, taken at once)
      const was = this.shown.get(id);
      let offE = was?.offE ?? 0,
        offN = was?.offN ?? 0,
        at0 = was?.at ?? now;
      if (was && was.srcT !== srcT) {
        // (the offset from the new place to the one drawn last frame: east, north [m] — WGS84)
        const q = wgs84Inverse(lat, lon, was.lat, was.lon);
        const dE = q.d * Math.sin(q.az),
          dN = q.d * Math.cos(q.az);
        const jump = Math.hypot(dE, dN) >= 2000;
        offE = jump ? 0 : dE;
        offN = jump ? 0 : dN;
        at0 = now;
      }
      const f = Math.exp(-(now - at0) / 200);
      const shownAt = f > 1e-3 && (offE || offN) ? wgs84Offset(lat, lon, offE * f, offN * f) : { lat, lon };
      this.shown.set(id, { lat: shownAt.lat, lon: shownAt.lon, srcT, offE, offN, at: at0 });
      out.push({ ...t, lat: shownAt.lat, lon: shownAt.lon, age });
    }
    for (const id of this.shown.keys()) if (!by.has(id)) this.shown.delete(id);
    for (const id of this.turns.keys()) if (!by.has(id)) this.turns.delete(id);
    return out;
  }
  /** the mission's zones (the followed pilot's first) */
  zones(): InstrumentZone[] {
    const own = this.around.get(this.selected ?? -1);
    if (own?.zones.length) return own.zones;
    for (const a of this.around.values()) if (a.zones.length) return a.zones;
    return [];
  }
  own(crafts = this.crafts()) {
    if (!crafts.some((c) => c.member.slot === this.selected)) {
      // (the pilot followed before a reconnection — ours or his —: found again by his device)
      const back = this.followDevice ? crafts.find((c) => c.member.device === this.followDevice) : undefined;
      this.selected = back?.member.slot ?? crafts[0]?.member.slot ?? null;
    }
    const own = crafts.find((c) => c.member.slot === this.selected) ?? null;
    if (own?.member.device) this.followDevice = own.member.device;
    return own;
  }
  csv() {
    const keys = METRICS.map((m) => m.key);
    return [
      `t_s,${keys.join(",")}`,
      ...(this.history.get(this.selected ?? -1) ?? []).map((p) => [p.t, ...keys.map((k) => p.metrics[k] ?? "")].join(",")),
    ].join("\n");
  }
}
