// The spacecraft console's views (PLAN-VAISSEAUX K4): DOCKING (the corridor seen from aside and along its axis, the
// rates against their limits), Δv (the propellant's budget against the plan's burns), EECOM (the systems, the failures
// and their checklists), TIMELINE (the mission's clock, what comes in the hours ahead), RELATIVITY (the clocks apart:
// dτ/dt, γ, the time gone by on the Earth), GROUND (the body flown about, its ground track, the landing point). From the
// K1/K4 blocks.
import { checklistOf } from "../checklists";
import { C, D, dur, fmt, type Pen, type Rect } from "./kit";
import { bodyName } from "./orbit";
import type { Scene } from "./scene";
import { eventName, failureName, roleName } from "./spacestat";
import { L } from "../lang";

const none = (p: Pen, r: Rect, what: string, why: string) => {
  p.text(what, r.x + r.w / 2, r.y + r.h / 2, { col: C.dim, size: 13, align: "center" });
  p.text(why, r.x + r.w / 2, r.y + r.h / 2 + 18, { col: C.dim, size: 10, align: "center" });
};
/** a figures' column: name and value, right-aligned */
function column(p: Pen, x: number, y0: number, w: number, rows: [string, string, string?][]) {
  let y = y0;
  for (const [name, value, col] of rows) {
    p.text(name, x, y, { col: C.dim, size: 11 });
    p.text(value, x + w, y, { col: col ?? C.text, size: 13, weight: 700, align: "right" });
    y += 22;
  }
  return y;
}
/** the docking autopilot's phase (controller/docking.ts — its HUD's English words) in the console's language */
export function dockPhase(ph: string): string {
  if (!ph) return "";
  const W: Record<string, [string, string]> = {
    APPROACH: ["APPROCHE", "APPROACH"],
    FINAL: ["FINALE", "FINAL"],
    "HOLD 10 m": ["ATTENTE À 10 m", "HOLD 10 m"],
    "TO THE AXIS": ["VERS L'AXE", "TO THE AXIS"],
    "AROUND THE STATION": ["AUTOUR DE LA STATION", "AROUND THE STATION"],
  };
  const w = W[ph];
  if (w) return L(w[0], w[1]);
  if (ph.endsWith(" · HOLD")) return `${ph.slice(0, -7)} · ${L("ATTENTE", "HOLD")}`;
  if (ph.startsWith("AROUND THE ")) return L(`AUTOUR DE ${ph.slice(11)}`, ph);
  return ph;
}
const m = (x: number) => (Math.abs(x) >= 1000 ? `${fmt(x / 1000, 2)} km` : `${fmt(x, Math.abs(x) < 10 ? 2 : 1)} m`);

/** DOCKING: the corridor from aside (along the axis, across), the target's port head-on (the COAS's), the figures. */
export function drawDock(p: Pen, r: Rect, sc: Scene) {
  p.panel(r);
  const d = sc.snap?.dock;
  // (docked where there is no geometry — Gargantua's side —: said so, and to whom)
  if (d?.docked && !d.port) {
    p.text(L(`AMARRÉ · ${d.target.toUpperCase()}`, `DOCKED · ${d.target.toUpperCase()}`), r.x + r.w / 2, r.y + r.h / 2, {
      col: C.green,
      size: 18,
      align: "center",
      weight: 800,
    });
    return;
  }
  if (!d)
    return none(
      p,
      r,
      L("Aucun port à moins de 5 km", "No port within 5 km"),
      L("(la géométrie d’amarrage arrive près d’une station ou d’un vaisseau)", "(the docking geometry comes near a station or a craft)"),
    );
  const figW = Math.min(280, r.w * 0.34);
  const W = r.w - figW - 30;
  // aside: the axis horizontal (the port on the right), the corridor's cone (±(0.3 m + 10 %) of the distance)
  const side: Rect = { x: r.x + 12, y: r.y + 30, w: W, h: (r.h - 50) * 0.5 };
  p.text(L("DE CÔTÉ · L’AXE DU PORT", "FROM THE SIDE · THE PORT'S AXIS"), side.x, side.y - 8, { col: C.cyan, size: 10, weight: 700 });
  const span = Math.max(30, Math.abs(d.along) * 1.25);
  const kx = side.w / span;
  const px = side.x + side.w - 8;
  const cy = side.y + side.h / 2;
  const lat = Math.hypot(d.latX, d.latY) * Math.sign(d.latY || 1);
  const ky = Math.min(kx * 4, side.h / 2 / Math.max(5, Math.abs(lat) * 1.4, 0.3 + 0.1 * span));
  p.path([
    [px, cy - 0.3 * ky],
    [px - span * kx, cy - (0.3 + 0.1 * span) * ky],
    [px - span * kx, cy + (0.3 + 0.1 * span) * ky],
    [px, cy + 0.3 * ky],
  ]);
  p.fill("#4cf29a14");
  p.stroke("#4cf29a66", 1);
  p.seg(side.x, cy, px, cy, C.grid2, 1, [4, 4]);
  p.seg(px, cy - 18, px, cy + 18, C.white, 3);
  const sx = px - Math.max(0, d.along) * kx,
    sy = cy - lat * ky;
  const inCone = Math.abs(lat) <= 0.3 + 0.1 * Math.max(0, d.along);
  p.circle(sx, sy, 6);
  p.fill(inCone ? C.green : C.amber);
  p.text(`${m(d.along)}`, sx, sy - 12, { col: C.white, size: 11, align: "center", weight: 700 });
  // head-on: the target port's cross, the craft's ring where it is across
  const head: Rect = { x: r.x + 12, y: side.y + side.h + 26, w: W, h: r.h - side.h - 70 };
  p.text(L("DE FACE · LE RÉTICULE (COAS)", "HEAD-ON · THE SIGHT (COAS)"), head.x, head.y - 8, { col: C.cyan, size: 10, weight: 700 });
  const hc = [head.x + head.w / 2, head.y + head.h / 2] as const;
  const hr = Math.min(head.w, head.h) / 2 - 6;
  const lim = Math.max(1, 0.3 + 0.1 * Math.max(0, d.along));
  const k = hr / (lim * 2);
  p.circle(hc[0], hc[1], lim * k);
  p.stroke("#4cf29a88", 1.5, [5, 4]);
  p.seg(hc[0] - hr, hc[1], hc[0] + hr, hc[1], C.grid2, 1);
  p.seg(hc[0], hc[1] - hr, hc[0], hc[1] + hr, C.grid2, 1);
  const rx = hc[0] + Math.max(-hr, Math.min(hr, d.latX * k)),
    ry = hc[1] - Math.max(-hr, Math.min(hr, d.latY * k));
  const ok = Math.abs(d.angle) < 1 && Math.hypot(d.latX, d.latY) < lim;
  p.circle(rx, ry, 12);
  p.stroke(ok ? C.green : Math.abs(d.angle) < 5 ? C.amber : C.red, 2.5);
  p.seg(rx - 18, ry, rx + 18, ry, ok ? C.green : C.amber, 1.5);
  p.seg(rx, ry - 18, rx, ry + 18, ok ? C.green : C.amber, 1.5);
  // the figures
  const x0 = r.x + r.w - figW - 6;
  p.text(`${L("AMARRAGE", "DOCKING")} · ${d.target.toUpperCase()}`, x0, r.y + 18, { col: C.cyan, size: 11, weight: 700 });
  const closingOk = d.closing <= Math.max(0.1, Math.min(0.5, 0.02 * Math.max(d.along, 0) + 0.05));
  column(p, x0, r.y + 42, figW - 8, [
    [L("Port visé", "Port"), d.port],
    ["Distance", m(d.range)],
    [L("Sur l’axe · travers", "Along · across"), `${m(d.along)} · ${m(Math.hypot(d.latX, d.latY))}`, inCone ? C.green : C.amber],
    [L("Rapprochement", "Closing"), `${fmt(d.closing, 2)} m/s`, closingOk ? C.text : C.red],
    [L("Dérive latérale", "Lateral drift"), `${fmt(d.latRate, 3)} m/s`, Math.abs(d.latRate) < 0.05 ? C.text : C.amber],
    [L("Axes écartés", "Axes apart"), `${fmt(d.angle, 1)}°`, d.angle < 1 ? C.green : d.angle < 5 ? C.amber : C.red],
    [L("Rotation relative", "Relative spin"), `${fmt(d.spin, 2)}°/s`, d.spin < 3 ? C.text : C.red],
    [
      L("État", "State"),
      d.docked ? L("AMARRÉ", "DOCKED") : dockPhase(d.phase) || L("approche manuelle", "manual approach"),
      d.docked ? C.green : C.amber,
    ],
  ]);
}

/** Δv: the propellant's Δv left against the plan's burns one after the other; the margin; the tank. */
export function drawBudget(p: Pen, r: Rect, sc: Scene) {
  p.panel(r);
  const s = sc.snap;
  const B = s?.budget;
  const nodes = s?.nodes ?? [];
  if (!B)
    return none(
      p,
      r,
      L("Budget non reçu", "No budget received"),
      L("(un pilote plus ancien, ou un appareil sans ergols comptés)", "(an older pilot, or a craft whose propellant is not counted)"),
    );
  const x = r.x + 16,
    w = r.w - 32;
  p.text(L("BUDGET Δv", "Δv BUDGET"), x, r.y + 20, { col: C.cyan, size: 11, weight: 700 });
  const plan = nodes.reduce((a, n) => a + Math.hypot(...n.dv), 0);
  const left = B.dv;
  const scale = Math.max(left ?? 0, plan, 1) * 1.1;
  // the bar: the plan's burns in turn (magenta shades), the rest of the propellant's (green), a shortfall red
  const y = r.y + 46,
    h = 26;
  p.round(x, y, w, h, 5);
  p.fill("#10202a");
  let at = 0;
  nodes.forEach((n, i) => {
    const dv = Math.hypot(...n.dv);
    const bx = x + (at / scale) * w,
      bw = (dv / scale) * w;
    p.round(bx, y, Math.max(2, bw - 1), h, 3);
    p.fill(i % 2 ? "#c43fae" : C.magenta);
    if (bw > 40) p.text(`${fmt(dv)}`, bx + bw / 2, y + 17, { col: C.white, size: 10, align: "center", weight: 700 });
    at += dv;
  });
  if (left !== null) {
    const lx = x + (left / scale) * w;
    // (the margin: what the propellant holds beyond the plan)
    if (left > at) {
      p.round(x + (at / scale) * w, y, lx - x - (at / scale) * w, h, 3);
      p.fill("#4cf29a40");
    }
    p.seg(lx, y - 6, lx, y + h + 6, plan > left ? C.red : C.green, 2);
    p.text(`${L("Δv restant", "Δv left")} ${fmt(left)} m/s`, lx, y + h + 20, {
      col: plan > left ? C.red : C.green,
      size: 11,
      align: "center",
      weight: 700,
    });
  }
  const yy = column(p, x, y + h + 52, Math.min(w, 420), [
    [L("Δv restant (ergols)", "Δv left (propellant)"), left === null ? L("non compté", "not counted") : `${fmt(left)} m/s`],
    [L("Δv du plan", "The plan's Δv"), `${fmt(plan)} m/s`, C.magenta],
    [L("Marge", "Margin"), left === null ? "—" : `${fmt(left - plan)} m/s`, left !== null && left < plan ? C.red : C.green],
    [L("Ergols", "Propellant"), B.prop === null ? "—" : `${fmt(B.prop * 100)} %`, B.prop !== null && B.prop < 0.1 ? C.red : C.text],
    [
      L("Poussée en cours", "Burn under way"),
      s?.burn ? `${fmt(s.burn.left)} m/s ${L("restants", "left")}` : "—",
      s?.burn ? C.magenta : C.dim,
    ],
  ]);
  if (nodes.length) {
    p.text(L("LES POUSSÉES DU PLAN", "THE PLAN'S BURNS"), x, yy + 10, { col: C.cyan, size: 10, weight: 700 });
    column(
      p,
      x,
      yy + 32,
      Math.min(w, 420),
      nodes
        .slice(0, 8)
        .map((n, i) => [
          `${i + 1}. ${roleName(n.role)} · ${L("dans", "in")} ${dur(n.in)}`,
          `${fmt(n.dv[0], 1)} · ${fmt(n.dv[1], 1)} · ${fmt(n.dv[2], 1)} m/s`,
          C.magenta,
        ]),
    );
  }
}

/** EECOM: power, oxygen, scrubbers; the failures and their checklists (the pilot's — K6 ticks them from here). */
export function drawEecom(p: Pen, r: Rect, sc: Scene) {
  p.panel(r);
  const Y = sc.snap?.sysx;
  if (!Y)
    return none(
      p,
      r,
      L("Systèmes non reçus", "No systems received"),
      L("(un appareil sans systèmes simulés, ou un pilote plus ancien)", "(a craft without simulated systems, or an older pilot)"),
    );
  const x = r.x + 16,
    w = Math.min(r.w * 0.45, 380);
  p.text(L("EECOM · ÉNERGIE ET ENVIRONNEMENT", "EECOM · POWER AND ENVIRONMENT"), x, r.y + 20, { col: C.cyan, size: 11, weight: 700 });
  const gauge = (y: number, name: string, share: number, value: string) => {
    p.text(name, x, y, { col: C.dim, size: 11 });
    p.text(value, x + w, y, { col: C.text, size: 12, weight: 700, align: "right" });
    p.round(x, y + 6, w, 8, 4);
    p.fill("#14262f");
    const s = Math.max(0, Math.min(1, share));
    p.round(x, y + 6, Math.max(2, w * s), 8, 4);
    p.fill(s < 0.1 ? C.red : s < 0.25 ? C.amber : C.green);
    return y + 36;
  };
  let y = r.y + 46;
  y = gauge(y, L("Batterie", "Battery"), Y.battery, `${fmt(Y.battery * 100)} % ${L("de", "of")} ${fmt(Y.kwh)} kWh`);
  y = gauge(y, L("Oxygène", "Oxygen"), Math.min(1, Y.o2h / (24 * 14)), `${dur(Y.o2h * 3600)} ${L("pour", "for")} ${Y.crew}`);
  y = gauge(y, L("Épurateurs de CO₂", "CO₂ scrubbers"), Math.min(1, Y.scrub / 14), `${fmt(Y.scrub, 1)} ${L("j", "d")}`);
  column(p, x, y + 4, w, [
    [L("Bilan électrique", "Power balance"), `${Y.balance >= 0 ? "+" : ""}${fmt(Y.balance, 1)} kW`, Y.balance < 0 ? C.amber : C.green],
    [
      L("Autonomie batterie", "Battery endurance"),
      Y.balance < 0 ? dur((Y.battery * Y.kwh * 3600) / -Y.balance) : L("en charge", "charging"),
      Y.balance < 0 ? C.amber : C.green,
    ],
    [L("Équipage", "Crew"), String(Y.crew)],
  ]);
  // the failures: each its checklist
  const fx = r.x + r.w * 0.52,
    fw = r.w * 0.46;
  p.text(L("PANNES", "FAILURES"), fx, r.y + 20, { col: C.cyan, size: 11, weight: 700 });
  if (!Y.failures.length) {
    p.text(L("Aucune — systèmes nominaux.", "None — systems nominal."), fx, r.y + 46, { col: C.green, size: 12 });
    return;
  }
  let fy = r.y + 46;
  for (const f of Y.failures) {
    const cl = checklistOf(f.kind);
    const h = 34 + (cl?.steps.length ?? 0) * 18 + 22;
    p.round(fx, fy - 14, fw, h, 6);
    p.fill(f.fixing ? "#2a1e08" : "#2a0c0c");
    p.stroke(f.fixing ? C.amber : C.red, 1);
    p.text(cl?.title ?? failureName(f.kind), fx + 10, fy + 4, { col: f.fixing ? C.amber : C.red, size: 12, weight: 700 });
    let sy = fy + 26;
    (cl?.steps ?? []).forEach((st, i) => {
      p.text(`${i + 1}. ${st}`, fx + 14, sy, { col: C.text, size: 11 });
      sy += 18;
    });
    p.text(`→ ${cl?.action ?? ""}${f.fixing ? ` · ${L("en cours", "under way")}` : ""}`, fx + 14, sy, {
      col: f.fixing ? C.amber : C.white,
      size: 11,
      weight: 700,
    });
    fy += h + 10;
    if (fy > r.y + r.h - 40) break;
  }
}

/** TIMELINE: the mission's clock, the events ahead on a time axis (the plan's burns, the apsides, a sphere left, the
 *  closest approach), their countdowns. */
export function drawTimeline(p: Pen, r: Rect, sc: Scene) {
  p.panel(r);
  const s = sc.snap;
  if (!s) return;
  const met = s.time?.met;
  const clock = (t: number) => {
    const d = Math.floor(t / 86400),
      h = Math.floor((t % 86400) / 3600),
      mi = Math.floor((t % 3600) / 60),
      se = Math.floor(t % 60);
    return `${d ? `${d} ${L("j", "d")} ` : ""}${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(se).padStart(2, "0")}`;
  };
  p.text(L("TEMPS DE MISSION", "MISSION TIME"), r.x + 16, r.y + 22, { col: C.cyan, size: 11, weight: 700 });
  p.text(met === undefined ? "—" : `MET ${clock(met)}`, r.x + 16, r.y + 56, { col: C.white, size: 28, weight: 700 });
  const ev: { in: number; name: string; col: string }[] = [];
  for (const n of s.nodes ?? [])
    ev.push({ in: n.in, name: `${L("Poussée", "Burn")} · ${roleName(n.role)} · ${fmt(Math.hypot(...n.dv))} m/s`, col: C.magenta });
  if (s.orbit?.tPe != null) ev.push({ in: s.orbit.tPe, name: `${L("Périapside", "Periapsis")} · ${fmt(s.orbit.pe)} km`, col: C.green });
  if (s.orbit?.tAp != null && s.orbit.ecc < 1)
    ev.push({ in: s.orbit.tAp, name: `${L("Apoapside", "Apoapsis")} · ${fmt(s.orbit.ap)} km`, col: C.green });
  if (s.next) {
    ev.push({
      in: s.next.in,
      name: eventName(s.next),
      col: s.next.kind === "impact" ? C.red : C.amber,
    });
  }
  if (s.target && Number.isFinite(s.target.caIn))
    ev.push({
      in: s.target.caIn,
      name: `${L("Approche minimale de", "Closest approach of")} ${s.target.name} · ${m(s.target.ca)}`,
      col: C.amber,
    });
  const list = ev.filter((e) => e.in >= 0).sort((a, b) => a.in - b.in);
  // the axis: the next 24 h, square-root spaced (the next minutes wide)
  const ax = { x: r.x + 20, y: r.y + 100, w: r.w - 40 };
  const horizon = Math.max(3600, Math.min(86400 * 7, (list.at(-1)?.in ?? 3600) * 1.1));
  const X = (t: number) => ax.x + Math.sqrt(Math.max(0, t) / horizon) * ax.w;
  p.seg(ax.x, ax.y, ax.x + ax.w, ax.y, C.grid2, 2);
  for (const t of [60, 600, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 3 * 86400].filter((t) => t <= horizon)) {
    const x = X(t);
    p.seg(x, ax.y - 4, x, ax.y + 4, C.dim, 1);
    p.text(dur(t), x, ax.y + 16, { col: C.dim, size: 9, align: "center" });
  }
  p.text(L("maintenant", "now"), ax.x, ax.y - 10, { col: C.dim, size: 9 });
  list.forEach((e, i) => {
    const x = X(e.in);
    p.circle(x, ax.y, 5);
    p.fill(e.col);
    if (i < 12) p.seg(x, ax.y + 6, x, ax.y + 26 + (i % 3) * 12, e.col, 1, [2, 3]);
  });
  column(
    p,
    r.x + 16,
    ax.y + 74,
    Math.min(r.w - 32, 560),
    list.slice(0, 12).map((e) => [e.name, `${L("dans", "in")} ${dur(e.in)}`, e.col]),
  );
  if (!list.length)
    p.text(L("Rien de prévu dans les heures qui viennent.", "Nothing planned in the hours ahead."), r.x + 16, ax.y + 74, {
      col: C.dim,
      size: 12,
    });
}

/** RELATIVITY: the craft's clock against the room's (the far-away clock, the Earth's): dτ/dt, γ, the hours apart. */
export function drawRelativity(p: Pen, r: Rect, sc: Scene) {
  p.panel(r);
  const s = sc.snap;
  const T = s?.time;
  if (!T) return none(p, r, L("Horloges non reçues", "No clocks received"), L("(un pilote plus ancien)", "(an older pilot)"));
  const v = s?.metrics.speed ?? (s?.state ? Math.hypot(...s.state.v) * 1000 : 0);
  const beta = Math.min(0.999999, v / 299_792_458);
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const x = r.x + 16;
  p.text(L("RELATIVITÉ · LES DEUX HORLOGES", "RELATIVITY · THE TWO CLOCKS"), x, r.y + 22, { col: C.cyan, size: 11, weight: 700 });
  // the gauge: dτ/dt from 0 (frozen) to 1 (the Earth's pace)
  const gw = Math.min(r.w - 32, 640),
    gy = r.y + 56;
  p.round(x, gy, gw, 14, 7);
  p.fill("#14262f");
  p.round(x, gy, Math.max(3, gw * Math.max(0, Math.min(1, T.dtau))), 14, 7);
  p.fill(T.dtau < 0.5 ? C.red : T.dtau < 0.99 ? C.amber : C.green);
  p.text(`dτ/dt = ${fmt(T.dtau, 6)}`, x, gy + 36, { col: C.white, size: 18, weight: 700 });
  const hourHere = T.dtau > 1e-9 ? 1 / T.dtau : Number.POSITIVE_INFINITY;
  const rows: [string, string, string?][] = [
    [
      L("Une heure à bord =", "An hour aboard ="),
      Number.isFinite(hourHere) ? `${dur(hourHere * 3600)} ${L("sur Terre", "on Earth")}` : `∞ ${L("sur Terre", "on Earth")}`,
      T.dtau < 0.99 ? C.amber : C.text,
    ],
    [L("Vitesse · β", "Speed · β"), `${fmt(v / 1000, 3)} km/s · ${beta < 1e-3 ? beta.toExponential(2) : fmt(beta, 4)}`],
    [L("Facteur de Lorentz γ", "Lorentz factor γ"), gamma < 1.0001 ? `1 + ${((gamma - 1) * 1e9).toFixed(2)}×10⁻⁹` : fmt(gamma, 4)],
    [L("Horloge de la salle (Terre)", "The room's clock (Earth)"), dur(T.room)],
    [L("Temps propre du vaisseau (ce vol)", "The craft's proper time (this flight)"), dur(T.tau)],
    // (since the flight began: the proper time starts again at each flight — room − tau would be the scene's age)
    ...(T.lag !== undefined && T.since !== undefined
      ? ([
          [L("Depuis le départ (Terre)", "Since the start (Earth)"), dur(T.since)],
          [
            L("Temps écoulé en plus sur Terre", "Extra time gone by on Earth"),
            T.lag < 1 ? `${fmt(T.lag * 1000, 1)} ms` : dur(T.lag),
            T.lag > 60 ? C.amber : C.text,
          ],
        ] as [string, string, string?][])
      : []),
    [L("Facteur de temps", "Time warp"), `×${fmt(T.warp, T.warp < 10 ? 1 : 0)}`],
  ];
  const K = s?.kerr;
  if (K) rows.push(["Gargantua · r · E · L", `${fmt(K.r, 2)} M · ${fmt(K.E, 4)} · ${fmt(K.L, 3)}`, C.amber]);
  if (s?.link)
    rows.push([
      L("Liaison Terre", "Earth link"),
      s.link.cut
        ? L("coupée — messages enregistrés", "cut — messages recorded")
        : `${L("lumière", "light")} ${dur(s.link.light)} ${L("aller", "one way")}`,
      s.link.cut ? C.red : C.text,
    ]);
  column(p, x, gy + 70, Math.min(r.w - 32, 560), rows);
}

/** GROUND: the body flown about, orthographic about the craft's point — its grid, its night, the ground track ahead,
 *  the craft, the landing point. Its projection back: a point of the view to its place on the body (null: off it). */
export function drawGround(p: Pen, r: Rect, sc: Scene): ((x: number, y: number) => { lat: number; lon: number } | null) | null {
  p.panel(r);
  const s = sc.snap;
  const g = s?.geo;
  if (!s || !g) {
    // (Gargantua's side: landed on a world there, or in its sky — said so, not "far from any solid body")
    const st = s?.craft?.status,
      at = s?.craft?.where;
    if (st === "landed" && at)
      none(p, r, L(`Posé sur ${bodyName(at)}`, `Landed on ${bodyName(at)}`), L("(pas de carte de ce monde)", "(no map of this world)"));
    else if (at && at !== "gargantua" && s?.orbit)
      none(p, r, L(`Autour de ${bodyName(at)}`, `About ${bodyName(at)}`), L("(pas de carte de ce monde)", "(no map of this world)"));
    else
      none(
        p,
        r,
        L("Position au sol non reçue", "No ground position received"),
        L("(loin de tout corps solide)", "(far from any solid body)"),
      );
    return null;
  }
  const lat0 = g.lat * D,
    lon0 = g.lon * D;
  const R = Math.min(r.w, r.h) * 0.42;
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2 + 6;
  const P = (lat: number, lon: number): [number, number, boolean] => {
    const la = lat * D,
      lo = lon * D - lon0;
    const x = Math.cos(la) * Math.sin(lo);
    const y = Math.cos(lat0) * Math.sin(la) - Math.sin(lat0) * Math.cos(la) * Math.cos(lo);
    const z = Math.sin(lat0) * Math.sin(la) + Math.cos(lat0) * Math.cos(la) * Math.cos(lo);
    return [cx + x * R, cy - y * R, z >= 0];
  };
  p.circle(cx, cy, R);
  p.fill("#0d2230");
  p.stroke(C.cyan, 1);
  // the night: the half away from the Sun's point
  const sun = s.sun;
  if (sun) {
    const pts: [number, number][] = [];
    // (the terminator: the great circle 90° from the Sun's point — cos a·E1 + sin a·E2 about it)
    const sl = sun.lat * D,
      so = sun.lon * D;
    const S = [Math.cos(sl) * Math.cos(so), Math.cos(sl) * Math.sin(so), Math.sin(sl)];
    const E1 = [-Math.sin(so), Math.cos(so), 0];
    const E2 = [S[1]! * E1[2]! - S[2]! * E1[1]!, S[2]! * E1[0]! - S[0]! * E1[2]!, S[0]! * E1[1]! - S[1]! * E1[0]!];
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * 2 * Math.PI;
      const v = [0, 1, 2].map((i) => Math.cos(a) * E1[i]! + Math.sin(a) * E2[i]!);
      const q = P(Math.asin(v[2]!) / D, Math.atan2(v[1]!, v[0]!) / D);
      if (q[2]) pts.push([q[0], q[1]]);
    }
    if (pts.length > 2) {
      p.path(pts);
      p.stroke("#ffb43c66", 1.5, [4, 4]);
    }
  }
  // the grid every 30°
  for (let la = -60; la <= 60; la += 30) {
    const line = Array.from({ length: 73 }, (_, k) => P(la, -180 + k * 5)).map((q) => (q[2] ? ([q[0], q[1]] as [number, number]) : null));
    p.path(line);
    p.stroke(C.grid2, 1);
  }
  for (let lo = -180; lo < 180; lo += 30) {
    const line = Array.from({ length: 37 }, (_, k) => P(-90 + k * 5, lo)).map((q) => (q[2] ? ([q[0], q[1]] as [number, number]) : null));
    p.path(line);
    p.stroke(C.grid2, 1);
  }
  // the ground track ahead (its points' times), the craft
  const track = s.ahead.map((q) => P(q.lat, q.lon)).map((q) => (q[2] ? ([q[0], q[1]] as [number, number]) : null));
  p.path(track, R);
  p.glow(C.cyan, 1.6);
  const site = s.land;
  if (site && site.body === s.body) {
    const q = P(site.lat, site.lon);
    if (q[2]) {
      p.star(q[0], q[1], 8, site.moved ? C.amber : C.green, true);
      p.text(`${site.name || L("point d’atterrissage", "landing point")}${site.moved ? " (LPD)" : ""}`, q[0] + 12, q[1] + 4, {
        col: site.moved ? C.amber : C.green,
        size: 11,
        weight: 700,
        bg: "#050a0ec0",
      });
    }
  }
  p.circle(cx, cy, 6);
  p.fill(C.white);
  p.stroke("#03070a", 2);
  p.text(`${bodyName(s.body).toUpperCase()} · ${fmt(g.lat, 3)}° ${fmt(g.lon, 3)}°`, r.x + 14, r.y + 20, {
    col: C.cyan,
    size: 11,
    weight: 700,
  });
  if (s.metrics.alt !== undefined) p.text(`altitude ${fmt(s.metrics.alt / 1000, 1)} km`, r.x + 14, r.y + 38, { col: C.text, size: 11 });
  // (a powered landing to a point: the place touched is the new one)
  if (s.desc?.auto === "land")
    p.text(L("Toucher pour désigner le point d’atterrissage", "Tap to designate the landing point"), r.x + 14, r.y + r.h - 12, {
      col: C.amber,
      size: 11,
    });
  return (x, y) => {
    const X = (x - cx) / R,
      Yv = (cy - y) / R;
    const rho = Math.hypot(X, Yv);
    if (rho > 1) return null;
    const c = Math.asin(rho);
    const lat = rho < 1e-9 ? lat0 : Math.asin(Math.cos(c) * Math.sin(lat0) + (Yv * Math.sin(c) * Math.cos(lat0)) / rho);
    const lon = lon0 + Math.atan2(X * Math.sin(c), rho * Math.cos(c) * Math.cos(lat0) - Yv * Math.sin(c) * Math.sin(lat0));
    return { lat: lat / D, lon: ((((lon / D + 180) % 360) + 360) % 360) - 180 };
  };
}
