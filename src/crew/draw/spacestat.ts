// The spacecraft's status panel (PLAN-VAISSEAUX K2): the dashboard's flight computer column — the propellant and its
// Δv, the burn flown, the plan's burns, the next event, the target; the systems (X3); the clocks and the link. And the
// F-35's mission panel (its objective, its weapons, its alerts) for the tactical console.
import { bodyName } from "./orbit";
import { C, dur, fmt, type Pen, type Rect } from "./kit";
import type { Scene } from "./scene";
import { aarColour, aarPhaseName } from "./aar";
import { L } from "../lang";

const FAILURE_FR: Record<string, string> = {
  engine: "MOTEUR PRINCIPAL ÉTEINT",
  rcsStuck: "RCS BLOQUÉ OUVERT",
  gyro: "DÉRIVE CENTRALE",
  bus: "COURT-CIRCUIT BUS",
  o2Leak: "FUITE D’OXYGÈNE",
  scrubber: "ÉPURATEUR EN PANNE",
};
export const failureName = (k: string) => FAILURE_FR[k] ?? k.toUpperCase();
const ROLE_FR: Record<string, string> = {
  depart: "départ",
  circ: "circularisation",
  mcc: "correction",
  capture: "capture",
  mccReturn: "correction retour",
  captureHome: "capture au retour",
  arrive: "arrivée",
};
/** a burn's part in a mission, in French ("nœud" when it has none) */
export const roleName = (r: string) => (r ? (ROLE_FR[r] ?? r) : "nœud");
const EVENT_FR: Record<string, string> = {
  impact: "Impact",
  exit: "Sortie de sphère",
  enter: "Entrée en sphère",
  mouth: "Bouche du trou de ver",
};
/** the next event on the free-fall path, in French: its kind, its body by the console's name (the pilot's word for it
 *  from an older pilot sending no body) */
export function eventName(n: { kind: string; name: string; body?: string }): string {
  const kind = EVENT_FR[n.kind];
  const where = n.kind === "mouth" ? "" : n.body ? bodyName(n.body) : n.name;
  return kind ? `${kind}${where ? ` · ${where}` : ""}` : where || n.kind;
}

/** a bar: its share filled, toned by thresholds */
function bar(p: Pen, x: number, y: number, w: number, share: number | null, warn = 0.25, alarm = 0.1) {
  p.round(x, y, w, 6, 3);
  p.fill("#14262f");
  if (share === null) return;
  const s = Math.max(0, Math.min(1, share));
  p.round(x, y, Math.max(2, w * s), 6, 3);
  p.fill(s < alarm ? C.red : s < warn ? C.amber : C.green);
}

export function drawSpaceStatus(p: Pen, r: Rect, sc: Scene) {
  p.panel(r, "ORDINATEUR DE VOL");
  const s = sc.snap;
  const x = r.x + 12,
    w = r.w - 24;
  let y = r.y + 40;
  const line = (name: string, value: string, col: string = C.text) => {
    if (y > r.y + r.h - 8) return;
    p.text(name, x, y, { col: C.dim, size: 11 });
    p.text(value, x + w, y, { col, size: 12, weight: 700, align: "right" });
    y += 20;
  };
  const head = (t: string) => {
    if (y > r.y + r.h - 20) return;
    y += 6;
    p.text(t, x, y, { col: C.cyan, size: 10, weight: 700 });
    y += 16;
  };
  if (!s) return;
  const B = s.budget;
  line("Δv restant", B?.dv == null ? "non compté" : `${fmt(B.dv)} m/s`, B?.dv != null && B.dv < 200 ? C.amber : C.text);
  if (B?.prop != null) {
    p.text("Ergols", x, y, { col: C.dim, size: 11 });
    bar(p, x + 60, y - 7, w - 110, B.prop);
    p.text(`${fmt(B.prop * 100)} %`, x + w, y, { col: C.text, size: 12, weight: 700, align: "right" });
    y += 20;
  }
  if (s.burn) line("Poussée en cours", `${fmt(s.burn.left)} m/s restants`, C.magenta);
  const nodes = s.nodes ?? [];
  if (nodes.length) {
    head(`PLAN · ${nodes.length} POUSSÉE${nodes.length > 1 ? "S" : ""}`);
    for (const n of nodes.slice(0, 4)) line(`${roleName(n.role)} · dans ${dur(n.in)}`, `${fmt(Math.hypot(...n.dv), 1)} m/s`, C.magenta);
  }
  if (s.next) line("Prochain événement", `${eventName(s.next)} · ${dur(s.next.in)}`, C.amber);
  const T = s.target;
  if (T) {
    head(`CIBLE · ${T.name.toUpperCase()}`);
    line("Distance", T.dist >= 10_000 ? `${fmt(T.dist / 1000, 1)} km` : `${fmt(T.dist)} m`);
    line("Rapprochement", `${fmt(T.rate, 2)} m/s`, T.rate < 0 ? C.dim : C.text);
    if (Number.isFinite(T.caIn)) line("Approche minimale", `${fmt(T.ca / 1000, 2)} km · ${dur(T.caIn)}`);
  }
  const Y = s.sysx;
  if (Y) {
    head("SYSTÈMES");
    p.text("Batterie", x, y, { col: C.dim, size: 11 });
    bar(p, x + 60, y - 7, w - 110, Y.battery);
    p.text(`${fmt(Y.battery * 100)} %`, x + w, y, { col: C.text, size: 12, weight: 700, align: "right" });
    y += 20;
    line("Bilan électrique", `${Y.balance >= 0 ? "+" : ""}${fmt(Y.balance, 1)} kW`, Y.balance < 0 ? C.amber : C.green);
    line("Oxygène", `${dur(Y.o2h * 3600)} pour ${Y.crew}`, Y.o2h < 24 ? C.red : C.text);
    line("Épurateurs CO₂", `${fmt(Y.scrub, 1)} j`, Y.scrub < 1 ? C.amber : C.text);
    for (const f of Y.failures) line(failureName(f.kind), f.fixing ? "réparation…" : "PANNE", f.fixing ? C.amber : C.red);
  }
  if (s.ring) {
    head("ANNEAU");
    line("Rotation · gravité", `${fmt(s.ring.rpm, 1)} tr/min · ${fmt(s.ring.g, 2)} g`);
    for (const q of s.ports ?? []) line(q.name, q.docked || "libre", q.docked ? C.green : C.dim);
  }
  head("HORLOGES ET LIAISON");
  if (s.time) {
    line("Facteur de temps", `×${fmt(s.time.warp, s.time.warp < 10 ? 1 : 0)}`);
    line("dτ/dt", fmt(s.time.dtau, 4), s.time.dtau < 0.99 ? C.amber : C.text);
  }
  if (s.link) line("Liaison Terre", s.link.cut ? "coupée (trou de ver)" : `lumière ${dur(s.link.light)}`, s.link.cut ? C.red : C.text);
  if (s.state) line("Sphère", bodyName(s.state.body));
}

/** The F-35's mission panel: its objective, its weapons, its alerts — the tactical console's strip. */
export function drawAirStatus(p: Pen, r: Rect, sc: Scene) {
  p.panel(r, "MISSION AÉRIENNE");
  const s = sc.snap;
  if (!s) return;
  let x = r.x + 12;
  const y = r.y + 40;
  const cell = (name: string, value: string, col: string = C.text) => {
    const w = Math.max(p.width(value, 13, 700), p.width(name, 10)) + 22;
    if (x + w > r.x + r.w) return;
    p.text(name, x, y, { col: C.dim, size: 10 });
    p.text(value, x, y + 18, { col, size: 13, weight: 700 });
    x += w;
  };
  const m = s.msn;
  cell("Objectif", m ? `${m.name} · ${fmt(m.dist / 1000, 1)} km` : "aucun", m ? C.amber : C.dim);
  const a = s.arms;
  if (a) {
    cell("Combat", a.live ? "EN COURS" : "hors combat", a.live ? C.red : C.dim);
    cell("Arme", a.sel || "—");
    cell("Radar", a.mode || "—", C.green);
    cell("Verrou", a.lock || "—", a.lock ? C.red : C.dim);
    const st = Object.entries(a.stores)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");
    cell("Emports", st || "—");
  }
  // (the refuelling: its phase and the fuel taken)
  if (s.aar) cell(L("Ravitaillement", "Refuelling"), `${aarPhaseName(s.aar.phase)} · ${fmt(s.aar.given)} kg`, aarColour(s.aar));
  const w = s.warn ?? [];
  cell("Alertes", w.length ? w.join(" · ") : "aucune", w.length ? C.red : C.green);
}
