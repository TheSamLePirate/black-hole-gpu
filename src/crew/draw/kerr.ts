// The ORBIT view on Gargantua's side (AUDIT-CREW priority 4): no Kepler state there. Far from its worlds, a Kerr orbit —
// the hole from above (its horizon, its ergosphere, the photon orbit, the ISCO for its spin), its worlds on their
// circles, the craft and its free fall (the `hole` block, [M]), and its figures r · E · L (bound when E < 1); about a
// world (Miller, Mann…), its orbit's figures (the `orbit` block: the apsides over its radius) drawn as an ellipse.
// Landed: said so.
import { kerrRadii } from "../sys3d/scene";
import { L } from "../lang";
import { C, dur, fmt, type Pen, type Rect, TAU } from "./kit";
import { bodyName } from "./orbit";
import type { Scene } from "./scene";

/** the Kerr state in words: bound, unbound, plunging (its E and the path's fate) */
export function kerrState(E: number, fate: string, status?: string): { text: string; col: string } {
  if (status === "plunge" || fate === "horizon") return { text: L("CHUTE DANS L’HORIZON", "PLUNGING"), col: C.red };
  return E < 1 ? { text: L("ORBITE LIÉE", "BOUND ORBIT"), col: C.green } : { text: L("NON LIÉE", "UNBOUND"), col: C.amber };
}

/** Whether this view replaces the Kepler one: Gargantua's side, nothing Keplerian about our bodies sent. */
export const onHoleSide = (sc: Scene) => !sc.snap?.state && !!(sc.snap?.kerr || sc.snap?.hole || sc.snap?.link?.cut);

export function drawKerrOrbit(p: Pen, r: Rect, sc: Scene, compact = false) {
  const s = sc.snap!;
  const where = s.craft?.where ?? "";
  const status = s.craft?.status ?? "";
  // about a world of Gargantua's (its own orbit's figures), or landed on it
  if (where && where !== "gargantua" && where !== "wormhole") {
    p.panel(r, compact ? L("ORBITE", "ORBIT") : undefined);
    const name = bodyName(where);
    if (status === "landed" || !s.orbit) {
      p.text(
        status === "landed" ? L(`POSÉ SUR ${name.toUpperCase()}`, `LANDED ON ${name.toUpperCase()}`) : name,
        r.x + r.w / 2,
        r.y + r.h / 2,
        { col: C.green, size: 18, align: "center", weight: 800 },
      );
      return;
    }
    const o = s.orbit;
    const Rb = o.radius && o.radius > 0 ? o.radius : 1;
    const rp = Rb + o.pe,
      ra = o.ap > 0 && o.ecc < 1 ? Rb + o.ap : rp * 3;
    const a = (rp + ra) / 2,
      e = (ra - rp) / (ra + rp),
      b = a * Math.sqrt(1 - e * e);
    const w = compact ? r.w : r.w * 0.6;
    const k = Math.min((w * 0.42) / a, (r.h * 0.4) / b);
    const cx = r.x + w / 2,
      cy = r.y + r.h / 2;
    p.circle(cx + (a - rp) * k, cy, Rb * k);
    p.fill("#123a4a");
    p.c.beginPath();
    p.c.ellipse(cx, cy, a * k, b * k, 0, 0, TAU);
    p.glow(C.cyan, 1.6, 0.2);
    p.text(`Pe ${fmt(o.pe)} km`, cx - a * k, cy - 8, { col: C.green, size: 11, align: "center", weight: 700 });
    if (o.ecc < 1) p.text(`Ap ${fmt(o.ap)} km`, cx + a * k, cy - 8, { col: C.amber, size: 11, align: "center", weight: 700 });
    if (compact) return;
    const x0 = r.x + w + 10;
    let y = r.y + 40;
    const row = (k2: string, v: string, col: string = C.text) => {
      p.text(k2, x0, y, { col: C.dim, size: 11 });
      p.text(v, r.x + r.w - 14, y, { col, size: 13, weight: 700, align: "right" });
      y += 22;
    };
    p.text(`${L("ORBITE", "ORBIT")} · ${name.toUpperCase()} · ${L("côté Gargantua", "Gargantua's side")}`, x0, r.y + 18, {
      col: C.cyan,
      size: 11,
      weight: 700,
    });
    row(L("Périapside", "Periapsis"), `${fmt(o.pe)} km`, o.pe < 0 ? C.red : C.text);
    row(L("Apoapside", "Apoapsis"), o.ecc < 1 ? `${fmt(o.ap)} km` : L("libre", "escape"));
    row(L("Excentricité", "Eccentricity"), fmt(o.ecc, 4));
    row(L("Période", "Period"), dur(o.period));
    if (s.time) row("dτ/dt", fmt(s.time.dtau, 6), s.time.dtau < 0.5 ? C.red : s.time.dtau < 0.99 ? C.amber : C.text);
    return;
  }
  // Gargantua itself: the hole from above, its radii, its worlds, the craft's fall
  p.panel(r, compact ? L("ORBITE DE KERR", "KERR ORBIT") : undefined);
  const H = s.hole,
    K = s.kerr;
  const spin = H?.spin ?? 0.999;
  const R = kerrRadii(Math.abs(spin));
  const craftR = H?.craft ? Math.hypot(H.craft[0], H.craft[1], H.craft[2]) : (K?.r ?? 10);
  const pathR = (H?.path ?? []).reduce((m, q) => Math.max(m, Math.hypot(q[0], q[1])), 0);
  const span = Math.max(craftR * 1.25, pathR * 1.1, R.isco * 2, 6);
  const w = compact ? r.w : r.w * 0.6;
  const cx = r.x + w / 2,
    cy = r.y + r.h / 2;
  const k = (Math.min(w, r.h) * 0.45) / span;
  const ring = (rr: number, col: string, dash: number[] = []) => {
    p.circle(cx, cy, rr * k);
    p.stroke(col, 1.3, dash);
  };
  ring(R.ergo, "#9a73ff99", [4, 4]);
  ring(R.photon, "#ffbf4d99", [2, 3]);
  ring(R.isco, "#ff5c4d99", [6, 4]);
  p.circle(cx, cy, Math.max(2, R.rh * k));
  p.fill("#000");
  p.stroke("#ffbf4d", 1.5);
  // its worlds on their circles (logarithmic beyond the view: their marks at the edge)
  for (const b of H?.bodies ?? []) {
    const d = Math.hypot(b.r[0], b.r[1]);
    if (!(d > 0)) continue;
    const f = d > span ? span / d : 1;
    const x = cx + b.r[0] * f * k,
      y = cy - b.r[1] * f * k;
    p.circle(x, y, 4);
    p.fill(f < 1 ? C.dim : C.cyan);
    p.text(bodyName(b.id), x + 7, y + 4, { col: f < 1 ? C.dim : C.text, size: 10 });
  }
  // the craft's free fall and the craft
  const pts = (H?.path ?? []).map((q) => [cx + q[0] * k, cy - q[1] * k] as [number, number]);
  if (pts.length > 1) {
    p.path(pts);
    p.glow(C.cyan, 1.6);
  }
  if (H?.craft) {
    p.circle(cx + H.craft[0] * k, cy - H.craft[1] * k, 6);
    p.fill(C.white);
  }
  if (compact) return;
  const x0 = r.x + w + 10;
  let y = r.y + 40;
  const row = (k2: string, v: string, col: string = C.text) => {
    p.text(k2, x0, y, { col: C.dim, size: 11 });
    p.text(v, r.x + r.w - 14, y, { col, size: 13, weight: 700, align: "right" });
    y += 22;
  };
  p.text(L("GARGANTUA · ORBITE DE KERR", "GARGANTUA · KERR ORBIT"), x0, r.y + 18, { col: C.cyan, size: 11, weight: 700 });
  if (K) {
    const st = kerrState(K.E, H?.fate ?? "", status);
    row(L("État", "State"), st.text, st.col);
    row(L("Rayon r", "Radius r"), `${fmt(K.r, 2)} M`);
    row(L("Énergie E", "Energy E"), fmt(K.E, 4), K.E < 1 ? C.green : C.amber);
    row(L("Moment L", "Momentum L"), fmt(K.L, 3));
  } else row(L("État", "State"), L("figures de Kerr non reçues", "no Kerr figures received"), C.dim);
  row(L("Spin a", "Spin a"), fmt(spin, 3));
  row("ISCO", `${fmt(R.isco, 2)} M`);
  row(L("Orbite des photons", "Photon orbit"), `${fmt(R.photon, 2)} M`);
  if (s.time) row("dτ/dt", fmt(s.time.dtau, 6), s.time.dtau < 0.5 ? C.red : s.time.dtau < 0.99 ? C.amber : C.text);
}
