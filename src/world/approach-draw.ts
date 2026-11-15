// An approach drawn on a map or a radar (docs/PLAN-APPROCHES.md §5.1, AP4): one way for every screen — the tactical map now,
// the HUD's radar, the TSD and the crew's screens next (AP5, AP6). The chosen approach bright: the localizer's cone (« plume »)
// out to 18 NM, its fixes with their names and altitudes (IAF, IF, FAF and the others), the way planned from the craft (solid),
// the missed approach (dashed), the hold (a racetrack); the field's other approaches faint, their axes alone — each a place to
// click. Pure (a 2D context in): the crew's bundle takes it.

import { wgs84Direct } from "../system/ellipsoid";
import type { Approach, Leg } from "./approaches";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const NM = 1852;

export interface MapFix {
  name: string;
  lat: number;
  lon: number;
  /** at or above, at or below [m over the sea] */
  alt?: [number | null, number | null];
  role: "IAF" | "IF" | "FAF" | "MAP" | "fix";
}

/** What a screen draws of an approach (built once by the controller — controller/approach.ts approachMapData —, drawn often). */
export interface MapApproach {
  id: string;
  field: string;
  rwy: string;
  /** « ILS 31R · CAT I · nav.dat 2013 » */
  label: string;
  /** the threshold, the final course [° true]; a localizer's antenna, its cone's half width [°] */
  thr: { lat: number; lon: number };
  crs: number;
  cone: boolean;
  fixes: MapFix[];
  /** the way from the threshold over the missed approach [°] */
  missed: [number, number][];
  /** the hold at its fix: its inbound course [° true], turns right or left */
  hold: { lat: number; lon: number; crs: number; right: boolean } | null;
  /** the join planned, its points left (engaged: game/approach-plan.ts) [°] — drawn from the craft (`from`) */
  join: [number, number][];
  /** engaged now (flown), else chosen */
  engaged: boolean;
  /** the vertical profile: the threshold's level, the relief under the final every kilometre out to 25 km [m over the sea] */
  profile: { elev: number; ground: number[] } | null;
  /** the field's other approaches: their axes, to click */
  others: { id: string; rwy: string; label: string; thr: { lat: number; lon: number }; crs: number }[];
}

/** An approach's short label: its kind, end, category, source. */
export function approachLabel(a: Approach): string {
  const kind = a.kind === "VIS" ? "Built" : a.kind;
  const cat = a.loc?.cat ? ` · CAT ${a.loc.cat}` : "";
  const src = a.source === "cifp" ? `FAA ${a.cycle ?? ""}` : a.source === "navdat" ? "nav.dat 2013" : "built";
  return `${kind} ${a.rwy}${cat} · ${src.trim()}`;
}

/** The fixes of an approach, by role: its transition's first (IAF), the final's first (IF), its FAF, its MAP. */
export function approachFixes(a: Approach, via: Leg[] | null): MapFix[] {
  const out: MapFix[] = [];
  const add = (l: Leg, role: MapFix["role"]) => {
    if (l.lat === undefined || l.lon === undefined || !l.fix) return;
    // (a transition's last point is the final's first: its role there — IF — kept)
    const had = out.find((f) => f.name === l.fix);
    if (had) {
      if (role !== "fix") had.role = role;
      return;
    }
    out.push({ name: l.fix, lat: l.lat, lon: l.lon, ...(l.alt ? { alt: l.alt } : {}), role });
  };
  via?.forEach((l, i) => add(l, i === 0 ? "IAF" : "fix"));
  const fin = a.final;
  fin.forEach((l, i) => {
    const role: MapFix["role"] =
      i === 0 ? "IF" : /^RW/.test(l.fix ?? "") ? "MAP" : i === fin.length - 2 || /^FF/.test(l.fix ?? "") ? "FAF" : "fix";
    add(l, role);
  });
  return out;
}

/** A point `d` [m] before the threshold on the final course. */
const back = (thr: { lat: number; lon: number }, crs: number, d: number) => wgs84Direct(thr.lat, thr.lon, ((crs + 180) * Math.PI) / 180, d);

export interface ApproachDrawOpts {
  at: (lat: number, lon: number) => [number, number] | null;
  /** the screen's scale for lines and text */
  k?: number;
  /** where the craft is: the join drawn from it */
  from?: [number, number];
  /** an altitude said in the player's units (ui/unitsys.ts: metres by default — « 914 m », or « 3000 ft ») */
  alt?: (m: number) => string;
  /** each thing drawn to click: an approach (its id) or a runway's end, where */
  hit?: (what: { approach?: string; rwy?: string }, x: number, y: number) => void;
}

/** The approach drawn (see the module's note). */
export function drawApproach(g: Ctx, A: MapApproach, o: ApproachDrawOpts) {
  const k = o.k ?? 1;
  const P = (lat: number, lon: number) => o.at(lat, lon);
  g.save();
  g.lineCap = "round";
  // the others: their axes faint, 10 NM out; their place to click at 6 NM
  for (const B of A.others) {
    const a = P(B.thr.lat, B.thr.lon);
    const f = back(B.thr, B.crs, 10 * NM);
    const b = P(f.lat, f.lon);
    if (!a || !b) continue;
    g.strokeStyle = "rgba(190, 210, 230, 0.35)";
    g.lineWidth = 1.5 * k;
    g.setLineDash([4 * k, 4 * k]);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
    g.setLineDash([]);
    const m = back(B.thr, B.crs, 6 * NM);
    const c = P(m.lat, m.lon);
    if (c) o.hit?.({ approach: B.id }, c[0], c[1]);
    o.hit?.({ rwy: B.rwy }, a[0], a[1]);
  }
  const col = A.engaged ? "rgba(255, 92, 225, 0.95)" : "rgba(95, 230, 255, 0.95)";
  const faint = A.engaged ? "rgba(255, 92, 225, 0.18)" : "rgba(95, 230, 255, 0.16)";
  const t0 = P(A.thr.lat, A.thr.lon);
  // the plume: a localizer's cone (±2.5° out to 18 NM), else the final course alone
  if (A.cone && t0) {
    const L = 18 * NM;
    const l = wgs84Direct(A.thr.lat, A.thr.lon, ((A.crs + 180 - 2.5) * Math.PI) / 180, L);
    const r = wgs84Direct(A.thr.lat, A.thr.lon, ((A.crs + 180 + 2.5) * Math.PI) / 180, L);
    const pl = P(l.lat, l.lon),
      pr = P(r.lat, r.lon);
    if (pl && pr) {
      g.fillStyle = faint;
      g.beginPath();
      g.moveTo(t0[0], t0[1]);
      g.lineTo(pl[0], pl[1]);
      g.lineTo(pr[0], pr[1]);
      g.closePath();
      g.fill();
    }
  }
  const far = back(A.thr, A.crs, 18 * NM);
  const pf = P(far.lat, far.lon);
  if (t0 && pf) {
    g.strokeStyle = col;
    g.lineWidth = 2 * k;
    g.beginPath();
    g.moveTo(t0[0], t0[1]);
    g.lineTo(pf[0], pf[1]);
    g.stroke();
    const m = back(A.thr, A.crs, 6 * NM);
    const c = P(m.lat, m.lon);
    if (c) o.hit?.({ approach: A.id }, c[0], c[1]);
    o.hit?.({ rwy: A.rwy }, t0[0], t0[1]);
  }
  // the join planned: solid, from the craft
  const J = o.from ? [o.from, ...A.join] : A.join;
  if (J.length > 1) {
    g.strokeStyle = col;
    g.lineWidth = 2.2 * k;
    g.beginPath();
    let first = true;
    for (const [la, lo] of J) {
      const p = P(la, lo);
      if (!p) continue;
      if (first) g.moveTo(p[0], p[1]);
      else g.lineTo(p[0], p[1]);
      first = false;
    }
    g.stroke();
  }
  // the missed approach: dashed, from the threshold
  if (A.missed.length && t0) {
    g.strokeStyle = col;
    g.lineWidth = 1.6 * k;
    g.setLineDash([7 * k, 5 * k]);
    g.beginPath();
    g.moveTo(t0[0], t0[1]);
    for (const [la, lo] of A.missed) {
      const p = P(la, lo);
      if (p) g.lineTo(p[0], p[1]);
    }
    g.stroke();
    g.setLineDash([]);
  }
  // the hold: a racetrack on its fix, 1 minute legs at ~180 kt (5.5 km), turns of 1.5 km radius
  if (A.hold) {
    const H = A.hold;
    const side = H.right ? 90 : -90;
    const a = wgs84Direct(H.lat, H.lon, ((H.crs + 180) * Math.PI) / 180, 5500);
    const b = wgs84Direct(a.lat, a.lon, ((H.crs + side) * Math.PI) / 180, 3000);
    const c = wgs84Direct(H.lat, H.lon, ((H.crs + side) * Math.PI) / 180, 3000);
    const pts = [H, a, b, c].map((q) => P(q.lat, q.lon));
    if (pts.every(Boolean)) {
      g.strokeStyle = col;
      g.lineWidth = 1.4 * k;
      g.beginPath();
      g.moveTo(pts[0]![0], pts[0]![1]);
      for (const p of [...pts.slice(1), pts[0]!]) g.lineTo(p![0], p![1]);
      g.stroke();
    }
  }
  // the fixes: a triangle (IAF, IF), a cross in a circle (FAF), a diamond the others; their names, their altitudes
  g.font = `600 ${10 * k}px Rajdhani, sans-serif`;
  g.textAlign = "left";
  for (const F of A.fixes) {
    const p = P(F.lat, F.lon);
    if (!p) continue;
    const [x, y] = p;
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = 1.5 * k;
    g.beginPath();
    const s = 5 * k;
    if (F.role === "IAF" || F.role === "IF") {
      g.moveTo(x, y - s);
      g.lineTo(x + s, y + s * 0.8);
      g.lineTo(x - s, y + s * 0.8);
      g.closePath();
    } else if (F.role === "FAF") {
      g.arc(x, y, s, 0, 2 * Math.PI);
      g.moveTo(x - s, y);
      g.lineTo(x + s, y);
      g.moveTo(x, y - s);
      g.lineTo(x, y + s);
    } else if (F.role !== "MAP") {
      g.moveTo(x, y - s);
      g.lineTo(x + s, y);
      g.lineTo(x, y + s);
      g.lineTo(x - s, y);
      g.closePath();
    }
    g.stroke();
    if (F.role === "MAP") continue;
    const alt = F.alt ? altText(F.alt, o.alt ?? ((m) => `${Math.round(m)} m`)) : "";
    g.fillText(`${F.role === "fix" ? "" : `${F.role} `}${F.name}`, x + 7 * k, y - 3 * k);
    if (alt) g.fillText(alt, x + 7 * k, y + 9 * k);
  }
  g.restore();
}

/** An altitude constraint said in the screen's units (« 914 m », « ≥914 m », « ≤1524 m », « 914–1524 m »). */
function altText([lo, hi]: [number | null, number | null], ft: (m: number) => string): string {
  if (lo !== null && hi !== null) return lo === hi ? ft(lo) : `${ft(lo)}–${ft(hi)}`;
  if (lo !== null) return `≥${ft(lo)}`;
  if (hi !== null) return `≤${ft(hi)}`;
  return "";
}

/** The hold of an approach's missed approach (its HM leg): its fix, its inbound course, the turn's side. */
export function holdOf(a: Approach): MapApproach["hold"] {
  const h = a.missed.find((l) => l.t === "HM" && l.lat !== undefined && l.lon !== undefined);
  if (!h) return null;
  return { lat: h.lat!, lon: h.lon!, crs: h.crs ?? a.crs, right: true };
}

/** An airfield's card's approaches (the tactical map's, the crew's — PLAN-APPROCHES AP4): each runway end, its approaches, the
 *  wind on it; the automatic choice and its reason; what is selected. */
export interface FieldCard {
  field: string;
  /** the automatic choice now (from where the craft is): its id, its reason said */
  auto: { id: string; why: string } | null;
  /** selected at this field: the approach (« auto »: its end or none), its transition */
  selected: { rwy: string; approach: string; via: string } | null;
  ends: {
    rwy: string;
    /** the wind on it [m/s]: ahead (> 0) and across; null: calm */
    head: number | null;
    cross: number | null;
    approaches: { id: string; text: string; vias: string[] }[];
  }[];
}

/** An approach's line on a card: « ILS 31R · 111.15 · 4.0° · CAT I · nav.dat 2013 », « Built 05 · 3.0° ». */
export function approachText(a: Approach): string {
  const parts = [a.kind === "VIS" ? `Built ${a.rwy}` : `${a.kind} ${a.rwy}`];
  if (a.loc) parts.push((a.loc.freq / 1000).toFixed(2));
  parts.push(`${a.angle.toFixed(1)}°`);
  if (a.loc?.cat) parts.push(`CAT ${a.loc.cat}`);
  if (a.source !== "built") parts.push(a.source === "cifp" ? `FAA ${a.cycle ?? ""}`.trim() : "nav.dat 2013");
  if (a.approx) parts.push("≈");
  return parts.join(" · ");
}
